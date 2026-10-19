// Minuteurs qui restent précis quand l'onglet est caché.
//
// Quand on change de fenêtre ou d'onglet, le navigateur ralentit fortement les minuteurs de la page
// (au mieux un par seconde, parfois un par minute) et arrête complètement requestAnimationFrame :
// l'extrait ne se couperait plus à temps. Les minuteurs d'un « worker » ne sont pas ralentis.

const WORKER_SOURCE = `
  const timers = new Map()
  onmessage = (e) => {
    const { id, ms, cancel } = e.data
    if (cancel) { clearTimeout(timers.get(id)); timers.delete(id); return }
    timers.set(id, setTimeout(() => { timers.delete(id); postMessage(id) }, ms))
  }
`

let worker: Worker | null | undefined
let nextId = 0
const callbacks = new Map<number, () => void>()

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
    worker = new Worker(url)
    worker.onmessage = (e: MessageEvent<number>) => {
      const cb = callbacks.get(e.data)
      callbacks.delete(e.data)
      cb?.()
    }
  } catch {
    worker = null // pas de worker possible : minuteurs ordinaires
  }
  return worker
}

/** Comme setTimeout, mais pas ralenti quand l'onglet est caché. Renvoie de quoi l'annuler. */
export function preciseTimeout(cb: () => void, ms: number): () => void {
  const w = getWorker()
  if (!w) {
    const t = setTimeout(cb, ms)
    return () => clearTimeout(t)
  }
  const id = ++nextId
  callbacks.set(id, cb)
  w.postMessage({ id, ms: Math.max(0, ms) })
  return () => {
    if (!callbacks.delete(id)) return
    w.postMessage({ id, cancel: true })
  }
}

/** Attente qui reste précise quand l'onglet est caché. */
export function preciseSleep(ms: number): Promise<void> {
  return new Promise((resolve) => preciseTimeout(resolve, ms))
}
