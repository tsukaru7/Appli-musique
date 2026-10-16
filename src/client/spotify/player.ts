// Lecteur Spotify dans le navigateur (Web Playback SDK) : ne fonctionne que sur ordinateur, avec Premium.
import { spotifyFetch } from './api.ts'
import { getAccessToken } from './auth.ts'

interface PlaybackState {
  paused: boolean
  position: number
  /** Moment (horloge du navigateur, en ms) où `position` a été mesurée. */
  timestamp?: number
  track_window: { current_track: { uri: string; linked_from?: { uri: string | null } } | null }
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

/**
 * Joue des extraits d'un morceau depuis son début, d'une durée précise.
 *
 * On ne se fie pas aux événements du lecteur (pas toujours envoyés à temps) : on interroge son
 * état en boucle, et on coupe toujours le son à la fin, quoi qu'il arrive.
 */
export class SnippetPlayer {
  private playId = 0

  private constructor(
    private readonly player: SdkPlayer,
    private deviceId: string,
  ) {
    // Si le lecteur se reconnecte, Spotify peut lui donner un nouvel identifiant.
    player.addListener('ready', ({ device_id }) => {
      this.deviceId = device_id
    })
  }

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

  /** Interroge l'état du lecteur jusqu'à ce que la condition soit vraie (null si délai dépassé). */
  private async waitFor(check: (s: PlaybackState) => boolean, timeoutMs: number): Promise<PlaybackState | null> {
    const end = performance.now() + timeoutMs
    while (performance.now() < end) {
      const state = await this.player.getCurrentState()
      if (state && check(state)) return state
      await sleep(30)
    }
    return null
  }

  private isPlaying(state: PlaybackState, uri: string): boolean {
    const track = state.track_window.current_track
    return !state.paused && track !== null && (track.uri === uri || track.linked_from?.uri === uri)
  }

  /** Coupe le son et vérifie qu'il est vraiment coupé ; sinon on passe par l'API web de Spotify. */
  private async forcePause(): Promise<void> {
    await this.player.pause().catch(() => {})
    if (await this.waitFor((s) => s.paused, 800)) return
    await spotifyFetch(`/me/player/pause?device_id=${this.deviceId}`, { method: 'PUT' }).catch(() => {})
  }

  /** Lance le morceau depuis le début et attend qu'il joue vraiment. */
  private async startFromBeginning(uri: string): Promise<PlaybackState> {
    await spotifyFetch(`/me/player/play?device_id=${this.deviceId}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [uri], position_ms: 0 }),
    })
    const state = await this.waitFor((s) => this.isPlaying(s, uri), 6000)
    if (!state) throw new Error('Le lecteur Spotify ne démarre pas. Recharge la page.')
    return state
  }

  /**
   * Joue les `durationMs` premières millisecondes du morceau.
   * `onStart` est appelé quand le son démarre vraiment (pour lancer la barre de progression).
   */
  async playSnippet(uri: string, durationMs: number, onStart?: () => void): Promise<void> {
    const id = ++this.playId
    // Filet de sécurité : même si quelque chose bloque, le son est coupé.
    const safety = setTimeout(() => {
      if (id === this.playId) this.forcePause()
    }, durationMs + 8000)
    try {
      await this.player.pause().catch(() => {})
      const state = await this.startFromBeginning(uri)
      if (id !== this.playId) return
      onStart?.()
      // Temps déjà joué au moment où on a lu l'état du lecteur.
      // (on ignore la valeur si elle n'a pas l'air d'être un horodatage récent)
      const age = state.timestamp ? Date.now() - state.timestamp : 0
      const sinceMeasure = age > 0 && age < 1000 ? age : 0
      const end = performance.now() + durationMs - state.position - sinceMeasure
      // Attente découpée, pour s'arrêter tout de suite si un autre extrait est lancé entre-temps.
      while (id === this.playId && performance.now() < end) await sleep(Math.min(50, end - performance.now()))
    } finally {
      clearTimeout(safety)
      if (id === this.playId) await this.forcePause()
    }
  }

  /** Révélation : on laisse le morceau tourner depuis le début. */
  async playFull(uri: string): Promise<void> {
    this.playId++
    await this.startFromBeginning(uri)
  }

  async stop(): Promise<void> {
    this.playId++
    await this.forcePause()
  }

  disconnect(): void {
    this.player.disconnect()
  }
}
