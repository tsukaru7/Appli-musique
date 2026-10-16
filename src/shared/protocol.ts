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
  /** Nom de l'album (pour deviner l'œuvre : film, jeu, série…). */
  album?: string
  /** Mode « deviner l'œuvre » : la réponse attendue (nom de l'album nettoyé). */
  work?: string
}

/** Ce que les joueurs doivent trouver : le titre du morceau, ou l'œuvre dont il vient. */
export type AnswerBy = 'title' | 'work'

/**
 * - « spotify » : le son sort de l'ordinateur de l'hôte, tout le monde écoute le même extrait.
 * - « deezer » : chacun écoute sur son téléphone un extrait Deezer, à son rythme.
 */
export type GameMode = 'spotify' | 'deezer'

/** Une proposition de réponse affichée dans l'autocomplétion des joueurs. */
export interface AnswerOption {
  id: string
  label: string
}

export type Phase = 'lobby' | 'playing' | 'reveal' | 'finished'

/** « out » : en mode Deezer, le joueur a épuisé tous les extraits sans trouver. */
export type GuessStatus = 'pending' | 'correct' | 'wrong' | 'passed' | 'out'

export interface PlayerView {
  id: string
  name: string
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
export interface RoomView {
  code: string
  mode: GameMode
  /** Partie solo : l'hôte joue seul sur son écran, personne ne rejoint. */
  solo: boolean
  answerBy: AnswerBy
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
      tracks: Track[]
      totalRounds: number
      mode: GameMode
      solo?: boolean
      answerBy?: AnswerBy
      password?: string
    },
    ack: (res: { ok: true; code: string; hostKey: string } | { ok: false; error: string }) => void,
  ) => void
  'host:resume': (payload: { code: string; hostKey: string }, ack: (res: { ok: boolean; error?: string }) => void) => void
  'host:start': () => void
  'host:nextStage': () => void
  'host:reveal': () => void
  'host:nextRound': () => void
  'host:snippet': (payload: { stage: number; durationMs: number }) => void
  'player:join': (
    payload: { code: string; name: string; playerId: string },
    ack: (res: { ok: true; options: AnswerOption[] } | { ok: false; error: string }) => void,
  ) => void
  'player:guess': (payload: { optionId?: string; text?: string }) => void
  'player:pass': () => void
}

export interface ServerToClientEvents {
  'room:update': (room: RoomView) => void
  /** Envoyé uniquement à l'hôte : le morceau à jouer pour la manche en cours. */
  'host:track': (payload: { track: Track; stage: number }) => void
  /** L'hôte vient de lancer un extrait (pour animer une barre de progression sur les téléphones). */
  'snippet:start': (payload: { stage: number; durationMs: number }) => void
  /** Retour personnel au joueur après une proposition. */
  'player:feedback': (payload: { correct: boolean; guessLabel: string; points: number }) => void
}
