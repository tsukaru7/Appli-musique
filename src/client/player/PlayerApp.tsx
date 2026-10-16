import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { filterOptions } from '../../shared/answers.ts'
import { POINTS_BY_STAGE, SNIPPET_DURATIONS_MS, type AnswerOption, type RoomView } from '../../shared/protocol.ts'
import { Icon, PlayRing, Scoreboard, StageBar, TrackReveal, Wordmark, seconds } from '../components.tsx'
import { detectSoundStart } from '../audio.ts'
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

const SESSION_KEY = 'playerSession'

/** Dernière partie rejointe sur ce téléphone, pour y revenir tout seul après un rechargement. */
function readSession(): { code: string; name: string } | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')
  } catch {
    return null
  }
}

export function PlayerApp() {
  const urlCode = new URLSearchParams(window.location.search).get('code')?.toUpperCase() ?? ''
  const [saved] = useState(() => {
    const session = readSession()
    // Un lien vers une autre partie l'emporte sur la partie enregistrée.
    return session && (!urlCode || urlCode === session.code) ? session : null
  })
  const [code, setCode] = useState(saved?.code ?? urlCode)
  const [name, setName] = useState(() => saved?.name ?? localStorage.getItem('playerName') ?? '')
  const [joined, setJoined] = useState(false)
  const [reconnecting, setReconnecting] = useState(saved !== null)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<AnswerOption[]>([])
  const [room, setRoom] = useState<RoomView | null>(null)
  const id = useMemo(playerId, [])

  const join = useCallback(
    (joinCode: string, joinName: string) => {
      setError(null)
      socket.emit('player:join', { code: joinCode.toUpperCase().trim(), name: joinName, playerId: id }, (res) => {
        setReconnecting(false)
        if (!res.ok) {
          localStorage.removeItem(SESSION_KEY)
          return setError(res.error)
        }
        localStorage.setItem('playerName', joinName)
        localStorage.setItem(SESSION_KEY, JSON.stringify({ code: joinCode.toUpperCase().trim(), name: joinName }))
        setOptions(res.options)
        setJoined(true)
      })
    },
    [id],
  )

  // Page rechargée : on revient directement dans la partie, avec le même score.
  useEffect(() => {
    if (saved) join(saved.code, saved.name)
  }, [saved, join])

  const leave = () => {
    localStorage.removeItem(SESSION_KEY)
    window.location.replace('/join')
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

  if (reconnecting || (joined && !room)) {
    return (
      <main className="splash">
        <Wordmark large />
        <p className="muted">Retour dans la partie {code}…</p>
      </main>
    )
  }

  if (!joined || !room) {
    return (
      <main className="splash">
        <Wordmark large />
        <form
          className="stack narrow"
          onSubmit={(e) => {
            e.preventDefault()
            join(code, name)
          }}
        >
          <label className="field">
            <span className="field-label">Code de la partie</span>
            <input
              className="code-input"
              value={code}
              maxLength={4}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="ABCD"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
          <label className="field">
            <span className="field-label">Ton pseudo</span>
            <input value={name} maxLength={20} autoComplete="nickname" onChange={(e) => setName(e.target.value)} />
          </label>
          {error && <p className="notice is-bad">{error}</p>}
          <button className="btn btn-primary btn-lg" type="submit" disabled={code.length !== 4 || !name.trim()}>
            Rejoindre
            <Icon name="arrow" size={18} />
          </button>
        </form>
      </main>
    )
  }

  const me = room.players.find((p) => p.id === id)

  return (
    <div className="app phone">
      <header className="appbar">
        <span className="appbar-player">
          <strong>{name}</strong>
          <span className="muted">{me?.score ?? 0} pts</span>
        </span>
        <span className="mono muted">{room.code}</span>
        <button className="btn-icon" onClick={leave} title="Quitter la partie">
          <Icon name="logout" size={18} />
        </button>
      </header>

      <main className="page">
        {room.phase === 'lobby' && (
          <section className="waiting">
            <span className="eyebrow">Tu es dans la partie</span>
            <h1 className="display">Ça commence bientôt</h1>
            <p className="muted">L'hôte lance la partie dès que tout le monde est là.</p>
            <ul className="chips">
              {room.players.map((p) => (
                <li key={p.id} className={p.id === id ? 'is-me' : ''}>
                  {p.name}
                </li>
              ))}
            </ul>
          </section>
        )}
        {room.phase === 'playing' &&
          (room.mode === 'deezer' ? (
            <DeezerRound room={room} playerId={id} options={options} />
          ) : (
            <Round room={room} playerId={id} options={options} />
          ))}
        {room.phase === 'reveal' && room.revealed && (
          <section className="stack">
            <RoundHeader room={room} />
            <TrackReveal track={room.revealed} compact />
            <MyResult room={room} playerId={id} />
            <Scoreboard room={room} highlightId={id} />
          </section>
        )}
        {room.phase === 'finished' && (
          <section className="stack">
            <span className="eyebrow">Partie terminée</span>
            <h1 className="display">Classement</h1>
            <Scoreboard room={room} highlightId={id} />
          </section>
        )}
      </main>
    </div>
  )
}

function RoundHeader({ room, points }: { room: RoomView; points?: number }) {
  return (
    <div className="round-head">
      <div>
        <span className="eyebrow">Manche</span>
        <div className="round-count">
          {room.roundNumber}
          <span>/{room.totalRounds}</span>
        </div>
      </div>
      {points !== undefined && (
        <div className="stake">
          <span className="eyebrow">En jeu</span>
          <span className="stake-value">{points}</span>
        </div>
      )}
    </div>
  )
}

function MyResult({ room, playerId }: { room: RoomView; playerId: string }) {
  const mine = room.roundResults.find((r) => r.playerId === playerId)
  if (mine?.foundAtStage !== undefined) {
    return (
      <p className="result is-good">
        <Icon name="check" size={18} />
        Trouvé à {seconds(mine.foundAtStage)} · +{mine.points} pts
      </p>
    )
  }
  return <p className="result">Pas trouvé cette fois.</p>
}

/** Mauvaises réponses de la manche en cours (gardées si la page est rechargée). */
function useWrongGuesses(code: string, roundNumber: number): string[] {
  const key = `wrongGuesses:${code}:${roundNumber}`
  const [wrongGuesses, setWrongGuesses] = useState<string[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? '[]')
    } catch {
      return []
    }
  })
  useEffect(() => {
    try {
      setWrongGuesses(JSON.parse(sessionStorage.getItem(key) ?? '[]'))
    } catch {
      setWrongGuesses([])
    }
  }, [key])
  useEffect(() => {
    const onFeedback = ({ correct, guessLabel }: { correct: boolean; guessLabel: string }) => {
      if (correct) return
      setWrongGuesses((g) => {
        const next = [...g, guessLabel]
        try {
          sessionStorage.setItem(key, JSON.stringify(next))
        } catch {
          // stockage indisponible (navigation privée) : tant pis, la liste reste en mémoire
        }
        return next
      })
    }
    socket.on('player:feedback', onFeedback)
    return () => {
      socket.off('player:feedback', onFeedback)
    }
  }, [key])
  return wrongGuesses
}

