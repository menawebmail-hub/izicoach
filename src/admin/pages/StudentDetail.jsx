import { useEffect, useState } from "react";
import { getStudent } from "../adminApi.js";

const fmtDate = (v) => (v ? new Date(v).toLocaleString() : "—");

// Talks exclusively to adminApi.getStudent() -> admin_get_student. Renders
// only what the RPC returns — no combos, no classes, no payments, no
// invite code, no message content, no edit/delete/portal-management
// actions. Read-only.
export function StudentDetail({ coachId, studentId, navigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setData(null);

    getStudent(coachId, studentId).then(({ data: resp, error: rpcError }) => {
      if (cancelled) return;
      if (rpcError) {
        setError("No pudimos cargar este alumno. Reintentá.");
      } else if (!resp?.ok) {
        if (resp?.error === "not_found") setNotFound(true);
        else setError("No pudimos cargar este alumno. Reintentá.");
      } else {
        setData(resp);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [coachId, studentId]);

  return (
    <div>
      <button className="admin-back-link" onClick={() => navigate("/admin/students")}>← Volver a Alumnos</button>

      {loading && <div className="admin-state-message">Cargando…</div>}
      {!loading && error && <div className="admin-state-message admin-error-message">{error}</div>}
      {!loading && notFound && (
        <div className="admin-state-message">
          Alumno no encontrado. Puede haber sido eliminado del roster del coach.
        </div>
      )}

      {!loading && !error && !notFound && data && (
        <>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0D1B4B", marginBottom: 20 }}>{data.student.name || "Alumno"}</h1>

          <div className="admin-card" style={{ marginBottom: 20 }}>
            <div className="admin-detail-grid">
              <div>
                <div className="admin-detail-field-label">Estado</div>
                <div className="admin-detail-field-value">{data.student.status === "active" ? "Activo" : "Inactivo"}</div>
              </div>
              <div>
                <div className="admin-detail-field-label">Coach</div>
                <div className="admin-detail-field-value">
                  <span style={{ color: "#1A3DB5", cursor: "pointer" }} onClick={() => navigate("/admin/coaches/" + data.coach.id)}>
                    {data.coach.name || "—"}
                  </span>
                </div>
              </div>
              <div>
                <div className="admin-detail-field-label">Email</div>
                <div className="admin-detail-field-value">{data.student.email || "—"}</div>
              </div>
              <div>
                <div className="admin-detail-field-label">Teléfono</div>
                <div className="admin-detail-field-value">{data.student.phone || "—"}</div>
              </div>
              <div>
                <div className="admin-detail-field-label">Familia</div>
                <div className="admin-detail-field-value">{data.family?.name || "—"}</div>
              </div>
              <div>
                <div className="admin-detail-field-label">Portal</div>
                <div className="admin-detail-field-value">{data.portal.connected ? "Conectado" : "Sin acceso"}</div>
              </div>
              <div>
                <div className="admin-detail-field-label">Email confirmado</div>
                <div className="admin-detail-field-value">{data.portal.connected ? fmtDate(data.portal.email_confirmed_at) : "—"}</div>
              </div>
              <div>
                <div className="admin-detail-field-label">Último acceso</div>
                <div className="admin-detail-field-value">{data.portal.connected ? fmtDate(data.portal.last_sign_in_at) : "—"}</div>
              </div>
            </div>
          </div>

          <div className="admin-counters-grid">
            <div className="admin-counter-card">
              <div className="admin-counter-value">{data.diagnostics.invite_active ? "Sí" : "No"}</div>
              <div className="admin-counter-label">Invitación activa</div>
            </div>
            <div className="admin-counter-card">
              <div className="admin-counter-value">{data.diagnostics.message_count}</div>
              <div className="admin-counter-label">Mensajes</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
