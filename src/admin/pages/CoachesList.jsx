import { useEffect, useState } from "react";
import { listCoaches } from "../adminApi.js";

const PAGE_SIZE = 20;

// Talks exclusively to adminApi.listCoaches() -> admin_list_coaches. Never
// queries coaches/coach_data/auth.users/student_auth/invites directly.
export function CoachesList({ navigate }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [onboardedFilter, setOnboardedFilter] = useState(""); // "", "true", "false"
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

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
  }, [search, onboardedFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const onboarded = onboardedFilter === "" ? null : onboardedFilter === "true";

    listCoaches({ search, onboarded, limit: PAGE_SIZE, offset: page * PAGE_SIZE }).then(({ data, error: rpcError }) => {
      if (cancelled) return;
      if (rpcError || !data?.ok) {
        setError("No pudimos cargar los coaches. Reintentá.");
        setResult(null);
      } else {
        setResult(data);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [search, onboardedFilter, page]);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0D1B4B", marginBottom: 16 }}>Coaches</h1>

      <div className="admin-toolbar">
        <input
          className="admin-input"
          placeholder="Buscar por nombre o email..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          className="admin-select"
          value={onboardedFilter}
          onChange={(e) => setOnboardedFilter(e.target.value)}
        >
          <option value="">Todos</option>
          <option value="true">Onboarded</option>
          <option value="false">No onboarded</option>
        </select>
      </div>

      {loading && <div className="admin-state-message">Cargando…</div>}
      {!loading && error && <div className="admin-state-message admin-error-message">{error}</div>}
      {!loading && !error && result && result.coaches.length === 0 && (
        <div className="admin-state-message">No hay coaches que coincidan.</div>
      )}

      {!loading && !error && result && result.coaches.length > 0 && (
        <>
          <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Onboarding</th>
                  <th>Creado</th>
                </tr>
              </thead>
              <tbody>
                {result.coaches.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => navigate("/admin/coaches/" + c.id)}>
                    <td>{c.name || "—"}</td>
                    <td>{c.email || "—"}</td>
                    <td>
                      <span className={"admin-badge-onboarded " + (c.onboarded ? "yes" : "no")}>
                        {c.onboarded ? "Completo" : "Pendiente"}
                      </span>
                    </td>
                    <td>{c.created_at ? new Date(c.created_at).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="admin-pagination">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</button>
            <span>Página {page + 1} de {totalPages} · {result.total} coaches</span>
            <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
          </div>
        </>
      )}
    </div>
  );
}