function WrongGuesses({ guesses }: { guesses: string[] }) {
  if (guesses.length === 0) return null
  return (
    <ul className="wrong-list">
      {guesses.map((g, i) => (
        <li key={i}>
          <Icon name="cross" size={14} />
          <span>{g}</span>
        </li>
      ))}
    </ul>
  )
}

/** Champ de réponse avec autocomplétion sur les morceaux de la playlist. */
function GuessInput({ options, roundNumber }: { options: AnswerOption[]; roundNumber: number }) {
  const [query, setQuery] = useState('')
  const suggestions = useMemo(() => filterOptions(options, query), [options, query])
  useEffect(() => setQuery(''), [roundNumber])

  const submit = (guess: { optionId?: string; text?: string }) => {
    socket.emit('player:guess', guess)
    setQuery('')
  }

  return (
    <div className="guess">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (suggestions.length === 1) submit({ optionId: suggestions[0].id })
          else if (query.trim()) submit({ text: query })
        }}
      >
        <input
          className="guess-input"
          placeholder="Titre ou artiste…"
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      {suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((s) => {
            const [title, artists] = s.label.split(' — ')
            return (
              <li key={s.id}>
                <button onClick={() => submit({ optionId: s.id })}>
                  <span className="suggestion-title">{title}</span>
                  <span className="suggestion-artist">{artists}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Mode Spotify : l'extrait sort de l'ordinateur de l'hôte, tout le monde avance ensemble. */
function Round({ room, playerId, options }: { room: RoomView; playerId: string; options: AnswerOption[] }) {
  const [progress, setProgress] = useState<{ key: number; ms: number } | null>(null)
  const wrongGuesses = useWrongGuesses(room.code, room.roundNumber)
  const mine = room.roundResults.find((r) => r.playerId === playerId)

  useEffect(() => {
    const onSnippet = ({ durationMs }: { durationMs: number }) =>
      setProgress((p) => ({ key: (p?.key ?? 0) + 1, ms: durationMs }))
    socket.on('snippet:start', onSnippet)
    return () => {
      socket.off('snippet:start', onSnippet)
    }
  }, [])

  return (
    <section className="stack">
      <RoundHeader room={room} points={mine?.status === 'pending' || !mine ? POINTS_BY_STAGE[room.stage] : undefined} />
      <PlayRing label={`Écoute l'écran principal · ${seconds(room.stage)}`} progressKey={progress?.key} progressMs={progress?.ms} />
      <StageBar stage={room.stage} progressKey={progress?.key} progressMs={progress?.ms} />

      {mine?.status === 'correct' ? (
        <p className="result is-good">
          <Icon name="check" size={18} />
          Trouvé · +{mine.points} pts
        </p>
      ) : mine?.status === 'wrong' || mine?.status === 'passed' ? (
        <p className="result">{mine.status === 'wrong' ? 'Raté.' : 'Passé.'} Attends l'extrait suivant…</p>
      ) : (
        <>
          <GuessInput options={options} roundNumber={room.roundNumber} />
          <button className="btn btn-ghost btn-block" onClick={() => socket.emit('player:pass')}>
            <Icon name="skip" size={18} />
            Je ne sais pas
          </button>
        </>
      )}
      <WrongGuesses guesses={wrongGuesses} />
    </section>
  )
}

/** Mode Deezer : chaque téléphone joue son extrait et le joueur avance à son rythme. */
function DeezerRound({ room, playerId, options }: { room: RoomView; playerId: string; options: AnswerOption[] }) {
  const audio = useRef<HTMLAudioElement>(null)
  const frame = useRef(0)
  /** Moment où le son commence vraiment dans l'extrait (on saute le silence du début). */
  const soundStart = useRef(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ key: number; ms: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const wrongGuesses = useWrongGuesses(room.code, room.roundNumber)
  const src = `/api/preview/${room.code}/${room.roundNumber}`

  // On télécharge l'extrait une fois, et on repère où le son commence.
  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    setAudioUrl(null)
    soundStart.current = 0
    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error('indisponible')
        return res.arrayBuffer()
      })
      .then(async (data) => {
        const blobUrl = URL.createObjectURL(new Blob([data], { type: 'audio/mpeg' }))
        const start = await detectSoundStart(data.slice(0))
        if (cancelled) return URL.revokeObjectURL(blobUrl)
        url = blobUrl
        soundStart.current = start
        setAudioUrl(blobUrl)
      })
      .catch(() => !cancelled && setError("Cet extrait n'a pas pu être chargé. Demande à l'hôte de passer au suivant."))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [src])
  const mine = room.roundResults.find((r) => r.playerId === playerId)
  const stage = mine?.stage ?? 0
  const done = mine?.status === 'correct' || mine?.status === 'out'
  const lastStage = SNIPPET_DURATIONS_MS.length - 1

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current)
    audio.current?.pause()
  }, [])

  /** Joue le début de l'extrait et le coupe pile à la bonne durée. */
  const play = useCallback(
    async (s: number) => {
      const el = audio.current
      if (!el) return
      const durationMs = SNIPPET_DURATIONS_MS[s]
      const start = soundStart.current
      stop()
      el.currentTime = start
      try {
        await el.play()
      } catch {
        setError("Impossible de lire l'extrait. Touche le bouton pour réessayer.")
        return
      }
      setError(null)
      setProgress((p) => ({ key: (p?.key ?? 0) + 1, ms: durationMs }))
      const tick = () => {
        if (el.paused || (el.currentTime - start) * 1000 >= durationMs) el.pause()
        else frame.current = requestAnimationFrame(tick)
      }
      tick()
    },
    [stop],
  )

  // Après une erreur ou un « passer », on joue directement l'extrait plus long.
  const previousStage = useRef(stage)
  useEffect(() => {
    if (stage > previousStage.current && !done) play(stage)
    previousStage.current = stage
  }, [stage, done, play])

  useEffect(() => {
    if (done) stop()
  }, [done, stop])

  useEffect(() => stop, [stop])

  return (
    <section className="stack">
      <audio ref={audio} preload="auto" src={audioUrl ?? undefined} />
      <RoundHeader room={room} points={done ? undefined : POINTS_BY_STAGE[stage]} />

      {mine?.status === 'correct' ? (
        <div className="done">
          <span className="done-badge is-good">
            <Icon name="check" size={28} />
          </span>
          <p className="display">Trouvé à {seconds(mine.foundAtStage ?? 0)}</p>
          <p className="muted">+{mine.points} pts · on attend les autres</p>
        </div>
      ) : mine?.status === 'out' ? (
        <div className="done">
          <span className="done-badge">
            <Icon name="flag" size={26} />
          </span>
          <p className="display">Pas cette fois</p>
          <p className="muted">On attend les autres</p>
        </div>
      ) : (
        <>
          <PlayRing
            onClick={() => play(stage)}
            disabled={!audioUrl}
            label={audioUrl ? `Écouter ${seconds(stage)}` : 'Chargement de l’extrait…'}
            progressKey={progress?.key}
            progressMs={progress?.ms}
          />
          <StageBar stage={stage} progressKey={progress?.key} progressMs={progress?.ms} />
          {error && <p className="notice is-bad">{error}</p>}
          <GuessInput options={options} roundNumber={room.roundNumber} />
          <button className="btn btn-ghost btn-block" onClick={() => socket.emit('player:pass')}>
            <Icon name="skip" size={18} />
            {stage < lastStage ? `Passer · écouter ${seconds(stage + 1)}` : 'Abandonner la manche'}
          </button>
        </>
      )}
      <WrongGuesses guesses={wrongGuesses} />
    </section>
  )
}
