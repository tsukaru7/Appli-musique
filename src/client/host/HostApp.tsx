import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { SNIPPET_DURATIONS_MS, type GameMode, type RoomView, type Track } from '../../shared/protocol.ts'
import { RoundStatusList, Scoreboard, StageBar, TrackCard } from '../components.tsx'
import { socket } from '../socket.ts'
import { getMe, getMyPlaylists, getPlaylist, getPlaylistTracks, parsePlaylistId, type PlaylistSummary } from '../spotify/api.ts'
import { isLoggedIn, login, logout } from '../spotify/auth.ts'
import { SnippetPlayer } from '../spotify/player.ts'

const SESSION_KEY = 'hostSession'

interface HostSession {
  code: string
  hostKey: string
}

function readSession(): HostSession | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null')
  } catch {
    return null
  }
}

export function HostApp() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn())
  const [loginError] = useState(() => {
    const e = sessionStorage.getItem('loginError')
    sessionStorage.removeItem('loginError')
    return e
  })

  if (!loggedIn) {
    return (
      <main className="host center">
        <h1>🎵 Appli-musique</h1>
        <p className="subtitle">Le blind test entre potes, avec vos playlists Spotify.</p>
        {loginError && <p className="error">{loginError}</p>}
        <button className="primary big" onClick={() => login()}>
          Se connecter avec Spotify
        </button>
        <p className="hint">
          Cette page est celle de l'<strong>hôte</strong>, qui choisit la playlist. Les joueurs rejoindront avec leur
          téléphone.
          <br />
          Mode Spotify : le son sort de l'ordinateur de l'hôte (Chrome, Edge ou Firefox, compte Premium).
          <br />
          Mode Deezer : chacun écoute sur son téléphone, l'hôte peut être sur n'importe quel appareil.
        </p>
      </main>
    )
  }
  return (
    <Host
      onLogout={() => {
        logout()
        setLoggedIn(false)
      }}
    />
  )
}

