import { isCorrectAnswer, trackKey, trackLabel } from '../shared/answers.ts'
import {
  POINTS_BY_STAGE,
  SNIPPET_DURATIONS_MS,
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
  score: number
  connected: boolean
}

interface PlayerRound {
  /** Dernier palier sur lequel le joueur a répondu ou passé (-1 = aucun). */
  attemptedStage: number
  lastResult: 'wrong' | 'passed' | null
  foundAtStage?: number
  points: number
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

/** Une partie : joueurs, morceaux, manches et paliers. Ne connaît rien du réseau. */
export class Game {
  readonly code: string
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

  constructor(code: string, tracks: Track[], totalRounds: number, random: () => number = Math.random) {
    this.code = code
    this.tracks = tracks
    this.tracksById = new Map(tracks.map((t) => [t.id, t]))
    const uniqueCount = new Set(tracks.map(trackKey)).size
    this.totalRounds = Math.max(1, Math.min(totalRounds, uniqueCount))
    this.random = random
  }

  join(id: string, name: string): void {
    const existing = this.players.get(id)
    if (existing) {
      existing.connected = true
      existing.name = name
      return
    }
    this.players.set(id, { id, name, score: 0, connected: true })
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

  /** L'hôte force le passage à l'extrait plus long. */
  nextStage(): Change {
    if (this.phase !== 'playing') return { playNext: false }
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

    round.attemptedStage = this.stage
    let points = 0
    if (correct) {
      points = POINTS_BY_STAGE[this.stage]
      round.foundAtStage = this.stage
      round.points = points
      this.players.get(playerId)!.score += points
    } else {
      round.lastResult = 'wrong'
    }
    return { result: { correct, guessLabel, points }, change: this.checkAdvance() }
  }

  pass(playerId: string): Change {
    const round = this.playableRound(playerId)
    if (!round) return { playNext: false }
    round.attemptedStage = this.stage
    round.lastResult = 'passed'
    return this.checkAdvance()
  }

  view(): RoomView {
    const roundResults: PlayerRoundView[] = [...this.players.values()].map((p) => {
      const round = this.rounds.get(p.id)
      let status: GuessStatus = 'pending'
      if (round?.foundAtStage !== undefined) status = 'correct'
      else if (round && round.attemptedStage === this.stage && round.lastResult) status = round.lastResult
      return { playerId: p.id, status, foundAtStage: round?.foundAtStage, points: round?.points ?? 0 }
    })
    return {
      code: this.code,
      phase: this.phase,
      players: [...this.players.values()].map((p) => ({ ...p })),
      totalRounds: this.totalRounds,
      roundNumber: this.roundNumber,
      stage: this.stage,
      roundResults,
      revealed: this.phase === 'reveal' || this.phase === 'finished' ? this.current : undefined,
    }
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
      round = { attemptedStage: -1, lastResult: null, points: 0 }
      this.rounds.set(playerId, round)
    }
    if (round.foundAtStage !== undefined || round.attemptedStage === this.stage) return undefined
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

    const searching = active.filter((p) => this.rounds.get(p.id)?.foundAtStage === undefined)
    if (searching.length === 0) {
      this.reveal()
      return { playNext: false }
    }
    const allAnswered = searching.every((p) => this.rounds.get(p.id)?.attemptedStage === this.stage)
    if (!allAnswered) return { playNext: false }
    return this.nextStage()
  }
}
