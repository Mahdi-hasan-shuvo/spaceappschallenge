import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'
import { useT } from '../hooks'
import { DIGITS, STATUS_COLOR, UNIT, fmt, ruleLabel } from '../util'

export function Details({ a, t }) {
  return (
    <div className="a-details">
      {a.details.map((d) => (
        <div className="a-row" key={d.signal}>
          <div className="a-sig">{t.sig[d.signal]}</div>
          <div className="a-num">
            <b className={d.z < 0 ? 'blue' : 'red'}>{fmt(Math.abs(d.z), 1)} SD {d.z < 0 ? '↓' : '↑'}</b>
            <span> · now <b>{fmt(d.current, DIGITS[d.signal])}</b> {UNIT[d.signal]}</span>
            <span> · {t.baseline} {fmt(d.baseline_mean, DIGITS[d.signal])} ± {fmt(d.baseline_sd, DIGITS[d.signal] + 1)}</span>
            <span className="dim"> · {d.window_days}{d.row_unit === 'second' ? 's' : 'd'}, n={d.baseline_n}, thr {d.threshold_sd} SD</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function AlertCard({ a, t, lang, selected, onSelect, onEvidence }) {
  const full = !!a.details
  return (
    <motion.div layout initial={{ opacity: 0, y: -14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
      className={`alert-card ${selected ? 'sel' : ''}`} onClick={onSelect}>
      <div className="a-head">
        <span className="a-rule">{ruleLabel(a.rule || a.rule_family)}</span>
        <span className="a-day">{t.day} {a.day + 1}</span>
      </div>
      <div className="a-chips">{a.signals.map((s) => <span key={s} className="chip">{t.sigShort[s]}</span>)}</div>
      {full && selected && (
        <>
          <div className="sub-h">{t.numbers}</div>
          <Details a={a} t={t} />
          <div className="sub-h">{t.whatChanged}</div>
          <p className="a-expl">{(lang === 'bn' && a.explanation_bn) || a.explanation}</p>
          <div className="a-actions">
            <button className="btn cyan" onClick={(e) => { e.stopPropagation(); onEvidence() }}>📚 {t.open} ({a.evidence?.length || 0})</button>
          </div>
          {a.ground_truth && (
            <div className="gt">
              <span className="tag sim">{t.sim}</span> {t.gt}: {a.ground_truth.planted ? `${t.gtYes} ${a.ground_truth.onset_day + 1}` : t.gtNo}
            </div>
          )}
        </>
      )}
      {!full && selected && (
        <div className="a-actions"><button className="btn cyan" onClick={(e) => { e.stopPropagation(); onEvidence() }}>📚 {t.open}</button></div>
      )}
    </motion.div>
  )
}

export default function AlertsTab() {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const alerts = useStore((s) => s.alerts)
  const subject = useStore((s) => s.subject)
  const crew = useStore((s) => s.crew.find((c) => c.id === s.subject))
  const selId = useStore((s) => s.selectedAlertId)
  const selectAlert = useStore((s) => s.selectAlert)
  const openEvidence = useStore((s) => s.openEvidence)
  const mine = alerts.filter((a) => a.crew_id === subject).slice().reverse()
  const st = crew?.status || 'unknown'
  return (
    <div className="tab-body">
      <div className="summary" style={{ borderColor: STATUS_COLOR[st] }}>
        <div className="sub-h">{t.crewSummary}</div>
        <p>{crew ? t.summaryText(crew.callsign, st) : ''}</p>
        <div className="muted">{t.notDiagnosis}</div>
      </div>
      <div className="sub-h">{t.alertsTitle} · {mine.length}</div>
      {mine.length === 0 && <div className="empty">{t.noAlerts}</div>}
      <AnimatePresence initial={false}>
        {mine.map((a) => (
          <AlertCard key={a.id} a={a} t={t} lang={lang} selected={selId === a.id}
            onSelect={() => selectAlert(a.id)} onEvidence={() => { selectAlert(a.id); openEvidence(true) }} />
        ))}
      </AnimatePresence>
    </div>
  )
}