function Host({ onLogout }: { onLogout: () => void }) {
  const [userName, setUserName] = useState<string | null>(null)
  const [player, setPlayer] = useState<SnippetPlayer | null>(null)
  const [playerError, setPlayerError] = useState<string | null>(null)
  const [room, setRoom] = useState<RoomView | null>(null)
  const [session, setSession] = useState<HostSession | null>(readSession)
  const [current, setCurrent] = useState<{ track: Track; stage: number } | null>(null)
  const [progress, setProgress] = useState<{ key: number; ms: number } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [chosenMode, setChosenMode] = useState<GameMode>(() =>
    localStorage.getItem('gameMode') === 'spotify' ? 'spotify' : 'deezer',
  )
  const mode = room?.mode ?? chosenMode
  const revealAudio = useRef<HTMLAudioElement | null>(null)

  const chooseMode = (m: GameMode) => {
    localStorage.setItem('gameMode', m)
    setChosenMode(m)
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
          sessionStorage.removeItem(SESSION_KEY)
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
        await player.playSnippet(track.uri, durationMs, () => {
          setProgress((p) => ({ key: (p?.key ?? 0) + 1, ms: durationMs }))
          socket.emit('host:snippet', { stage, durationMs })
        })
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
  const round = room?.roundNumber
  useEffect(() => {
    if (player && phase === 'playing') player.stop().catch(() => {})
  }, [player, phase, round])

  // Révélation : on laisse tourner le morceau ; fin de partie : on coupe.
  useEffect(() => {
    if (!player || !current) return
    if (phase === 'reveal') player.playFull(current.track.uri).catch(() => {})
    if (phase === 'finished') player.stop().catch(() => {})
  }, [phase, player, current])

  // Mode Deezer : à la révélation, l'écran de l'hôte joue l'extrait pour tout le monde.
  const roomCode = room?.code
  const roundNumber = room?.roundNumber
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
    sessionStorage.removeItem(SESSION_KEY)
    setSession(null)
    setRoom(null)
    setCurrent(null)
    player?.stop().catch(() => {})
    revealAudio.current?.pause()
  }

  const createRoom = (tracks: Track[], totalRounds: number) =>
    new Promise<void>((resolve, reject) => {
      socket.emit('host:create', { tracks, totalRounds, mode: chosenMode }, (res) => {
        if (!res.ok) return reject(new Error(res.error))
        const s = { code: res.code, hostKey: res.hostKey }
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
        setSession(s)
        resolve()
      })
    })

  return (
    <main className="host">
      <header className="topbar">
        <span className="logo">🎵 Appli-musique</span>
        <span className="player-status">
          {mode === 'deezer' ? (
            '📱 Mode Deezer : le son sort des téléphones'
          ) : playerError ? (
            <span className="error">⚠️ {playerError}</span>
          ) : player ? (
            '🔊 Lecteur Spotify prêt'
          ) : (
            '⏳ Démarrage du lecteur…'
          )}
        </span>
        <span className="user">
          {userName}
          <button className="link" onClick={onLogout}>
            Déconnexion
          </button>
        </span>
      </header>

      {!session || !room ? (
        <PlaylistPicker mode={chosenMode} onModeChange={chooseMode} onCreate={createRoom} />
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
        <section className="panel center">
          <h2>🏆 Classement final</h2>
          <Scoreboard room={room} />
          <button className="primary big" onClick={newGame}>
            Nouvelle partie
          </button>
        </section>
      ) : (
        <section className="panel">
          <div className="round-header">
            <h2>
              Manche {room.roundNumber} / {room.totalRounds}
            </h2>
            <span className="code-small">Code : {room.code}</span>
          </div>

          {room.phase === 'playing' && room.mode === 'deezer' ? (
            <>
              <p className="hint">🎧 Chacun écoute sur son téléphone et avance à son rythme.</p>
              <RoundStatusList room={room} />
              <div className="actions">
                <button onClick={() => socket.emit('host:reveal')}>👀 Révéler maintenant</button>
              </div>
            </>
          ) : room.phase === 'playing' ? (
            <>
              <StageBar stage={room.stage} progressKey={progress?.key} progressMs={progress?.ms} />
              <div className="actions">
                <button disabled={!current || playing} onClick={() => current && playSnippet(current.track, room.stage)}>
                  ▶️ Rejouer l'extrait
                </button>
                <button onClick={() => socket.emit('host:nextStage')}>
                  {room.stage < SNIPPET_DURATIONS_MS.length - 1
                    ? `⏩ Extrait plus long (${SNIPPET_DURATIONS_MS[room.stage + 1] / 1000}s)`
                    : '⏩ Fin de la manche'}
                </button>
                <button onClick={() => socket.emit('host:reveal')}>👀 Révéler</button>
              </div>
              <RoundStatusList room={room} />
            </>
          ) : (
            room.revealed && (
              <>
                <TrackCard track={room.revealed} />
                <Scoreboard room={room} />
                <button className="primary big" onClick={() => socket.emit('host:nextRound')}>
                  {room.roundNumber < room.totalRounds ? 'Manche suivante →' : 'Voir le classement final 🏆'}
                </button>
              </>
            )
          )}
        </section>
      )}
    </main>
  )
}

const MODES: { id: GameMode; title: string; text: string }[] = [
  {
    id: 'deezer',
    title: '📱 Mode Deezer',
    text: 'Chacun écoute sur son téléphone et avance à son rythme. Extraits de 30 s fournis par Deezer (aucun compte Deezer nécessaire).',
  },
  {
    id: 'spotify',
    title: '🔊 Mode Spotify',
    text: "Le son sort de cet ordinateur et tout le monde écoute le même extrait. Morceaux joués depuis le début. Nécessite un ordinateur et Spotify Premium.",
  },
]

