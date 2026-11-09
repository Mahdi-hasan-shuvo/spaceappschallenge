export const STATUS_COLOR = {
  learning: '#6f8ba8', normal: '#3ef0d2', watch: '#ffc247', alert: '#ff3d6e', unknown: '#6f8ba8',
}
export const SIGNALS = ['hr', 'hrv', 'spo2', 'sleep_h', 'core_temp', 'exercise_min']
export const UNIT = { hr: 'bpm', hrv: 'ms', spo2: '%', sleep_h: 'h', core_temp: '°C', exercise_min: 'min' }
export const UNIT_ASCII = { hr: 'bpm', hrv: 'ms', spo2: '%', sleep_h: 'h', core_temp: 'C', exercise_min: 'min' }
export const DIGITS = { hr: 1, hrv: 1, spo2: 1, sleep_h: 2, core_temp: 2, exercise_min: 0 }
export const SHORT = { hr: 'HR', hrv: 'HRV', spo2: 'SpO2', sleep_h: 'SLEEP', core_temp: 'TEMP', exercise_min: 'EXER' }

export const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : Number(x).toFixed(d))

// colour of one signal by how far it is in the "worse" direction (in SD)
export function worseColor(w) {
  if (w == null) return STATUS_COLOR.learning
  if (w >= 2) return STATUS_COLOR.alert
  if (w >= 1.2) return STATUS_COLOR.watch
  return STATUS_COLOR.normal
}

export function ruleLabel(rule) {
  let t = String(rule || '').replace(/_/g, ' ')
    .replace(/\bhrv\b/g, 'HRV').replace(/\bhr\b/g, 'HR').replace(/\bspo2\b/g, 'SpO2')
    .replace(/\bsleep h\b/g, 'sleep duration').replace(/\bcore temp\b/g, 'core temperature')
    .replace(/\bexercise min\b/g, 'exercise')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
