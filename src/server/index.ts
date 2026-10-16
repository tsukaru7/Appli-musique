import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server, type Socket } from 'socket.io'
import { buildAnswerOptions, cleanWorkName } from '../shared/answers.ts'
import type {
  AnswerBy,
  AnswerOption,
  ClientToServerEvents,
  GameMode,
  ServerToClientEvents,
  Track,
} from '../shared/protocol.ts'
import { fetchPreview, findPlayableTracks } from './deezer.ts'
import { Game, type Change } from './game.ts'

const PORT = Number(process.env.PORT ?? 3001)
const PRODUCTION = process.argv.includes('--production') || process.env.NODE_ENV === 'production'
/** Une partie sans hôte ni joueur connecté est supprimée après ce délai. */
const ROOM_TTL_MS = 2 * 60 * 60 * 1000
/** Mot de passe demandé pour créer une partie (à définir dans les variables d'environnement de Render). */
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? ''

function checkPassword(password: unknown): boolean {
  if (!HOST_PASSWORD) return true
  const digest = (v: string) => createHash('sha256').update(v).digest()
  return typeof password === 'string' && timingSafeEqual(digest(password), digest(HOST_PASSWORD))
}

/**
 * Limite les essais ratés (mot de passe ou code de partie) par adresse IP,
 * pour qu'on ne puisse pas deviner en essayant au hasard.
 */
const MAX_FAILURES = 15
const FAILURE_WINDOW_MS = 10 * 60 * 1000
const failures = new Map<string, { count: number; since: number }>()

function isBlocked(ip: string): boolean {
  const entry = failures.get(ip)
  if (!entry) return false
  if (Date.now() - entry.since > FAILURE_WINDOW_MS) {
    failures.delete(ip)
    return false
  }
  return entry.count >= MAX_FAILURES
}

function recordFailure(ip: string): void {
  const entry = failures.get(ip)
  if (!entry || Date.now() - entry.since > FAILURE_WINDOW_MS) failures.set(ip, { count: 1, since: Date.now() })
  else entry.count++
}

const TOO_MANY = 'Trop d’essais ratés. Réessaie dans quelques minutes.'

interface Room {
  game: Game
  hostKey: string
  hostSocketId?: string
  options: AnswerOption[]
  lastActivity: number
  /** Mode Deezer : id Deezer de chaque morceau jouable, et extraits déjà téléchargés. */
  deezerIds: Map<string, number>
  previews: Map<number, Promise<Buffer>>
}

interface SocketData {
  code?: string
  role?: 'host' | 'player'
  playerId?: string
}

const rooms = new Map<string, Room>()

const app = express()
// Sur Render, l'adresse du visiteur est transmise par le proxy.
app.set('trust proxy', 1)
app.use(express.json({ limit: '10kb' }))
const httpServer = createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer)

/**
 * Configuration publique. En local, on donne aussi les adresses de l'ordinateur sur le Wi-Fi pour que
 * les téléphones puissent le rejoindre (jamais en ligne).
 */
app.get('/api/info', (_req, res) => {
  const lanAddresses = PRODUCTION
    ? []
    : Object.values(networkInterfaces())
        .flat()
        .filter((i) => i && i.family === 'IPv4' && !i.internal)
        .map((i) => i!.address)
  res.json({ lanAddresses, hostPasswordRequired: HOST_PASSWORD !== '' })
})

app.post('/api/host-check', (req, res) => {
  const ip = req.ip ?? 'inconnu'
  if (isBlocked(ip)) {
    res.status(429).json({ ok: false, error: TOO_MANY })
    return
  }
  if (!checkPassword(req.body?.password)) {
    recordFailure(ip)
    res.status(401).json({ ok: false, error: 'Mot de passe incorrect.' })
    return
  }
  res.json({ ok: true })
})

