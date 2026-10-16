import { isCorrectAnswer, trackKey, trackLabel } from '../shared/answers.ts'
import { packOfTrack } from '../shared/packs/index.ts'
import { defaultAvatar } from '../shared/avatars.ts'
import {
  POINTS_BY_STAGE,
  SNIPPET_DURATIONS_MS,
  type AudioSource,
  type GameMode,
  type GuessStatus,
  type Phase,
  type PlayerRoundView,
  type RoomView,
  type Track,
} from '../shared/protocol.ts'

const LAST_STAGE = SNIPPET_DURATIONS_MS.length - 1

interface Player {
  id: string
  name: string
  avatar: string
  score: number
  connected: boolean
}

interface PlayerRound {
  /** Mode Spotify : dernier palier sur lequel le joueur a répondu ou passé (-1 = aucun). */
  attemptedStage: number
  lastResult: 'wrong' | 'passed' | null
  /** Mode Deezer : palier où en est ce joueur, et s'il a épuisé tous les extraits. */
  stage: number
  out: boolean
  foundAtStage?: number
  points: number
}

export interface GameOptions {
  mode?: GameMode
  solo?: boolean
  audio?: AudioSource
  packs?: string[]
  /** Tous les morceaux de la playlist, pour vérifier les réponses (par défaut : ceux de la partie). */
  answerTracks?: Track[]
  random?: () => number
}

/** Ce qui a changé après une action, pour que le serveur sache quoi envoyer. */
export interface Change {
  /** Le morceau ou le palier a changé : l'hôte doit recevoir le morceau et jouer le nouvel extrait. */
  playNext: boolean
}

export interface GuessResult {
  correct: boolean
  guessLabel: string
  points: number
}

/**
 * Une partie : joueurs, morceaux, manches et paliers. Ne connaît rien du réseau.
 *
 * En mode Spotify, tout le monde avance ensemble d'un palier à l'autre (un seul extrait joué pour
 * tous). En mode Deezer, chaque joueur a son propre palier : une erreur ou un « passer » lui
 * débloque l'extrait suivant, comme dans Songless.
 */
export class Game {
  readonly code: string
  readonly mode: GameMode
  readonly solo: boolean
  readonly audio: AudioSource
  readonly packs: string[]
  phase: Phase = 'lobby'
  readonly players = new Map<string, Player>()
  readonly totalRounds: number
  roundNumber = 0
  stage = 0
  current?: Track

  private readonly tracks: Track[]
  private readonly tracksById: Map<string, Track>
  private readonly usedKeys = new Set<string>()
  private rounds = new Map<string, PlayerRound>()
  private readonly random: () => number

  constructor(code: string, tracks: Track[], totalRounds: number, options: GameOptions = {}) {
    this.code = code
    this.mode = options.mode ?? 'spotify'
    this.solo = options.solo ?? false
    this.audio = options.audio ?? (this.mode === 'deezer' ? 'deezer' : 'spotify')
    this.packs = options.packs ?? []
    this.tracks = tracks
    this.tracksById = new Map([...(options.answerTracks ?? []), ...tracks].map((t) => [t.id, t]))
    const uniqueCount = new Set(tracks.map(trackKey)).size
    this.totalRounds = Math.max(1, Math.min(totalRounds, uniqueCount))
    this.random = options.random ?? Math.random
  }

  join(id: string, name: string, avatar: string = defaultAvatar(id)): void {
    const existing = this.players.get(id)
    if (existing) {
      existing.connected = true
      existing.name = name
      existing.avatar = avatar
      return
    }
    this.players.set(id, { id, name, avatar, score: 0, connected: true })
  }

  /** Un joueur se déconnecte : on ne l'attend plus pour passer au palier suivant. */
  disconnect(id: string): Change {
    const player = this.players.get(id)
    if (!player) return { playNext: false }
    player.connected = false
    return this.checkAdvance()
  }

  start(): Change {
    if (this.phase !== 'lobby') return { playNext: false }
    return this.startRound()
  }

  nextRound(): Change {
    if (this.phase !== 'reveal') return { playNext: false }
    if (this.roundNumber >= this.totalRounds) {
      this.phase = 'finished'
      return { playNext: false }
    }
    return this.startRound()
  }

  /** L'hôte force le passage à l'extrait plus long (mode Spotify uniquement). */
  nextStage(): Change {
    if (this.phase !== 'playing' || this.mode !== 'spotify') return { playNext: false }
    if (this.stage >= LAST_STAGE) {
      this.reveal()
      return { playNext: false }
    }
    this.stage++
    return { playNext: true }
  }

  reveal(): void {
    if (this.phase === 'playing') this.phase = 'reveal'
  }

