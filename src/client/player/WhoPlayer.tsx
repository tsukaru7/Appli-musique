// Écrans du téléphone pour « Qui a mis ce son ? ».
import { useEffect, useRef, useState } from 'react'
import type { RoomView, Track, WhoSearchResult } from '../../shared/protocol.ts'
import { Avatar } from '../avatar.tsx'
import { Cover, Icon, PlayerTiles, Scoreboard, TrackReveal } from '../components.tsx'
import { socket } from '../socket.ts'
import { WhoOwner } from '../host/WhoHost.tsx'

/** Morceaux choisis par ce joueur (le serveur les renvoie à chaque changement). */
export function useMine(): [Track[], (tracks: Track[]) => void] {
  const [mine, setMine] = useState<Track[]>([])
  useEffect(() => {
    const onMine = ({ tracks }: { tracks: Track[] }) => setMine(tracks)
    socket.on('whois:mine', onMine)
    return () => {
      socket.off('whois:mine', onMine)
    }
  }, [])
  return [mine, setMine]
}

/** Numéro de la manche dont le morceau est le mien (s'il y en a une). */
export function useYours(): number | null {
  const [yours, setYours] = useState<number | null>(null)
  useEffect(() => {
    const onYours = ({ roundNumber }: { roundNumber: number }) => setYours(roundNumber)
    socket.on('whois:yours', onYours)
    return () => {
      socket.off('whois:yours', onYours)
    }
  }, [])
  return yours
}

/** Un seul extrait à la fois, pour écouter avant d'ajouter. */
function usePreview() {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(
    () => () => {
      audio.current?.pause()
    },
    [],
  )
  const toggle = (url: string) => {
    if (!audio.current) {
      audio.current = new Audio()
      audio.current.onended = () => setPlaying(null)
    }
    if (playing === url) {
      audio.current.pause()
      setPlaying(null)
      return
    }
    audio.current.src = url
    audio.current.play().then(
      () => setPlaying(url),
      () => setPlaying(null),
    )
  }
  const stop = () => {
    audio.current?.pause()
    setPlaying(null)
  }
  return { playing, toggle, stop }
}

/** Délai au-delà duquel on considère que le serveur n'a pas répondu. */
const ADD_TIMEOUT_MS = 12000
const SEARCH_TIMEOUT_MS = 15000

