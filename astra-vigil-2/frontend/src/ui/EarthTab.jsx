import { motion } from 'framer-motion'
import { useStore } from '../store'
import { useT, useNow } from '../hooks'
import { STATUS_COLOR } from '../util'

export default function EarthTab() {
  const t = useT()
  const outbox = useStore((s) => s.outbox)
  const delay = useStore((s) => s.delay)
  const skew = useStore((s) => s.skew)
  const crew = useStore((s) => s.crew)
  const role = useStore((s) => s.role)
  const setDelay = useStore((s) => s.setDelay)
  const now = useNow(250) + skew

  // what Earth knows = the latest delivered message per crew member
  const knows = {}
  for (const o of outbox) if (o.delivered || o.deliver_at <= now) knows[o.crew_id] = o
  const items = outbox.slice(-12).reverse()
  return (
    <div className="tab-body">
      <div className="sub-h">{t.earth}</div>
      <p className="muted">{t.earthSub}</p>
      <div className="presets">
        {Object.entries(delay.presets || {}).map(([k, v]) => (
          <button key={k} className={`chip btn-chip ${delay.key === k ? 'on' : ''}`} disabled={role === 'ground'} onClick={() => setDelay(k)}>
            {k.replace('_', ' ')} · {v} min
          </button>
        ))}
      </div>
      <div className="muted">{t.delay}: <b>{delay.min} min</b> · {t.demoScale}</div>

      <div className="sub-h">{t.earthKnows}</div>
      <div className="knows">
        {crew.map((c) => {
          const o = knows[c.id]
          const st = role === 'ground' ? c.status : o?.status || 'unknown'
          return (
            <div className="know" key={c.id}>
              <span className="dot" style={{ background: STATUS_COLOR[st] || STATUS_COLOR.unknown }} />
              <span>{c.callsign}</span>
              <b style={{ color: STATUS_COLOR[st] }}>{t.status[st] || st}</b>
              <span className="dim">{o ? `${t.day} ${o.day + 1}` : ''}</span>
            </div>
          )
        })}
      </div>

      <div className="sub-h">Outbox</div>
      {items.length === 0 && <div className="empty">{t.noOutbox}</div>}
      {items.map((o) => {
        const total = Math.max(0.05, o.deliver_at - o.queued_at)
        const k = Math.max(0, Math.min(1, (now - o.queued_at) / total))
        const done = o.delivered || k >= 1
        const col = STATUS_COLOR[o.status]
        return (
          <div className="ob" key={o.id}>
            <div className="ob-top">
              <b style={{ color: col }}>{t.status[o.status] || o.status}</b>
              <span>{o.crew_id} · {t.day} {o.day + 1}</span>
              <span className={done ? 'cyan' : 'amber'}>{done ? t.delivered : `${t.queued} · ${t.arrivesIn} ${Math.max(0, Math.ceil(o.deliver_at - now))} s`}</span>
            </div>
            <div className="ob-bar"><motion.i animate={{ width: `${(done ? 1 : k) * 100}%` }} transition={{ duration: 0.25 }} style={{ background: col }} /></div>
            <div className="dim small">{o.delay_min} min {t.modeled} · {o.rule ? o.rule.replace(/_/g, ' ') : ''}</div>
          </div>
        )
      })}
    </div>
  )
}
