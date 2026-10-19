// Sauvegarde chiffrée d'une partie, gardée par l'ordinateur de l'hôte.
//
// Les parties ne vivent qu'en mémoire : si le serveur redémarre (mise à jour sur Render, mise en
// veille…), elles disparaissent. Le serveur confie donc à l'hôte une sauvegarde de sa partie, qu'il
// renvoie à sa reconnexion. Elle est chiffrée (on ne peut pas y lire les réponses) et authentifiée
// (on ne peut pas la modifier pour se donner des points).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

function key(): Buffer {
  const secret = process.env.SNAPSHOT_SECRET || process.env.HOST_PASSWORD || 'appli-musique'
  return createHash('sha256').update(`sauvegarde:${secret}`).digest()
}

/** Compresse et chiffre une valeur (texte base64 : iv + étiquette + données). */
export function seal(value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(deflateRawSync(JSON.stringify(value))), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
}

/** L'inverse de `seal` ; null si la sauvegarde est abîmée, modifiée, ou vient d'un autre serveur. */
export function unseal<T>(text: unknown): T | null {
  if (typeof text !== 'string' || text.length > 20_000_000) return null
  try {
    const raw = Buffer.from(text, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    const data = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()])
    return JSON.parse(inflateRawSync(data).toString('utf8')) as T
  } catch {
    return null
  }
}
