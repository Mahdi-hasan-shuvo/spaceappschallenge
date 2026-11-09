import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api'
import { useStore } from '../store'
import { useT } from '../hooks'

export default function TrustTab() {
  const t = useT()
  const { role, viewer, subject, consents, validation, meta, day } = useStore()
  const setConsent = useStore((s) => s.setConsent)
  const [audit, setAudit] = useState(null)
  const load = useCallback(() => api.audit(24).then(setAudit).catch(() => {}), [])
  useEffect(() => { load(); const i = setInterval(load, 4000); return () => clearInterval(i) }, [load])
  const mine = role === 'crew' ? viewer : null
  const on = mine ? !!consents?.[mine]?.medical : false
  const mc = meta?.validation
  return (
    <div className="tab-body">
      <div className="sub-h">{t.tiers}</div>
      <ul className="tiers"><li>{t.tier0}</li><li>{t.tier1}</li><li>{t.tier2}</li></ul>

      <div className="sub-h">{t.consent}</div>
      <label className={`switch ${mine ? '' : 'off'}`}>
        <input type="checkbox" checked={on} disabled={!mine} onChange={(e) => setConsent(mine, e.target.checked)} />
        <span className="sw-track"><motion.span className="sw-knob" animate={{ x: on ? 20 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} /></span>
        <span>{mine ? `${mine} → ${t.medical}` : t.consentOnly}</span>
      </label>
      <p className="muted">{t.consentHelp}</p>

      <div className="sub-h">{t.audit}</div>
      <div className={`chain ${audit?.chain?.ok ? 'ok' : 'bad'}`}>
        {audit?.chain?.ok ? '✔' : '✖'} {audit?.chain?.ok ? t.chainOk : t.chainBad} · {audit?.chain?.entries ?? 0} {t.entries}
        <button className="link" onClick={() => api.verify().then((c) => setAudit((a) => ({ ...a, chain: c })))}>{t.verify}</button>
      </div>
      <p className="muted">{t.auditHelp}</p>
      <div className="audit">
        {(audit?.entries || []).slice().reverse().slice(0, 12).map((e) => (
          <div className="au-row" key={e.id}>
            <span className="au-id">#{e.id}</span>
            <span className="au-act">{e.actor} · {e.action}</span>
            <code>{e.hash.slice(0, 10)}…</code>
          </div>
        ))}
      </div>

      {validation && (
        <>
          <div className="sub-h">{t.val} <span className="tag sim">{t.sim}</span></div>
          <p className="muted">{t.valHelp}</p>
          <div className="stats">
            <div><b>{validation.caught}/{validation.planted_events_so_far}</b><span>{t.valCaught}</span></div>
            <div><b>{validation.mean_delay_days == null ? '–' : validation.mean_delay_days.toFixed(1)}</b><span>{t.valDelay}</span></div>
            <div><b>{validation.chance_per_1000_crew_days ?? '–'}</b><span>{t.valChance}</span></div>
          </div>
        </>
      )}
      {mc && (
        <>
          <div className="sub-h">{t.mc} <span className="tag sim">{t.sim}</span></div>
          <div className="stats">
            <div><b>{mc.single_event.detection_rate_pct}%</b><span>{t.mcSingle}</span></div>
            <div><b>{mc.multi_event.detection_rate_pct}%</b><span>{t.mcMulti}</span></div>
            <div><b>{mc.false_alarms.all_per_1000_days}</b><span>{t.mcFalse}</span></div>
          </div>
          <p className="muted small">{mc.single_event.runs + mc.multi_event.runs} runs · {mc.noise_model}</p>
        </>
      )}
    </div>
  )
}
