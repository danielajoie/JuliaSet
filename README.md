# Quaternion Julia Set

Real-time **3D Quaternion Julia set** in the browser — GPU distance-estimator ray marching, continuous morphing of the Julia parameter \(c\), mouse orbit, and an on-screen GUI.

**Live demo:** [https://danielajoie.github.io/JuliaSet/](https://danielajoie.github.io/JuliaSet/)

\[
q_{n+1} = q_n^2 + c,\quad q,c \in \mathbb{H}
\]

Free, MIT-licensed. Three.js `0.170.0` and lil-gui `0.19.2` are **vendored** (no CDN) so the demo works offline once loaded and on GitHub Pages without third-party script hosts.

## Try it

Open the [live demo](https://danielajoie.github.io/JuliaSet/) in a modern WebGL browser (Chrome, Edge, Firefox, Safari). Drag to orbit, scroll to zoom, Space to pause morphing.

## Run locally

Serve the folder over HTTP — opening `index.html` via `file://` may be blocked by the browser (ES modules).

```bash
# from this directory
npx --yes serve .

# or
python -m http.server 8080

# or
npx --yes http-server -p 8080
```

Then open the URL shown (e.g. `http://localhost:3000` or `:8080`).

**Requirements:** a modern browser with WebGL (Chrome, Edge, Firefox, Safari).

### Controls

| Input | Action |
|--------|--------|
| Left-drag | Orbit camera |
| Scroll | Zoom |
| Right-drag | Pan |
| **Space** | Pause / resume morphing |
| **R** | Reset camera |
| **O** | Toggle auto-orbit |

## Math & rendering (short)

- Sample each 3D point as a quaternion \((x,y,z,w_{\text{slice}})\).
- Iterate \(q \leftarrow q^2 + c\) with Hamilton multiplication (optimized square).
- Track derivative magnitude \(dr \leftarrow 2|q|\,dr\) and use the Hubbard–Douady / Hart distance estimate:

  \[
  \mathrm{DE} \approx \tfrac12 \cdot |q|\cdot\log|q|\,/\,dr
  \]

- Sphere-trace each pixel ray through this DE field; shade with DE normals, soft shadows, ambient occlusion, and orbit-trap coloring.

## Interesting values of \(c\)

Load these from the **Presets** folder in the GUI, or type them into the sliders:

| Name | \( (c_r, c_i, c_j, c_k) \) | Look |
|------|---------------------------|------|
| Classic Blob | `(-0.2, 0.6, 0.2, 0.2)` | Rounded organic default |
| Twisted | `(-0.125, -0.256, 0.847, 0.0895)` | Long twisted arms |
| Double | `(0.285, 0.01, 0.0, 0.0)` | Extruded classic Julia |
| Spiky | `(-0.4, 0.6, 0.0, 0.0)` | Sharp filaments |
| Soft Cross | `(0.18, 0.4875, 0.02, 0.02)` | Cross-like lobes |
| Ghost | `(-0.08, 0.0, 0.85, 0.0)` | Thin sheets |
| Coral | `(-0.291, -0.399, 0.339, 0.437)` | Branching structure |
| Pearl | `(-0.162, 0.163, 0.56, -0.599)` | Compact folds |

Also try sliding **4D slice W** — small changes reveal different 3D cross-sections of the same 4D set. Enable **Cut plane** to open the interior.

## Auto-scroll c

In the **Auto-scroll c** folder, each of `cr`, `ci`, `cj`, `ck` can independently sweep the full slider range **[-1.5, 1.5]**:

| Control | What it does |
|---------|----------------|
| **Auto cr / ci / cj / ck** | Toggle ping-pong scan for that component |
| **Speed …** | How fast that component moves (0 = freeze; low values are very slow sweeps) |
| **Pause all** | Freeze every auto-scroll without clearing toggles |

- Motion is **ping-pong** (min → max → min), no hard jump at the ends.
- Enabling auto starts from the **current** slider value (no pop).
- Auto **replaces** morph on that axis while enabled.
- Loading a **shape preset** turns all auto toggles **off** so the preset stays stable.

## Look presets & color

In the **Appearance** folder:

| Control | What it does |
|---------|----------------|
| **Look preset** | High-contrast model + background pairs (Neon Void, Ember Night, Ocean Depth, Silver Studio, Aurora Dark, Solar Eclipse, Ice Cave) |
| **Color scheme** | Model palette only (Ember, Ocean, Neon, Mono, Aurora, Solar, Ice) |
| **Animate color** | Cycles the model hue over time (HSV); glow/rim follow |
| **Color speed** | How fast the color animation runs |

Default look is **Neon Void** (bright neon solid on near-black).

## Performance & quality

Target: **30–60 FPS** on a mid-range laptop/desktop.

| Goal | What to change |
|------|----------------|
| **More FPS** | Lower *Resolution*, *Ray steps* (e.g. 48–64), *Iterations* (8–10); disable cut plane |
| **More detail** | Raise *Iterations* (14–20), *Ray steps* (100–140), *Hit precision*; set *Resolution* to 1.0 |
| **Smoother silhouettes** | Higher ray steps + slightly lower epsilon (hit precision) |

Defaults are balanced for beauty and smoothness. The heaviest cost is Julia iterations × march steps × pixels.

## Project layout

```
index.html          Entry page + import map + social meta
favicon.svg         Site icon
og-image.png        Open Graph / Twitter card image (1200×630)
css/styles.css      Full-viewport dark UI
js/main.js          GUI, morphing, auto-orbit, loop
js/renderer.js      Three.js scene, camera, uniforms
js/shaders.js       GLSL vertex + fragment (DE ray-march)
js/quaternion.js    CPU quaternion math, presets, self-check
vendor/three/       Three.js 0.170.0 (module + OrbitControls)
vendor/lil-gui/     lil-gui 0.19.2 (ESM)
LICENSE             MIT
README.md
```

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Dan Lajoie.
