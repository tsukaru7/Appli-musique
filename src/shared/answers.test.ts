import { describe, expect, it } from 'vitest'
import { buildAnswerOptions, cleanWorkName, isCorrectAnswer } from './answers.ts'
import type { Track } from './protocol.ts'

describe("nom de l'œuvre à partir de l'album", () => {
  const cases: [string, string][] = [
    ["Harry Potter and the Philosopher's Stone (Original Motion Picture Soundtrack)", "Harry Potter and the Philosopher's Stone"],
    ['The Legend of Zelda: Breath of the Wild Original Soundtrack', 'The Legend of Zelda: Breath of the Wild'],
    ['Stranger Things (A Netflix Original Series Soundtrack)', 'Stranger Things'],
    ['Le fabuleux destin d’Amélie Poulain (Bande originale du film)', 'Le fabuleux destin d’Amélie Poulain'],
    ['Interstellar (Original Motion Picture Soundtrack) [Expanded Edition]', 'Interstellar'],
    ['Final Fantasy VII OST', 'Final Fantasy VII'],
    ['Game of Thrones: Season 1 (Music from the HBO Series)', 'Game of Thrones'],
    ['Music from Twin Peaks', 'Twin Peaks'],
    ['Pokémon - The Original Soundtrack', 'Pokémon'],
    ['Super Mario Bros.', 'Super Mario Bros.'],
    ['The Lion King', 'The Lion King'],
    ['Spider-Man: Into the Spider-Verse (Soundtrack From & Inspired by the Motion Picture)', 'Spider-Man: Into the Spider-Verse'],
  ]
  it.each(cases)('%s → %s', (album, work) => {
    expect(cleanWorkName(album)).toBe(work)
  })
})

describe("mode « deviner l'œuvre »", () => {
  const tracks: Track[] = [
    { id: 'a', uri: 'a', title: "Hedwig's Theme", artists: ['John Williams'], work: 'Harry Potter' },
    { id: 'b', uri: 'b', title: 'Leaving Hogwarts', artists: ['John Williams'], work: 'Harry Potter' },
    { id: 'c', uri: 'c', title: 'Main Title', artists: ['Hans Zimmer'], work: 'Interstellar' },
  ]
  const byId = new Map(tracks.map((t) => [t.id, t]))

  it("propose chaque œuvre une seule fois", () => {
    expect(buildAnswerOptions(tracks).map((o) => o.label)).toEqual(['Harry Potter', 'Interstellar'])
  })

  it("accepte n'importe quel morceau de la même œuvre, ou le nom tapé", () => {
    expect(isCorrectAnswer(tracks[0], { optionId: 'b' }, byId)).toBe(true)
    expect(isCorrectAnswer(tracks[0], { optionId: 'c' }, byId)).toBe(false)
    expect(isCorrectAnswer(tracks[0], { text: 'harry potter' }, byId)).toBe(true)
  })
})
