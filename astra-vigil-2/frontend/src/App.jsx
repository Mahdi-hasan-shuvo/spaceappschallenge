import { Suspense, lazy, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from './store'
import { useT } from './hooks'
import TopBar from './ui/TopBar'
import CrewRail from './ui/CrewRail'
import VitalsPanel from './ui/VitalsPanel'
import ChartPanel from './ui/ChartPanel'
import Transport from './ui/Transport'
import RightPanel from './ui/RightPanel'
import EvidenceDrawer from './ui/EvidenceDrawer'
import AlertBanner from './ui/AlertBanner'
import About from './ui/About'
import Intro from './ui/Intro'
import CrewPhoto from './ui/CrewPhoto'
import { audio } from './audio'

const Scene = lazy(() => import('./scene/Scene'))

export default function App() {
  const t = useT()
  const init = useStore((s) => s.init)
  const spatial = useStore((s) => s.spatial)
  const vr = useStore((s) => s.vr)
  const look = useStore((s) => s.look)
  const setLook = useStore((s) => s.setLook)
  const crew = useStore((s) => s.crew.find((c) => c.id === s.subject))
  const [about, setAbout] = useState(false)
  useEffect(() => { init() }, [init])
  // One delegated listener gives every button a click blip and a soft hover tick (opt out with data-quiet).
  useEffect(() => {
    let last = null
    const hit = (e) => e.target.closest?.('button, [role=button], select, .seg button')
    const click = (e) => { const b = hit(e); if (b && !b.disabled && b.dataset.quiet === undefined) audio.click() }
    const over = (e) => { const b = hit(e); if (b && b !== last && !b.disabled && b.dataset.quiet === undefined) audio.hover(); last = b || null }
    document.addEventListener('click', click, true)
    document.addEventListener('pointerover', over, true)
    return () => { document.removeEventListener('click', click, true); document.removeEventListener('pointerover', over, true) }
  }, [])
  const st = crew?.status || 'learning'

  return (
    <div className={`app ${spatial ? 'spatial' : ''} st-${st}`}>
      <Intro />
      <TopBar onAbout={() => setAbout(true)} />
      <main className="main">
        <aside className="col-left">
          <CrewRail />
          <VitalsPanel />
        </aside>

        <section className="stage" aria-label="3D">
          <Suspense fallback={<div className="stage-load">Loading 3D…</div>}>
            <Scene />
          </Suspense>
          <div className="stage-hud top-left">
            {crew && <CrewPhoto c={crew} size={58} />}
            <div className="hud-txt">
              <div className="hud-status" data-status={st}>{crew ? `${crew.callsign} · ${t.status[st]}` : ''}</div>
              <div className="hud-help">{t.statusHelp[st]}</div>
            </div>
          </div>
          <div className="stage-hud bottom-left"><span className="wm">{t.sim}</span></div>
          <div className="look-switch" role="group" aria-label="Look">
            <button className={look === 'holo' ? 'on' : ''} onClick={() => setLook('holo')}>{t.lookHolo}</button>
            <button className={look === 'real' ? 'on' : ''} onClick={() => setLook('real')}>{t.lookReal}</button>
          </div>
          <div className="stage-hud bottom-right hint">{spatial ? t.spatialHint : t.hint3d}</div>
          <AlertBanner />
        </section>

        <aside className="col-right">
          <RightPanel />
          <EvidenceDrawer />
        </aside>
      </main>
      <footer className="bottom">
        <Transport />
        <ChartPanel />
      </footer>
      <div className="foot-note">{t.footer} · {t.simLong}</div>
      <About open={about} onClose={() => setAbout(false)} />
      {vr && <motion.div className="vr-badge" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>VR</motion.div>}
    </div>
  )
}
