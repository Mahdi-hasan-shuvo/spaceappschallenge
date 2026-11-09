import { create } from 'zustand'
import { api, connect } from './api'
import { SIGNALS } from './util'
import { audio } from './audio'

const empty = () => Object.fromEntries(SIGNALS.map((s) => [s, { v: [], mu: [], sd: [], w: [] }]))

let flashTimer = null
let evTimer = null

export const useStore = create((set, get) => ({
  meta: null,
  conn: 'connecting',
  role: 'crew',
  viewer: 'niloy',
  subject: 'niloy',
  intro: !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('intro') === '0'),
  lang: 'en',
  day: -1,
  n: 600,
  playing: false,
  speed: 2,
  delay: { key: 'mars_mean', min: 12.51, presets: {}, seconds_per_min: 1 },
  skew: 0, // server clock minus browser clock, seconds
  crew: [],
  alerts: [],
  trends: {},
  series: null, // {crew_id, data:{signal:{v,mu,sd,w}}}
  outbox: [],
  consents: {},
  validation: null,
  selectedSignal: 'hrv',
  selectedAlertId: null,
  evidenceOpen: false,
  autoEvidence: true,
  flash: null, // {id, signals, t}
  tab: 'alerts',
  spatial: false,
  look: 'holo',
  suitYaw: 0,
  suitSize: 'life',
  vr: false,
  hover: null,

  // ----------------------------------------------------------------- setup
  init: async () => {
    try { set({ meta: await api.meta() }) } catch { /* offline until the server is up */ }
    get().reconnect()
  },
  reconnect: () => {
    const { role, viewer } = get()
    connect(role, role === 'crew' ? viewer : null, (m) => get().onMessage(m), (c) => set({ conn: c }))
  },
  setRole: (role, viewer) => {
    const v = role === 'crew' ? (viewer || get().viewer || 'niloy') : null
    set({ role, viewer: v || get().viewer, subject: v || get().subject, alerts: [], series: null, flash: null,
      selectedAlertId: null, evidenceOpen: false, trends: {} })
    get().reconnect()
  },
  setViewer: (viewer) => get().setRole('crew', viewer),
  setSubject: (subject) => { if (subject !== get().subject) audio.select(); set({ subject, selectedAlertId: null }) },
  setLang: (lang) => {
    set({ lang })
    document.documentElement.lang = lang === 'bn' ? 'bn' : 'en'
  },
  setSignal: (s) => set({ selectedSignal: s }),
  setTab: (tab) => set({ tab }),
  setSpatial: (spatial) => set({ spatial }),
  setLook: (look) => set({ look }),
  rotateSuit: (d) => set((st) => ({ suitYaw: st.suitYaw + d })),
  toggleSuitSize: () => set((st) => ({ suitSize: st.suitSize === 'life' ? 'desk' : 'life' })),
  setVr: (vr) => set({ vr }),
  openEvidence: (open = true) => { if (open && !get().evidenceOpen) audio.chime(); set({ evidenceOpen: open }) },
  selectAlert: (id) => {
    const a = get().alerts.find((x) => x.id === id)
    set({ selectedAlertId: id, selectedSignal: a ? a.signals[0] : get().selectedSignal })
  },
  setAutoEvidence: (v) => set({ autoEvidence: v }),

  // --------------------------------------------------------------- messages
  onMessage: (m) => {
    if (m.server_time) set({ skew: m.server_time - Date.now() / 1000 })
    if (m.type === 'snapshot') return get().applySnapshot(m)
    if (m.type === 'tick') return get().applyTick(m)
    if (m.type === 'delivered') return get().applyDelivered(m.delivered)
  },
  applySnapshot: (s) => {
    const cur = get()
    const sub = s.crew.find((c) => c.id === cur.subject) ? cur.subject : (s.viewer || s.crew[0]?.id)
    set({
      day: s.day, n: s.n, playing: s.playing, speed: s.speed, delay: s.delay, crew: s.crew,
      alerts: s.alerts, trends: s.trends, outbox: s.outbox, consents: s.consents, validation: s.validation,
      series: s.series ? { crew_id: s.series.crew_id, data: s.series.data } : null,
      subject: sub,
    })
    const mine = s.alerts.filter((a) => a.crew_id === sub)
    if (!mine.find((a) => a.id === cur.selectedAlertId)) {
      const last = mine[mine.length - 1]
      set({ selectedAlertId: last ? last.id : null })
    }
  },
  applyTick: (t) => {
    const st = get()
    const crew = st.crew.map((c) => {
      const s = st.role === 'ground' ? c.status : (t.status[c.id] || c.status)
      return { ...c, status: s, level: { learning: 0, normal: 1, watch: 2, alert: 3 }[s] ?? c.level }
    })
    let series = st.series
    if (series && t.rows && t.rows[series.crew_id]) {
      const r = t.rows[series.crew_id]
      const data = {}
      for (const s of SIGNALS) {
        const d = series.data[s]
        data[s] = { v: [...d.v, r.v[s]], mu: [...d.mu, r.mu[s]], sd: [...d.sd, r.sd[s]], w: [...d.w, r.w[s]] }
      }
      series = { crew_id: series.crew_id, data }
    }
    const known = new Set(st.alerts.map((a) => a.id))
    const fresh = (t.alerts || []).filter((a) => !known.has(a.id))
    let outbox = st.outbox
    if (t.queued?.length) outbox = [...outbox, ...t.queued]
    if (t.delivered?.length) outbox = outbox.map((o) => (t.delivered.find((d) => d.id === o.id) ? { ...o, delivered: 1 } : o))
    set({
      day: t.day, playing: t.playing, speed: t.speed, crew, series,
      alerts: fresh.length ? [...st.alerts, ...fresh] : st.alerts,
      trends: t.trends ? t.trends : st.trends, outbox,
    })
    const mine = fresh.filter((a) => a.crew_id === get().subject)
    if (mine.length) get().triggerAlert(mine[mine.length - 1])
  },
  applyDelivered: (done) => {
    if (done?.length && get().role !== 'ground') audio.ping()
    set({ outbox: get().outbox.map((o) => (done.find((d) => d.id === o.id) ? { ...o, delivered: 1 } : o)) })
  },

  // ----------------------------------------------------------- alert moment
  triggerAlert: (a) => {
    audio.alert()
    set({ selectedAlertId: a.id, selectedSignal: a.signals[0], flash: { id: a.id, signals: a.signals, t: performance.now() }, tab: 'alerts' })
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => set({ flash: null }), 7000)
    clearTimeout(evTimer)
    if (get().autoEvidence) evTimer = setTimeout(() => { audio.chime(); set({ evidenceOpen: true }) }, 1400)
  },
  clearFlash: () => set({ flash: null }),

  // ---------------------------------------------------------------- controls
  play: () => api.control('play'),
  pause: () => api.control('pause'),
  // One entry point for every Start / Pause / Resume / Restart control (console, 3D panel, VR controller).
  // Fresh or finished run: start from day 1. Paused mid-run: resume.
  togglePlay: async () => {
    const { playing, day, n } = get()
    if (playing) { audio.pause(); return api.control('pause') }
    if (day < 0 || day >= n - 1) { set({ flash: null, evidenceOpen: false }); audio.start(); audio.ambient(true); await api.control('reset'); return api.control('play') }
    audio.resume(); audio.ambient(true)
    return api.control('play')
  },
  // The intro's START MISSION button.
  enterMission: async ({ run = true } = {}) => {
    set({ intro: false })
    if (!run) return
    set({ flash: null, evidenceOpen: false })
    await api.control('reset')
    return api.control('play')
  },
  setSpeed: (v) => api.control('speed', v),
  seek: (d) => api.control('seek', d),
  reset: () => { set({ flash: null, evidenceOpen: false }); return api.control('reset') },
  rehearse: async () => {
    set({ flash: null, evidenceOpen: false })
    audio.whoosh(); audio.ambient(true)
    await api.control('speed', 1)
    const target = get().role === 'crew' ? get().viewer : get().subject
    let r
    try { r = await api.jump(target) } catch { r = await api.jump(null) }
    await api.control('play')
    return r
  },
  setDelay: (p) => api.delay(p),
  setConsent: (cid, granted) => api.consent(cid, granted, get().viewer),
}))

export const useSubject = () => useStore((s) => s.crew.find((c) => c.id === s.subject))
export const emptySeries = empty
