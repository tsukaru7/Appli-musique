/** [œuvre à deviner, morceau joué, artiste ou compositeur, autres noms acceptés pour l'œuvre] */
export type PackEntry = [work: string, title: string, artist: string, aliases?: string[]]

export interface Pack {
  id: string
  title: string
  description: string
  /** Mots ajoutés à la recherche Deezer quand le morceau exact n'est pas trouvé (ex. « générique »). */
  searchHint?: string
  entries: PackEntry[]
}
