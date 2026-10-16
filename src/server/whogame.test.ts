import { describe, expect, it } from 'vitest'
import { WhoGame, WHO_FOOLED_POINTS, WHO_POINTS, WHO_SPEED_BONUS } from './whogame.ts'
import type { Track } from '../shared/protocol.ts'

const track = (id: string, title: string, artist = 'X'): Track => ({ id, uri: '', title, artists: [artist] })

function setup() {
  let now = 0
  const game = new WhoGame('ABCD', 2, { random: () => 0.5, now: () => now })
  game.join('a', 'Alice')
  game.join('b', 'Bob')
  game.join('c', 'Chloé')
  const tick = (ms: number) => (now += ms)
  return { game, tick }
}

describe('Qui a mis ce son ?', () => {
  it('chacun ajoute ses morceaux, sans doublon ni dépassement', () => {
    const { game } = setup()
    expect(game.add('a', track('t1', 'Song A'))).toEqual({ ok: true })
    expect(game.add('b', track('t1', 'Song A')).ok).toBe(false)
    expect(game.add('b', track('t9', 'Song A (Remastered)')).ok).toBe(false) // même morceau
    game.add('a', track('t2', 'Song B'))
    expect(game.add('a', track('t3', 'Song C')).ok).toBe(false) // déjà 2
    game.remove('a', 't2')
    expect(game.mine('a').map((t) => t.id)).toEqual(['t1'])
  })

  it('on ne lance que quand tout le monde a choisi', () => {
    const { game } = setup()
    game.add('a', track('a1', 'A1'))
    game.add('a', track('a2', 'A2'))
    game.add('b', track('b1', 'B1'))
    game.add('b', track('b2', 'B2'))
    expect(game.isReady()).toBe(false)
    expect(game.start().playNext).toBe(false)
    game.add('c', track('c1', 'C1'))
    game.add('c', track('c2', 'C2'))
    expect(game.isReady()).toBe(true)
    expect(game.start().playNext).toBe(true)
    expect(game.totalRounds).toBe(6)
  })

  it('points : bonne réponse + rapidité, et points pour celui qui a trompé les autres', () => {
    const { game, tick } = setup()
    for (const p of ['a', 'b', 'c']) {
      game.add(p, track(`${p}1`, `${p} one`))
      game.add(p, track(`${p}2`, `${p} two`))
    }
    game.start()
    const owner = game.ownerOf(game.current!)!
    const [first, second] = ['a', 'b', 'c'].filter((p) => p !== owner)
    // Le propriétaire ne peut pas voter, on ne peut pas voter pour soi
    expect(game.vote(owner, first)).toBeNull()
    expect(game.vote(first, first)).toBeNull()
    // Le premier trouve tout de suite : points max
    expect(game.vote(first, owner)?.points).toBe(WHO_POINTS + WHO_SPEED_BONUS)
    // Le pendant la manche on ne voit pas s'il a raison
    expect(game.view().roundResults.find((r) => r.playerId === first)?.status).toBe('pending')
    // Le second se trompe au bout de 10 s : la manche se révèle (tout le monde a voté)
    tick(10000)
    expect(game.vote(second, first)?.correct).toBe(false)
    expect(game.phase).toBe('reveal')
    const view = game.view()
    expect(view.whois?.ownerId).toBe(owner)
    expect(view.roundResults.find((r) => r.playerId === owner)?.points).toBe(WHO_FOOLED_POINTS)
    expect(view.roundResults.find((r) => r.playerId === second)?.status).toBe('wrong')
  })

  it('la rapidité compte : moins de points en répondant tard', () => {
    const { game, tick } = setup()
    for (const p of ['a', 'b', 'c']) {
      game.add(p, track(`${p}1`, `${p} one`))
      game.add(p, track(`${p}2`, `${p} two`))
    }
    game.start()
    const owner = game.ownerOf(game.current!)!
    const voter = ['a', 'b', 'c'].find((p) => p !== owner)!
    tick(10000)
    expect(game.vote(voter, owner)?.points).toBe(WHO_POINTS + WHO_SPEED_BONUS / 2)
  })
})
