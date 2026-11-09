import * as THREE from 'three'

// Draws one crew ID card onto a canvas and returns a THREE.CanvasTexture. The photo (if any) loads asynchronously;
// the texture is redrawn when it arrives. Without a photo a drawn helmet is used. Cached by id + photo + status.
const W = 384, H = 512
const cache = new Map()

function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath()
}

function helmet(g, x, y, w, h, name) {
  const gr = g.createLinearGradient(x, y, x + w, y + h)
  gr.addColorStop(0, '#12446b'); gr.addColorStop(1, '#06182a')
  g.fillStyle = gr; g.fillRect(x, y, w, h)
  g.fillStyle = '#e9eef2'; g.beginPath(); g.ellipse(x + w / 2, y + h + 20, w * 0.48, h * 0.42, 0, Math.PI, 0); g.fill()
  g.fillStyle = '#f4f7f9'; g.beginPath(); g.arc(x + w / 2, y + h * 0.42, w * 0.3, 0, Math.PI * 2); g.fill()
  const vz = g.createRadialGradient(x + w * 0.42, y + h * 0.36, 4, x + w / 2, y + h * 0.42, w * 0.25)
  vz.addColorStop(0, '#7fe9ff'); vz.addColorStop(1, '#0a2a44')
  g.fillStyle = vz; g.beginPath(); g.ellipse(x + w / 2, y + h * 0.43, w * 0.22, w * 0.19, 0, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#d9fbff'; g.font = `700 ${w * 0.2}px Orbitron, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(String(name).charAt(0).toUpperCase(), x + w / 2, y + h * 0.44)
}

function draw(g, c, img, col) {
  g.clearRect(0, 0, W, H)
  const bg = g.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#0e3250'); bg.addColorStop(1, '#040f1b')
  rr(g, 4, 4, W - 8, H - 8, 22); g.fillStyle = bg; g.fill()
  g.lineWidth = 3; g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = 14; g.stroke(); g.shadowBlur = 0
  const px = 22, py = 22, pw = W - 44, ph = 316
  g.save(); rr(g, px, py, pw, ph, 12); g.clip()
  if (img) {
    const k = Math.max(pw / img.width, ph / img.height)
    const iw = img.width * k, ih = img.height * k
    g.drawImage(img, px + (pw - iw) / 2, py + Math.min(0, (ph - ih) * 0.22), iw, ih)
  } else helmet(g, px, py, pw, ph, c.callsign)
  const sc = g.createLinearGradient(0, py + ph - 70, 0, py + ph)
  sc.addColorStop(0, 'rgba(4,15,27,0)'); sc.addColorStop(1, 'rgba(4,15,27,.75)')
  g.fillStyle = sc; g.fillRect(px, py + ph - 70, pw, 70)
  g.restore()
  g.strokeStyle = col; g.lineWidth = 2; g.globalAlpha = 0.9
  for (const [cx, cy, dx, dy] of [[px + 8, py + 8, 1, 1], [px + pw - 8, py + 8, -1, 1], [px + 8, py + ph - 8, 1, -1], [px + pw - 8, py + ph - 8, -1, -1]]) {
    g.beginPath(); g.moveTo(cx + dx * 22, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + dy * 22); g.stroke()
  }
  g.globalAlpha = 1
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'
  g.fillStyle = '#eafffb'; g.font = '800 40px Orbitron, sans-serif'; g.fillText(String(c.callsign).toUpperCase(), W / 2, 394)
  g.fillStyle = '#8fb4c9'; g.font = '600 22px Rajdhani, sans-serif'; g.fillText(String(c.title || '').toUpperCase(), W / 2, 424)
  g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 10
  g.beginPath(); g.arc(W / 2 - 62, 458, 7, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0
  g.font = '700 20px Orbitron, sans-serif'; g.textAlign = 'left'; g.fillText(String(c.status || 'learning').toUpperCase(), W / 2 - 46, 466)
  g.fillStyle = 'rgba(255,194,71,.85)'; g.font = '600 13px Orbitron, sans-serif'; g.textAlign = 'center'; g.fillText('SIMULATED DATA', W / 2, 496)
}

export function crewTexture(c, col) {
  const key = `${c.id}|${c.photo || ''}|${c.status}|${col}`
  let e = cache.get(key)
  if (e) return e.tex
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const g = cv.getContext('2d')
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4
  draw(g, c, null, col)
  e = { tex }
  cache.set(key, e)
  if (c.photo) {
    const img = new Image()
    img.onload = () => { draw(g, c, img, col); tex.needsUpdate = true }
    img.src = c.photo
  }
  return tex
}
export const CARD_W = 1.0, CARD_H = CARD_W * H / W
