import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeHoloMaterial } from './holo'
import { useStore } from '../store'
import { STATUS_COLOR } from '../util'

// Fallback only: a procedural stand-in used if the astronaut model file cannot be loaded.
const SCALE = 0.82

function Part({ geo, material, edgeMaterial, position, rotation, scale }) {
  const edges = useMemo(() => new THREE.EdgesGeometry(geo, 28), [geo])
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geo} material={material} />
      <lineSegments geometry={edges} material={edgeMaterial} />
    </group>
  )
}

export default function ProceduralAstronaut({ children }) {
  const body = useMemo(() => makeHoloMaterial({ color: '#3ef0d2', opacity: 1 }), [])
  const visor = useMemo(() => makeHoloMaterial({ color: '#9ff7ff', opacity: 0.9, fres: 1.4 }), [])
  const edge = useMemo(() => new THREE.LineBasicMaterial({ color: '#3ef0d2', transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [])
  const geos = useMemo(() => {
    const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 18)
    return {
      helmet: new THREE.SphereGeometry(0.25, 40, 28),
      visor: new THREE.SphereGeometry(0.262, 36, 20, Math.PI / 2 - 0.95, 1.9, 0.95, 0.9),
      neck: new THREE.TorusGeometry(0.17, 0.035, 12, 36),
      torso: cap(0.27, 0.4), chest: new THREE.BoxGeometry(0.26, 0.17, 0.05),
      pack: new THREE.BoxGeometry(0.46, 0.6, 0.2), hips: new THREE.CylinderGeometry(0.25, 0.23, 0.14, 28),
      uArm: cap(0.085, 0.26), lArm: cap(0.075, 0.22), glove: new THREE.SphereGeometry(0.09, 20, 14),
      thigh: cap(0.12, 0.26), shin: cap(0.1, 0.28), boot: new THREE.BoxGeometry(0.17, 0.1, 0.3),
      hose: new THREE.TorusGeometry(0.16, 0.012, 8, 28, Math.PI),
    }
  }, [])
  const group = useRef()
  const flashSignals = useRef(null)

  useEffect(() => () => { body.dispose(); visor.dispose(); edge.dispose() }, [body, visor, edge])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const st = useStore.getState()
    const flash = st.flash
    const age = flash ? (performance.now() - flash.t) / 1000 : 99
    const crew = st.crew.find((c) => c.id === st.subject)
    const status = crew?.status || 'learning'
    // alert level: 1 right at the alert, easing down; the status keeps a gentle tint
    const target = age < 6 ? Math.max(0.35, 1 - age / 6) : status === 'alert' ? 0.45 : status === 'watch' ? 0.18 : 0
    for (const m of [body, visor]) {
      m.uniforms.uTime.value = t
      m.uniforms.uAlert.value += (target - m.uniforms.uAlert.value) * 0.08
      m.uniforms.uGlitch.value = age < 1.8 ? 1 - age / 1.8 : 0
      m.uniforms.uScan.value = ((t * 0.45) % 1.6) * 1.35
    }
    edge.color.set(STATUS_COLOR[status] && target > 0.3 ? STATUS_COLOR.alert : '#3ef0d2')
    edge.opacity = 0.28 + 0.12 * Math.sin(t * 2)
    if (group.current) {
      group.current.position.y = 0.04 + Math.sin(t * 1.3) * 0.012
      group.current.position.x = age < 1.2 ? Math.sin(t * 60) * 0.012 * (1 - age / 1.2) : 0
    }
  })

  const P = { material: body, edgeMaterial: edge }
  return (
    <group ref={group}>
      <group scale={SCALE}>
        <Part {...P} geo={geos.helmet} position={[0, 2.08, 0]} />
        <Part {...P} material={visor} edgeMaterial={edge} geo={geos.visor} position={[0, 2.08, 0]} />
        <Part {...P} geo={geos.neck} position={[0, 1.86, 0]} rotation={[Math.PI / 2, 0, 0]} />
        <Part {...P} geo={geos.torso} position={[0, 1.38, 0]} scale={[1, 1, 0.72]} />
        <Part {...P} geo={geos.chest} position={[0, 1.36, 0.2]} />
        <Part {...P} geo={geos.pack} position={[0, 1.42, -0.27]} />
        <Part {...P} geo={geos.hips} position={[0, 1.0, 0]} />
        <Part {...P} geo={geos.hose} position={[0, 1.7, -0.02]} rotation={[0, 0, 0]} />
        {[-1, 1].map((s) => (
          <group key={s}>
            <Part {...P} geo={geos.uArm} position={[s * 0.4, 1.56, 0]} rotation={[0, 0, -s * 0.32]} />
            <Part {...P} geo={geos.lArm} position={[s * 0.52, 1.24, 0.1]} rotation={[-0.45, 0, -s * 0.12]} />
            <Part {...P} geo={geos.glove} position={[s * 0.55, 1.03, 0.22]} />
            <Part {...P} geo={geos.thigh} position={[s * 0.15, 0.74, 0]} />
            <Part {...P} geo={geos.shin} position={[s * 0.15, 0.31, 0.01]} />
            <Part {...P} geo={geos.boot} position={[s * 0.15, 0.05, 0.05]} />
          </group>
        ))}
        {children}
      </group>
    </group>
  )
}
