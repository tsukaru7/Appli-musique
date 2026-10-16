// Extraits audio de 30 secondes fournis publiquement par Deezer (aucun compte nécessaire).
import { normalizeText, trackKey } from '../shared/answers.ts'
import type { Track } from '../shared/protocol.ts'

const DEEZER_API = process.env.DEEZER_API ?? 'https://api.deezer.com'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface DeezerTrack {
  id?: number
  preview?: string
  title?: string
  artist?: { name?: string }
  album?: { title?: string; cover_xl?: string; cover_big?: string }
  /** Popularité du morceau sur Deezer. */
  rank?: number
  error?: { code?: number; message?: string }
}

/** Deezer accepte environ 50 requêtes toutes les 5 secondes : on en envoie au plus une toutes les 120 ms. */
let nextSlot = 0
async function throttle(): Promise<void> {
  const now = Date.now()
  const wait = Math.max(0, nextSlot - now)
  nextSlot = Math.max(now, nextSlot) + 120
  if (wait > 0) await sleep(wait)
}

async function deezerGet<T extends { error?: DeezerTrack['error'] }>(path: string, attempt = 0): Promise<T> {
  await throttle()
  const res = await fetch(`${DEEZER_API}${path}`)
  const data = (await res.json()) as T
  // Code 4 = trop de requêtes : Deezer accepte environ 50 requêtes toutes les 5 secondes.
  if (data.error?.code === 4 && attempt < 3) {
    await sleep(1500)
    return deezerGet(path, attempt + 1)
  }
  return data
}

async function search(query: string, limit: number): Promise<DeezerTrack[]> {
  const result = await deezerGet<{ data?: DeezerTrack[]; error?: DeezerTrack['error'] }>(
    `/search?limit=${limit}&q=${encodeURIComponent(query)}`,
  )
  return (result.data ?? []).filter((t) => t.id && t.preview)
}

const STOP_WORDS = new Set(['the', 'and', 'les', 'des', 'une', 'from', 'with', 'dans', 'pour', 'aux', 'est'])

/** Mots significatifs d'un texte. */
function keywords(text: string): string[] {
  return [...new Set(normalizeText(text).split(' '))].filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
}

/** Part des mots de `wanted` présents dans `text` (0 à 1). */
function coverage(wanted: string, text: string): number {
  const words = keywords(wanted)
  if (words.length === 0) return 0
  const haystack = ` ${normalizeText(text)} `
  return words.filter((w) => haystack.includes(` ${w} `)).length / words.length
}

function sameArtist(expected: string, found: string | undefined): boolean {
  const a = normalizeText(expected)
  const b = normalizeText(found ?? '')
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a))
}

/** Versions qu'on ne veut jamais : elles déforment trop la musique pour qu'on la reconnaisse. */
const UNWANTED =
  /\b(remix|rmx|dubstep|trap|nightcore|slowed|sped up|speed up|reverb|karaoke|lofi|lo fi|medley|mashup|8d|bass boosted|drill|phonk|tiktok|parody|parodie)\b/

/** Comment le morceau a été trouvé : version exacte, version choisie à la main, ou reprise. */
export type MatchKind = 'exact' | 'manual' | 'cover'

/** Morceau trouvé sur Deezer. */
export interface DeezerMatch {
  id: number
  kind: MatchKind
  title: string
  artist: string
  album: string
  /** Pochette de l'album (image de secours pour la révélation). */
  cover?: string
  /** Lien de l'extrait (il expire au bout de quelques heures). */
  preview?: string
}

function toMatch(t: DeezerTrack, kind: MatchKind): DeezerMatch {
  return {
    id: t.id!,
    kind,
    title: t.title ?? '',
    artist: t.artist?.name ?? '',
    album: t.album?.title ?? '',
    cover: t.album?.cover_xl ?? t.album?.cover_big,
    preview: t.preview,
  }
}

