import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../api'
import { useStore } from '../store'
import { useT } from '../hooks'
import { DIGITS, UNIT, fmt, ruleLabel } from '../util'

function Card({ c, t, i }) {
  return (
    <motion.article className={`ev-card ${c.relevance}`} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 + i * 0.06 }}>
      <div className="ev-top">
        <span className="chip">{c.kind}</span>
        <span className={`chip ${c.relevance === 'direct' ? 'cy' : ''}`}>{c.relevance === 'direct' ? t.evDirect : t.evAdjacent}</span>
        <span className="ev-id">{c.id}</span>
      </div>
      <h4>{c.title}</h4>
      {c.summary && <p>{c.summary}</p>}
      <div className="ev-foot">
        {c.mission && <span className="dim">{c.mission}</span>}
        <span className="dim">{t.evRetrieved} {c.retrieved || ''}</span>
        <a href={c.url} target="_blank" rel="noreferrer noopener">{t.evOpenLink} ↗</a>
      </div>
      <div className="ev-sigs">{c.signals?.map((s) => <span key={s} className="chip tiny">{t.sigShort[s]}</span>)}</div>
    </motion.article>
  )
}

export default function EvidenceDrawer() {
  const t = useT()
  const open = useStore((s) => s.evidenceOpen)
  const close = useStore((s) => s.openEvidence)
  const alerts = useStore((s) => s.alerts)
  const subject = useStore((s) => s.subject)
  const selId = useStore((s) => s.selectedAlertId)
  const sig = useStore((s) => s.selectedSignal)
  const mine = alerts.filter((a) => a.crew_id === subject)
  const a = mine.find((x) => x.id === selId) || mine[mine.length - 1]
  const [extra, setExtra] = useState(null)

  const needFetch = open && (!a || !a.evidence)
  useEffect(() => {
    if (!needFetch) { setExtra(null); return }
    const sigs = a ? a.signals : [sig]
    Promise.all(sigs.map((s) => api.evidenceSignal(s))).then((rs) => {
      const m = new Map()
      rs.forEach((r) => r.cards.forEach((c) => { if (!m.has(c.id)) m.set(c.id, c) }))
      setExtra([...m.values()].sort((x, y) => (x.relevance === 'direct' ? 0 : 1) - (y.relevance === 'direct' ? 0 : 1)))
    }).catch(() => setExtra([]))
  }, [needFetch, a, sig])

  const cards = a?.evidence || extra || []
  return (
    <AnimatePresence>
      {open && (
        <motion.aside className="drawer" role="dialog" aria-label={t.evTitle}
          initial={{ x: '105%' }} animate={{ x: 0 }} exit={{ x: '105%' }} transition={{ type: 'spring', stiffness: 220, damping: 28 }}>
          <div className="drawer-h">
            <div>
              <div className="eyebrow">{t.evidence}</div>
              <h3>{a ? ruleLabel(a.rule || a.rule_family) : t.sig[sig]}</h3>
              {a && <div className="dim">{a.crew_id} · {t.day} {a.day + 1}</div>}
            </div>
            <button className="btn ghost" onClick={() => close(false)} aria-label={t.close}>✕</button>
          </div>
          <div className="drawer-body">
            {a?.details && (
              <motion.div className="rule-box" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="sub-h">{t.ruleFired}</div>
                <code>{a.rule}</code>
                {a.details.map((d) => (
                  <div key={d.signal} className="rule-line">
                    {t.sig[d.signal]}: <b>{fmt(Math.abs(d.z), 1)} SD {d.z < 0 ? '↓' : '↑'}</b> · {fmt(d.current, DIGITS[d.signal])} {UNIT[d.signal]} vs {fmt(d.baseline_mean, DIGITS[d.signal])} ± {fmt(d.baseline_sd, DIGITS[d.signal] + 1)}
                  </div>
                ))}
                <div className="muted">{t.notDiagnosis}</div>
              </motion.div>
            )}
            <div className="sub-h">{t.evTitle} · {cards.length} <span className="tag sim">{t.sim}</span></div>
            <p className="muted">{t.evContext}</p>
            {cards.map((c, i) => <Card key={c.id} c={c} t={t} i={i} />)}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
