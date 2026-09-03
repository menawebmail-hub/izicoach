import { useState, useEffect, useCallback } from "react";

const ADMIN_ROOT = "/admin";

// Only place in src/admin/ that touches window.location/history. Pages
// receive {route, navigate} from AdminShell and never import this module
// directly — keeps a future swap to a real router contained to this file
// + AdminShell.
export function parseAdminRoute(pathname) {
  const rest = pathname.slice(ADMIN_ROOT.length).replace(/^\/+/, "");
  const parts = rest ? rest.split("/") : [];

  if (parts.length === 0) return { page: "dashboard" };
  if (parts[0] === "coaches") {
    if (parts[1]) return { page: "coach-detail", params: { id: parts[1] } };
    return { page: "coaches" };
  }
  if (parts[0] === "students") {
    if (parts[1] && parts[2]) return { page: "student-detail", params: { coachId: parts[1], studentId: parts[2] } };
    return { page: "students" };
  }
  // Prepared for future modules — no page implements these yet.
  if (parts[0] === "invites") return { page: "invites" };
  if (parts[0] === "logs") return { page: "logs" };

  return { page: "not-found" };
}

// popstate stays reserved for real browser Back/Forward — navigate()
// updates the router's own state directly after pushState, it never
// dispatches a synthetic popstate event.
export function useAdminRoute() {
  const [route, setRoute] = useState(() => parseAdminRoute(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(parseAdminRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((path) => {
    window.history.pushState({}, "", path);
    setRoute(parseAdminRoute(path));
  }, []);

  return { route, navigate };
}
