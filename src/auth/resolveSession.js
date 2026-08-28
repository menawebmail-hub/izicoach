import { supabase } from "../services/supabaseClient.js";

const lsSet = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

// A profile lookup can transiently fail (401 while a fresh session's auth header is
// still propagating, a network hiccup, an unexpected REST error) — that must never be
// read as "no profile exists". PGRST116 ("0 or >1 rows" from .single()) is the only
// outcome that legitimately means "no match in this table, keep checking" — anything
// else gets exactly one delayed retry before being treated as a real failure.
export const queryProfile = async (table, userId, selectCols) => {
  let result = await supabase.from(table).select(selectCols).eq("id", userId).single();
  if (result.error && result.error.code !== "PGRST116") {
    await new Promise(r => setTimeout(r, 400));
    result = await supabase.from(table).select(selectCols).eq("id", userId).single();
  }
  return result;
};

// Single source of truth for turning a Supabase session into an identity (user, mode,
// onboarded). Used by the auth-state listener (AuthProvider) and by the manual login
// callback (AuthFlow's onLogin), so there is exactly one place that decides what a
// session means. Does not load business data (students/classes/coach profile/etc.) —
// that is App.jsx's responsibility, reacting to the identity this produces, because
// this module has no access to App.jsx's data-state closures.
// resolvedUserIdRef guards against re-running the full resolution (profile fetch) for
// a session already resolved — e.g. TOKEN_REFRESHED for the same user, or the
// SIGNED_IN event that follows a manual login already resolved via onLogin. Only the
// user/token is refreshed in that case.
export const makeResolveSession = ({ resolvedUserIdRef, setUser, setMode, setOnboarded, setCheckingProfile }) => {
  return async (session) => {
    if (!session?.user) {
      resolvedUserIdRef.current = null;
      setUser(null);
      setMode(null);
      setOnboarded(false);
      return;
    }
    const alreadyResolved = resolvedUserIdRef.current === session.user.id;
    setUser(session.user);
    if (alreadyResolved) return;
    resolvedUserIdRef.current = session.user.id;
    setCheckingProfile(true);
    // PGRST116 (0 rows) is a recoverable case, not an error: no coaches row yet
    // (signup never creates one — Fase C) or a genuinely partial account from
    // before onboarding completed. Either way it must fall through to coach_new,
    // never be treated as a lookup failure. Any other error aborts below.
    const { data, error } = await queryProfile("coaches", session.user.id, "name,currency,sport,photo,onboarded");
    if (error && error.code !== "PGRST116") {
      console.error("resolveSession: coach profile lookup failed after retry, not resolving as new user:", error);
      resolvedUserIdRef.current = null;
      setUser(null);
      setCheckingProfile(false);
      return;
    }
    // onboarded===true (not just "row exists") is the only source of truth for
    // "this coach can skip onboarding" — a row that exists with onboarded=false
    // (or missing entirely) is a recoverable partial account, routed to
    // coach_new below exactly like a brand-new signup.
    if (data?.onboarded === true) {
      setMode("coach"); setOnboarded(true);
    } else {
      const { data: sa, error: saErr } = await queryProfile("student_auth", session.user.id, "*");
      if (saErr && saErr.code !== "PGRST116") {
        console.error("resolveSession: student profile lookup failed after retry, not resolving as new user:", saErr);
        resolvedUserIdRef.current = null;
        setUser(null);
        setCheckingProfile(false);
        return;
      }
      if (sa) {
        lsSet("izi_student_coach_id", sa.coach_id);
        localStorage.setItem("izi_student_id_raw", String(sa.student_id));
        setMode("student_portal");
      } else {
        // Confirmed new coach: no profile, no data.
        setMode("coach_new"); setOnboarded(false);
      }
    }
    setCheckingProfile(false);
  };
};
