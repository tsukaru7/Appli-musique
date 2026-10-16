import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiCalls: string[] = []
vi.mock('./api.ts', () => ({
  spotifyFetch: vi.fn(async (path: string, init?: { body?: string }) => {
    apiCalls.push(path)
    if (path.startsWith('/me/player/play')) fake.startPlaying(JSON.parse(init!.body!).uris[0])
    if (path.startsWith('/me/player/pause')) fake.paused = true
  }),
}))
vi.mock('./auth.ts', () => ({ getAccessToken: async () => 'token' }))

/**
 * Faux lecteur Spotify : quand on change de morceau, il rejoue d'abord l'ancien pendant 200 ms
 * (comme le vrai), et il peut « ignorer » les pauses.
 */
class FakePlayer {
  paused = true
  uri: string | null = null
  startedAt = 0
  volume = 1
  ignorePause = false
  pauses: number[] = []
  /** Ce qu'on entend, échantillonné toutes les 5 ms. */
  heard = new Set<string>()
  listeners: Record<string, ((arg: unknown) => void)[]> = {}
  private sampler = setInterval(() => {
    if (!this.paused && this.volume > 0 && this.uri) this.heard.add(this.uri)
  }, 5)

  startPlaying(uri: string) {
    if (this.uri) this.paused = false
    setTimeout(() => {
      this.uri = uri
      this.paused = false
      this.startedAt = Date.now()
    }, 200)
  }
  stopSampling() {
    clearInterval(this.sampler)
  }
  addListener(event: string, cb: (arg: unknown) => void) {
    ;(this.listeners[event] ??= []).push(cb)
    return true
  }
  removeListener() {
    return true
  }
  async connect() {
    setTimeout(() => this.listeners.ready?.forEach((cb) => cb({ device_id: 'device' })), 0)
    return true
  }
  disconnect() {}
  async getCurrentState() {
    if (!this.uri) return null
    return {
      paused: this.paused,
      position: this.paused ? 0 : Date.now() - this.startedAt,
      timestamp: Date.now(),
      track_window: { current_track: { uri: this.uri } },
    }
  }
  async pause() {
    if (!this.paused && this.volume > 0) this.pauses.push(Date.now() - this.startedAt)
    if (!this.ignorePause) this.paused = true
  }
  async resume() {
    this.paused = false
  }
  async seek(positionMs: number) {
    this.startedAt = Date.now() - positionMs
  }
  async setVolume(volume: number) {
    this.volume = volume
  }
  async getVolume() {
    return 1
  }
  async activateElement() {}
}

let fake: FakePlayer

beforeEach(() => {
  fake?.stopSampling()
  apiCalls.length = 0
  fake = new FakePlayer()
  vi.stubGlobal('window', {
    Spotify: {
      Player: function () {
        return fake
      },
    },
  })
})

async function newPlayer() {
  const { SnippetPlayer } = await import('./player.ts')
  return SnippetPlayer.create(() => {})
}

describe('SnippetPlayer', () => {
  it("coupe le son après la durée de l'extrait", async () => {
    const player = await newPlayer()
    await player.playSnippet('spotify:track:x', 1000)
    expect(fake.paused).toBe(true)
    expect(fake.pauses).toHaveLength(1)
    expect(fake.pauses[0]).toBeGreaterThanOrEqual(950)
    expect(fake.pauses[0]).toBeLessThan(1150)
  })

  it("passe par l'API web si la pause du lecteur ne marche pas", async () => {
    const player = await newPlayer()
    await player.playSnippet('spotify:track:x', 300)
    fake.ignorePause = true
    apiCalls.length = 0
    await player.playSnippet('spotify:track:x', 500)
    expect(apiCalls.some((p) => p.startsWith('/me/player/pause'))).toBe(true)
    expect(fake.paused).toBe(true)
  })

  it('un nouvel extrait remplace le précédent sans laisser tourner la musique', async () => {
    const player = await newPlayer()
    const first = player.playSnippet('spotify:track:x', 4000)
    await new Promise((r) => setTimeout(r, 400))
    await Promise.all([first, player.playSnippet('spotify:track:x', 500)])
    expect(fake.paused).toBe(true)
  })

  it("on n'entend jamais l'ancien morceau quand on passe au suivant", async () => {
    const player = await newPlayer()
    await player.playFull('spotify:track:old') // révélation de la manche précédente
    await new Promise((r) => setTimeout(r, 300))
    await player.stop()
    fake.heard.clear()
    await player.playSnippet('spotify:track:new', 1000)
    expect([...fake.heard]).toEqual(['spotify:track:new'])
    expect(fake.pauses.at(-1)).toBeGreaterThanOrEqual(950)
    expect(fake.pauses.at(-1)).toBeLessThan(1150)
  })

  it('rejouer le même morceau ne repasse pas par Spotify', async () => {
    const player = await newPlayer()
    await player.playSnippet('spotify:track:x', 300)
    apiCalls.length = 0
    await player.playSnippet('spotify:track:x', 300)
    expect(apiCalls.filter((p) => p.startsWith('/me/player/play'))).toHaveLength(0)
  })

  it('peut sauter le silence du début (départ décalé)', async () => {
    const player = await newPlayer()
    await player.playSnippet('spotify:track:x', 1000, undefined, 3000)
    // Le son a été coupé vers 4 s dans le morceau : 3 s sautées + 1 s d'extrait.
    expect(fake.pauses.at(-1)).toBeGreaterThanOrEqual(3950)
    expect(fake.pauses.at(-1)).toBeLessThan(4150)
  })
})
