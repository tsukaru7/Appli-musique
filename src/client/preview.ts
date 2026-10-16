// Lecture des extraits Deezer (servis par notre serveur) : début du son repéré, coupure précise.
import { detectSoundStart } from './audio.ts'

export class PreviewPlayer {
  private readonly audio = new Audio()
  private url: string | null = null
  private blobUrl: string | null = null
  private loading: Promise<void> | null = null
  private frame = 0
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
      const res = await fetch(url)
      if (!res.ok) throw new Error("Cet extrait n'a pas pu être chargé.")
      const data = await res.arrayBuffer()
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
    const tick = () => {
      if (this.audio.paused || (this.audio.currentTime - start) * 1000 >= durationMs) this.audio.pause()
      else this.frame = requestAnimationFrame(tick)
    }
    tick()
  }

  /** Révélation : l'extrait entier. */
  async playFull(url: string): Promise<void> {
    await this.load(url)
    this.stop()
    this.audio.currentTime = 0
    await this.audio.play()
  }

  stop(): void {
    cancelAnimationFrame(this.frame)
    this.audio.pause()
  }

  dispose(): void {
    this.stop()
    this.url = null
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl)
    this.blobUrl = null
  }
}
