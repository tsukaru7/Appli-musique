import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol.ts'

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export const socket: GameSocket = io()
