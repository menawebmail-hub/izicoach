import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './auth/AuthProvider.jsx'
import { AdminApp } from './admin/AdminApp.jsx'

// Admin-1: static path check at mount only, no client-side navigation yet —
// that's an Admin-2 routing decision. AdminApp owns its own auth listener,
// independent of AuthProvider/resolveSession (coach/student identity).
// Matches only /admin and /admin/... — startsWith('/admin') alone would
// also match /administrator or /adminXYZ.
const path = window.location.pathname
const isAdminPath = path === '/admin' || path.startsWith('/admin/')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isAdminPath ? (
      <AdminApp />
    ) : (
      <AuthProvider>
        <App />
      </AuthProvider>
    )}
  </StrictMode>,
)
