import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'
import { useT } from '../hooks'
import { audio } from '../audio'
import Btn from './Btn'
import CrewPhoto from './CrewPhoto'

// Warp-speed star field on a 2D canvas. `boost` ramps up when the mission starts.
function Warp({ boost }) {
  const ref = useRef(null)
  const boostRef = useRef(boost)
  boostRef.current = boost
  useEffect(() => {
    const cv = ref.current
    const g = cv.getContext('2d')
    let w = 0, h = 0, raf = 0
    const stars = Array.from({ length: 260 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random(), c: Math.random() }))
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      w = cv.clientWidth; h = cv.clientHeight
      cv.width = w * dpr; cv.height = h * dpr
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    window.addEventListener('resize', size)
    let speed = 0.0016
    const tick = () => {
      speed += ((boostRef.current ? 0.05 : 0.0016) - speed) * 0.04
      g.fillStyle = `rgba(2,6,13,${boostRef.current ? 0.22 : 0.5})`
      g.fillRect(0, 0, w, h)
      const cx = w / 2, cy = h / 2, f = Math.max(w, h) * 0.6
      for (const s of stars) {
        const pz = s.z
        s.z -= speed
        if (s.z <= 0.01) { s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; s.z = 1; continue }
        const x = cx + (s.x / s.z) * f * 0.18, y = cy + (s.y / s.z) * f * 0.18
        const px = cx + (s.x / pz) * f * 0.18, py = cy + (s.y / pz) * f * 0.18
        if (x < -20 || x > w + 20 || y < -20 || y > h + 20) { s.z = 1; continue }
        const a = Math.min(1, (1 - s.z) * 1.4)
        g.strokeStyle = s.c > 0.8 ? `rgba(255,194,71,${a})` : s.c > 0.45 ? `rgba(62,240,210,${a})` : `rgba(190,225,255,${a})`
        g.lineWidth = 0.6 + (1 - s.z) * 1.8
        g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', size) }
  }, [])
  return <canvas ref={ref} className="intro-warp" aria-hidden />
}

// Concentric HUD rings with tick marks, rotating in opposite directions.
function Rings() {
  const ticks = (r, n, len, w) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return <line key={i} x1={Math.cos(a) * r} y1={Math.sin(a) * r} x2={Math.cos(a) * (r - len)} y2={Math.sin(a) * (r - len)} strokeWidth={w} />
  })
  return (
    <svg className="intro-rings" viewBox="-300 -300 600 600" aria-hidden>
      <g className="r1" stroke="#3ef0d2" fill="none" opacity=".5">
        <circle r="290" strokeWidth="1" strokeDasharray="2 10" />{ticks(280, 90, 8, 1)}
      </g>
      <g className="r2" stroke="#2b8fff" fill="none" opacity=".55">
        <circle r="238" strokeWidth="1.4" strokeDasharray="60 22 6 22" />{ticks(226, 36, 14, 1.4)}
      </g>
      <g className="r3" stroke="#ffc247" fill="none" opacity=".35">
        <circle r="186" strokeWidth="1" strokeDasharray="4 6" />
        <path d="M-186 0A186 186 0 0 1 0 -186" strokeWidth="3" />
      </g>
    </svg>
  )
}

const LETTERS = 'ASTRA VIGIL'.split('')

function CrewCard({ c, i, status }) {
  const ref = useRef(null)
  const tilt = (e) => {
    const el = ref.current, r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5
    el.style.transform = `perspective(700px) rotateY(${x * 18}deg) rotateX(${-y * 14}deg) translateZ(14px)`
  }
  const t = useT()
  return (
    <motion.div initial={{ opacity: 0, y: 60, rotateX: -35 }} animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ delay: 1.1 + i * 0.16, duration: 0.8, type: 'spring', stiffness: 90, damping: 14 }}>
      <div ref={ref} className="icard" onMouseMove={tilt} onMouseLeave={() => { ref.current.style.transform = '' }}>
        <div className="ic-photo">
          {c.photo ? <img src={c.photo} alt={c.callsign} draggable={false} /> : <CrewPhoto c={c} size={150} ring={false} className="sq" />}
          <i className="ic-scan" /><i className="ic-corner tl" /><i className="ic-corner tr" /><i className="ic-corner bl" /><i className="ic-corner br" />
        </div>
        <div className="ic-name">{c.callsign}</div>
        <div className="ic-role">{c.title}</div>
        <div className="ic-st"><i style={{ background: status }} />{t.standby}</div>
      </div>
    </motion.div>
  )
}

