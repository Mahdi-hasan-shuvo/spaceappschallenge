import { Component, Suspense, useEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { makeHoloMaterial } from './holo'
import { HOTSPOTS, hotspotWorld } from './anatomy'
import ProceduralAstronaut from './ProceduralAstronaut'
import { useStore } from '../store'
import { STATUS_COLOR } from '../util'

export { HOTSPOTS, hotspotWorld }

// A real, photographic-quality human astronaut (Apollo-style EVA suit, PBR textures), shipped inside the app.
// It is lit like a normal object and then "projected" as a hologram: tinted, scan-lined, with a fresnel shell on top.
const MODEL_URL = new URL('models/astronaut.glb', document.baseURI).href

// Shared uniforms: every material of the suit reads these.
function makeUniforms() {
  return {
    uTime: { value: 0 }, uHolo: { value: 0.5 }, uReveal: { value: 0 }, uScan: { value: 0 }, uPulse: { value: 0 },
    uAlert: { value: 0 }, uHoloColor: { value: new THREE.Color('#3ef0d2') }, uAlertColor: { value: new THREE.Color('#ff2a5c') },
  }
}

function patchMaterial(mat, U) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHoloY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvHoloY = (modelMatrix * vec4(transformed, 1.0)).y;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vHoloY;
        uniform float uTime; uniform float uHolo; uniform float uReveal; uniform float uScan; uniform float uPulse; uniform float uAlert;
        uniform vec3 uHoloColor; uniform vec3 uAlertColor;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vHoloY > uReveal) discard;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        {
          float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
          vec3 tint = mix(uHoloColor, uAlertColor, uAlert);
          float lines = 0.80 + 0.20 * sin(vHoloY * 220.0 - uTime * 3.0);
          float sweep = exp(-pow((vHoloY - uScan) * 9.0, 2.0));
          float edge = exp(-pow((vHoloY - uReveal) * 14.0, 2.0));
          vec3 holo = tint * (0.18 + lum * 1.9) * lines;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, holo, clamp(uHolo + uAlert * 0.6, 0.0, 0.92));
          gl_FragColor.rgb += tint * (sweep * 0.7 + edge * 2.5 + uPulse * 0.22);
        }`)
  }
  mat.customProgramCacheKey = () => 'astra-holo-suit'
  mat.needsUpdate = true
}

function Suit({ children }) {
  const gltf = useLoader(GLTFLoader, MODEL_URL)
  const gl = useThree((s) => s.gl)
  const group = useRef()
  const U = useMemo(makeUniforms, [])
  const shellMat = useMemo(() => makeHoloMaterial({ color: '#3ef0d2', opacity: 0.55, fres: 2.4 }), [])
  const scene = useMemo(() => gltf.scene, [gltf])
  const subject = useStore((s) => s.subject)
  const revealT = useRef(0)

  useEffect(() => {
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy())
    const shells = []
    const found = []
    scene.traverse((o) => { if (o.isMesh) found.push(o) })
    found.forEach((o) => {
      o.frustumCulled = false
      const m = o.material
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].anisotropy = aniso
      m.envMapIntensity = 0.9
      patchMaterial(m, U)
      const shell = new THREE.Mesh(o.geometry, shellMat)
      shell.renderOrder = 4
      shell.frustumCulled = false
      o.add(shell); shells.push([o, shell])
    })
    // Put each hotspot dot on the real suit surface: cast a ray from the front.
    scene.updateMatrixWorld(true)
    const rc = new THREE.Raycaster()
    for (const [s, h] of Object.entries(HOTSPOTS)) {
      rc.set(new THREE.Vector3(h.p[0], h.p[1], 3), new THREE.Vector3(0, 0, -1))
      const meshes = []
      scene.traverse((o) => { if (o.isMesh && o.material !== shellMat) meshes.push(o) })
      const hit = rc.intersectObjects(meshes, false).find((x) => x.object.material !== shellMat)
      if (hit) h.p[2] = hit.point.z + 0.03
    }
    return () => { shells.forEach(([o, sh]) => o.remove(sh)); shellMat.dispose() }
  }, [scene, gl, U, shellMat])

  // Re-materialise whenever a different crew member is selected.
  useEffect(() => { revealT.current = 0 }, [subject])

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    const st = useStore.getState()
    const flash = st.flash
    const age = flash ? (performance.now() - flash.t) / 1000 : 99
    const crew = st.crew.find((c) => c.id === st.subject)
    const status = crew?.status || 'learning'
    const target = age < 6 ? Math.max(0.35, 1 - age / 6) : status === 'alert' ? 0.45 : status === 'watch' ? 0.18 : 0
    revealT.current += dt
    U.uTime.value = t
    U.uReveal.value = revealT.current < 0.2 ? 0 : Math.min(2.6, (revealT.current - 0.2) * 1.25)
    U.uAlert.value += (target - U.uAlert.value) * 0.08
    U.uScan.value = ((t * 0.4) % 2.6) * 1.0
    const holoWant = st.look === 'real' ? 0.0 : 0.5
    U.uHolo.value += (holoWant - U.uHolo.value) * 0.08
    // heartbeat: the pulse follows the person's own heart rate (crew view only)
    let beat = 0
    const v = st.series?.data?.hr
    if (v && st.role === 'crew' && st.subject === st.viewer && v.v.length) {
      beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * (v.v[v.v.length - 1] / 60))), 10)
    }
    U.uPulse.value = beat * (st.look === 'real' ? 0.4 : 1)
    shellMat.uniforms.uTime.value = t
    shellMat.uniforms.uAlert.value = U.uAlert.value
    shellMat.uniforms.uGlitch.value = age < 1.8 ? 1 - age / 1.8 : 0
    shellMat.uniforms.uScan.value = U.uScan.value
    shellMat.uniforms.uOpacity.value = (st.look === 'real' ? 0.18 : 0.55) * Math.min(1, U.uReveal.value / 1.0 + 0.2)
    if (group.current) {
      // gentle zero-g float
      group.current.position.y = 0.03 + Math.sin(t * 1.1) * 0.014
      group.current.rotation.y = Math.sin(t * 0.35) * 0.06
      group.current.rotation.z = Math.sin(t * 0.5 + 1) * 0.012
      group.current.position.x = age < 1.2 ? Math.sin(t * 60) * 0.012 * (1 - age / 1.2) : 0
    }
  })

  return <group ref={group}><primitive object={scene} />{children}</group>
}

class Boundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e) { console.error('astronaut model failed, using fallback', e) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export default function Astronaut({ children }) {
  return (
    <Boundary fallback={<ProceduralAstronaut>{children}</ProceduralAstronaut>}>
      <Suspense fallback={null}>
        <Suit>{children}</Suit>
      </Suspense>
    </Boundary>
  )
}
