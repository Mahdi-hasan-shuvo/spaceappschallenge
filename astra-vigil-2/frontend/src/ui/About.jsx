import { AnimatePresence, motion } from 'framer-motion'
import { useT } from '../hooks'

export default function About({ open, onClose }) {
  const t = useT()
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="modal" initial={{ y: 30, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">{t.team} · NASA Space Apps Challenge 2026</div>
            <h2>ASTRA VIGIL <em>2.0</em></h2>
            <div className="sim-banner">{t.sim}</div>
            <p>{t.aboutBody}</p>
            <p className="muted">{t.simLong}</p>
            <p className="muted">Niloy Bhattacharjee · Apache-2.0</p>
            <button className="btn cyan" onClick={onClose}>{t.close}</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
