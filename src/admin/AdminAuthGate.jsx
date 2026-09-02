import { useState } from "react";
import { supabase } from "../services/supabaseClient.js";
import { AdminLogin } from "./AdminLogin.jsx";
import "./admin.css";

// AdminApp owns the session lifecycle (loading/sessionInfo) — this decides
// which of the 4 states to render from that alone:
//   loading                                   -> "Cargando…"
//   !sessionInfo.authenticated                -> AdminLogin
//   authenticated && !sessionInfo.is_admin     -> "Acceso no autorizado" (+ logout)
//   authenticated && is_admin                  -> children (AdminShell)
// AdminShell never renders just because a Supabase session exists — only
// once is_admin is confirmed true.
//
// The only Supabase call here is signOut() for the "not admin" case — same
// async/disabled-button/generic-error pattern already used in AdminShell's
// logout. SIGNED_OUT still does the actual work: it flips
// sessionInfo.authenticated to false in AdminApp, which re-renders this
// into the AdminLogin branch — this handler never redirects manually.
export function AdminAuthGate({ loading, sessionInfo, children }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(null);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("logout error:", error);
      setLogoutError("No pudimos cerrar la sesión. Intentá nuevamente.");
      setLoggingOut(false);
    } else {
      // SIGNED_OUT (via AdminApp's listener, untouched) is still what
      // actually flips sessionInfo.authenticated and moves this to the
      // AdminLogin branch — this reset only clears local UI state so it
      // doesn't linger stale if AdminAuthGate stays mounted (it never
      // unmounts on its own, unlike AdminShell's logout).
      setLoggingOut(false);
      setLogoutError(null);
    }
  };

  if (loading) {
    return (
      <div className="admin-auth-wrap">
        <div className="admin-auth-card">Cargando…</div>
      </div>
    );
  }

  if (!sessionInfo?.authenticated) {
    return <AdminLogin />;
  }

  if (!sessionInfo?.is_admin) {
    return (
      <div className="admin-auth-wrap">
        <div className="admin-auth-card">
          <div className="admin-auth-title">Acceso no autorizado</div>
          <div className="admin-auth-text">No tenés permisos de administrador para ver esta sección.</div>
          {logoutError && <div className="admin-error-message" style={{ fontSize: 13, marginBottom: 8 }}>{logoutError}</div>}
          <button className="admin-btn-logout" onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? "Saliendo…" : "Cerrar sesión"}
          </button>
        </div>
      </div>
    );
  }

  return children;
}
