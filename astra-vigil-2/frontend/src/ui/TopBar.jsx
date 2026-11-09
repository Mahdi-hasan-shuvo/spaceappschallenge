import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import { useT } from '../hooks'
import { enterVR, xrStore } from '../scene/xr'
import { audio } from '../audio'
import Btn from './Btn'

const ROLES = ['crew', 'medical', 'commander', 'ground']

function useVrNative() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    let dead = false
    navigator.xr?.isSessionSupported('immersive-vr').then((v) => { if (!dead) setOk(!!v) }).catch(() => {})
    return () => { dead = true }
  }, [])
  return ok
}

export default function TopBar({ onAbout }) {
  const t = useT()
  const { role, viewer, lang, conn, spatial, vr, crew } = useStore()
  const setRole = useStore((s) => s.setRole)
  const setViewer = useStore((s) => s.setViewer)
  const setLang = useStore((s) => s.setLang)
  const setSpatial = useStore((s) => s.setSpatial)
  const vrNative = useVrNative()
  const crewIds = crew.length ? crew : [{ id: 'niloy', callsign: 'Niloy' }, { id: 'puja', callsign: 'Puja' }, { id: 'dhiraj', callsign: 'Dhiraj' }, { id: 'tusar', callsign: 'Tusar' }]
  const [snd, setSnd] = useState(audio.state)
  useEffect(() => audio.subscribe(setSnd), [])

  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden>
          <circle cx="20" cy="20" r="17" fill="none" stroke="#3ef0d2" strokeWidth="1.6" opacity=".8" />
          <circle cx="20" cy="20" r="11" fill="none" stroke="#2b8fff" strokeWidth="1" strokeDasharray="3 3" />
          <path d="M6 22h8l3-9 5 17 4-11 2 3h6" fill="none" stroke="#3ef0d2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <div className="brand-n">ASTRA VIGIL <em>2.0</em></div>
          <div className="brand-s">{t.tag} · {t.team}</div>
        </div>
      </div>

      <motion.div className="sim-badge" animate={{ opacity: [1, 0.55, 1] }} transition={{ duration: 2.4, repeat: Infinity }} title={t.simLong}>
        <span className="sim-dot" /> {t.sim}
      </motion.div>

      <div className="top-spacer" />

      <div className="seg" role="tablist" aria-label={t.role}>
        {ROLES.map((r) => (
          <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r, viewer)} title={t.roleHint[r]}>
            {t[r]}
          </button>
        ))}
      </div>
      {role === 'crew' && (
        <label className="sel-wrap">
          <span>{t.viewer}</span>
          <select value={viewer} onChange={(e) => setViewer(e.target.value)}>
            {crewIds.map((c) => <option key={c.id} value={c.id}>{c.callsign}</option>)}
          </select>
        </label>
      )}

      <div className="seg small" aria-label={t.language}>
        <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
        <button className={lang === 'bn' ? 'on' : ''} onClick={() => setLang('bn')}>বাংলা</button>
      </div>

      <div className="snd" title={t.sound}>
        <Btn size="icon" variant={snd.on ? '' : 'ghost'} icon={snd.on ? 'speaker' : 'speakerOff'} aria-label={snd.on ? t.soundOn : t.soundOff} aria-pressed={snd.on}
          data-quiet onClick={() => audio.setOn(!snd.on)} />
        <input type="range" min="0" max="1" step="0.05" value={snd.volume} disabled={!snd.on} aria-label={t.volume}
          onChange={(e) => audio.setVolume(+e.target.value)} />
      </div>
      <Btn className={spatial ? 'on' : ''} icon="cube" onClick={() => setSpatial(!spatial)} title={t.spatialHint}>{spatial ? t.spatialOn : t.spatial}</Btn>
      <Btn variant="vr" className={vr ? 'on' : ''} icon="vr" title={vrNative ? t.vr : t.vrHelp}
        onClick={() => { if (vr) xrStore.getState().session?.end(); else enterVR().catch((e) => console.warn('VR', e)) }}>
        {vr ? t.vrOn : vrNative ? t.vr : `${t.vr} (${t.emulated})`}
      </Btn>
      <Btn variant="ghost" size="icon" icon="info" onClick={onAbout} aria-label={t.about} />
      <span className={`conn ${conn}`} title={conn}>{t[conn] || conn}</span>
    </header>
  )
}
