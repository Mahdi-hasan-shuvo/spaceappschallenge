import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'
import { useT } from '../hooks'
import { DIGITS, UNIT, fmt, ruleLabel } from '../util'

// The anomaly moment, in 2D: red edge glow, a banner that drops in, and the numbers behind the rule.
export default function AlertBanner() {
  const t = useT()
  const flash = useStore((s) => s.flash)
  const a = useStore((s) => (s.flash ? s.alerts.find((x) => x.id === s.flash.id) : null))
  const openEvidence = useStore((s) => s.openEvidence)
  return (
    <AnimatePresence>
      {flash && a && (
        <>
          <motion.div key="edge" className="alert-edge" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.35, 0.9, 0.3] }} exit={{ opacity: 0 }} transition={{ duration: 2.2 }} />
          <motion.div key="banner" className="alert-banner" role="alert"
            initial={{ y: -90, opacity: 0, scale: 0.96 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
            <div className="ab-scan" />
            <div className="ab-title"><span className="ab-ico">⚠</span> {t.alertBanner}</div>
            <div className="ab-rule">{ruleLabel(a.rule || a.rule_family)} · {t.day} {a.day + 1}</div>
            {a.details && (
              <div className="ab-nums">
                {a.details.slice(0, 3).map((d) => (
                  <span key={d.signal}>{t.sigShort[d.signal]} <b>{fmt(Math.abs(d.z), 1)} SD</b> {d.z < 0 ? '↓' : '↑'} {fmt(d.current, DIGITS[d.signal])}{UNIT[d.signal]}</span>
                ))}
              </div>
            )}
            <div className="ab-foot">
              <span>{t.notDiagnosis}</span>
              <button className="btn cyan" onClick={() => openEvidence(true)}>📚 {t.open}</button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
