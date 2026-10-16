// Images des œuvres (affiche de film, jaquette de jeu, visuel d'animé…) trouvées sur Wikipedia.
import { normalizeText } from '../shared/answers.ts'
import { PACKS, type Pack } from '../shared/packs/index.ts'

const WIKI_API = (lang: 'en' | 'fr') => process.env[`WIKI_API_${lang.toUpperCase()}`] ?? `https://${lang}.wikipedia.org/w/api.php`
// Wikipedia demande que les programmes qui l'interrogent se présentent.
const HEADERS = { 'User-Agent': 'appli-musique/1.0 (blind test entre amis)' }

interface WikiPage {
  title: string
  index?: number
  thumbnail?: { source: string }
}

const STOP_WORDS = new Set(['the', 'les', 'des', 'and', 'une'])

function keywords(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
}

/** Premier article trouvé par la recherche Wikipedia qui a une image et un rapport avec le nom cherché. */
async function searchWikipedia(lang: 'en' | 'fr', name: string, hint: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${name} ${hint}`,
    gsrlimit: '4',
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: '600',
    // Les affiches et jaquettes ne sont pas des images libres : il faut les demander explicitement.
    pilicense: 'any',
  })
  const res = await fetch(`${WIKI_API(lang)}?${params}`, { headers: HEADERS, signal: AbortSignal.timeout(6000) })
  if (!res.ok) return null
  const data = (await res.json()) as { query?: { pages?: Record<string, WikiPage> } }
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const wanted = keywords(name)
  const page = pages.find((p) => {
    if (!p.thumbnail) return false
    const title = normalizeText(p.title)
    return wanted.length === 0 || wanted.some((w) => title.includes(w))
  })
  return page?.thumbnail?.source ?? null
}

const cache = new Map<string, Promise<string | null>>()

/** Image d'une œuvre : Wikipedia en anglais (sous ses autres noms aussi), puis en français. */
export function findWorkImage(work: string, aliases: string[] = [], pack?: Pack): Promise<string | null> {
  const key = `${pack?.id ?? ''}|${normalizeText(work)}`
  let image = cache.get(key)
  if (!image) {
    image = (async () => {
      const hint = pack?.imageHint ?? { en: '', fr: '' }
      const names = [...new Set([...aliases, work])].slice(0, 3)
      for (const name of names) {
        const found = await searchWikipedia('en', name, hint.en).catch(() => null)
        if (found) return found
      }
      return searchWikipedia('fr', work, hint.fr).catch(() => null)
    })()
    // Un échec réseau ne doit pas rester en cache pour toujours.
    image.then((url) => url === null && setTimeout(() => cache.delete(key), 10 * 60 * 1000))
    cache.set(key, image)
  }
  return image
}

let packArt: Promise<Record<string, string[]>> | null = null

/** Quelques images par pack, pour illustrer leurs cartes au moment de choisir. */
export function getPackArt(): Promise<Record<string, string[]>> {
  packArt ??= (async () => {
    const entries = await Promise.all(
      PACKS.map(async (pack) => {
        const images = await Promise.all(
          pack.featured.map((work) => {
            const aliases = pack.entries.find(([w]) => w === work)?.[3] ?? []
            return findWorkImage(work, aliases, pack)
          }),
        )
        return [pack.id, images.filter((url): url is string => url !== null)] as const
      }),
    )
    const art = Object.fromEntries(entries)
    // Si Wikipedia n'a pas répondu, on réessaiera au prochain affichage.
    if (Object.values(art).every((images) => images.length === 0)) packArt = null
    return art
  })()
  return packArt
}
