import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Line, Text } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'
import { DIGITS, SIGNALS, SHORT, UNIT_ASCII, fmt, worseColor } from '../util'
import { FONT, useThrottled } from './holo'
import { HOTSPOTS } from './Astronaut'

function lastValues(series, subject, viewer, role) {
  if (!series || role !== 'crew' || subject !== viewer) return null
  const out = {}
  for (const s of SIGNALS) {
    const d = series.data[s]
    const i = d.v.length - 1
    out[s] = i < 0 ? null : { v: d.v[i], mu: d.mu[i], w: d.w[i] }
  }
  return out
}

function Hotspot({ s, vals, restricted }) {
  const hs = HOTSPOTS[s]
  const core = useRef()
  const ring = useRef()
  const ring2 = useRef()
  const flashRef = useRef(0)
  const setSignal = useStore((st) => st.setSignal)
  const selected = useStore((st) => st.selectedSignal === s)
  const w = vals?.w ?? null
  const col = useMemo(() => new THREE.Color(worseColor(w)), [w])
  const side = hs.side
  const labelX = side * 0.68
  const pts = useMemo(() => [[0, 0, 0], [side * 0.18, 0.06, 0.04], [labelX - side * 0.04, 0.06, 0.04]], [side, labelX])
  const line1 = restricted ? SHORT[s] : vals ? `${SHORT[s]}  ${fmt(vals.v, DIGITS[s])} ${UNIT_ASCII[s]}` : SHORT[s]
  const line2 = restricted ? 'restricted' : w == null ? 'learning baseline' : `${fmt(Math.abs(w), 1)} SD ${w > 0 ? 'worse' : 'better'}`

  useFrame(({ clock }) => {
    const st = useStore.getState()
    const t = clock.elapsedTime
    const f = st.flash && st.flash.signals.includes(s)
    flashRef.current += ((f ? 1 : 0) - flashRef.current) * 0.1
    const fl = flashRef.current
    let beat = 0
    if (s === 'hr' && vals && !restricted) {
      const hz = vals.v / 60
      beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * hz)), 8)
    }
    const pulse = 0.5 + 0.5 * Math.sin(t * (2 + fl * 6) + hs.p[1] * 3)
    if (core.current) {
      core.current.scale.setScalar(1 + beat * 0.7 + fl * (0.6 + 0.5 * pulse) + (selected ? 0.25 : 0))
      core.current.material.color.copy(f ? new THREE.Color('#ff3d6e') : col).multiplyScalar(2.2)
    }
    if (ring.current) {
      const k = ((t * (0.5 + fl * 1.5) + hs.p[0] * 2) % 1)
      ring.current.scale.setScalar(0.04 + k * (0.12 + fl * 0.22))
      ring.current.material.opacity = (1 - k) * (0.55 + fl * 0.45)
      ring.current.material.color.copy(f ? new THREE.Color('#ff3d6e') : col)
    }
    if (ring2.current) {
      ring2.current.rotation.z = t * 0.8
      ring2.current.material.color.copy(f ? new THREE.Color('#ff3d6e') : col)
      ring2.current.material.opacity = selected ? 0.95 : 0.4
    }
  })

  return (
    <group position={hs.p}>
      <Billboard>
        <mesh ref={ring}>
          <ringGeometry args={[0.8, 1, 40]} />
          <meshBasicMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
        <mesh ref={ring2} scale={0.06}>
          <ringGeometry args={[0.84, 1, 6]} />
          <meshBasicMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      </Billboard>
      {/* large invisible target so a controller ray or a pinch can hit the small dot */}
      <mesh onClick={(e) => { e.stopPropagation(); setSignal(s) }}
        onPointerOver={() => { document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = '' }}>
        <sphereGeometry args={[0.08, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh
        ref={core}
        onClick={(e) => { e.stopPropagation(); setSignal(s) }}
        onPointerOver={() => { document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = '' }}
      >
        <sphereGeometry args={[0.028, 16, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </mesh>
      <Line points={pts} color={col} lineWidth={1} transparent opacity={0.55} toneMapped={false} />
      <Billboard position={[labelX, 0.06, 0.04]}>
        <Text font={FONT} fontSize={0.082} color={col} anchorX={side > 0 ? 'left' : 'right'} anchorY="bottom"
          letterSpacing={0.04} material-toneMapped={false}>{line1}</Text>
        <Text font={FONT} fontSize={0.06} color="#8fb4c9" anchorX={side > 0 ? 'left' : 'right'} anchorY="top"
          position={[0, -0.01, 0]} material-toneMapped={false}>{line2}</Text>
      </Billboard>
    </group>
  )
}

export default function Hotspots() {
  const series = useStore((s) => s.series)
  const subject = useStore((s) => s.subject)
  const viewer = useStore((s) => s.viewer)
  const role = useStore((s) => s.role)
  const live = lastValues(series, subject, viewer, role)
  const vals = useThrottled(live, 300)
  const restricted = !live
  return (
    <>
      {SIGNALS.map((s) => <Hotspot key={s} s={s} vals={vals ? vals[s] : null} restricted={restricted} />)}
    </>
  )
}
