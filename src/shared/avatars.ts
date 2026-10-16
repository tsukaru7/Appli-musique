/**
 * Avatars des joueurs : des personnages de la pop culture (Pokémon, super-héros, films, animés…).
 * Les images viennent de PokeAPI et de superhero-api, servies depuis GitHub.
 */

export interface AvatarInfo {
  id: string
  name: string
  group: string
}

// [identifiant, nom affiché, groupe] — « pk-25 » = Pokémon n° 25, sinon l'image de superhero-api.
const LIST: [string, string, string][] = [
  ['pk-25', "Pikachu", 'Pokémon'],
  ['pk-1', "Bulbizarre", 'Pokémon'],
  ['pk-4', "Salamèche", 'Pokémon'],
  ['pk-7', "Carapuce", 'Pokémon'],
  ['pk-6', "Dracaufeu", 'Pokémon'],
  ['pk-39', "Rondoudou", 'Pokémon'],
  ['pk-52', "Miaouss", 'Pokémon'],
  ['pk-54', "Psykokwak", 'Pokémon'],
  ['pk-94', "Ectoplasma", 'Pokémon'],
  ['pk-132', "Métamorph", 'Pokémon'],
  ['pk-133', "Évoli", 'Pokémon'],
  ['pk-143', "Ronflex", 'Pokémon'],
  ['pk-150', "Mewtwo", 'Pokémon'],
  ['pk-151', "Mew", 'Pokémon'],
  ['pk-175', "Togepi", 'Pokémon'],
  ['pk-197', "Noctali", 'Pokémon'],
  ['pk-249', "Lugia", 'Pokémon'],
  ['pk-448', "Lucario", 'Pokémon'],
  ['pk-658', "Amphinobi", 'Pokémon'],
  ['pk-700', "Nymphali", 'Pokémon'],
  ['pk-778', "Mimiqui", 'Pokémon'],
  ['pk-393', "Tiplouf", 'Pokémon'],
  ['pk-722', "Brindibou", 'Pokémon'],
  ['pk-906', "Poussacha", 'Pokémon'],
  ['pk-59', "Arcanin", 'Pokémon'],
  ['69-batman', "Batman", "Super-héros"],
  ['644-superman', "Superman", "Super-héros"],
  ['620-spider-man', "Spider-Man", "Super-héros"],
  ['346-iron-man', "Iron Man", "Super-héros"],
  ['149-captain-america', "Captain America", "Super-héros"],
  ['659-thor', "Thor", "Super-héros"],
  ['332-hulk', "Hulk", "Super-héros"],
  ['720-wonder-woman', "Wonder Woman", "Super-héros"],
  ['717-wolverine', "Wolverine", "Super-héros"],
  ['213-deadpool', "Deadpool", "Super-héros"],
  ['106-black-panther', "Black Panther", "Super-héros"],
  ['303-groot', "Groot", "Super-héros"],
  ['566-rocket-raccoon', "Rocket", "Super-héros"],
  ['309-harley-quinn', "Harley Quinn", "Super-héros"],
  ['370-joker', "Le Joker", "Super-héros"],
  ['655-thanos', "Thanos", "Super-héros"],
  ['107-black-widow', "Black Widow", "Super-héros"],
  ['226-doctor-strange', "Doctor Strange", "Super-héros"],
  ['263-flash', "Flash", "Super-héros"],
  ['687-venom', "Venom", "Super-héros"],
  ['208-darth-vader', "Dark Vador", "Films & séries"],
  ['729-yoda', "Yoda", "Films & séries"],
  ['418-luke-skywalker', "Luke Skywalker", "Films & séries"],
  ['307-han-solo', "Han Solo", "Films & séries"],
  ['398-kylo-ren', "Kylo Ren", "Films & séries"],
  ['639-stormtrooper', "Stormtrooper", "Films & séries"],
  ['310-harry-potter', "Harry Potter", "Films & séries"],
  ['341-indiana-jones', "Indiana Jones", "Films & séries"],
  ['352-james-bond', "James Bond", "Films & séries"],
  ['476-mr-incredible', "M. Indestructible", "Films & séries"],
  ['236-elastigirl', "Elastigirl", "Films & séries"],
  ['351-jack-jack', "Jack-Jack", "Films & séries"],
  ['450-michelangelo', "Michelangelo", "Films & séries"],
  ['404-leonardo', "Leonardo", "Films & séries"],
  ['287-godzilla', "Godzilla", "Films & séries"],
  ['650-t-800', "Terminator", "Films & séries"],
  ['526-predator', "Predator", "Films & séries"],
  ['627-spock', "Spock", "Films & séries"],
  ['381-katniss-everdeen', "Katniss", "Films & séries"],
  ['322-hellboy', "Hellboy", "Films & séries"],
  ['289-goku', "Goku", "Animés & jeux"],
  ['686-vegeta', "Vegeta", "Animés & jeux"],
  ['485-naruto-uzumaki', "Naruto", "Animés & jeux"],
  ['502-one-punch-man', "One Punch Man", "Animés & jeux"],
  ['435-master-chief', "Master Chief", "Animés & jeux"],
]

export const AVATARS: AvatarInfo[] = LIST.map(([id, name, group]) => ({ id, name, group }))
export const AVATAR_IDS = AVATARS.map((a) => a.id)
export const AVATAR_GROUPS = [...new Set(AVATARS.map((a) => a.group))]

const BY_ID = new Map(AVATARS.map((a) => [a.id, a]))

export function findAvatar(id: string | undefined): AvatarInfo | undefined {
  return id ? BY_ID.get(id) : undefined
}

export function isAvatar(id: unknown): id is string {
  return typeof id === 'string' && BY_ID.has(id)
}

/** Adresse de l'image (« md » : plus grande, pour l'aperçu). */
export function avatarImage(id: string, size: 'sm' | 'md' = 'sm'): string {
  if (id.startsWith('pk-')) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id.slice(3)}.png`
  }
  return `https://raw.githubusercontent.com/akabab/superhero-api/0.3.0/api/images/${size}/${id}.jpg`
}

/** Avatar attribué par défaut (stable pour un même joueur). */
export function defaultAvatar(seed: string): string {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_IDS[h % AVATAR_IDS.length]
}
