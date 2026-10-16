/** [œuvre à deviner, morceau joué, artiste ou compositeur, autres noms acceptés pour l'œuvre] */
export type PackEntry = [work: string, title: string, artist: string, aliases?: string[]]

export interface Pack {
  id: string
  title: string
  /** Le type d'œuvre au singulier, affiché pendant la manche (« Film », « Animé »…). */
  label: string
  description: string
  /** Mots ajoutés à la recherche Deezer quand le morceau exact n'est pas trouvé (ex. « générique »). */
  searchHint?: string
  /** Mots ajoutés à la recherche d'image sur Wikipedia, en anglais puis en français. */
  imageHint: { en: string; fr: string }
  /** Œuvres dont les images illustrent la carte du pack. */
  featured: string[]
  entries: PackEntry[]
}
