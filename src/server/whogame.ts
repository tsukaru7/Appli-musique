import { trackKey } from '../shared/answers.ts'
import { defaultAvatar } from '../shared/avatars.ts'
import type { Phase, PlayerRoundView, RoomView, Track } from '../shared/protocol.ts'
import type { Change } from './game.ts'

/** Points d'une bonne réponse, plus un bonus de rapidité (qui baisse sur 20 secondes). */
export const WHO_POINTS = 500
export const WHO_SPEED_BONUS = 500
const SPEED_WINDOW_MS = 20000
/** Points gagnés par celui qui a mis le morceau, pour chaque joueur qui s'est trompé. */
export const WHO_FOOLED_POINTS = 200
/** Nombre maximum de morceaux par joueur. */
export const WHO_MAX_PER_PLAYER = 10

interface Player {
  id: string
  name: string
  avatar: string
  score: number
  connected: boolean
}

/** Sauvegarde d'une partie « Qui a mis ce son ? » (voir GameSnapshot). */
export interface WhoGameSnapshot {
  base: { code: string; perPlayer: number }
  state: {
    phase: Phase
    players: Player[]
    totalRounds: number
    roundNumber: number
    current?: Track
    submissions: [string, Track[]][]
    owners: [string, string][]
    order: Track[]
    votes: [string, string][]
    points: [string, number][]
    roundStartedAt: number
  }
}

export interface WhoGameOptions {
  random?: () => number
  now?: () => number
}

/**
 * « Qui a mis ce son ? » : chaque joueur ajoute quelques morceaux en secret, puis on les écoute un
 * par un et chacun vote pour la personne qui l'a mis. Ne connaît rien du réseau.
 */
export class WhoGame {
  readonly kind = 'whois' as const
  readonly code: string
  readonly perPlayer: number
  // Le son sort de l'écran de l'hôte (extraits Deezer), pour tout le monde en même temps.
  readonly mode = 'spotify' as const
  readonly audio = 'deezer' as const
  readonly solo = false
  readonly packs: string[] = []
  phase: Phase = 'lobby'
  readonly players = new Map<string, Player>()
  totalRounds = 0
  roundNumber = 0
  readonly stage = 0
  current?: Track

  private readonly submissions = new Map<string, Track[]>()
  private readonly owners = new Map<string, string>()
  private order: Track[] = []
  private votes = new Map<string, string>()
  private points = new Map<string, number>()
  private roundStartedAt = 0
  private readonly random: () => number
  private readonly now: () => number

  constructor(code: string, perPlayer: number, options: WhoGameOptions = {}) {
    this.code = code
    this.perPlayer = Math.min(WHO_MAX_PER_PLAYER, Math.max(1, Math.round(perPlayer)))
    this.random = options.random ?? Math.random
    this.now = options.now ?? Date.now
  }

  snapshot(): WhoGameSnapshot {
    return {
      base: { code: this.code, perPlayer: this.perPlayer },
      state: {
        phase: this.phase,
        players: [...this.players.values()].map((p) => ({ ...p })),
        totalRounds: this.totalRounds,
        roundNumber: this.roundNumber,
        current: this.current,
        submissions: [...this.submissions],
        owners: [...this.owners],
        order: this.order,
        votes: [...this.votes],
        points: [...this.points],
        roundStartedAt: this.roundStartedAt,
      },
    }
  }

