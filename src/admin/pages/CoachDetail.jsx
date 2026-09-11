import { useEffect, useState } from "react";
import {
  getCoach,
  adminBlockCoach,
  adminUnblockCoach,
  adminDeactivateCoach,
  adminReactivateCoach,
} from "../adminApi.js";

const fmtDate = (v) => (v ? new Date(v).toLocaleString() : "—");

const COACH_STATUS_LABEL = {
  active: "Activo",
  blocked: "Bloqueado",
  deactivated: "Desactivado",
};

// Valid transitions per current status, per ADMIN-4B's approved matrix:
// active -> block/deactivate, blocked -> unblock/deactivate,
// deactivated -> reactivate only, unknown/absent status -> no actions.
function coachButtonsForStatus(status) {
  if (status === "active") return ["block", "deactivate"];
  if (status === "blocked") return ["unblock", "deactivate"];
  if (status === "deactivated") return ["reactivate"];
  return [];
}

// What admin_get_coach's access.status must read back as, after a
// successful mutation, for the refetch to be considered consistent with
// what the admin just asked for.
const EXPECTED_STATUS_AFTER = {
  block: "blocked",
  unblock: "active",
  deactivate: "deactivated",
  reactivate: "active",
};

const ACTION_META = {
  block: { title: "Bloquear coach", label: "Bloquear", btnClass: "warn", needsReason: true, run: (coachId, reason) => adminBlockCoach(coachId, reason) },
  unblock: { title: "Desbloquear coach", label: "Desbloquear", btnClass: "restore", needsReason: false, run: (coachId) => adminUnblockCoach(coachId) },
  deactivate: { title: "Desactivar coach", label: "Desactivar", btnClass: "danger", needsReason: true, run: (coachId, reason) => adminDeactivateCoach(coachId, reason) },
  reactivate: { title: "Reactivar coach", label: "Reactivar", btnClass: "restore", needsReason: false, run: (coachId) => adminReactivateCoach(coachId) },
};

function describeCoachActionResult(action, resp) {
  if (!resp?.ok) {
    if (resp?.error === "not_found") return { type: "error", message: "Coach no encontrado." };
    if (resp?.error === "is_deactivated") return { type: "error", message: "La cuenta está desactivada — reactivala antes de bloquear o desbloquear." };
    if (resp?.error === "not_deactivated") return { type: "error", message: "La cuenta no está desactivada — no corresponde reactivar." };
    return { type: "error", message: "No pudimos completar la acción. Reintentá." };
  }
  if (action === "block") return { type: "success", message: resp.already_blocked ? "La cuenta ya estaba bloqueada." : "Coach bloqueado correctamente." };
  if (action === "unblock") return { type: "success", message: resp.already_active ? "La cuenta ya estaba activa." : "Coach desbloqueado correctamente." };
  if (action === "deactivate") return { type: "success", message: resp.already_deactivated ? "La cuenta ya estaba desactivada." : "Coach desactivado correctamente." };
  return { type: "success", message: resp.already_active ? "La cuenta ya estaba activa." : "Coach reactivado correctamente." };
}

