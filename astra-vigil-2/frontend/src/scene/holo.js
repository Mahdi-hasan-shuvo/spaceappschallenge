import * as THREE from 'three'
import { useEffect, useRef, useState } from 'react'

export const FONT = new URL('rajdhani-600.woff', document.baseURI).href
export const FONT_HEAD = new URL('orbitron-600.woff', document.baseURI).href

export const CYAN = new THREE.Color('#3ef0d2')
export const RED = new THREE.Color('#ff3d6e')

const vert = /* glsl */ `
  uniform float uTime; uniform float uGlitch;
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float band = step(0.985, fract(sin(floor(wp.y * 18.0 + uTime * 6.0) * 91.7) * 437.5));
    wp.x += band * uGlitch * 0.07 * sin(uTime * 40.0 + wp.y * 30.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`
const frag = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uAlertColor; uniform float uAlert; uniform float uTime;
  uniform float uScan; uniform float uOpacity; uniform float uFres;
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uFres);
    float scan = 0.55 + 0.45 * sin(vW.y * 90.0 - uTime * 4.0);
    float sweep = exp(-pow((vW.y - uScan) * 9.0, 2.0));
    float flick = 0.93 + 0.07 * sin(uTime * 37.0 + vW.y * 5.0);
    vec3 base = mix(uColor, uAlertColor, uAlert);
    float a = (0.08 + fres * 0.85) * scan * flick + sweep * 0.55;
    vec3 col = base * (0.45 + fres * 1.9) + vec3(1.0) * sweep * 0.5;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uOpacity);
  }`

export function makeHoloMaterial({ color = '#3ef0d2', opacity = 1, fres = 2.2 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag,
    uniforms: {
      uTime: { value: 0 }, uGlitch: { value: 0 }, uAlert: { value: 0 }, uScan: { value: 0 },
      uColor: { value: new THREE.Color(color) }, uAlertColor: { value: new THREE.Color('#ff2a5c') },
      uOpacity: { value: opacity }, uFres: { value: fres },
    },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
  })
}

// Return `value`, but update at most once per `ms`. Keeps 3D text re-layout cheap at high replay speed.
export function useThrottled(value, ms = 250) {
  const [v, setV] = useState(value)
  const last = useRef(0)
  const timer = useRef()
  useEffect(() => {
    const wait = Math.max(0, ms - (performance.now() - last.current))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { last.current = performance.now(); setV(value) }, wait)
    return () => clearTimeout(timer.current)
  }, [value, ms])
  return v
}

export const smooth = (a, b, t) => a + (b - a) * Math.min(1, t)
