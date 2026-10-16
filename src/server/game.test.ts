import { describe, expect, it } from 'vitest'
import { Game } from './game.ts'
import { buildAnswerOptions, filterOptions, normalizeTitle } from '../shared/answers.ts'
import type { Track } from '../shared/protocol.ts'

const tracks: Track[] = [
  { id: 'a', uri: 'spotify:track:a', title: 'Bohemian Rhapsody - Remastered 2011', artists: ['Queen'] },
  { id: 'a2', uri: 'spotify:track:a2', title: 'Bohemian Rhapsody', artists: ['Queen'] },
  { id: 'b', uri: 'spotify:track:b', title: 'Alors on danse (Radio Edit)', artists: ['Stromae'] },
  { id: 'c', uri: 'spotify:track:c', title: 'Été indien', artists: ['Joe Dassin'] },
]

/** Partie dont le premier morceau tiré est toujours le premier disponible. */
function newGame(rounds = 3) {
  const game = new Game('ABCD', tracks, rounds, { random: () => 0 })
  game.join('p1', 'Alice')
  game.join('p2', 'Bob')
  game.start()
  return game
}

describe('réponses', () => {
  it('simplifie les titres', () => {
    expect(normalizeTitle('Bohemian Rhapsody - Remastered 2011')).toBe('bohemian rhapsody')
    expect(normalizeTitle('Alors on danse (Radio Edit)')).toBe('alors on danse')
    expect(normalizeTitle('Été indien')).toBe('ete indien')
  })

  it('dédoublonne les versions du même morceau et filtre', () => {
    const options = buildAnswerOptions(tracks)
    expect(options).toHaveLength(3)
    expect(filterOptions(options, 'queen bohem').map((o) => o.id)).toEqual(['a'])
    expect(filterOptions(options, 'ete')).toHaveLength(1)
  })
})

describe('partie', () => {
  it('limite le nombre de manches au nombre de morceaux différents', () => {
    expect(new Game('X', tracks, 10).totalRounds).toBe(3)
  })

  it('accepte une autre version du même morceau et donne les points du palier', () => {
    const game = newGame()
    expect(game.current?.id).toBe('a')
    const { result } = game.guess('p1', { optionId: 'a2' })
    expect(result).toMatchObject({ correct: true, points: 600 })
    expect(game.players.get('p1')?.score).toBe(600)
  })

  it('accepte une réponse tapée librement', () => {
    const game = newGame()
    expect(game.guess('p1', { text: 'bohemian rhapsody' }).result?.correct).toBe(true)
  })

  it("passe à l'extrait suivant quand tous ceux qui cherchent ont répondu", () => {
    const game = newGame()
    game.guess('p1', { optionId: 'b' })
    expect(game.stage).toBe(0)
    const change = game.pass('p2')
    expect(change.playNext).toBe(true)
    expect(game.stage).toBe(1)
    // Une seule réponse par palier
    game.guess('p1', { optionId: 'c' })
    expect(game.guess('p1', { optionId: 'a' }).result).toBeUndefined()
  })

  it('révèle quand tout le monde a trouvé, puis enchaîne et termine', () => {
    const game = newGame(2)
    game.guess('p1', { optionId: 'a' })
    game.pass('p2')
    game.guess('p2', { optionId: 'a' })
    expect(game.phase).toBe('reveal')
    expect(game.players.get('p2')?.score).toBe(500)
    expect(game.view().revealed?.id).toBe('a')

    game.nextRound()
    expect(game.roundNumber).toBe(2)
    expect(game.current?.id).toBe('b') // les autres versions de « Bohemian Rhapsody » sont exclues
    game.nextStage()
    game.reveal()
    game.nextRound()
    expect(game.phase).toBe('finished')
  })

  it('révèle après le dernier palier', () => {
    const game = newGame()
    for (let i = 0; i < 6; i++) {
      game.pass('p1')
      game.pass('p2')
    }
    expect(game.phase).toBe('reveal')
  })

  it("n'attend pas un joueur déconnecté", () => {
    const game = newGame()
    game.pass('p1')
    expect(game.disconnect('p2').playNext).toBe(true)
    expect(game.stage).toBe(1)
  })
})

describe('mode Deezer (chacun à son rythme)', () => {
  function deezerGame() {
    const game = new Game('ABCD', tracks, 3, { mode: 'deezer', random: () => 0 })
    game.join('p1', 'Alice')
    game.join('p2', 'Bob')
    game.start()
    return game
  }
  const round = (game: Game, id: string) => game.view().roundResults.find((r) => r.playerId === id)!

  it('chaque joueur avance seul et marque selon son propre palier', () => {
    const game = deezerGame()
    // Bob trouve tout de suite
    expect(game.guess('p2', { optionId: 'a' }).result?.points).toBe(600)
    // Alice se trompe, passe, puis trouve à l'extrait de 4 s
    game.guess('p1', { optionId: 'b' })
    expect(round(game, 'p1').stage).toBe(1)
    game.pass('p1')
    expect(round(game, 'p1').stage).toBe(2)
    expect(game.phase).toBe('playing')
    expect(game.guess('p1', { optionId: 'a' }).result?.points).toBe(400)
    expect(game.phase).toBe('reveal')
  })

  it('plusieurs réponses possibles sur le même palier (chaque erreur débloque la suite)', () => {
    const game = deezerGame()
    game.guess('p1', { optionId: 'b' })
    game.guess('p1', { optionId: 'c' })
    expect(round(game, 'p1').stage).toBe(2)
  })

  it('un joueur qui épuise tous les extraits a perdu la manche', () => {
    const game = deezerGame()
    game.guess('p2', { optionId: 'a' })
    for (let i = 0; i < 6; i++) game.pass('p1')
    expect(round(game, 'p1').status).toBe('out')
    expect(game.phase).toBe('reveal')
  })

  it("l'hôte ne peut pas forcer le palier", () => {
    const game = deezerGame()
    expect(game.nextStage().playNext).toBe(false)
    expect(game.stage).toBe(0)
  })

  it('accepte une réponse parmi tous les morceaux de la playlist', () => {
    const extra: Track = { id: 'z', uri: 'spotify:track:z', title: 'Autre', artists: ['X'] }
    const game = new Game('X', tracks, 3, { mode: 'deezer', answerTracks: [...tracks, extra], random: () => 0 })
    game.join('p1', 'Alice')
    game.start()
    expect(game.guess('p1', { optionId: 'z' }).result?.correct).toBe(false)
    expect(game.view().roundResults[0].stage).toBe(1)
  })
})
