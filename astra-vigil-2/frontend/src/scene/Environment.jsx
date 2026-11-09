import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../store'

// ---------------------------------------------------------------- stars
const starVert = /* glsl */ `
  attribute float aSize; attribute float aPh; uniform float uTime; varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (0.75 + 0.25 * sin(uTime * 1.5 + aPh)) * (220.0 / -mv.z);
    vA = 0.5 + 0.5 * sin(uTime * 1.2 + aPh * 3.0);
    gl_Position = projectionMatrix * mv;
  }`
const starFrag = /* glsl */ `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(0.75, 0.9, 1.0), a * (0.35 + 0.65 * vA));
  }`

export function Stars({ count = 2600 }) {
  const mat = useRef()
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3), size = new Float32Array(count), ph = new Float32Array(count)
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = 70 + rnd() * 60
      const s = Math.sqrt(1 - u * u)
      pos.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a)], i * 3)
      size[i] = 0.6 + Math.pow(rnd(), 4) * 4
      ph[i] = rnd() * 6.28
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1))
    return g
  }, [count])
  const ref = useRef()
  useFrame(({ clock }) => {
    if (mat.current) mat.current.uniforms.uTime.value = clock.elapsedTime
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 0.004
  })
  return (
    <points ref={ref} geometry={geo} frustumCulled={false}>
      <shaderMaterial ref={mat} vertexShader={starVert} fragmentShader={starFrag} transparent depthWrite={false}
        blending={THREE.AdditiveBlending} uniforms={{ uTime: { value: 0 } }} toneMapped={false} />
    </points>
  )
}

// ---------------------------------------------------------------- Earth (procedural)
const noise = /* glsl */ `
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n3(p); p *= 2.03; a *= 0.5; } return s; }`
const earthVert = /* glsl */ `
  varying vec3 vP; varying vec3 vN; varying vec3 vW;
  void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`
const earthFrag = /* glsl */ `
  ${noise}
  uniform float uTime; uniform vec3 uSun; varying vec3 vP; varying vec3 vN; varying vec3 vW;
  void main(){
    vec3 p = normalize(vP);
    float land = smoothstep(0.52, 0.56, fbm(p * 2.6 + 3.0));
    float lat = abs(p.y);
    vec3 ocean = mix(vec3(0.02, 0.09, 0.28), vec3(0.04, 0.2, 0.5), fbm(p * 6.0));
    vec3 grass = mix(vec3(0.1, 0.32, 0.12), vec3(0.45, 0.4, 0.2), fbm(p * 5.0 + 9.0));
    vec3 col = mix(ocean, grass, land);
    col = mix(col, vec3(0.92, 0.96, 1.0), smoothstep(0.82, 0.92, lat));
    float cl = smoothstep(0.5, 0.78, fbm(p * 3.4 + vec3(uTime * 0.01, 0.0, uTime * 0.006)));
    col = mix(col, vec3(1.0), cl * 0.75);
    float dl = dot(normalize(vN), normalize(uSun));
    float day = smoothstep(-0.08, 0.25, dl);
    vec3 night = vec3(0.01, 0.02, 0.05) + land * vec3(1.0, 0.75, 0.35) * step(0.72, fbm(p * 14.0)) * 0.9 * (1.0 - cl);
    vec3 lit = col * (0.12 + 0.95 * max(dl, 0.0));
    vec3 outc = mix(night, lit, day);
    vec3 V = normalize(cameraPosition - vW);
    float rim = pow(1.0 - max(dot(normalize(vN), V), 0.0), 3.0);
    outc += vec3(0.25, 0.55, 1.0) * rim * (0.35 + 0.65 * smoothstep(-0.3, 0.4, dl));
    gl_FragColor = vec4(outc, 1.0);
  }`
const atmoFrag = /* glsl */ `
  uniform vec3 uSun; varying vec3 vN; varying vec3 vW;
  void main(){ vec3 V = normalize(cameraPosition - vW); float r = pow(1.0 - abs(dot(normalize(vN), V)), 2.5);
    float l = smoothstep(-0.4, 0.5, dot(normalize(vN), normalize(uSun)));
    gl_FragColor = vec4(vec3(0.3, 0.6, 1.0) * r * 1.6, r * (0.25 + 0.75 * l)); }`