/**
 * Choisit, parmi des résultats de recherche, la version la plus connue (rang Deezer) qui correspond
 * vraiment au morceau voulu. `exactArtist` : on exige aussi le bon artiste. Rien plutôt qu'une erreur.
 */
export function pickBest(results: DeezerTrack[], track: Track, exactArtist: boolean): DeezerTrack | null {
  const artist = track.artists[0] ?? ''
  const workWords = keywords(track.work ?? '')
  const candidates = results.filter((r) => {
    const title = r.title ?? ''
    const text = normalizeText(`${title} ${r.album?.title ?? ''}`)
    if (UNWANTED.test(text)) return false
    const artistOk = artist !== '' && sameArtist(artist, r.artist?.name)
    if (exactArtist) return artistOk && coverage(track.title, title) >= 0.5
    if (coverage(track.title, title) < 0.6) return false
    // Une reprise doit au moins venir de l'œuvre (titre ou album) ou du bon artiste.
    const fromWork = workWords.length === 0 || workWords.some((w) => ` ${text} `.includes(` ${w} `))
    return artistOk || fromWork
  })
  candidates.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
  return candidates[0] ?? null
}

/**
 * Retrouve le morceau sur Deezer, dans l'ordre :
 * 1. la version fixée à la main (vérifiée) ;
 * 2. par son ISRC (playlists Spotify) ;
 * 3. titre + artiste exacts ;
 * 4. une version connue et fidèle (utile pour Nintendo, absent des plateformes de streaming).
 */
export async function findDeezerTrack(track: Track): Promise<DeezerMatch | null> {
  if (track.deezerId) {
    const found = await deezerGet<DeezerTrack>(`/track/${track.deezerId}`)
    if (found.id && found.preview) return toMatch(found, 'manual')
  }
  if (track.isrc) {
    const found = await deezerGet<DeezerTrack>(`/track/isrc:${encodeURIComponent(track.isrc)}`)
    if (found.id && found.preview) return toMatch(found, 'exact')
  }
  const title = track.title.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '') || track.title
  const artist = track.artists[0] ?? ''
  if (artist) {
    const exact = pickBest(await search(`artist:"${artist}" track:"${title}"`, 10), track, true)
    if (exact) return toMatch(exact, 'exact')
    const loose = pickBest(await search(`${title} ${artist}`, 15), track, true)
    if (loose) return toMatch(loose, 'exact')
  }
  const queries = [
    track.work ? `${title} ${track.work}` : null,
    track.work && track.searchHint ? `${track.searchHint} ${track.work}` : null,
    title,
  ].filter((q): q is string => q !== null)
  for (const query of queries) {
    const cover = pickBest(await search(query, 25), track, false)
    if (cover) return toMatch(cover, 'cover')
  }
  return null
}

/** Un morceau Deezer par son identifiant (null s'il n'existe pas ou n'a pas d'extrait). */
export async function getDeezerTrack(id: number): Promise<DeezerMatch | null> {
  const found = await deezerGet<DeezerTrack>(`/track/${id}`)
  return found.id && found.preview ? toMatch(found, 'manual') : null
}

/** Recherche libre (page de vérification des packs). */
export async function searchTracks(query: string): Promise<DeezerMatch[]> {
  return (await search(query, 15)).map((t) => toMatch(t, 'manual'))
}

/**
 * Cherche sur Deezer, dans un ordre aléatoire, assez de morceaux (sans doublons) pour la partie.
 * Renvoie, pour chaque morceau trouvé (par son id), le morceau Deezer correspondant.
 */
export async function findPlayableTracks(
  tracks: Track[],
  wanted: number,
  random: () => number = Math.random,
): Promise<Map<string, DeezerMatch>> {
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

  const found = new Map<string, DeezerMatch>()
  let next = 0
  const worker = async () => {
    while (found.size < wanted && next < candidates.length) {
      const track = candidates[next++]
      try {
        const match = await findDeezerTrack(track)
        if (match) found.set(track.id, match)
      } catch {
        // morceau ignoré si Deezer ne répond pas
      }
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
