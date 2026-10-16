// Extraits audio de 30 secondes fournis publiquement par Deezer (aucun compte nécessaire).
import { trackKey } from '../shared/answers.ts'
import type { Track } from '../shared/protocol.ts'

const DEEZER_API = process.env.DEEZER_API ?? 'https://api.deezer.com'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface DeezerTrack {
  id?: number
  preview?: string
  error?: { code?: number; message?: string }
}

async function deezerGet<T extends { error?: DeezerTrack['error'] }>(path: string, attempt = 0): Promise<T> {
  const res = await fetch(`${DEEZER_API}${path}`)
  const data = (await res.json()) as T
  // Code 4 = trop de requêtes : Deezer accepte environ 50 requêtes toutes les 5 secondes.
  if (data.error?.code === 4 && attempt < 3) {
    await sleep(1500)
    return deezerGet(path, attempt + 1)
  }
  return data
}

/** Retrouve le morceau sur Deezer (par son ISRC, sinon par titre + artiste). Renvoie son id Deezer. */
export async function findDeezerTrack(track: Track): Promise<number | null> {
  if (track.isrc) {
    const found = await deezerGet<DeezerTrack>(`/track/isrc:${encodeURIComponent(track.isrc)}`)
    if (found.id && found.preview) return found.id
  }
  const title = track.title.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '')
  const query = `artist:"${track.artists[0] ?? ''}" track:"${title}"`
  const search = await deezerGet<{ data?: DeezerTrack[]; error?: DeezerTrack['error'] }>(
    `/search?limit=1&q=${encodeURIComponent(query)}`,
  )
  const first = search.data?.find((t) => t.id && t.preview)
  return first?.id ?? null
}

/**
 * Cherche sur Deezer, dans un ordre aléatoire, assez de morceaux (sans doublons) pour la partie.
 * Renvoie la correspondance « id Spotify → id Deezer » des morceaux trouvés.
 */
export async function findPlayableTracks(
  tracks: Track[],
  wanted: number,
  random: () => number = Math.random,
): Promise<Map<string, number>> {
  const seen = new Set<string>()
  const candidates = tracks
    .map((t) => ({ t, r: random() }))
    .sort((a, b) => a.r - b.r)
    .map(({ t }) => t)
    .filter((t) => {
      const key = trackKey(t)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  const found = new Map<string, number>()
  let next = 0
  const worker = async () => {
    while (found.size < wanted && next < candidates.length) {
      const track = candidates[next++]
      try {
        const id = await findDeezerTrack(track)
        if (id) found.set(track.id, id)
      } catch {
        // morceau ignoré si Deezer ne répond pas
      }
      await sleep(100)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return found
}

/** Télécharge l'extrait (le lien donné par Deezer expire : on le redemande à chaque fois). */
export async function fetchPreview(deezerId: number): Promise<Buffer> {
  const track = await deezerGet<DeezerTrack>(`/track/${deezerId}`)
  if (!track.preview) throw new Error('Extrait indisponible')
  const res = await fetch(track.preview)
  if (!res.ok) throw new Error(`Extrait indisponible (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}
