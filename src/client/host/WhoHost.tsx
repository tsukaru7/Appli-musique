// Écrans de l'hôte pour « Qui a mis ce son ? ».
import { useEffect, useState } from 'react'
import type { RoomView } from '../../shared/protocol.ts'
import { Avatar } from '../avatar.tsx'
import { Icon, PlayRing, Scoreboard, TrackReveal } from '../components.tsx'
import { socket } from '../socket.ts'

const PER_PLAYER_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10]

/** Réglages : combien de morceaux chaque joueur apporte. */
export function WhoSetup({ onBack, onCreate }: { onBack: () => void; onCreate: (perPlayer: number) => Promise<void> }) {
  const [perPlayer, setPerPlayer] = useState(() => {
    const saved = Number(localStorage.getItem('whoPerPlayer'))
    return PER_PLAYER_CHOICES.includes(saved) ? saved : 2
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      localStorage.setItem('whoPerPlayer', String(perPlayer))
      await onCreate(perPlayer)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setup">
      <div className="setup-head">
        <button className="btn btn-ghost back" onClick={onBack}>
          <span className="back-arrow">
            <Icon name="arrow" size={16} />
          </span>
          Changer de jeu
        </button>
        <span className="eyebrow">Entre amis</span>
        <h1 className="display">Qui a mis ce son ?</h1>
        <p className="muted">
          Chacun choisit des morceaux en secret sur son téléphone. On les écoute ensemble sur cet écran, et tout le
          monde vote pour celui qui l'a mis.
        </p>
      </div>

      <section className="setup-step">
        <h2 className="step-title">
          <span className="step-num">1</span>Combien de morceaux par joueur ?
        </h2>
        <div className="segmented" role="radiogroup">
          {PER_PLAYER_CHOICES.map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={perPlayer === n}
              className={perPlayer === n ? 'is-on' : ''}
              onClick={() => setPerPlayer(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="muted small">
          Avec 4 joueurs, ça fait {4 * perPlayer} morceaux à écouter (environ {Math.round((4 * perPlayer * 50) / 60)} min).
        </p>
      </section>

      <section className="setup-step">
        <h2 className="step-title">
          <span className="step-num">2</span>Les points
        </h2>
        <ul className="rules">
          <li>
            <strong>Tu trouves qui l'a mis</strong> : 500 points, jusqu'à 1000 si tu réponds vite.
          </li>
          <li>
            <strong>C'est ton morceau</strong> : 200 points pour chaque joueur que tu as trompé.
          </li>
        </ul>
      </section>

      <section className="setup-step">
        {error && <p className="notice is-bad">{error}</p>}
        <div className="create-row">
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={create}>
            Créer la partie
            <Icon name="arrow" size={18} />
          </button>
          <span className="muted small">Le son sortira de cet écran : branche une enceinte si tu peux.</span>
        </div>
        <DeezerCountry />
      </section>
    </div>
  )
}

/**
 * Deezer adapte son catalogue au pays du serveur : on vérifie une fois pour toutes, automatiquement,
 * qu'il est vu en France (sinon certains morceaux peuvent manquer à la recherche).
 */
function DeezerCountry() {
  const [country, setCountry] = useState<{ iso: string; name: string } | null | undefined>(undefined)
  useEffect(() => {
    fetch('/api/deezer-country')
      .then((r) => r.json())
      .then((data) => setCountry(data.country ?? null))
      .catch(() => setCountry(null))
  }, [])
  if (country === undefined || country === null) return null
  if (country.iso === 'FR') {
    return (
      <p className="tip">
        <Icon name="check" size={18} />
        Catalogue Deezer français, le même que sur vos téléphones.
      </p>
    )
  }
  return (
    <p className="notice is-bad">
      Deezer voit le serveur depuis : {country.name}. Certains morceaux peuvent manquer à la recherche (le catalogue
      change selon le pays).
    </p>
  )
}

/** Pendant l'écoute : le morceau tourne sur cet écran, les téléphones votent. */
export function WhoRound({
  room,
  progress,
  playing,
  onReplay,
}: {
  room: RoomView
  progress: { key: number; ms: number } | null
  playing: boolean
  onReplay: () => void
}) {
  const votes = room.whois?.voted.length ?? 0
  const voters = Math.max(0, room.players.filter((p) => p.connected).length - 1)
  return (
    <div className="who-round">
      <h1 className="display who-question">Qui a mis ce son ?</h1>
      <PlayRing label="Écoutez bien…" progressKey={progress?.key} progressMs={progress?.ms} />
      <ul className="who-players">
        {room.players.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'is-offline'}>
            <Avatar id={p.avatar} size={72} />
            <span>{p.name}</span>
          </li>
        ))}
      </ul>
      <p className="muted">
        {votes} / {voters} vote{voters > 1 ? 's' : ''}
      </p>
      <div className="toolbar">
        <button className="btn" disabled={playing} onClick={onReplay}>
          <Icon name="replay" size={18} />
          Réécouter
        </button>
        <button className="btn btn-ghost" onClick={() => socket.emit('host:reveal')}>
          <Icon name="eye" size={18} />
          Révéler
        </button>
      </div>
    </div>
  )
}

/** Révélation : le morceau, qui l'a mis, et qui a voté pour qui. */
export function WhoReveal({ room }: { room: RoomView }) {
  if (!room.revealed) return null
  return (
    <div className="reveal-layout">
      <div className="stack">
        <TrackReveal track={room.revealed} />
        <WhoOwner room={room} />
      </div>
      <div className="stack">
        <WhoVotes room={room} />
        <Scoreboard room={room} />
        <button className="btn btn-primary btn-lg" onClick={() => socket.emit('host:nextRound')}>
          {room.roundNumber < room.totalRounds ? 'Morceau suivant' : 'Voir le classement'}
          <Icon name="arrow" size={18} />
        </button>
      </div>
    </div>
  )
}

/** « Ajouté par » : la personne qui a mis le morceau. */
export function WhoOwner({ room }: { room: RoomView }) {
  const owner = room.players.find((p) => p.id === room.whois?.ownerId)
  if (!owner) return null
  return (
    <div className="who-owner">
      <Avatar id={owner.avatar} size={64} />
      <div>
        <span className="eyebrow">Ajouté par</span>
        <strong>{owner.name}</strong>
      </div>
    </div>
  )
}

/** Qui a voté pour qui (les bons votes en vert). */
export function WhoVotes({ room }: { room: RoomView }) {
  const votes = Object.entries(room.whois?.votes ?? {})
  if (votes.length === 0) return <p className="muted">Personne n'a voté.</p>
  const byId = new Map(room.players.map((p) => [p.id, p]))
  return (
    <ul className="who-votes">
      {votes.map(([voterId, targetId]) => {
        const voter = byId.get(voterId)
        const target = byId.get(targetId)
        const correct = targetId === room.whois?.ownerId
        return (
          <li key={voterId} className={correct ? 'is-good' : 'is-bad'}>
            <Avatar id={voter?.avatar} size={30} />
            <span className="who-vote-name">{voter?.name}</span>
            <span className="who-vote-arrow">a voté</span>
            <Avatar id={target?.avatar} size={30} />
            <span className="who-vote-name">{target?.name}</span>
            <Icon name={correct ? 'check' : 'cross'} size={16} />
          </li>
        )
      })}
    </ul>
  )
}
