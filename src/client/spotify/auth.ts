// Connexion Spotify « PKCE » : pas besoin de Client Secret, tout se passe dans le navigateur.

export const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '296fdfaaec1d4494833bd1d25572f85f'

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
]

const TOKEN_KEY = 'spotifyToken'
const VERIFIER_KEY = 'spotifyVerifier'

interface StoredToken {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

function redirectUri(): string {
  return `${window.location.origin}/callback`
}

function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const values = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(values, (v) => chars[v % chars.length]).join('')
}

async function sha256Base64Url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function login(): Promise<void> {
  const verifier = randomString(64)
  localStorage.setItem(VERIFIER_KEY, verifier)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: await sha256Base64Url(verifier),
    redirect_uri: redirectUri(),
  })
  window.location.assign(`https://accounts.spotify.com/authorize?${params}`)
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function isLoggedIn(): boolean {
  return localStorage.getItem(TOKEN_KEY) !== null
}

async function requestToken(body: Record<string, string>): Promise<void> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description ?? data.error ?? 'Connexion Spotify refusée')
  const previous = readToken()
  const token: StoredToken = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previous?.refreshToken ?? '',
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token))
}

function readToken(): StoredToken | null {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null')
  } catch {
    return null
  }
}

/** Appelé sur /callback, au retour de la page de connexion Spotify. */
export async function handleCallback(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const error = params.get('error')
  if (error) throw new Error(error === 'access_denied' ? 'Connexion annulée.' : error)
  const code = params.get('code')
  const verifier = localStorage.getItem(VERIFIER_KEY)
  if (!code || !verifier) throw new Error('Réponse de Spotify incomplète, réessaie.')
  await requestToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier })
  localStorage.removeItem(VERIFIER_KEY)
}

let refreshing: Promise<void> | null = null

/** Renvoie un jeton valide, en le renouvelant s'il expire bientôt. */
export async function getAccessToken(): Promise<string> {
  const token = readToken()
  if (!token) throw new Error('Non connecté à Spotify')
  if (token.expiresAt - Date.now() > 60_000) return token.accessToken
  refreshing ??= requestToken({ grant_type: 'refresh_token', refresh_token: token.refreshToken }).finally(() => {
    refreshing = null
  })
  await refreshing
  return readToken()!.accessToken
}
