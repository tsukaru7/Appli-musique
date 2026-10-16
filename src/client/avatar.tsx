import { AVATARS, AVATAR_IDS, type AvatarLook } from '../shared/avatars.ts'

const INK = '#1c0e08'
const LIGHT = '#f3eee6'

function Eyes({ kind }: { kind: AvatarLook['eyes'] }) {
  switch (kind) {
    case 'happy':
      return (
        <g fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round">
          <path d="M32 57 q6 -8 12 0" />
          <path d="M56 57 q6 -8 12 0" />
        </g>
      )
    case 'wink':
      return (
        <g>
          <circle cx="38" cy="54" r="4.5" fill={INK} />
          <path d="M56 55 q6 -7 12 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
        </g>
      )
    case 'shades':
      return (
        <g fill={INK}>
          <rect x="26" y="48" width="21" height="12" rx="5" />
          <rect x="53" y="48" width="21" height="12" rx="5" />
          <rect x="45" y="51" width="10" height="3" />
          <rect x="30" y="50.5" width="7" height="3" rx="1.5" fill={LIGHT} opacity="0.5" />
        </g>
      )
    case 'big':
      return (
        <g>
          <circle cx="38" cy="54" r="8" fill={LIGHT} />
          <circle cx="62" cy="54" r="8" fill={LIGHT} />
          <circle cx="40" cy="55" r="4" fill={INK} />
          <circle cx="64" cy="55" r="4" fill={INK} />
        </g>
      )
    case 'sleepy':
      return (
        <g fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round">
          <path d="M32 54 q6 5 12 0" />
          <path d="M56 54 q6 5 12 0" />
        </g>
      )
    default:
      return (
        <g fill={INK}>
          <circle cx="38" cy="54" r="4.5" />
          <circle cx="62" cy="54" r="4.5" />
        </g>
      )
  }
}

function Mouth({ kind }: { kind: AvatarLook['mouth'] }) {
  switch (kind) {
    case 'open':
      return <path d="M40 67 q10 14 20 0 z" fill={INK} />
    case 'tongue':
      return (
        <g>
          <path d="M40 67 q10 14 20 0 z" fill={INK} />
          <ellipse cx="50" cy="73" rx="5" ry="3.5" fill="#ff8fb1" />
        </g>
      )
    case 'grin':
      return (
        <g>
          <path d="M37 66 h26 q-2 11 -13 11 q-11 0 -13 -11 z" fill={INK} />
          <rect x="40" y="66" width="20" height="4" rx="1" fill={LIGHT} />
        </g>
      )
    case 'o':
      return <ellipse cx="50" cy="70" rx="4.5" ry="5" fill={INK} />
    default:
      return <path d="M40 67 q10 10 20 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
  }
}

function Hat({ kind, color }: { kind: AvatarLook['hat']; color: string }) {
  switch (kind) {
    case 'headphones':
      return (
        <g>
          <path d="M17 58 a33 33 0 0 1 66 0" fill="none" stroke={INK} strokeWidth="6" strokeLinecap="round" />
          <rect x="9" y="50" width="14" height="22" rx="6" fill={INK} />
          <rect x="77" y="50" width="14" height="22" rx="6" fill={INK} />
          <rect x="12" y="54" width="8" height="14" rx="4" fill={LIGHT} opacity="0.25" />
        </g>
      )
    case 'cap':
      return (
        <g fill={INK}>
          <path d="M18 42 q32 -34 64 0 z" />
          <path d="M50 42 h40 q-3 7 -15 7 h-25 z" />
          <circle cx="50" cy="19" r="3" fill={LIGHT} opacity="0.5" />
        </g>
      )
    case 'crown':
      return (
        <path
          d="M30 33 L35 13 L44 25 L50 8 L56 25 L65 13 L70 33 Z"
          fill="#f2c14e"
          stroke="#b8862a"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      )
    case 'beanie':
      return (
        <g>
          <path d="M17 44 q33 -42 66 0 z" fill={LIGHT} />
          <rect x="15" y="38" width="70" height="9" rx="4.5" fill={LIGHT} stroke={INK} strokeOpacity="0.15" />
          <circle cx="50" cy="10" r="6" fill={LIGHT} />
        </g>
      )
    case 'bow':
      return (
        <g fill={color === '#ff8fb1' ? LIGHT : '#ff8fb1'} stroke={INK} strokeWidth="2" strokeLinejoin="round">
          <path d="M68 26 l-14 -10 v20 z" />
          <path d="M68 26 l14 -10 v20 z" />
          <circle cx="68" cy="26" r="4" />
        </g>
      )
    case 'antenna':
      return (
        <g>
          <path d="M50 25 V9" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="50" cy="8" r="5.5" fill={LIGHT} stroke={INK} strokeWidth="2" />
        </g>
      )
    case 'horns':
      return (
        <g fill={LIGHT} stroke={INK} strokeWidth="2" strokeLinejoin="round">
          <path d="M29 33 L24 12 L41 26 Z" />
          <path d="M71 33 L76 12 L59 26 Z" />
        </g>
      )
    default:
      return null
  }
}

/** Avatar d'un joueur (dessiné en SVG). */
export function Avatar({ id, size = 40, className = '' }: { id?: string; size?: number; className?: string }) {
  const look = AVATARS[id ?? ''] ?? AVATARS[AVATAR_IDS[0]]
  return (
    <svg
      className={`avatar ${className}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{ background: `${look.color}33` }}
    >
      <circle cx="50" cy="58" r="34" fill={look.color} />
      <ellipse cx="29" cy="66" rx="5" ry="3" fill="#ff8fb1" opacity="0.45" />
      <ellipse cx="71" cy="66" rx="5" ry="3" fill="#ff8fb1" opacity="0.45" />
      <Eyes kind={look.eyes} />
      <Mouth kind={look.mouth} />
      <Hat kind={look.hat} color={look.color} />
    </svg>
  )
}
