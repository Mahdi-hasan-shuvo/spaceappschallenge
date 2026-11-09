import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// A procedural orbital habitat for the desktop backdrop: a spinning torus ring with spokes, a central hub,
// lit windows, truss arms and solar-panel wings. Pure geometry, no downloaded assets.
export default function Station({ position = [-16, 7, -34], scale = 1 }) {
  const ring = useRef(), whole = useRef(), win = useRef()
  const hull = useMemo(() => new THREE.MeshStandardMaterial({ color: '#aab8c4', metalness: 0.85, roughness: 0.32 }), [])
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: '#27384a', metalness: 0.6, roughness: 0.5 }), [])
  const panel = useMemo(() => new THREE.MeshStandardMaterial({ color: '#12335f', metalness: 0.7, roughness: 0.25, emissive: '#0a2a55', emissiveIntensity: 0.6 }), [])
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7ffcff', toneMapped: false }), [])
  const wins = useMemo(() => Array.from({ length: 36 }, (_, i) => i), [])
  useFrame(({ clock }, dt) => {
    if (ring.current) ring.current.rotation.z += dt * 0.12
    if (whole.current) { whole.current.rotation.y = Math.sin(clock.elapsedTime * 0.05) * 0.35 - 0.5; whole.current.position.y = Math.sin(clock.elapsedTime * 0.2) * 0.4 }
    glow.color.set('#7ffcff').lerp(new THREE.Color('#ffd98a'), 0.5 + 0.5 * Math.sin(clock.elapsedTime * 0.7))
  })
  return (
    <group position={position} scale={scale}>
      <group ref={whole}>
        <group ref={ring}>
          <mesh material={hull}><torusGeometry args={[7, 0.7, 20, 96]} /></mesh>
          {wins.map((i) => {
            const a = (i / wins.length) * Math.PI * 2
            return <mesh key={i} position={[Math.cos(a) * 7, Math.sin(a) * 7, 0.62]} rotation={[0, 0, a]} material={glow}><boxGeometry args={[0.35, 0.16, 0.05]} /></mesh>
          })}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <mesh key={i} rotation={[0, 0, (i / 6) * Math.PI * 2]} position={[0, 0, 0]} material={dark}>
              <boxGeometry args={[14, 0.18, 0.18]} />
            </mesh>
          ))}
        </group>
        <mesh material={hull} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[1.3, 1.3, 7, 28]} /></mesh>
        <mesh material={dark} position={[0, 0, 3.6]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[1.1, 1.2, 28]} /></mesh>
        <mesh material={dark} position={[0, 0, -3.6]} rotation={[-Math.PI / 2, 0, 0]}><coneGeometry args={[1.1, 1.2, 28]} /></mesh>
        <mesh material={dark}><boxGeometry args={[0.2, 0.2, 16]} /></mesh>
        {[-1, 1].map((s) => (
          <group key={s} position={[0, 0, s * 6.5]}>
            <mesh material={dark}><boxGeometry args={[11, 0.1, 0.1]} /></mesh>
            {[-1, 1].map((q) => (
              <mesh key={q} material={panel} position={[q * 5.6, 0, 0]}><boxGeometry args={[5, 0.06, 2.6]} /></mesh>
            ))}
          </group>
        ))}
        <pointLight position={[0, 0, 0]} color="#7ffcff" intensity={30} distance={26} />
      </group>
    </group>
  )
}
