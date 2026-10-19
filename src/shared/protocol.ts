// Types partagés entre le serveur de jeu, la page hôte (ordinateur) et la page joueur (téléphone).

/** Durées des extraits, en millisecondes, palier par palier. */
export const SNIPPET_DURATIONS_MS = [1000, 2000, 4000, 7000, 11000, 16000]

/** Points gagnés selon le palier auquel on trouve le morceau. */
export const POINTS_BY_STAGE = [600, 500, 400, 300, 200, 100]

export interface Track {
  id: string
  uri: string
  title: string
  artists: string[]
  albumImage?: string
  /** Code international de l'enregistrement : sert à retrouver le morceau sur Deezer. */
  isrc?: string
  /** Packs : l'œuvre à deviner (jeu, animé, film…) et ses autres noms acceptés. */
  work?: string
  aliases?: string[]
  /** Packs : mots ajoutés à la recherche Deezer si le morceau exact n'est pas trouvé. */
  searchHint?: string
  /** Packs : version Deezer choisie et vérifiée à la main (prioritaire sur la recherche). */
  deezerId?: number
}

/** D'où vient le son : le lecteur Spotify de l'ordinateur, ou les extraits Deezer. */
export type AudioSource = 'spotify' | 'deezer'

/**
 * - « spotify » : le son sort de l'ordinateur de l'hôte, tout le monde écoute le même extrait.
 * - « deezer » : chacun écoute sur son téléphone un extrait Deezer, à son rythme.
 */
export type GameMode = 'spotify' | 'deezer'

/** Une proposition de réponse affichée dans l'autocomplétion des joueurs. */
export interface AnswerOption {
  id: string
  label: string
  /** Autres noms qui font aussi apparaître cette proposition (ex. titre original d'un film). */
  aliases?: string[]
}

export type Phase = 'lobby' | 'playing' | 'reveal' | 'finished'

/** « out » : en mode Deezer, le joueur a épuisé tous les extraits sans trouver. */
export type GuessStatus = 'pending' | 'correct' | 'wrong' | 'passed' | 'out'

export interface PlayerView {
  id: string
  name: string
  /** Avatar choisi (identifiant de src/shared/avatars.ts). */
  avatar: string
  score: number
  connected: boolean
}

export interface PlayerRoundView {
  playerId: string
  /** Résultat sur le palier en cours (ou « correct » si déjà trouvé). */
  status: GuessStatus
  /** Palier auquel le joueur a trouvé, s'il a trouvé. */
  foundAtStage?: number
  points: number
  /** En mode Deezer : palier atteint par ce joueur. */
  stage: number
}

/** État de la partie envoyé à tout le monde (sans jamais révéler le morceau avant la fin de la manche). */
/** Résultat de recherche quand un joueur choisit ses morceaux. */
export interface WhoSearchResult {
  deezerId: number
  title: string
  artist: string
  album: string
  cover?: string
  /** Extrait à écouter pour vérifier que c'est le bon morceau. */
  preview?: string
}

/** Quel jeu : blind test (deviner le titre ou l'œuvre) ou « Qui a mis ce son ? ». */
export type GameKind = 'blindtest' | 'whois'

/** Sauvegarde chiffrée d'une partie (illisible pour l'hôte) : morceaux d'un côté, état de l'autre. */
export interface HostSnapshot {
  base: string
  state: string
}

/** État propre à « Qui a mis ce son ? ». */
export interface WhoView {
  /** Nombre de morceaux que chaque joueur doit ajouter. */
  perPlayer: number
  /** Combien de morceaux chaque joueur a déjà ajoutés (pas lesquels : c'est secret). */
  counts: Record<string, number>
  /** Tout le monde a choisi ses morceaux : l'hôte peut lancer. */
  ready: boolean
  /** Joueurs qui ont déjà voté pendant la manche. */
  voted: string[]
  /** À la révélation : qui a mis le morceau, et qui a voté pour qui. */
  ownerId?: string
  votes?: Record<string, string>
}

