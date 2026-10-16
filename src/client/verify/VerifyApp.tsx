import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeText } from '../../shared/answers.ts'
import { PACKS } from '../../shared/packs/index.ts'
import { Cover, Icon, PACK_ICONS, Wordmark } from '../components.tsx'

// Page « Vérifier les musiques » : écouter la musique choisie pour chaque œuvre des packs,
// et la remplacer par la bonne version si besoin.

type Kind = 'exact' | 'manual' | 'cover'

interface Match {
  id: number
  kind: Kind
  title: string
  artist: string
  album: string
  cover?: string
  preview?: string
}

interface Row {
  key: string
  work: string
  title: string
  artist: string
  match: Match | null
  removed?: boolean
  added?: boolean
}

interface Added {
  packId: string
  work: string
  match: Match
}

/** Œuvres retirées et ajoutées sur cet appareil (renvoyées au serveur à chaque ouverture). */
interface Edits {
  removed: string[]
  added: Record<string, Added>
}

const PASSWORD_KEY = 'hostPassword'
const CHANGES_KEY = 'packOverrides'
const EDITS_KEY = 'packEdits'

function readEdits(): Edits {
  try {
    const edits = JSON.parse(localStorage.getItem(EDITS_KEY) ?? 'null')
    return { removed: edits?.removed ?? [], added: edits?.added ?? {} }
  } catch {
    return { removed: [], added: {} }
  }
}

/** Cherche si une œuvre est déjà dans un pack (même nom, autre nom accepté, ou nom proche). */
function findExisting(name: string, edits: Edits): { exact?: string; similar: string[] } {
  const wanted = normalizeText(name)
  const similar: string[] = []
  if (wanted.length < 2) return { similar }
  const all = [
    ...PACKS.flatMap((pack) =>
      pack.entries.map(([work, title, , aliases]) => ({ pack: pack.title, work, title, names: [work, ...(aliases ?? [])] })),
    ),
    ...Object.values(edits.added).map((a) => ({
      pack: PACKS.find((p) => p.id === a.packId)?.title ?? a.packId,
      work: a.work,
      title: a.match.title,
      names: [a.work],
    })),
  ]
  for (const entry of all) {
    const names = entry.names.map(normalizeText)
    const label = `« ${entry.work} » dans ${entry.pack} (${entry.title})`
    if (names.includes(wanted)) return { exact: label, similar }
    if (wanted.length >= 4 && names.some((n) => n.includes(wanted) || (n.length >= 4 && wanted.includes(n)))) {
      similar.push(label)
    }
  }
  return { similar: similar.slice(0, 4) }
}

const KIND_LABELS: Record<Kind | 'none', { text: string; tone: string }> = {
  exact: { text: 'Version officielle', tone: 'good' },
  manual: { text: 'Choisie à la main', tone: 'good' },
  cover: { text: 'Reprise, à écouter', tone: 'warn' },
  none: { text: 'Introuvable', tone: 'bad' },
}

type Filter = 'all' | 'check' | 'missing'

