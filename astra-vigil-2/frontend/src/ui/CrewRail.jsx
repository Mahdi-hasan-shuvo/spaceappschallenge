import { motion } from 'framer-motion'
import { useStore } from '../store'
import { useT } from '../hooks'
import { STATUS_COLOR } from '../util'
import CrewPhoto from './CrewPhoto'

export default function CrewRail() {
  const t = useT()
  const crew = useStore((s) => s.crew)
  const subject = useStore((s) => s.subject)
  const setSubject = useStore((s) => s.setSubject)
  const role = useStore((s) => s.role)
  const viewer = useStore((s) => s.viewer)
  return (
    <div className="crew-rail">
      {crew.map((c, i) => {
        const col = STATUS_COLOR[c.status] || STATUS_COLOR.unknown
        const me = role === 'crew' && c.id === viewer
        return (
          <motion.button key={c.id} className={`crew-chip ${subject === c.id ? 'sel' : ''} st-${c.status}`} onClick={() => setSubject(c.id)}
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}
            whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} title={t.statusHelp[c.status]}>
            <CrewPhoto c={c} size={46} />
            <span className="cc-text">
              <span className="cc-name">{c.callsign}{me ? ' ★' : ''}</span>
              <span className="cc-title">{c.title}</span>
              <span className="cc-status" style={{ color: col }}><i className={c.status === 'alert' ? 'blink' : ''} style={{ background: col, boxShadow: `0 0 8px ${col}` }} />{t.status[c.status] || c.status}</span>
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}
