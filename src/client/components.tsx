import { SNIPPET_DURATIONS_MS, type PlayerRoundView, type RoomView, type Track } from '../shared/protocol.ts'

/** Les paliers d'extrait (1 s, 2 s, 4 s…) avec le palier en cours mis en avant. */
export function StageBar({ stage, progressKey, progressMs }: { stage: number; progressKey?: number; progressMs?: number }) {
  const total = SNIPPET_DURATIONS_MS[SNIPPET_DURATIONS_MS.length - 1]
  return (
    <div className="stage-bar">
      <div className="stage-track">
        {SNIPPET_DURATIONS_MS.map((ms, i) => (
          <div
            key={ms}
            className={`stage-mark ${i <= stage ? 'unlocked' : ''}`}
            style={{ left: `${(ms / total) * 100}%` }}
          />
        ))}
        <div className="stage-unlocked" style={{ width: `${(SNIPPET_DURATIONS_MS[stage] / total) * 100}%` }} />
        {progressKey !== undefined && progressMs !== undefined && (
          <div
            key={progressKey}
            className="stage-progress"
            style={{ ['--target' as string]: `${(progressMs / total) * 100}%`, animationDuration: `${progressMs}ms` }}
          />
        )}
      </div>
      <div className="stage-labels">
        {SNIPPET_DURATIONS_MS.map((ms, i) => (
          <span key={ms} className={i === stage ? 'current' : ''}>
            {ms / 1000}s
          </span>
        ))}
      </div>
    </div>
  )
}

const STATUS_ICONS: Record<PlayerRoundView['status'], string> = {
  pending: '…',
  correct: '✅',
  wrong: '❌',
  passed: '⏭️',
}

export function RoundStatusList({ room }: { room: RoomView }) {
  return (
    <ul className="player-list">
      {room.players.map((p) => {
        const r = room.roundResults.find((x) => x.playerId === p.id)
        return (
          <li key={p.id} className={p.connected ? '' : 'offline'}>
            <span className="status">{STATUS_ICONS[r?.status ?? 'pending']}</span>
            <span className="name">{p.name}</span>
            <span className="score">{p.score} pts</span>
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
          <li key={p.id} className={p.id === highlightId ? 'me' : ''}>
            <span className="rank">{i + 1}</span>
            <span className="name">{p.name}</span>
            {room.phase === 'reveal' && r?.foundAtStage !== undefined && (
              <span className="gain">
                +{r.points} ({SNIPPET_DURATIONS_MS[r.foundAtStage] / 1000}s)
              </span>
            )}
            <span className="score">{p.score}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function TrackCard({ track }: { track: Track }) {
  return (
    <div className="track-card">
      {track.albumImage && <img src={track.albumImage} alt="" />}
      <div>
        <div className="track-title">{track.title}</div>
        <div className="track-artists">{track.artists.join(', ')}</div>
      </div>
    </div>
  )
}
