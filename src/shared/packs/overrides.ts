/**
 * Versions Deezer choisies et vérifiées à la main depuis la page « Vérifier les musiques ».
 * Clé : « pack/œuvre », valeur : identifiant du morceau sur Deezer. Prioritaire sur la recherche.
 */
export const DEEZER_OVERRIDES: Record<string, number> = {}

export function overrideKey(packId: string, work: string): string {
  return `${packId}/${work}`
}
