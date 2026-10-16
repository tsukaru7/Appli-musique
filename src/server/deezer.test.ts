import { describe, expect, it } from 'vitest'
import { pickBest, type DeezerTrack } from './deezer.ts'
import type { Track } from '../shared/protocol.ts'

const result = (id: number, title: string, artist: string, album: string, rank: number): DeezerTrack => ({
  id,
  title,
  artist: { name: artist },
  album: { title: album },
  rank,
  preview: 'x',
})

const tetris: Track = { id: 't', uri: '', title: 'Tetris Theme (Korobeiniki)', artists: [], work: 'Tetris' }

describe('choix de la version sur Deezer', () => {
  it("refuse un morceau qui a juste « Tetris » dans le nom", () => {
    const results = [result(1, 'Tetris', 'Un rappeur', 'Un album', 900000)]
    expect(pickBest(results, tetris, false)).toBeNull()
  })

  it('prend la version fidèle la plus connue, jamais un remix', () => {
    const results = [
      result(1, 'Tetris Theme (Dubstep Remix)', 'DJ', 'Remixes', 990000),
      result(2, 'Tetris Theme (Korobeiniki)', 'Video Game Orchestra', 'Tetris', 300000),
      result(3, 'Korobeiniki - Tetris Theme', 'Piano Covers', 'Games on Piano', 500000),
    ]
    expect(pickBest(results, tetris, false)?.id).toBe(3)
  })

  it("exige le bon artiste pour la version officielle", () => {
    const track: Track = { id: 'm', uri: '', title: 'Sweden', artists: ['C418'], work: 'Minecraft' }
    const results = [
      result(1, 'Sweden', 'Some Band', 'Swedish Songs', 800000),
      result(2, 'Sweden', 'C418', 'Minecraft - Volume Alpha', 700000),
    ]
    expect(pickBest(results, track, true)?.id).toBe(2)
  })

  it("une reprise doit venir de l'œuvre", () => {
    const track: Track = { id: 'h', uri: '', title: "Hedwig's Theme", artists: ['John Williams'], work: 'Harry Potter' }
    const results = [
      result(1, "Hedwig's Theme", 'Piano Guy', 'Harry Potter Piano Collection', 400000),
      result(2, "Hedwig's Theme", 'Random', 'Chill Vibes', 600000),
    ]
    expect(pickBest(results, track, false)?.id).toBe(1)
  })
})
