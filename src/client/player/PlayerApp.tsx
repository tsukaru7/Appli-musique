import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { filterOptions } from '../../shared/answers.ts'
import { POINTS_BY_STAGE, SNIPPET_DURATIONS_MS, type AnswerOption, type RoomView } from '../../shared/protocol.ts'
import {
  CategoryBadge,
  Icon,
  PlayerTiles,
  PlayRing,
  Scoreboard,
  StageBar,
  TrackReveal,
  Wordmark,
  seconds,
} from '../components.tsx'
import { Avatar } from '../avatar.tsx'
import { AVATAR_GROUPS, AVATAR_IDS, AVATARS, defaultAvatar, findAvatar, isAvatar } from '../../shared/avatars.ts'
import { PreviewPlayer } from '../preview.ts'
import { socket, useSocket } from '../socket.ts'
import { useMine, useYours, WhoLobby, WhoPhoneReveal, WhoVote } from './WhoPlayer.tsx'

/** La page est-elle connectée au serveur de jeu ? */
function useOnline(): boolean {
  // Au chargement, la connexion prend un instant : on ne l'affiche que si elle tarde.
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    const slow = setTimeout(() => !socket.connected && setOnline(false), 2000)
    socket.on('connect', on)
    socket.on('disconnect', off)
    socket.io.on('reconnect_attempt', off)
    return () => {
      clearTimeout(slow)
      socket.off('connect', on)
      socket.off('disconnect', off)
      socket.io.off('reconnect_attempt', off)
    }
  }, [])
  return online
}

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
function readSession(): { code: string; name: string; avatar?: string } | null {
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
  const id = useMemo(playerId, [])
  const [avatar, setAvatar] = useState(() => {
    const stored = saved?.avatar ?? localStorage.getItem('playerAvatar')
    return isAvatar(stored) ? stored : defaultAvatar(id)
  })
  const [joined, setJoined] = useState(false)
  /** « C'est parti » touché : on attend la réponse du serveur. */
  const [joining, setJoining] = useState(false)
  const online = useOnline()
  const [reconnecting, setReconnecting] = useState(saved !== null)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<AnswerOption[]>([])
  const [room, setRoom] = useState<RoomView | null>(null)
  // « Qui a mis ce son ? » : mes morceaux, et la manche où c'est le mien.
  const [mine, setMine] = useMine()
  const yours = useYours()

  const join = useCallback(
    (joinCode: string, joinName: string, joinAvatar: string) => {
      setError(null)
      setJoining(true)
      const payload = { code: joinCode.toUpperCase().trim(), name: joinName, playerId: id, avatar: joinAvatar }
      // Sans réponse au bout de 15 s (serveur qui redémarre ou se réveille), on le dit au lieu de ne rien faire.
      socket.timeout(15000).emit('player:join', payload, (err, res) => {
        setReconnecting(false)
        setJoining(false)
        if (err) {
          return setError(
            "Le serveur ne répond pas. Il est peut-être en train de démarrer : réessaie dans 30 secondes.",
          )
        }
        if (!res.ok) {
          localStorage.removeItem(SESSION_KEY)
          return setError(res.error)
        }
        localStorage.setItem('playerName', joinName)
        localStorage.setItem('playerAvatar', joinAvatar)
        localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({ code: joinCode.toUpperCase().trim(), name: joinName, avatar: joinAvatar }),
        )
        setOptions(res.options)
        setJoined(true)
      })
    },
    [id],
  )

  // Page rechargée : on revient directement dans la partie, avec le même score.
  useEffect(() => {
    if (saved) join(saved.code, saved.name, avatar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, join])

  const leave = () => {
    localStorage.removeItem(SESSION_KEY)
    window.location.replace('/join')
  }

  useEffect(() => {
    // L'hôte a fermé la partie : retour à l'écran pour rejoindre.
    const onClosed = () => {
      localStorage.removeItem(SESSION_KEY)
      setJoined(false)
      setRoom(null)
      setCode('')
      setError("La partie est terminée : l'hôte l'a fermée.")
    }
    socket.on('room:update', setRoom)
    socket.on('room:closed', onClosed)
    return () => {
      socket.off('room:update', setRoom)
      socket.off('room:closed', onClosed)
    }
  }, [])

  // Après une coupure réseau, on se reconnecte automatiquement à la partie.
  useEffect(() => {
    if (!joined) return
    const rejoin = () =>
      socket.emit('player:join', { code: code.toUpperCase().trim(), name, playerId: id, avatar }, () => {})
    socket.on('connect', rejoin)
    return () => {
      socket.off('connect', rejoin)
    }
  }, [joined, code, name, id, avatar])

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
      <JoinScreen
        code={code}
        onCodeChange={setCode}
        codeFromLink={urlCode !== '' && code === urlCode}
        name={name}
        onNameChange={setName}
        avatar={avatar}
        onAvatarChange={setAvatar}
        error={error}
        joining={joining}
        online={online}
        onJoin={() => join(code, name, avatar)}
      />
    )
  }

  const me = room.players.find((p) => p.id === id)

  return (
    <div className="app phone">
      <header className="appbar">
        <span className="appbar-player">
          <Avatar id={me?.avatar ?? avatar} size={32} />
          <strong>{name}</strong>
          <span className="muted">{me?.score ?? 0} pts</span>
        </span>
        <span className="mono muted">{room.code}</span>
        <button className="btn btn-ghost" onClick={leave}>
          <Icon name="logout" size={16} />
          Quitter
        </button>
      </header>

      <main className="page">
        {room.kind === 'whois' && room.phase === 'lobby' && <WhoLobby room={room} playerId={id} mine={mine} onMine={setMine} />}
        {room.kind === 'whois' && room.phase === 'playing' && <WhoVote room={room} playerId={id} yours={yours} />}
        {room.kind === 'whois' && room.phase === 'reveal' && <WhoPhoneReveal room={room} playerId={id} />}
        {room.kind !== 'whois' && room.phase === 'lobby' && (
          <section className="waiting">
            <span className="eyebrow">Tu es dans la partie</span>
            <h1 className="display">Ça commence bientôt</h1>
            <p className="muted">L'hôte lance la partie dès que tout le monde est là.</p>
            <PlayerTiles players={room.players} meId={id} />
          </section>
        )}
        {room.kind !== 'whois' &&
          room.phase === 'playing' &&
          (room.mode === 'deezer' ? (
            <DeezerRound room={room} playerId={id} options={options} />
          ) : (
            <Round room={room} playerId={id} options={options} />
          ))}
        {room.kind !== 'whois' && room.phase === 'reveal' && room.revealed && (
          <section className="stack">
            <RoundHeader room={room} />
            <TrackReveal track={room.revealed} category={room.category} compact />
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

export function RoundHeader({ room, points }: { room: RoomView; points?: number }) {
  return (
    <>
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
      {room.phase === 'playing' && room.category && (
        <p className="category-line">
          C'est un <CategoryBadge category={room.category} />
        </p>
      )}
    </>
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
export function useWrongGuesses(code: string, roundNumber: number): string[] {
  const socket = useSocket()
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
  }, [key, socket])
  return wrongGuesses
}

export function WrongGuesses({ guesses }: { guesses: string[] }) {
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
export function GuessInput({
  options,
  roundNumber,
  works = false,
}: {
  options: AnswerOption[]
  roundNumber: number
  /** Packs : on devine une œuvre (jeu, animé, film…) et non un titre. */
  works?: boolean
}) {
  const socket = useSocket()
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
          placeholder={works ? 'Jeu, animé, film, dessin animé…' : 'Titre ou artiste…'}
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
  const socket = useSocket()
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
  }, [socket])

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
          <GuessInput options={options} roundNumber={room.roundNumber} works={room.packs.length > 0} />
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
export function DeezerRound({ room, playerId, options }: { room: RoomView; playerId: string; options: AnswerOption[] }) {
  const socket = useSocket()
  const preview = useMemo(() => new PreviewPlayer(), [])
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState<{ key: number; ms: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const wrongGuesses = useWrongGuesses(room.code, room.roundNumber)
  const src = `/api/preview/${room.code}/${room.roundNumber}`
  const mine = room.roundResults.find((r) => r.playerId === playerId)
  const stage = mine?.stage ?? 0
  const done = mine?.status === 'correct' || mine?.status === 'out'
  const lastStage = SNIPPET_DURATIONS_MS.length - 1

  // On télécharge l'extrait dès le début de la manche (et on repère où le son commence).
  useEffect(() => {
    let cancelled = false
    setReady(false)
    preview.load(src).then(
      () => !cancelled && setReady(true),
      () => !cancelled && setError("Cet extrait n'a pas pu être chargé. Demande à l'hôte de passer au suivant."),
    )
    return () => {
      cancelled = true
    }
  }, [preview, src])

  useEffect(() => () => preview.dispose(), [preview])

  const stop = useCallback(() => preview.stop(), [preview])

  /** Joue le début de l'extrait et le coupe pile à la bonne durée. */
  const play = useCallback(
    async (s: number) => {
      const durationMs = SNIPPET_DURATIONS_MS[s]
      try {
        await preview.play(src, durationMs, () => {
          setError(null)
          setProgress((p) => ({ key: (p?.key ?? 0) + 1, ms: durationMs }))
        })
      } catch {
        setError("Impossible de lire l'extrait. Touche le bouton pour réessayer.")
      }
    },
    [preview, src],
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
            disabled={!ready}
            label={ready ? `Écouter ${seconds(stage)}` : 'Chargement de l’extrait…'}
            progressKey={progress?.key}
            progressMs={progress?.ms}
          />
          <StageBar stage={stage} progressKey={progress?.key} progressMs={progress?.ms} />
          {error && <p className="notice is-bad">{error}</p>}
          <GuessInput options={options} roundNumber={room.roundNumber} works={room.packs.length > 0} />
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

/** Écran pour rejoindre : choisir son avatar, son pseudo (et le code si on n'est pas venu par le QR code). */
function JoinScreen({
  code,
  onCodeChange,
  codeFromLink,
  name,
  onNameChange,
  avatar,
  onAvatarChange,
  error,
  joining,
  online,
  onJoin,
}: {
  code: string
  onCodeChange: (code: string) => void
  codeFromLink: boolean
  name: string
  onNameChange: (name: string) => void
  avatar: string
  onAvatarChange: (avatar: string) => void
  error: string | null
  joining: boolean
  online: boolean
  onJoin: () => void
}) {
  const [editCode, setEditCode] = useState(!codeFromLink)
  const [hint, setHint] = useState<string | null>(null)
  const random = () => {
    const others = AVATAR_IDS.filter((a) => a !== avatar)
    onAvatarChange(others[Math.floor(Math.random() * others.length)])
  }

  return (
    <main className="join">
      <Wordmark />
      <form
        className="join-card"
        onSubmit={(e) => {
          e.preventDefault()
          // Il manque quelque chose : on le dit (au lieu d'un bouton grisé qu'on ne comprend pas).
          if (!name.trim()) return setHint('Écris ton pseudo.')
          if (code.trim().length !== 4) {
            setEditCode(true)
            return setHint('Entre le code de la partie : les 4 lettres affichées sur l’écran de l’hôte.')
          }
          setHint(null)
          onJoin()
        }}
      >
        <div className="join-hero">
          <Avatar id={avatar} size={128} large className="avatar-hero" />
          <strong className="avatar-name">{findAvatar(avatar)?.name}</strong>
          <button type="button" className="btn btn-ghost" onClick={random}>
            <Icon name="replay" size={16} />
            Au hasard
          </button>
        </div>

        <div className="field">
          <span className="field-label">Choisis ton avatar</span>
          <div className="avatar-groups" role="radiogroup" aria-label="Avatar">
            {AVATAR_GROUPS.map((group) => (
              <div key={group} className="avatar-group">
                <span className="avatar-group-title">{group}</span>
                <div className="avatar-grid">
                  {AVATARS.filter((a) => a.group === group).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={a.id === avatar}
                      aria-label={a.name}
                      className={`avatar-choice ${a.id === avatar ? 'is-on' : ''}`}
                      onClick={() => onAvatarChange(a.id)}
                    >
                      <Avatar id={a.id} size={52} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Ton pseudo</span>
          <input
            value={name}
            maxLength={20}
            autoComplete="nickname"
            placeholder="Ex. : Paulo"
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>

        {editCode ? (
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
              onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
            />
          </label>
        ) : (
          <p className="join-code muted">
            Partie <span className="mono">{code}</span>
            <button type="button" className="btn btn-ghost small" onClick={() => setEditCode(true)}>
              Changer
            </button>
          </p>
        )}

        {hint && <p className="notice is-bad">{hint}</p>}
        {error && <p className="notice is-bad">{error}</p>}
        {!online && <p className="notice">Connexion au serveur…</p>}
        <button className="btn btn-primary btn-lg" type="submit" disabled={joining}>
          {joining ? 'Connexion à la partie…' : "C'est parti"}
          {!joining && <Icon name="arrow" size={18} />}
        </button>
      </form>
    </main>
  )
}
