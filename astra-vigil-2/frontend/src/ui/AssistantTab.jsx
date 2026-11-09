import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useChat } from './chat'
import { useStore } from '../store'
import { useT } from '../hooks'

export default function AssistantTab() {
  const t = useT()
  const { msgs, busy, ask, clear } = useChat()
  const lang = useStore((s) => s.lang)
  const [q, setQ] = useState('')
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs, busy])
  const submit = (e) => { e.preventDefault(); ask(q); setQ('') }
  return (
    <div className="tab-body asst">
      <div className="asst-head">
        <motion.span className="pulse-dot" animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }} transition={{ duration: 2, repeat: Infinity }} />
        <b>{t.assistant}</b>
        <span className="tag off">OFFLINE</span>
        {msgs.length > 0 && <button className="link" onClick={clear}>✕</button>}
      </div>
      <p className="muted">{t.asstSub}</p>
      <div className="chat">
        {msgs.length === 0 && (
          <div className="chips">
            {t.chips.map((c) => <button key={c} className="chip btn-chip" onClick={() => ask(c)}>{c}</button>)}
          </div>
        )}
        <AnimatePresence initial={false}>
          {msgs.map((m, i) => (
            <motion.div key={i} className={`msg ${m.who} ${m.boundary ? 'boundary' : ''}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="msg-t">{m.text}</div>
              {m.who === 'ai' && !m.error && (
                <div className="msg-meta">
                  {m.boundary && <span className="tag amber">{t.boundary}</span>}
                  {m.tools?.length > 0 && <span className="tag">{t.tools}: {m.tools.join(', ')}</span>}
                  {m.cites?.length > 0 && <span className="tag">{t.cites}: {m.cites.join(', ')}</span>}
                  <span className="tag sim">{t.sim}</span>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {busy && <div className="msg ai"><div className="msg-t dim">{t.thinking}</div></div>}
        <div ref={end} style={{ scrollMarginBottom: 72 }} />
      </div>
      {msgs.length > 0 && (
        <div className="chips tight">
          {t.chips.slice(0, 4).map((c) => <button key={c} className="chip btn-chip" onClick={() => ask(c)}>{c}</button>)}
        </div>
      )}
      <form className="ask" onSubmit={submit}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.ask} lang={lang} maxLength={300} aria-label={t.ask} />
        <button className="btn cyan" disabled={busy || !q.trim()}>{t.send}</button>
      </form>
    </div>
  )
}
