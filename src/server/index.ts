import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server, type Socket } from 'socket.io'
import { buildAnswerOptions } from '../shared/answers.ts'
import type { AnswerOption, ClientToServerEvents, ServerToClientEvents, Track } from '../shared/protocol.ts'
import { Game, type Change } from './game.ts'

const PORT = Number(process.env.PORT ?? 3001)
const PRODUCTION = process.argv.includes('--production') || process.env.NODE_ENV === 'production'
/** Une partie sans hôte ni joueur connecté est supprimée après ce délai. */
const ROOM_TTL_MS = 2 * 60 * 60 * 1000

interface Room {
  game: Game
  hostKey: string
  hostSocketId?: string
  options: AnswerOption[]
  lastActivity: number
}

interface SocketData {
  code?: string
  role?: 'host' | 'player'
  playerId?: string
}

const rooms = new Map<string, Room>()

const app = express()
const httpServer = createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer)

/** Adresses IP de l'ordinateur sur le réseau local, pour que les téléphones puissent le rejoindre. */
app.get('/api/info', (_req, res) => {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address)
  res.json({ lanAddresses: addresses })
})

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
  if (change.playNext && game.current && room.hostSocketId) {
    io.to(room.hostSocketId).emit('host:track', { track: game.current, stage: game.stage })
  }
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
    }))
    .slice(0, 5000)
}

io.on('connection', (socket: GameSocket) => {
  socket.on('host:create', ({ tracks, totalRounds }, ack) => {
    const clean = sanitizeTracks(tracks)
    if (clean.length === 0) return ack({ ok: false, error: 'La playlist ne contient aucun morceau jouable.' })
    const code = newCode()
    const room: Room = {
      game: new Game(code, clean, Number(totalRounds) || 10),
      hostKey: randomBytes(16).toString('hex'),
      hostSocketId: socket.id,
      options: buildAnswerOptions(clean),
      lastActivity: Date.now(),
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
    afterChange(room, { playNext: room.game.phase === 'playing' })
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
    const room = rooms.get(String(code).toUpperCase().trim())
    if (!room) return ack({ ok: false, error: "Ce code de partie n'existe pas." })
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
