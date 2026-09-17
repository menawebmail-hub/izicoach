import { useEffect, useState } from "react";
import {
  DATA_KEYS,
  getSyncStatus,
  resolveConflictKeepMine,
  resolveConflictDiscardMine,
  discardQuarantined,
} from "../data/coachData.js";

// Visible, minimal sync status UI: conflict / volatile-unsafe / quarantined
// banners for the six coach_data keys. Reads current state on mount (does
// not depend only on future events) and re-reads on every
// "izi-outbox-status" event dispatched by coachData.js.
//
// Never renders payloads, names, pagos, asistencia or corrupt entry content
// — only the data_key label and, for a conflict, the remote revision/date.

const LABELS = {
  students: "Alumnos",
  classes: "Clases",
  expenses: "Gastos",
  courts: "Canchas",
  packages: "Paquetes",
  families: "Familias",
};

export default function SyncStatusBanner({ coachId, C, rawSetters, isStillActive }) {
  const [status, setStatus] = useState(() => getSyncStatus(coachId));

  useEffect(() => {
    setStatus(getSyncStatus(coachId));
    const handler = (e) => {
      if (e?.detail?.coachId && e.detail.coachId !== coachId) return;
      setStatus(getSyncStatus(coachId));
    };
    document.addEventListener("izi-outbox-status", handler);
    return () => document.removeEventListener("izi-outbox-status", handler);
  }, [coachId]);

  if (!coachId) return null;

  const conflicts = DATA_KEYS.filter((k) => status[k]?.conflict);
  const quarantined = DATA_KEYS.filter((k) => status[k]?.quarantined);
  const volatileUnsafe = DATA_KEYS.filter((k) => status[k]?.volatileUnsafe);

  if (!conflicts.length && !quarantined.length && !volatileUnsafe.length) return null;

  const wrap = {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: "calc(64px + env(safe-area-inset-bottom,8px))",
    zIndex: 9998,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "10px 12px calc(10px + env(safe-area-inset-bottom,0px))",
  };
  const card = {
    background: C.white,
    borderRadius: 14,
    boxShadow: "0 -2px 16px rgba(13,27,75,0.18)",
    border: `1px solid ${C.border}`,
    padding: "12px 14px",
  };
  const title = { fontWeight: 800, fontSize: 13, color: C.text, marginBottom: 4 };
  const body = { fontSize: 12.5, color: C.mutedDark, lineHeight: 1.4, marginBottom: 10 };
  const btnRow = { display: "flex", gap: 8, flexWrap: "wrap" };
  const btnPrimary = {
    flex: 1,
    minWidth: 120,
    padding: "10px 12px",
    borderRadius: 10,
    border: "none",
    background: C.blue2,
    color: C.white,
    fontWeight: 700,
    fontSize: 12.5,
    cursor: "pointer",
  };
  const btnSecondary = {
    flex: 1,
    minWidth: 120,
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: C.white,
    color: C.text,
    fontWeight: 700,
    fontSize: 12.5,
    cursor: "pointer",
  };

  return (
    <div style={wrap}>
      {volatileUnsafe.map((dataKey) => (
        <div key={"volatile-" + dataKey} style={{ ...card, borderColor: "#F5A623" }}>
          <div style={{ ...title, color: "#8A5300" }}>No cierres ni recargues esta pestaña</div>
          <div style={body}>
            Un cambio reciente en <b>{LABELS[dataKey]}</b> todavía no se guardó de forma segura en este dispositivo.
            Se está reintentando enviarlo — esperá a que este aviso desaparezca.
          </div>
        </div>
      ))}

      {conflicts.map((dataKey) => (
        <div key={"conflict-" + dataKey} style={{ ...card, borderColor: C.blue3 }}>
          <div style={title}>Conflicto de sincronización — {LABELS[dataKey]}</div>
          <div style={body}>
            Este dato cambió en el servidor mientras lo editabas acá. Elegí qué versión conservar — si conservás tu
            cambio, reemplaza por completo la versión del servidor (no se combinan campos).
          </div>
          <div style={btnRow}>
            <button
              style={btnPrimary}
              onClick={() => resolveConflictKeepMine(coachId, dataKey)}
            >
              Conservar mi cambio
            </button>
            <button
              style={btnSecondary}
              onClick={() => resolveConflictDiscardMine(coachId, dataKey, rawSetters)}
            >
              Descartar y usar la versión del servidor
            </button>
          </div>
        </div>
      ))}

      {quarantined.map((dataKey) => (
        <div key={"quarantine-" + dataKey} style={{ ...card, borderColor: "#D64545" }}>
          <div style={{ ...title, color: "#B02A2A" }}>Datos locales dañados — {LABELS[dataKey]}</div>
          <div style={body}>
            No pudimos leer de forma segura un cambio guardado localmente para {LABELS[dataKey].toLowerCase()}. Para
            protegerte, no se aplicó ningún dato del servidor sobre esta sección hasta resolverlo.
          </div>
          <div style={btnRow}>
            <button
              style={btnPrimary}
              onClick={() => discardQuarantined(coachId, dataKey, rawSetters, isStillActive)}
            >
              Descartar y usar la versión del servidor
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
