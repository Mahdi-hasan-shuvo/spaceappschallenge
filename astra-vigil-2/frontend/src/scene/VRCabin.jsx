import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'

// The immersive part of VR: a round mission-control cabin around the astronaut's hologram pedestal.
// Wall panels, three observation windows (one faces Earth), a floor grid, a ceiling ring and a floor status strip that
// turns red when an alert is active. Everything is procedural shader work: no textures, no downloads, light on a headset GPU.
const R = 6.5          // cabin radius (m)
const H = 4.4          // cabin height (m)
const EARTH_THETA = Math.atan2(17, -38) // azimuth of the Earth in Environment.jsx (cylinder theta: x = sin, z = cos)

const wallVert = /* glsl */ `
  varying vec2 vUv; varying vec3 vW;
  void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`
const wallFrag = /* glsl */ `
  precision highp float;
  uniform float uTime; uniform float uAlert; uniform float uEarth;
  varying vec2 vUv; varying vec3 vW;
  const float PI = 3.14159265;
  float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    float th = vUv.x * 2.0 * PI;
    float y = vUv.y * ${H.toFixed(2)};
    vec3 cyan = vec3(0.24, 0.94, 0.82);
    vec3 red = vec3(1.0, 0.16, 0.36);
    vec3 acc = mix(cyan, red, uAlert * (0.65 + 0.35 * sin(uTime * 6.0)));

    // windows: three, 120 degrees apart, one centred on the Earth
    float best = 1e9; float wd = 0.0;
    for (int k = 0; k < 3; k++) {
      float c = ${EARTH_THETA.toFixed(5)} + float(k) * 2.0 * PI / 3.0;
      float dth = mod(th - c + PI, 2.0 * PI) - PI;
      vec2 p = vec2(dth * ${R.toFixed(2)}, y - 2.45);
      float d = sdRound(p, vec2(${(R * 0.5).toFixed(2)} * 0.62, 1.1), 0.5);
      if (d < best) best = d;
    }
    if (best < 0.0) discard;

    // panelled wall
    float panels = 18.0;
    float u = fract(vUv.x * panels);
    float seamV = smoothstep(0.012, 0.0, min(u, 1.0 - u));
    float seamH = smoothstep(0.012, 0.0, abs(y - 1.3)) + smoothstep(0.012, 0.0, abs(y - 3.9));
    float pid = floor(vUv.x * panels);
    float tone = 0.7 + 0.5 * hash(vec2(pid, 1.0));
    vec3 col = vec3(0.075, 0.125, 0.17) * tone + vec3(0.02, 0.05, 0.07) * smoothstep(0.0, 1.0, 1.0 - abs(vUv.y - 0.5) * 2.0);
    col += vec3(0.0, 0.015, 0.02) * sin(y * 120.0) * 0.3;
    col += acc * (seamV * 0.45 + seamH * 0.8);

    // window frame glow
    float frame = smoothstep(0.16, 0.0, best) * 1.2 + smoothstep(0.5, 0.0, best) * 0.12;
    col += acc * frame;

    // floor status strip with moving chevrons
    float strip = smoothstep(0.02, 0.0, abs(y - 0.22) - 0.09);
    float chev = step(0.5, fract(vUv.x * 120.0 + y * 6.0 - uTime * (0.6 + uAlert * 2.0)));
    col += acc * strip * (0.35 + 0.55 * chev);

    // soft vertical falloff: darker toward the ceiling
    col *= 0.75 + 0.25 * (1.0 - vUv.y);
    gl_FragColor = vec4(col, 1.0);
  }`

const floorFrag = /* glsl */ `
  uniform float uTime; uniform float uAlert; varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0; float r = length(p);
    if (r > 1.0) discard;
    vec3 acc = mix(vec3(0.24, 0.94, 0.82), vec3(1.0, 0.16, 0.36), uAlert);
    vec2 q = p * ${R.toFixed(1)} * 0.5;                       // 1 cell = 1 m
    vec2 gd = min(fract(q), 1.0 - fract(q));
    float grid = 1.0 - smoothstep(0.0, 0.025, min(gd.x, gd.y));
    float rd = r * ${(R / 1.5).toFixed(2)};
    float rings = 1.0 - smoothstep(0.0, 0.02, min(fract(rd), 1.0 - fract(rd)));
    float edge = smoothstep(0.015, 0.0, abs(r - 0.985));
    float fade = smoothstep(1.0, 0.1, r);
    vec3 col = vec3(0.025, 0.055, 0.075) + acc * (grid * 0.16 * fade + rings * 0.25 + edge * 0.9);
    gl_FragColor = vec4(col, 1.0);
  }`
const flatVert = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

export default function VRCabin() {
  const wall = useRef(), floor = useRef(), ceil = useRef()
  const ringMat = useRef()
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uAlert: { value: 0 }, uEarth: { value: 1 } }), [])
  const floorU = useMemo(() => ({ uTime: { value: 0 }, uAlert: { value: 0 } }), [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const st = useStore.getState()
    const c = st.crew.find((x) => x.id === st.subject)
    const f = st.flash
    const age = f ? (performance.now() - f.t) / 1000 : 99
    const want = age < 8 ? 1 : c?.status === 'alert' ? 0.7 : c?.status === 'watch' ? 0.18 : 0
    uniforms.uTime.value = t
    uniforms.uAlert.value += (want - uniforms.uAlert.value) * 0.06
    floorU.uTime.value = t
    floorU.uAlert.value = uniforms.uAlert.value
    if (ringMat.current) ringMat.current.color.set('#3ef0d2').lerp(new THREE.Color('#ff2a5c'), uniforms.uAlert.value)
  })
  return (
    <group>
      <mesh position={[0, H / 2, 0]}>
        <cylinderGeometry args={[R, R, H, 96, 1, true]} />
        <shaderMaterial ref={wall} vertexShader={wallVert} fragmentShader={wallFrag} uniforms={uniforms} side={THREE.BackSide} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.004, 0]}>
        <planeGeometry args={[R * 2, R * 2]} />
        <shaderMaterial ref={floor} vertexShader={flatVert} fragmentShader={floorFrag} uniforms={floorU} toneMapped={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, H, 0]}>
        <circleGeometry args={[R, 64]} />
        <meshBasicMaterial ref={ceil} color="#040b12" toneMapped={false} />
      </mesh>
      {[2.6, 4.4].map((r) => (
        <mesh key={r} rotation={[Math.PI / 2, 0, 0]} position={[0, H - 0.02, 0]}>
          <torusGeometry args={[r, 0.035, 8, 120]} />
          <meshBasicMaterial ref={r === 2.6 ? ringMat : undefined} color="#3ef0d2" toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}
