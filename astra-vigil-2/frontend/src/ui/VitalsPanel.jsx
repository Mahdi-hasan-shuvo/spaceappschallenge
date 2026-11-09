import { motion } from 'framer-motion'
import { useStore } from '../store'
import { useT } from '../hooks'
import { DIGITS, SIGNALS, STATUS_COLOR, UNIT, fmt, worseColor } from '../util'
import Spark from './Spark'

function Gauge({ w }) {
  // -3 .. +3 SD on the "worse" axis. Centre = personal baseline.
  const v = w == null ? 0 : Math.max(-3, Math.min(3, w))
  const pct = ((v + 3) / 6) * 100
  const col = worseColor(w)
  return (
    <div className="gauge" aria-hidden>
      <div className="gauge-zone" />
      <motion.i className="gauge-dot" animate={{ left: `${pct}%`, background: col, boxShadow: `0 0 10px ${col}` }} transition={{ type: 'spring', stiffness: 180, damping: 20 }} />
    </div>
  )
}

export default function VitalsPanel() {
  const t = useT()
  const series = useStore((s) => s.series)
  const role = useStore((s) => s.role)
  const subject = useStore((s) => s.subject)
  const viewer = useStore((s) => s.viewer)
  const sel = useStore((s) => s.selectedSignal)
  const setSignal = useStore((s) => s.setSignal)
  const flash = useStore((s) => s.flash)
  const crew = useStore((s) => s.crew.find((c) => c.id === s.subject))
  const trends = useStore((s) => s.trends)
  const tier0 = role === 'crew' && subject === viewer && series

  if (!tier0) {
    const tr = trends[subject]
    return (
      <div className="panel vitals">
        <div className="panel-h"><span>{t.vitals}</span><span className="tag sim">{t.sim}</span></div>
        <div className="locked">
          <div className="lock-ico">🔒</div>
          <div className="lock-t">{t.restricted}</div>
          <p>{t.restrictedBody}</p>
          {crew && <div className="status-big" style={{ color: STATUS_COLOR[crew.status] }}>{t.status[crew.status]}</div>}
        </div>
        {tr && (
          <div className="trend">
            <div className="sub-h">{t.trendTitle}</div>
            {SIGNALS.map((s) => {
              const x = tr.signals[s]?.trend || ''
              const k = x.includes('worse') ? t.toWorse : x.includes('better') ? t.toBetter : x.includes('steady') ? t.steady : t.learningBase
              return (
                <div className="trend-row" key={s}>
                  <span>{t.sig[s]}</span>
                  <b className={x.includes('worse') ? 'red' : x.includes('better') ? 'cyan' : ''}>{k}</b>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="panel vitals">
      <div className="panel-h"><span>{t.vitals}</span><span className="tag sim">{t.sim}</span></div>
      <div className="vital-list">
        {SIGNALS.map((s) => {
          const d = series.data[s]
          const i = d.v.length - 1
          const v = i >= 0 ? d.v[i] : null
          const mu = i >= 0 ? d.mu[i] : null
          const sd = i >= 0 ? d.sd[i] : null
          const w = i >= 0 ? d.w[i] : null
          const hot = flash?.signals?.includes(s)
          const col = worseColor(w)
          return (
            <motion.button
              key={s}
              className={`vital ${sel === s ? 'sel' : ''} ${hot ? 'hot' : ''}`}
              onClick={() => setSignal(s)}
              animate={hot ? { x: [0, -3, 3, -2, 2, 0] } : { x: 0 }}
              transition={{ duration: 0.45 }}
            >
              <div className="v-top">
                <span className="v-label">{t.sig[s]}</span>
                <span className="v-dev" style={{ color: col }}>
                  {w == null ? t.learningBase : `${fmt(Math.abs(w), 1)} ${t.sdUnit} ${w > 0 ? t.worse : t.better}`}
                </span>
              </div>
              <div className="v-mid">
                <motion.span key={`${s}-${v}`} className="v-num" initial={{ opacity: 0.4, y: -3 }} animate={{ opacity: 1, y: 0 }} style={{ color: col }}>
                  {fmt(v, DIGITS[s])}
                </motion.span>
                <span className="v-unit">{UNIT[s]}</span>
                <div className="v-spark"><Spark data={d} color={col} /></div>
              </div>
              <Gauge w={w} />
              <div className="v-base">{t.baseline} {mu == null ? '–' : `${fmt(mu, DIGITS[s])} ± ${fmt(sd, DIGITS[s] + 1)} ${UNIT[s]}`}</div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
