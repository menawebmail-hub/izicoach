import { useState } from "react";
import { supabase } from "../services/supabaseClient.js";

// Not a new auth system — a thin form over the same Supabase singleton
// already used everywhere else in src/admin/. On success this does nothing
// beyond the signInWithPassword call itself: no manual redirect, no
// setSessionInfo, no getSession(). AdminApp's existing onAuthStateChange
// listener (unmodified) picks up the resulting SIGNED_IN event on its own
// and resolves admin_get_session() from there — this component doesn't
// need to know that's how the transition happens.
export function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      console.error("admin login error:", signInError);
      setError("Email o contraseña incorrectos.");
      setLoading(false);
    }
    // No success branch — SIGNED_IN propagates through AdminApp's listener
    // and this component gets unmounted once sessionInfo updates.
  };

  return (
    <div className="admin-auth-wrap">
      <div className="admin-auth-card">
        <div className="admin-auth-brand">
          izi<span style={{ color: "#65CE5A" }}>coach</span> Admin
        </div>
        <form className="admin-auth-form" onSubmit={handleSubmit}>
          <div>
            <label className="admin-auth-label">Email</label>
            <input
              className="admin-input"
              style={{ width: "100%", boxSizing: "border-box" }}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <div>
            <label className="admin-auth-label">Contraseña</label>
            <input
              className="admin-input"
              style={{ width: "100%", boxSizing: "border-box" }}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          {error && <div className="admin-error-message" style={{ fontSize: 13 }}>{error}</div>}
          <button type="submit" className="admin-btn-primary" disabled={loading}>
            {loading ? "Ingresando…" : "Iniciar sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}
