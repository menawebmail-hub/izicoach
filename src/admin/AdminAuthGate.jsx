// Purely presentational — no auth logic of its own. AdminApp owns the
// lifecycle (loading/sessionInfo); this just renders the right one of the
// three Admin-1 states.
const styles = {
  wrap: { width: "100vw", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0D1B4B", fontFamily: "sans-serif" },
  card: { background: "#fff", borderRadius: 16, padding: 32, maxWidth: 360, textAlign: "center" },
  title: { fontSize: 18, fontWeight: 800, marginBottom: 8, color: "#1A3DB5" },
  text: { fontSize: 14, color: "#555" },
};

export function AdminAuthGate({ loading, sessionInfo, children }) {
  if (loading) {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>Cargando…</div>
      </div>
    );
  }

  if (!sessionInfo?.authenticated || !sessionInfo?.is_admin) {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <div style={styles.title}>Acceso no autorizado</div>
          <div style={styles.text}>No tenés permisos de administrador para ver esta sección.</div>
        </div>
      </div>
    );
  }

  return children;
}
