import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useXR, useXRInputSourceState } from '@react-three/xr'
import * as THREE from 'three'
import { useStore } from '../store'

// Moving around inside the cabin, with the controllers a headset actually has.
//   left stick   walk (relative to where you look)      right stick left/right   snap turn 30 degrees
//   A / right    play or pause the replay               B / right   rehearse the demo beat
//   X / left     hologram <-> realistic look            Y / left    back to the start position
// Plus a short haptic pulse on both controllers when an alert fires.
export const START = new THREE.Vector3(0, 0, 2.2)
const DEAD = 0.18
const WALK = 1.7
const SNAP = THREE.MathUtils.degToRad(30)
const fwd = new THREE.Vector3(), rgt = new THREE.Vector3(), head = new THREE.Vector3(), tmp = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

export function VRRig({ originRef }) {
  const session = useXR((s) => s.session)
  const left = useXRInputSourceState('controller', 'left')
  const right = useXRInputSourceState('controller', 'right')
  const prev = useRef({})
  const snapped = useRef(false)

  // haptics on a new alert
  useEffect(() => {
    if (!session) return
    let last = useStore.getState().flash?.id ?? null
    return useStore.subscribe((st) => {
      const id = st.flash?.id ?? null
      if (id === last) return
      last = id
      if (id == null) return
      for (const src of session.inputSources || []) {
        try {
          const gp = src.gamepad
          if (gp?.hapticActuators?.[0]?.pulse) gp.hapticActuators[0].pulse(0.9, 260)
          else if (gp?.vibrationActuator?.playEffect) gp.vibrationActuator.playEffect('dual-rumble', { duration: 260, strongMagnitude: 0.9, weakMagnitude: 0.6 })
        } catch { /* haptics are a nicety */ }
      }
    })
  }, [session])

  useFrame((state, dt) => {
    const o = originRef.current
    if (!o || !session) return
    const edge = (key, pressed, fn) => {
      if (pressed && !prev.current[key]) fn()
      prev.current[key] = pressed
    }
    const st = useStore.getState()
    const lg = left?.gamepad
    const rg = right?.gamepad
    edge('a', rg?.['a-button']?.state === 'pressed', () => st.togglePlay())
    edge('b', rg?.['b-button']?.state === 'pressed', () => st.rehearse())
    edge('x', lg?.['x-button']?.state === 'pressed', () => st.setLook(st.look === 'holo' ? 'real' : 'holo'))
    edge('y', lg?.['y-button']?.state === 'pressed', () => { o.position.copy(START); o.rotation.set(0, 0, 0) })

    const cam = state.camera
    cam.getWorldDirection(fwd); fwd.y = 0
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1)
    fwd.normalize()
    rgt.crossVectors(fwd, UP)

    // walk
    const ls = lg?.['xr-standard-thumbstick']
    const lx = ls?.xAxis ?? 0, ly = ls?.yAxis ?? 0
    if (Math.hypot(lx, ly) > DEAD) {
      tmp.set(0, 0, 0).addScaledVector(fwd, -ly).addScaledVector(rgt, lx).multiplyScalar(WALK * dt)
      const nx = o.position.x + tmp.x, nz = o.position.z + tmp.z
      // stay inside the cabin and out of the astronaut's pedestal
      const r = Math.hypot(nx, nz)
      if (r > 5.4) { o.position.x = (nx * 5.4) / r; o.position.z = (nz * 5.4) / r }
      else if (r < 1.0) { // stop at the pedestal edge instead of walking through the astronaut
        const r0 = Math.max(Math.hypot(o.position.x, o.position.z), 1e-3)
        o.position.x = (o.position.x / r0) * Math.max(r0, 1.0); o.position.z = (o.position.z / r0) * Math.max(r0, 1.0)
      } else { o.position.x = nx; o.position.z = nz }
    }

    // snap turn around the head, so the view rotates in place
    const rs = rg?.['xr-standard-thumbstick']
    const rx = rs?.xAxis ?? 0
    if (Math.abs(rx) > 0.7 && !snapped.current) {
      snapped.current = true
      const ang = rx > 0 ? -SNAP : SNAP
      cam.getWorldPosition(head)
      tmp.copy(o.position).sub(head).applyAxisAngle(UP, ang)
      o.position.copy(head).add(tmp)
      o.position.y = 0
      o.rotation.y += ang
    } else if (Math.abs(rx) < 0.3) snapped.current = false
  })
  return null
}

// Scales / rotates the astronaut (and the things attached to it) from the 3D control panel.
export function SuitFrame({ children }) {
  const g = useRef()
  useFrame((_, dt) => {
    if (!g.current) return
    const st = useStore.getState()
    const desk = st.suitSize === 'desk'
    const s = desk ? 0.5 : 1
    const k = Math.min(1, dt * 6)
    g.current.scale.setScalar(g.current.scale.x + (s - g.current.scale.x) * k)
    g.current.position.y += ((desk ? 0.95 : 0) - g.current.position.y) * k
    let d = st.suitYaw - g.current.rotation.y
    g.current.rotation.y += d * k
  })
  return <group ref={g}>{children}</group>
}
