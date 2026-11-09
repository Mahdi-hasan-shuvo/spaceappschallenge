const j = async (r) => {
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => '')}`)
  return r.json()
}
const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j)

export const api = {
  meta: () => fetch('/api/meta').then(j),
  control: (action, value) => post('/api/control', { action, value }),
  step: (n = 1) => post('/api/step', { n }),
  jump: (crew_id) => post('/api/jump-to-event', { crew_id }),
  delay: (preset) => post('/api/delay', { preset }),
  consent: (crew_id, granted, actor) => post('/api/consent', { crew_id, role: 'medical', granted, actor }),
  ask: (question, lang, role, viewer, crew_id) => post('/api/assistant', { question, lang, role, viewer, crew_id }),
  audit: (n = 30) => fetch(`/api/audit?n=${n}`).then(j),
  verify: () => fetch('/api/audit/verify').then(j),
  evidenceSignal: (s) => fetch(`/api/evidence/signal/${s}`).then(j),
}

let ws = null
let retry = 0
let timer = null

export function connect(role, viewer, onMsg, onState) {
  if (timer) clearTimeout(timer)
  if (ws) {
    ws.onclose = null
    try { ws.close() } catch { /* ignore */ }
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const q = new URLSearchParams({ role })
  if (viewer) q.set('crew', viewer)
  const open = () => {
    onState('connecting')
    ws = new WebSocket(`${proto}://${location.host}/ws?${q}`)
    ws.onopen = () => { retry = 0; onState('live') }
    ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)) } catch { /* ignore */ } }
    ws.onclose = () => {
      onState('offline')
      retry = Math.min(retry + 1, 6)
      timer = setTimeout(open, 400 * retry)
    }
  }
  open()
}
