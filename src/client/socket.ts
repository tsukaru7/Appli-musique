import { createContext, useContext } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol.ts'

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export const socket: GameSocket = io()

/**
 * Connexion utilisée par les écrans de jeu d'un joueur. Par défaut, celle de la page ; en solo,
 * la page de l'hôte ouvre une seconde connexion pour jouer elle-même.
 */
export const SocketContext = createContext<GameSocket>(socket)

export function useSocket(): GameSocket {
  return useContext(SocketContext)
}

export function createPlayerSocket(): GameSocket {
  return io({ forceNew: true })
}
