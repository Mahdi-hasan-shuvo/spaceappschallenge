import { useEffect, useRef } from 'react'

export default function Spark({ data, color = '#3ef0d2', n = 40 }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || !data) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = 96, H = 28
    cv.width = W * dpr; cv.height = H * dpr
    const g = cv.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H)
    const len = data.v.length
    if (len < 2) return
    const from = Math.max(0, len - n)
    let lo = Infinity, hi = -Infinity
    for (let i = from; i < len; i++) { lo = Math.min(lo, data.v[i]); hi = Math.max(hi, data.v[i]) }
    const pad = (hi - lo) * 0.1 || 1
    lo -= pad; hi += pad
    const X = (i) => ((i - from) / (n - 1)) * W
    const Y = (v) => H - ((v - lo) / (hi - lo)) * H
    g.strokeStyle = color; g.lineWidth = 1.5; g.lineJoin = 'round'
    g.beginPath()
    for (let i = from; i < len; i++) { const x = X(i), y = Y(data.v[i]); i === from ? g.moveTo(x, y) : g.lineTo(x, y) }
    g.stroke()
    g.fillStyle = color; g.beginPath(); g.arc(X(len - 1), Y(data.v[len - 1]), 2.2, 0, 7); g.fill()
  }, [data, color, n])
  return <canvas ref={ref} style={{ width: 96, height: 28 }} />
}
