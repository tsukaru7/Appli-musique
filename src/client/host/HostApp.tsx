import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import {
  POINTS_BY_STAGE,
  SNIPPET_DURATIONS_MS,
  type AnswerOption,
  type GameMode,
  type RoomView,
  type Track,
} from '../../shared/protocol.ts'
import {
  Cover,
  Icon,
  PlayRing,
  RoundStatusList,
  Scoreboard,
  StageBar,
  TrackReveal,
  Wordmark,
  seconds,
  type IconName,
} from '../components.tsx'
import { DeezerRound, GuessInput, RoundHeader, WrongGuesses, useWrongGuesses } from '../player/PlayerApp.tsx'
import { createPlayerSocket, socket, SocketContext, type GameSocket } from '../socket.ts'
import { getMe, getMyPlaylists, getPlaylist, getPlaylistTracks, parsePlaylistId, type PlaylistSummary } from '../spotify/api.ts'
import { isLoggedIn, login, logout } from '../spotify/auth.ts'
import { SnippetPlayer } from '../spotify/player.ts'

const SESSION_KEY = 'hostSession'
const PASSWORD_KEY = 'hostPassword'
const LAST_STAGE = SNIPPET_DURATIONS_MS.length - 1

interface HostSession {
  code: string
  hostKey: string
}

function readSession(): HostSession | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')
  } catch {
    return null
  }
}

interface ServerInfo {
  lanAddresses: string[]
  hostPasswordRequired: boolean
}

let infoRequest: Promise<ServerInfo> | null = null
function serverInfo(): Promise<ServerInfo> {
  infoRequest ??= fetch('/api/info').then((r) => r.json())
  return infoRequest
}

export function HostApp() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn())
  const [password, setPassword] = useState(() => localStorage.getItem(PASSWORD_KEY) ?? '')
  const [needsPassword, setNeedsPassword] = useState<boolean | null>(null)
  const [loginError] = useState(() => {
    const e = sessionStorage.getItem('loginError')
    sessionStorage.removeItem('loginError')
    return e
  })

  useEffect(() => {
    serverInfo()
      .then((info) => setNeedsPassword(info.hostPasswordRequired))
      .catch(() => setNeedsPassword(false))
  }, [])

  if (needsPassword === null) return <Splash />

  if (needsPassword && !password) {
    return (
      <PasswordGate
        onUnlock={(p) => {
          localStorage.setItem(PASSWORD_KEY, p)
          setPassword(p)
        }}
      />
    )
  }

  if (!loggedIn) {
    return (
      <Splash>
        <p className="lede">Le blind test entre amis, avec vos playlists Spotify.</p>
        {loginError && <p className="notice is-bad">{loginError}</p>}
        <button className="btn btn-primary btn-lg" onClick={() => login()}>
          Se connecter avec Spotify
        </button>
        <ul className="feature-list">
          <li>
            <Icon name="phone" />
            <span>
              <strong>Mode Deezer</strong> — chacun écoute sur son téléphone, à son rythme.
            </span>
          </li>
          <li>
            <Icon name="speaker" />
            <span>
              <strong>Mode Spotify</strong> — le son sort de l'ordinateur, tout le monde écoute ensemble.
            </span>
          </li>
        </ul>
      </Splash>
    )
  }

  return (
    <Host
      password={password}
      onBadPassword={() => {
        localStorage.removeItem(PASSWORD_KEY)
        setPassword('')
      }}
      onLogout={() => {
        logout()
        setLoggedIn(false)
      }}
    />
  )
}

function Splash({ children }: { children?: ReactNode }) {
  return (
    <main className="splash">
      <Wordmark large />
      {children}
    </main>
  )
}

function PasswordGate({ onUnlock }: { onUnlock: (password: string) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/host-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: value }),
      })
      const data = await res.json()
      if (data.ok) onUnlock(value)
      else setError(data.error)
    } catch {
      setError('Serveur injoignable, réessaie.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Splash>
      <p className="lede">Accès réservé à l'organisateur de la partie.</p>
      <form
        className="stack narrow"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="field">
          <span className="field-label">Mot de passe hôte</span>
          <input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        {error && <p className="notice is-bad">{error}</p>}
        <button className="btn btn-primary btn-lg" type="submit" disabled={!value || busy}>
          <Icon name="lock" size={18} />
          Entrer
        </button>
      </form>
      <p className="muted small">Tu es joueur ? Scanne le QR code affiché sur l'écran de l'hôte.</p>
    </Splash>
  )
}

