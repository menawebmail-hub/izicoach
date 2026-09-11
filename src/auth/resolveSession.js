import { supabase } from "../services/supabaseClient.js";

// A profile lookup can transiently fail (401 while a fresh session's auth header is
// still propagating, a network hiccup, an unexpected REST error) — that must never be
// read as "no profile exists". PGRST116 ("0 or >1 rows" from .single()) is the only
// outcome that legitimately means "no match in this table, keep checking" — anything
// else gets exactly one delayed retry before being treated as a real failure.
//
// Phase C.1 correction: never let a thrown exception (from Supabase/fetch itself,
// distinct from a resolved {error}) escape this function — after the one permitted
// retry, a thrown exception on either attempt still resolves to {data:null,error},
// the same shape resolveSession's callers already know how to treat as a failure
// (accountStatusError). Nothing here should ever propagate as an unhandled rejection.
export const queryProfile = async (table, userId, selectCols) => {
  let result;
  try {
    result = await supabase.from(table).select(selectCols).eq("id", userId).single();
  } catch (thrown) {
    result = { data: null, error: thrown };
  }
  if (result.error && result.error.code !== "PGRST116") {
    await new Promise(r => setTimeout(r, 400));
    try {
      result = await supabase.from(table).select(selectCols).eq("id", userId).single();
    } catch (thrown) {
      result = { data: null, error: thrown };
    }
  }
  return result;
};

const isValidCoachStatus = (v) => v === null || v === "active" || v === "blocked" || v === "deactivated";
const isValidStudentStatus = (v) => v === null || v === "active" || v === "blocked";

// Account Access Control Phase C.1 — single source of truth for calling
// get_my_account_status() and validating its shape strictly, shared by the
// initial resolution flow (below) and AuthProvider's independent
// refreshAccountStatus(). Never trusts a partially-shaped or anomalous
// response: both keys must be present, both values must be one of their
// known literals, and — since a single identity is never meant to be both a
// coach and a student — both being non-null at once is treated as an
// anomaly, not a valid state. Any of these failures resolves to {ok:false},
// which callers must treat as fail-closed (account_status_error), never as
// "no restriction" or "new account". Never rejects — a thrown exception from
// the RPC call itself resolves to {ok:false} too.
export async function fetchAccountStatus() {
  let data, error;
  try {
    ({ data, error } = await supabase.rpc("get_my_account_status"));
  } catch (thrown) {
    console.error("fetchAccountStatus: get_my_account_status threw:", thrown);
    return { ok: false };
  }
  if (
    error ||
    !data ||
    typeof data !== "object" ||
    !("coach_status" in data) ||
    !("student_status" in data) ||
    !isValidCoachStatus(data.coach_status) ||
    !isValidStudentStatus(data.student_status) ||
    (data.coach_status !== null && data.student_status !== null)
  ) {
    if (error) console.error("fetchAccountStatus: get_my_account_status failed:", error);
    else console.error("fetchAccountStatus: get_my_account_status returned an invalid or anomalous shape:", data);
    return { ok: false };
  }
  return { ok: true, coach: data.coach_status, student: data.student_status };
}

