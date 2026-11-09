import { create } from 'zustand'
import { api } from '../api'
import { useStore } from '../store'

export const useChat = create((set, get) => ({
  msgs: [],
  busy: false,
  async ask(q) {
    const question = q.trim()
    if (!question || get().busy) return
    const st = useStore.getState()
    set({ msgs: [...get().msgs, { who: 'me', text: question }], busy: true })
    try {
      const r = await api.ask(question, st.lang, st.role, st.viewer, st.subject)
      set({ msgs: [...get().msgs, { who: 'ai', ...r, text: r.answer }], busy: false })
    } catch {
      set({ msgs: [...get().msgs, { who: 'ai', text: '…', error: true }], busy: false })
    }
  },
  clear: () => set({ msgs: [] }),
}))
