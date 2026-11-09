import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'
import { audio } from '../audio'
import { STATUS_COLOR } from '../util'
import { CARD_H, CARD_W, crewTexture } from './crewTex'

// A floating 3D ID card with the crew member's photo. Clicking selects that crew member.
export function CrewCard3D({ c, position, rotation = [0, 0, 0], scale = 1, phase = 0 }) {
  const subject = useStore((s) => s.subject)
  const setSubject = useStore((s) => s.setSubject)
  const g = useRef(), glow = useRef()
  const [hov, setHov] = useState(false)
  const col = STATUS_COLOR[c.status] || STATUS_COLOR.unknown
  const tex = useMemo(() => crewTexture(c, col), [c.id, c.photo, c.status, col])  // eslint-disable-line react-hooks/exhaustive-deps
  const sel = subject === c.id
  const pts = useMemo(() => {
    const w = CARD_W / 2 + 0.03, h = CARD_H / 2 + 0.03
    return [[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0], [-w, -h, 0]]
  }, [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase
    if (g.current) {
      g.current.position.y = position[1] + Math.sin(t * 0.9) * 0.035
      const k = (sel ? 1.06 : 1) * (hov ? 1.07 : 1)
      g.current.scale.setScalar(THREE.MathUtils.lerp(g.current.scale.x, scale * k, 0.18))
    }
    if (glow.current) glow.current.material.opacity = (sel ? 0.5 : 0.22) + Math.sin(t * 2) * 0.06 + (hov ? 0.2 : 0)
  })
  return (
    <group ref={g} position={position} rotation={rotation} scale={scale}>
      <mesh ref={glow} position={[0, 0, -0.02]}>
        <planeGeometry args={[CARD_W + 0.16, CARD_H + 0.16]} />
        <meshBasicMaterial color={col} transparent opacity={0.25} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh onClick={(e) => { e.stopPropagation(); audio.select(); setSubject(c.id) }}
        onPointerOver={() => { setHov(true); audio.hover() }} onPointerOut={() => setHov(false)}>
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
      <Line points={pts} color={sel ? '#ffffff' : col} lineWidth={sel ? 2.4 : 1.4} transparent opacity={sel ? 1 : 0.7} toneMapped={false} />
    </group>
  )
}

// Four cards on an arc facing the centre (the viewer stands near the middle of the cabin).
export function CrewWall({ radius = 5.6, y = 1.5, centre = Math.PI, spread = 0.8, size = 1.2 }) {
  const crew = useStore((s) => s.crew)
  return (
    <group>
      {crew.map((c, i) => {
        const a = centre - (i - (crew.length - 1) / 2) * spread   // first crew member on the viewer's left
        return <CrewCard3D key={c.id} c={c} phase={i * 1.3} scale={size}
          position={[Math.sin(a) * radius, y, Math.cos(a) * radius]} rotation={[0, a + Math.PI, 0]} />
      })}
    </group>
  )
}
