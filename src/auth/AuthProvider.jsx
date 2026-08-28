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

  // Auth restoration relies solely on onAuthStateChange's INITIAL_SESSION event (fired
  // once, right after the client loads the session from storage) instead of a separate
  // getSession() call — calling both raced, and getSession() could resolve with a stale
  // "no session" result before the client finished restoring, showing the login screen
  // even though a valid session existed (fixed by a manual refresh, which re-ran the race
  // and usually won it). loadingAuth now only clears after this listener's first event.
  useEffect(() => {
    let firstEventHandled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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

  const value = {
    user, mode, onboarded, loadingAuth, checkingProfile, onboardingSaveFailed,
    setUser, setMode: setModeP, setOnboarded: setOnboardedP,
    setCheckingProfile, setLoadingAuth, setOnboardingSaveFailed,
    resolvedUserIdRef, resolveSession, logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