function readChanges(): Record<string, Match> {
  try {
    return JSON.parse(localStorage.getItem(CHANGES_KEY) ?? '{}')
  } catch {
    return {}
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-host-password': localStorage.getItem(PASSWORD_KEY) ?? '',
      ...init.headers,
    },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`)
  return data as T
}

export function VerifyApp() {
  const [packId, setPackId] = useState(PACKS[0].id)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('check')
  const [editing, setEditing] = useState<string | null>(null)
  const [playing, setPlaying] = useState<number | null>(null)
  const [changes, setChanges] = useState<Record<string, Match>>(readChanges)
  const [edits, setEdits] = useState<Edits>(readEdits)
  const [adding, setAdding] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showText, setShowText] = useState(false)
  const audio = useMemo(() => new Audio(), [])
  const stopTimer = useRef(0)
  const [needsPassword, setNeedsPassword] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/info')
      .then((r) => r.json())
      .then((info: { hostPasswordRequired: boolean }) => setNeedsPassword(info.hostPasswordRequired))
      .catch(() => setNeedsPassword(false))
  }, [])

  // Numéro de la dernière demande : la réponse d'un onglet quitté entre-temps est ignorée.
  const lastRequest = useRef(0)

  const load = useCallback(
    (refresh = false) => {
      const request = ++lastRequest.current
      setRows(null)
      setError(null)
      api<Row[]>(`/api/check/${packId}${refresh ? '?refresh=1' : ''}`)
        .then((data) => {
          if (request !== lastRequest.current) return
          // Les choix déjà faits sur cet appareil gardent la priorité.
          const local = readEdits()
          const merged = data.map((row) => ({
            ...row,
            match: changes[row.key] ?? row.match,
            removed: row.removed || local.removed.includes(row.key),
          }))
          for (const [key, added] of Object.entries(local.added)) {
            if (added.packId !== packId || merged.some((r) => r.key === key)) continue
            merged.push({
              key,
              work: added.work,
              title: added.match.title,
              artist: added.match.artist,
              match: added.match,
              removed: local.removed.includes(key),
              added: true,
            })
          }
          setRows(merged)
        })
        .catch((err) => request === lastRequest.current && setError(err.message))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [packId],
  )

  useEffect(() => load(), [load])

  // Les choix enregistrés sur cet appareil sont renvoyés au serveur (il les oublie s'il redémarre).
  useEffect(() => {
    for (const [key, match] of Object.entries(readChanges())) {
      api('/api/override', { method: 'POST', body: JSON.stringify({ key, match }) }).catch(() => {})
    }
    const local = readEdits()
    for (const key of local.removed) {
      api('/api/pack-edit', { method: 'POST', body: JSON.stringify({ action: 'remove', key }) }).catch(() => {})
    }
    for (const added of Object.values(local.added)) {
      api('/api/pack-edit', { method: 'POST', body: JSON.stringify({ action: 'add', ...added }) }).catch(() => {})
    }
  }, [])

  useEffect(() => () => audio.pause(), [audio])

  const play = (match: Match) => {
    clearTimeout(stopTimer.current)
    if (playing === match.id) {
      audio.pause()
      setPlaying(null)
      return
    }
    if (!match.preview) return
    audio.src = match.preview
    audio.currentTime = 0
    audio.play().catch(() => setError("Impossible de lire l'extrait. Clique sur « Actualiser » puis réessaie."))
    setPlaying(match.id)
    stopTimer.current = window.setTimeout(() => {
      audio.pause()
      setPlaying(null)
    }, 15000)
  }

  const saveEdits = (next: Edits) => {
    setEdits(next)
    localStorage.setItem(EDITS_KEY, JSON.stringify(next))
  }

  const setRemoved = async (row: Row, removed: boolean) => {
    await api('/api/pack-edit', {
      method: 'POST',
      body: JSON.stringify({ action: removed ? 'remove' : 'restore', key: row.key }),
    })
    const others = edits.removed.filter((k) => k !== row.key)
    saveEdits({ ...edits, removed: removed ? [...others, row.key] : others })
    setRows((current) => current?.map((r) => (r.key === row.key ? { ...r, removed } : r)) ?? null)
  }

  const addWork = async (work: string, match: Match) => {
    const chosen = { ...match, kind: 'manual' as const }
    const added: Added = { packId, work: work.trim(), match: chosen }
    await api('/api/pack-edit', { method: 'POST', body: JSON.stringify({ action: 'add', ...added }) })
    const key = `${packId}/${added.work}`
    saveEdits({ ...edits, added: { ...edits.added, [key]: added } })
    const row: Row = { key, work: added.work, title: chosen.title, artist: chosen.artist, match: chosen, added: true }
    setRows((current) => [...(current ?? []).filter((r) => r.key !== key), row])
    setAdding(false)
    setEditing(null)
  }

  const choose = async (row: Row, match: Match) => {
    if (row.added) return addWork(row.work, match)
    const chosen = { ...match, kind: 'manual' as const }
    await api('/api/override', { method: 'POST', body: JSON.stringify({ key: row.key, match: chosen }) })
    const next = { ...changes, [row.key]: chosen }
    setChanges(next)
    localStorage.setItem(CHANGES_KEY, JSON.stringify(next))
    setRows((current) => current?.map((r) => (r.key === row.key ? { ...r, match: chosen } : r)) ?? null)
    setEditing(null)
  }

  const exportText = [
    Object.keys(changes).length > 0 && '// Corrections (pack/œuvre : id Deezer)',
    ...Object.entries(changes).map(
      ([key, match]) => `  ${JSON.stringify(key)}: ${match.id}, // ${match.title} — ${match.artist}`,
    ),
    edits.removed.length > 0 && '// Œuvres retirées',
    ...edits.removed.map((key) => `  ${JSON.stringify(key)},`),
    Object.keys(edits.added).length > 0 && '// Œuvres ajoutées (pack, œuvre, id Deezer, morceau)',
    ...Object.values(edits.added).map(
      (a) =>
        `  [${JSON.stringify(a.packId)}, ${JSON.stringify(a.work)}, ${a.match.id}], // ${a.match.title} — ${a.match.artist}`,
    ),
  ]
    .filter(Boolean)
    .join('\n')
  const editCount = Object.keys(changes).length + edits.removed.length + Object.keys(edits.added).length

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Copie refusée par le navigateur : on affiche le texte pour le copier à la main.
      setShowText(true)
    }
  }

  const counts = useMemo(() => {
    const c = { exact: 0, manual: 0, cover: 0, none: 0 }
    for (const row of rows ?? []) if (!row.removed) c[row.match?.kind ?? 'none']++
    return c
  }, [rows])

  const shown = (rows ?? []).filter((row) => {
    if (filter === 'missing') return !row.removed && !row.match
    if (filter === 'check') return !row.removed && (!row.match || row.match.kind === 'cover')
    return true
  })

  if (needsPassword === null) return null
  if (needsPassword && !localStorage.getItem(PASSWORD_KEY)) {
    return (
      <main className="splash">
        <Wordmark large />
        <p className="lede">Ouvre d'abord la page d'accueil et entre le mot de passe hôte.</p>
        <a className="btn btn-primary" href="/">
          Aller à l'accueil
        </a>
      </main>
    )
  }

  return (
    <div className="app">
      <header className="appbar">
        <a href="/" className="wordmark-link">
          <Wordmark />
        </a>
        <span className="muted small">Vérifier les musiques</span>
        <a className="btn btn-ghost" href="/">
          Retour au jeu
        </a>
      </header>

      <main className="page verify">
        <div className="setup-head">
          <span className="eyebrow">Packs thématiques</span>
          <h1 className="display">Vérifier les musiques</h1>
          <p className="muted">
            Écoute la musique choisie pour chaque œuvre. Si ce n'est pas la bonne, clique sur « Changer » et choisis la
            bonne version. Envoie ensuite la liste des corrections à Claude pour qu'elles deviennent définitives.
          </p>
        </div>

        <div className="tabs" role="tablist">
          {PACKS.map((pack) => (
            <button
              key={pack.id}
              role="tab"
              aria-selected={pack.id === packId}
              className={pack.id === packId ? 'is-on' : ''}
              onClick={() => {
                setPackId(pack.id)
                setEditing(null)
              }}
            >
              <Icon name={PACK_ICONS[pack.id] ?? 'list'} size={16} />
              {pack.title}
            </button>
          ))}
        </div>

        {error && <p className="notice is-bad">{error}</p>}

        {rows === null && !error ? (
          <p className="notice">Recherche des musiques sur Deezer… (environ une minute la première fois)</p>
        ) : (
          <>
            <div className="verify-summary">
              <span className="tone-good">{counts.exact + counts.manual} sûres</span>
              <span className="tone-warn">{counts.cover} reprises à écouter</span>
              <span className="tone-bad">{counts.none} introuvables</span>
              <span className="grow" />
              <div className="segmented">
                {(
                  [
                    ['check', 'À vérifier'],
                    ['missing', 'Introuvables'],
                    ['all', 'Tout'],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} className={filter === id ? 'is-on' : ''} onClick={() => setFilter(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <button className="btn btn-ghost" onClick={() => load(true)}>
                <Icon name="replay" size={16} />
                Actualiser
              </button>
            </div>

            <div className="add-work">
              {adding ? (
                <AddPanel
                  packTitle={PACKS.find((p) => p.id === packId)?.title ?? ''}
                  edits={edits}
                  playing={playing}
                  onPlay={play}
                  onAdd={addWork}
                  onCancel={() => setAdding(false)}
                />
              ) : (
                <button className="btn" onClick={() => setAdding(true)}>
                  + Ajouter une œuvre à « {PACKS.find((p) => p.id === packId)?.title} »
                </button>
              )}
            </div>

            <ul className="verify-list">
              {shown.map((row) => {
                const kind = KIND_LABELS[row.match?.kind ?? 'none']
                return (
                  <li key={row.key} className={`verify-row ${row.removed ? 'is-removed' : ''}`}>
                    <div className="verify-main">
                      <span className="verify-cover">{row.match?.cover && <Cover src={row.match.cover} />}</span>
                      <div className="verify-text">
                        <strong>
                          {row.work}
                          {row.added && <span className="mini-badge">Ajoutée</span>}
                          {row.removed && <span className="mini-badge is-bad">Retirée</span>}
                        </strong>
                        <span className="muted small">
                          Attendu : {row.title}
                          {row.artist && ` — ${row.artist}`}
                        </span>
                        {row.match ? (
                          <span className="small">
                            Joué : {row.match.title} — {row.match.artist}
                            <span className="muted"> · {row.match.album}</span>
                          </span>
                        ) : (
                          <span className="small muted">Aucune musique trouvée : cette œuvre est ignorée en partie.</span>
                        )}
                      </div>
                      <span className={`kind tone-${kind.tone}`}>{kind.text}</span>
                      <div className="verify-actions">
                        {row.match?.preview && (
                          <button className="btn" onClick={() => play(row.match!)}>
                            <Icon name={playing === row.match.id ? 'cross' : 'play'} size={16} />
                            {playing === row.match.id ? 'Stop' : 'Écouter'}
                          </button>
                        )}
                        {!row.removed && (
                          <button
                            className="btn btn-ghost"
                            onClick={() => setEditing(editing === row.key ? null : row.key)}
                          >
                            Changer
                          </button>
                        )}
                        <button className="btn btn-ghost" onClick={() => setRemoved(row, !row.removed)}>
                          {row.removed ? 'Remettre' : 'Retirer'}
                        </button>
                      </div>
                    </div>
                    {editing === row.key && (
                      <SearchPanel
                        initial={`${row.title.replace(/\s*[([].*?[)\]]/g, '')} ${row.work}`}
                        playing={playing}
                        onPlay={play}
                        onChoose={(match) => choose(row, match)}
                      />
                    )}
                  </li>
                )
              })}
              {shown.length === 0 && <li className="muted">Rien à vérifier ici.</li>}
            </ul>
          </>
        )}

        {editCount > 0 && (
          <div className="verify-export">
            <div>
              <strong>
                {editCount} modification{editCount > 1 ? 's' : ''} (corrections, ajouts, retraits)
              </strong>
              <p className="muted small">
                Elles comptent déjà dans tes parties. Pour qu'elles restent après une mise à jour du site, copie la liste
                et envoie-la à Claude.
              </p>
            </div>
            <button className="btn btn-primary" onClick={copy}>
              {copied ? 'Copié !' : 'Copier la liste pour Claude'}
            </button>
            {showText && (
              <textarea className="export-text" readOnly value={exportText} onFocus={(e) => e.currentTarget.select()} />
            )}
          </div>
        )}
      </main>
    </div>
  )
}

/** Ajouter une œuvre : on vérifie d'abord qu'elle n'est pas déjà dans un pack, puis on choisit sa musique. */
function AddPanel({
  packTitle,
  edits,
  playing,
  onPlay,
  onAdd,
  onCancel,
}: {
  packTitle: string
  edits: Edits
  playing: number | null
  onPlay: (match: Match) => void
  onAdd: (work: string, match: Match) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [searching, setSearching] = useState(false)
  const existing = useMemo(() => findExisting(name, edits), [name, edits])

  return (
    <div className="add-panel">
      <div className="add-head">
        <strong>Ajouter une œuvre à « {packTitle} »</strong>
        <button className="btn btn-ghost" onClick={onCancel}>
          Annuler
        </button>
      </div>
      <label className="field">
        <span className="field-label">Nom de l'œuvre (ce que les joueurs devront trouver)</span>
        <input
          autoFocus
          value={name}
          placeholder="Ex. : Le Roi lion, Hunter x Hunter, Mario Kart…"
          onChange={(e) => {
            setName(e.target.value)
            setSearching(false)
          }}
        />
      </label>
      {existing.exact ? (
        <p className="notice is-bad">Déjà dans la liste : {existing.exact}.</p>
      ) : (
        <>
          {existing.similar.length > 0 && (
            <p className="notice">
              Attention, ça ressemble à : {existing.similar.join(' · ')}. Si c'est la même œuvre, pas besoin de
              l'ajouter.
            </p>
          )}
          {name.trim().length >= 2 && !searching && (
            <button className="btn btn-primary" onClick={() => setSearching(true)}>
              Pas dans la liste : chercher sa musique
            </button>
          )}
          {searching && (
            <SearchPanel
              initial={name}
              playing={playing}
              onPlay={onPlay}
              onChoose={(match) => onAdd(name, match)}
            />
          )}
        </>
      )}
    </div>
  )
}

function SearchPanel({
  initial,
  playing,
  onPlay,
  onChoose,
}: {
  initial: string
  playing: number | null
  onPlay: (match: Match) => void
  onChoose: (match: Match) => void
}) {
  const [query, setQuery] = useState(initial)
  const [results, setResults] = useState<Match[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback((q: string) => {
    setResults(null)
    setError(null)
    api<Match[]>(`/api/deezer-search?q=${encodeURIComponent(q)}`)
      .then(setResults)
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => run(initial), [initial, run])

  return (
    <div className="search-panel">
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          run(query)
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher sur Deezer…" />
        <button className="btn" type="submit">
          Chercher
        </button>
      </form>
      {error && <p className="notice is-bad">{error}</p>}
      {results === null && !error && <p className="muted small">Recherche…</p>}
      <ul className="search-results">
        {results?.map((match) => (
          <li key={match.id}>
            <span className="verify-cover small-cover">{match.cover && <Cover src={match.cover} />}</span>
            <span className="search-text">
              <strong>{match.title}</strong>
              <span className="muted small">
                {match.artist} · {match.album}
              </span>
            </span>
            {match.preview && (
              <button className="btn-icon" onClick={() => onPlay(match)} title="Écouter">
                <Icon name={playing === match.id ? 'cross' : 'play'} size={16} />
              </button>
            )}
            <button className="btn btn-primary" onClick={() => onChoose(match)}>
              Choisir
            </button>
          </li>
        ))}
        {results?.length === 0 && <li className="muted small">Aucun résultat, essaie d'autres mots.</li>}
      </ul>
    </div>
  )
}
