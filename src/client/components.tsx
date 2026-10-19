import { useEffect, useState, type ReactNode } from 'react'
import {
  SNIPPET_DURATIONS_MS,
  type PlayerRoundView,
  type PlayerView,
  type RoomView,
  type Track,
} from '../shared/protocol.ts'
import { Avatar } from './avatar.tsx'

const LAST_STAGE = SNIPPET_DURATIONS_MS.length - 1
const TOTAL_MS = SNIPPET_DURATIONS_MS[LAST_STAGE]

export const seconds = (stage: number) => `${SNIPPET_DURATIONS_MS[stage] / 1000} s`

/* ---------- Icônes (traits simples, couleur du texte) ---------- */

const ICONS = {
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />,
  replay: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v4h4" />
    </>
  ),
  skip: (
    <>
      <path d="M5 6l8 6-8 6z" />
      <path d="M17 6v12" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  cross: <path d="M6 6l12 12M18 6L6 18" />,
  flag: (
    <>
      <path d="M6 21V4" />
      <path d="M6 4h11l-2.5 4L17 12H6" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  speaker: (
    <>
      <rect x="5" y="2.5" width="14" height="19" rx="3" />
      <circle cx="12" cy="14.5" r="3.5" />
      <path d="M12 7h.01" />
    </>
  ),
  logout: (
    <>
      <path d="M15 4h3a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20h-3" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
  dots: (
    <>
      <circle cx="6" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="18" cy="12" r="1" fill="currentColor" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  headphones: (
    <>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3.5" y="14" width="4" height="6.5" rx="1.5" />
      <rect x="16.5" y="14" width="4" height="6.5" rx="1.5" />
    </>
  ),
  gamepad: (
    <>
      <path d="M7 8h10a4.5 4.5 0 0 1 4.3 5.8l-1 3.3a2.4 2.4 0 0 1-4 1L14.5 16h-5l-1.8 2.1a2.4 2.4 0 0 1-4-1l-1-3.3A4.5 4.5 0 0 1 7 8z" />
      <path d="M8 11v3M6.5 12.5h3" />
      <circle cx="16" cy="11.5" r=".6" fill="currentColor" />
      <circle cx="17.5" cy="13.5" r=".6" fill="currentColor" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  film: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4" />
    </>
  ),
  tv: (
    <>
      <rect x="3" y="7" width="18" height="12.5" rx="2" />
      <path d="M8.5 3l3.5 4 3.5-4" />
    </>
  ),
  list: (
    <>
      <path d="M4 6h11M4 11h11M4 16h7" />
      <circle cx="17.5" cy="16.5" r="2.5" />
      <path d="M20 16.5V7l2 1" />
    </>
  ),
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="currentColor" stroke="none" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

/* ---------- Identité ---------- */

export function Wordmark({ large = false }: { large?: boolean }) {
  return (
    <span className={`wordmark ${large ? 'wordmark-lg' : ''}`}>
      <span className="wordmark-disc" aria-hidden="true" />
      <span>
        appli<em>musique</em>
      </span>
    </span>
  )
}

/* ---------- Extraits ---------- */

/** Barre des paliers (1 s, 2 s, 4 s…) : la partie débloquée, et l'extrait en cours de lecture. */
export function StageBar({ stage, progressKey, progressMs }: { stage: number; progressKey?: number; progressMs?: number }) {
  return (
    <div className="stagebar">
      <div className="stagebar-track">
        <div className="stagebar-unlocked" style={{ width: `${(SNIPPET_DURATIONS_MS[stage] / TOTAL_MS) * 100}%` }} />
        {progressKey !== undefined && progressMs !== undefined && (
          <div
            key={progressKey}
            className="stagebar-progress"
            style={{
              ['--target' as string]: `${(progressMs / TOTAL_MS) * 100}%`,
              animation: `fill-bar ${progressMs}ms linear, fade-out 500ms ease ${progressMs + 300}ms forwards`,
            }}
          />
        )}
        {SNIPPET_DURATIONS_MS.slice(0, -1).map((ms) => (
          <span key={ms} className="stagebar-tick" style={{ left: `${(ms / TOTAL_MS) * 100}%` }} />
        ))}
      </div>
      <div className="stagebar-labels">
        {SNIPPET_DURATIONS_MS.map((ms, i) => (
          <span
            key={ms}
            className={i === stage ? 'is-current' : i < stage ? 'is-past' : ''}
            style={{ left: `${(ms / TOTAL_MS) * 100}%` }}
          >
            {ms / 1000}s
          </span>
        ))}
      </div>
    </div>
  )
}

/** Gros bouton lecture entouré d'un anneau qui se remplit pendant l'extrait. */
export function PlayRing({
  onClick,
  progressKey,
  progressMs,
  label,
  disabled,
}: {
  onClick?: () => void
  progressKey?: number
  progressMs?: number
  label: string
  disabled?: boolean
}) {
  const r = 46
  const circumference = 2 * Math.PI * r
  const content = (
    <>
      <svg className="ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ring-bg" cx="50" cy="50" r={r} />
        {progressKey !== undefined && progressMs !== undefined && (
          <circle
            key={progressKey}
            className="ring-fg"
            cx="50"
            cy="50"
            r={r}
            style={{
              strokeDasharray: circumference,
              ['--circ' as string]: circumference,
              animation: `fill-ring ${progressMs}ms linear, fade-out 500ms ease ${progressMs + 300}ms forwards`,
            }}
          />
        )}
      </svg>
      <span className="ring-center">{onClick ? <Icon name="play" size={34} /> : <Icon name="speaker" size={30} />}</span>
    </>
  )
  return (
    <div className="playring">
      {onClick ? (
        <button className="ring-button" onClick={onClick} disabled={disabled} aria-label={label}>
          {content}
        </button>
      ) : (
        <div className="ring-button is-static">{content}</div>
      )}
      <span className="ring-label">{label}</span>
    </div>
  )
}

/** Pochette qui disparaît proprement si l'image ne charge pas (le fond prend le relais). */
export function Cover({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.display = 'none'
      }}
    />
  )
}

/* ---------- Packs ---------- */

export const PACK_ICONS: Record<string, IconName> = {
  'jeux-video': 'gamepad',
  animes: 'sparkle',
  films: 'film',
  'dessins-animes': 'tv',
}

/** Le type d'œuvre de la manche en cours (packs) : « Film », « Animé »… */
export function CategoryBadge({ category }: { category?: { id: string; label: string } }) {
  if (!category) return null
  return (
    <span className={`category category-${category.id}`}>
      <Icon name={PACK_ICONS[category.id] ?? 'list'} size={16} />
      {category.label}
    </span>
  )
}

let packArtRequest: Promise<Record<string, string[]>> | null = null

/** Images des œuvres phares de chaque pack (vide tant qu'elles ne sont pas arrivées). */
export function usePackArt(): Record<string, string[]> {
  const [art, setArt] = useState<Record<string, string[]>>({})
  useEffect(() => {
    packArtRequest ??= fetch('/api/pack-art')
      .then((r) => r.json())
      .catch(() => {
        packArtRequest = null
        return {}
      })
    let cancelled = false
    packArtRequest.then((data) => !cancelled && setArt(data))
    return () => {
      cancelled = true
    }
  }, [])
  return art
}

/** Mosaïque de pochettes (2 × 2) ; l'icône du pack si aucune image n'est disponible. */
export function ArtMosaic({ images, icon }: { images: string[]; icon: IconName }) {
  const shown = images.slice(0, 4)
  return (
    <span className={`mosaic count-${shown.length}`}>
      {shown.length === 0 ? (
        <span className="mosaic-icon">
          <Icon name={icon} size={30} />
        </span>
      ) : (
        shown.map((src) => <Cover key={src} src={src} />)
      )}
    </span>
  )
}

/* ---------- Joueurs et scores ---------- */

/** Les joueurs de la salle d'attente : avatar et pseudo. */
export function PlayerTiles({
  players,
  meId,
  counts,
  perPlayer,
}: {
  players: PlayerView[]
  meId?: string
  /** « Qui a mis ce son ? » : nombre de morceaux choisis par chacun. */
  counts?: Record<string, number>
  perPlayer?: number
}) {
  return (
    <ul className="player-tiles">
      {players.map((p) => {
        const count = counts?.[p.id] ?? 0
        return (
          <li key={p.id} className={`${p.id === meId ? 'is-me' : ''} ${p.connected ? '' : 'is-offline'}`}>
            <Avatar id={p.avatar} size={64} />
            <span>{p.name}</span>
            {counts && perPlayer !== undefined && (
              <span className={`tile-count ${count >= perPlayer ? 'is-done' : ''}`}>
                {count >= perPlayer ? <Icon name="check" size={12} /> : null}
                {count}/{perPlayer}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function statusOf(r: PlayerRoundView | undefined, mode: RoomView['mode']): { icon: IconName; text: string; tone: string } {
  switch (r?.status) {
    case 'correct':
      return { icon: 'check', text: `Trouvé à ${seconds(r.foundAtStage ?? 0)}`, tone: 'good' }
    case 'out':
      return { icon: 'flag', text: 'Abandon', tone: 'muted' }
    case 'wrong':
      return { icon: 'cross', text: 'Raté', tone: 'bad' }
    case 'passed':
      return { icon: 'skip', text: 'Passe', tone: 'muted' }
    default:
      return { icon: 'dots', text: mode === 'deezer' ? `Écoute ${seconds(r?.stage ?? 0)}` : 'Réfléchit', tone: 'muted' }
  }
}

/** Qui en est où pendant la manche. */
export function RoundStatusList({ room }: { room: RoomView }) {
  return (
    <ul className="status-grid">
      {room.players.map((p) => {
        const r = room.roundResults.find((x) => x.playerId === p.id)
        const status = statusOf(r, room.mode)
        return (
          <li key={p.id} className={`status-card tone-${status.tone} ${p.connected ? '' : 'is-offline'}`}>
            <span className="status-avatar">
              <Avatar id={p.avatar} size={40} />
              <span className="status-icon">
                <Icon name={status.icon} size={12} />
              </span>
            </span>
            <span className="status-name">{p.name}</span>
            <span className="status-text">{p.connected ? status.text : 'Déconnecté'}</span>
            {room.mode === 'deezer' && (
              <span className="status-steps" aria-hidden="true">
                {SNIPPET_DURATIONS_MS.map((ms, i) => (
                  <i key={ms} className={i <= (r?.stage ?? 0) ? 'on' : ''} />
                ))}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function Scoreboard({ room, highlightId }: { room: RoomView; highlightId?: string }) {
  const sorted = [...room.players].sort((a, b) => b.score - a.score)
  return (
    <ol className="scoreboard">
      {sorted.map((p, i) => {
        const r = room.roundResults.find((x) => x.playerId === p.id)
        return (
          <li key={p.id} className={p.id === highlightId ? 'is-me' : ''}>
            <span className="score-rank">{i + 1}</span>
            <Avatar id={p.avatar} size={34} />
            <span className="score-name">{p.name}</span>
            {room.phase === 'reveal' && r && (r.foundAtStage !== undefined || r.points > 0) && (
              <span className="score-gain">
                +{r.points} {r.foundAtStage !== undefined && room.kind !== 'whois' && <small>· {seconds(r.foundAtStage)}</small>}
              </span>
            )}
            <span className="score-total">{p.score}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function TrackReveal({
  track,
  category,
  compact = false,
}: {
  track: Track
  category?: { id: string; label: string }
  compact?: boolean
}) {
  return (
    <div className={`reveal ${compact ? 'is-compact' : ''}`}>
      <div className="reveal-cover">{track.albumImage && <Cover key={track.albumImage} src={track.albumImage} />}</div>
      <div className="reveal-text">
        <span className="eyebrow">{category ? `C'était — ${category.label}` : "C'était"}</span>
        <span className="reveal-title">{track.work ?? track.title}</span>
        <span className="reveal-artists">
          {track.work
            ? [track.title, track.artists.join(', ')].filter(Boolean).join(' — ')
            : track.artists.join(', ')}
        </span>
      </div>
    </div>
  )
}
