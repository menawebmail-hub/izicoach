import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "../services/supabaseClient.js";
import { makeResolveSession, fetchAccountStatus } from "./resolveSession.js";
import { AuthContext } from "./AuthContext.js";

const ls = (key, def) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; } };
const lsSet = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

// Hallazgo 4 — a distinct sentinel (never a real mode string, never null) so
// reresolve()/completeInviteAcceptance can report "this was abandoned
// because the owning setup tore down mid-flight" as something other than a
// genuine resolution failure. Only ever produced when a caller explicitly
// opts in by passing expectedLifecycleToken to reresolve(); every other
// caller's null still means exactly what it always meant.
const RESOLUTION_CANCELLED = Symbol("resolution-cancelled");

// Hallazgo v6 — public.accept_student_invite (supabase/migrations/
// 20260907183000_account_access_control_phase_b.sql, lines 403-576) was
// proven idempotent for a retry by the SAME auth.uid() against the SAME
// code once the original call has committed — see the v_used/v_already_mine
// branch at lines 497-514: a repeated call for an already-accepted code
// simply returns { ok: true } again, without duplicating anything. That
// finding is what callAcceptStudentInvite (below) is built on: a single,
// centralized helper that retries the RPC itself at most once (never a
// third attempt), only when the previous attempt THREW (never for a
// resolved, structured {error} — that's a real server response, not
// something ambiguous), and only after re-verifying the retry would still
// run under the exact same identity (and, for the invite-callback path, the
// exact same live lifecycle token) it started for.

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [checkingProfile, setCheckingProfile] = useState(false);
  const [mode, setMode] = useState(null);
  const [onboarded, setOnboarded] = useState(() => ls("izi_onboarded", false));
  const [onboardingSaveFailed, setOnboardingSaveFailed] = useState(false);
  const resolvedUserIdRef = useRef(null);

  // Account Access Control Phase C.1 — accountStatus/accountStatusError are the
  // only new pieces of state. `mode` keeps meaning exactly what it always meant
  // ("what kind of identity is this"); accountStatus layers restriction state on
  // top of it, orthogonal to mode, matching how the database models it (a
  // separate access-control table, not a different kind of coach/student row).
  const [accountStatus, setAccountStatus] = useState({ coach: null, student: null });
  const [accountStatusError, setAccountStatusError] = useState(false);
  // Ref mirrors, kept in sync on every write. Two independent reasons this
  // matters: (1) refreshAccountStatus needs the *current* accountStatus
  // synchronously (to diff against a fresh fetch) without depending on a
  // closure captured at effect-setup time; (2) exposed to consumers (App.jsx)
  // so a caller like handleOnboardingComplete can read the true post-
  // reresolve() status immediately, since its own local `accountStatus`
  // closure from render time cannot reflect a state update that happened
  // inside the very call it just awaited.
  const accountStatusRef = useRef({ coach: null, student: null });
  const accountStatusErrorRef = useRef(false);
  const setAccountStatusBoth = (v) => { accountStatusRef.current = v; setAccountStatus(v); };
  const setAccountStatusErrorBoth = (v) => { accountStatusErrorRef.current = v; setAccountStatusError(v); };

  // Generation counter shared with resolveSession — see the long comment on
  // makeResolveSession in resolveSession.js for the full invariant. Bumped
  // there (null session, or a real resolution starting — never by the
  // alreadyResolved shortcut), here by logout() (to invalidate anything in
  // flight) and, in one specific escalation case, by refreshAccountStatus().
  const activeResolutionIdRef = useRef(0);

  // Phase C.1 audit fix — "latest ref" pattern: resolveSession/
  // resumeInviteFromCallback/refreshAccountStatus are plain consts recreated
  // every render, but the two mount-once effects below (onAuthStateChange's
  // subscription, the visibility/focus listeners) must register exactly once
  // — re-running them on every render to chase a fresh closure would
  // re-subscribe/re-attach listeners repeatedly, which is worse. This ref is
  // kept current by the useLayoutEffect right after resumeInviteFromCallback's
  // own definition (below) and dereferenced at call time inside both
  // mount-once effects, so they always invoke that render's actual latest
  // version — no stale closures, and the effects' own dependency arrays stay
  // genuinely exhaustive (a ref never needs to be listed).
  //
  // useLayoutEffect (not useEffect) for the sync, on explicit correction:
  // layout effects across the WHOLE tree commit before ANY passive effect
  // runs, so latestRef.current is guaranteed populated before the
  // onAuthStateChange-subscribing effect below even executes — not merely
  // "safe in practice given event-loop timing", but structurally ordered by
  // React itself, on every render including the first.
  const latestRef = useRef({});

  // Corrected — replaces a plain boolean "disposed" flag, which broke React
  // Strict Mode's dev-only setup->cleanup->setup double-invoke: a boolean
  // set true by the first cleanup and never reset stayed true forever,
  // permanently discarding every future resolution even after the second
  // setup re-subscribed and the provider was genuinely, normally mounted.
  // A lifecycle token doesn't have that failure mode: every setup of the
  // onAuthStateChange effect below creates a brand-new `{}` object and
  // assigns it here; its cleanup assigns `null`. Both are pure writes (never
  // read the ref's own prior value first), so neither trips the "ref
  // accessed in effect cleanup" lint rule for a ref that was never a DOM
  // node in the first place. Deliberately separate from
  // activeResolutionIdRef: that counter's whole point is to keep changing
  // during normal, still-mounted operation (every real resolution bumps
  // it), so a function like resumeInviteFromCallback that spans one of
  // those legitimate bumps (it calls reresolve() -> resolveSession(), which
  // bumps the counter as part of doing real work) has no stable baseline to
  // compare against for "am I still wanted" — this ref answers exactly one
  // orthogonal question instead: which setup of the effect is currently
  // live, if any (null = none / torn down).
  const lifecycleTokenRef = useRef(null);

  const setModeP = (v) => { setMode(v); lsSet("izi_mode", v); };
  const setOnboardedP = (v) => { setOnboarded(v); lsSet("izi_onboarded", v); };

  const resolveSession = makeResolveSession({
    resolvedUserIdRef,
    activeResolutionIdRef,
    lifecycleTokenRef,
    setUser,
    setMode: setModeP,
    setOnboarded: setOnboardedP,
    setCheckingProfile,
    setAccountStatus: setAccountStatusBoth,
    setAccountStatusError: setAccountStatusErrorBoth,
  });

  // Set (synchronously, before signUp()) for the entire duration of
  // registerStudentFromInvite below. While true, the auth listener must not
  // let a session-bearing event reach resolveSession — that intermediate
  // SIGNED_IN (fired by signUp, before accept_student_invite has run) would
  // otherwise get classified as coach_new. session-less events (SIGNED_OUT)
  // are never affected by this — see the check below.
  const pendingInviteAcceptRef = useRef(false);

  // Frontend-6c: separate from pendingInviteAcceptRef above, which only
  // covers a transaction actively running in *this* tab's own call stack.
  // Returning from a Confirm Email link is a fresh page load — a React ref
  // set from within registerStudentFromInvite can't survive that. This one
  // is armed synchronously from the URL/sessionStorage at mount, before the
  // listener below can process anything.
  //
  // Frontend-6e (Hallazgo 2): a plain ?invite=CODE link — the kind a coach
  // actually shares — must never auto-arm this by itself. Without a further
  // check, someone already logged in as anyone (another student, a coach)
  // who merely opens that link would have their own INITIAL_SESSION treated
  // as an invite-acceptance attempt, silently signing them out. So the URL
  // only counts when it also carries invite_callback=1 — a marker
  // registerStudentFromInvite stamps into emailRedirectTo itself, which
  // never appears on a link a coach hands out. It authorizes nothing by
  // itself (accept_student_invite + reresolve still decide that); it only
  // says "this URL was built as a Confirm Email redirect target".
  // sessionStorage doesn't need an equivalent marker: that key is written
  // exclusively by registerStudentFromInvite's own pendingEmailConfirmation
  // branch, so its mere presence already proves this exact tab genuinely
  // started that flow — nothing else in the app ever sets it.
  const pendingCallbackInviteRef = useRef((() => {
    const params = new URLSearchParams(window.location.search);
    const urlInvite = params.get("invite");
    if (urlInvite && params.get("invite_callback") === "1") return urlInvite;
    try { return sessionStorage.getItem("izi_pending_invite_code"); } catch { return null; }
  })());

  // Hallazgo v4 punto 3 — a genuine mutex for accept_student_invite, scoped
  // to the whole provider INSTANCE, not to any one effect setup: null when
  // nothing is in flight, otherwise the lifecycleToken of whichever attempt
  // currently owns it. A token, not a plain boolean, so a release can be
  // OWNERSHIP-CHECKED (`current === myOwnToken`) rather than unconditional —
  // that is what makes a stale attempt handing off to a fresh retry safe: if
  // the stale attempt's own delayed release fires only after the new retry
  // has already claimed the mutex under its own (different) token, the
  // ownership check makes that stale release a no-op instead of wrongly
  // clearing a mutex someone else now legitimately holds. This is what
  // actually guarantees accept_student_invite never runs concurrently twice
  // for the same code across the exact handoff this round is fixing — a
  // stale setup A handing an in-progress code off to a live setup B — since
  // both go through the same tryResumePendingInvite, which checks this ref
  // regardless of which setup is calling it.
  const inviteCallbackInFlightRef = useRef(null);

  // Account Access Control Phase C.1 — refreshAccountStatus(), redesigned.
  //
  // activeResolutionIdRef is used here purely as a cancellation epoch: the
  // baseline is CAPTURED (never incremented) before the first await, and
  // every subsequent await checks it's still the same value. The only place
  // this function itself increments it is the explicit failure-escalation
  // branch (a failed refresh overriding whatever might be in progress) —
  // never merely for starting a refresh, and never for a refresh that finds
  // nothing changed. That distinction is what keeps a routine "still active"
  // background check (the overwhelming common trigger, from focus/
  // TOKEN_REFRESHED) from ever invalidating a genuine resolution already
  // running elsewhere.
  //
  // Never authorization by itself — the server already enforced (or didn't)
  // whatever it enforces before this ever runs; this only closes the gap
  // between that and the UI reflecting it. Never rejects: every await is
  // individually guarded, and the outer try/catch is a structural backstop
  // so focus/visibility/TOKEN_REFRESHED callers — none of which attach a
  // .catch() — can never see an unhandled rejection from this.
  //
  // On any real change (or recovery from a prior accountStatusError, even
  // when the freshly-fetched values happen to coincide with the previous
  // ones — e.g. a fresh {null,null} after an error must still reach
  // mode="coach_new", not just clear the error flag) this forces one
  // canonical resolution through resolveSession itself, bypassing
  // resolvedUserIdRef's dedupe. resolveSession owns every branch (including
  // the generation bump for that real resolution) — nothing here duplicates
  // its logic. A refresh that finds no change and isn't recovering from an
  // error stays fully silent: no state write, no generation touch, no
  // resolveSession call — so it can never disrupt a genuine resolution (or
  // an in-progress onboarding flow sitting on mode="coach_new") already
  // under way.
  const refreshInFlightRef = useRef(false);
  const lastThrottledRefreshAtRef = useRef(0);

  const refreshAccountStatus = async ({ throttle = false } = {}) => {
    if (refreshInFlightRef.current) return;
    if (throttle) {
      const now = Date.now();
      if (now - lastThrottledRefreshAtRef.current < 4000) return;
      lastThrottledRefreshAtRef.current = now;
    }
    refreshInFlightRef.current = true;
    // Baseline captured OUTSIDE the try, so the outer catch below can also
    // check it — a stale invocation's own bug must not stomp on whatever
    // superseded it. NOT incremented merely for starting a refresh: only a
    // refresh that finds a real reason to act (see the two escalation
    // branches, and the handoff comment further down) ever bumps it.
    const myGen = activeResolutionIdRef.current;
    // lifecycleTokenRef folded in here too — see the parallel comment in
    // resolveSession.js's own stillCurrent for why (a timer that already
    // fired before unmount must still discard its outcome, and a boolean
    // wouldn't survive Strict Mode's setup->cleanup->setup cycle).
    const myLifecycleToken = lifecycleTokenRef.current;
    // Hallazgo 1: null never counts as a match here either — checked first.
    const stillCurrent = () =>
      myLifecycleToken != null &&
      activeResolutionIdRef.current === myGen &&
      lifecycleTokenRef.current === myLifecycleToken;
    // Once true, ownership of any further consequences has been handed off
    // entirely to resolveSession (which owns its OWN, freshly-bumped
    // generation from that point on) — the outer catch must never reapply
    // its own fail-closed escalation for a rejection that happens after
    // this, since by then myGen/stillCurrent() no longer describe anything
    // meaningful: resolveSession's internal staleness handling is what's
    // authoritative.
    let handedOffToResolveSession = false;
    try {
      let session = null, sessionError = null;
      try {
        const result = await supabase.auth.getSession();
        session = result.data?.session ?? null;
        sessionError = result.error ?? null;
      } catch (thrown) {
        sessionError = thrown;
      }
      if (!stillCurrent()) return; // logout/newer resolution landed while this awaited getSession()

      if (sessionError) {
        // Corrected: a getSession() failure means the account's status can
        // no longer be vouched for at all — silently keeping the last
        // known-good accountStatus would leave the operational tree mounted
        // (Realtime channels, coach_data writes) against a status that's no
        // longer verifiable. Fail closed, the same escalation as an
        // explicit {ok:false} below: never coach_new, never a silent
        // "active" carried forward. Still owns the epoch here (stillCurrent()
        // just passed), so this is safe to apply.
        console.error("refreshAccountStatus: getSession failed:", sessionError);
        ++activeResolutionIdRef.current;
        resolvedUserIdRef.current = null;
        setAccountStatusBoth({ coach: null, student: null });
        setAccountStatusErrorBoth(true);
        setCheckingProfile(false);
        return;
      }

      if (!session?.user) {
        // Canonical null-session path, routed through resolveSession itself
        // so every consequence (clearing user/mode/accountStatus, resetting
        // checkingProfile, bumping the generation) lives in exactly one
        // place. Never keeps a previous identity around. Ownership transfers
        // now — a rejection from this specific call is logged only, never
        // reinterpreted against myGen (see handedOffToResolveSession above).
        handedOffToResolveSession = true;
        await resolveSession(null);
        return;
      }

      const statusResult = await fetchAccountStatus();
      if (!stillCurrent()) return; // superseded while the RPC was in flight

      if (!statusResult.ok) {
        // A failed refresh overrides whatever resolution might be in
        // progress — still this invocation's own epoch to spend (stillCurrent()
        // just passed above), so applying it directly is safe.
        ++activeResolutionIdRef.current;
        resolvedUserIdRef.current = null;
        setAccountStatusBoth({ coach: null, student: null });
        setAccountStatusErrorBoth(true);
        setCheckingProfile(false);
        return;
      }

      const { coach: newCoach, student: newStudent } = statusResult;
      const prev = accountStatusRef.current;
      const recoveringFromError = accountStatusErrorRef.current;
      const unchanged = !recoveringFromError && prev.coach === newCoach && prev.student === newStudent;
      if (unchanged) return; // fully silent — no generation touch, no resolveSession call

      // Real change, or recovering from a prior error — force one canonical
      // resolution. resolvedUserIdRef is cleared first so resolveSession
      // actually re-runs instead of taking its alreadyResolved shortcut.
      // Ownership transfers now (see handedOffToResolveSession above).
      resolvedUserIdRef.current = null;
      handedOffToResolveSession = true;
      await resolveSession(session);
    } catch (thrown) {
      console.error("refreshAccountStatus: unexpected failure:", thrown);
      if (handedOffToResolveSession) {
        // Ownership already transferred — reapplying a fail-closed
        // escalation unconditionally here is exactly the bug being fixed: a
        // stale rejection from a call whose consequences resolveSession
        // already owns (and already correctly handled, generation-wise)
        // could otherwise stomp on a logout or a newer resolution that ran
        // correctly in the meantime. Logged only.
        return;
      }
      if (!stillCurrent()) return; // this invocation no longer owns the epoch either
      ++activeResolutionIdRef.current;
      resolvedUserIdRef.current = null;
      setAccountStatusBoth({ coach: null, student: null });
      setAccountStatusErrorBoth(true);
      setCheckingProfile(false);
    } finally {
      refreshInFlightRef.current = false;
    }
  };

  // Auth restoration relies solely on onAuthStateChange's INITIAL_SESSION event (fired
  // once, right after the client loads the session from storage) instead of a separate
  // getSession() call — calling both raced, and getSession() could resolve with a stale
  // "no session" result before the client finished restoring, showing the login screen
  // even though a valid session existed (fixed by a manual refresh, which re-ran the race
  // and usually won it). loadingAuth now only clears after this listener's first event.
  useEffect(() => {
    // Corrected — a fresh lifecycle token for THIS setup, assigned
    // immediately: a plain write (never reads lifecycleTokenRef's prior
    // value first), so React Strict Mode's dev-only extra setup->cleanup->
    // setup cycle behaves correctly — the second setup's token is a
    // distinct object from the first's, and resolveSession/
    // refreshAccountStatus/resumeInviteFromCallback compare by identity
    // (===) against whatever token they captured when THEY started, not
    // against a shared boolean that a first cleanup could permanently spoil.
    const myLifecycleToken = {};
    lifecycleTokenRef.current = myLifecycleToken;

    // Phase C.1 audit fix — explicit lifecycle tracking for this effect:
    // `disposed` flips true on cleanup and is checked at the top of the
    // subscription callback and inside settleFirstEvent, so neither can
    // update state after unmount even if an event or a deferred timeout
    // fires in that narrow window. `pendingTimeoutIds` records every
    // setTimeout(...,0) this effect schedules so cleanup can cancel whatever
    // hasn't fired yet — belt-and-suspenders alongside `disposed` itself,
    // which alone already makes a late callback a no-op. `disposed` is a
    // plain local, fresh per setup by construction — unlike a ref, it never
    // needed the lifecycle-token treatment; it already can't leak across a
    // Strict Mode remount into a different setup's closure.
    let disposed = false;
    let firstEventHandled = false;
    const pendingTimeoutIds = new Set();

    const settleFirstEvent = () => {
      if (disposed) return;
      if (!firstEventHandled) { firstEventHandled = true; setLoadingAuth(false); }
    };

    const scheduleDeferred = (fn) => {
      const id = setTimeout(() => {
        pendingTimeoutIds.delete(id);
        if (disposed) return;
        fn();
      }, 0);
      pendingTimeoutIds.add(id);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (disposed) return;
      // Same-tab explicit transaction (registerStudentFromInvite/
      // loginStudentFromInvite) always wins over a merely-armed callback
      // guard — it already owns calling completeInviteAcceptance itself via
      // its own explicit await chain. Without this priority, both guards
      // being true at once — e.g. a first signUp attempt already left a
      // pending code in sessionStorage (Confirm Email ON, still unconfirmed)
      // and the user retries "Crear cuenta" in this same tab before ever
      // confirming — would call completeInviteAcceptance twice for the same
      // code. (A plain ?invite=CODE link, without invite_callback=1, never
      // arms pendingCallbackInviteRef by itself — see where it's read.)
      if (pendingInviteAcceptRef.current && session?.user) {
        // registerStudentFromInvite() is already in flight for this exact
        // session and calls reresolve() itself once accept_student_invite's
        // outcome is known — skip so this intermediate event never resolves
        // the account prematurely. A callback guard armed from the URL is
        // moot now that the explicit flow is handling things — discard it so
        // it can't fire later for an unrelated event in this same tab.
        pendingCallbackInviteRef.current = null;
        settleFirstEvent();
        return;
      }
      if (pendingCallbackInviteRef.current && session?.user && inviteCallbackInFlightRef.current == null) {
        // Returning from a Confirm Email link (or, harmlessly, any other
        // session-bearing event in a tab that still has ?invite= armed and
        // unconsumed).
        //
        // Hallazgo v4 punto 3 — the code is claimed and actually consumed
        // (ref cleared) only inside tryResumePendingInvite, called from the
        // deferred callback below — never synchronously here. A timer that
        // gets cancelled before firing (this setup's cleanup running first)
        // never reaches that line, so it never touches the ref: the code
        // stays pending for whichever setup ends up live. The
        // inviteCallbackInFlightRef check in this branch's own condition
        // (not a per-setup local — a single mutex for the whole provider
        // instance) is what stops a second event, in this OR a later setup,
        // from also scheduling a redundant attempt while one is already
        // running; see tryResumePendingInvite for the rest of that story,
        // including the immediate-retry path that runs when a claimed
        // attempt itself goes stale.
        //
        // Phase C.1 correction: set checking state synchronously, in the
        // SAME tick as settling loadingAuth below — otherwise there is a
        // real gap (until the deferred timeout further down actually fires
        // and resumeInviteFromCallback sets it) where loadingAuth=false AND
        // checkingProfile=false at once, with user/mode still null: the
        // render gate would show the plain login screen for one or more
        // renders before flashing back to the loading state.
        setCheckingProfile(true);
        settleFirstEvent();
        // Deferred (Phase C.1) — see the note below on the fallthrough branch
        // for why any Supabase call here must not run synchronously inside
        // this callback. Read via latestRef (see its declaration above) —
        // this effect only runs once, at mount, so a directly closed-over
        // reference would forever be the first render's.
        scheduleDeferred(() => {
          latestRef.current.tryResumePendingInvite(session);
        });
        return;
      }
      // Account Access Control Phase C.1 — every branch that touches Supabase
      // (resolveSession/refreshAccountStatus, both of which call supabase.rpc/
      // supabase.from/supabase.auth.getSession) is deferred one tick via
      // setTimeout(...,0). Supabase's client holds an internal lock while this
      // callback itself is running; calling back into the same client
      // synchronously from inside onAuthStateChange — even fire-and-forget,
      // never awaited here — risks deadlocking on that lock in some SDK
      // versions. Deferring breaks out of the callback's own execution
      // context before any Supabase call actually starts. The guard checks
      // above stay synchronous (plain ref reads/writes, no Supabase call), so
      // they're unaffected.
      scheduleDeferred(() => {
        if (_event === "TOKEN_REFRESHED") {
          // resolveSession's own dedupe would otherwise skip re-checking
          // status entirely for an already-resolved uid — refreshAccountStatus
          // deliberately bypasses that, which is the whole point of running it
          // here instead of the plain resolveSession(session) call below.
          latestRef.current.refreshAccountStatus().catch((thrown) => {
            console.error("onAuthStateChange: refreshAccountStatus failed:", thrown);
          }).finally(settleFirstEvent);
        } else {
          latestRef.current.resolveSession(session).catch((thrown) => {
            console.error("onAuthStateChange: resolveSession failed:", thrown);
          }).finally(settleFirstEvent);
        }
      });
    });

    return () => {
      disposed = true;
      // Corrected: cancelling not-yet-fired timers (below) isn't enough — a
      // timer that already fired and kicked off resolveSession/
      // refreshAccountStatus continues running regardless (neither knows
      // about this effect's local `disposed`). Both functions' own
      // stillCurrent() now also compares lifecycleTokenRef.current against
      // the token THEY captured when they started (see resolveSession.js
      // and refreshAccountStatus above) — invalidating it here only requires
      // making it stop matching, which assigning `null` does unconditionally
      // (this setup's own token, myLifecycleToken, is never reassigned to
      // the ref again after this). A plain assignment, not a read-then-write
      // increment, so it doesn't trip the "ref accessed in effect cleanup"
      // lint rule for a ref that was never a DOM node in the first place —
      // and unlike a boolean, a *subsequent* setup (React Strict Mode's
      // dev-only remount) assigns its OWN fresh token right at its own
      // start, so it is never left permanently invalidated by this line.
      lifecycleTokenRef.current = null;
      subscription.unsubscribe();
      pendingTimeoutIds.forEach((id) => clearTimeout(id));
      pendingTimeoutIds.clear();
    };
  }, []);

  // Account Access Control Phase C.1 — mid-session revalidation triggers, beyond
  // TOKEN_REFRESHED above. No interval polling anywhere. Both listeners share the
  // same throttle window (refreshAccountStatus's own lastThrottledRefreshAtRef), so
  // a tab regaining both visibility and focus near-simultaneously (common browser
  // behavior) collapses into a single check. Neither listener creates a timer, so
  // there's nothing beyond the standard removeEventListener to track on cleanup.
  useEffect(() => {
    // Read via latestRef, same reason as the auth-listener effect above —
    // this registers once, at mount.
    const handleVisibility = () => {
      if (document.visibilityState === "visible") latestRef.current.refreshAccountStatus({ throttle: true });
    };
    const handleFocus = () => { latestRef.current.refreshAccountStatus({ throttle: true }); };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  // Frontend-6c: finishes a pending invite acceptance detected from the URL/
  // sessionStorage at mount, using the real session Supabase's own
  // onAuthStateChange just delivered — never a fabricated one. Reuses
  // completeInviteAcceptance (Frontend-6a) exactly as-is, so it automatically
  // inherits every protection already verified for the direct-signup path:
  // wrong email, already-linked-elsewhere, and even a coach's own uid trying
  // to accept (Case F) all fail closed here the same way, because the check
  // lives in the RPC and in reresolve()'s literal "student_portal"
  // requirement, not in anything specific to this call site.
  // isAutomaticRetry — false for every "first attempt" (the onAuthStateChange
  // listener's own branch, via tryResumePendingInvite, always calls with the
  // default). Set to true only by this function's OWN one-time automatic
  // handoff below, so that if THAT retry also goes stale it does not spawn
  // another one — at most one automatic handoff, ever, per lifecycle-stale
  // occurrence. This is a SEPARATE, orthogonal bound from
  // callAcceptStudentInvite's own at-most-2-RPC-attempts budget: a full
  // handoff (re-running the RPC) only ever runs when confirmed that ZERO
  // RPC calls happened yet — never when the RPC already produced success
  // (acceptedConfirmed — reresolve-only catch-up, no RPC), a structured
  // rejection (structuredErrorConfirmed — terminal), or an exhausted-
  // ambiguous outcome (unknown — also terminal); see below.
  const resumeInviteFromCallback = async (code, session, isAutomaticRetry = false) => {
    // Captured at the very start — the token belonging to whichever setup
    // of the onAuthStateChange effect is live right now, if any. This
    // function spans a reresolve()->resolveSession() call that legitimately
    // bumps activeResolutionIdRef as part of doing real work, so that
    // counter alone has no stable baseline to compare against here (unlike
    // resolveSession's own internal stillCurrent(), which compares against
    // a generation IT just bumped); the lifecycle token is unaffected by
    // that and answers the one question this actually needs: has the
    // provider been torn down (or Strict-Mode-remounted into a fresh setup)
    // since this specific call started.
    //
    // Hallazgo 1/2: no caller may begin with a null token. If the effect
    // isn't currently mounted under a live setup there is no operational UI
    // depending on this, and — critically — this token is also what gets
    // threaded down through completeInviteAcceptance -> reresolve ->
    // resolveSession (Hallazgo 2) as the ORIGINAL token those nested calls
    // must keep honoring, instead of resolveSession auto-capturing whatever
    // (possibly newer) token happens to be in the ref by the time it
    // actually runs.
    const myLifecycleToken = lifecycleTokenRef.current;
    if (myLifecycleToken == null) return;
    const tokenStillLive = () => lifecycleTokenRef.current === myLifecycleToken;
    // Keeps the app on its existing neutral loading screen (App.jsx already
    // gates render on checkingProfile) for the whole RPC+reresolve round
    // trip — otherwise user/mode both being momentarily null here would flash
    // the plain login screen before landing on student_portal (or back on
    // login again, on failure).
    setCheckingProfile(true);
    let cancelled = false;
    let unknown = false;
    let acceptedConfirmed = false;
    let structuredErrorConfirmed = false;
    try {
      const result = await completeInviteAcceptance(code, session, myLifecycleToken);
      cancelled = result?.cancelled === true || !tokenStillLive();
      unknown = result?.unknown === true;
      acceptedConfirmed = result?.acceptedConfirmed === true;
      structuredErrorConfirmed = result?.structuredErrorConfirmed === true;
    } catch {
      // Frontend-6e (Hallazgo 1, pre-existing): completeInviteAcceptance
      // itself has no try/catch around its own body (accept_student_invite's
      // own transport throw is already fully handled inside
      // callAcceptStudentInvite) — a throw reaching here is something else
      // entirely (e.g. supabase.auth.signOut() itself failing). Must not
      // leave a real Supabase session sitting authenticated with user/mode
      // still null in this tab — sign it out, the same fail-closed
      // guarantee as every other failure branch. No detail of the exception
      // is ever surfaced to the user.
      if (tokenStillLive()) {
        try {
          await supabase.auth.signOut();
        } catch (thrown) {
          console.error("resumeInviteFromCallback: signOut after unexpected failure also failed:", thrown);
        }
      } else {
        // Stale — never sign out on behalf of a setup that's already gone;
        // treated as a plain handoff candidate, same as a pre-RPC cancellation.
        cancelled = true;
      }
    } finally {
      const stale = cancelled || !tokenStillLive();
      if (unknown) {
        // Hallazgo v6/v7 — terminal: callAcceptStudentInvite's own 2-attempt
        // budget is already exhausted, so this never retries anything
        // further (neither another RPC attempt nor a fresh handoff of the
        // whole flow). If the operation was still live, completeInviteAcceptance
        // already signed out (fail-closed); if it was stale at the checkpoint,
        // no signOut ever ran on behalf of the old setup (Hallazgo v7 punto
        // 4). Never touches the URL/sessionStorage — idempotency means a
        // later, fully independent attempt by this same uid resolves
        // cleanly either way. Also restores pendingCallbackInviteRef
        // (Hallazgo v7 punto 4) so a future SIGNED_IN/TOKEN_REFRESHED event,
        // or another attempt in this same tab, can pick the code back up
        // without depending on a full page reload — never overwriting some
        // other code that might already be there. Ownership-checked mutex
        // release, same as below; checkingProfile only cleared if this
        // setup is still the live one.
        if (inviteCallbackInFlightRef.current === myLifecycleToken) inviteCallbackInFlightRef.current = null;
        if (pendingCallbackInviteRef.current == null) pendingCallbackInviteRef.current = code;
        if (tokenStillLive()) setCheckingProfile(false);
      } else if (structuredErrorConfirmed) {
        // Hallazgo v8 punto 1 — accept_student_invite already ran and
        // definitively rejected the invite (structured_error) before this
        // went stale. Terminal, same as `unknown` above: never retried
        // (retrying would just be rejected again — more importantly, no
        // automatic handoff is ever warranted for an outcome the RPC has
        // already settled), never signs out on behalf of the old setup
        // (any warranted signOut already happened inside
        // completeInviteAcceptance while it was still live — a stale
        // continuation must not repeat it), and never cleans up the URL/
        // sessionStorage from here. Restores pendingCallbackInviteRef
        // instead, so a NEW identity (whichever setup is live now, or
        // whoever signs in next) can decide for itself on a future event —
        // this rejection was specific to the uid/session that attempted it,
        // not necessarily to the code itself.
        if (inviteCallbackInFlightRef.current === myLifecycleToken) inviteCallbackInFlightRef.current = null;
        if (pendingCallbackInviteRef.current == null) pendingCallbackInviteRef.current = code;
        if (tokenStillLive()) setCheckingProfile(false);
      } else if (acceptedConfirmed) {
        // Hallazgo v7/v8 punto 3 — accept_student_invite already succeeded
        // (confirmed at completeInviteAcceptance's own checkpoint, live at
        // that moment) — never call it again. The only thing a stale
        // continuation still owes is the local identity reflection, done
        // via a single, RPC-free reresolve() call. The lifecycle token used
        // for that call is captured fresh, right now (not myLifecycleToken
        // — this continuation is already known to be stale) so the result
        // can be inspected against the SAME baseline it ran under.
        if (inviteCallbackInFlightRef.current === myLifecycleToken) inviteCallbackInFlightRef.current = null;
        const catchUpToken = lifecycleTokenRef.current;
        if (catchUpToken != null) {
          (async () => {
            try {
              const resolvedMode = await reresolve(catchUpToken);
              if (resolvedMode === RESOLUTION_CANCELLED) {
                // The lifecycle changed again during reresolve() itself —
                // no setter here belongs to anything on screen anymore.
                return;
              }
              if (resolvedMode !== "student_portal" && lifecycleTokenRef.current === catchUpToken) {
                // Genuinely resolved to something other than student_portal
                // while STILL the same live setup — surface it rather than
                // leaving the app silently stuck with no explanation and no
                // spinner (never re-invokes accept_student_invite either
                // way — reresolve() never touches that RPC).
                setAccountStatusErrorBoth(true);
                setCheckingProfile(false);
              }
              // resolvedMode === "student_portal": success, nothing further
              // to do — resolveSession's own machinery already applied it.
            } catch (thrown) {
              console.error("resumeInviteFromCallback: immediate re-resolution after confirmed-accept cancellation failed:", thrown);
            }
          })();
        }
      } else {
        // Neither unknown nor an already-confirmed accept — either a real,
        // non-stale outcome (success or a genuine structured rejection,
        // cleared unconditionally below) or a stale "cancelledBeforeRpc"
        // (zero RPC ran at all — see callAcceptStudentInvite/
        // completeInviteAcceptance), safe for a single full handoff.
        if (!stale) {
          try { sessionStorage.removeItem("izi_pending_invite_code"); } catch {}
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("invite");
          cleanUrl.searchParams.delete("invite_callback");
          window.history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
        }
        if (tokenStillLive()) setCheckingProfile(false);
        if (stale) {
          // Released BEFORE handing off — a synchronous retry below (same
          // tick, nothing else can interleave) would otherwise see its own
          // still-held mutex and refuse to do anything, silently swallowing
          // the handoff. Ownership-checked (not an unconditional clear): if
          // some OTHER, later attempt already claimed the mutex under a
          // different token by the time this runs, this must not be the
          // release that clears it out from under them — see the long
          // comment on inviteCallbackInFlightRef's declaration.
          if (inviteCallbackInFlightRef.current === myLifecycleToken) inviteCallbackInFlightRef.current = null;
          if (!isAutomaticRetry && pendingCallbackInviteRef.current == null) {
            // At most ONE automatic handoff, and only ever reached here when
            // zero RPC calls have happened yet (unknown and confirmed-accept
            // are both handled in their own branches above, before this
            // point) — safe to retry the WHOLE flow, including a fresh
            // callAcceptStudentInvite call with its own full 2-attempt
            // budget, under whichever setup ends up live.
            pendingCallbackInviteRef.current = code;
            tryResumePendingInvite(session, true);
          } else {
            // The one automatic handoff was already spent (this WAS the
            // retry, and it too went stale) — never loop. Leave an explicit,
            // recoverable state: the code is still safe to make available
            // again (nothing here ever concluded a genuine failure), but
            // nothing retries it automatically. A future legitimate auth
            // event, or a reload (which re-arms from the URL/sessionStorage
            // this branch never touched), can still pick it up.
            if (pendingCallbackInviteRef.current == null) pendingCallbackInviteRef.current = code;
          }
        }
      }
    }
  };

  // Hallazgo v4 punto 3 — the one place that actually claims a pending
  // invite code and hands it to resumeInviteFromCallback. Called from two
  // places: (1) the onAuthStateChange listener's own branch above, via
  // latestRef and deferred through scheduleDeferred there, for the same
  // reason every other Supabase-touching branch is (avoiding a synchronous
  // re-entrant call into the Supabase client from inside its own event
  // dispatch); (2) resumeInviteFromCallback's own single automatic-handoff
  // path above, called directly — by the time that runs, execution is
  // already several awaits removed from any onAuthStateChange dispatch, so
  // no further deferral is needed there.
  //
  // inviteCallbackInFlightRef is what makes "accept_student_invite never
  // runs concurrently twice for the same code" true even across a stale-
  // setup-A-hands-off-to-live-setup-B recovery: it is a single mutex for the
  // whole provider instance, checked and set here regardless of which of
  // the two call sites (or which setup) is asking.
  const tryResumePendingInvite = (session, isAutomaticRetry = false) => {
    if (inviteCallbackInFlightRef.current != null) return false;
    const code = pendingCallbackInviteRef.current;
    if (!code || !session?.user) return false;
    const myLifecycleToken = lifecycleTokenRef.current;
    if (myLifecycleToken == null) return false;
    inviteCallbackInFlightRef.current = myLifecycleToken;
    // One-shot consumption — the only place this ref is cleared for a
    // genuinely-attempted flow. Restored by resumeInviteFromCallback itself
    // if this specific attempt turns out to be stale before the RPC ran.
    pendingCallbackInviteRef.current = null;
    setCheckingProfile(true);
    resumeInviteFromCallback(code, session, isAutomaticRetry)
      .catch((thrown) => {
        console.error("tryResumePendingInvite: resumeInviteFromCallback failed:", thrown);
      })
      .finally(() => {
        // Ownership-checked — see the long comment on inviteCallbackInFlightRef's
        // declaration for why an unconditional clear here would be wrong.
        if (inviteCallbackInFlightRef.current === myLifecycleToken) inviteCallbackInFlightRef.current = null;
      });
    return true;
  };

  // Phase C.1 audit fix — keeps latestRef current, via useLayoutEffect (see
  // the long comment on latestRef's declaration above for why this and not
  // useEffect). No dependency array: runs after every render, deliberately,
  // since resolveSession/resumeInviteFromCallback/refreshAccountStatus are
  // plain consts with no memoization to depend on.
  useLayoutEffect(() => {
    latestRef.current = { resolveSession, resumeInviteFromCallback, refreshAccountStatus, tryResumePendingInvite };
  });

  const logout = async () => {
    // Bumped first, synchronously, before anything async — invalidates any
    // resolveSession/refreshAccountStatus call currently in flight as early as
    // possible, so a stale response can never land after this and resurrect
    // user/mode/accountStatus that logout just cleared.
    activeResolutionIdRef.current++;
    try {
      await supabase.auth.signOut();
    } catch (thrown) {
      // Phase C.1 audit fix: local state must clear regardless of whether the
      // remote signOut call succeeded, errored, or threw — a network failure
      // here must never leave the user looking logged in locally while the
      // server-side session state is unknown.
      console.error("logout: supabase.auth.signOut failed, clearing local state anyway:", thrown);
    } finally {
      // Cleared here (not just on the next resolveSession) so a re-login by the same
      // user right after logout re-runs full identity resolution instead of being
      // treated as already-resolved.
      resolvedUserIdRef.current = null;
      setUser(null);
      setModeP(null);
      setOnboardedP(false);
      setAccountStatusBoth({ coach: null, student: null });
      setAccountStatusErrorBoth(false);
      // A stale, superseded resolveSession call never reaches its own
      // setCheckingProfile(false) (every branch after the dedupe check is
      // gated behind stillCurrent()) — without resetting it here directly,
      // logging out while a resolution was in flight left the app stuck on
      // the loading screen. resolveSession's own null-session branch resets
      // it too (for session loss that doesn't go through this function at
      // all — an expired/revoked token), but that only runs once the
      // resulting SIGNED_OUT event's deferred handler catches up, at least a
      // tick later; resetting it here as well makes the transition immediate
      // and deterministic for an explicit, user-initiated logout.
      setCheckingProfile(false);
    }
  };

  // For callers that need to re-run identity resolution for the CURRENT
  // session after a server-side change (e.g. accept_student_invite creating
  // a student_auth row, or handleOnboardingComplete's coaches upsert) that
  // resolveSession's own dedupe would otherwise skip (resolvedUserIdRef
  // already matches this uid from an earlier resolution). Always re-reads the
  // real session from Supabase — never takes a session or user object from
  // the caller, so nothing client-supplied can influence what identity gets
  // resolved. Returns resolveSession's own resolved mode (or null) — see
  // resolveSession.js. Callers that need to distinguish an active coach from
  // a blocked/deactivated one (both return "coach") should also read
  // accountStatusRef.current after this resolves.
  // Phase C.1 audit fix — centralized: previously this awaited getSession()
  // with no error handling at all, so a thrown exception (or a resolved
  // {error}) propagated as a rejection from reresolve() itself. Every
  // existing caller already treats anything other than its one expected
  // success literal as failure (completeInviteAcceptance checks
  // resolvedMode!=="student_portal"; handleOnboardingComplete checks
  // resolvedMode!=="coach") — none of them special-case null vs. some other
  // falsy value, so returning null here on a getSession() failure, instead
  // of rejecting, is a strictly safer contract for both without changing
  // either's actual outcome (completeInviteAcceptance's outer catch in
  // acceptInviteWithSession already treated a thrown reresolve() the same
  // way: signOut + {ok:false}).
  // expectedLifecycleToken (Hallazgo 2) — optional. Passed only by the
  // invite-callback chain (resumeInviteFromCallback -> completeInviteAcceptance
  // -> here), carrying the ORIGINAL token resumeInviteFromCallback captured
  // when it started. Every other caller (App.jsx's handleOnboardingComplete,
  // acceptInviteWithSession's direct signup/login path) calls this with no
  // argument.
  //
  // Hallazgo v4 punto 4 — callers that don't pass a token must not be left
  // unprotected: `token` below is auto-captured from whatever's live right
  // now when none was given, exactly the same as an explicitly-passed one,
  // and held as the SAME single baseline for this call's entire lifetime
  // (never re-captured mid-flight, so a remount partway through can't get
  // silently adopted as if this call had started under it). If it's null at
  // the very start, this aborts immediately — no Supabase call, no setter —
  // rather than letting resolveSession discover that later, after a wasted
  // network round trip whose result would only ever be discarded anyway.
  //
  // exposeCancellation controls the PUBLIC contract at the return boundary
  // only, never the internal protection: a caller that explicitly opted in
  // by passing expectedLifecycleToken understands RESOLUTION_CANCELLED and
  // needs the distinction (Hallazgo 4 — completeInviteAcceptance must never
  // treat a torn-down setup as a rejected invitation); a caller that didn't
  // ask for it (App/Onboarding) has no idea the sentinel exists and must
  // never see it — cancellation is translated back to plain `null` for
  // them, the exact same "not the mode I wanted" contract they already
  // handle, while the unmount protection underneath still fully applies:
  // their continuation can never write state after unmount either way.
  const reresolve = async (expectedLifecycleToken) => {
    const exposeCancellation = expectedLifecycleToken !== undefined;
    const token = exposeCancellation ? expectedLifecycleToken : lifecycleTokenRef.current;
    const tokenStillLive = () => token != null && lifecycleTokenRef.current === token;
    const cancelledResult = () => (exposeCancellation ? RESOLUTION_CANCELLED : null);

    // Checkpoint 1/6: before getSession() — "abortar sin Supabase ni
    // setters" when the token is already gone (or was never live).
    if (!tokenStillLive()) return cancelledResult();

    let session;
    try {
      const result = await supabase.auth.getSession();
      // Checkpoint 2/6: immediately after getSession() resolves.
      if (!tokenStillLive()) return cancelledResult();
      if (result.error) {
        console.error("reresolve: getSession failed:", result.error);
        return null;
      }
      session = result.data.session;
    } catch (thrown) {
      // Checkpoint 3/6: inside getSession's catch, before classifying it as
      // a real error — a stale rejection must never be logged/treated as a
      // genuine failure.
      if (!tokenStillLive()) return cancelledResult();
      console.error("reresolve: getSession threw:", thrown);
      return null;
    }

    // Checkpoint 4/6: before clearing resolvedUserIdRef — explicit and
    // separate from checkpoint 2 even though nothing async separates them
    // today, so this stays correct if that ever changes.
    if (!tokenStillLive()) return cancelledResult();
    if (!session?.user) return null;
    resolvedUserIdRef.current = null;
    try {
      const resolved = await resolveSession(session, { expectedLifecycleToken: token });
      // Checkpoint 5/6: after resolveSession() returns. resolveSession's own
      // internal stillCurrent() already refused to touch any state once
      // this became stale (it returns null either way in that case) — but
      // that null is indistinguishable from a genuine failure to a caller
      // that doesn't know about tokens. This caller does, so it reports the
      // distinction honestly via cancelledResult().
      if (!tokenStillLive()) return cancelledResult();
      return resolved;
    } catch (thrown) {
      // Checkpoint 6/6: inside resolveSession's catch, before returning
      // null — same reasoning as checkpoint 3.
      if (!tokenStillLive()) return cancelledResult();
      // Uniform contract for every caller, not just the ones that happen to
      // have their own outer safety net (acceptInviteWithSession's catch
      // already covered completeInviteAcceptance's use of this; this makes
      // it explicit and true for reresolve() itself too) — never throws,
      // null always means failure.
      console.error("reresolve: resolveSession threw:", thrown);
      return null;
    }
  };

  // Everything from "real session confirmed" onward: accept_student_invite,
  // reresolve, requiring a literal "student_portal" outcome, fail-closed
  // signOut on any deviation. Extracted (Frontend-6a) so a caller that
  // already has a session from elsewhere (Frontend-6c's Confirm Email
  // callback path) can reuse this exact tail without going through
  // establishSession — behavior/order unchanged from before the extraction,
  // still called from inside acceptInviteWithSession's own try, still before
  // its finally clears the guard, still covered by its catch (no try/catch
  // added here — an exception here propagates to that same outer catch).
  // `providedSession`, when given (Frontend-6c), is used as-is — the real
  // object Supabase's own onAuthStateChange just delivered, never fabricated
  // — skipping a redundant getSession() call the listener's own event
  // already made unnecessary. Frontend-3/5's call site (no second argument)
  // is unaffected: it still awaits getSession() itself, exactly as before.
  // expectedLifecycleToken (Hallazgo 2) — optional third argument, threaded
  // straight through to reresolve(). Only resumeInviteFromCallback passes
  // this (its own captured token); acceptInviteWithSession's direct
  // signup/login call site below passes nothing.
  //
  // tokenStillLive() below is a no-op (`!exposeCancellation` short-circuits
  // it to always true) whenever expectedLifecycleToken wasn't given — the
  // direct signup/login path keeps its exact prior behavior, unaffected by
  // any of this.
  //
  // Hallazgo v6 — the RPC call itself is fully centralized in
  // callAcceptStudentInvite below (the ONLY call site of accept_student_invite,
  // shared by this function's two callers: resumeInviteFromCallback and
  // acceptInviteWithSession's direct signup/login path — both now get
  // identical, idempotency-backed handling of a transport-level throw).
  const callAcceptStudentInvite = async (code, expectedUid, { expectedLifecycleToken } = {}) => {
    const attempt = async () => {
      try {
        const { data, error } = await supabase.rpc("accept_student_invite", { p_code: code });
        return { threw: false, data, error };
      } catch (thrown) {
        return { threw: true, thrown };
      }
    };
    const classify = (data, error) => {
      if (!error && data?.ok === true) return { outcome: "success", acceptData: data };
      return { outcome: "structured_error", acceptError: error, acceptData: data };
    };
    // Hallazgo v7 punto 1 — shared precondition, checked BEFORE the first
    // attempt AND again before the retry: re-reads the CURRENT session
    // (never trusts a value the caller established earlier) and requires
    // session.user.id === expectedUid EXACTLY, plus — for the invite-
    // callback path only, via expectedLifecycleToken — a still-live
    // lifecycle token. Failing here never counts as, or causes, an RPC
    // attempt.
    const preconditionHolds = async () => {
      let session = null;
      try {
        const result = await supabase.auth.getSession();
        session = result.error ? null : result.data.session;
      } catch (thrown) {
        console.error("callAcceptStudentInvite: getSession precondition check threw:", thrown);
      }
      const sameIdentity = session?.user?.id === expectedUid;
      const lifecycleLive = expectedLifecycleToken === undefined || lifecycleTokenRef.current === expectedLifecycleToken;
      return sameIdentity && lifecycleLive;
    };

    // Hallazgo v7 punto 1 — before the FIRST attempt: zero RPC calls happen
    // at all if this fails. Distinct from "unknown" (below) — that's
    // reserved for when at least one attempt already ran and its outcome is
    // genuinely ambiguous; this is a clean "never even tried".
    if (!(await preconditionHolds())) return { outcome: "not_attempted" };

    const first = await attempt();
    if (!first.threw) return classify(first.data, first.error);

    console.error("callAcceptStudentInvite: accept_student_invite threw on the first attempt:", first.thrown);

    // Before the single retry: same precondition. Failing here does not
    // count as, or cause, a third attempt — it just means the retry never
    // happens, and the first attempt's outcome stays exactly what it
    // already was: genuinely unknown.
    if (!(await preconditionHolds())) return { outcome: "unknown" };

    const second = await attempt();
    if (second.threw) {
      console.error("callAcceptStudentInvite: accept_student_invite threw on the retry too:", second.thrown);
      return { outcome: "unknown" };
    }
    return classify(second.data, second.error);
  };

  const completeInviteAcceptance = async (code, providedSession = null, expectedLifecycleToken) => {
    const exposeCancellation = expectedLifecycleToken !== undefined;
    const tokenStillLive = () =>
      !exposeCancellation || (expectedLifecycleToken != null && lifecycleTokenRef.current === expectedLifecycleToken);

    // Validated on entry, before anything else — nothing has run server-side
    // yet, so this is a plain handoff candidate (Hallazgo v6: "lifecycle
    // stale antes de que empiece la RPC: puede hacerse un único handoff"),
    // never treated as an unknown RPC outcome.
    if (!tokenStillLive()) return { ok: false, cancelled: true };

    const session = providedSession ?? (await supabase.auth.getSession()).data.session;
    if (!tokenStillLive()) return { ok: false, cancelled: true };
    if (!session?.user) {
      await supabase.auth.signOut();
      return { ok: false };
    }

    const acceptResult = await callAcceptStudentInvite(code, session.user.id, {
      expectedLifecycleToken: exposeCancellation ? expectedLifecycleToken : undefined,
    });

    // Hallazgo v7 punto 2 — checkpoint immediately after the RPC sequence,
    // BEFORE interpreting the outcome or running any signOut. A stale
    // continuation must never sign out on behalf of a setup that's already
    // gone, no matter which outcome the RPC sequence produced. Also covers
    // "not_attempted" (Hallazgo v7 punto 1's own precondition failing
    // before even the first attempt) — zero RPC ran.
    //
    // acceptedConfirmed/unknown/structuredErrorConfirmed (Hallazgo v7/v8)
    // are carried on this `cancelled` result specifically so
    // resumeInviteFromCallback never re-invokes accept_student_invite for
    // an outcome that already spent part or all of its 2-attempt budget:
    // acceptedConfirmed=true means the RPC definitely already succeeded (a
    // later handoff must do ONLY reresolve()); unknown=true and
    // structuredErrorConfirmed=true (Hallazgo v8 punto 1) both mean the RPC
    // already produced a definitive-or-exhausted outcome — neither may ever
    // trigger a fresh accept_student_invite call from a stale continuation.
    if (!tokenStillLive() || acceptResult.outcome === "not_attempted") {
      // Hallazgo v8 punto 2 — the direct signup/login path never passes
      // expectedLifecycleToken (tokenStillLive() is unconditionally true
      // for it, so this branch can only be reached here via "not_attempted"
      // itself) and has no idea what `cancelled` means. It only understands
      // {ok:false}: fail closed the same way every other definitive
      // rejection on this path already does, never handing it a lifecycle
      // cancellation it can't interpret.
      if (!exposeCancellation) {
        try {
          await supabase.auth.signOut();
        } catch (thrown) {
          console.error("completeInviteAcceptance: signOut after not_attempted (direct path) failed:", thrown);
        }
        return { ok: false };
      }
      return {
        ok: false,
        cancelled: true,
        acceptedConfirmed: acceptResult.outcome === "success",
        unknown: acceptResult.outcome === "unknown",
        structuredErrorConfirmed: acceptResult.outcome === "structured_error",
      };
    }

    if (acceptResult.outcome === "unknown") {
      // Hallazgo v6/v7 — both attempts (or the retry's own identity/
      // lifecycle precondition) failed to produce a definitive server
      // response. Fail closed exactly like any other genuine failure using
      // the existing mechanism (signOut) — safe here specifically because
      // the checkpoint above just confirmed this operation still belongs to
      // the live lifecycle/uid — but, unlike a genuine structured
      // rejection, never touch the code/URL/sessionStorage: idempotency
      // (see callAcceptStudentInvite) means a LATER, completely independent
      // attempt by this same uid resolves cleanly regardless of whether one
      // of these two attempts actually committed, so the user can simply
      // try again later instead of being told definitively that this failed.
      try {
        await supabase.auth.signOut();
      } catch (thrown) {
        console.error("completeInviteAcceptance: signOut after unknown accept outcome also failed:", thrown);
      }
      return { ok: false, unknown: true };
    }

    if (acceptResult.outcome === "structured_error") {
      // A resolved, structured rejection — the function definitely ran and
      // definitely did not accept the invite. Existing fail-closed
      // behavior, unchanged.
      await supabase.auth.signOut();
      return { ok: false };
    }

    // outcome === "success", and the checkpoint above just confirmed this
    // is still live. Success is only real once identity has actually been
    // re-resolved to student_portal from the student_auth row
    // accept_student_invite just created — reresolve() can itself land on
    // null/a different mode without throwing (e.g. a transient profile-
    // lookup failure inside resolveSession), so its return value, not just
    // it having awaited cleanly, is what this checks. reresolve() owns its
    // own staleness checkpoints; if THIS specific await goes stale, the RPC
    // is nonetheless already confirmed to have succeeded (checkpoint,
    // above) — acceptedConfirmed: true tells resumeInviteFromCallback to
    // recover with ONLY a reresolve(), never a second accept_student_invite
    // call (Hallazgo v7 punto 3 — máximo dos RPC en todo el flujo lógico).
    const resolvedMode = await reresolve(expectedLifecycleToken);
    if (resolvedMode === RESOLUTION_CANCELLED) {
      return { ok: false, cancelled: true, acceptedConfirmed: true };
    }
    if (resolvedMode !== "student_portal") {
      await supabase.auth.signOut();
      return { ok: false };
    }

    return { ok: true };
  };

  // Shared core of both invite-acceptance transactions below. `establishSession`
  // is the only thing that differs between them (signUp vs signInWithPassword) —
  // everything after a real session exists lives in completeInviteAcceptance.
  // The guard is activated as the very first line, before `establishSession`
  // runs — that's what actually closes the race: activating it only after
  // signUp/signInWithPassword leaves a window where their own SIGNED_IN can
  // still resolve prematurely.
  const acceptInviteWithSession = async (establishSession, code) => {
    pendingInviteAcceptRef.current = true;
    try {
      const established = await establishSession();
      if (!established.ok) {
        // pendingEmailConfirmation (Frontend-6b) isn't a failure — signUp
        // succeeded, there's just no session yet (Confirm Email pending), so
        // there's nothing to sign out of and nothing to treat as rejected.
        if (!established.pendingEmailConfirmation) {
          await supabase.auth.signOut();
        }
        return established;
      }

      return await completeInviteAcceptance(code);
    } catch {
      await supabase.auth.signOut();
      return { ok: false };
    } finally {
      // Single, unconditional place this ever clears — guaranteed to run
      // whichever branch above returned, or if anything threw.
      pendingInviteAcceptRef.current = false;
    }
  };

  // AuthFlow only calls these and reacts to {ok}; it never calls signUp/
  // signInWithPassword/the RPC/reresolve/signOut directly for either flow.
  const registerStudentFromInvite = ({ email, password, code }) =>
    acceptInviteWithSession(async () => {
      // Preserves ?invite=CODE across the Confirm Email round trip: built
      // from the current origin/path (never hardcoded), so this works
      // unchanged in dev and prod. Harmless today (Confirm Email OFF) —
      // signUp() still returns a session immediately and this option is
      // simply unused by Supabase in that case.
      const redirectUrl = new URL(window.location.pathname, window.location.origin);
      redirectUrl.searchParams.set("invite", code);
      // Frontend-6e (Hallazgo 2): marks this specific URL as a genuine
      // Confirm Email redirect target — never present on a link a coach
      // actually shares — so pendingCallbackInviteRef only auto-arms from a
      // URL that was built exactly here, not from any ?invite=CODE link.
      // Authorizes nothing by itself; accept_student_invite + reresolve()
      // remain the only real authority.
      redirectUrl.searchParams.set("invite_callback", "1");
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: redirectUrl.toString() },
      });
      if (error) return { ok: false, message: error.message };
      if (!data?.user) return { ok: false, message: "No se pudo crear la cuenta. Verificá que el email no esté en uso." };
      if (!data.session) {
        // Confirm Email ON: the account was created but there's no session
        // yet — this is the expected "check your email" outcome, not a
        // failure. Same-tab backup only (Frontend-6c) — the URL query string
        // baked into emailRedirectTo above is the primary, cross-tab-safe
        // transport; this only helps if the confirmation happens to be
        // opened in this exact tab and the URL round trip somehow didn't
        // carry the code. Carries only the code — never student_id/coach_id/
        // email/mode, and never treated as authority: whoever reads it back
        // still goes through the same RPC + reresolve() as everyone else.
        try { sessionStorage.setItem("izi_pending_invite_code", code); } catch {}
        return { ok: false, pendingEmailConfirmation: true };
      }
      return { ok: true };
    }, code);

  const loginStudentFromInvite = ({ email, password, code }) =>
    acceptInviteWithSession(async () => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, message: error.message };
      if (!data?.user) return { ok: false, message: "No pudimos iniciar sesión." };
      return { ok: true };
    }, code);

  const value = {
    user, mode, onboarded, loadingAuth, checkingProfile, onboardingSaveFailed,
    accountStatus, accountStatusError, accountStatusRef, refreshAccountStatus,
    setUser, setMode: setModeP, setOnboarded: setOnboardedP,
    setCheckingProfile, setLoadingAuth, setOnboardingSaveFailed,
    resolvedUserIdRef, resolveSession, reresolve,
    registerStudentFromInvite, loginStudentFromInvite, logout,
    // Hallazgo v5 punto 4 — exposed read-only so a caller like App.jsx's
    // handleOnboardingComplete can extend its own stillSameIdentity() check
    // with the SAME already-hardened mechanism AuthProvider's own internal
    // continuations use (resolveSession.js, reresolve, resumeInviteFromCallback):
    // resolvedUserIdRef alone survives a real provider unmount unchanged
    // (nothing clears it on cleanup — it must not, or the Strict-Mode dedupe
    // this ref exists for would break), so it cannot by itself distinguish
    // "still the same live provider" from "a real unmount happened and
    // nothing has re-resolved since". lifecycleTokenRef can: it is null
    // exactly while torn down, and a NEW distinct object on every fresh
    // setup (including a Strict-Mode remount) — so comparing it by identity
    // against a value captured at the start of a continuation is exactly
    // the "is the setup I started under still the live one" question,
    // without inventing a second, parallel mechanism that could regress the
    // same way the original disposed-boolean did.
    lifecycleTokenRef,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
