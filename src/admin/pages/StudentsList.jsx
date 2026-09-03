import { useEffect, useState } from "react";
import { listStudents, listCoaches } from "../adminApi.js";

const PAGE_SIZE = 20;

// Talks exclusively to adminApi.listStudents() -> admin_list_students, plus
// adminApi.listCoaches() to populate the coach filter dropdown. Never
// queries coach_data/student_auth/invites/messages/families directly.
export function StudentsList({ navigate }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [coachFilter, setCoachFilter] = useState(""); // "" or a coach id
  const [portalFilter, setPortalFilter] = useState(""); // "", "true", "false"
  const [statusFilter, setStatusFilter] = useState(""); // "", "active", "inactive"
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [coaches, setCoaches] = useState([]);

  // Populates the coach filter dropdown once — a plain flat list is fine at
  // current scale (11 coaches as of the Admin-3 data check).
  useEffect(() => {
    listCoaches({ limit: 100 }).then(({ data, error: rpcError }) => {
      if (!rpcError && data?.ok) setCoaches(data.coaches);
    });
  }, []);

  // Debounce the raw input (300ms) before it becomes the actual search
  // term that triggers a request — avoids one RPC call per keystroke
  // without adding any new infrastructure.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any filter change goes back to the first page.
  useEffect(() => {
    setPage(0);
  }, [search, coachFilter, portalFilter, statusFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const portal = portalFilter === "" ? null : portalFilter === "true";

    listStudents({
      search,
      coachId: coachFilter || null,
      portal,
      status: statusFilter || null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }).then(({ data, error: rpcError }) => {
      if (cancelled) return;
      if (rpcError || !data?.ok) {
        setError("No pudimos cargar los alumnos. Reintentá.");
        setResult(null);
      } else {
        setResult(data);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [search, coachFilter, portalFilter, statusFilter, page]);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0D1B4B", marginBottom: 16 }}>Alumnos</h1>

      <div className="admin-toolbar">
        <input
          className="admin-input"
          placeholder="Buscar por nombre o email..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          className="admin-select"
          value={coachFilter}
          onChange={(e) => setCoachFilter(e.target.value)}
        >
          <option value="">Todos los coaches</option>
          {coaches.map((c) => (
            <option key={c.id} value={c.id}>{c.name || c.email || c.id}</option>
          ))}
        </select>
        <select
          className="admin-select"
          value={portalFilter}
          onChange={(e) => setPortalFilter(e.target.value)}
        >
          <option value="">Portal: todos</option>
          <option value="true">Conectado</option>
          <option value="false">Sin acceso</option>
        </select>
        <select
          className="admin-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Estado: todos</option>
          <option value="active">Activo</option>
          <option value="inactive">Inactivo</option>
        </select>
      </div>

      {loading && <div className="admin-state-message">Cargando…</div>}
      {!loading && error && <div className="admin-state-message admin-error-message">{error}</div>}
      {!loading && !error && result && result.students.length === 0 && (
        <div className="admin-state-message">No hay alumnos que coincidan.</div>
      )}

      {!loading && !error && result && result.students.length > 0 && (
        <>
          <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Coach</th>
                  <th>Email</th>
                  <th>Teléfono</th>
                  <th>Portal</th>
                  <th>Estado</th>
                  <th>Familia</th>
                </tr>
              </thead>
              <tbody>
                {result.students.map((s) => (
                  <tr
                    key={s.coach_id + ":" + s.student_id}
                    className="clickable"
                    onClick={() => navigate("/admin/students/" + s.coach_id + "/" + s.student_id)}
                  >
                    <td>{s.name || "—"}</td>
                    <td>{s.coach_name || "—"}</td>
                    <td>{s.email || "—"}</td>
                    <td>{s.phone || "—"}</td>
                    <td>
                      <span className={"admin-badge-onboarded " + (s.has_portal ? "yes" : "no")}>
                        {s.has_portal ? "Conectado" : "Sin acceso"}
                      </span>
                    </td>
                    <td>{s.status === "active" ? "Activo" : "Inactivo"}</td>
                    <td>{s.family_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="admin-pagination">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</button>
            <span>Página {page + 1} de {totalPages} · {result.total} alumnos</span>
            <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
          </div>
        </>
      )}
    </div>
  );
}
