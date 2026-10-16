// Lecteur Spotify dans le navigateur (Web Playback SDK) : ne fonctionne que sur ordinateur, avec Premium.
import { spotifyFetch } from './api.ts'
import { getAccessToken } from './auth.ts'

interface PlaybackState {
  paused: boolean
  position: number
  track_window: { current_track: { uri: string } | null }
}

interface SdkPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  addListener(event: string, cb: (arg: any) => void): boolean
  removeListener(event: string, cb?: (arg: any) => void): boolean
  getCurrentState(): Promise<PlaybackState | null>
  setVolume(volume: number): Promise<void>
  getVolume(): Promise<number>
  pause(): Promise<void>
  resume(): Promise<void>
  seek(positionMs: number): Promise<void>
  activateElement(): Promise<void>
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void
    Spotify?: {
      Player: new (options: {
        name: string
        getOAuthToken: (cb: (token: string) => void) => void
        volume?: number
      }) => SdkPlayer
    }
  }
}

let sdkLoading: Promise<void> | null = null

function loadSdk(): Promise<void> {
  sdkLoading ??= new Promise((resolve) => {
    if (window.Spotify) return resolve()
    window.onSpotifyWebPlaybackSDKReady = () => resolve()
    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    document.body.appendChild(script)
  })
  return sdkLoading
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const ERRORS: Record<string, string> = {
  initialization_error: "Ce navigateur ne peut pas lire Spotify. Utilise Chrome, Edge ou Firefox sur un ordinateur.",
  authentication_error: 'Connexion Spotify expirée : reconnecte-toi.',
  account_error: 'Il faut un compte Spotify Premium pour jouer le son.',
}

/** Joue des extraits d'un morceau depuis son début, d'une durée précise. */
export class SnippetPlayer {
  private loadedUri: string | null = null
  private playId = 0
  private volume = 0.8

  private constructor(
    private readonly player: SdkPlayer,
    readonly deviceId: string,
  ) {}

  static async create(onError: (message: string) => void): Promise<SnippetPlayer> {
    await loadSdk()
    const player = new window.Spotify!.Player({
      name: 'Appli-musique',
      getOAuthToken: (cb) => {
        getAccessToken().then(cb, (err) => onError(String(err.message ?? err)))
      },
      volume: 0.8,
    })
    const deviceId = await new Promise<string>((resolve, reject) => {
      player.addListener('ready', ({ device_id }) => resolve(device_id))
      for (const [event, message] of Object.entries(ERRORS)) {
        player.addListener(event, () => {
          onError(message)
          reject(new Error(message))
        })
      }
      player.addListener('playback_error', ({ message }) => onError(`Erreur de lecture : ${message}`))
      player.connect().then((ok) => {
        if (!ok) reject(new Error('Impossible de démarrer le lecteur Spotify.'))
      })
    })
    return new SnippetPlayer(player, deviceId)
  }

  /** À appeler lors d'un clic : autorise le navigateur à jouer du son. */
  activate(): Promise<void> {
    return this.player.activateElement()
  }

  setVolume(volume: number): Promise<void> {
    this.volume = volume
    return this.player.setVolume(volume)
  }

  /** Attend un état du lecteur qui vérifie la condition (ou échoue après le délai). */
  private waitForState(check: (s: PlaybackState) => boolean, timeoutMs = 8000): Promise<PlaybackState> {
    return new Promise((resolve, reject) => {
      const onChange = (state: PlaybackState | null) => {
        if (state && check(state)) {
          cleanup()
          resolve(state)
        }
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('Le lecteur Spotify ne répond pas.'))
      }, timeoutMs)
      const cleanup = () => {
        clearTimeout(timer)
        this.player.removeListener('player_state_changed', onChange)
      }
      this.player.addListener('player_state_changed', onChange)
      this.player.getCurrentState().then(onChange)
    })
  }

  /** Charge le morceau en silence et le met en pause au tout début. */
  async load(uri: string): Promise<void> {
    if (this.loadedUri === uri) return
    this.playId++
    await this.player.setVolume(0)
    try {
      await spotifyFetch(`/me/player/play?device_id=${this.deviceId}`, {
        method: 'PUT',
        body: JSON.stringify({ uris: [uri], position_ms: 0 }),
      })
      await this.waitForState((s) => !s.paused && s.track_window.current_track !== null)
      await this.player.pause()
      await this.waitForState((s) => s.paused)
      await this.player.seek(0)
      this.loadedUri = uri
    } finally {
      await this.player.setVolume(this.volume)
    }
  }

  /**
   * Joue les `durationMs` premières millisecondes du morceau.
   * `onStart` est appelé quand le son démarre vraiment (pour lancer la barre de progression).
   */
  async playSnippet(uri: string, durationMs: number, onStart?: () => void): Promise<void> {
    await this.load(uri)
    const id = ++this.playId
    await this.player.pause()
    await this.player.seek(0)
    await this.player.resume()
    const state = await this.waitForState((s) => !s.paused)
    if (id !== this.playId) return
    onStart?.()
    await sleep(Math.max(0, durationMs - state.position))
    if (id === this.playId) await this.player.pause()
  }

  /** Révélation : on laisse le morceau tourner depuis le début. */
  async playFull(uri: string): Promise<void> {
    await this.load(uri)
    this.playId++
    await this.player.seek(0)
    await this.player.resume()
  }

  async stop(): Promise<void> {
    this.playId++
    await this.player.pause()
  }

  disconnect(): void {
    this.player.disconnect()
  }
}
