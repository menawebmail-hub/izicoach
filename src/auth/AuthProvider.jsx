import { useEffect, useRef, useState } from "react";
import { supabase } from "../services/supabaseClient.js";
import { makeResolveSession } from "./resolveSession.js";
import { AuthContext } from "./AuthContext.js";

const ls = (key, def) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; } };
const lsSet = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [checkingProfile, setCheckingProfile] = useState(false);
  const [mode, setMode] = useState(null);
  const [onboarded, setOnboarded] = useState(() => ls("izi_onboarded", false));
  const [onboardingSaveFailed, setOnboardingSaveFailed] = useState(false);
  const resolvedUserIdRef = useRef(null);

  const setModeP = (v) => { setMode(v); lsSet("izi_mode", v); };
  const setOnboardedP = (v) => { setOnboarded(v); lsSet("izi_onboarded", v); };

  const resolveSession = makeResolveSession({
    resolvedUserIdRef,
    setUser,
    setMode: setModeP,
    setOnboarded: setOnboardedP,
    setCheckingProfile,
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

  // Auth restoration relies solely on onAuthStateChange's INITIAL_SESSION event (fired
  // once, right after the client loads the session from storage) instead of a separate
  // getSession() call — calling both raced, and getSession() could resolve with a stale
  // "no session" result before the client finished restoring, showing the login screen
  // even though a valid session existed (fixed by a manual refresh, which re-ran the race
  // and usually won it). loadingAuth now only clears after this listener's first event.
  useEffect(() => {
    let firstEventHandled = false;
    const settleFirstEvent = () => {
      if (!firstEventHandled) { firstEventHandled = true; setLoadingAuth(false); }
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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
      if (pendingCallbackInviteRef.current && session?.user) {
        // Returning from a Confirm Email link (or, harmlessly, any other
        // session-bearing event in a tab that still has ?invite= armed and
        // unconsumed). One-shot: cleared synchronously here, before any
        // await, so a second event arriving before resumeInviteFromCallback
        // finishes can never re-match this branch for the same code.
        const code = pendingCallbackInviteRef.current;
        pendingCallbackInviteRef.current = null;
        settleFirstEvent();
        resumeInviteFromCallback(code, session);
        return;
      }
      resolveSession(session).finally(settleFirstEvent);
    });
    return () => subscription.unsubscribe();
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
  const resumeInviteFromCallback = async (code, session) => {
    // Keeps the app on its existing neutral loading screen (App.jsx already
    // gates render on checkingProfile) for the whole RPC+reresolve round
    // trip — otherwise user/mode both being momentarily null here would flash
    // the plain login screen before landing on student_portal (or back on
    // login again, on failure).
    setCheckingProfile(true);
    try {
      await completeInviteAcceptance(code, session);
    } catch {
      // Frontend-6e (Hallazgo 1): completeInviteAcceptance itself has no
      // try/catch (by design, so acceptInviteWithSession's own catch covers
      // it there) — this is the equivalent for this second entry point. An
      // unexpected throw here (e.g. the RPC call itself failing at the
      // network level, not just resolving with {error}) must not leave a
      // real Supabase session sitting authenticated with user/mode still
      // null in this tab — sign it out so the fail-closed guarantee holds
      // the same way it does for every other failure branch. No detail of
      // the exception is ever surfaced to the user.
      await supabase.auth.signOut();
    } finally {
      // Cleared unconditionally (success or failure) — see the design note
      // about not leaving a failed attempt behind to silently retry on a
      // later reload of this same URL.
      try { sessionStorage.removeItem("izi_pending_invite_code"); } catch {}
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("invite");
      cleanUrl.searchParams.delete("invite_callback");
      window.history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
      setCheckingProfile(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    // Cleared here (not just on the next resolveSession) so a re-login by the same
    // user right after logout re-runs full identity resolution instead of being
    // treated as already-resolved.
    resolvedUserIdRef.current = null;
    setUser(null);
    setModeP(null);
    setOnboardedP(false);
  };

  // For callers that need to re-run identity resolution for the CURRENT
  // session after a server-side change (e.g. accept_student_invite creating
  // a student_auth row) that resolveSession's own dedupe would otherwise skip
  // (resolvedUserIdRef already matches this uid from an earlier resolution).
  // Always re-reads the real session from Supabase — never takes a session or
  // user object from the caller, so nothing client-supplied can influence
  // what identity gets resolved. Returns resolveSession's own resolved mode
  // (or null) — see resolveSession.js.
  const reresolve = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;
    resolvedUserIdRef.current = null;
    return await resolveSession(session);
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
  const completeInviteAcceptance = async (code, providedSession = null) => {
    const session = providedSession ?? (await supabase.auth.getSession()).data.session;
    if (!session?.user) {
      await supabase.auth.signOut();
      return { ok: false };
    }

    const { data: acceptData, error: acceptError } = await supabase.rpc("accept_student_invite", { p_code: code });
    if (acceptError || !acceptData?.ok) {
      await supabase.auth.signOut();
      return { ok: false };
    }

    // Success is only real once identity has actually been re-resolved to
    // student_portal from the student_auth row accept_student_invite just
    // created — reresolve() can itself land on null/a different mode
    // without throwing (e.g. a transient profile-lookup failure inside
    // resolveSession), so its return value, not just it having awaited
    // cleanly, is what this checks.
    const resolvedMode = await reresolve();
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
    setUser, setMode: setModeP, setOnboarded: setOnboardedP,
    setCheckingProfile, setLoadingAuth, setOnboardingSaveFailed,
    resolvedUserIdRef, resolveSession, reresolve,
    registerStudentFromInvite, loginStudentFromInvite, logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
