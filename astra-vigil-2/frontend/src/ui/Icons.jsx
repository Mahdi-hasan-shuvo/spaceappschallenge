// Small stroke icon set (24px grid). Inline SVG: no icon font, no network.
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }
const F = { fill: 'currentColor', stroke: 'none' }
const ICONS = {
  play: <path d="M7.5 4.8v14.4a.6.6 0 0 0 .9.5l11.4-7.2a.6.6 0 0 0 0-1L8.4 4.3a.6.6 0 0 0-.9.5z" {...F} />,
  pause: <><rect x="6" y="4.5" width="4.2" height="15" rx="1.2" {...F} /><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" {...F} /></>,
  restart: <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4 4.2v4.6h4.6" {...S} />,
  flag: <path d="M6 21V3.5M6 4.5h11.5l-2.3 4 2.3 4H6" {...S} />,
  vr: <path d="M3.2 8h17.6a1.2 1.2 0 0 1 1.2 1.2v5.6a1.2 1.2 0 0 1-1.2 1.2h-4.4l-1.9-2.4H9.5L7.6 16H3.2A1.2 1.2 0 0 1 2 14.8V9.2A1.2 1.2 0 0 1 3.2 8z" {...S} />,
  cube: <path d="M12 2.8l8 4.5v9.4l-8 4.5-8-4.5V7.3zM12 12l8-4.6M12 12v9.2M12 12L4 7.4" {...S} />,
  speaker: <path d="M4 9.5v5h3.6L12.5 19V5L7.6 9.5zM16 8.6a5 5 0 0 1 0 6.8M18.6 5.8a9 9 0 0 1 0 12.4" {...S} />,
  speakerOff: <path d="M4 9.5v5h3.6L12.5 19V5L7.6 9.5zM16.5 9.5l5 5M21.5 9.5l-5 5" {...S} />,
  info: <><circle cx="12" cy="12" r="9" {...S} /><path d="M12 11v5.5M12 7.6v.4" {...S} /></>,
  book: <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 0 4 21.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 1 1.5 1.5z" {...S} />,
  close: <path d="M6 6l12 12M18 6L6 18" {...S} />,
  bolt: <path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z" {...S} />,
  send: <path d="M21 3L10 14M21 3l-6.5 18-3.5-7.5L3.5 10z" {...S} />,
  eye: <><path d="M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7S2 12 2 12z" {...S} /><circle cx="12" cy="12" r="3" {...S} /></>,
  sun: <><circle cx="12" cy="12" r="4" {...S} /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" {...S} /></>,
  rotL: <path d="M9 5L4 9.5 9 14M4 9.5h9a6 6 0 0 1 0 12" {...S} />,
  rotR: <path d="M15 5l5 4.5-5 4.5M20 9.5h-9a6 6 0 0 0 0 12" {...S} />,
  rocket: <path d="M12 2.5c3.5 2.2 5.2 6 4.6 10.5l-2.3 2.3H9.7L7.4 13C6.8 8.5 8.5 4.7 12 2.5zM9.7 15.3L8 20.5l4-2.2 4 2.2-1.7-5.2M12 9.2v.1" {...S} />,
  check: <path d="M4.5 12.5l5 5 10-11" {...S} />,
  chevR: <path d="M9 5l7 7-7 7" {...S} />,
}
export default function Icon({ name, size = 18, className = '' }) {
  return (
    <svg className={`ico ${className}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden focusable="false">{ICONS[name]}</svg>
  )
}