  guess(playerId: string, guess: { optionId?: string; text?: string }): { result?: GuessResult; change: Change } {
    const round = this.playableRound(playerId)
    if (!round || !this.current) return { change: { playNext: false } }

    const correct = isCorrectAnswer(this.current, guess, this.tracksById)
    const picked = guess.optionId ? this.tracksById.get(guess.optionId) : undefined
    const guessLabel = picked ? trackLabel(picked) : (guess.text ?? '').trim()

    const stage = this.mode === 'deezer' ? round.stage : this.stage
    round.attemptedStage = this.stage
    let points = 0
    if (correct) {
      points = POINTS_BY_STAGE[stage]
      round.foundAtStage = stage
      round.points = points
      this.players.get(playerId)!.score += points
    } else {
      round.lastResult = 'wrong'
      if (this.mode === 'deezer') this.unlockNextStage(round)
    }
    return { result: { correct, guessLabel, points }, change: this.checkAdvance() }
  }

  pass(playerId: string): Change {
    const round = this.playableRound(playerId)
    if (!round) return { playNext: false }
    round.attemptedStage = this.stage
    round.lastResult = 'passed'
    if (this.mode === 'deezer') this.unlockNextStage(round)
    return this.checkAdvance()
  }

  /** Mode Deezer : le joueur passe à l'extrait suivant, ou a perdu s'il était au dernier. */
  private unlockNextStage(round: PlayerRound): void {
    if (round.stage >= LAST_STAGE) round.out = true
    else round.stage++
  }

  view(): RoomView {
    const roundResults: PlayerRoundView[] = [...this.players.values()].map((p) => {
      const round = this.rounds.get(p.id)
      let status: GuessStatus = 'pending'
      if (round?.foundAtStage !== undefined) status = 'correct'
      else if (round?.out) status = 'out'
      else if (this.mode === 'spotify' && round && round.attemptedStage === this.stage && round.lastResult) {
        status = round.lastResult
      }
      return {
        playerId: p.id,
        status,
        foundAtStage: round?.foundAtStage,
        points: round?.points ?? 0,
        stage: round?.stage ?? 0,
      }
    })
    return {
      code: this.code,
      kind: 'blindtest',
      mode: this.mode,
      solo: this.solo,
      audio: this.audio,
      packs: this.packs,
      phase: this.phase,
      players: [...this.players.values()].map((p) => ({ ...p })),
      totalRounds: this.totalRounds,
      roundNumber: this.roundNumber,
      stage: this.stage,
      roundResults,
      revealed: this.phase === 'reveal' || this.phase === 'finished' ? this.current : undefined,
      category: this.category(),
    }
  }

  private category(): RoomView['category'] {
    if (!this.current || this.phase === 'lobby' || this.packs.length === 0) return undefined
    const pack = packOfTrack(this.current.id)
    return pack && { id: pack.id, label: pack.label }
  }

  private startRound(): Change {
    const available = this.tracks.filter((t) => !this.usedKeys.has(trackKey(t)))
    if (available.length === 0) {
      this.phase = 'finished'
      return { playNext: false }
    }
    this.current = available[Math.floor(this.random() * available.length)]
    this.usedKeys.add(trackKey(this.current))
    this.roundNumber++
    this.stage = 0
    this.rounds = new Map()
    this.phase = 'playing'
    return { playNext: true }
  }

  /** Renvoie la manche du joueur s'il peut encore répondre sur le palier en cours. */
  private playableRound(playerId: string): PlayerRound | undefined {
    if (this.phase !== 'playing' || !this.players.has(playerId)) return undefined
    let round = this.rounds.get(playerId)
    if (!round) {
      round = { attemptedStage: -1, lastResult: null, stage: 0, out: false, points: 0 }
      this.rounds.set(playerId, round)
    }
    if (round.foundAtStage !== undefined || round.out) return undefined
    if (this.mode === 'spotify' && round.attemptedStage === this.stage) return undefined
    return round
  }

  /**
   * Quand tous les joueurs connectés ont trouvé, on révèle.
   * Quand tous ceux qui n'ont pas trouvé ont répondu sur ce palier, on passe à l'extrait suivant
   * (ou on révèle si c'était le dernier).
   */
  private checkAdvance(): Change {
    if (this.phase !== 'playing') return { playNext: false }
    const active = [...this.players.values()].filter((p) => p.connected)
    if (active.length === 0) return { playNext: false }

    const searching = active.filter((p) => {
      const round = this.rounds.get(p.id)
      return round?.foundAtStage === undefined && !round?.out
    })
    if (searching.length === 0) {
      this.reveal()
      return { playNext: false }
    }
    // En mode Deezer, chacun avance seul : la manche finit quand plus personne ne cherche.
    if (this.mode === 'deezer') return { playNext: false }
    const allAnswered = searching.every((p) => this.rounds.get(p.id)?.attemptedStage === this.stage)
    if (!allAnswered) return { playNext: false }
    return this.nextStage()
  }
}
