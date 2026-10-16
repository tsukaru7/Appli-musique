// Écrans du téléphone pour « Qui a mis ce son ? ».
import { useEffect, useRef, useState } from 'react'
import type { RoomView, Track, WhoSearchResult } from '../../shared/protocol.ts'
import { Avatar } from '../avatar.tsx'
import { Cover, Icon, PlayerTiles, Scoreboard, TrackReveal } from '../components.tsx'
import { socket } from '../socket.ts'
import { WhoOwner } from '../host/WhoHost.tsx'

/** Morceaux choisis par ce joueur (le serveur les renvoie à chaque changement). */
export function useMine(): Track[] {
  const [mine, setMine] = useState<Track[]>([])
  useEffect(() => {
    const onMine = ({ tracks }: { tracks: Track[] }) => setMine(tracks)
    socket.on('whois:mine', onMine)
    return () => {
      socket.off('whois:mine', onMine)
    }
  }, [])
  return mine
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

/** Salle d'attente : on choisit ses morceaux en secret. */
export function WhoLobby({ room, playerId, mine }: { room: RoomView; playerId: string; mine: Track[] }) {
  const preview = usePreview()
  const perPlayer = room.whois?.perPlayer ?? 2
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WhoSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastQuery = useRef('')
  const done = mine.length >= perPlayer

  // Recherche pendant la frappe, avec un petit délai.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      lastQuery.current = q
      setSearching(true)
      socket.emit('whois:search', { query: q }, (list) => {
        if (lastQuery.current !== q) return
        setSearching(false)
        setResults(list)
      })
    }, 450)
    return () => clearTimeout(timer)
  }, [query])

  const add = (result: WhoSearchResult) => {
    setError(null)
    setAdding(result.deezerId)
    socket.emit('whois:add', { deezerId: result.deezerId }, (res) => {
      setAdding(null)
      if (!res.ok) return setError(res.error ?? "Impossible d'ajouter ce morceau.")
      preview.stop()
      setQuery('')
      setResults([])
    })
  }

  const chosen = new Set(mine.map((t) => t.id))

  return (
    <section className="who-lobby stack">
      <div>
        <span className="eyebrow">Qui a mis ce son ?</span>
        <h1 className="display">{done ? 'Tes morceaux sont prêts' : 'Choisis tes morceaux'}</h1>
        <p className="muted">
          {done
            ? "On attend les autres. Garde le secret : personne ne voit ce que tu as mis."
            : `Ajoute ${perPlayer} morceaux en secret. Les autres devront deviner que c'est toi.`}
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

      {mine.length > 0 && (
        <ul className="who-list">
          {mine.map((t) => (
            <li key={t.id}>
              <span className="who-cover">{t.albumImage && <Cover src={t.albumImage} />}</span>
              <span className="who-text">
                <strong>{t.title}</strong>
                <span className="muted small">{t.artists.join(', ')}</span>
              </span>
              <button className="btn btn-ghost" onClick={() => socket.emit('whois:remove', { trackId: t.id })}>
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}

      {!done && (
        <div className="stack">
          <input
            className="input"
            type="search"
            placeholder="Titre ou artiste…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {error && <p className="notice is-bad">{error}</p>}
          {searching && results.length === 0 && <p className="muted small">Recherche…</p>}
          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <p className="muted small">Aucun résultat.</p>
          )}
          {results.length > 0 && (
            <ul className="who-list who-results">
              {results.map((r) => {
                const already = chosen.has(`qui:${r.deezerId}`)
                return (
                  <li key={r.deezerId}>
                    <button
                      className={`who-cover is-button ${preview.playing === r.preview ? 'is-playing' : ''}`}
                      disabled={!r.preview}
                      onClick={() => r.preview && preview.toggle(r.preview)}
                      aria-label={preview.playing === r.preview ? 'Arrêter' : 'Écouter'}
                    >
                      {r.cover && <Cover src={r.cover} />}
                      <span className="who-cover-icon">
                        <Icon name={preview.playing === r.preview ? 'cross' : 'play'} size={16} />
                      </span>
                    </button>
                    <span className="who-text">
                      <strong>{r.title}</strong>
                      <span className="muted small">{r.artist}</span>
                    </span>
                    <button
                      className="btn btn-primary"
                      disabled={already || adding !== null}
                      onClick={() => add(r)}
                    >
                      {already ? 'Ajouté' : adding === r.deezerId ? '…' : 'Ajouter'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div>
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
