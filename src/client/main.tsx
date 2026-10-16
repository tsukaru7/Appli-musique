import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HostApp } from './host/HostApp.tsx'
import { PlayerApp } from './player/PlayerApp.tsx'
import { VerifyApp } from './verify/VerifyApp.tsx'
import { handleCallback } from './spotify/auth.ts'
import './styles.css'

const path = window.location.pathname

// Spotify n'accepte que 127.0.0.1 (pas « localhost ») comme adresse de retour en local.
if (window.location.hostname === 'localhost' && !path.startsWith('/join')) {
  window.location.replace(window.location.href.replace('://localhost', '://127.0.0.1'))
} else if (path.startsWith('/callback')) {
  handleCallback()
    .catch((err) => sessionStorage.setItem('loginError', String(err?.message ?? err)))
    .finally(() => window.location.replace('/'))
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {path.startsWith('/join') ? <PlayerApp /> : path.startsWith('/verifier') ? <VerifyApp /> : <HostApp />}
    </StrictMode>,
  )
}
