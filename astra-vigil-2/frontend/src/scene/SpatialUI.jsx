import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line, Text } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'
import { DIGITS, SIGNALS, SHORT, STATUS_COLOR, UNIT_ASCII, fmt, ruleLabel } from '../util'
import { api } from '../api'
import { FONT, FONT_HEAD, useThrottled } from './holo'
import { audio } from '../audio'
import { crewTexture } from './crewTex'

// The same console as the DOM dashboard, laid out in 3D for VR (and the desktop "Spatial view").
// All text here is ASCII English: the 3D text engine cannot shape Bangla.
export const ascii = (s) => String(s || '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim()
const cut = (s, n) => { const a = ascii(s); return a.length > n ? a.slice(0, n - 3) + '...' : a }
const SIG_LABEL = { hr: 'Resting heart rate', hrv: 'HRV (RMSSD)', spo2: 'SpO2', sleep_h: 'Sleep duration', core_temp: 'Core temperature', exercise_min: 'Exercise' }

function useSecond() {
  const [n, setN] = useState(0)
  useEffect(() => { const t = setInterval(() => setN((x) => x + 1), 500); return () => clearInterval(t) }, [])
  return n
}

function Txt({ children, x = 0, y = 0, size = 0.06, color = '#cfeaf5', anchorX = 'left', anchorY = 'top', head = false, ...rest }) {
  return (
    <Text font={head ? FONT_HEAD : FONT} position={[x, y, 0.004]} fontSize={size} color={color} anchorX={anchorX}
      anchorY={anchorY} lineHeight={1.22} material-toneMapped={false} {...rest}>{children}</Text>
  )
}

function Rect({ w, h, color = '#3ef0d2', opacity = 0.7, width = 1.4 }) {
  const pts = useMemo(() => [[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0], [-w / 2, -h / 2, 0]], [w, h])
  return <Line points={pts} color={color} lineWidth={width} transparent opacity={opacity} toneMapped={false} />
}

function Panel({ position, rotation = [0, 0, 0], scale = 1, w, h, title, accent = '#3ef0d2', children }) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color="#04111d" transparent opacity={0.8} depthWrite={false} toneMapped={false} />
      </mesh>
      <Rect w={w} h={h} color={accent} />
      <Txt x={-w / 2 + 0.06} y={h / 2 - 0.05} size={0.05} head color={accent} letterSpacing={0.08}>{title}</Txt>
      <Txt x={w / 2 - 0.06} y={h / 2 - 0.06} size={0.04} anchorX="right" color="#ffc247" letterSpacing={0.06}>SIMULATED DATA</Txt>
      {children}
    </group>
  )
}