function PlaylistPicker({
  mode,
  onModeChange,
  onCreate,
}: {
  mode: GameMode
  onModeChange: (mode: GameMode) => void
  onCreate: (tracks: Track[], totalRounds: number) => Promise<void>
}) {
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
    setBusy(name ?? 'la playlist')
    try {
      const tracks = await getPlaylistTracks(id)
      if (tracks.length < 3) throw new Error('Cette playlist contient trop peu de morceaux jouables.')
      if (mode === 'deezer') setBusy('les extraits sur Deezer (quelques secondes)')
      await onCreate(tracks, rounds)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const chooseLink = async () => {
    const id = parsePlaylistId(link)
    if (!id) return setError('Lien de playlist invalide. Exemple : https://open.spotify.com/playlist/…')
    let name: string | undefined
    try {
      name = (await getPlaylist(id)).name
    } catch {
      // le nom n'est qu'un bonus pour l'affichage
    }
    await choose(id, name)
  }

  return (
    <section className="panel">
      <h2>Mode de jeu</h2>
      <div className="mode-picker">
        {MODES.map((m) => (
          <button key={m.id} className={`mode ${mode === m.id ? 'selected' : ''}`} onClick={() => onModeChange(m.id)}>
            <strong>{m.title}</strong>
            <span>{m.text}</span>
          </button>
        ))}
      </div>

      <h2>Choisis une playlist</h2>

      <div className="row">
        <label>
          Nombre de manches{' '}
          <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
            {[5, 10, 15, 20, 30].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          chooseLink()
        }}
      >
        <input
          className="grow"
          placeholder="…ou colle le lien d'une playlist publique Spotify"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <button type="submit" disabled={!link || busy !== null}>
          Utiliser ce lien
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {busy && <p className="hint">⏳ Chargement de {busy}…</p>}

      {playlists === null && !error ? (
        <p className="hint">Chargement de tes playlists…</p>
      ) : (
        <div className="playlist-grid">
          {playlists?.map((p) => (
            <button key={p.id} className="playlist" disabled={busy !== null} onClick={() => choose(p.id, p.name)}>
              {p.image ? <img src={p.image} alt="" /> : <div className="cover-placeholder">🎵</div>}
              <span className="playlist-name">{p.name}</span>
              <span className="playlist-meta">
                {p.owner}
                {p.total !== undefined && ` · ${p.total} titres`}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
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
    fetch('/api/info')
      .then((r) => r.json())
      .then((info: { lanAddresses: string[] }) => {
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
    if (joinUrl && canvas.current) QRCode.toCanvas(canvas.current, joinUrl, { width: 240, margin: 1 })
  }, [joinUrl])

  return (
    <section className="panel lobby">
      <div className="join-info">
        <p>Scanne le QR code avec ton téléphone</p>
        <canvas ref={canvas} />
        <p className="hint">ou va sur</p>
        <p className="join-url">{joinUrl ?? '…'}</p>
        <p className="hint">avec le code</p>
        <p className="code">{room.code}</p>
      </div>
      <div className="lobby-side">
        <h2>Joueurs ({room.players.length})</h2>
        {room.players.length === 0 ? (
          <p className="hint">En attente des joueurs…</p>
        ) : (
          <ul className="player-list">
            {room.players.map((p) => (
              <li key={p.id} className={p.connected ? '' : 'offline'}>
                <span className="name">{p.name}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          {room.totalRounds} manches · {room.mode === 'deezer' ? '📱 mode Deezer' : '🔊 mode Spotify'}
        </p>
        {room.mode === 'deezer' && (
          <p className="hint">🎧 Conseil : des écouteurs pour chacun, sinon tout le monde entend les extraits des autres.</p>
        )}
        <button className="primary big" disabled={!canStart || room.players.length === 0} onClick={onStart}>
          Lancer la partie
        </button>
        <button className="link" onClick={onCancel}>
          Changer de playlist
        </button>
      </div>
    </section>
  )
}
