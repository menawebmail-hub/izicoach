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

  // Auth restoration relies solely on onAuthStateChange's INITIAL_SESSION event (fired
  // once, right after the client loads the session from storage) instead of a separate
  // getSession() call — calling both raced, and getSession() could resolve with a stale
  // "no session" result before the client finished restoring, showing the login screen
  // even though a valid session existed (fixed by a manual refresh, which re-ran the race
  // and usually won it). loadingAuth now only clears after this listener's first event.
  useEffect(() => {
    let firstEventHandled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (pendingInviteAcceptRef.current && session?.user) {
        // registerStudentFromInvite() is already in flight for this exact
        // session and calls reresolve() itself once accept_student_invite's
        // outcome is known — skip so this intermediate event never resolves
        // the account prematurely. Not touching user/mode/loadingAuth here is
        // deliberate: this can only fire while AuthFlow (the only caller of
        // registerStudentFromInvite) is already mounted, which requires the
        // very first auth event to have already resolved — so loadingAuth is
        // already false and there is nothing to settle.
        return;
      }
      resolveSession(session).finally(() => {
        if (!firstEventHandled) { firstEventHandled = true; setLoadingAuth(false); }
      });
    });
    return () => subscription.unsubscribe();
  }, []);

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

  // Shared core of both invite-acceptance transactions below. `establishSession`
  // is the only thing that differs between them (signUp vs signInWithPassword) —
  // everything from "real session confirmed" onward (accept_student_invite,
  // reresolve, requiring a literal "student_portal" outcome, fail-closed
  // signOut on any deviation) is identical, so it lives here exactly once.
  // The guard is activated as the very first line, before `establishSession`
  // runs — that's what actually closes the race: activating it only after
  // signUp/signInWithPassword leaves a window where their own SIGNED_IN can
  // still resolve prematurely.
  const acceptInviteWithSession = async (establishSession, code) => {
    pendingInviteAcceptRef.current = true;
    try {
      const established = await establishSession();
      if (!established.ok) {
        await supabase.auth.signOut();
        return established;
      }

      const { data: { session } } = await supabase.auth.getSession();
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
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { ok: false, message: error.message };
      if (!data?.user) return { ok: false, message: "No se pudo crear la cuenta. Verificá que el email no esté en uso." };
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