// Single source of truth for turning a Supabase session into an identity (user, mode,
// onboarded, accountStatus). Used by the auth-state listener (AuthProvider) and by the
// manual login callback (AuthFlow's onLogin), so there is exactly one place that
// decides what a session means. Does not load business data (students/classes/coach
// profile/etc.) — that is App.jsx's responsibility, reacting to the identity this
// produces, because this module has no access to App.jsx's data-state closures.
//
// resolvedUserIdRef guards against re-running the full resolution (profile fetch) for
// a session already resolved — e.g. TOKEN_REFRESHED for the same user, or the
// SIGNED_IN event that follows a manual login already resolved via onLogin. Only the
// user/token is refreshed in that case.
//
// activeResolutionIdRef (Phase C.1) is a generation counter, but — corrected — it is
// bumped ONLY when a call actually commits to doing real resolution work (the
// null-session branch, or past the alreadyResolved shortcut below), never by a call
// that turns out to be a no-op. The original version bumped it unconditionally at the
// very top of every invocation, which produced a confirmed race: two concurrent events
// for the SAME already-resolving user each bumped the counter — the second one's own
// bump made the FIRST (real, still in-flight) call's own generation stale relative to
// the counter, even though the second call did no work at all (it only ever reaches
// its alreadyResolved shortcut). The first call would then discard its own outcome
// after the shortcut-call's spurious bump, leaving checkingProfile stuck true forever
// with nothing left to ever set it back. Fixed by moving the generation bump to AFTER
// the alreadyResolved check: a call that short-circuits there never touches the
// counter, so it can never invalidate the one real resolution actually in flight.
// Logout, a null session, and a genuine identity change (a different user.id) still
// bump it — those really do need to invalidate whatever the previous identity's
// resolution was doing.
//
// After every await inside a single (real) invocation, the code checks whether its
// own generation is still the current one before touching any state — if a newer
// resolution (a fresh auth event for a different identity, a null session, or a
// logout) started in the meantime, this invocation's outcome is stale and must never
// be applied.
//
// Account Access Control Phase C.1 — get_my_account_status() is the FIRST identity
// access for an authenticated session, before any direct read of coaches/student_auth.
// It is a SECURITY DEFINER RPC that works even once RLS starts gating direct reads of
// a restricted identity (a later phase), and it is the only way to learn
// blocked/deactivated status without probing tables whose emptiness is ambiguous
// (PGRST116 could mean "doesn't exist" or "exists but hidden").
//
// State machine (exact):
//   no session                                    -> user=null, mode=null (always invalidates prior work)
//   already resolved for this user.id              -> no-op: refreshes `user` only, never touches the generation counter
//   status RPC error / invalid shape / anomaly     -> accountStatusError=true, mode untouched, never coach_new
//   coach_status blocked|deactivated               -> mode="coach", accountStatus set, no further query
//   student_status blocked                         -> mode="student_portal", accountStatus set, no further query
//   coach_status active                            -> SELECT coaches row:
//     row present, onboarded===true                -> mode="coach"
//     row present, onboarded!==true                -> mode="coach_new" (preserves existing onboarding path)
//     error or no row                               -> accountStatusError=true (status said active — a missing/failed
//                                                      row here is an inconsistency, never "new account")
//   student_status active                          -> SELECT student_auth row (exactly one expected):
//     row present, localStorage transport persisted -> mode="student_portal"
//     row present, localStorage write failed         -> accountStatusError=true, partial keys removed,
//                                                       never mounts student_portal with incomplete transport
//     error or no row                                -> accountStatusError=true
//   coach_status=null AND student_status=null       -> mode="coach_new", no further query (genuinely new account)
//
// Returns the mode it resolved to ("coach" | "coach_new" | "student_portal"), or null
// when it didn't determine one (no session, already-resolved shortcut, an aborted
// lookup, an account_status_error, or a superseded/stale invocation). Every existing
// caller already treats anything other than its one expected literal as failure, so
// this is safe for all of them unchanged.
export const makeResolveSession = ({
  resolvedUserIdRef,
  activeResolutionIdRef,
  lifecycleTokenRef,
  setUser,
  setMode,
  setOnboarded,
  setCheckingProfile,
  setAccountStatus,
  setAccountStatusError,
}) => {
  // expectedLifecycleToken (Hallazgo 2) — when a nested caller (AuthProvider's
  // reresolve(), itself invoked from completeInviteAcceptance with the token
  // resumeInviteFromCallback originally captured) passes this, it is used
  // INSTEAD of auto-capturing lifecycleTokenRef?.current below. This is what
  // lets a stale invitation-resolution attempt be recognized as stale even
  // after the provider has torn down and a NEWER setup has installed its own
  // fresh token in the ref — auto-capturing at call time would wrongly match
  // that newer token and rehabilitate an operation that started under a
  // setup which no longer exists. Normal callers (the onAuthStateChange
  // listener, refreshAccountStatus, App.jsx's handleOnboardingComplete via
  // reresolve() with no argument) never pass this, so they keep the original
  // auto-capture behavior unchanged.
  return async (session, { expectedLifecycleToken } = {}) => {
    // Hallazgo v4 punto 1 — the token this invocation is accountable to is
    // determined ONCE, here, BEFORE any setter of any kind (including
    // setUser) runs in either the null-session or real-session path, and
    // before even the alreadyResolved dedupe shortcut. `expectedLifecycleToken`,
    // when a nested caller (reresolve(), on behalf of the invite chain)
    // supplies it, is the ORIGINAL token that caller is accountable to —
    // used as-is, never re-captured. A normal (non-nested) call auto-
    // captures whatever's live in the ref right now. Either way: null is
    // never a valid token, and a caller's already-stale
    // expectedLifecycleToken must fail here even though lifecycleTokenRef.current
    // itself might currently hold some OTHER, perfectly live token
    // (belonging to a different, newer setup) — a stale call from setup A
    // must never be treated as speaking for setup B, not even to clear
    // state via the null-session branch below.
    const myLifecycleToken = expectedLifecycleToken !== undefined ? expectedLifecycleToken : lifecycleTokenRef?.current;
    const tokenIsLive = myLifecycleToken != null && lifecycleTokenRef?.current === myLifecycleToken;
    if (!tokenIsLive) return null;

    if (!session?.user) {
      // A real state change — always invalidates whatever prior work (this
      // identity's or anyone else's) might still be in flight, PROVIDED this
      // call itself is still accountable to a live token (just confirmed
      // above) — a stale resolveSession(null) can never reach past the gate.
      ++activeResolutionIdRef.current;
      resolvedUserIdRef.current = null;
      setUser(null);
      setMode(null);
      setOnboarded(false);
      setAccountStatus({ coach: null, student: null });
      setAccountStatusError(false);
      // Without this, a session lost while checkingProfile was true (a
      // resolution in flight when the session ended) left the app stuck on
      // the loading screen forever — this branch is unconditional (given the
      // gate above already passed), same as the rest of it: a genuine "no
      // session" state always wins.
      setCheckingProfile(false);
      return null;
    }

    // Hallazgo v4 punto 1: the alreadyResolved shortcut also sits behind the
    // token gate above now — setUser is its only setter, and it never runs
    // until tokenIsLive has already been confirmed.
    const alreadyResolved = resolvedUserIdRef.current === session.user.id;
    setUser(session.user);
    // Corrected: this shortcut must never touch activeResolutionIdRef. It did
    // no real resolution work — bumping the counter here is exactly the
    // spurious invalidation that broke the manual-login + duplicate SIGNED_IN
    // case (and any other concurrent same-user event).
    if (alreadyResolved) return null;

    // Committing to real resolution work now — this is the one call allowed
    // to supersede whatever came before it for this identity. No await has
    // happened since the token gate above passed, so myLifecycleToken is
    // still guaranteed live at this exact point; stillCurrent() below only
    // needs to re-verify it after each subsequent await.
    const myGen = ++activeResolutionIdRef.current;
    // lifecycleTokenRef (corrected) — replaces a plain disposed boolean,
    // which broke React Strict Mode's dev-only setup->cleanup->setup cycle:
    // a boolean flipped true by the first cleanup and never reset stayed
    // true forever, permanently discarding every future resolution even
    // though the second setup re-subscribed normally. AuthProvider's effect
    // creates a fresh `{}` token on every setup and assigns it to this ref;
    // its cleanup assigns `null` (never re-reading the ref's own value in
    // either case — both are pure writes, so neither trips the "ref
    // accessed in effect cleanup" lint rule for a ref that isn't a DOM node
    // anyway).
    const stillCurrent = () =>
      myLifecycleToken != null &&
      activeResolutionIdRef.current === myGen &&
      lifecycleTokenRef?.current === myLifecycleToken;

    resolvedUserIdRef.current = session.user.id;
    setCheckingProfile(true);
    setAccountStatusError(false);

    const statusResult = await fetchAccountStatus();
    if (!stillCurrent()) return null; // superseded meanwhile — never touch state

    if (!statusResult.ok) {
      resolvedUserIdRef.current = null;
      setAccountStatus({ coach: null, student: null });
      setAccountStatusError(true);
      setCheckingProfile(false);
      return null;
    }

    const { coach: coachStatus, student: studentStatus } = statusResult;
    setAccountStatus({ coach: coachStatus, student: studentStatus });

    if (coachStatus === "blocked" || coachStatus === "deactivated") {
      setCheckingProfile(false);
      setMode("coach");
      return "coach";
    }

    if (studentStatus === "blocked") {
      setCheckingProfile(false);
      setMode("student_portal");
      return "student_portal";
    }

    if (coachStatus === "active") {
      const { data, error } = await queryProfile("coaches", session.user.id, "name,currency,sport,photo,onboarded");
      if (!stillCurrent()) return null;
      if (error || !data) {
        console.error("resolveSession: coach_status=active but the coaches row lookup failed or returned nothing:", error);
        resolvedUserIdRef.current = null;
        setAccountStatusError(true);
        setCheckingProfile(false);
        return null;
      }
      setCheckingProfile(false);
      if (data.onboarded === true) {
        setMode("coach"); setOnboarded(true);
        return "coach";
      }
      // Fila existe pero onboarded !== true — preserva exactamente el camino de
      // onboarding ya existente, sin cambios de comportamiento.
      setMode("coach_new"); setOnboarded(false);
      return "coach_new";
    }

    if (studentStatus === "active") {
      const { data: sa, error: saErr } = await queryProfile("student_auth", session.user.id, "*");
      if (!stillCurrent()) return null;
      if (saErr || !sa) {
        console.error("resolveSession: student_status=active but the student_auth row lookup failed or returned nothing:", saErr);
        resolvedUserIdRef.current = null;
        setAccountStatusError(true);
        setCheckingProfile(false);
        return null;
      }
      // Phase C.1 correction: this transport is load-bearing — App.jsx's
      // student_portal render path has no other way to know which student
      // row is "mine". lsSet() swallows write failures silently; that is
      // exactly wrong here, so both writes are direct and explicitly checked.
      // A partial failure (e.g. only one key written before quota/private-
      // mode/etc rejects the second) must not leave a half-written transport
      // behind — both keys are removed and student_portal is never entered.
      let localStorageOk = true;
      try {
        localStorage.setItem("izi_student_coach_id", JSON.stringify(sa.coach_id));
        localStorage.setItem("izi_student_id_raw", String(sa.student_id));
      } catch (thrown) {
        localStorageOk = false;
        console.error("resolveSession: failed to persist student identity transport to localStorage:", thrown);
      }
      if (!localStorageOk) {
        try { localStorage.removeItem("izi_student_coach_id"); } catch {}
        try { localStorage.removeItem("izi_student_id_raw"); } catch {}
        resolvedUserIdRef.current = null;
        setAccountStatusError(true);
        setCheckingProfile(false);
        return null;
      }
      setCheckingProfile(false);
      setMode("student_portal");
      return "student_portal";
    }

    // coach_status===null && student_status===null — la única combinación que
    // llega hasta acá (blocked/deactivated/active ya retornaron arriba, y ambos
    // no-nulos ya fue rechazado por fetchAccountStatus como anomalía).
    setCheckingProfile(false);
    setMode("coach_new"); setOnboarded(false);
    return "coach_new";
  };
};
