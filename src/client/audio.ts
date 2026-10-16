// Analyse d'un extrait audio : où commence vraiment le son ?

/** Fenêtre d'analyse, en secondes. */
const WINDOW_S = 0.01
/** On ne saute jamais plus que ça, au cas où l'extrait serait très calme. */
const MAX_SKIP_S = 10

/**
 * Renvoie le moment (en secondes) où le son démarre, en ignorant le silence du début.
 * Le seuil s'adapte au volume de l'extrait, pour ne pas confondre un début doux avec du silence.
 */
export function findSoundStart(channels: Float32Array[], sampleRate: number): number {
  const size = Math.max(1, Math.round(WINDOW_S * sampleRate))
  const length = channels[0]?.length ?? 0
  const levels: number[] = []
  for (let start = 0; start < length; start += size) {
    let sum = 0
    const end = Math.min(start + size, length)
    for (const channel of channels) {
      for (let i = start; i < end; i++) sum += channel[i] * channel[i]
    }
    levels.push(Math.sqrt(sum / ((end - start) * channels.length)))
  }
  const loudest = Math.max(0, ...levels)
  if (loudest === 0) return 0
  const threshold = Math.max(0.003, loudest * 0.03)
  const first = levels.findIndex((level) => level > threshold)
  if (first <= 0) return 0
  // On garde quelques millisecondes avant, pour ne pas couper l'attaque de la première note.
  return Math.min(Math.max(0, first * WINDOW_S - 0.05), MAX_SKIP_S)
}

/** Décode un fichier audio et renvoie le début du son (0 si l'analyse échoue). */
export async function detectSoundStart(data: ArrayBuffer): Promise<number> {
  const Context =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Context) return 0
  const context = new Context()
  try {
    const buffer = await context.decodeAudioData(data)
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
    return findSoundStart(channels, buffer.sampleRate)
  } catch {
    return 0
  } finally {
    context.close().catch(() => {})
  }
}
