import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { useT } from '../hooks'
import { SIGNALS, UNIT } from '../util'
import SignalChart from './SignalChart'

export default function ChartPanel() {
  const t = useT()
  const series = useStore((s) => s.series)
  const sel = useStore((s) => s.selectedSignal)
  const setSignal = useStore((s) => s.setSignal)
  const alerts = useStore((s) => s.alerts)
  const subject = useStore((s) => s.subject)
  const role = useStore((s) => s.role)
  const viewer = useStore((s) => s.viewer)
  const validation = useStore((s) => s.validation)
  const [win, setWin] = useState(120)
  const tier0 = role === 'crew' && subject === viewer && series
  const mine = useMemo(() => alerts.filter((a) => a.crew_id === subject && a.signals?.includes(sel)), [alerts, subject, sel])
  const planted = useMemo(() => (validation?.planted || []).filter((p) => p.crew_id === subject && p.signals.includes(sel)), [validation, subject, sel])
  return (
    <div className="panel chart-panel">
      <div className="panel-h">
        <span>{t.chartTitle}</span>
        <span className="tag sim">{t.sim}</span>
      </div>
      <div className="chart-ctl">
        <div className="sig-tabs">
          {SIGNALS.map((s) => <button key={s} className={sel === s ? 'on' : ''} onClick={() => setSignal(s)}>{t.sigShort[s]}</button>)}
        </div>
        <div className="seg small">
          {[60, 120, 0].map((w) => <button key={w} className={win === w ? 'on' : ''} onClick={() => setWin(w)}>{w || 'ALL'}</button>)}
        </div>
      </div>
      {tier0 ? (
        <div className="chart-slot"><SignalChart sig={sel} data={series.data[sel]} alerts={mine} planted={planted} windowDays={win} height="100%" label={t.learningBase + '…'} /></div>
      ) : (
        <div className="chart-lock">🔒 {t.restrictedBody}</div>
      )}
      <div className="legend">
        <span><i className="lg band" />{t.band}</span>
        <span><i className="lg trace" />{t.trace} ({t.sig[sel]}, {UNIT[sel]})</span>
        <span><i className="lg alert" />{t.threshold}</span>
        {planted.length > 0 && <span><i className="lg planted" />{t.gt}</span>}
      </div>
    </div>
  )
}
