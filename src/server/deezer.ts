// Extraits audio de 30 secondes fournis publiquement par Deezer (aucun compte nécessaire).
import { normalizeText, trackKey } from '../shared/answers.ts'
import type { Track } from '../shared/protocol.ts'

const DEEZER_API = process.env.DEEZER_API ?? 'https://api.deezer.com'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface DeezerTrack {
  id?: number
  preview?: string
  title?: string
  artist?: { name?: string }
  album?: { title?: string }
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

async function search(query: string, limit = 5): Promise<DeezerTrack[]> {
  const result = await deezerGet<{ data?: DeezerTrack[]; error?: DeezerTrack['error'] }>(
    `/search?limit=${limit}&q=${encodeURIComponent(query)}`,
  )
  return (result.data ?? []).filter((t) => t.id && t.preview)
}

const STOP_WORDS = new Set(['the', 'and', 'les', 'des', 'une', 'pour', 'from', 'main', 'theme', 'with', 'dans'])

/** Mots significatifs d'un texte (pour vérifier qu'un résultat de recherche a un rapport). */
function keywords(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
}

/** Un résultat de recherche « large » n'est gardé que s'il partage un mot avec le morceau ou l'œuvre. */
function looksRelated(result: DeezerTrack, track: Track): boolean {
  const haystack = normalizeText(`${result.title ?? ''} ${result.album?.title ?? ''} ${result.artist?.name ?? ''}`)
  const wanted = [...keywords(track.title), ...keywords(track.work ?? '')]
  return wanted.length === 0 || wanted.some((w) => haystack.includes(w))
}

/**
 * Retrouve le morceau sur Deezer. Dans l'ordre : par son ISRC, par titre + artiste exacts, puis par
 * des recherches plus larges (vérifiées) — utile pour les packs, où le morceau officiel n'est pas
 * toujours sur Deezer mais une reprise reconnaissable l'est. Renvoie l'id Deezer.
 */
export async function findDeezerTrack(track: Track): Promise<number | null> {
  if (track.isrc) {
    const found = await deezerGet<DeezerTrack>(`/track/isrc:${encodeURIComponent(track.isrc)}`)
    if (found.id && found.preview) return found.id
  }
  const title = track.title.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '')
  const artist = track.artists[0] ?? ''
  if (artist) {
    const exact = await search(`artist:"${artist}" track:"${title}"`, 1)
    if (exact[0]?.id) return exact[0].id
  }
  const broad = [
    artist ? `${title} ${artist}` : null,
    track.work && track.searchHint ? `${track.searchHint} ${track.work}` : null,
    track.work ? `${track.work} ${title}` : null,
    track.work ? `${track.work} theme` : null,
  ].filter((q): q is string => q !== null)
  for (const query of broad) {
    const match = (await search(query)).find((r) => looksRelated(r, track))
    if (match?.id) return match.id
  }
  return null
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
