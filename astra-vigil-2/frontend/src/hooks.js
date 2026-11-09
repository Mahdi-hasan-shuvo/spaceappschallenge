import { useEffect, useState } from 'react'
import { useStore } from './store'
import { STR } from './i18n'

export const useT = () => STR[useStore((s) => s.lang)]

export function useNow(ms = 500) {
  const [, setN] = useState(0)
  useEffect(() => { const t = setInterval(() => setN((x) => x + 1), ms); return () => clearInterval(t) }, [ms])
  return Date.now() / 1000
}