/** Extrait Deezer de la manche en cours (sans jamais révéler le morceau dans l'adresse). */
app.get('/api/preview/:code/:round', async (req, res) => {
  const room = rooms.get(req.params.code)
  const game = room?.game
  const deezerId = game?.current ? room?.deezerIds.get(game.current.id) : undefined
  if (!room || !game || game.phase === 'lobby' || String(game.roundNumber) !== req.params.round || !deezerId) {
    res.status(404).end()
    return
  }
  let audio: Buffer
  try {
    audio = await previewFor(room, deezerId)
  } catch {
    res.status(502).end()
    return
  }
  res.set({ 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=600' })
  // Safari demande le fichier par morceaux (« Range ») : il faut savoir y répondre.
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  if (!range) {
    res.set('Content-Length', String(audio.length)).send(audio)
    return
  }
  const start = range[1] ? Number(range[1]) : 0
  const end = range[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1
  if (start > end || start >= audio.length) {
    res.status(416).set('Content-Range', `bytes */${audio.length}`).end()
    return
  }
  res
    .status(206)
    .set({ 'Content-Range': `bytes ${start}-${end}/${audio.length}`, 'Content-Length': String(end - start + 1) })
    .send(audio.subarray(start, end + 1))
})

function previewFor(room: Room, deezerId: number): Promise<Buffer> {
  let audio = room.previews.get(deezerId)
  if (!audio) {
    audio = fetchPreview(deezerId)
    audio.catch(() => room.previews.delete(deezerId))
    room.previews.set(deezerId, audio)
  }
  return audio
}

if (PRODUCTION) {
  const dist = fileURLToPath(new URL('../../dist', import.meta.url))
  app.use(express.static(dist))
  app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: dist }))
}

function newCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  let code: string
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('')
  } while (rooms.has(code))
  return code
}

function broadcast(room: Room): void {
  room.lastActivity = Date.now()
  io.to(room.game.code).emit('room:update', room.game.view())
}

