import { useEffect, useMemo, useState } from 'react'
import { filterOptions } from '../../shared/answers.ts'
import { POINTS_BY_STAGE, type AnswerOption, type RoomView } from '../../shared/protocol.ts'
import { Scoreboard, StageBar, TrackCard } from '../components.tsx'
import { socket } from '../socket.ts'

/** Identifiant stable du joueur sur ce téléphone (pour retrouver son score après une coupure). */
function playerId(): string {
  let id = localStorage.getItem('playerId')
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem('playerId', id)
  }
  return id
}

export function PlayerApp() {
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('code') ?? '')
  const [name, setName] = useState(() => localStorage.getItem('playerName') ?? '')
  const [joined, setJoined] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<AnswerOption[]>([])
  const [room, setRoom] = useState<RoomView | null>(null)
  const id = useMemo(playerId, [])

  const join = () => {
    setError(null)
    socket.emit('player:join', { code: code.toUpperCase().trim(), name, playerId: id }, (res) => {
      if (!res.ok) return setError(res.error)
      localStorage.setItem('playerName', name)
      setOptions(res.options)
      setJoined(true)
    })
  }

  useEffect(() => {
    socket.on('room:update', setRoom)
    return () => {
      socket.off('room:update', setRoom)
    }
  }, [])

  // Après une coupure réseau, on se reconnecte automatiquement à la partie.
  useEffect(() => {
    if (!joined) return
    const rejoin = () => socket.emit('player:join', { code: code.toUpperCase().trim(), name, playerId: id }, () => {})
    socket.on('connect', rejoin)
    return () => {
      socket.off('connect', rejoin)
    }
  }, [joined, code, name, id])

  if (!joined || !room) {
    return (
      <main className="player center">
        <h1>🎵 Appli-musique</h1>
        <form
          className="join-form"
          onSubmit={(e) => {
            e.preventDefault()
            join()
          }}
        >
          <input
            placeholder="Code de la partie"
            value={code}
            maxLength={4}
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <input placeholder="Ton pseudo" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          <button className="primary big" type="submit" disabled={code.length !== 4 || !name.trim()}>
            Rejoindre
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </main>
    )
  }

  return (
    <main className="player">
      <header className="topbar">
        <span className="logo">🎵 {room.code}</span>
        <span>{name}</span>
        <span className="score">{room.players.find((p) => p.id === id)?.score ?? 0} pts</span>
      </header>
      {room.phase === 'lobby' && (
        <section className="panel center">
          <h2>C'est bon, tu es dans la partie !</h2>
          <p className="hint">Regarde l'écran de l'hôte : la partie va bientôt commencer.</p>
          <p className="hint">{room.players.map((p) => p.name).join(' · ')}</p>
        </section>
      )}
      {room.phase === 'playing' && <Round room={room} playerId={id} options={options} />}
      {room.phase === 'reveal' && room.revealed && (
        <section className="panel">
          <h2>
            Manche {room.roundNumber} / {room.totalRounds}
          </h2>
          <TrackCard track={room.revealed} />
          <MyResult room={room} playerId={id} />
          <Scoreboard room={room} highlightId={id} />
        </section>
      )}
      {room.phase === 'finished' && (
        <section className="panel center">
          <h2>🏆 Classement final</h2>
          <Scoreboard room={room} highlightId={id} />
        </section>
      )}
    </main>
  )
}

function MyResult({ room, playerId }: { room: RoomView; playerId: string }) {
  const mine = room.roundResults.find((r) => r.playerId === playerId)
  if (mine?.foundAtStage !== undefined) return <p className="success">✅ Trouvé ! +{mine.points} pts</p>
  return <p className="hint">Raté pour cette fois…</p>
}

function Round({ room, playerId, options }: { room: RoomView; playerId: string; options: AnswerOption[] }) {
  const [query, setQuery] = useState('')
  const [wrongGuesses, setWrongGuesses] = useState<string[]>([])
  const [progress, setProgress] = useState<{ key: number; ms: number } | null>(null)
  const mine = room.roundResults.find((r) => r.playerId === playerId)
  const suggestions = useMemo(() => filterOptions(options, query), [options, query])

  // Nouvelle manche : on repart de zéro.
  useEffect(() => {
    setWrongGuesses([])
    setQuery('')
  }, [room.roundNumber])

  useEffect(() => {
    const onFeedback = ({ correct, guessLabel }: { correct: boolean; guessLabel: string }) => {
      if (!correct) setWrongGuesses((g) => [...g, guessLabel])
    }
    const onSnippet = ({ durationMs }: { durationMs: number }) =>
      setProgress((p) => ({ key: (p?.key ?? 0) + 1, ms: durationMs }))
    socket.on('player:feedback', onFeedback)
    socket.on('snippet:start', onSnippet)
    return () => {
      socket.off('player:feedback', onFeedback)
      socket.off('snippet:start', onSnippet)
    }
  }, [])

  const submit = (guess: { optionId?: string; text?: string }) => {
    socket.emit('player:guess', guess)
    setQuery('')
  }

  return (
    <section className="panel">
      <h2>
        Manche {room.roundNumber} / {room.totalRounds}
      </h2>
      <StageBar stage={room.stage} progressKey={progress?.key} progressMs={progress?.ms} />

      {mine?.status === 'correct' ? (
        <p className="success big-text">✅ Trouvé ! +{mine.points} pts</p>
      ) : mine?.status === 'wrong' || mine?.status === 'passed' ? (
        <p className="hint big-text">
          {mine.status === 'wrong' ? '❌ Raté' : '⏭️ Passé'} — attends l'extrait suivant…
        </p>
      ) : (
        <>
          <p className="hint">C'est quoi ce morceau ? ({POINTS_BY_STAGE[room.stage]} pts en jeu)</p>
          <form
            className="guess-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (suggestions.length === 1) submit({ optionId: suggestions[0].id })
              else if (query.trim()) submit({ text: query })
            }}
          >
            <input
              autoFocus
              placeholder="Tape un titre ou un artiste…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>
          <ul className="suggestions">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button onClick={() => submit({ optionId: s.id })}>{s.label}</button>
              </li>
            ))}
          </ul>
          <button className="pass" onClick={() => socket.emit('player:pass')}>
            Je ne sais pas → passer
          </button>
        </>
      )}

      {wrongGuesses.length > 0 && (
        <ul className="wrong-guesses">
          {wrongGuesses.map((g, i) => (
            <li key={i}>❌ {g}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