/** Salle d'attente : on choisit ses morceaux en secret. */
export function WhoLobby({
  room,
  playerId,
  mine,
  onMine,
}: {
  room: RoomView
  playerId: string
  mine: Track[]
  onMine: (tracks: Track[]) => void
}) {
  const preview = usePreview()
  const perPlayer = room.whois?.perPlayer ?? 2
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WhoSearchResult[]>([])
  /** Recherche dont on attend la réponse (null : aucune). */
  const [searching, setSearching] = useState<string | null>(null)
  /** Recherche dont les résultats sont affichés. */
  const [shown, setShown] = useState('')
  const [adding, setAdding] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const lastQuery = useRef('')
  const input = useRef<HTMLInputElement>(null)
  const top = useRef<HTMLElement>(null)
  const done = mine.length >= perPlayer

  const runSearch = (q: string) => {
    lastQuery.current = q
    setSearching(q)
    socket.timeout(SEARCH_TIMEOUT_MS).emit('whois:search', { query: q }, (err, res) => {
      if (lastQuery.current !== q) return
      setSearching(null)
      setShown(q)
      if (err) {
        setResults([])
        setError('La recherche ne répond pas. Vérifie ta connexion et réessaie.')
        return
      }
      setError(res.error ?? null)
      setResults(res.results)
    })
  }

  // Recherche pendant la frappe, avec un petit délai.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      lastQuery.current = ''
      setSearching(null)
      setResults([])
      setShown('')
      return
    }
    if (q === lastQuery.current) return
    const timer = setTimeout(() => runSearch(q), 450)
    return () => clearTimeout(timer)
  }, [query])

  const add = (result: WhoSearchResult) => {
    if (adding !== null || done) return
    setError(null)
    setAdded(null)
    setAdding(result.deezerId)
    // On ferme le clavier, pour voir la liste de ses morceaux.
    input.current?.blur()
    socket.timeout(ADD_TIMEOUT_MS).emit('whois:add', { deezerId: result.deezerId }, (err, res) => {
      setAdding(null)
      if (err) return setError("Le serveur n'a pas répondu. Vérifie ta connexion et réessaie.")
      if (!res.ok) return setError(res.error ?? "Impossible d'ajouter ce morceau.")
      if (res.tracks) onMine(res.tracks)
      preview.stop()
      setAdded(`« ${result.title} » est dans ta sélection.`)
      setQuery('')
      setResults([])
      setShown('')
      lastQuery.current = ''
      top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const remove = (trackId: string) => {
    setAdded(null)
    socket.emit('whois:remove', { trackId })
  }

  const chosen = new Set(mine.map((t) => t.id))
  const q = query.trim()

  return (
    <section className="who-lobby stack" ref={top}>
      <div>
        <span className="eyebrow">Qui a mis ce son ?</span>
        <h1 className="display">{done ? 'Tes morceaux sont prêts' : 'Choisis tes morceaux'}</h1>
        <p className="muted">
          {done
            ? 'On attend les autres. Garde le secret : personne ne voit ce que tu as mis.'
            : `Ajoute ${perPlayer} morceau${perPlayer > 1 ? 'x' : ''} en secret. Les autres devront deviner que c'est toi.`}
        </p>
      </div>

      <div className="who-progress" aria-label={`${mine.length} sur ${perPlayer}`}>
        {Array.from({ length: perPlayer }, (_, i) => (
          <i key={i} className={i < mine.length ? 'on' : ''} />
        ))}
        <span className="mono small">
          {mine.length}/{perPlayer}
        </span>
      </div>

      {added && (
        <p className="result is-good" role="status">
          <Icon name="check" size={18} />
          {added}
        </p>
      )}

      {mine.length > 0 && (
        <div className="stack-tight">
          <span className="eyebrow">Ta sélection</span>
          <ul className="who-list">
            {mine.map((t) => (
              <li key={t.id}>
                <span className="who-cover">{t.albumImage && <Cover src={t.albumImage} />}</span>
                <span className="who-text">
                  <strong>{t.title}</strong>
                  <span className="muted small">{t.artists.join(', ')}</span>
                </span>
                <button className="btn btn-ghost" onClick={() => remove(t.id)}>
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!done && (
        <form
          className="stack-tight"
          onSubmit={(e) => {
            e.preventDefault()
            if (q.length >= 2) runSearch(q)
            input.current?.blur()
          }}
        >
          <span className="eyebrow">Ajouter un morceau</span>
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            placeholder="Titre et artiste, ex. : get lucky daft punk"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {error && <p className="notice is-bad">{error}</p>}
          {searching !== null && <p className="muted small">Recherche…</p>}
          {searching === null && shown !== '' && shown === q && results.length === 0 && !error && (
            <p className="muted small">Aucun résultat. Essaie avec le nom de l'artiste en plus du titre.</p>
          )}
          {results.length > 0 && (
            <>
              <p className="muted small">Touche un morceau pour l'ajouter, ou la pochette pour l'écouter.</p>
              <ul className="who-list who-results">
                {results.map((r) => {
                  const already = chosen.has(`qui:${r.deezerId}`)
                  const isAdding = adding === r.deezerId
                  const isPlaying = !!r.preview && preview.playing === r.preview
                  return (
                    <li key={r.deezerId} className={`${already ? 'is-chosen' : ''} ${isAdding ? 'is-adding' : ''}`}>
                      <button
                        type="button"
                        className={`who-cover is-button ${isPlaying ? 'is-playing' : ''}`}
                        disabled={!r.preview}
                        onClick={() => r.preview && preview.toggle(r.preview)}
                        aria-label={isPlaying ? `Arrêter ${r.title}` : `Écouter ${r.title}`}
                      >
                        {r.cover && <Cover src={r.cover} />}
                        <span className="who-cover-icon">
                          <Icon name={isPlaying ? 'cross' : 'play'} size={16} />
                        </span>
                      </button>
                      <button
                        type="button"
                        className="who-pick"
                        disabled={already || adding !== null}
                        onClick={() => add(r)}
                      >
                        <span className="who-text">
                          <strong>{r.title}</strong>
                          <span className="muted small">{r.artist}</span>
                        </span>
                        <span className="who-pick-action">
                          {already ? (
                            <>
                              <Icon name="check" size={16} />
                              Ajouté
                            </>
                          ) : isAdding ? (
                            'Ajout…'
                          ) : (
                            'Ajouter'
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </form>
      )}

      <div className="stack-tight">
        <span className="eyebrow">Joueurs</span>
        <PlayerTiles players={room.players} meId={playerId} counts={room.whois?.counts} perPlayer={perPlayer} />
      </div>
    </section>
  )
}

const VOTE_KEY = 'whoVote'

/** Mon vote de la manche (gardé si la page est rechargée). */
function useMyVote(code: string, roundNumber: number) {
  const key = `${code}:${roundNumber}`
  const [vote, setVote] = useState<string | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(VOTE_KEY) ?? 'null') as { key: string; targetId: string } | null
      return saved?.key === key ? saved.targetId : null
    } catch {
      return null
    }
  })
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(VOTE_KEY) ?? 'null') as { key: string; targetId: string } | null
      setVote(saved?.key === key ? saved.targetId : null)
    } catch {
      setVote(null)
    }
  }, [key])
  const save = (targetId: string) => {
    setVote(targetId)
    try {
      sessionStorage.setItem(VOTE_KEY, JSON.stringify({ key, targetId }))
    } catch {
      // stockage indisponible : le vote reste affiché jusqu'au rechargement
    }
  }
  return [vote, save] as const
}

/** Pendant l'écoute : on vote pour la personne qui a mis le morceau. */
export function WhoVote({ room, playerId, yours }: { room: RoomView; playerId: string; yours: number | null }) {
  const [vote, setVote] = useMyVote(room.code, room.roundNumber)
  const isMine = yours === room.roundNumber
  const alreadyVoted = room.whois?.voted.includes(playerId) ?? false
  const others = room.players.filter((p) => p.id !== playerId)
  const votedFor = room.players.find((p) => p.id === vote)

  const header = (
    <div className="round-head">
      <div>
        <span className="eyebrow">Morceau</span>
        <div className="round-count">
          {room.roundNumber}
          <span>/{room.totalRounds}</span>
        </div>
      </div>
    </div>
  )

  if (isMine) {
    return (
      <section className="stack who-vote">
        {header}
        <div className="card who-mine">
          <span className="who-mine-icon">
            <Icon name="sparkle" size={28} />
          </span>
          <h1 className="display">C'est ton morceau !</h1>
          <p className="muted">Fais semblant de rien. Tu gagnes des points pour chaque joueur qui se trompe.</p>
        </div>
      </section>
    )
  }

  if (alreadyVoted || vote) {
    return (
      <section className="stack who-vote">
        {header}
        <div className="card who-voted">
          {votedFor && <Avatar id={votedFor.avatar} size={88} large />}
          <h1 className="display">{votedFor ? `Tu as voté ${votedFor.name}` : 'Vote enregistré'}</h1>
          <p className="muted">Réponse quand tout le monde aura voté.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="stack who-vote">
      {header}
      <h1 className="display">Qui a mis ce son ?</h1>
      <p className="muted">Écoute sur l'écran principal, puis touche la bonne personne. Plus tu es rapide, plus tu gagnes.</p>
      <ul className="who-choices">
        {others.map((p) => (
          <li key={p.id}>
            <button
              className={p.connected ? '' : 'is-offline'}
              onClick={() => {
                setVote(p.id)
                socket.emit('player:vote', { targetId: p.id })
              }}
            >
              <Avatar id={p.avatar} size={76} />
              <span>{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Révélation sur le téléphone : qui l'a mis, et mon résultat. */
export function WhoPhoneReveal({ room, playerId }: { room: RoomView; playerId: string }) {
  if (!room.revealed) return null
  const ownerId = room.whois?.ownerId
  const myVote = room.whois?.votes?.[playerId]
  const mine = room.roundResults.find((r) => r.playerId === playerId)
  let result: { tone: string; text: string }
  if (ownerId === playerId) {
    result =
      (mine?.points ?? 0) > 0
        ? { tone: 'good', text: `Tu as trompé du monde · +${mine?.points} pts` }
        : { tone: '', text: 'Tout le monde t’a démasqué !' }
  } else if (!myVote) {
    result = { tone: '', text: "Tu n'as pas voté." }
  } else if (myVote === ownerId) {
    result = { tone: 'good', text: `Bien vu ! · +${mine?.points ?? 0} pts` }
  } else {
    result = { tone: 'bad', text: 'Raté !' }
  }
  return (
    <section className="stack">
      <TrackReveal track={room.revealed} compact />
      <WhoOwner room={room} />
      <p className={`result ${result.tone ? `is-${result.tone}` : ''}`}>
        {result.tone === 'good' && <Icon name="check" size={18} />}
        {result.tone === 'bad' && <Icon name="cross" size={18} />}
        {result.text}
      </p>
      <Scoreboard room={room} highlightId={playerId} />
    </section>
  )
}
