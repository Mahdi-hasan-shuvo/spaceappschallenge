import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'
import { useThrottled } from './holo'

// A circular timeline around the astronaut's waist for the selected signal.
// Ring radius = personal baseline. Distance in/out = deviation in SD. Newest sample is the bright end.
const N = 60
const R = 0.78

export default function DataRing() {
  const series = useStore((s) => s.series)
  const sig = useStore((s) => s.selectedSignal)
  const role = useStore((s) => s.role)
  const subject = useStore((s) => s.subject)
  const viewer = useStore((s) => s.viewer)
  const live = series && role === 'crew' && subject === viewer ? series.data[sig] : null
  const d = useThrottled(live, 250)

  const base = useMemo(() => {
    const out = []
    for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; out.push([Math.cos(a) * R, 0, Math.sin(a) * R]) }
    return out
  }, [])
  const band = useMemo(() => [-1, 1].map((k) => base.map((p) => [p[0] * (1 + k * 0.1), 0, p[2] * (1 + k * 0.1)])), [base])

  const trace = useMemo(() => {
    if (!d || d.v.length < 2) return null
    const len = d.v.length
    const from = Math.max(0, len - N)
    const pts = [], cols = []
    for (let i = from; i < len; i++) {
      const k = i - from
      const a = -Math.PI / 2 + (k / N) * Math.PI * 2
      const dev = d.mu[i] == null || !d.sd[i] ? 0 : (d.v[i] - d.mu[i]) / d.sd[i]
      const r = R * (1 + Math.max(-4, Math.min(4, dev)) * 0.05)
      pts.push([Math.cos(a) * r, 0, Math.sin(a) * r])
      const w = d.w[i]
      const fade = 0.25 + 0.75 * (k / Math.max(1, len - from - 1))
      const c = w != null && w >= 2 ? new THREE.Color('#ff3d6e') : w != null && w >= 1.2 ? new THREE.Color('#ffc247') : new THREE.Color('#3ef0d2')
      cols.push(c.multiplyScalar(fade * 1.6))
    }
    return pts.length > 1 ? { pts, cols } : null
  }, [d])

  return (
    <group position={[0, 1.0, 0]}>
      <Line points={base} color="#3ef0d2" lineWidth={1} transparent opacity={0.5} toneMapped={false} />
      {band.map((b, i) => <Line key={i} points={b} color="#2b8fff" lineWidth={0.8} transparent opacity={0.25} dashed dashSize={0.06} gapSize={0.05} toneMapped={false} />)}
      {trace && <Line points={trace.pts} vertexColors={trace.cols} lineWidth={2.4} toneMapped={false} />}
    </group>
  )
}