  static restore({ base, state }: WhoGameSnapshot, options: WhoGameOptions = {}): WhoGame {
    const game = new WhoGame(base.code, base.perPlayer, options)
    game.phase = state.phase
    for (const p of state.players) game.players.set(p.id, { ...p, connected: false })
    game.totalRounds = state.totalRounds
    game.roundNumber = state.roundNumber
    game.current = state.current
    for (const [id, tracks] of state.submissions) game.submissions.set(id, tracks)
    for (const [track, owner] of state.owners) game.owners.set(track, owner)
    game.order = state.order
    game.votes = new Map(state.votes)
    game.points = new Map(state.points)
    game.roundStartedAt = state.roundStartedAt
    return game
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

  disconnect(id: string): Change {
    const player = this.players.get(id)
    if (player) player.connected = false
    return this.checkAdvance()
  }

  /** Morceaux choisis par un joueur (visibles par lui seul). */
  mine(playerId: string): Track[] {
    return this.submissions.get(playerId) ?? []
  }

  ownerOf(track: Track): string | undefined {
    return this.owners.get(track.id)
  }

  /** Ajoute un morceau à la sélection secrète d'un joueur. */
  add(playerId: string, track: Track): { ok: true } | { ok: false; error: string } {
    if (this.phase !== 'lobby') return { ok: false, error: 'La partie a déjà commencé.' }
    if (!this.players.has(playerId)) return { ok: false, error: 'Rejoins la partie d’abord.' }
    const list = this.submissions.get(playerId) ?? []
    if (list.length >= this.perPlayer) {
      return { ok: false, error: `Tu as déjà tes ${this.perPlayer} morceaux. Retire-en un pour en changer.` }
    }
    const key = trackKey(track)
    for (const [owner, tracks] of this.submissions) {
      if (tracks.some((t) => t.id === track.id || trackKey(t) === key)) {
        return {
          ok: false,
          error: owner === playerId ? 'Tu as déjà ajouté ce morceau.' : 'Ce morceau est déjà dans la playlist : choisis-en un autre.',
        }
      }
    }
    list.push(track)
    this.submissions.set(playerId, list)
    this.owners.set(track.id, playerId)
    return { ok: true }
  }

  remove(playerId: string, trackId: string): void {
    if (this.phase !== 'lobby') return
    const list = this.submissions.get(playerId) ?? []
    this.submissions.set(
      playerId,
      list.filter((t) => t.id !== trackId),
    )
    this.owners.delete(trackId)
  }

  /** On peut lancer quand au moins 2 joueurs sont là et ont tous choisi leurs morceaux. */
  isReady(): boolean {
    const players = [...this.players.values()].filter((p) => p.connected)
    return players.length >= 2 && players.every((p) => this.mine(p.id).length === this.perPlayer)
  }

  start(): Change {
    if (this.phase !== 'lobby' || !this.isReady()) return { playNext: false }
    // Tous les morceaux mélangés (ceux des joueurs partis entre-temps aussi : ils ont été choisis).
    this.order = [...this.submissions.values()]
      .flat()
      .map((t) => ({ t, r: this.random() }))
      .sort((a, b) => a.r - b.r)
      .map(({ t }) => t)
    this.totalRounds = this.order.length
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

  nextStage(): Change {
    return { playNext: false }
  }

  /** Vote d'un joueur pour la personne qui a mis le morceau en cours. */
  vote(voterId: string, targetId: string): { correct: boolean; points: number; change: Change } | null {
    if (this.phase !== 'playing' || !this.current) return null
    const owner = this.ownerOf(this.current)
    if (!this.players.has(voterId) || voterId === owner || this.votes.has(voterId)) return null
    if (!this.players.has(targetId) || targetId === voterId) return null
    this.votes.set(voterId, targetId)
    const correct = targetId === owner
    let points = 0
    if (correct) {
      const elapsed = this.now() - this.roundStartedAt
      points = WHO_POINTS + Math.round(WHO_SPEED_BONUS * Math.max(0, 1 - elapsed / SPEED_WINDOW_MS))
      this.award(voterId, points)
    }
    return { correct, points, change: this.checkAdvance() }
  }

  /** Révélation : celui qui a mis le morceau gagne des points pour chaque joueur trompé. */
  reveal(): void {
    if (this.phase !== 'playing' || !this.current) return
    this.phase = 'reveal'
    const owner = this.ownerOf(this.current)
    if (!owner || !this.players.has(owner)) return
    const fooled = [...this.votes.values()].filter((target) => target !== owner).length
    if (fooled > 0) this.award(owner, fooled * WHO_FOOLED_POINTS)
  }

  view(): RoomView {
    const revealing = this.phase === 'reveal' || this.phase === 'finished'
    const owner = this.current ? this.ownerOf(this.current) : undefined
    const roundResults: PlayerRoundView[] = [...this.players.values()].map((p) => {
      const vote = this.votes.get(p.id)
      // Pendant l'écoute, on montre seulement qui a voté (pas s'il a raison : ça trahirait la réponse).
      let status: PlayerRoundView['status'] = 'pending'
      if (revealing && vote) status = vote === owner ? 'correct' : 'wrong'
      return { playerId: p.id, status, points: revealing ? (this.points.get(p.id) ?? 0) : 0, stage: 0 }
    })
    const counts = Object.fromEntries([...this.players.keys()].map((id) => [id, this.mine(id).length]))
    return {
      code: this.code,
      kind: 'whois',
      mode: this.mode,
      solo: false,
      audio: this.audio,
      packs: [],
      phase: this.phase,
      players: [...this.players.values()].map((p) => ({ ...p })),
      totalRounds: this.totalRounds,
      roundNumber: this.roundNumber,
      stage: 0,
      roundResults,
      revealed: revealing ? this.current : undefined,
      whois: {
        perPlayer: this.perPlayer,
        counts,
        ready: this.isReady(),
        voted: [...this.votes.keys()],
        ownerId: revealing ? owner : undefined,
        votes: revealing ? Object.fromEntries(this.votes) : undefined,
      },
    }
  }

  private award(playerId: string, points: number): void {
    const player = this.players.get(playerId)
    if (!player) return
    player.score += points
    this.points.set(playerId, (this.points.get(playerId) ?? 0) + points)
  }

  private startRound(): Change {
    const next = this.order[this.roundNumber]
    if (!next) {
      this.phase = 'finished'
      return { playNext: false }
    }
    this.current = next
    this.roundNumber++
    this.votes = new Map()
    this.points = new Map()
    this.roundStartedAt = this.now()
    this.phase = 'playing'
    return { playNext: true }
  }

  /** Tout le monde (sauf celui qui a mis le morceau) a voté : on révèle. */
  private checkAdvance(): Change {
    if (this.phase !== 'playing' || !this.current) return { playNext: false }
    const owner = this.ownerOf(this.current)
    const voters = [...this.players.values()].filter((p) => p.connected && p.id !== owner)
    if (voters.length > 0 && voters.every((p) => this.votes.has(p.id))) this.reveal()
    return { playNext: false }
  }
}
