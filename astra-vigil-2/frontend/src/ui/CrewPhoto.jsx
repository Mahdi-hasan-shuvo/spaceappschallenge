import { useEffect, useState } from 'react'
import { STATUS_COLOR } from '../util'

const hue = (s) => [...String(s)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7)

// Portrait with a status ring. If the crew member has no photo file (yet), a generated helmet avatar is shown.
export function Avatar({ name = '?', id = name }) {
  const h = hue(id)
  return (
    <svg viewBox="0 0 100 100" className="avatar" aria-label={name}>
      <defs>
        <linearGradient id={`ag${h}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${h} 70% 30%)`} /><stop offset="1" stopColor={`hsl(${(h + 60) % 360} 70% 14%)`} />
        </linearGradient>
        <radialGradient id={`vz${h}`} cx=".35" cy=".3" r=".9"><stop offset="0" stopColor="#7fe9ff" /><stop offset="1" stopColor="#0a2a44" /></radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#ag${h})`} />
      <path d="M12 100c2-24 18-34 38-34s36 10 38 34z" fill="#e9eef2" opacity=".92" />
      <path d="M32 78h36M50 66v34" stroke="#2b4a8c" strokeWidth="3" opacity=".8" />
      <circle cx="50" cy="40" r="25" fill="#f4f7f9" />
      <ellipse cx="50" cy="41" rx="18" ry="16" fill={`url(#vz${h})`} />
      <ellipse cx="43" cy="35" rx="6" ry="3.2" fill="#fff" opacity=".45" transform="rotate(-25 43 35)" />
      <text x="50" y="48" textAnchor="middle" fontSize="19" fontWeight="700" fill="#d9fbff" fontFamily="Orbitron, sans-serif" opacity=".95">{String(name).charAt(0).toUpperCase()}</text>
    </svg>
  )
}

export default function CrewPhoto({ c, size = 44, status, ring = true, className = '' }) {
  const [bad, setBad] = useState(false)
  useEffect(() => setBad(false), [c?.photo])
  const st = status || c?.status || 'unknown'
  const col = STATUS_COLOR[st] || STATUS_COLOR.unknown
  return (
    <span className={`cphoto ${st === 'alert' ? 'alert' : ''} ${className}`} style={{ '--sz': `${size}px`, '--col': col }}>
      {ring && <i className="cp-ring" />}
      <span className="cp-face">
        {c?.photo && !bad
          ? <img src={c.photo} alt={c.callsign} draggable={false} onError={() => setBad(true)} />
          : <Avatar name={c?.callsign} id={c?.id} />}
      </span>
    </span>
  )
}
