import { ANIMES } from './animes.ts'
import { DESSINS_ANIMES } from './dessins-animes.ts'
import { FILMS } from './films.ts'
import { JEUX_VIDEO } from './jeux-video.ts'
import type { Pack } from './types.ts'

export type { Pack, PackEntry } from './types.ts'

/** Packs thématiques : on devine l'œuvre (jeu, animé, film, dessin animé) dont vient la musique. */
export const PACKS: Pack[] = [
  { id: 'jeux-video', title: 'Jeux vidéo', description: 'Mario, Zelda, Final Fantasy, Minecraft…', entries: JEUX_VIDEO },
  { id: 'animes', title: 'Animés', description: 'Naruto, One Piece, Demon Slayer, Evangelion…', entries: ANIMES },
  { id: 'films', title: 'Films', description: 'Star Wars, Amélie Poulain, Titanic, La Boum…', entries: FILMS },
  {
    id: 'dessins-animes',
    title: 'Dessins animés',
    description: 'Génériques et chansons en français : Goldorak, Le Roi lion…',
    searchHint: 'générique',
    entries: DESSINS_ANIMES,
  },
]

export function findPack(id: string): Pack | undefined {
  return PACKS.find((p) => p.id === id)
}
