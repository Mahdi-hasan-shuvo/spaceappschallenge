import { useEffect, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { XR, XROrigin, useXR } from '@react-three/xr'
import { Environment as DreiEnv, Lightformer } from '@react-three/drei'
import { Bloom, ChromaticAberration, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { useStore } from '../store'
import { xrStore } from './xr'
import Environment from './Environment'
import Astronaut from './Astronaut'
import Hotspots from './Hotspots'
import DataRing from './DataRing'
import AlertFX from './AlertFX'
import CameraRig from './CameraRig'
import SpatialUI from './SpatialUI'
import VRCabin from './VRCabin'
import Station from './Station'
import { CrewWall } from './CrewCard3D'
import { START, SuitFrame, VRRig } from './VRRig'

function Effects() {
  const ca = useRef()
  useFrame(() => {
    const f = useStore.getState().flash
    const age = f ? (performance.now() - f.t) / 1000 : 99
    const k = age < 1.4 ? (1 - age / 1.4) : 0
    if (ca.current) ca.current.offset.set(0.0006 + k * 0.006, 0.0004 + k * 0.004)
  })
  return (
    <EffectComposer multisampling={0} disableNormalPass>
      <Bloom intensity={0.7} luminanceThreshold={0.55} luminanceSmoothing={0.3} mipmapBlur radius={0.72} />
      <ChromaticAberration ref={ca} offset={new THREE.Vector2(0.0006, 0.0004)} radialModulation={false} modulationOffset={0} />
      <Vignette eskil={false} offset={0.25} darkness={0.8} />
    </EffectComposer>
  )
}

// Lights for the real (PBR) astronaut. The reflection environment is built from local light panels: no HDR download.
function Lighting() {
  return (
    <>
      <DreiEnv resolution={256} frames={1} environmentIntensity={0.9}>
        <color attach="background" args={['#050b12']} />
        <Lightformer form="rect" intensity={2.4} color="#dff6ff" position={[0, 4, 3]} scale={[8, 2.5, 1]} />
        <Lightformer form="rect" intensity={1.5} color="#3ef0d2" position={[-5, 1, 1]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#4aa8ff" position={[5, 2, -2]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} />
        <Lightformer form="ring" intensity={1.6} color="#ffffff" position={[0, 1, -6]} scale={5} />
      </DreiEnv>
      <ambientLight intensity={0.25} color="#8fd8ff" />
      <directionalLight position={[2.5, 4, 3.5]} intensity={2.2} color="#eef9ff" />
      <directionalLight position={[-3, 2, -3]} intensity={1.6} color="#3ef0d2" />
      <pointLight position={[0, 0.2, 1.6]} intensity={1.2} distance={5} color="#3ef0d2" />
    </>
  )
}

function Content() {
  const session = useXR((s) => s.session)
  const spatial = useStore((s) => s.spatial)
  const setVr = useStore((s) => s.setVr)
  useEffect(() => { setVr(!!session) }, [session, setVr])
  const origin = useRef()
  const exit = () => { if (session) session.end().catch(() => {}); else useStore.getState().setSpatial(false) }
  return (
    <>
      <Environment />
      <Lighting />
      {session && <VRCabin />}
      {session && <CrewWall />}
      {!session && <Station />}
      <SuitFrame>
        <Astronaut>
          <Hotspots />
        </Astronaut>
        <DataRing />
        <AlertFX />
      </SuitFrame>
      {(spatial || session) && <SpatialUI onExit={exit} vr={!!session} />}
      <XROrigin ref={origin} position={START.toArray()} />
      {session && <VRRig originRef={origin} />}
      <CameraRig spatial={spatial} />
      {!session && <Effects />}
    </>
  )
}

export default function Scene() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0.3, 1.5, 3.2], fov: 42, near: 0.05, far: 400 }}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
      onCreated={({ gl }) => { gl.setClearColor('#02060d') }}
    >
      <XR store={xrStore}>
        <Content />
      </XR>
    </Canvas>
  )
}
