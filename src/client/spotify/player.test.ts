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

/** Faux lecteur Spotify : démarre 200 ms après la demande, et peut « ignorer » les pauses. */
class FakePlayer {
  paused = true
  uri: string | null = null
  startedAt = 0
  ignorePause = false
  pauses: number[] = []
  listeners: Record<string, ((arg: unknown) => void)[]> = {}

  startPlaying(uri: string) {
    setTimeout(() => {
      this.uri = uri
      this.paused = false
      this.startedAt = Date.now()
    }, 200)
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
    if (!this.paused) this.pauses.push(Date.now() - this.startedAt)
    if (!this.ignorePause) this.paused = true
  }
  async resume() {}
  async seek() {}
  async setVolume() {}
  async getVolume() {
    return 1
  }
  async activateElement() {}
}

let fake: FakePlayer

beforeEach(() => {
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
    fake.ignorePause = true
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
})
