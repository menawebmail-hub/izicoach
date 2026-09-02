import { useEffect, useState } from "react";
import { getCoach } from "../adminApi.js";

const fmtDate = (v) => (v ? new Date(v).toLocaleString() : "—");

// Talks exclusively to adminApi.getCoach() -> admin_get_coach. Renders only
// what the RPC returns — no raw coach_data, no financial info, no
// edit/suspend/delete/impersonation actions. Read-only.
export function CoachDetail({ coachId, navigate }) {
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

    getCoach(coachId).then(({ data: resp, error: rpcError }) => {
      if (cancelled) return;
      if (rpcError) {
        setError("No pudimos cargar este coach. Reintentá.");
      } else if (!resp?.ok) {
        if (resp?.error === "not_found") setNotFound(true);
        else setError("No pudimos cargar este coach. Reintentá.");
      } else {
        setData(resp);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [coachId]);

  return (
    <div>
      <button className="admin-back-link" onClick={() => navigate("/admin/coaches")}>← Volver a Coaches</button>

      {loading && <div className="admin-state-message">Cargando…</div>}
      {!loading && error && <div className="admin-state-message admin-error-message">{error}</div>}
      {!loading && notFound && <div className="admin-state-message">Coach no encontrado.</div>}

      {!loading && !error && !notFound && data && (
        <>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0D1B4B", marginBottom: 20 }}>{data.coach.name || "Coach"}</h1>

          <div className="admin-card" style={{ marginBottom: 20 }}>
            <div className="admin-detail-grid">
              <div>
                <div className="admin-detail-field-label">Email</div>
                <div className="admin-detail-field-value">{data.coach.email || "—"}</div>
              </div>
              <div>
                <div className="admin-detail-field-label">Teléfono</div>
                <div className="admin-detail-field-value">{data.coach.phone || "—"}</div>
              </div>
              <div>
                <div className="admin-detail-field-label">País</div>
                <div className="admin-detail-field-value">{data.coach.country || "—"}</div>
              </div>
              <div>
                <div className="admin-detail-field-label">Deporte</div>
                <div className="admin-detail-field-value">{data.coach.sport || "—"}</div>
              </div>
              <div>
                <div className="admin-detail-field-label">Onboarding</div>
                <div className="admin-detail-field-value">{data.coach.onboarded ? "Completo" : "Pendiente"}</div>
              </div>
              <div>
                <div className="admin-detail-field-label">Registrado</div>
                <div className="admin-detail-field-value">{fmtDate(data.coach.created_at)}</div>
              </div>
              <div>
                <div className="admin-detail-field-label">Email confirmado</div>
                <div className="admin-detail-field-value">{fmtDate(data.coach.email_confirmed_at)}</div>
              </div>
              <div>
                <div className="admin-detail-field-label">Último acceso</div>
                <div className="admin-detail-field-value">{fmtDate(data.coach.last_sign_in_at)}</div>
              </div>
            </div>
          </div>

          <div className="admin-counters-grid">
            <div className="admin-counter-card">
              <div className="admin-counter-value">{data.counts.students}</div>
              <div className="admin-counter-label">Alumnos</div>
            </div>
            <div className="admin-counter-card">
              <div className="admin-counter-value">{data.counts.class_definitions}</div>
              <div className="admin-counter-label">Clases configuradas</div>
            </div>
            <div className="admin-counter-card">
              <div className="admin-counter-value">{data.counts.students_with_portal}</div>
              <div className="admin-counter-label">Con portal habilitado</div>
            </div>
            <div className="admin-counter-card">
              <div className="admin-counter-value">{data.counts.invites_active}</div>
              <div className="admin-counter-label">Invitaciones activas</div>
            </div>
            <div className="admin-counter-card">
              <div className="admin-counter-value">{data.counts.invites_total}</div>
              <div className="admin-counter-label">Invitaciones totales</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
