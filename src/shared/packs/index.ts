import { ANIMES } from './animes.ts'
import { DESSINS_ANIMES } from './dessins-animes.ts'
import { FILMS } from './films.ts'
import { JEUX_VIDEO } from './jeux-video.ts'
import type { Pack } from './types.ts'

export type { Pack, PackEntry } from './types.ts'

/** Packs thématiques : on devine l'œuvre (jeu, animé, film, dessin animé) dont vient la musique. */
export const PACKS: Pack[] = [
  {
    id: 'animes',
    title: 'Animés',
    label: 'Animé',
    description: 'Naruto, One Piece, Demon Slayer, Evangelion…',
    imageHint: { en: 'anime', fr: 'anime' },
    featured: ['One Piece', 'Naruto', 'Demon Slayer', "L'Attaque des Titans"],
    entries: ANIMES,
  },
  {
    id: 'films',
    title: 'Films',
    label: 'Film',
    description: 'Star Wars, Titanic, Amélie Poulain, La Boum…',
    imageHint: { en: 'film', fr: 'film' },
    featured: ['Star Wars', 'Titanic', 'Jurassic Park', 'Retour vers le futur'],
    entries: FILMS,
  },
  {
    id: 'jeux-video',
    title: 'Jeux vidéo',
    label: 'Jeu vidéo',
    description: 'Mario, Zelda, Final Fantasy, Minecraft…',
    imageHint: { en: 'video game', fr: 'jeu vidéo' },
    featured: ['Super Mario', 'The Legend of Zelda', 'Minecraft', 'Pokémon'],
    entries: JEUX_VIDEO,
  },
  {
    id: 'dessins-animes',
    title: 'Dessins animés',
    label: 'Dessin animé',
    description: 'Génériques et chansons en français : Goldorak, Le Roi lion…',
    searchHint: 'générique',
    imageHint: { en: 'animated', fr: 'série d’animation' },
    featured: ['Goldorak', 'Le Roi lion', "Les Mystérieuses Cités d'or", 'La Reine des neiges'],
    entries: DESSINS_ANIMES,
  },
]

export function findPack(id: string): Pack | undefined {
  return PACKS.find((p) => p.id === id)
}

/** Pack d'un morceau de pack (son identifiant est « pack:numéro »). */
export function packOfTrack(trackId: string): Pack | undefined {
  const separator = trackId.indexOf(':')
  return separator > 0 ? findPack(trackId.slice(0, separator)) : undefined
}
