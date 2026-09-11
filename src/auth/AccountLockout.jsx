import { useState } from "react";

// Account Access Control Phase C.1 — pure presentational full-screen gate.
// Same visual language as the app's other full-screen states (login/loading/
// retry in App.jsx) for consistency, not a new design. Never references
// status_reason in any form — get_my_account_status() doesn't return it, so
// there is nothing here that could leak it even by mistake.
const COPY = {
  coach_blocked: {
    title: "Tu cuenta está bloqueada",
    body: "No podés acceder a los datos de tu academia en este momento. Si creés que esto es un error, contactá a soporte.",
  },
  coach_deactivated: {
    title: "Tu cuenta está desactivada",
    body: "Esta cuenta ya no tiene acceso a izicoach. Si creés que esto es un error, contactá a soporte.",
  },
  student_blocked: {
    title: "Tu acceso al portal está bloqueado",
    body: "No podés acceder al portal en este momento. Si creés que esto es un error, contactá a tu entrenador o a soporte.",
  },
  error: {
    title: "No pudimos verificar tu cuenta",
    body: "No pudimos verificar el estado de tu cuenta. Nada se modificó. Probá de nuevo.",
  },
};

export function AccountLockout({ kind, onRetry, onSignOut }) {
  const [retrying, setRetrying] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const copy = COPY[kind] || COPY.error;
  const busy = retrying || signingOut;

  // Phase C.1 audit fix — both handlers now catch: a rejection from onRetry/
  // onSignOut (refreshAccountStatus/handleLogout are both hardened not to
  // reject, but this component must stay usable regardless of what a caller
  // ever passes) must not escape unhandled, and must not leave the button
  // stuck disabled — the finally always clears the busy flag either way, so
  // a failed attempt can always be retried.
  const handleRetry = async () => {
    if (busy) return;
    setRetrying(true);
    try {
      await onRetry?.();
    } catch (thrown) {
      console.error("AccountLockout: onRetry failed:", thrown);
    } finally {
      setRetrying(false);
    }
  };

  const handleSignOut = async () => {
    if (busy) return;
    setSigningOut(true);
    try {
      await onSignOut?.();
    } catch (thrown) {
      console.error("AccountLockout: onSignOut failed:", thrown);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div style={{width:"100vw",height:"100vh",boxSizing:"border-box",position:"fixed",top:0,left:0,display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",zIndex:9999,padding:24}}>
      <div style={{textAlign:"center",color:"#fff",maxWidth:340}} role="alert">
        <div style={{fontSize:32,fontWeight:900,letterSpacing:-2,marginBottom:16}}>
          izi<span style={{color:"#65CE5A"}}>coach</span>
        </div>
        <h1 style={{fontSize:17,fontWeight:800,marginBottom:8}}>{copy.title}</h1>
        <p style={{fontSize:13,color:"rgba(255,255,255,0.75)",marginBottom:24,lineHeight:1.5}}>{copy.body}</p>
        <button
          onClick={handleRetry}
          disabled={busy}
          aria-busy={retrying}
          style={{width:"100%",padding:"14px",borderRadius:14,border:"none",background:"#fff",color:"#1A3DB5",fontSize:15,cursor:busy?"default":"pointer",fontWeight:800,opacity:busy?0.7:1,marginBottom:12}}
        >
          {retrying ? "Comprobando..." : "Volver a comprobar"}
        </button>
        <button
          onClick={handleSignOut}
          disabled={busy}
          aria-busy={signingOut}
          style={{width:"100%",padding:"14px",borderRadius:14,border:"1.5px solid rgba(255,255,255,0.4)",background:"transparent",color:"#fff",fontSize:15,cursor:busy?"default":"pointer",fontWeight:700,opacity:busy?0.7:1}}
        >
          {signingOut ? "Cerrando sesión..." : "Cerrar sesión"}
        </button>
      </div>
    </div>
  );
}
