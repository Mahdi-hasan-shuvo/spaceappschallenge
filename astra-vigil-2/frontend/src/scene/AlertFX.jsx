import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'
import { ruleLabel } from '../util'
import { FONT, FONT_HEAD } from './holo'
import { hotspotWorld } from './Astronaut'

// The anomaly moment: shockwave rings, a vertical sweep, and a floating holographic callout.
const ringMat = () => new THREE.MeshBasicMaterial({ color: '#ff3d6e', transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false })

export default function AlertFX() {
  const rings = useRef([])
  const sweep = useRef()
  const callout = useRef()
  const mats = useMemo(() => [ringMat(), ringMat(), ringMat()], [])
  const sweepMat = useMemo(() => ringMat(), [])
  const textRef = useRef()
  const subRef = useRef()
  const fa = useStore((st) => (st.flash ? st.alerts.find((a) => a.id === st.flash.id) : null))
  const sub = fa ? (fa.rule ? ruleLabel(fa.rule) : 'status change') : ' '

  useFrame(() => {
    const st = useStore.getState()
    const f = st.flash
    const age = f ? (performance.now() - f.t) / 1000 : 99
    rings.current.forEach((m, i) => {
      if (!m) return
      const t = age - i * 0.28
      if (t < 0 || t > 2.2) { m.visible = false; return }
      m.visible = true
      const k = t / 2.2
      m.scale.setScalar(0.4 + k * 3.2)
      mats[i].opacity = (1 - k) * 0.85
    })
    if (sweep.current) {
      const k = age / 1.4
      sweep.current.visible = k < 1
      if (k < 1) {
        sweep.current.position.y = 0.1 + k * 2.0
        sweepMat.opacity = Math.sin(k * Math.PI) * 0.9
      }
    }
    if (callout.current) {
      const on = f && age < 6.5
      const k = on ? Math.min(1, age / 0.35) * (age > 5.8 ? Math.max(0, (6.5 - age) / 0.7) : 1) : 0
      callout.current.visible = k > 0.01
      callout.current.scale.setScalar(0.4 + 0.6 * k)
      callout.current.position.set(0.75, 2.0 + Math.sin(age * 3) * 0.015, 0.2)
      if (textRef.current) textRef.current.fillOpacity = k
      if (subRef.current) subRef.current.fillOpacity = k
    }
  })
  return (
    <group>
      {mats.map((m, i) => (
        <mesh key={i} ref={(el) => { rings.current[i] = el }} material={m} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.9, 0]} visible={false}>
          <ringGeometry args={[0.97, 1, 96]} />
        </mesh>
      ))}
      <mesh ref={sweep} material={sweepMat} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.62, 0.7, 96]} />
      </mesh>
      <Billboard ref={callout} visible={false}>
        <Text ref={textRef} font={FONT_HEAD} fontSize={0.12} color="#ff3d6e" anchorX="left" anchorY="bottom" letterSpacing={0.1}
          material-toneMapped={false} outlineWidth={0.004} outlineColor="#ff8aa6">ANOMALY DETECTED</Text>
        <Text ref={subRef} font={FONT} fontSize={0.085} color="#ffd0dc" anchorX="left" anchorY="top" position={[0, -0.02, 0]}
          letterSpacing={0.05} material-toneMapped={false}>{sub}</Text>
        <mesh position={[0.7, -0.04, -0.01]}>
          <planeGeometry args={[1.4, 0.012]} />
          <meshBasicMaterial color="#ff3d6e" toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  )
}
export { hotspotWorld }
