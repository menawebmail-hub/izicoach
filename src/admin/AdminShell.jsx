import { useState } from "react";
import { supabase } from "../services/supabaseClient.js";
import { useAdminRoute } from "./adminRouter.js";
import { CoachesList } from "./pages/CoachesList.jsx";
import { CoachDetail } from "./pages/CoachDetail.jsx";
import { PlaceholderPage } from "./pages/PlaceholderPage.jsx";
import "./admin.css";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", path: "/admin", implemented: false },
  { key: "coaches", label: "Coaches", path: "/admin/coaches", implemented: true },
  { key: "students", label: "Alumnos", path: "/admin/students", implemented: false },
  { key: "invites", label: "Invitaciones", path: "/admin/invites", implemented: false },
  { key: "logs", label: "Logs / Diagnóstico", path: "/admin/logs", implemented: false },
];

export function AdminShell({ admin }) {
  const { route, navigate } = useAdminRoute();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(null);

  // Same underlying Supabase session as the coach/student app — signing out
  // here ends that session too. AdminApp isn't wrapped in <AuthProvider>, so
  // there's no auth.logout() to reuse; this is the same singleton client
  // AuthProvider itself calls supabase.auth.signOut() on. On success,
  // SIGNED_OUT propagates through AdminApp's own listener — that's still
  // what updates sessionInfo and makes AdminAuthGate unmount this component,
  // not anything done here. On failure, this component stays mounted: the
  // button re-enables and a generic message shows, technical detail only
  // ever goes to console.error.
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("logout error:", error);
      setLogoutError("No pudimos cerrar la sesión. Intentá nuevamente.");
      setLoggingOut(false);
    }
    // No else/finally resetting loggingOut on success — this component is
    // about to unmount once sessionInfo updates, nothing left to reset.
  };

  let content;
  if (route.page === "coaches") {
    content = <CoachesList navigate={navigate} />;
  } else if (route.page === "coach-detail") {
    content = <CoachDetail coachId={route.params.id} navigate={navigate} />;
  } else if (route.page === "students") {
    content = <PlaceholderPage title="Alumnos" />;
  } else if (route.page === "invites") {
    content = <PlaceholderPage title="Invitaciones" />;
  } else if (route.page === "logs") {
    content = <PlaceholderPage title="Logs / Diagnóstico" />;
  } else if (route.page === "dashboard") {
    content = <PlaceholderPage title="Dashboard" />;
  } else {
    content = <PlaceholderPage title="Página no encontrada" />;
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          izi<span style={{ color: "#65CE5A" }}>coach</span> Admin
        </div>
        <nav>
          {NAV_ITEMS.map((item) => {
            const active = route.page === item.key || (item.key === "coaches" && route.page === "coach-detail");
            return (
              <div
                key={item.key}
                className={"admin-nav-item" + (active ? " active" : "") + (item.implemented ? "" : " placeholder")}
                onClick={() => navigate(item.path)}
              >
                <span>{item.label}</span>
                {!item.implemented && <span className="admin-nav-badge">Próximamente</span>}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <div>{admin?.name ? `Hola, ${admin.name}` : "Admin"}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {logoutError && <span className="admin-error-message" style={{ fontSize: 12 }}>{logoutError}</span>}
            <button className="admin-btn-logout" onClick={handleLogout} disabled={loggingOut}>
              {loggingOut ? "Saliendo…" : "Cerrar sesión"}
            </button>
          </div>
        </header>
        <main className="admin-content">{content}</main>
      </div>
    </div>
  );
}