export default function Intro() {
  const t = useT()
  const intro = useStore((s) => s.intro)
  const crew = useStore((s) => s.crew)
  const lang = useStore((s) => s.lang)
  const setLang = useStore((s) => s.setLang)
  const enter = useStore((s) => s.enterMission)
  const [go, setGo] = useState(false)
  const [snd, setSnd] = useState(audio.state.on)
  useEffect(() => audio.subscribe((s) => setSnd(s.on)), [])
  const roster = crew.length ? crew : ['Niloy', 'Puja', 'Dhiraj', 'Tusar'].map((n) => ({ id: n.toLowerCase(), callsign: n, title: '', photo: null }))

  const begin = (run) => {
    if (go) return
    setGo(true)
    audio.unlock()
    if (run) { audio.start(); audio.ambient(true) } else { audio.whoosh(); audio.ambient(true) }
    setTimeout(() => enter({ run }), run ? 1050 : 450)
  }

  return (
    <AnimatePresence>
      {intro && (
        <motion.div key="intro" className={`intro ${go ? 'go' : ''}`} role="dialog" aria-label="Astra Vigil"
          exit={{ opacity: 0, scale: 1.18, filter: 'blur(14px)' }} transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}>
          <Warp boost={go} />
          <div className="intro-vig" />
          <div className="intro-top">
            <div className="seg small" aria-label={t.language}>
              <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
              <button className={lang === 'bn' ? 'on' : ''} onClick={() => setLang('bn')}>বাংলা</button>
            </div>
            <Btn size="sm" variant="ghost" icon={snd ? 'speaker' : 'speakerOff'} onClick={() => audio.setOn(!snd)}>{snd ? t.soundOn : t.soundOff}</Btn>
          </div>

          <div className="intro-center">
            <div className="intro-logo">
              <Rings />
              <motion.div className="intro-core" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2, duration: 0.9, type: 'spring' }}>
                <svg viewBox="0 0 40 40" width="76" height="76" aria-hidden>
                  <circle cx="20" cy="20" r="17" fill="none" stroke="#3ef0d2" strokeWidth="1.4" opacity=".85" />
                  <path d="M6 22h8l3-9 5 17 4-11 2 3h6" fill="none" stroke="#3ef0d2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="intro-ecg" />
                </svg>
              </motion.div>
            </div>
            <h1 className="intro-title" aria-label="ASTRA VIGIL 2.0">
              {LETTERS.map((ch, i) => (
                <motion.span key={i} initial={{ opacity: 0, y: 26, filter: 'blur(10px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ delay: 0.45 + i * 0.055, duration: 0.55 }}>{ch === ' ' ? ' ' : ch}</motion.span>
              ))}
              <motion.em initial={{ opacity: 0, scale: 2.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.15, duration: 0.5 }}>2.0</motion.em>
            </h1>
            <motion.div className="intro-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.0 }}>
              {t.introTag} · {t.team} · NASA Space Apps 2026
            </motion.div>
          </div>

          <div className="intro-crew-h">{t.introCrew}</div>
          <div className="intro-crew">
            {roster.map((c, i) => <CrewCard key={c.id} c={c} i={i} status="#3ef0d2" />)}
          </div>

          <motion.div className="intro-cta" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.9, duration: 0.7 }}>
            <Btn variant="cyan" size="huge" icon="rocket" className="pulse" data-testid="start-mission" disabled={go} onClick={() => begin(true)}>{t.startMission}</Btn>
            <button className="intro-skip" disabled={go} onClick={() => begin(false)}>{t.lookAround}</button>
          </motion.div>
          <div className="intro-foot">
            <span className="wm">{t.sim}</span>
            <span>{t.introDemo}</span>
            <span>{t.introNote}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
