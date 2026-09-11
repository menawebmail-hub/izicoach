import { useEffect, useState } from "react";
import { getStudent, adminBlockStudent, adminUnblockStudent } from "../adminApi.js";

const fmtDate = (v) => (v ? new Date(v).toLocaleString() : "—");

const STUDENT_STATUS_LABEL = {
  active: "Activo",
  blocked: "Bloqueado",
};

// Valid transitions per current status, per ADMIN-4B's approved matrix:
// active -> block, blocked -> unblock, unknown status -> no actions. A
// portal that doesn't exist at all (access.available === false) is a
// separate, valid state handled by classifyStudentAccess, not here.
function studentButtonsForStatus(status) {
  if (status === "active") return ["block"];
  if (status === "blocked") return ["unblock"];
  return [];
}

// What admin_get_student's access.status must read back as, after a
// successful mutation, for the refetch to be considered consistent with
// what the admin just asked for.
const EXPECTED_STATUS_AFTER = {
  block: "blocked",
  unblock: "active",
};

// Explicitly distinguishes "no portal contract at all" (malformed/missing
// access object — treated as an error, never silently as "no access") from
// the three real, valid states the contract can report. Never collapse
// "access absent" and "access.available === false" into the same branch —
// they mean different things (one is a bug/contract mismatch, the other is
// a legitimate account that never had a portal identity).
function classifyStudentAccess(access) {
  if (!access || typeof access.available !== "boolean") return { kind: "unknown" };
  if (access.available === false) return { kind: "no_portal" };
  const label = STUDENT_STATUS_LABEL[access.status];
  if (!label) return { kind: "unknown" };
  return { kind: "ok", label };
}

const ACTION_META = {
  block: { title: "Bloquear portal del alumno", label: "Bloquear", btnClass: "warn", needsReason: true, run: (coachId, studentId, reason) => adminBlockStudent(coachId, studentId, reason) },
  unblock: { title: "Desbloquear portal del alumno", label: "Desbloquear", btnClass: "restore", needsReason: false, run: (coachId, studentId) => adminUnblockStudent(coachId, studentId) },
};

function describeStudentActionResult(action, resp) {
  if (!resp?.ok) {
    if (resp?.error === "not_found") return { type: "error", message: "Alumno no encontrado." };
    return { type: "error", message: "No pudimos completar la acción. Reintentá." };
  }
  if (action === "block") return { type: "success", message: resp.already_blocked ? "El portal ya estaba bloqueado." : "Portal del alumno bloqueado correctamente." };
  return { type: "success", message: resp.already_active ? "El portal ya estaba activo." : "Portal del alumno desbloqueado correctamente." };
}

// Talks to adminApi.getStudent() -> admin_get_student for the read-only
// profile (no combos, no classes, no payments, no invite code, no message
// content, no edit/delete actions beyond access control) plus, ADMIN-4B,
// the two student portal access-control mutation RPCs
// (admin_block_student/admin_unblock_student). admin_get_student returns a
// real 'access' object ({available, status, status_reason,
// status_changed_at}) sourced from student_access_control via student_auth
// — the button set below is derived exclusively from that server-reported
// state (via classifyStudentAccess, which never conflates "no portal" with
// "malformed/absent contract"), never inferred or updated optimistically:
// after every successful mutation this component re-runs admin_get_student,
// validates the returned status actually matches the action just taken, and
// renders only what came back either way.
export function StudentDetail({ coachId, studentId, navigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState(null);

  const [pendingAction, setPendingAction] = useState(null); // null | "block" | "unblock"
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

  // Re-runs admin_get_student and replaces `data` wholesale with whatever
  // it returns — the only source of truth for the access badge/buttons.
  // Returns { ok: true, data: resp } on success or an explicit
  // { ok: false } on any failure (transport error, business rejection, or
  // thrown exception) — callers must check `ok` rather than assume success.
  const refetchStudent = async () => {
    try {
      const { data: resp, error: rpcError } = await getStudent(coachId, studentId);
      if (rpcError) {
        setError("No pudimos cargar este alumno. Reintentá.");
        setData(null);
        return { ok: false };
      }
      if (!resp?.ok) {
        if (resp?.error === "not_found") { setNotFound(true); setData(null); }
        else { setError("No pudimos cargar este alumno. Reintentá."); setData(null); }
        return { ok: false };
      }
      setError(null);
      setNotFound(false);
      setData(resp);
      return { ok: true, data: resp };
    } catch (e) {
      console.error("refetchStudent threw:", e);
      setError("No pudimos cargar este alumno. Reintentá.");
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
      const { data: resp, error: rpcError } = await meta.run(coachId, studentId, trimmedReason || undefined);

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
      setActionResult(describeStudentActionResult(action, resp));

      if (resp?.ok) {
        const refetch = await refetchStudent();
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

  const canConfirm = pendingAction != null && (!ACTION_META[pendingAction].needsReason || reasonInput.trim().length > 0);
  const accessInfo = data ? classifyStudentAccess(data.access) : { kind: "unknown" };
  const studentDisplayName = data?.student?.name || data?.student?.email || "este alumno";

  return (
    <div>
      <button type="button" className="admin-back-link" onClick={() => navigate("/admin/students")}>← Volver a Alumnos</button>

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

          <div className="admin-card" style={{ marginTop: 20 }}>
            <div className="admin-detail-field-label" style={{ marginBottom: 8 }}>Acceso al portal</div>

            {accessInfo.kind === "no_portal" && (
              <div className="admin-state-message" style={{ padding: "12px 0", textAlign: "left" }}>
                Sin acceso al portal.
              </div>
            )}

            {accessInfo.kind === "unknown" && (
              <div className="admin-state-message admin-error-message" style={{ padding: "12px 0", textAlign: "left" }}>
                Estado de acceso desconocido. No se muestran acciones.
              </div>
            )}

            {accessInfo.kind === "ok" && (
              <div style={{ marginBottom: 16 }}>
                <span className={"admin-status-badge " + data.access.status}>{accessInfo.label}</span>
                {data.access.status_reason && (
                  <div className="admin-access-reason">Motivo: {data.access.status_reason}</div>
                )}
              </div>
            )}

            {!pendingAction && !actionLoading && accessInfo.kind === "ok" && (
              <div className="admin-action-row">
                {studentButtonsForStatus(data.access.status).map((action) => (
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
                  Se aplicará sobre: <strong>{studentDisplayName}</strong>
                </div>
                {ACTION_META[pendingAction].needsReason && (
                  <>
                    <label htmlFor="student-access-reason" className="admin-detail-field-label" style={{ display: "block" }}>
                      Motivo (obligatorio)
                    </label>
                    <textarea
                      id="student-access-reason"
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
