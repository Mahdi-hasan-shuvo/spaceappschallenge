import { createXRStore } from '@react-three/xr'

// Real headset: the browser's own WebXR is used (Meta Quest Browser etc.).
// No headset: `ensureEmulator()` installs a Meta Quest 3 emulator (IWER) so VR mode can still be tried on a desktop.
export const xrStore = createXRStore({
  emulate: false,
  // Controller models are served from this app (public/xr-profiles), never from a CDN.
  baseAssetPath: new URL('xr-profiles/', document.baseURI).href,
  defaultControllerProfileId: 'generic-trigger',
  controller: { rayPointer: { rayModel: { color: '#3ef0d2' } } },
  hand: { model: false },
  offerSession: false,
})

let emu = null
export async function ensureEmulator() {
  if (emu) return emu
  const [{ XRDevice, metaQuest3 }, { DevUI }] = await Promise.all([import('iwer'), import('@iwer/devui')])
  const dev = new XRDevice(metaQuest3)
  dev.ipd = 0
  dev.installRuntime({ forceInstall: true })
  dev.installDevUI(DevUI)
  emu = dev
  window.__astraXRDevice = dev
  return dev
}

export async function nativeVrSupported() {
  try {
    if (emu) return false
    return !!(await navigator.xr?.isSessionSupported('immersive-vr'))
  } catch { return false }
}

export async function enterVR() {
  if (!(await nativeVrSupported())) await ensureEmulator()
  return xrStore.enterVR()
}
