// Lecteur Spotify dans le navigateur (Web Playback SDK) : ne fonctionne que sur ordinateur, avec Premium.
import { SpotifyError, spotifyFetch } from './api.ts'
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

const VOLUME = 0.8

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
  /** Morceau chargé dans le lecteur (en pause au début, prêt à être joué). */
  private loadedUri: string | null = null
  /** Identifiant réellement joué par Spotify (il peut différer : autre version du même morceau). */
  private loadedActual: string | null = null
  /** Journal des étapes de lecture, affiché à l'hôte pour comprendre un problème de son. */
  onLog?: (line: string) => void

  private log(line: string): void {
    const time = new Date().toLocaleTimeString('fr-FR')
    this.onLog?.(`${time} · ${line}`)
  }

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
      volume: VOLUME,
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
    return (
      !state.paused &&
      track !== null &&
      (track.uri === uri || track.linked_from?.uri === uri || track.uri === this.loadedActual)
    )
  }

  /**
   * Attend que le morceau demandé joue. Spotify remplace parfois un morceau par une autre version
   * (autre album, autre pays) avec un autre identifiant : passé 2,5 s, on accepte tout morceau qui joue.
   */
  private async waitPlaying(uri: string, timeoutMs: number): Promise<PlaybackState | null> {
    const start = performance.now()
    const state = await this.waitFor(
      (s) => this.isPlaying(s, uri) || (performance.now() - start > 2500 && !s.paused && s.track_window.current_track !== null),
      timeoutMs,
    )
    if (state && state.track_window.current_track?.uri !== uri) {
      this.log(`Spotify joue une autre version (${state.track_window.current_track?.uri})`)
    }
    return state
  }

  private async requestPlay(uri: string, positionMs: number, retried = false): Promise<void> {
    try {
      await spotifyFetch(`/me/player/play?device_id=${this.deviceId}`, {
        method: 'PUT',
        body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
      })
      this.log(`Demande de lecture envoyée (${uri})`)
    } catch (err) {
      this.log(`Spotify a refusé la lecture : ${(err as Error).message}`)
      // 404 : Spotify ne connaît plus ce lecteur (déconnecté en cours de partie) → on le reconnecte.
      if (!retried && err instanceof SpotifyError && err.status === 404) {
        await this.reconnect()
        return this.requestPlay(uri, positionMs, true)
      }
      throw err
    }
  }

  /** Reconnecte le lecteur à Spotify (il reçoit alors un nouvel identifiant). */
  private async reconnect(): Promise<void> {
    this.log('Lecteur perdu par Spotify : reconnexion…')
    this.loadedUri = null
    let onReady: (() => void) | undefined
    const ready = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 6000)
      onReady = () => {
        clearTimeout(timer)
        resolve()
      }
      this.player.addListener('ready', onReady)
    })
    this.player.disconnect()
    await this.player.connect()
    await ready
    this.player.removeListener('ready', onReady)
    this.log('Lecteur reconnecté')
  }

  /** Coupe le son et vérifie qu'il est vraiment coupé ; sinon on passe par l'API web de Spotify. */
  private async forcePause(): Promise<void> {
    await this.player.pause().catch(() => {})
    if (await this.waitFor((s) => s.paused, 800)) return
    await spotifyFetch(`/me/player/pause?device_id=${this.deviceId}`, { method: 'PUT' }).catch(() => {})
  }

  /**
   * Charge un nouveau morceau **en silence** et le laisse en pause au tout début.
   *
   * Quand on change de morceau, le lecteur Spotify rejoue souvent un bref bout de l'ancien :
   * le son est coupé pendant le changement pour qu'on ne l'entende pas.
   */
  private async prepare(uri: string): Promise<void> {
    this.loadedUri = null
    this.loadedActual = null
    await this.player.setVolume(0).catch(() => {})
    try {
      await this.requestPlay(uri, 0)
      const state = await this.waitPlaying(uri, 5000)
      if (!state) throw new Error('le morceau ne démarre pas dans le lecteur')
      this.loadedActual = state.track_window.current_track?.uri ?? null
      await this.forcePause()
      await this.player.seek(0)
      this.loadedUri = uri
      this.log('Morceau chargé')
    } finally {
      await this.player.setVolume(VOLUME).catch(() => {})
    }
  }

  /**
   * Repart du début du morceau (ou de `startMs`), sans repasser par Spotify s'il est déjà chargé,
   * et attend que ça joue.
   */
  private async resumeFromBeginning(uri: string, startMs = 0): Promise<PlaybackState> {
    const state = await this.player.getCurrentState()
    const loaded = state?.track_window.current_track
    const stillLoaded =
      this.loadedUri === uri && loaded && (loaded.uri === uri || loaded.uri === this.loadedActual || loaded.linked_from?.uri === uri)
    if (!stillLoaded) await this.prepare(uri)
    await this.player.setVolume(VOLUME).catch(() => {})
    await this.player.seek(startMs)
    await this.player.resume()
    const playing = await this.waitPlaying(uri, 4000)
    if (!playing) throw new Error('la reprise de lecture ne répond pas')
    return playing
  }

  /** Méthode de secours, la plus simple : on demande à Spotify de jouer le morceau à la bonne position. */
  private async playDirect(uri: string, startMs: number): Promise<PlaybackState> {
    this.loadedUri = null
    await this.player.setVolume(VOLUME).catch(() => {})
    await this.requestPlay(uri, startMs)
    const state = await this.waitPlaying(uri, 4500)
    if (!state) throw new Error('Spotify ne lance pas ce morceau.')
    return state
  }

  /**
   * Joue les `durationMs` premières millisecondes du morceau.
   * `onStart` est appelé quand le son démarre vraiment (pour lancer la barre de progression).
   * `startMs` permet de sauter un silence au début du morceau.
   */
  async playSnippet(uri: string, durationMs: number, onStart?: () => void, startMs = 0): Promise<void> {
    const id = ++this.playId
    // Filet de sécurité : même si quelque chose bloque, le son est coupé.
    const safety = setTimeout(() => {
      if (id === this.playId) this.forcePause()
    }, durationMs + 12000)
    try {
      await this.player.pause().catch(() => {})
      let state: PlaybackState
      try {
        state = await this.resumeFromBeginning(uri, startMs)
      } catch (err) {
        this.log(`Lecture normale impossible (${(err as Error).message}) : méthode de secours`)
        state = await this.playDirect(uri, startMs)
      }
      if (id !== this.playId) return
      this.log(`Extrait de ${durationMs / 1000} s en cours`)
      onStart?.()
      // Temps déjà joué au moment où on a lu l'état du lecteur.
      // (on ignore la valeur si elle n'a pas l'air d'être un horodatage récent)
      const age = state.timestamp ? Date.now() - state.timestamp : 0
      const sinceMeasure = age > 0 && age < 1000 ? age : 0
      const played = Math.max(0, state.position - startMs)
      const end = performance.now() + durationMs - played - sinceMeasure
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
    try {
      await this.resumeFromBeginning(uri)
    } catch {
      await this.playDirect(uri, 0)
    }
  }

  async stop(): Promise<void> {
    this.playId++
    await this.forcePause()
  }

  disconnect(): void {
    this.player.disconnect()
  }
}
