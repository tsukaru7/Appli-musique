/**
 * Versions Deezer choisies et vérifiées à la main depuis la page « Vérifier les musiques ».
 * Clé : « pack/œuvre », valeur : identifiant du morceau sur Deezer. Prioritaire sur la recherche.
 */
export const DEEZER_OVERRIDES: Record<string, number> = {
  'animes/Erased': 1100590722, // Re:Re: — Asian Kung-Fu Generation
  "animes/Hell's Paradise": 2421549155, // WORK (Hell's Paradise) — Miura Jam BR
  'animes/Mob Psycho 100': 628033262, // 99.9 (Mob Psycho 100 II) — Miura Jam
  'animes/Akira': 16283837, // Kaneda (from Akira) — Global Stage Orchestra
  'animes/Black Clover': 2355735915, // Black Catcher — VK Blanka
  'animes/Détective Conan': 12240357, // Mune ga Dokidoki (from Detective Conan) (Vocal Version) — RMaster
}

export function overrideKey(packId: string, work: string): string {
  return `${packId}/${work}`
}