/** Après une action : met tout le monde à jour et, si besoin, donne à l'hôte le morceau à jouer. */
function afterChange(room: Room, change: Change): void {
  broadcast(room)
  const { game } = room
  if (!change.playNext || !game.current) return
  if (game.mode === 'spotify') {
    if (room.hostSocketId) io.to(room.hostSocketId).emit('host:track', { track: game.current, stage: game.stage })
    return
  }
  // Mode Deezer : on garde seulement l'extrait de la nouvelle manche, téléchargé à l'avance.
  const deezerId = room.deezerIds.get(game.current.id)
  if (deezerId === undefined) return
  for (const id of room.previews.keys()) if (id !== deezerId) room.previews.delete(id)
  previewFor(room, deezerId).catch(() => {})
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

function hostRoom(socket: GameSocket): Room | undefined {
  if (socket.data.role !== 'host' || !socket.data.code) return undefined
  return rooms.get(socket.data.code)
}

function sanitizeTracks(tracks: unknown): Track[] {
  if (!Array.isArray(tracks)) return []
  return tracks
    .filter((t): t is Track => typeof t?.id === 'string' && typeof t?.uri === 'string' && typeof t?.title === 'string')
    .map((t) => ({
      id: t.id,
      uri: t.uri,
      title: t.title.slice(0, 300),
      artists: Array.isArray(t.artists) ? t.artists.map(String).slice(0, 10) : [],
      albumImage: typeof t.albumImage === 'string' ? t.albumImage : undefined,
      isrc: typeof t.isrc === 'string' ? t.isrc.slice(0, 20) : undefined,
      album: typeof t.album === 'string' ? t.album.slice(0, 300) : undefined,
    }))
    .slice(0, 5000)
}

io.on('connection', (socket: GameSocket) => {
  const ip = String(socket.handshake.headers['x-forwarded-for'] ?? socket.handshake.address).split(',')[0].trim()

  socket.on('host:create', async ({ tracks, totalRounds, mode, solo, answerBy, password }, ack) => {
    if (isBlocked(ip)) return ack({ ok: false, error: TOO_MANY })
    if (!checkPassword(password)) {
      recordFailure(ip)
      return ack({ ok: false, error: 'Mot de passe hôte incorrect.' })
    }
    const answer: AnswerBy = answerBy === 'work' ? 'work' : 'title'
    let clean = sanitizeTracks(tracks)
    // Deviner l'œuvre : la réponse est le nom de l'album, débarrassé des « (Original Soundtrack) »…
    if (answer === 'work') {
      clean = clean.filter((t) => t.album).map((t) => ({ ...t, work: cleanWorkName(t.album!) }))
    }
    if (clean.length === 0) return ack({ ok: false, error: 'La playlist ne contient aucun morceau jouable.' })
    const gameMode: GameMode = mode === 'deezer' ? 'deezer' : 'spotify'
    const rounds = Number(totalRounds) || 10

    let playable = clean
    let deezerIds = new Map<string, number>()
    if (gameMode === 'deezer') {
      // On cherche quelques morceaux de plus que nécessaire, au cas où un extrait serait indisponible.
      deezerIds = await findPlayableTracks(clean, rounds + 5)
      playable = clean.filter((t) => deezerIds.has(t.id))
      if (playable.length === 0) {
        return ack({ ok: false, error: "Aucun morceau de cette playlist n'a été trouvé sur Deezer." })
      }
    }

    const code = newCode()
    const room: Room = {
      game: new Game(code, playable, rounds, { mode: gameMode, solo: solo === true, answerBy: answer, answerTracks: clean }),
      hostKey: randomBytes(16).toString('hex'),
      hostSocketId: socket.id,
      options: buildAnswerOptions(clean),
      lastActivity: Date.now(),
      deezerIds,
      previews: new Map(),
    }
    rooms.set(code, room)
    socket.data = { code, role: 'host' }
    socket.join(code)
    ack({ ok: true, code, hostKey: room.hostKey })
    broadcast(room)
  })

  socket.on('host:resume', ({ code, hostKey }, ack) => {
    const room = rooms.get(code)
    if (!room || room.hostKey !== hostKey) return ack({ ok: false, error: 'Partie introuvable.' })
    room.hostSocketId = socket.id
    socket.data = { code, role: 'host' }
    socket.join(code)
    ack({ ok: true })
    afterChange(room, { playNext: room.game.phase === 'playing' && room.game.mode === 'spotify' })
  })

  socket.on('host:start', () => {
    const room = hostRoom(socket)
    if (room) afterChange(room, room.game.start())
  })
  socket.on('host:nextStage', () => {
    const room = hostRoom(socket)
    if (room) afterChange(room, room.game.nextStage())
  })
  socket.on('host:reveal', () => {
    const room = hostRoom(socket)
    if (!room) return
    room.game.reveal()
    broadcast(room)
  })
  socket.on('host:nextRound', () => {
    const room = hostRoom(socket)
    if (room) afterChange(room, room.game.nextRound())
  })
  socket.on('host:snippet', ({ stage, durationMs }) => {
    const room = hostRoom(socket)
    if (room) socket.to(room.game.code).emit('snippet:start', { stage, durationMs })
  })

  socket.on('player:join', ({ code, name, playerId }, ack) => {
    if (isBlocked(ip)) return ack({ ok: false, error: TOO_MANY })
    const room = rooms.get(String(code).toUpperCase().trim())
    if (!room) {
      recordFailure(ip)
      return ack({ ok: false, error: "Ce code de partie n'existe pas." })
    }
    const cleanName = String(name).trim().slice(0, 20)
    if (!cleanName) return ack({ ok: false, error: 'Choisis un pseudo.' })
    const id = String(playerId).slice(0, 64)
    socket.data = { code: room.game.code, role: 'player', playerId: id }
    socket.join(room.game.code)
    room.game.join(id, cleanName)
    ack({ ok: true, options: room.options })
    broadcast(room)
  })

  socket.on('player:guess', (guess) => {
    const { code, playerId, role } = socket.data
    const room = code ? rooms.get(code) : undefined
    if (!room || role !== 'player' || !playerId) return
    const { result, change } = room.game.guess(playerId, {
      optionId: typeof guess?.optionId === 'string' ? guess.optionId : undefined,
      text: typeof guess?.text === 'string' ? guess.text.slice(0, 200) : undefined,
    })
    if (result) socket.emit('player:feedback', result)
    afterChange(room, change)
  })

  socket.on('player:pass', () => {
    const { code, playerId, role } = socket.data
    const room = code ? rooms.get(code) : undefined
    if (!room || role !== 'player' || !playerId) return
    afterChange(room, room.game.pass(playerId))
  })

  socket.on('disconnect', () => {
    const { code, playerId, role } = socket.data
    const room = code ? rooms.get(code) : undefined
    if (!room) return
    if (role === 'host' && room.hostSocketId === socket.id) room.hostSocketId = undefined
    if (role === 'player' && playerId) {
      // Le même joueur peut être connecté depuis un autre onglet : on ne le marque absent que s'il n'en reste aucun.
      const stillThere = [...io.sockets.sockets.values()].some(
        (s) => s.id !== socket.id && s.data.code === code && s.data.playerId === playerId,
      )
      if (!stillThere) afterChange(room, room.game.disconnect(playerId))
    }
  })
})

setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) rooms.delete(code)
  }
}, 10 * 60 * 1000).unref()

httpServer.listen(PORT, () => {
  console.log(`Serveur de jeu prêt sur le port ${PORT}`)
})