export interface RoomView {
  code: string
  kind?: GameKind
  whois?: WhoView
  mode: GameMode
  /** Partie solo : l'hôte joue seul sur son écran, personne ne rejoint. */
  solo: boolean
  audio: AudioSource
  /** Packs choisis (vide pour une playlist) : on devine alors l'œuvre et non le titre. */
  packs: string[]
  /** Packs : le type d'œuvre de la manche en cours (« Film », « Animé »…), affiché aux joueurs. */
  category?: { id: string; label: string }
  phase: Phase
  players: PlayerView[]
  totalRounds: number
  roundNumber: number
  stage: number
  roundResults: PlayerRoundView[]
  /** Morceau révélé (uniquement en phase « reveal » / « finished »). */
  revealed?: Track
}

export interface ClientToServerEvents {
  'host:create': (
    payload: {
      /** Soit une playlist (ses morceaux), soit des packs thématiques. */
      tracks?: Track[]
      packs?: string[]
      /** « Qui a mis ce son ? » : pas de morceaux au départ, chaque joueur en ajoute `perPlayer`. */
      whois?: { perPlayer: number }
      totalRounds: number
      mode: GameMode
      solo?: boolean
      password?: string
    },
    ack: (res: { ok: true; code: string; hostKey: string } | { ok: false; error: string }) => void,
  ) => void
  'host:resume': (
    payload: { code: string; hostKey: string; snapshot?: HostSnapshot },
    ack: (res: { ok: boolean; error?: string; restored?: boolean }) => void,
  ) => void
  'host:start': () => void
  'host:nextStage': () => void
  'host:reveal': () => void
  'host:nextRound': () => void
  'host:snippet': (payload: { stage: number; durationMs: number }) => void
  /** L'hôte quitte la partie : elle est fermée pour tout le monde. */
  'host:end': () => void
  'player:join': (
    payload: { code: string; name: string; playerId: string; avatar?: string },
    ack: (res: { ok: true; options: AnswerOption[] } | { ok: false; error: string }) => void,
  ) => void
  'player:guess': (payload: { optionId?: string; text?: string }) => void
  'player:pass': () => void
  /** « Qui a mis ce son ? » : chercher, ajouter, retirer un morceau, et voter. */
  'whois:search': (
    payload: { query: string },
    ack: (res: { results: WhoSearchResult[]; error?: string }) => void,
  ) => void
  'whois:add': (
    payload: { deezerId: number },
    ack: (res: { ok: boolean; error?: string; tracks?: Track[] }) => void,
  ) => void
  'whois:remove': (payload: { trackId: string }) => void
  'player:vote': (payload: { targetId: string }) => void
}

export interface ServerToClientEvents {
  'room:update': (room: RoomView) => void
  /** Envoyé uniquement à l'hôte : le morceau à jouer pour la manche en cours. */
  'host:track': (payload: { track: Track; stage: number }) => void
  /** L'hôte vient de lancer un extrait (pour animer une barre de progression sur les téléphones). */
  'snippet:start': (payload: { stage: number; durationMs: number }) => void
  /** Retour personnel au joueur après une proposition. */
  'player:feedback': (payload: { correct: boolean; guessLabel: string; points: number }) => void
  /** La partie a été fermée par l'hôte. */
  'room:closed': () => void
  /** « Qui a mis ce son ? » : les morceaux choisis par ce joueur (lui seul les reçoit). */
  'whois:mine': (payload: { tracks: Track[] }) => void
  /** Sauvegarde chiffrée de la partie, gardée par l'hôte (pour la reprendre si le serveur redémarre). */
  'host:snapshot': (payload: { base?: string; state: string }) => void
  /** « Qui a mis ce son ? » : le morceau de cette manche est le tien. */
  'whois:yours': (payload: { roundNumber: number }) => void
}