// A raised, glowing 3D key: it lifts and brightens on hover, sinks when pressed, and clicks with a sound.
function Btn({ x, y, w = 0.36, h = 0.13, label, onClick, active = false, color = '#3ef0d2', size = 0.05, primary = false }) {
  const [hov, setHov] = useState(false)
  const [down, setDown] = useState(false)
  const g = useRef(), glow = useRef(), sheen = useRef()
  const face = primary ? color : active ? '#0e5560' : hov ? '#0b3d49' : '#06222d'
  useFrame(({ clock }) => {
    const target = down ? -0.004 : hov ? 0.03 : 0.012
    if (g.current) g.current.position.z += (target - g.current.position.z) * 0.3
    if (glow.current) glow.current.material.opacity = hov ? 0.5 : active ? 0.32 : primary ? 0.3 + Math.sin(clock.elapsedTime * 3) * 0.1 : 0.14
    if (sheen.current) { const t = (clock.elapsedTime * 0.5 + x * 0.7) % 3; sheen.current.position.x = -w / 2 + (t / 3) * (w * 1.8) - w * 0.2; sheen.current.visible = hov || primary }
  })
  return (
    <group ref={g} position={[x, y, 0.012]}>
      <mesh ref={glow} position={[0, 0, -0.006]}>
        <planeGeometry args={[w + 0.045, h + 0.045]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh onClick={(e) => { e.stopPropagation(); audio.click(); onClick?.() }}
        onPointerDown={(e) => { e.stopPropagation(); setDown(true) }} onPointerUp={() => setDown(false)}
        onPointerOver={() => { setHov(true); audio.hover() }} onPointerOut={() => { setHov(false); setDown(false) }}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color={face} transparent opacity={0.97} toneMapped={false} />
      </mesh>
      <mesh position={[0, h * 0.25, 0.001]}>
        <planeGeometry args={[w * 0.96, h * 0.4]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={primary ? 0.18 : 0.06} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={sheen} position={[0, 0, 0.002]} rotation={[0, 0, -0.5]}>
        <planeGeometry args={[w * 0.12, h * 1.6]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.2} depthWrite={false} toneMapped={false} />
      </mesh>
      <Rect w={w} h={h} color={hov || active || primary ? '#cffffa' : color} opacity={hov || active || primary ? 1 : 0.6} width={1.4} />
      <Txt anchorX="center" anchorY="middle" size={size} color={primary ? '#02121a' : active ? '#e8ffff' : color} letterSpacing={0.05}>{label}</Txt>
    </group>
  )
}

// ------------------------------------------------------------------ chart
function Chart3D({ w = 2.5, h = 0.8, sig }) {
  const series = useStore((s) => s.series)
  const alerts = useStore((s) => s.alerts)
  const subject = useStore((s) => s.subject)
  const role = useStore((s) => s.role)
  const viewer = useStore((s) => s.viewer)
  const live = series && role === 'crew' && subject === viewer ? series.data[sig] : null
  const d = useThrottled(live, 300)
  const mine = useMemo(() => alerts.filter((a) => a.crew_id === subject && a.signals.includes(sig)), [alerts, subject, sig])

  const model = useMemo(() => {
    if (!d || d.v.length < 3) return null
    const W = 120
    const len = d.v.length, from = Math.max(0, len - W)
    let lo = Infinity, hi = -Infinity
    for (let i = from; i < len; i++) {
      lo = Math.min(lo, d.v[i]); hi = Math.max(hi, d.v[i])
      if (d.mu[i] != null) { lo = Math.min(lo, d.mu[i] - 2.4 * d.sd[i]); hi = Math.max(hi, d.mu[i] + 2.4 * d.sd[i]) }
    }
    const pad = (hi - lo) * 0.08 || 1
    lo -= pad; hi += pad
    const X = (i) => -w / 2 + ((i - from) / Math.max(1, W - 1)) * w
    const Y = (v) => -h / 2 + ((v - lo) / (hi - lo)) * h
    const pts = [], cols = [], up = [], dn = [], mid = []
    for (let i = from; i < len; i++) {
      pts.push([X(i), Y(d.v[i]), 0.01])
      const ww = d.w[i]
      cols.push(new THREE.Color(ww != null && ww >= 2 ? '#ff3d6e' : ww != null && ww >= 1.2 ? '#ffc247' : '#3ef0d2').multiplyScalar(1.5))
      if (d.mu[i] != null) { up.push(X(i), Y(d.mu[i] + 2 * d.sd[i]), 0.004); dn.push(X(i), Y(d.mu[i] - 2 * d.sd[i]), 0.004); mid.push([X(i), Y(d.mu[i]), 0.006]) }
    }
    // baseline band as a triangle strip
    const n = up.length / 3
    const pos = new Float32Array(n * 6)
    for (let i = 0; i < n; i++) { pos.set(up.slice(i * 3, i * 3 + 3), i * 6); pos.set(dn.slice(i * 3, i * 3 + 3), i * 6 + 3) }
    const idx = []
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx)
    const marks = mine.filter((a) => a.day >= from).map((a) => X(a.day))
    return { pts, cols, mid, band: n > 1 ? g : null, lo, hi, marks, from, len }
  }, [d, w, h, mine])

  return (
    <group>
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color="#020a12" transparent opacity={0.55} depthWrite={false} toneMapped={false} />
      </mesh>
      <Rect w={w} h={h} color="#1b5b73" opacity={0.8} width={1} />
      {model ? (
        <>
          {model.band && <mesh geometry={model.band}><meshBasicMaterial color="#2b8fff" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} /></mesh>}
          {model.mid.length > 1 && <Line points={model.mid} color="#2b8fff" lineWidth={1} transparent opacity={0.7} dashed dashSize={0.04} gapSize={0.03} toneMapped={false} />}
          <Line points={model.pts} vertexColors={model.cols} lineWidth={2.2} toneMapped={false} />
          {model.marks.map((x, i) => (
            <Line key={i} points={[[x, -h / 2, 0.012], [x, h / 2, 0.012]]} color="#ff3d6e" lineWidth={1.5} transparent opacity={0.85} toneMapped={false} />
          ))}
          <Txt x={-w / 2 - 0.03} y={h / 2} anchorX="right" size={0.04} color="#7fa5b8">{fmt(model.hi, DIGITS[sig])}</Txt>
          <Txt x={-w / 2 - 0.03} y={-h / 2 + 0.04} anchorX="right" size={0.04} color="#7fa5b8">{fmt(model.lo, DIGITS[sig])}</Txt>
          <Txt x={w / 2} y={-h / 2 - 0.02} anchorX="right" size={0.04} color="#7fa5b8">{`day ${model.len}`}</Txt>
        </>
      ) : (
        <Txt anchorX="center" anchorY="middle" size={0.06} color="#7fa5b8">
          {role === 'crew' && subject === viewer ? 'learning baseline...' : 'Restricted: raw numbers are tier 0 (own data only)'}
        </Txt>
      )}
    </group>
  )
}

