// Single reusable placeholder for every module not implemented yet
// (Dashboard/Alumnos/Invitaciones/Logs) — no fake data, no fake logic.
export function PlaceholderPage({ title }) {
  return (
    <div className="admin-state-message">
      <div style={{ fontSize: 18, fontWeight: 800, color: "#0D1B4B", marginBottom: 8 }}>{title}</div>
      <div>Próximamente.</div>
    </div>
  );
}