// Talks to adminApi.getCoach() -> admin_get_coach for the read-only profile
// (no raw coach_data, no financial info, no edit/delete/impersonation
// actions beyond access control) plus, ADMIN-4B, the four coach
// access-control mutation RPCs (admin_block_coach/admin_unblock_coach/
// admin_deactivate_coach/admin_reactivate_coach). admin_get_coach returns a
// real 'access' object ({status, status_reason, status_changed_at}) sourced
// from coach_access_control — the button set below is derived exclusively
// from that server-reported status, never inferred or updated optimistically:
// after every successful mutation this component re-runs admin_get_coach,
// validates the returned status actually matches the action just taken, and
// renders only what came back either way.
export function CoachDetail({ coachId, navigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState(null);

  const [pendingAction, setPendingAction] = useState(null); // null | "block" | "unblock" | "deactivate" | "reactivate"
  const [reasonInput, setReasonInput] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState(null); // { type, message } | null

  const openConfirm = (action) => {
    setPendingAction(action);
    setReasonInput("");
    setActionResult(null);
  };

  const cancelConfirm = () => {
    setPendingAction(null);
    setReasonInput("");
  };

  // Re-runs admin_get_coach and replaces `data` wholesale with whatever it
  // returns — the only source of truth for the access badge/buttons.
  // Returns { ok: true, data: resp } on success or an explicit
  // { ok: false } on any failure (transport error, business rejection, or
  // thrown exception) — callers must check `ok` rather than assume success.
  const refetchCoach = async () => {
    try {
      const { data: resp, error: rpcError } = await getCoach(coachId);
      if (rpcError) {
        setError("No pudimos cargar este coach. Reintentá.");
        setData(null);
        return { ok: false };
      }
      if (!resp?.ok) {
        if (resp?.error === "not_found") { setNotFound(true); setData(null); }
        else { setError("No pudimos cargar este coach. Reintentá."); setData(null); }
        return { ok: false };
      }
      setError(null);
      setNotFound(false);
      setData(resp);
      return { ok: true, data: resp };
    } catch (e) {
      console.error("refetchCoach threw:", e);
      setError("No pudimos cargar este coach. Reintentá.");
      setData(null);
      return { ok: false };
    }
  };

  const runAction = async () => {
    if (!pendingAction || actionLoading) return;
    const action = pendingAction; // captured before any await — pendingAction
                                   // itself may be cleared below mid-flight
    const meta = ACTION_META[action];
    const trimmedReason = reasonInput.trim();
    if (meta.needsReason && trimmedReason.length === 0) return;

    setActionLoading(true);
    try {
      const { data: resp, error: rpcError } = await meta.run(coachId, trimmedReason || undefined);

      if (rpcError) {
        // Transport-level failure: keep the confirmation open with the
        // reason the admin already typed, so retrying doesn't require
        // retyping it.
        console.error(action + " error:", rpcError);
        setActionResult({ type: "error", message: "No pudimos completar la acción. Reintentá." });
        return;
      }

      // The RPC call itself succeeded (a real response came back, whether
      // it granted the action or rejected it) — close the confirmation and
      // clear the reason now; nothing left to retry with it.
      setPendingAction(null);
      setReasonInput("");
      setActionResult(describeCoachActionResult(action, resp));

      if (resp?.ok) {
        const refetch = await refetchCoach();
        if (!refetch.ok) {
          setActionResult({ type: "error", message: "La acción se aplicó, pero no pudimos confirmar el nuevo estado. Recargá la página." });
          return;
        }
        const actualStatus = refetch.data?.access?.status;
        if (actualStatus !== EXPECTED_STATUS_AFTER[action]) {
          setActionResult({
            type: "error",
            message: "La acción se ejecutó, pero el estado devuelto por el servidor (" + (actualStatus ?? "desconocido") + ") no coincide con lo esperado. Se muestra el estado real.",
          });
        }
      }
    } catch (e) {
      console.error(action + " threw:", e);
      setActionResult({ type: "error", message: "No pudimos completar la acción. Reintentá." });
    } finally {
      setActionLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setData(null);
    setPendingAction(null);
    setReasonInput("");
    setActionResult(null);

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

  const canConfirm = pendingAction != null && (!ACTION_META[pendingAction].needsReason || reasonInput.trim().length > 0);
  const statusLabel = data?.access ? COACH_STATUS_LABEL[data.access.status] : null;
  const coachDisplayName = data?.coach?.name || data?.coach?.email || "este coach";

  return (
    <div>
      <button type="button" className="admin-back-link" onClick={() => navigate("/admin/coaches")}>← Volver a Coaches</button>

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

          <div className="admin-card" style={{ marginTop: 20 }}>
            <div className="admin-detail-field-label" style={{ marginBottom: 8 }}>Acceso de la cuenta</div>

            {statusLabel ? (
              <div style={{ marginBottom: 16 }}>
                <span className={"admin-status-badge " + data.access.status}>{statusLabel}</span>
                {data.access.status_reason && (
                  <div className="admin-access-reason">Motivo: {data.access.status_reason}</div>
                )}
              </div>
            ) : (
              <div className="admin-state-message admin-error-message" style={{ padding: "12px 0", textAlign: "left" }}>
                Estado de acceso desconocido. No se muestran acciones.
              </div>
            )}

            {!pendingAction && !actionLoading && statusLabel && (
              <div className="admin-action-row">
                {coachButtonsForStatus(data.access.status).map((action) => (
                  <button
                    key={action}
                    type="button"
                    className={"admin-btn-action " + ACTION_META[action].btnClass}
                    onClick={() => openConfirm(action)}
                  >
                    {ACTION_META[action].label}
                  </button>
                ))}
              </div>
            )}

            {!pendingAction && actionLoading && (
              <div className="admin-access-note">Actualizando estado…</div>
            )}

            {pendingAction && (
              <div className="admin-action-confirm">
                <div className="admin-action-confirm-title">{ACTION_META[pendingAction].title} — confirmar</div>
                <div className="admin-access-reason" style={{ marginTop: 0, marginBottom: 12 }}>
                  Se aplicará sobre: <strong>{coachDisplayName}</strong>
                </div>
                {ACTION_META[pendingAction].needsReason && (
                  <>
                    <label htmlFor="coach-access-reason" className="admin-detail-field-label" style={{ display: "block" }}>
                      Motivo (obligatorio)
                    </label>
                    <textarea
                      id="coach-access-reason"
                      className="admin-textarea"
                      placeholder="Motivo (obligatorio)"
                      value={reasonInput}
                      onChange={(e) => setReasonInput(e.target.value)}
                      disabled={actionLoading}
                      aria-required="true"
                    />
                  </>
                )}
                <div className="admin-action-confirm-buttons">
                  <button type="button" className="admin-btn-confirm" onClick={runAction} disabled={actionLoading || !canConfirm}>
                    {actionLoading ? "Aplicando…" : "Confirmar"}
                  </button>
                  <button type="button" className="admin-btn-logout" onClick={cancelConfirm} disabled={actionLoading}>Cancelar</button>
                </div>
              </div>
            )}

            {actionResult && (
              <div className={"admin-action-result " + actionResult.type} aria-live="polite">{actionResult.message}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