// ------------------------------------------------------------------ boards
// Small portrait chip: the crew photo in a status-coloured ring.
function Portrait({ c, x }) {
  const col = STATUS_COLOR[c.status] || '#6f8ba8'
  const tex = useMemo(() => crewTexture(c, col), [c.id, c.photo, c.status, col])  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group position={[x, 0, 0.006]}>
      <mesh><circleGeometry args={[0.073, 28]} /><meshBasicMaterial color={col} toneMapped={false} /></mesh>
      <mesh position={[0, 0, 0.002]}>
        <circleGeometry args={[0.066, 28]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  )
}

function CrewBoard({ L }) {
  const crew = useStore((s) => s.crew)
  const subject = useStore((s) => s.subject)
  const setSubject = useStore((s) => s.setSubject)
  const outbox = useStore((s) => s.outbox)
  const delay = useStore((s) => s.delay)
  const skew = useStore((s) => s.skew)
  useSecond()
  const now = Date.now() / 1000 + skew
  const w = 1.4
  return (
    <Panel position={L.crew.p} rotation={L.crew.r} scale={L.crew.s} w={w} h={1.75} title="CREW STATUS">
      {crew.map((c, i) => (
        <group key={c.id} position={[0, 0.58 - i * 0.2, 0.01]}>
          <mesh onClick={(e) => { e.stopPropagation(); setSubject(c.id) }}>
            <planeGeometry args={[w - 0.14, 0.17]} />
            <meshBasicMaterial color={subject === c.id ? '#0d3f4b' : '#06202b'} transparent opacity={0.9} toneMapped={false} />
          </mesh>
          <Portrait c={c} x={-w / 2 + 0.15} />
          <Txt x={-w / 2 + 0.3} y={0.03} anchorY="middle" size={0.055} color="#e8fbff">{c.callsign}</Txt>
          <Txt x={w / 2 - 0.1} y={0.04} anchorX="right" anchorY="middle" size={0.048} color={STATUS_COLOR[c.status]} letterSpacing={0.05}>{(c.status || '').toUpperCase()}</Txt>
        </group>
      ))}
      <Txt x={-w / 2 + 0.06} y={-0.28} size={0.045} head color="#2b8fff" letterSpacing={0.08}>EARTH LINK</Txt>
      <Txt x={-w / 2 + 0.06} y={-0.35} size={0.038} color="#7fa5b8">{`one-way delay ${fmt(delay.min, 2)} min (demo: 1 min = 1 s)`}</Txt>
      {outbox.slice(-4).reverse().map((o, i) => {
        const left = o.deliver_at - now
        const txt = o.delivered || left <= 0 ? 'delivered' : `arrives in ${Math.ceil(left)} s`
        return (
          <Txt key={o.id} x={-w / 2 + 0.06} y={-0.45 - i * 0.075} size={0.042} color={o.delivered || left <= 0 ? '#3ef0d2' : '#ffc247'}>
            {`${cut(o.crew_id, 8)}  ${o.status.toUpperCase()}  day ${o.day + 1}  ${txt}`}
          </Txt>
        )
      })}
      {!outbox.length && <Txt x={-w / 2 + 0.06} y={-0.45} size={0.042} color="#7fa5b8">nothing sent to Earth yet</Txt>}
    </Panel>
  )
}

