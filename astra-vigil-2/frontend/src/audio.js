// Offline sound for Astra Vigil: everything is synthesised with the Web Audio API. No audio files, no network.
// `makeSfx(ctx, dest)` schedules sounds on ANY AudioContext, so the tests render them with an OfflineAudioContext
// and check they are audible, finite and not clipping. The `audio` singleton wraps one live context.

const TAU = Math.PI * 2

export function makeSfx(ctx, dest) {
  const now = () => ctx.currentTime

  function env(g, t0, attack, dur, peak, release = 0.08) {
    g.gain.cancelScheduledValues(t0)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dur + release)
  }

  function tone(freq, t0, dur, { type = 'sine', peak = 0.1, attack = 0.005, release = 0.08, to = null, filter = null, detune = 0 } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t0)
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + attack + dur)
    o.detune.value = detune
    let node = o
    if (filter) {
      const f = ctx.createBiquadFilter()
      f.type = filter.type || 'lowpass'
      f.frequency.setValueAtTime(filter.from ?? filter.freq ?? 2000, t0)
      if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t0 + attack + dur)
      f.Q.value = filter.q ?? 0.7
      node.connect(f); node = f
    }
    node.connect(g); g.connect(dest)
    env(g, t0, attack, dur, peak, release)
    o.start(t0); o.stop(t0 + attack + dur + release + 0.05)
  }

  let noiseBuf = null
  function noise() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
      const d = noiseBuf.getChannelData(0)
      let s = 12345
      for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1 }
    }
    const src = ctx.createBufferSource()
    src.buffer = noiseBuf; src.loop = true
    return src
  }

  function swoosh(t0, dur, { from = 300, to = 4000, peak = 0.1, q = 1.2 } = {}) {
    const n = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain()
    f.type = 'bandpass'; f.Q.value = q
    f.frequency.setValueAtTime(from, t0)
    f.frequency.exponentialRampToValueAtTime(to, t0 + dur)
    n.connect(f); f.connect(g); g.connect(dest)
    env(g, t0, dur * 0.7, dur * 0.2, peak, dur * 0.2)
    n.start(t0); n.stop(t0 + dur * 1.2 + 0.1)
  }

  return {
    click(t = now()) {
      tone(1900, t, 0.03, { type: 'triangle', peak: 0.07, to: 1100 })
      tone(420, t, 0.05, { type: 'sine', peak: 0.05, to: 260 })
    },
    hover(t = now()) { tone(2600, t, 0.012, { type: 'sine', peak: 0.018 }) },
    select(t = now()) {
      tone(660, t, 0.07, { type: 'triangle', peak: 0.07 })
      tone(990, t + 0.06, 0.1, { type: 'triangle', peak: 0.06 })
    },
    toggleOn(t = now()) { tone(520, t, 0.06, { type: 'triangle', peak: 0.07 }); tone(780, t + 0.06, 0.09, { type: 'triangle', peak: 0.07 }) },
    toggleOff(t = now()) { tone(780, t, 0.06, { type: 'triangle', peak: 0.07 }); tone(480, t + 0.06, 0.09, { type: 'triangle', peak: 0.06 }) },
    pause(t = now()) { tone(660, t, 0.08, { type: 'sine', peak: 0.09, to: 440 }); tone(330, t + 0.02, 0.14, { type: 'sine', peak: 0.06 }) },
    resume(t = now()) { tone(440, t, 0.08, { type: 'sine', peak: 0.09, to: 740 }); tone(740, t + 0.08, 0.14, { type: 'sine', peak: 0.06 }) },
    // mission start: riser + whoosh, then an open chord
    start(t = now()) {
      tone(70, t, 1.15, { type: 'sawtooth', peak: 0.09, to: 520, filter: { type: 'lowpass', from: 160, to: 3200, q: 4 }, attack: 0.3, release: 0.25 })
      tone(35, t, 1.2, { type: 'sine', peak: 0.16, to: 140, attack: 0.5 })
      swoosh(t, 1.2, { from: 200, to: 5200, peak: 0.12 })
      const k = t + 1.2
      ;[523.25, 783.99, 1174.66, 1567.98].forEach((f, i) => tone(f, k + i * 0.05, 1.1, { type: 'sine', peak: 0.075 - i * 0.012, attack: 0.01, release: 0.9 }))
      tone(65.41, k, 1.4, { type: 'sine', peak: 0.2, to: 49, attack: 0.01, release: 0.6 })
    },
    // alert: low impact, then three urgent two-tone pulses (not painful: filtered, soft-clipped by the limiter)
    alert(t = now()) {
      tone(90, t, 0.35, { type: 'sine', peak: 0.28, to: 38, attack: 0.004, release: 0.25 })
      swoosh(t, 0.25, { from: 4000, to: 300, peak: 0.07 })
      for (let i = 0; i < 3; i++) {
        const k = t + 0.12 + i * 0.5
        tone(880, k, 0.17, { type: 'square', peak: 0.055, filter: { type: 'lowpass', freq: 2400 }, attack: 0.01, release: 0.04 })
        tone(660, k + 0.2, 0.17, { type: 'square', peak: 0.055, filter: { type: 'lowpass', freq: 2400 }, attack: 0.01, release: 0.04 })
      }
    },
    // evidence drawer opens: a soft three-note chime
    chime(t = now()) {
      ;[784, 988, 1319].forEach((f, i) => tone(f, t + i * 0.09, 0.5, { type: 'sine', peak: 0.07, attack: 0.008, release: 0.5 }))
    },
    // a status word reached Earth after the light-time delay
    ping(t = now()) {
      tone(1760, t, 0.2, { type: 'sine', peak: 0.07, release: 0.45 })
      tone(2637, t + 0.12, 0.2, { type: 'sine', peak: 0.04, release: 0.45 })
    },
    whoosh(t = now()) { swoosh(t, 0.5, { from: 400, to: 3600, peak: 0.1 }) },
    error(t = now()) { tone(220, t, 0.14, { type: 'sawtooth', peak: 0.07, filter: { type: 'lowpass', freq: 900 }, to: 150 }) },
  }
}

