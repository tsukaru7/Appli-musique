import { describe, expect, it } from 'vitest'
import { Game } from './game.ts'
import { WhoGame } from './whogame.ts'
import { seal, unseal } from './snapshot.ts'
import type { Track } from '../shared/protocol.ts'

const tracks: Track[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, uri: `spotify:track:${id}`, title: `Titre ${id}`, artists: ['X'] }))

describe('sauvegarde des parties', () => {
  it('chiffre, et refuse une sauvegarde modifiée', () => {
    const sealed = seal({ score: 10 })
    expect(sealed).not.toContain('score')
    expect(unseal(sealed)).toEqual({ score: 10 })
    const tampered = Buffer.from(sealed, 'base64')
    tampered[tampered.length - 1] ^= 1
    expect(unseal(tampered.toString('base64'))).toBeNull()
    expect(unseal('nimporte quoi')).toBeNull()
  })

  it('une partie de blind test reprend là où elle en était', () => {
    const game = new Game('ABCD', tracks, 3, { mode: 'deezer' })
    game.join('p1', 'Alice')
    game.join('p2', 'Bob')
    game.start()
    game.pass('p1')
    const first = game.current!
    game.guess('p2', { optionId: first.id })
    const copy = Game.restore(unseal(seal(game.snapshot()))!)
    expect(copy.view()).toEqual({ ...game.view(), players: game.view().players.map((p) => ({ ...p, connected: false })) })
    // La suite de la partie ne rejoue pas un morceau déjà passé.
    copy.join('p1', 'Alice')
    copy.join('p2', 'Bob')
    copy.reveal()
    copy.nextRound()
    expect(copy.current!.id).not.toBe(first.id)
    expect(copy.roundNumber).toBe(2)
  })

  it('une partie « Qui a mis ce son ? » aussi', () => {
    const game = new WhoGame('WXYZ', 1, { random: () => 0.5 })
    game.join('p1', 'Alice')
    game.join('p2', 'Bob')
    game.add('p1', tracks[0])
    game.add('p2', tracks[1])
    game.start()
    const owner = game.ownerOf(game.current!)!
    const voter = owner === 'p1' ? 'p2' : 'p1'
    const copy = WhoGame.restore(unseal(seal(game.snapshot()))!)
    copy.join('p1', 'Alice')
    copy.join('p2', 'Bob')
    expect(copy.ownerOf(copy.current!)).toBe(owner)
    expect(copy.vote(voter, owner)?.correct).toBe(true)
    expect(copy.phase).toBe('reveal')
  })
})