function Host({
  password,
  onBadPassword,
  onLogout,
}: {
  password: string
  onBadPassword: () => void
  onLogout: () => void
}) {
  const [userName, setUserName] = useState<string | null>(null)
  const [player, setPlayer] = useState<SnippetPlayer | null>(null)
  const [playerError, setPlayerError] = useState<string | null>(null)
  const [room, setRoom] = useState<RoomView | null>(null)
  const [session, setSession] = useState<HostSession | null>(readSession)
  const [current, setCurrent] = useState<{ track: Track; stage: number } | null>(null)
  const [progress, setProgress] = useState<{ key: number; ms: number } | null>(null)
  const [playing, setPlaying] = useState(false)
  /** Mode Spotify : silence à sauter au début du morceau en cours (réglé par l'hôte). */
  const [skipMs, setSkipMs] = useState(0)
  const skipRef = useRef(0)
  const [setup, setSetup] = useState<Setup>(() => {
    const saved = localStorage.getItem('setup')
    return saved === 'spotify' || saved === 'solo' ? saved : 'deezer'
  })
  // En solo on est sur l'ordinateur : Spotify par défaut (morceau joué depuis le début).
  const [soloSource, setSoloSource] = useState<GameMode>(() =>
    localStorage.getItem('soloSource') === 'deezer' ? 'deezer' : 'spotify',
  )
  const chosenMode: GameMode = setup === 'solo' ? soloSource : setup
  const mode = room?.mode ?? chosenMode
  const revealAudio = useRef<HTMLAudioElement | null>(null)
  const solo = useSoloPlayer(room, userName)

  const chooseSetup = (value: Setup) => {
    localStorage.setItem('setup', value)
    setSetup(value)
  }
  const chooseSoloSource = (value: GameMode) => {
    localStorage.setItem('soloSource', value)
    setSoloSource(value)
  }

  useEffect(() => {
    getMe()
      .then((me) => setUserName(me.display_name ?? me.id))
      .catch((err) => setPlayerError(err.message))
  }, [])

  // Le lecteur Spotify n'est démarré qu'en mode Spotify (il ne marche pas sur téléphone).
  const needsSpotifyPlayer = mode === 'spotify'
  useEffect(() => {
    if (!needsSpotifyPlayer) return
    setPlayerError(null)
    let cancelled = false
    let created: SnippetPlayer | null = null
    SnippetPlayer.create((message) => setPlayerError(message))
      .then((p) => {
        if (cancelled) return p.disconnect()
        created = p
        setPlayer(p)
      })
      .catch((err) => !cancelled && setPlayerError(err.message))
    return () => {
      cancelled = true
      created?.disconnect()
      setPlayer(null)
    }
  }, [needsSpotifyPlayer])

  // Connexion au serveur de jeu (et reprise de la partie après un rechargement de page)
  useEffect(() => {
    const onConnect = () => {
      const s = readSession()
      if (!s) return
      socket.emit('host:resume', s, (res) => {
        if (!res.ok) {
          localStorage.removeItem(SESSION_KEY)
          setSession(null)
          setRoom(null)
        }
      })
    }
    const onTrack = (payload: { track: Track; stage: number }) => setCurrent(payload)
    socket.on('connect', onConnect)
    socket.on('room:update', setRoom)
    socket.on('host:track', onTrack)
    if (socket.connected) onConnect()
    return () => {
      socket.off('connect', onConnect)
      socket.off('room:update', setRoom)
      socket.off('host:track', onTrack)
    }
  }, [])

  const playSnippet = useCallback(
    async (track: Track, stage: number) => {
      if (!player) return
      const durationMs = SNIPPET_DURATIONS_MS[stage]
      setPlaying(true)
      try {
        await player.playSnippet(
          track.uri,
          durationMs,
          () => {
            setProgress((p) => ({ key: (p?.key ?? 0) + 1, ms: durationMs }))
            socket.emit('host:snippet', { stage, durationMs })
          },
          skipRef.current,
        )
      } catch (err) {
        setPlayerError((err as Error).message)
      } finally {
        setPlaying(false)
      }
    },
    [player],
  )

  // Nouveau morceau ou nouveau palier : on joue l'extrait automatiquement, après une courte pause.
  useEffect(() => {
    if (!current || !player) return
    const timer = setTimeout(() => playSnippet(current.track, current.stage), current.stage === 0 ? 1500 : 1000)
    return () => clearTimeout(timer)
  }, [current, player, playSnippet])

  // Nouvelle manche : on coupe tout de suite le morceau de la révélation précédente.
  const phase = room?.phase
  const roundNumber = room?.roundNumber
  useEffect(() => {
    if (player && phase === 'playing') player.stop().catch(() => {})
  }, [player, phase, roundNumber])

  // Le silence sauté ne vaut que pour le morceau en cours.
  useEffect(() => {
    skipRef.current = 0
    setSkipMs(0)
  }, [roundNumber])

  /** Le morceau commence par un silence : on décale le départ d'une seconde et on rejoue. */
  const skipSilence = () => {
    if (!current) return
    skipRef.current += 1000
    setSkipMs(skipRef.current)
    playSnippet(current.track, current.stage)
  }

  // Révélation : on laisse tourner le morceau ; fin de partie : on coupe.
  useEffect(() => {
    if (!player || !current) return
    if (phase === 'reveal') player.playFull(current.track.uri).catch(() => {})
    if (phase === 'finished') player.stop().catch(() => {})
  }, [phase, player, current])

  // Mode Deezer : à la révélation, l'écran de l'hôte joue l'extrait pour tout le monde.
  const roomCode = room?.code
  useEffect(() => {
    if (mode !== 'deezer' || !roomCode) return
    revealAudio.current ??= new Audio()
    const audio = revealAudio.current
    if (phase === 'reveal') {
      audio.src = `/api/preview/${roomCode}/${roundNumber}`
      audio.currentTime = 0
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }, [mode, phase, roomCode, roundNumber])

  const newGame = () => {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
    setRoom(null)
    setCurrent(null)
    player?.stop().catch(() => {})
    revealAudio.current?.pause()
  }

  const createRoom = (tracks: Track[], totalRounds: number) =>
    new Promise<void>((resolve, reject) => {
      socket.emit('host:create', { tracks, totalRounds, mode: chosenMode, solo: setup === 'solo', password }, (res) => {
        if (!res.ok) {
          if (res.error.includes('Mot de passe')) onBadPassword()
          return reject(new Error(res.error))
        }
        const s = { code: res.code, hostKey: res.hostKey }
        localStorage.setItem(SESSION_KEY, JSON.stringify(s))
        setSession(s)
        resolve()
      })
    })

  const status =
    mode === 'deezer'
      ? { tone: 'neutral', text: (room?.solo ?? setup === 'solo') ? 'Son Deezer sur cet écran' : 'Son sur les téléphones' }
      : playerError
        ? { tone: 'bad', text: playerError }
        : player
          ? { tone: 'good', text: 'Lecteur Spotify prêt' }
          : { tone: 'neutral', text: 'Démarrage du lecteur…' }

  return (
    <div className="app">
      <header className="appbar">
        <Wordmark />
        <span className={`pill tone-${status.tone}`}>
          <span className="pill-dot" />
          {status.text}
        </span>
        <span className="appbar-user">
          <span className="muted">{userName}</span>
          <button className="btn-icon" onClick={onLogout} title="Se déconnecter de Spotify">
            <Icon name="logout" size={18} />
          </button>
        </span>
      </header>

      <main className="page">
        {!session || !room ? (
          <PlaylistPicker
            setup={setup}
            onSetupChange={chooseSetup}
            soloSource={soloSource}
            onSoloSourceChange={chooseSoloSource}
            onCreate={createRoom}
          />
        ) : room.phase === 'lobby' && room.solo ? (
          <section className="card solo-ready">
            <span className="eyebrow">Partie solo</span>
            <h1 className="display">Prêt ?</h1>
            <p className="muted">
              {room.totalRounds} morceaux à trouver · son {room.mode === 'deezer' ? 'Deezer' : 'Spotify'}
            </p>
            <div className="stack">
              <button
                className="btn btn-primary btn-lg"
                disabled={!solo || (mode === 'spotify' && !player)}
                onClick={async () => {
                  if (mode === 'spotify') await player?.activate()
                  socket.emit('host:start')
                }}
              >
                Commencer
                <Icon name="arrow" size={18} />
              </button>
              <button className="btn btn-ghost" onClick={newGame}>
                Changer de playlist
              </button>
            </div>
          </section>
        ) : room.phase === 'lobby' ? (
          <Lobby
            room={room}
            canStart={mode === 'deezer' || player !== null}
            onStart={async () => {
              if (mode === 'spotify') await player?.activate()
              socket.emit('host:start')
            }}
            onCancel={newGame}
          />
        ) : room.phase === 'finished' ? (
          <section className="card final">
            <span className="eyebrow">Partie terminée</span>
            {room.solo ? (
              <>
                <h1 className="display">Ton score</h1>
                <p className="solo-score">
                  {room.players[0]?.score ?? 0}
                  <span> / {room.totalRounds * POINTS_BY_STAGE[0]}</span>
                </p>
              </>
            ) : (
              <>
                <h1 className="display">Classement</h1>
                <Scoreboard room={room} />
              </>
            )}
            <button className="btn btn-primary btn-lg" onClick={newGame}>
              Nouvelle partie
            </button>
          </section>
        ) : (
          <section className="round">
            {/* En solo, l'écran de jeu affiche lui-même la manche et les points en jeu. */}
            {!(room.solo && room.phase === 'playing') && (
              <div className="round-head">
                <div>
                  <span className="eyebrow">Manche</span>
                  <div className="round-count">
                    {room.roundNumber}
                    <span>/{room.totalRounds}</span>
                  </div>
                </div>
                {!room.solo && (
                  <div className="round-code">
                    <span className="eyebrow">Code</span>
                    <span className="mono">{room.code}</span>
                  </div>
                )}
              </div>
            )}

            {room.phase === 'playing' && room.solo && solo && (
              <SocketContext.Provider value={solo.socket}>
                <div className="solo-play">
                  {room.mode === 'deezer' ? (
                    <DeezerRound room={room} playerId={solo.id} options={solo.options} />
                  ) : (
                    <SoloSpotifyRound
                      room={room}
                      playerId={solo.id}
                      options={solo.options}
                      progress={progress}
                      playing={playing}
                      skipMs={skipMs}
                      onReplay={() => current && playSnippet(current.track, room.stage)}
                      onSkipSilence={skipSilence}
                    />
                  )}
                </div>
              </SocketContext.Provider>
            )}

            {room.phase === 'playing' && !room.solo && room.mode === 'deezer' && (
              <>
                <p className="muted">Chacun écoute sur son téléphone et avance à son rythme.</p>
                <RoundStatusList room={room} />
                <div className="toolbar">
                  <button className="btn" onClick={() => socket.emit('host:reveal')}>
                    <Icon name="eye" size={18} />
                    Révéler maintenant
                  </button>
                </div>
              </>
            )}

            {room.phase === 'playing' && !room.solo && room.mode === 'spotify' && (
              <>
                <div className="card">
                  <StageBar stage={room.stage} progressKey={progress?.key} progressMs={progress?.ms} />
                  <div className="toolbar">
                    <button
                      className="btn"
                      disabled={!current || playing}
                      onClick={() => current && playSnippet(current.track, room.stage)}
                    >
                      <Icon name="replay" size={18} />
                      Rejouer
                    </button>
                    <button className="btn" onClick={() => socket.emit('host:nextStage')}>
                      <Icon name="skip" size={18} />
                      {room.stage < LAST_STAGE ? `Allonger à ${seconds(room.stage + 1)}` : 'Fin de la manche'}
                    </button>
                    <button className="btn btn-ghost" onClick={() => socket.emit('host:reveal')}>
                      <Icon name="eye" size={18} />
                      Révéler
                    </button>
                  </div>
                  <div className="silence">
                    <span className="muted small">
                      {skipMs > 0
                        ? `Départ décalé de ${skipMs / 1000} s pour sauter le silence.`
                        : 'Le morceau commence par un silence ?'}
                    </span>
                    <button className="btn btn-ghost" disabled={!current || playing || skipMs >= 15000} onClick={skipSilence}>
                      Sauter 1 s de silence
                    </button>
                  </div>
                </div>
                <RoundStatusList room={room} />
              </>
            )}

            {room.phase === 'reveal' && room.revealed && (
              <div className="reveal-layout">
                <TrackReveal track={room.revealed} />
                <div className="stack">
                  <Scoreboard room={room} />
                  <button className="btn btn-primary btn-lg" onClick={() => socket.emit('host:nextRound')}>
                    {room.roundNumber < room.totalRounds ? 'Manche suivante' : 'Voir le classement'}
                    <Icon name="arrow" size={18} />
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

/** Façon de jouer choisie par l'hôte. « solo » : on joue seul sur cet écran. */
type Setup = 'deezer' | 'spotify' | 'solo'

const SETUPS: { id: Setup; icon: IconName; title: string; text: string }[] = [
  {
    id: 'deezer',
    icon: 'phone',
    title: 'Chacun son téléphone',
    text: 'Chaque joueur écoute de son côté et avance à son rythme. Extraits Deezer, aucun compte nécessaire.',
  },
  {
    id: 'spotify',
    icon: 'speaker',
    title: 'Un écran, des téléphones',
    text: 'Le son sort de cet ordinateur, tout le monde écoute ensemble et répond sur son téléphone. Spotify Premium.',
  },
  {
    id: 'solo',
    icon: 'headphones',
    title: 'Solo sur cet écran',
    text: "Personne à connecter : tu écoutes et tu réponds ici, comme sur Songless.",
  },
]

const SOURCES: { id: GameMode; title: string; text: string }[] = [
  { id: 'spotify', title: 'Spotify', text: 'Le vrai morceau, depuis le début' },
  { id: 'deezer', title: 'Deezer', text: 'Plan B si Spotify ne lit pas : extraits de 30 s, silence sauté tout seul' },
]

const ROUND_CHOICES = [5, 10, 15, 20, 30]

function PlaylistPicker({
  setup,
  onSetupChange,
  soloSource,
  onSoloSourceChange,
  onCreate,
}: {
  setup: Setup
  onSetupChange: (setup: Setup) => void
  soloSource: GameMode
  onSoloSourceChange: (source: GameMode) => void
  onCreate: (tracks: Track[], totalRounds: number) => Promise<void>
}) {
  const mode: GameMode = setup === 'solo' ? soloSource : setup
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null)
  const [link, setLink] = useState('')
  const [rounds, setRounds] = useState(10)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getMyPlaylists()
      .then(setPlaylists)
      .catch((err) => setError(err.message))
  }, [])

  const choose = async (id: string, name?: string) => {
    setError(null)
    setBusy(`Chargement de ${name ?? 'la playlist'}…`)
    try {
      const tracks = await getPlaylistTracks(id)
      if (tracks.length < 3) throw new Error('Cette playlist contient trop peu de morceaux jouables.')
      if (mode === 'deezer') setBusy('Recherche des extraits sur Deezer…')
      await onCreate(tracks, rounds)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const chooseLink = async () => {
    const id = parsePlaylistId(link)
    if (!id) return setError('Lien invalide. Il doit ressembler à https://open.spotify.com/playlist/…')
    let name: string | undefined
    try {
      name = (await getPlaylist(id)).name
    } catch {
      // le nom n'est qu'un bonus pour l'affichage
    }
    await choose(id, name)
  }

  return (
    <div className="setup">
      <section className="setup-step">
        <h2 className="step-title">
          <span className="step-num">1</span>Comment on joue ?
        </h2>
        <div className="choice-grid">
          {SETUPS.map((m) => (
            <button
              key={m.id}
              className={`choice ${setup === m.id ? 'is-selected' : ''}`}
              onClick={() => onSetupChange(m.id)}
              aria-pressed={setup === m.id}
            >
              <span className="choice-icon">
                <Icon name={m.icon} size={22} />
              </span>
              <span className="choice-title">{m.title}</span>
              <span className="choice-text">{m.text}</span>
            </button>
          ))}
        </div>
        {setup === 'solo' && (
          <div className="source-picker">
            <span className="field-label">Le son vient de</span>
            <div className="segmented" role="radiogroup">
              {SOURCES.map((src) => (
                <button
                  key={src.id}
                  role="radio"
                  aria-checked={soloSource === src.id}
                  className={soloSource === src.id ? 'is-on' : ''}
                  onClick={() => onSoloSourceChange(src.id)}
                >
                  {src.title}
                </button>
              ))}
            </div>
            <span className="muted small">{SOURCES.find((src) => src.id === soloSource)?.text}</span>
          </div>
        )}
      </section>

      <section className="setup-step">
        <h2 className="step-title">
          <span className="step-num">2</span>
          {setup === 'solo' ? 'Combien de morceaux ?' : 'Combien de manches ?'}
        </h2>
        <div className="segmented" role="radiogroup">
          {ROUND_CHOICES.map((n) => (
            <button key={n} role="radio" aria-checked={rounds === n} className={rounds === n ? 'is-on' : ''} onClick={() => setRounds(n)}>
              {n}
            </button>
          ))}
        </div>
      </section>

      <section className="setup-step">
        <h2 className="step-title">
          <span className="step-num">3</span>Quelle playlist ?
        </h2>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            chooseLink()
          }}
        >
          <input
            placeholder="Coller le lien d'une playlist Spotify publique"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button className="btn" type="submit" disabled={!link || busy !== null}>
            Utiliser
          </button>
        </form>

        {error && <p className="notice is-bad">{error}</p>}
        {busy && <p className="notice">{busy}</p>}

        {playlists === null && !error ? (
          <p className="muted">Chargement de tes playlists…</p>
        ) : (
          <div className="playlist-grid">
            {playlists?.map((p) => (
              <button key={p.id} className="playlist" disabled={busy !== null} onClick={() => choose(p.id, p.name)}>
                <span className="playlist-cover">{p.image && <Cover src={p.image} />}</span>
                <span className="playlist-name">{p.name}</span>
                <span className="playlist-meta">{p.total !== undefined ? `${p.total} titres` : p.owner}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/** Adresse que les téléphones doivent ouvrir pour rejoindre la partie. */
function useJoinUrl(code: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const { hostname, port, origin } = window.location
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
      setUrl(`${origin}/join?code=${code}`)
      return
    }
    // En local, les téléphones doivent passer par l'adresse de l'ordinateur sur le Wi-Fi.
    serverInfo()
      .then((info) => {
        const ip = info.lanAddresses[0]
        setUrl(ip ? `http://${ip}:${port}/join?code=${code}` : `${origin}/join?code=${code}`)
      })
      .catch(() => setUrl(`${origin}/join?code=${code}`))
  }, [code])
  return url
}

function Lobby({
  room,
  canStart,
  onStart,
  onCancel,
}: {
  room: RoomView
  canStart: boolean
  onStart: () => void
  onCancel: () => void
}) {
  const joinUrl = useJoinUrl(room.code)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (joinUrl && canvas.current) {
      QRCode.toCanvas(canvas.current, joinUrl, { width: 220, margin: 0, color: { dark: '#141210', light: '#ffffff' } })
    }
  }, [joinUrl])

  return (
    <div className="lobby">
      <section className="card join-card">
        <span className="eyebrow">Pour rejoindre</span>
        <div className="qr">
          <canvas ref={canvas} />
        </div>
        <p className="muted small">Scanne avec l'appareil photo, ou entre le code sur</p>
        <p className="mono small join-url">{joinUrl?.replace(/^https?:\/\//, '').replace(/\?.*$/, '') ?? '…'}</p>
        <div className="big-code" aria-label={`Code ${room.code}`}>
          {room.code.split('').map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
      </section>

      <section className="lobby-side">
        <div>
          <span className="eyebrow">Joueurs</span>
          <h2 className="display">
            {room.players.length === 0 ? 'On attend du monde' : `${room.players.length} prêt${room.players.length > 1 ? 's' : ''}`}
          </h2>
        </div>
        {room.players.length > 0 && (
          <ul className="chips">
            {room.players.map((p) => (
              <li key={p.id} className={p.connected ? '' : 'is-offline'}>
                {p.name}
              </li>
            ))}
          </ul>
        )}
        <dl className="facts">
          <div>
            <dt>Mode</dt>
            <dd>{room.mode === 'deezer' ? 'Chacun son téléphone' : 'Un seul écran'}</dd>
          </div>
          <div>
            <dt>Manches</dt>
            <dd>{room.totalRounds}</dd>
          </div>
        </dl>
        {room.mode === 'deezer' && (
          <p className="tip">
            <Icon name="headphones" size={18} />
            Dans la même pièce, mieux vaut des écouteurs : sinon chacun entend les extraits des autres.
          </p>
        )}
        <div className="stack">
          <button className="btn btn-primary btn-lg" disabled={!canStart || room.players.length === 0} onClick={onStart}>
            Lancer la partie
            <Icon name="arrow" size={18} />
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>
            Changer de playlist
          </button>
        </div>
      </section>
    </div>
  )
}

const SOLO_ID_KEY = 'soloPlayerId'

/**
 * Partie solo : la page de l'hôte rejoint sa propre partie comme joueur, avec une seconde
 * connexion, pour réutiliser exactement les écrans de jeu des téléphones.
 */
function useSoloPlayer(
  room: RoomView | null,
  name: string | null,
): { socket: GameSocket; id: string; options: AnswerOption[] } | null {
  const [state, setState] = useState<{ socket: GameSocket; id: string; options: AnswerOption[] } | null>(null)
  const code = room?.solo ? room.code : null
  // Le pseudo arrive après la connexion Spotify : on le lit au moment de rejoindre, sans reconnecter.
  const nameRef = useRef(name)
  nameRef.current = name

  useEffect(() => {
    if (!code) return
    let id = localStorage.getItem(SOLO_ID_KEY)
    if (!id) {
      id = `solo-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(SOLO_ID_KEY, id)
    }
    const playerSocket = createPlayerSocket()
    const playerId = id
    const join = () =>
      playerSocket.emit('player:join', { code, name: nameRef.current || 'Moi', playerId }, (res) => {
        if (res.ok) setState({ socket: playerSocket, id: playerId, options: res.options })
      })
    playerSocket.on('connect', join)
    return () => {
      playerSocket.off('connect', join)
      playerSocket.disconnect()
      setState(null)
    }
  }, [code])

  return state
}

/** Solo avec le son Spotify : l'extrait sort de cet écran, et on répond juste en dessous. */
function SoloSpotifyRound({
  room,
  playerId,
  options,
  progress,
  playing,
  skipMs,
  onReplay,
  onSkipSilence,
}: {
  room: RoomView
  playerId: string
  options: AnswerOption[]
  progress: { key: number; ms: number } | null
  playing: boolean
  skipMs: number
  onReplay: () => void
  onSkipSilence: () => void
}) {
  const playerSocket = useContext(SocketContext)
  const wrongGuesses = useWrongGuesses(room.code, room.roundNumber)
  const mine = room.roundResults.find((r) => r.playerId === playerId)

  return (
    <section className="stack">
      <RoundHeader room={room} points={POINTS_BY_STAGE[room.stage]} />
      <PlayRing
        onClick={onReplay}
        disabled={playing}
        label={`Réécouter ${seconds(room.stage)}`}
        progressKey={progress?.key}
        progressMs={progress?.ms}
      />
      <StageBar stage={room.stage} progressKey={progress?.key} progressMs={progress?.ms} />
      {mine?.status !== 'correct' && (
        <>
          <GuessInput options={options} roundNumber={room.roundNumber} />
          <button className="btn btn-ghost btn-block" onClick={() => playerSocket.emit('player:pass')}>
            <Icon name="skip" size={18} />
            {room.stage < LAST_STAGE ? `Passer · écouter ${seconds(room.stage + 1)}` : 'Abandonner le morceau'}
          </button>
        </>
      )}
      <WrongGuesses guesses={wrongGuesses} />
      <button className="btn btn-ghost small" disabled={playing || skipMs >= 15000} onClick={onSkipSilence}>
        {skipMs > 0 ? `Départ décalé de ${skipMs / 1000} s · sauter 1 s de plus` : 'Ça commence par un silence ? Sauter 1 s'}
      </button>
    </section>
  )
}