// Slow, quiet space-station bed. Returns { stop() } and is only used by the live singleton.
function makeAmbient(ctx, dest) {
  const out = ctx.createGain(); out.gain.value = 0.0001; out.connect(dest)
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.8; lp.connect(out)
  const nodes = []
  ;[[55, 'sawtooth', 0.05, -6], [55, 'sawtooth', 0.05, 7], [82.4, 'triangle', 0.03, 0], [27.5, 'sine', 0.1, 0]].forEach(([f, type, g, det]) => {
    const o = ctx.createOscillator(), v = ctx.createGain()
    o.type = type; o.frequency.value = f; o.detune.value = det; v.gain.value = g
    o.connect(v); v.connect(lp); o.start(); nodes.push(o)
  })
  const lfo = ctx.createOscillator(), lg = ctx.createGain()
  lfo.frequency.value = 0.07; lg.gain.value = 90; lfo.connect(lg); lg.connect(lp.frequency); lfo.start(); nodes.push(lfo)
  // air: very quiet band-passed noise
  const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0)
  let s = 987654, last = 0
  for (let i = 0; i < len; i++) { s = (s * 1664525 + 1013904223) >>> 0; last = last * 0.97 + ((s / 4294967296) * 2 - 1) * 0.03; d[i] = last * 6 }
  const air = ctx.createBufferSource(); air.buffer = buf; air.loop = true
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.5
  const ag = ctx.createGain(); ag.gain.value = 0.05
  air.connect(bp); bp.connect(ag); ag.connect(out); air.start(); nodes.push(air)
  out.gain.setValueAtTime(0.0001, ctx.currentTime)
  out.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 3)
  return {
    stop() {
      const t = ctx.currentTime
      out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), t)
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
      setTimeout(() => nodes.forEach((n) => { try { n.stop() } catch { /* already stopped */ } }), 700)
    },
  }
}

const KEY = 'astra.sound'
const load = () => { try { return { on: true, volume: 0.7, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { on: true, volume: 0.7 } } }
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private window */ } }

let ctx = null, master = null, sfx = null, bed = null, wantBed = false
// Browsers only allow audio after a user gesture, so nothing is created or played before the first click or key.
let gesture = false
if (typeof window !== 'undefined') {
  const g = () => { gesture = true }
  window.addEventListener('pointerdown', g, { capture: true, once: true })
  window.addEventListener('keydown', g, { capture: true, once: true })
}
let state = load()
const listeners = new Set()
const emit = () => listeners.forEach((f) => f({ ...state }))
let lastHover = 0

function ensure() {
  if (ctx) return ctx
  if (!gesture) return null
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  ctx = new AC()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2
  master = ctx.createGain(); master.gain.value = state.on ? state.volume : 0
  master.connect(comp); comp.connect(ctx.destination)
  sfx = makeSfx(ctx, master)
  window.__astraAudio = ctx   // for the browser tests
  return ctx
}

function play(name, ...a) {
  if (!state.on) return
  const c = ensure()
  if (!c) return
  if (c.state === 'suspended') c.resume().catch(() => {})
  try { sfx[name](c.currentTime, ...a) } catch (e) { console.warn('sound', name, e) }
}

if (typeof window !== 'undefined') window.__astraMakeSfx = makeSfx   // for the browser tests (offline render)

export const audio = {
  get state() { return { ...state } },
  get running() { return !!ctx && ctx.state === 'running' },
  subscribe(f) { listeners.add(f); return () => listeners.delete(f) },
  unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume().catch(() => {}); return c },
  setOn(on) {
    if (!on && state.on && ctx) { try { sfx.toggleOff(ctx.currentTime) } catch { /* ignore */ } }   // heard, then muted
    state = { ...state, on: !!on }; save(state)
    if (master) master.gain.setTargetAtTime(state.on ? state.volume : 0, ctx.currentTime + (state.on ? 0 : 0.3), 0.05)
    if (state.on) { gesture = true; this.unlock(); if (wantBed) this.ambient(true); play('toggleOn') } else if (bed) { const b = bed; bed = null; setTimeout(() => b.stop(), 300) }
    emit()
  },
  setVolume(v) {
    state = { ...state, volume: Math.max(0, Math.min(1, v)) }; save(state)
    if (master && state.on) master.gain.setTargetAtTime(state.volume, ctx.currentTime, 0.05)
    emit()
  },
  ambient(on) {
    wantBed = on
    if (!on) { if (bed) { bed.stop(); bed = null } return }
    if (!state.on || bed) return
    const c = this.unlock()
    if (c) bed = makeAmbient(c, master)
  },
  hover() { const n = performance.now(); if (n - lastHover > 60) { lastHover = n; play('hover') } },
}
for (const name of ['click', 'select', 'pause', 'resume', 'start', 'alert', 'chime', 'ping', 'whoosh', 'error']) {
  audio[name] = (...a) => play(name, ...a)
}