export function Earth({ position = [17, 7, -38], radius = 7 }) {
  const m = useRef()
  const sun = useMemo(() => new THREE.Vector3(1, 0.35, 0.8), [])
  useFrame(({ clock }) => { if (m.current) m.current.uniforms.uTime.value = clock.elapsedTime })
  const ref = useRef()
  useFrame(({ clock }) => { if (ref.current) ref.current.rotation.y = clock.elapsedTime * 0.012 })
  return (
    <group position={position}>
      <mesh ref={ref} scale={radius}>
        <sphereGeometry args={[1, 96, 64]} />
        <shaderMaterial ref={m} vertexShader={earthVert} fragmentShader={earthFrag}
          uniforms={{ uTime: { value: 0 }, uSun: { value: sun } }} toneMapped={false} />
      </mesh>
      <mesh scale={radius * 1.06}>
        <sphereGeometry args={[1, 64, 48]} />
        <shaderMaterial vertexShader={earthVert} fragmentShader={atmoFrag} transparent depthWrite={false}
          blending={THREE.AdditiveBlending} side={THREE.BackSide} uniforms={{ uSun: { value: sun } }} toneMapped={false} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------- platform + light cone
const platFrag = /* glsl */ `
  uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
  void main(){
    vec2 p = vUv * 2.0 - 1.0; float r = length(p);
    float rings = smoothstep(0.03, 0.0, abs(fract(r * 6.0 - uTime * 0.15) - 0.5) - 0.46) * 0.5;
    vec2 g = abs(fract(p * 9.0) - 0.5); float grid = smoothstep(0.03, 0.0, min(g.x, g.y) - 0.47 + 0.02) * 0.35;
    float edge = smoothstep(0.02, 0.0, abs(r - 0.96)) * 1.2;
    float ang = atan(p.y, p.x); float ticks = step(0.8, fract(ang * 6.0 * 3.1831)) * smoothstep(0.1, 0.0, abs(r - 0.9)) * 0.9;
    float fade = smoothstep(1.0, 0.55, r);
    float a = (rings + grid * fade + edge + ticks) * smoothstep(1.0, 0.9, r) + fade * 0.025;
    gl_FragColor = vec4(uColor * (0.7 + edge * 0.6), a * 0.75);
  }`
const platVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const coneFrag = /* glsl */ `
  uniform vec3 uColor; uniform float uAlert; varying vec2 vUv;
  void main(){ float a = pow(1.0 - vUv.y, 2.6) * 0.11; vec3 c = mix(uColor, vec3(1.0, 0.2, 0.4), uAlert); gl_FragColor = vec4(c, a); }`

export function Platform() {
  const pm = useRef(), cm = useRef(), r1 = useRef(), r2 = useRef()
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const st = useStore.getState()
    const c = st.crew.find((x) => x.id === st.subject)
    const al = c?.status === 'alert' ? 1 : 0
    if (pm.current) {
      pm.current.uniforms.uTime.value = t
      pm.current.uniforms.uColor.value.lerp(new THREE.Color(al ? '#ff3d6e' : '#3ef0d2'), 0.05)
    }
    if (cm.current) cm.current.uniforms.uAlert.value += (al - cm.current.uniforms.uAlert.value) * 0.05
    if (r1.current) r1.current.rotation.z = t * 0.25
    if (r2.current) r2.current.rotation.z = -t * 0.18
  })
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <planeGeometry args={[4.4, 4.4]} />
        <shaderMaterial ref={pm} vertexShader={platVert} fragmentShader={platFrag} transparent depthWrite={false}
          blending={THREE.AdditiveBlending} uniforms={{ uTime: { value: 0 }, uColor: { value: new THREE.Color('#3ef0d2') } }} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.4, 0]}>
        <cylinderGeometry args={[0.95, 1.35, 2.8, 48, 1, true]} />
        <shaderMaterial ref={cm} vertexShader={platVert} fragmentShader={coneFrag} transparent depthWrite={false}
          side={THREE.DoubleSide} blending={THREE.AdditiveBlending}
          uniforms={{ uColor: { value: new THREE.Color('#2bd9ff') }, uAlert: { value: 0 } }} toneMapped={false} />
      </mesh>
      <mesh ref={r1} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <torusGeometry args={[1.25, 0.006, 8, 120, Math.PI * 1.5]} />
        <meshBasicMaterial color="#6ff6ff" toneMapped={false} />
      </mesh>
      <mesh ref={r2} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <torusGeometry args={[1.5, 0.004, 8, 120, Math.PI]} />
        <meshBasicMaterial color="#2b8fff" toneMapped={false} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------- floating data motes
