// Lecture des extraits Deezer (servis par notre serveur) : début du son repéré, coupure précise.
import { detectSoundStart } from './audio.ts'
import { preciseTimeout } from './timers.ts'

/** Télécharge l'extrait (25 s maximum par essai), avec un second essai si le premier échoue. */
async function download(url: string): Promise<ArrayBuffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.arrayBuffer()
    } catch {
      if (attempt >= 1) throw new Error("Cet extrait n'a pas pu être chargé.")
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

export class PreviewPlayer {
  private readonly audio = new Audio()
  private url: string | null = null
  private blobUrl: string | null = null
  private loading: Promise<void> | null = null
  /** Annule la surveillance de la fin de l'extrait en cours. */
  private cancelWatch: () => void = () => {}
  /** Moment où le son commence vraiment dans l'extrait (le silence du début est sauté). */
  private soundStart = 0

  constructor() {
    this.audio.preload = 'auto'
  }

  /** Télécharge l'extrait une seule fois par adresse, et repère où le son commence. */
  load(url: string): Promise<void> {
    if (this.url === url && this.loading) return this.loading
    this.stop()
    this.url = url
    this.soundStart = 0
    this.loading = (async () => {
      const data = await download(url)
      const start = await detectSoundStart(data.slice(0))
      if (this.url !== url) return
      if (this.blobUrl) URL.revokeObjectURL(this.blobUrl)
      this.blobUrl = URL.createObjectURL(new Blob([data], { type: 'audio/mpeg' }))
      this.audio.src = this.blobUrl
      this.soundStart = start
    })()
    this.loading.catch(() => {
      if (this.url === url) this.loading = null
    })
    return this.loading
  }

  /**
   * Joue `durationMs` de son depuis le début de l'extrait, puis coupe.
   * `onStart` est appelé quand la lecture démarre vraiment (pour lancer l'animation).
   */
  async play(url: string, durationMs: number, onStart?: () => void): Promise<void> {
    await this.load(url)
    this.stop()
    const start = this.soundStart
    this.audio.currentTime = start
    await this.audio.play()
    onStart?.()
    // On regarde où en est le son (pas une horloge) pour couper pile à la fin, même onglet caché.
    const end = start + durationMs / 1000
    const watch = () => {
      if (this.audio.paused) return
      const leftMs = (end - this.audio.currentTime) * 1000
      if (leftMs <= 4) return this.audio.pause()
      this.cancelWatch = preciseTimeout(watch, Math.min(leftMs - 2, 40))
    }
    watch()
  }

  /** Révélation : l'extrait entier. */
  async playFull(url: string): Promise<void> {
    await this.load(url)
    this.stop()
    this.audio.currentTime = 0
    await this.audio.play()
  }

  stop(): void {
    this.cancelWatch()
    this.audio.pause()
  }

  dispose(): void {
    this.stop()
    this.url = null
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl)
    this.blobUrl = null
  }
}
