# Credits and third-party assets

## Astronaut model (`frontend/public/models/astronaut.glb`)
A photographic-quality Apollo-style EVA spacesuit (about 43,000 vertices, PBR textures), taken from the Google
`model-viewer` project's `shared-assets` (https://github.com/google/model-viewer, file `NeilArmstrong.glb`; that repository is
Apache-2.0). The textures were resized (2048 px colour/normal, 1024 px lighting maps) and re-packed for headset memory.

**Provenance caveat:** that repository does not state the original author or licence of this particular model.
It looks like a NASA / Smithsonian-style Apollo suit asset, but that is not confirmed. Before publishing the project
publicly or entering it as a submission artefact, confirm the licence, or replace the file with a model you hold the rights
to (any glTF/GLB human astronaut, about 1.9 m tall, feet at y = 0, facing +z; the loader and hologram shader work on any
standard PBR material). If the file is missing or fails to load, the app falls back to a simple procedural astronaut.

## Crew portraits (`crew_photos/`)
`niloy.jpg`, `puja.jpg`, `dhiraj.jpg`, `tusar.jpg` are portrait images supplied by the team (Team MANTA) for this demo and cropped to 3:4.
Replace or add files there (same names); they are served as-is and never uploaded anywhere.

## Other
* NASA OSDR / NTRS record metadata, cited by identifier in the evidence panel.
* Fonts: Orbitron and Rajdhani via `@fontsource` (SIL OFL). Controller models: `@webxr-input-profiles/assets` (MIT).
* Libraries: three.js, React Three Fiber / drei / xr / postprocessing, Framer Motion, Zustand, IWER (Meta Quest emulator).
* Project code: Niloy Bhattacharjee, Team MANTA, Apache-2.0 (see `LICENSE`).
