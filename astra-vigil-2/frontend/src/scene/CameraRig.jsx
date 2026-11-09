import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useXR } from '@react-three/xr'
import * as THREE from 'three'
import { useStore } from '../store'
import { hotspotWorld } from './Astronaut'

const HOME = new THREE.Vector3(0, 1.0, 0)

export default function CameraRig({ spatial }) {
  const controls = useRef()
  const session = useXR((s) => s.session)
  const camera = useThree((s) => s.camera)
  const portrait = useThree((s) => s.size.width / Math.max(1, s.size.height) < 1)
  const idle = useRef(0)
  const tgt = useRef(HOME.clone())
  const dist = useRef(0)

  useEffect(() => {
    const c = controls.current
    if (!c) return
    if (spatial) camera.position.set(0.5, 1.9, portrait ? 9.5 : 6.6)
    else camera.position.set(0.3, 1.5, portrait ? 4.9 : 3.2)
    c.update()
  }, [spatial, camera, portrait])

  useFrame((_, dt) => {
    const c = controls.current
    if (!c || session) return
    const st = useStore.getState()
    const f = st.flash
    const age = f ? (performance.now() - f.t) / 1000 : 99
    const focus = age < 3.2
    const want = HOME.clone()
    if (focus) {
      const h = hotspotWorld(f.signals[0])
      want.lerp(h, 0.55 * Math.sin(Math.min(1, age / 3.2) * Math.PI))
    }
    if (spatial) want.set(0, 1.45, 0)
    tgt.current.lerp(want, 0.06)
    c.target.copy(tgt.current)
    // dolly in a little during the alert moment
    const dir = camera.position.clone().sub(c.target)
    const d = dir.length()
    const wantD = focus ? Math.max(2.4, Math.min(d, 3.4) - 0.0) : d
    if (focus && d > wantD + 0.02) camera.position.copy(c.target.clone().add(dir.setLength(d + (wantD - d) * 0.04)))
    idle.current += dt
    c.autoRotate = idle.current > 5 && !focus && !spatial
    c.update()
  })

  if (session) return null
  return (
    <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping dampingFactor={0.06}
      minDistance={spatial ? 2.5 : 1.8} maxDistance={spatial ? 13 : 8}
      minPolarAngle={0.35} maxPolarAngle={Math.PI / 2 + 0.12} autoRotateSpeed={0.5} target={[0, 1.0, 0]}
      onStart={() => { idle.current = -2 }} onEnd={() => { idle.current = 0 }} />
  )
}
