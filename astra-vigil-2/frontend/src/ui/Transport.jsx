import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import { useT } from '../hooks'
import Btn from './Btn'

export default function Transport() {
  const t = useT()
  const { day, n, playing, speed, alerts, subject, meta, role } = useStore()
  const ro = role === 'ground' // Earth watches; it does not drive the habitat replay
  const { setSpeed, seek, reset, rehearse, togglePlay } = useStore.getState()
  const [drag, setDrag] = useState(null)
  const speeds = meta?.speeds || [1, 2, 5, 10, 20]
  const mine = alerts.filter((a) => a.crew_id === subject)
  useEffect(() => { setDrag(null) }, [day])
  const val = drag ?? day
  const finished = day >= n - 1
  const fresh = day < 0
  // Start (fresh) -> Pause (running) -> Resume (paused) -> Restart (finished)
  const label = playing ? t.pause : finished ? t.restart : fresh ? t.start : t.resume
  const icon = playing ? 'pause' : finished ? 'restart' : 'play'

  return (
    <div className="transport">
      <Btn variant={playing ? '' : 'cyan'} size="big" icon={icon} disabled={ro} data-quiet data-testid="transport-main" onClick={() => togglePlay()} aria-label={label}>{label}</Btn>
      <div className="speeds" aria-label={t.speed}>
        {speeds.map((s) => (
          <button key={s} disabled={ro} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>×{s}</button>
        ))}
      </div>
      <div className="scrub">
        <div className="scrub-top">
          <span>{t.day} <b>{val + 1}</b> / {n}</span>
          <span className="dim">{t.dayOf(val, n)}</span>
        </div>
        <div className="scrub-track">
          <div className="scrub-fill" style={{ width: `${((val + 1) / n) * 100}%` }} />
          {mine.map((a) => <i key={a.id} className="scrub-mark" style={{ left: `${((a.day + 1) / n) * 100}%` }} />)}
          <input type="range" disabled={ro} min={-1} max={n - 1} value={val} aria-label={t.day}
            onChange={(e) => setDrag(+e.target.value)}
            onPointerUp={(e) => { seek(+e.target.value) }}
            onKeyUp={(e) => { if (e.key.startsWith('Arrow')) seek(+e.target.value) }} />
        </div>
      </div>
      <motion.span whileTap={{ scale: 0.96 }}><Btn variant="amber" icon="flag" disabled={ro} onClick={() => rehearse()}>{t.rehearse}</Btn></motion.span>
      <Btn variant="ghost" icon="restart" disabled={ro} onClick={() => reset()}>{t.reset}</Btn>
    </div>
  )
}
