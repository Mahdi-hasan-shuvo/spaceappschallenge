import { useRef } from 'react'
import Icon from './Icons'

// The console's one button: layered glass + bevel, light sheen on hover, press-in, ripple, focus ring.
// Sound comes from a single delegated listener in App.jsx (click blip on every button, a soft tick on hover).
// variant: '' | 'cyan' (primary) | 'amber' | 'danger' | 'vr' | 'ghost'      size: '' | 'big' | 'sm' | 'icon'
export default function Btn({ variant = '', size = '', icon, iconAfter, children, className = '', onPointerDown, ...rest }) {
  const ref = useRef(null)
  const ripple = (e) => {
    const el = ref.current
    if (!el || rest.disabled) return
    const r = el.getBoundingClientRect()
    const d = Math.max(r.width, r.height) * 1.7
    const s = document.createElement('i')
    s.className = 'ripple'
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`
    el.appendChild(s)
    setTimeout(() => s.remove(), 700)
  }
  return (
    <button ref={ref} type="button" className={`btn ${variant} ${size} ${className}`.trim()} {...rest}
      onPointerDown={(e) => { ripple(e); onPointerDown?.(e) }}>
      {icon && <Icon name={icon} size={size === 'big' ? 22 : 17} />}
      {children != null && <span className="b-label">{children}</span>}
      {iconAfter && <Icon name={iconAfter} size={16} />}
    </button>
  )
}