export function Motes({ count = 140 }) {
  const ref = useRef()
  const { geo, seeds } = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    const seeds = Array.from({ length: count }, (_, i) => ({ a: (i * 2.399) % 6.283, r: 0.5 + ((i * 0.137) % 1) * 1.1, s: 0.05 + ((i * 0.071) % 1) * 0.12, o: (i * 0.53) % 2.6 }))
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return { geo: g, seeds }
  }, [count])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const p = geo.attributes.position.array
    seeds.forEach((s, i) => {
      const y = ((t * s.s + s.o) % 2.6)
      const a = s.a + t * 0.2
      p[i * 3] = Math.cos(a) * s.r
      p[i * 3 + 1] = y
      p[i * 3 + 2] = Math.sin(a) * s.r
    })
    geo.attributes.position.needsUpdate = true
    if (ref.current) ref.current.material.opacity = 0.7
  })
  return (
    <points ref={ref} geometry={geo} frustumCulled={false}>
      <pointsMaterial color="#8ff8ff" size={0.022} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} sizeAttenuation />
    </points>
  )
}

// ---------------------------------------------------------------- Earth link: packets in light-time transit
export function EarthLink({ from = [0, 2.2, 0], to = [17, 7, -38] }) {
  const refs = useRef([])
  const camera = useThree((st) => st.camera)
  const outbox = useStore((s) => s.outbox)
  const recent = useMemo(() => outbox.slice(-8), [outbox])
  const a = useMemo(() => new THREE.Vector3(...from), [from])
  const b = useMemo(() => new THREE.Vector3(...to).multiplyScalar(0.78), [to])
  const ctrl = useMemo(() => a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 3, 0)), [a, b])
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(a, ctrl, b), [a, ctrl, b])
  const pts = useMemo(() => curve.getPoints(40).map((p) => [p.x, p.y, p.z]), [curve])
  useFrame(() => {
    const st = useStore.getState()
    const now = Date.now() / 1000 + st.skew
    recent.forEach((o, i) => {
      const m = refs.current[i]
      if (!m) return
      const k = (now - o.queued_at) / Math.max(0.05, o.deliver_at - o.queued_at)
      if (k < 0 || (o.delivered && k > 1.15)) { m.visible = false; return }
      m.visible = true
      const p = curve.getPoint(Math.min(1, k))
      m.position.copy(p)
      const burst = k >= 1 ? 1 + (1.15 - Math.min(k, 1.15)) * 14 : 1
      m.scale.setScalar(0.009 * p.distanceTo(camera.position) * burst)
    })
  })
  return (
    <group>
      <Line points={pts} color="#2b8fff" lineWidth={1} transparent opacity={0.25} dashed dashSize={0.5} gapSize={0.4} toneMapped={false} />
      {recent.map((o, i) => (
        <mesh key={o.id} ref={(el) => { refs.current[i] = el }} visible={false}>
          <sphereGeometry args={[1, 12, 10]} />
          <meshBasicMaterial color={o.status === 'alert' ? '#ff3d6e' : o.status === 'watch' ? '#ffc247' : '#3ef0d2'} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

export default function Environment() {
  useEffect(() => { document.body.style.cursor = '' }, [])
  return (
    <>
      <color attach="background" args={['#02060d']} />
      <fog attach="fog" args={['#02060d', 40, 140]} />
      <Stars />
      <Earth />
      <Platform />
      <Motes />
      <EarthLink />
    </>
  )
}
