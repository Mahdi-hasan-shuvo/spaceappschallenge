import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useT } from '../hooks'
import { DIGITS, STATUS_COLOR, UNIT, fmt, ruleLabel } from '../util'
import SignalChart from './SignalChart'
import { Details } from './AlertsTab'

const SIG = ['hr', 'hrv', 'spo2', 'core_temp']
const SPEEDS = [1, 5, 10, 20, 60]
const empty = () => Object.fromEntries(SIG.map((s) => [s, { v: [], mu: [], sd: [], w: [] }]))

const fromSamples = (samples) => {
  const out = empty()
  for (const m of samples) for (const s of SIG) {
    out[s].v.push(m.v[s]); out[s].mu.push(m.mu[s]); out[s].sd.push(m.sd[s]); out[s].w.push(m.w[s])
  }
  return out
}

// 1 Hz rehearsal stream: /ws/rehearsal. The server runs the deterministic detector; this only draws.
export default function RehearsalTab() {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const [fixture, setFixture] = useState('planted')
  const [speed, setSpeed] = useState(10)
  const [run, setRun] = useState(0)
  const [start, setStart] = useState(0)
  const [sig, setSig] = useState('hrv')
  const [series, setSeries] = useState(empty)
  const [alerts, setAlerts] = useState([])
  const [status, setStatus] = useState('learning')
  const [hello, setHello] = useState(null)
  const [ended, setEnded] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [sel, setSel] = useState(null)
  const ws = useRef(null)

  useEffect(() => {
    setSeries(empty()); setAlerts([]); setStatus('learning'); setEnded(false); setHello(null); setPlaying(true); setSel(null)
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const sock = new WebSocket(`${proto}://${location.host}/ws/rehearsal?speed=${speed}&fixture=${fixture}&start=${start}`)
    ws.current = sock
    sock.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data) } catch { return }
      if (m.type === 'hello') setHello(m)
      else if (m.type === 'reset') { setSeries(fromSamples(m.samples || [])); setAlerts(m.alerts || []); setEnded(false) }
      else if (m.type === 'sample') {
        setSeries((p) => { const n = { ...p }; for (const s of SIG) n[s] = { v: [...p[s].v, m.v[s]], mu: [...p[s].mu, m.mu[s]], sd: [...p[s].sd, m.sd[s]], w: [...p[s].w, m.w[s]] }; return n })
        setStatus(m.status)
        if (m.alerts?.length) { setAlerts((a) => [...a, ...m.alerts]); setSel((cur) => cur || m.alerts[0].id) }
      } else if (m.type === 'end') setEnded(true)
    }
    return () => { sock.onmessage = null; sock.close() }
    // speed changes are sent live (below), not by reconnecting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture, run, start])

  const send = useCallback((o) => { if (ws.current?.readyState === 1) ws.current.send(JSON.stringify(o)) }, [])
  const setSp = (v) => { setSpeed(v); send({ action: 'speed', value: v }) }
  const toggle = () => { send({ action: playing ? 'pause' : 'play' }); setPlaying(!playing) }
  const pa = hello?.meta?.planted_anomaly
  const jump = () => { if (pa) { setStart(Math.max(0, pa.onset_index - 10)); setRun((r) => r + 1) } }
  const restart = () => { setStart(0); setRun((r) => r + 1) }
  const data = series[sig]
  const len = data.v.length
  const cur = alerts.find((a) => a.id === sel)

  return (
    <div className="tab-body">
      <div className="sub-h">{t.rhTitle} <span className="tag sim">{t.sim}</span></div>
      <p className="muted small">{t.rhSub}</p>
      <div className="chart-ctl">
        <div className="seg small">
          <button className={fixture === 'planted' ? 'on' : ''} onClick={() => { setFixture('planted'); setStart(0) }}>{t.rhPlanted}</button>
          <button className={fixture === 'clean' ? 'on' : ''} onClick={() => { setFixture('clean'); setStart(0) }}>{t.rhClean}</button>
        </div>
        <div className="sig-tabs">
          {SIG.map((s) => <button key={s} className={sig === s ? 'on' : ''} onClick={() => setSig(s)}>{t.sigShort[s]}</button>)}
        </div>
      </div>
      <div style={{ height: 190, margin: '6px 0' }}>
        <SignalChart sig={sig} data={data} alerts={alerts.filter((a) => a.signals.includes(sig))}
          planted={pa ? [{ onset_day: pa.onset_index }] : []} windowDays={120} height="100%" unitName={t.rhSample} base={0}
          label={t.rhConnecting} />
      </div>
      <div className="chart-ctl">
        <button className="btn" onClick={toggle} disabled={ended}>{playing ? t.pause : t.play}</button>
        <button className="btn" onClick={restart}>{t.rhRestart}</button>
        {pa && <button className="btn cyan" onClick={jump}>{t.rhJump}</button>}
      </div>
      <div className="chart-ctl">
        <span className="muted small">{t.rhSpeed}</span>
        <div className="seg small">{SPEEDS.map((v) => <button key={v} className={speed === v ? 'on' : ''} onClick={() => setSp(v)}>{v}×</button>)}</div>
      </div>
      <p className="muted small">
        {t.rhSample} {len ? len - 1 : '–'} / {hello ? hello.n - 1 : '–'} ·{' '}
        <b style={{ color: STATUS_COLOR[status] }}>{t.status[status]}</b>
        {pa ? ` · ${t.rhBeat} ${pa.onset_index}` : ''}{ended ? ` · ${t.rhEnded}` : ''}
      </p>
      {len > 0 && data.mu[len - 1] != null && (
        <p className="muted small">{t.sig[sig]}: {fmt(data.v[len - 1], DIGITS[sig])} {UNIT[sig]} · {t.baseline} {fmt(data.mu[len - 1], DIGITS[sig])} ± {fmt(data.sd[len - 1], DIGITS[sig] + 1)}</p>
      )}
      <div className="sub-h">{t.alertsTitle} · {alerts.length}</div>
      {alerts.length === 0 && <div className="empty">{t.rhNoAlert}</div>}
      {alerts.slice().reverse().map((a) => (
        <div key={a.id} className={`alert-card ${sel === a.id ? 'sel' : ''}`} onClick={() => setSel(a.id)}>
          <div className="a-head"><span className="a-rule">{ruleLabel(a.rule)}</span><span className="a-day">{t.rhSample} {a.index}</span></div>
          <div className="a-chips">{a.signals.map((s) => <span key={s} className="chip">{t.sigShort[s]}</span>)}</div>
        </div>
      ))}
      {cur && (
        <>
          <div className="sub-h">{t.numbers}</div>
          <Details a={cur} t={t} />
          <div className="sub-h">{t.whatChanged}</div>
          <p className="a-expl">{(lang === 'bn' && cur.explanation_bn) || cur.explanation}</p>
          {cur.citations?.length > 0 && (
            <>
              <div className="sub-h">{t.rhCited}</div>
              {cur.citations.map((c) => (
                <div key={c.id} className="muted small"><b>{c.id}</b> · <a href={c.url} target="_blank" rel="noopener noreferrer">{t.evOpenLink}</a></div>
              ))}
            </>
          )}
          <div className="muted small">{t.notDiagnosis}</div>
        </>
      )}
    </div>
  )
}
