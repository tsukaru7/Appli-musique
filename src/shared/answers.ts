import type { AnswerOption, Track } from './protocol.ts'

/**
 * Simplifie un titre pour comparer des réponses :
 * minuscules, sans accents, sans « (feat. …) », « [Remastered] », « - Radio Edit », ni ponctuation.
 */
export function normalizeTitle(title: string): string {
  return normalizeText(title.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, ''))
}

/** Minuscules, sans accents ni ponctuation. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

type Answerable = Pick<Track, 'title' | 'artists' | 'work'>

/**
 * Clé de la réponse attendue. Titre + artiste principal (deux versions du même morceau ont la même
 * clé), ou l'œuvre seule en mode « deviner l'œuvre ».
 */
export function trackKey(track: Answerable): string {
  if (track.work) return `work:${normalizeText(track.work)}`
  return `${normalizeTitle(track.title)}|${normalizeTitle(track.artists[0] ?? '')}`
}

export function trackLabel(track: Answerable): string {
  if (track.work) return track.work
  return `${track.title} — ${track.artists.join(', ')}`
}

/** Mots qui signalent une bande originale dans un nom d'album (et pas le nom de l'œuvre). */
const SOUNDTRACK_WORDS =
  /soundtrack|bande[\s-]+originale|\bb\.?\s?o\.?\b|\bost\b|\bscore\b|music from|music inspired|musique (?:du|de la|des|originale)|motion picture|original|from the|netflix|tv series|television|series|saison|season|deluxe|edition|remaster|anniversary|vol(?:ume|\.)?\s*\d+/i

/**
 * Nom de l'œuvre à partir du nom d'album d'une bande originale :
 * « Harry Potter and the Philosopher's Stone (Original Motion Picture Soundtrack) » → « Harry Potter and the Philosopher's Stone »,
 * « The Legend of Zelda: Breath of the Wild Original Soundtrack » → « The Legend of Zelda: Breath of the Wild ».
 */
export function cleanWorkName(album: string): string {
  let name = album.trim()
  // Parenthèses et crochets qui parlent de la bande originale
  name = name.replace(/\s*[([][^)\]]*[)\]]/g, (part) => (SOUNDTRACK_WORDS.test(part) ? '' : part))
  // « Music from Stranger Things », « Musique du film Amélie »
  name = name.replace(/^(?:music|songs|musique|chansons)\s+(?:from|du film|de la série|du jeu|de|du)\s+(?:the\s+(?:motion picture|film|series|game)\s+)?/i, '')
  // Mots de fin : « … OST », « … Original Soundtrack », « … Bande originale »
  name = name.replace(
    /\s+(?:\(?(?:the\s+)?(?:official\s+)?(?:original\s+)?(?:motion picture\s+|game\s+|video game\s+|tv\s+|series\s+)?(?:soundtrack|ost|score|bande originale(?:\s+du film|\s+de la série)?)\)?)$/i,
    '',
  )
  name = name.replace(/[\s,;:–—-]+$/, '').trim()
  // Ce qui reste après un séparateur, s'il ne parle que de la BO : « … : Season 1 », « … - Deluxe »
  name = name.replace(/\s*[-–—:|]\s*([^-–—:|]*)$/, (part, tail: string) => (SOUNDTRACK_WORDS.test(tail) ? '' : part))
  name = name.replace(/[\s,;:–—-]+$/, '').trim()
  return name || album.trim()
}

/** Liste des réponses possibles pour l'autocomplétion, sans doublons, triée par ordre alphabétique. */
export function buildAnswerOptions(tracks: Track[]): AnswerOption[] {
  const seen = new Set<string>()
  const options: AnswerOption[] = []
  for (const track of tracks) {
    const key = trackKey(track)
    if (seen.has(key)) continue
    seen.add(key)
    options.push({ id: track.id, label: trackLabel(track) })
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, 'fr'))
}

/** Filtre les propositions qui contiennent tous les mots tapés (dans n'importe quel ordre). */
export function filterOptions(options: AnswerOption[], query: string, limit = 8): AnswerOption[] {
  const words = normalizeText(query).split(' ').filter(Boolean)
  if (words.length === 0) return []
  const result: AnswerOption[] = []
  for (const option of options) {
    const label = normalizeText(option.label)
    if (words.every((w) => label.includes(w))) {
      result.push(option)
      if (result.length >= limit) break
    }
  }
  return result
}

/**
 * Vérifie une réponse : soit le joueur a choisi une proposition (comparée par clé), soit il a tapé
 * un texte libre (comparé au titre simplifié, ou à l'œuvre).
 */
export function isCorrectAnswer(
  answer: Track,
  guess: { optionId?: string; text?: string },
  tracksById: Map<string, Track>,
): boolean {
  if (guess.optionId) {
    const picked = tracksById.get(guess.optionId)
    return picked !== undefined && trackKey(picked) === trackKey(answer)
  }
  if (guess.text) {
    if (answer.work) {
      const text = normalizeText(guess.text)
      return text.length > 0 && text === normalizeText(answer.work)
    }
    const text = normalizeTitle(guess.text)
    return text.length > 0 && text === normalizeTitle(answer.title)
  }
  return false
}
