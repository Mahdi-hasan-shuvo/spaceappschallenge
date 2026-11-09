import { useEffect, useRef, useState } from 'react'
import { DIGITS, STATUS_COLOR, UNIT, fmt } from '../util'

// Canvas chart: baseline band (mean +/- 2 SD) drawn BEHIND the current trace.
// Segments of the trace turn amber/red as they move 1.2 / 2 SD in the worse direction.
export default function SignalChart({ sig, data, alerts = [], planted = [], windowDays = 120, height = 190, label, unitName = 'day', base = 1 }) {
  const ref = useRef(null)
  const wrap = useRef(null)
  const [hover, setHover] = useState(null)
  const [size, setSize] = useState({ w: 600, h: typeof height === 'number' ? height : 180 })
  const stateRef = useRef({ lastLen: 0, born: performance.now() })

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const len = data ? data.v.length : 0
  const from = windowDays > 0 ? Math.max(0, len - windowDays) : 0
  const span = Math.max(1, (windowDays > 0 ? windowDays : Math.max(len, 2)) - 1)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = size.w, H = size.h
    if (!(W > 60 && H > 60)) return
    cv.width = W * dpr; cv.height = H * dpr
    const g = cv.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    const padL = 46, padR = 10, padT = 12, padB = 22
    const pw = W - padL - padR, ph = H - padT - padB

    if (!data || len < 2) {
      g.fillStyle = '#6f8ba8'; g.font = '600 14px Rajdhani, sans-serif'; g.textAlign = 'center'
      g.fillText(label || '', W / 2, H / 2)
      return
    }
    let lo = Infinity, hi = -Infinity
    for (let i = from; i < len; i++) {
      lo = Math.min(lo, data.v[i]); hi = Math.max(hi, data.v[i])
      if (data.mu[i] != null) { lo = Math.min(lo, data.mu[i] - 2.4 * data.sd[i]); hi = Math.max(hi, data.mu[i] + 2.4 * data.sd[i]) }
    }
    const pad = (hi - lo) * 0.06 || 1
    lo -= pad; hi += pad
    const X = (i) => padL + ((i - from) / span) * pw
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * ph

    // grid
    g.strokeStyle = 'rgba(62,240,210,0.08)'; g.lineWidth = 1; g.fillStyle = '#6f8ba8'
    g.font = '500 11px Rajdhani, sans-serif'; g.textAlign = 'right'
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4, y = Y(v)
      g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke()
      g.fillText(fmt(v, DIGITS[sig]), padL - 6, y + 4)
    }
    g.textAlign = 'center'
    const step = Math.max(10, Math.round(span / 6 / 10) * 10)
    for (let d = Math.ceil(from / step) * step; d < len; d += step) {
      g.fillText(String(d + base), X(d), H - 6)
    }

    // baseline band behind the trace
    const idx = []
    for (let i = from; i < len; i++) if (data.mu[i] != null) idx.push(i)
    if (idx.length > 1) {
      const grad = g.createLinearGradient(0, padT, 0, padT + ph)
      grad.addColorStop(0, 'rgba(43,143,255,0.26)'); grad.addColorStop(1, 'rgba(43,143,255,0.12)')
      g.fillStyle = grad
      g.beginPath()
      idx.forEach((i, k) => { const x = X(i), y = Y(data.mu[i] + 2 * data.sd[i]); k ? g.lineTo(x, y) : g.moveTo(x, y) })
      for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; g.lineTo(X(i), Y(data.mu[i] - 2 * data.sd[i])) }
      g.closePath(); g.fill()
      g.strokeStyle = 'rgba(43,143,255,0.55)'; g.lineWidth = 1
      for (const sgn of [1, -1]) {
        g.beginPath()
        idx.forEach((i, k) => { const x = X(i), y = Y(data.mu[i] + sgn * 2 * data.sd[i]); k ? g.lineTo(x, y) : g.moveTo(x, y) })
        g.stroke()
      }
      g.setLineDash([5, 4]); g.strokeStyle = 'rgba(120,190,255,0.85)'; g.lineWidth = 1.2
      g.beginPath()
      idx.forEach((i, k) => { const x = X(i), y = Y(data.mu[i]); k ? g.lineTo(x, y) : g.moveTo(x, y) })
      g.stroke(); g.setLineDash([])
    }

    // alert markers
    for (const a of alerts) {
      if (a.day < from || a.day >= len) continue
      const x = X(a.day)
      g.strokeStyle = 'rgba(255,61,110,0.75)'; g.setLineDash([3, 3]); g.lineWidth = 1.2
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke(); g.setLineDash([])
      g.fillStyle = '#ff3d6e'
      g.beginPath(); g.moveTo(x, padT + 1); g.lineTo(x - 5, padT - 7); g.lineTo(x + 5, padT - 7); g.closePath(); g.fill()
    }
    // planted (simulation ground truth) markers on the axis
    for (const p of planted) {
      if (p.onset_day < from || p.onset_day >= len) continue
      const x = X(p.onset_day)
      g.fillStyle = '#ffc247'
      g.beginPath(); g.moveTo(x, padT + ph); g.lineTo(x - 4, padT + ph + 7); g.lineTo(x + 4, padT + ph + 7); g.closePath(); g.fill()
    }

    // trace: glow pass then crisp pass, coloured by deviation
    const seg = (i, lw, alpha) => {
      const w = data.w[i]
      const c = w != null && w >= 2 ? '255,61,110' : w != null && w >= 1.2 ? '255,194,71' : '62,240,210'
      g.strokeStyle = `rgba(${c},${alpha})`; g.lineWidth = lw
      g.beginPath(); g.moveTo(X(i - 1), Y(data.v[i - 1])); g.lineTo(X(i), Y(data.v[i])); g.stroke()
    }
    g.lineCap = 'round'; g.lineJoin = 'round'
    for (let i = Math.max(from + 1, 1); i < len; i++) seg(i, 5, 0.12)
    for (let i = Math.max(from + 1, 1); i < len; i++) seg(i, 1.8, 1)
    // head dot
    const hw = data.w[len - 1]
    const hc = hw != null && hw >= 2 ? '#ff3d6e' : hw != null && hw >= 1.2 ? '#ffc247' : '#3ef0d2'
    const t = (performance.now() - stateRef.current.born) / 1000
    g.fillStyle = hc; g.shadowColor = hc; g.shadowBlur = 14
    g.beginPath(); g.arc(X(len - 1), Y(data.v[len - 1]), 3.6 + Math.sin(t * 5) * 0.6, 0, 7); g.fill(); g.shadowBlur = 0

    // hover crosshair
    if (hover != null && hover >= from && hover < len) {
      const x = X(hover)
      g.strokeStyle = 'rgba(200,240,255,0.5)'; g.lineWidth = 1
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke()
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x, Y(data.v[hover]), 3, 0, 7); g.fill()
    }
  }, [data, len, from, span, alerts, planted, size, sig, hover, label, base])

  // keep the head dot pulsing
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 120)
    return () => clearInterval(t)
  }, [])

  const onMove = (e) => {
    if (!data || len < 2) return
    const r = ref.current.getBoundingClientRect()
    const x = e.clientX - r.left
    const padL = 46, padR = 10
    const i = Math.round(from + ((x - padL) / (r.width - padL - padR)) * span)
    setHover(Math.max(from, Math.min(len - 1, i)))
  }
  const h = hover != null && data && hover < len ? hover : null
  const z = h != null && data.mu[h] != null && data.sd[h] ? (data.v[h] - data.mu[h]) / data.sd[h] : null

  return (
    <div className="chart-wrap" ref={wrap} style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <canvas ref={ref} style={{ width: '100%', height: '100%' }} />
      {h != null && (
        <div className="chart-tip" style={{ left: Math.min(size.w - 190, Math.max(50, 46 + ((h - from) / span) * (size.w - 56))) }}>
          <b>{unitName} {h + base}</b> · {fmt(data.v[h], DIGITS[sig])} {UNIT[sig]}
          {data.mu[h] != null && <div className="dim">baseline {fmt(data.mu[h], DIGITS[sig])} ± {fmt(data.sd[h], DIGITS[sig] + 1)} · z {fmt(z, 1)}</div>}
        </div>
      )}
    </div>
  )
}
export { STATUS_COLOR }
