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
 * Clé de la réponse attendue : titre + artiste principal (deux versions du même morceau ont la même
 * clé), ou l'œuvre seule pour les packs (n'importe quel morceau de l'œuvre est la bonne réponse).
 */
export function trackKey(track: Answerable): string {
  if (track.work) return `work:${normalizeText(track.work)}`
  return `${normalizeTitle(track.title)}|${normalizeTitle(track.artists[0] ?? '')}`
}

export function trackLabel(track: Answerable): string {
  if (track.work) return track.work
  return `${track.title} — ${track.artists.join(', ')}`
}

/** Liste des réponses possibles pour l'autocomplétion, sans doublons, triée par ordre alphabétique. */
export function buildAnswerOptions(tracks: Track[]): AnswerOption[] {
  const seen = new Set<string>()
  const options: AnswerOption[] = []
  for (const track of tracks) {
    const key = trackKey(track)
    if (seen.has(key)) continue
    seen.add(key)
    options.push({ id: track.id, label: trackLabel(track), aliases: track.aliases?.length ? track.aliases : undefined })
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, 'fr'))
}

/** Filtre les propositions qui contiennent tous les mots tapés (dans n'importe quel ordre). */
export function filterOptions(options: AnswerOption[], query: string, limit = 8): AnswerOption[] {
  const words = normalizeText(query).split(' ').filter(Boolean)
  if (words.length === 0) return []
  const result: AnswerOption[] = []
  for (const option of options) {
    const label = [option.label, ...(option.aliases ?? [])].map(normalizeText).join(' | ')
    if (words.every((w) => label.includes(w))) {
      result.push(option)
      if (result.length >= limit) break
    }
  }
  return result
}

/**
 * Vérifie une réponse : soit le joueur a choisi une proposition (comparée par clé titre + artiste),
 * soit il a tapé un texte libre (comparé au titre simplifié).
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
  if (guess.text && answer.work) {
    const text = normalizeText(guess.text)
    return text.length > 0 && [answer.work, ...(answer.aliases ?? [])].some((name) => normalizeText(name) === text)
  }
  if (guess.text) {
    const text = normalizeTitle(guess.text)
    return text.length > 0 && text === normalizeTitle(answer.title)
  }
  return false
}
