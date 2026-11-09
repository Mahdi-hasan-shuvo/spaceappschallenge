import * as THREE from 'three'

// Where each signal's hotspot sits on the astronaut (metres, model space; the model is ~1.91 m tall, feet at y=0).
// z is refined at load time by casting a ray onto the real suit surface (see Astronaut.jsx), so dots sit on the cloth.
export const HOTSPOTS = {
  sleep_h: { p: [0, 1.74, 0.3], side: -1 },
  hrv: { p: [0, 1.5, 0.24], side: 1 },
  spo2: { p: [-0.13, 1.33, 0.22], side: -1 },
  hr: { p: [0.13, 1.33, 0.22], side: 1 },
  core_temp: { p: [0, 1.02, 0.2], side: 1 },
  exercise_min: { p: [-0.12, 0.72, 0.2], side: -1 },
}
export const hotspotWorld = (s) => {
  const p = HOTSPOTS[s].p
  return new THREE.Vector3(p[0], p[1], p[2])
}
