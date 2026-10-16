/** Avatars des joueurs : couleur, yeux, bouche et accessoire, choisis parmi des combinaisons prêtes. */

export const AVATAR_COLORS = ['#ff6a3d', '#f2c14e', '#7fd6a2', '#6aa9ff', '#b48cff', '#ff8fb1', '#4fd1c5', '#e8b07a']
export const AVATAR_EYES = ['dots', 'happy', 'wink', 'shades', 'big', 'sleepy'] as const
export const AVATAR_MOUTHS = ['smile', 'open', 'tongue', 'grin', 'o'] as const
export const AVATAR_HATS = ['headphones', 'cap', 'crown', 'beanie', 'bow', 'none', 'antenna', 'horns'] as const

export interface AvatarLook {
  color: string
  eyes: (typeof AVATAR_EYES)[number]
  mouth: (typeof AVATAR_MOUTHS)[number]
  hat: (typeof AVATAR_HATS)[number]
}

/** 24 avatars prêts à choisir (« a0 » à « a23 »), tous différents. */
export const AVATARS: Record<string, AvatarLook> = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => [
    `a${i}`,
    {
      color: AVATAR_COLORS[i % AVATAR_COLORS.length],
      eyes: AVATAR_EYES[(i * 5 + Math.floor(i / 8)) % AVATAR_EYES.length],
      mouth: AVATAR_MOUTHS[(i * 3 + Math.floor(i / 8)) % AVATAR_MOUTHS.length],
      hat: AVATAR_HATS[(i + Math.floor(i / 8) * 3) % AVATAR_HATS.length],
    },
  ]),
)

export const AVATAR_IDS = Object.keys(AVATARS)

export function isAvatar(id: unknown): id is string {
  return typeof id === 'string' && id in AVATARS
}

/** Avatar attribué par défaut (stable pour un même joueur). */
export function defaultAvatar(seed: string): string {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_IDS[h % AVATAR_IDS.length]
}
