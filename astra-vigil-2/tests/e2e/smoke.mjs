// Browser smoke test: the demo beat, offline. Run with the server on http://localhost:8000
//   npm i playwright && node smoke.mjs
import { chromium } from 'playwright'

const BASE = process.env.ASTRA_URL || 'http://localhost:8000'
const post = (u, b) => fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } })
const errors = [], external = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(e.message))
const origin = new URL(BASE).origin.replace('http', 'ws')
page.on('request', (r) => {
  const u = r.url()
  if (!u.startsWith(BASE) && !u.startsWith(origin) && !/^(data|blob):/.test(u)) external.push(u)
})

const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1 }
await post('/api/control', { action: 'reset' })
await page.goto(BASE, { waitUntil: 'load' })

// --- intro: four named crew cards, photos from crew_photos/, a Start button (not "Play")
await page.waitForSelector('.intro .icard', { timeout: 20000 })
const names = (await page.locator('.intro .ic-name').allInnerTexts()).map((x) => x.trim())
if (names.join(',') !== 'Niloy,Puja,Dhiraj,Tusar') fail('intro crew names: ' + names)
await page.waitForFunction(() => [...document.querySelectorAll('.intro .ic-photo img')].filter((i) => i.complete && i.naturalWidth > 0).length === 4, null, { timeout: 15000 })
console.log('ok: intro shows Niloy, Puja, Dhiraj, Tusar; 4 portraits loaded')
if (await page.locator('.intro .ic-photo .avatar').count() !== 0) fail('a crew member fell back to the avatar although all four photos exist')
const startLabel = (await page.getByTestId('start-mission').innerText()).trim()
if (!/start/i.test(startLabel)) fail('intro button label: ' + startLabel)

// --- offline sound render: every effect must be audible, finite and not clipping
const snd = await page.evaluate(async () => {
  const names = ['click', 'hover', 'select', 'toggleOn', 'toggleOff', 'pause', 'resume', 'start', 'alert', 'chime', 'ping', 'whoosh', 'error']
  const out = {}
  for (const n of names) {
    const ctx = new OfflineAudioContext(1, 44100 * 3, 44100)
    const sfx = window.__astraMakeSfx(ctx, ctx.destination)
    sfx[n](0.05)
    const buf = await ctx.startRendering()
    const d = buf.getChannelData(0)
    let peak = 0, bad = 0
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (!Number.isFinite(v)) bad++; else if (v > peak) peak = v }
    out[n] = { peak: +peak.toFixed(3), bad }
  }
  return out
})
for (const [n, r] of Object.entries(snd)) {
  if (r.bad || r.peak < 0.01 || r.peak > 1.0) fail(`sound ${n}: ${JSON.stringify(r)}`)
}
console.log('ok: 13 sound effects render audible, finite, unclipped:', Object.entries(snd).map(([n, r]) => `${n}=${r.peak}`).join(' '))

await page.screenshot({ path: process.env.ASTRA_SHOTS ? process.env.ASTRA_SHOTS + '/intro.png' : undefined })
await page.getByTestId('start-mission').click()
await page.waitForSelector('.intro', { state: 'detached', timeout: 8000 })
await page.waitForSelector('.sim-badge')
if (!(await page.locator('.sim-badge').innerText()).includes('SIMULATED DATA')) fail('missing SIMULATED DATA badge')
const running = await page.evaluate(() => window.__astraAudio?.state)
if (running !== 'running') fail('AudioContext not running after Start: ' + running)
console.log('ok: Start unlocked audio (AudioContext running)')

// --- transport: Pause while running, Resume after, never "Play"
const main = page.getByTestId('transport-main')
await page.waitForFunction(() => document.querySelector('[data-testid=transport-main]')?.innerText.trim().toLowerCase() === 'pause', null, { timeout: 8000 })
await main.click()
await page.waitForFunction(() => document.querySelector('[data-testid=transport-main]')?.innerText.trim().toLowerCase() === 'resume', null, { timeout: 8000 })
if (/play/i.test(await page.locator('.transport').innerText())) fail('a "Play" label is still on the transport')
console.log('ok: Start flow Pause/Resume labels, no "Play"')
// crew rail has the four photos / names
const chips = (await page.locator('.crew-chip .cc-name').allInnerTexts()).map((x) => x.replace('★', '').trim())
if (chips.join(',') !== 'Niloy,Puja,Dhiraj,Tusar') fail('crew rail names: ' + chips)
await post('/api/control', { action: 'reset' })

await page.getByText('Rehearse demo beat').click()
await page.waitForSelector('.alert-banner', { timeout: 40000 })
console.log('ok: alert banner appeared')
await page.waitForSelector('.drawer', { timeout: 10000 })
console.log('ok: evidence drawer opened')
const evCards = await page.locator('.ev-card').count()
if (evCards < 1) fail('no evidence cards')

await page.locator('.drawer .btn.ghost').click()
await page.getByRole('tab', { name: /assistant/i }).click()
await page.locator('.ask input').fill('Do I have a disease? What should I take?')
await page.locator('.ask .btn').click()
await page.waitForSelector('.msg.ai.boundary', { timeout: 8000 })
console.log('ok: medical question got the boundary reply')

// 1 Hz rehearsal stream: jump to 10 s before the planted anomaly, expect the rule, numbers and a cited record
await page.getByRole('tab', { name: /rehearsal/i }).click()
await page.getByRole('button', { name: /Jump to 10 s before/ }).click()
await page.locator('.tab-body .alert-card').first().waitFor({ timeout: 20000 })
const rh = await page.locator('.tab-body').innerText()
if (!/SIMULATED DATA/.test(rh)) fail('rehearsal tab missing SIMULATED DATA label')
if (!/Planted at sample 420/.test(rh)) fail('rehearsal tab missing the planted index')
await page.locator('.tab-body .alert-card').first().click()
await page.waitForSelector('.tab-body .a-expl', { timeout: 5000 })
const ex = await page.locator('.tab-body .a-expl').first().innerText()
if (!/No diagnosis is made/.test(ex) || !/https:\/\//.test(ex)) fail('rehearsal explanation lacks the boundary line or a cited URL')
console.log('ok: rehearsal stream raised an alert at the planted beat with a cited record')

await post('/api/control', { action: 'pause' })
if (external.length) fail('external requests: ' + external.join(', '))
if (errors.length) fail('console errors: ' + errors.join(' | '))
console.log(process.exitCode ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED')
await browser.close()
