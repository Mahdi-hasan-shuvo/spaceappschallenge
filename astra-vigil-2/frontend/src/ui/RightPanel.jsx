import { motion } from 'framer-motion'
import { useStore } from '../store'
import { useT } from '../hooks'
import AlertsTab from './AlertsTab'
import AssistantTab from './AssistantTab'
import EarthTab from './EarthTab'
import TrustTab from './TrustTab'
import RehearsalTab from './RehearsalTab'

const TABS = ['alerts', 'assistant', 'earth', 'rehearsal', 'trust']
const BODY = { alerts: AlertsTab, assistant: AssistantTab, earth: EarthTab, rehearsal: RehearsalTab, trust: TrustTab }

export default function RightPanel() {
  const t = useT()
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const nAlerts = useStore((s) => s.alerts.filter((a) => a.crew_id === s.subject).length)
  const Body = BODY[tab]
  return (
    <div className="panel right">
      <div className="tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {t.tabs[k]}{k === 'alerts' && nAlerts > 0 ? <em>{nAlerts}</em> : null}
            {tab === k && <motion.i layoutId="tabline" className="tabline" />}
          </button>
        ))}
      </div>
      <div className="tab-scroll"><Body /></div>
    </div>
  )
}
