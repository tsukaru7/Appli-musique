import type { Track } from '../../shared/protocol.ts'
import { getAccessToken } from './auth.ts'

const API = 'https://api.spotify.com/v1'

export class SpotifyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function spotifyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${API}${path}`
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await getAccessToken()}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (res.status === 429) {
    const wait = Number(res.headers.get('Retry-After') ?? 1)
    await new Promise((r) => setTimeout(r, wait * 1000))
    return spotifyFetch(path, init)
  }
  if (!res.ok) {
    let message = `Erreur Spotify ${res.status}`
    try {
      const data = await res.json()
      message = data.error?.message ?? message
    } catch {
      // réponse sans contenu JSON
    }
    if (res.status === 403) {
      message = `Spotify refuse l'accès (${message}). Vérifie que ce compte est bien ajouté dans « User Management » du tableau de bord développeur, et qu'il est Premium.`
    }
    throw new SpotifyError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

interface Page<T> {
  items: T[]
  next: string | null
}

async function fetchAll<T>(firstPath: string, max = 2000): Promise<T[]> {
  const all: T[] = []
  let next: string | null = firstPath
  while (next && all.length < max) {
    const page: Page<T> = await spotifyFetch<Page<T>>(next)
    all.push(...page.items)
    next = page.next
  }
  return all
}

export interface Me {
  id: string
  display_name: string | null
}

export function getMe(): Promise<Me> {
  return spotifyFetch<Me>('/me')
}

export interface PlaylistSummary {
  id: string
  name: string
  image?: string
  owner: string
  total?: number
}

interface ApiPlaylist {
  id: string
  name: string
  images?: { url: string }[] | null
  owner?: { display_name?: string | null }
  // Depuis février 2026, Spotify renomme « tracks » en « items » : on accepte les deux.
  items?: { total?: number }
  tracks?: { total?: number }
}

function toSummary(p: ApiPlaylist): PlaylistSummary {
  return {
    id: p.id,
    name: p.name,
    image: p.images?.[0]?.url,
    owner: p.owner?.display_name ?? '',
    total: p.items?.total ?? p.tracks?.total,
  }
}

export async function getMyPlaylists(): Promise<PlaylistSummary[]> {
  const playlists = await fetchAll<ApiPlaylist | null>('/me/playlists?limit=50', 500)
  return playlists.filter((p): p is ApiPlaylist => p !== null).map(toSummary)
}

export async function getPlaylist(id: string): Promise<PlaylistSummary> {
  return toSummary(await spotifyFetch<ApiPlaylist>(`/playlists/${id}`))
}

interface ApiTrack {
  type?: string
  id: string | null
  uri: string
  name: string
  is_local?: boolean
  /** Donné quand on précise le pays : faux pour un morceau grisé (pas lisible dans ce pays). */
  is_playable?: boolean
  artists: { name: string }[]
  album?: { images?: { url: string; width?: number }[] }
  external_ids?: { isrc?: string }
}

interface ApiPlaylistEntry {
  item?: ApiTrack | null
  track?: ApiTrack | null
}

/** Morceaux d'une playlist (sans les épisodes de podcast ni les fichiers locaux). */
export async function getPlaylistTracks(id: string): Promise<Track[]> {
  let entries: ApiPlaylistEntry[]
  try {
    // « market=from_token » : Spotify dit quels morceaux sont lisibles dans le pays du compte.
    entries = await fetchAll<ApiPlaylistEntry>(`/playlists/${id}/items?limit=50&additional_types=track&market=from_token`)
  } catch (err) {
    if (!(err instanceof SpotifyError) || err.status !== 404) throw err
    entries = await fetchAll<ApiPlaylistEntry>(`/playlists/${id}/tracks?limit=50&additional_types=track&market=from_token`)
  }
  return toTracks(entries.map((entry) => entry.item ?? entry.track))
}

/** Morceaux jouables (sans les épisodes de podcast, les fichiers locaux ni les morceaux grisés). */
function toTracks(items: (ApiTrack | null | undefined)[]): Track[] {
  const tracks: Track[] = []
  const seen = new Set<string>()
  for (const t of items) {
    if (!t || !t.id || t.is_local || (t.type && t.type !== 'track') || seen.has(t.id)) continue
    // Morceau grisé dans Spotify : il ne se lancerait jamais.
    if (t.is_playable === false) continue
    seen.add(t.id)
    const images = t.album?.images ?? []
    tracks.push({
      id: t.id,
      uri: t.uri,
      title: t.name,
      artists: t.artists.map((a) => a.name),
      albumImage: (images[1] ?? images[0])?.url,
      isrc: t.external_ids?.isrc,
    })
  }
  return tracks
}

/** Nombre de titres likés (null si la connexion Spotify ne donne pas encore accès aux titres likés). */
export async function getLikedCount(): Promise<number | null> {
  try {
    const page = await spotifyFetch<{ total?: number }>('/me/tracks?limit=1')
    return page.total ?? 0
  } catch (err) {
    if (err instanceof SpotifyError && (err.status === 401 || err.status === 403)) return null
    throw err
  }
}

/** Titres likés (les 2 000 plus récents au maximum). */
export async function getLikedTracks(): Promise<Track[]> {
  const entries = await fetchAll<{ track?: ApiTrack | null }>('/me/tracks?limit=50&market=from_token', 2000)
  return toTracks(entries.map((entry) => entry.track))
}

/** Extrait l'identifiant d'une playlist depuis un lien (open.spotify.com/playlist/…) ou un URI. */
export function parsePlaylistId(input: string): string | null {
  const match = input.trim().match(/playlist[/:]([A-Za-z0-9]{22})/)
  if (match) return match[1]
  return /^[A-Za-z0-9]{22}$/.test(input.trim()) ? input.trim() : null
}