function AlertBoard({ L }) {
  const alerts = useStore((s) => s.alerts)
  const subject = useStore((s) => s.subject)
  const crew = useStore((s) => s.crew.find((c) => c.id === s.subject))
  const trends = useStore((s) => s.trends)
  const role = useStore((s) => s.role)
  const viewer = useStore((s) => s.viewer)
  const selId = useStore((s) => s.selectedAlertId)
  const mine = alerts.filter((a) => a.crew_id === subject)
  const a = mine.find((x) => x.id === selId) || mine[mine.length - 1]
  const w = 1.6
  const tier0 = role === 'crew' && subject === viewer
  const ev = (a?.evidence || []).slice(0, 3)
  const hot = a && crew?.status === 'alert'
  return (
    <Panel position={L.alert.p} rotation={L.alert.r} scale={L.alert.s} w={w} h={1.9} title="DETECTION ALERT" accent={hot ? '#ff3d6e' : '#3ef0d2'}>
      {!a && <Txt x={-w / 2 + 0.07} y={0.7} size={0.05} color="#7fa5b8" maxWidth={w - 0.14}>No rule has fired yet. The detector compares each day with this person's own baseline.</Txt>}
      {a && (
        <>
          <Txt x={-w / 2 + 0.07} y={0.75} size={0.062} color="#ff6f93" head letterSpacing={0.05}>{`${cut(ruleLabel(a.rule || a.rule_family), 28)}`}</Txt>
          <Txt x={-w / 2 + 0.07} y={0.67} size={0.042} color="#7fa5b8">{`${cut(subject, 12)}  day ${a.day + 1}  signals: ${a.signals.map((s) => SHORT[s]).join(', ')}`}</Txt>
          {tier0 && (a.details || []).slice(0, 3).map((d, i) => (
            <group key={d.signal} position={[0, 0.54 - i * 0.2, 0]}>
              <Txt x={-w / 2 + 0.07} size={0.05} color="#e8fbff">{`${SIG_LABEL[d.signal]}: ${fmt(Math.abs(d.z), 1)} SD ${d.z < 0 ? 'below' : 'above'} own ${d.window_days}-day baseline`}</Txt>
              <Txt x={-w / 2 + 0.07} y={-0.06} size={0.042} color="#8fb4c9">{`now ${fmt(d.current, DIGITS[d.signal])} ${UNIT_ASCII[d.signal]}   baseline ${fmt(d.baseline_mean, DIGITS[d.signal])} +/- ${fmt(d.baseline_sd, DIGITS[d.signal] + 1)}`}</Txt>
            </group>
          ))}
          {!tier0 && <Txt x={-w / 2 + 0.07} y={0.52} size={0.045} color="#ffc247" maxWidth={w - 0.14}>Restricted: numbers are private to the crew member (tier 0).</Txt>}
          <Txt x={-w / 2 + 0.07} y={-0.06} size={0.046} color="#3ef0d2">Nothing is diagnosed. Everything is evidenced.</Txt>
          <Txt x={-w / 2 + 0.07} y={-0.16} size={0.045} head color="#2b8fff" letterSpacing={0.08}>NASA EVIDENCE</Txt>
          {ev.map((c, i) => (
            <group key={c.id} position={[0, -0.25 - i * 0.28, 0]}>
              <Txt x={-w / 2 + 0.07} size={0.045} color={c.relevance === 'direct' ? '#3ef0d2' : '#8fb4c9'}>{`${cut(c.id, 22)}  ${c.relevance}`}</Txt>
              <Txt x={-w / 2 + 0.07} y={-0.055} size={0.037} color="#a9c7d6" maxWidth={w - 0.14}>{cut(c.title, 92)}</Txt>
            </group>
          ))}
        </>
      )}
      {role === 'medical' && trends[subject] && (
        <>
          <Txt x={-w / 2 + 0.07} y={0.5} size={0.045} head color="#2b8fff">TREND (CONSENTED)</Txt>
          {SIGNALS.map((s, i) => <Txt key={s} x={-w / 2 + 0.07} y={0.43 - i * 0.065} size={0.042} color="#cfeaf5">{`${SHORT[s]}: ${ascii(trends[subject].signals[s].trend)}`}</Txt>)}
        </>
      )}
    </Panel>
  )
}

function ChartBoard({ L }) {
  const sig = useStore((s) => s.selectedSignal)
  const day = useStore((s) => s.day)
  const n = useStore((s) => s.n)
  const w = 3.6
  return (
    <Panel position={L.chart.p} rotation={L.chart.r} scale={L.chart.s} w={w} h={1.55} title={`${SIG_LABEL[sig].toUpperCase()}  VS  PERSONAL BASELINE`}>
      <group position={[0.03, -0.08, 0.01]}>
        <Chart3D w={3.25} h={1.1} sig={sig} />
      </group>
      <Txt x={-w / 2 + 0.06} y={-0.72} size={0.04} color="#7fa5b8">{`mission day ${day + 1} / ${n}    band = baseline +/- 2 SD    red = 2 SD or more in the worse direction`}</Txt>
    </Panel>
  )
}

const QUESTIONS = ['What changed?', 'Which rule fired?', 'Show the numbers', 'Which NASA studies support this?', 'Who can see my data?', 'What does this mean for my health?']

// The offline assistant, inside the headset. Same rule-based backend as the dashboard, always asked in English here
// because the 3D text engine cannot shape Bangla.
function AssistBoard({ L }) {
  const [ans, setAns] = useState(null)
  const [busy, setBusy] = useState(false)
  const w = 2.0
  const ask = async (q) => {
    if (busy) return
    const st = useStore.getState()
    setBusy(true)
    try { setAns({ q, ...(await api.ask(q, 'en', st.role, st.viewer, st.subject)) }) } catch { setAns({ q, answer: 'The local server did not answer.', tools: [] }) }
    setBusy(false)
  }
  return (
    <Panel position={L.assist.p} rotation={L.assist.r} scale={L.assist.s} w={w} h={2.2} title="OFFLINE ASSISTANT" accent="#2b8fff">
      <Txt x={-w / 2 + 0.07} y={0.92} size={0.04} color="#7fa5b8" maxWidth={w - 0.14}>Rule-based. Answers only from the alert, the baseline numbers and cached NASA records. Never a diagnosis.</Txt>
      {QUESTIONS.map((q, i) => (
        <Btn key={q} x={i % 2 ? 0.49 : -0.49} y={0.68 - Math.floor(i / 2) * 0.16} w={0.94} h={0.13} label={cut(q, 24)} onClick={() => ask(q)} size={0.036} color={i === 5 ? '#ffc247' : '#3ef0d2'} />
      ))}
      <Txt x={-w / 2 + 0.07} y={0.16} size={0.04} head color="#2b8fff" letterSpacing={0.08}>{busy ? 'THINKING...' : ans ? 'ANSWER' : 'TAP A QUESTION'}</Txt>
      {ans && (
        <>
          <Txt x={-w / 2 + 0.07} y={0.09} size={0.04} color="#7fa5b8" maxWidth={w - 0.14}>{cut(ans.q, 60)}</Txt>
          <Txt x={-w / 2 + 0.07} y={0.0} size={0.044} color={ans.boundary ? '#ffc247' : '#e8fbff'} maxWidth={w - 0.14}>{cut(ans.answer, 520)}</Txt>
          {ans.tools?.length > 0 && <Txt x={-w / 2 + 0.07} y={-1.02} size={0.036} color="#7fa5b8" maxWidth={w - 0.14}>{`tools: ${cut(ans.tools.join(', '), 70)}`}</Txt>}
        </>
      )}
    </Panel>
  )
}

function HelpBoard({ L }) {
  const w = 1.7
  const rows = [
    ['LEFT STICK', 'walk around the cabin'], ['RIGHT STICK', 'turn (left / right)'], ['TRIGGER', 'press a button or dot'],
    ['A', 'start / pause replay'], ['B', 'rehearse the demo beat'], ['X', 'hologram / realistic look'], ['Y', 'back to start position'],
  ]
  return (
    <Panel position={L.help.p} rotation={L.help.r} scale={L.help.s} w={w} h={1.5} title="CONTROLLERS" accent="#8fb4c9">
      {rows.map(([k, v], i) => (
        <group key={k} position={[0, 0.5 - i * 0.14, 0]}>
          <Txt x={-w / 2 + 0.07} size={0.046} color="#3ef0d2" head letterSpacing={0.05}>{k}</Txt>
          <Txt x={-w / 2 + 0.6} size={0.044} color="#cfeaf5">{v}</Txt>
        </group>
      ))}
      <Txt x={-w / 2 + 0.07} y={-0.52} size={0.04} color="#7fa5b8" maxWidth={w - 0.14}>Hand tracking: point and pinch. Tap a glowing dot on the astronaut to change the chart signal.</Txt>
      <Txt x={-w / 2 + 0.07} y={-0.7} size={0.04} color="#ffc247" maxWidth={w - 0.14}>All numbers here are SIMULATED. Nothing is diagnosed.</Txt>
    </Panel>
  )
}

function Controls({ onExit, L }) {
  const playing = useStore((s) => s.playing)
  const speed = useStore((s) => s.speed)
  const sig = useStore((s) => s.selectedSignal)
  const meta = useStore((s) => s.meta)
  const suitSize = useStore((s) => s.suitSize)
  const look = useStore((s) => s.look)
  const st = useStore.getState
  const speeds = meta?.speeds || [1, 2, 5, 10, 20]
  const day = useStore((s) => s.day)
  const nDays = useStore((s) => s.n)
  const label = playing ? 'PAUSE' : day >= nDays - 1 ? 'RESTART' : day < 0 ? 'START' : 'RESUME'
  const bump = (d) => {
    const i = speeds.indexOf(speed)
    const j = Math.max(0, Math.min(speeds.length - 1, i + d))
    st().setSpeed(speeds[j])
  }
  return (
    <Panel position={L.controls.p} rotation={L.controls.r} scale={L.controls.s} w={2.0} h={0.86} title="CONTROLS">
      <Btn x={-0.79} y={0.17} w={0.36} label={label} onClick={() => st().togglePlay()} primary={!playing} active={playing} />
      <Btn x={-0.5} y={0.17} w={0.18} label="-" onClick={() => bump(-1)} />
      <Txt x={-0.37} y={0.17} anchorX="center" anchorY="middle" size={0.05} color="#e8fbff">{`x${speed}`}</Txt>
      <Btn x={-0.25} y={0.17} w={0.18} label="+" onClick={() => bump(1)} />
      <Btn x={0.08} y={0.17} w={0.52} label="REHEARSE" onClick={() => st().rehearse()} color="#ffc247" />
      <Btn x={0.5} y={0.17} w={0.28} label="RESET" onClick={() => st().reset()} />
      <Btn x={0.82} y={0.17} w={0.28} label="EXIT" onClick={onExit} color="#ff6f93" />
      {SIGNALS.map((s, i) => (
        <Btn key={s} x={-0.82 + i * 0.33} y={0.0} w={0.3} h={0.12} label={SHORT[s]} active={sig === s} onClick={() => st().setSignal(s)} size={0.042} />
      ))}
      <Btn x={-0.75} y={-0.17} w={0.4} h={0.12} label="TURN <" onClick={() => st().rotateSuit(-Math.PI / 4)} size={0.042} />
      <Btn x={-0.32} y={-0.17} w={0.4} h={0.12} label="TURN >" onClick={() => st().rotateSuit(Math.PI / 4)} size={0.042} />
      <Btn x={0.19} y={-0.17} w={0.56} h={0.12} label={suitSize === 'life' ? 'SIZE: LIFE' : 'SIZE: DESK'} onClick={() => st().toggleSuitSize()} size={0.042} color="#2b8fff" />
      <Btn x={0.76} y={-0.17} w={0.5} h={0.12} label={look === 'holo' ? 'LOOK: HOLO' : 'LOOK: REAL'} onClick={() => st().setLook(look === 'holo' ? 'real' : 'holo')} size={0.042} color="#2b8fff" />
    </Panel>
  )
}

// Desktop "Spatial view" keeps the boards close around the astronaut. In a headset the viewer stands 2.2 m from
// the astronaut, so boards are larger and closer to the viewer to keep text readable (about 2 degrees).
const LAYOUT = {
  desk: {
    crew: { p: [-1.75, 1.55, 0.2], r: [0, 0.62, 0], s: 1 }, alert: { p: [1.75, 1.6, 0.2], r: [0, -0.62, 0], s: 1 },
    chart: { p: [0, 1.75, -2.4], r: [0, 0, 0], s: 1 }, controls: { p: [0, 0.95, 1.15], r: [-0.62, 0, 0], s: 1 }, banner: 1,
    assist: { p: [-3.6, 1.55, -0.6], r: [0, 1.0, 0], s: 1 }, help: { p: [3.4, 1.5, -0.4], r: [0, -1.0, 0], s: 1 },
  },
  vr: {
    crew: { p: [-1.4, 1.5, 0.3], r: [0, 0.72, 0], s: 1.35 }, alert: { p: [1.4, 1.55, 0.3], r: [0, -0.72, 0], s: 1.35 },
    chart: { p: [0, 2.05, -2.2], r: [0, 0, 0], s: 1.5 }, controls: { p: [0, 0.95, 1.3], r: [-0.7, 0, 0], s: 1.2 }, banner: 1.5,
    assist: { p: [-2.56, 1.5, 1.75], r: [0, 1.4, 0], s: 1.3 }, help: { p: [2.56, 1.5, 1.75], r: [0, -1.4, 0], s: 1.3 },
  },
}

export default function SpatialUI({ onExit, vr = false }) {
  const L = vr ? LAYOUT.vr : LAYOUT.desk
  return (
    <group>
      <CrewBoard L={L} />
      <AlertBoard L={L} />
      <ChartBoard L={L} />
      <AssistBoard L={L} />
      <HelpBoard L={L} />
      <Controls onExit={onExit} L={L} />
      <group position={[0, 3.0, 0]} scale={L.banner}>
        <Text font={FONT_HEAD} fontSize={0.11} color="#ffc247" anchorX="center" letterSpacing={0.16} material-toneMapped={false}>SIMULATED DATA</Text>
        <Text font={FONT} position={[0, -0.14, 0]} fontSize={0.05} color="#8fb4c9" anchorX="center" material-toneMapped={false}>Demo crew (team names, invented vitals). Not a medical device. No diagnosis is made.</Text>
      </group>
    </group>
  )
}
