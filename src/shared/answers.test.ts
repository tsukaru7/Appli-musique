import { describe, expect, it } from 'vitest'
import { buildAnswerOptions, filterOptions, isCorrectAnswer } from './answers.ts'
import { PACKS } from './packs/index.ts'
import type { Track } from './protocol.ts'

describe('packs : on devine l’œuvre', () => {
  const tracks: Track[] = [
    { id: 'a', uri: '', title: "Hedwig's Theme", artists: ['John Williams'], work: 'Harry Potter' },
    { id: 'b', uri: '', title: 'Leaving Hogwarts', artists: ['John Williams'], work: 'Harry Potter' },
    { id: 'c', uri: '', title: 'Back to the Future', artists: ['Alan Silvestri'], work: 'Retour vers le futur', aliases: ['Back to the Future'] },
  ]
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const options = buildAnswerOptions(tracks)

  it('propose chaque œuvre une seule fois', () => {
    expect(options.map((o) => o.label)).toEqual(['Harry Potter', 'Retour vers le futur'])
  })

  it('trouve une œuvre par un de ses autres noms', () => {
    expect(filterOptions(options, 'back future').map((o) => o.label)).toEqual(['Retour vers le futur'])
  })

  it("accepte n'importe quel morceau de l'œuvre, le nom tapé ou un autre nom", () => {
    expect(isCorrectAnswer(tracks[0], { optionId: 'b' }, byId)).toBe(true)
    expect(isCorrectAnswer(tracks[0], { optionId: 'c' }, byId)).toBe(false)
    expect(isCorrectAnswer(tracks[0], { text: 'harry potter' }, byId)).toBe(true)
    expect(isCorrectAnswer(tracks[2], { text: 'Back to the future' }, byId)).toBe(true)
  })

  it('chaque pack a au moins 100 œuvres différentes', () => {
    for (const pack of PACKS) {
      expect(new Set(pack.entries.map(([work]) => work)).size).toBeGreaterThanOrEqual(100)
    }
  })
})
