import { useEffect, useState } from "react";
import { supabase } from "../services/supabaseClient.js";
import { getAdminSession } from "./adminApi.js";
import { AdminAuthGate } from "./AdminAuthGate.jsx";
import { AdminShell } from "./AdminShell.jsx";

// Lifecycle deliberately relies solely on onAuthStateChange's first event
// (INITIAL_SESSION, fired once after the client finishes restoring the
// session from storage) — does NOT also call supabase.auth.getSession()
// independently. AuthProvider.jsx already hit and fixed this exact race in
// the main app: calling getSession() as a second, parallel source of truth
// can resolve "no session" before the client finishes restoring from
// storage, which would show "unauthorized" here even when a valid admin
// session actually exists. Same fix applied, independently — this listener
// shares no code with AuthProvider/resolveSession.
export function AdminApp() {
  const [loading, setLoading] = useState(true);
  const [sessionInfo, setSessionInfo] = useState(null);

  useEffect(() => {
    let firstEventHandled = false;
    let cancelled = false;
    const settleFirstEvent = () => {
      if (!firstEventHandled) { firstEventHandled = true; setLoading(false); }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (cancelled) return;
      if (!session) {
        setSessionInfo({ authenticated: false, is_admin: false });
        settleFirstEvent();
        return;
      }
      const { data, error } = await getAdminSession();
      if (cancelled) return;
      if (error) {
        console.error("admin_get_session error:", error);
        setSessionInfo({ authenticated: false, is_admin: false });
      } else {
        setSessionInfo(data);
      }
      settleFirstEvent();
    });

    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  return (
    <AdminAuthGate loading={loading} sessionInfo={sessionInfo}>
      <AdminShell admin={sessionInfo?.admin} />
    </AdminAuthGate>
  );
}
