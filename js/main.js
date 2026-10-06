/**
 * Application entry: GUI, morphing, per-axis auto-scroll, auto-orbit, render loop.
 */

import GUI from "lil-gui";
import { JuliaRenderer } from "./renderer.js";
import { PRESETS, DEFAULT_C, selfCheck } from "./quaternion.js";

// Run CPU-side math sanity checks once
selfCheck();

const canvas = document.getElementById("canvas");
const fpsEl = document.getElementById("fps");

const renderer = new JuliaRenderer(canvas);

/** Slider / auto-scroll range for each c component */
const C_MIN = -1.5;
const C_MAX = 1.5;
const C_KEYS = ["cr", "ci", "cj", "ck"];

// ─── Shared parameters (bound to lil-gui + animation) ────────────────────────
const params = {
  // Base c — morphing / auto-scroll drive these
  cr: DEFAULT_C.x,
  ci: DEFAULT_C.y,
  cj: DEFAULT_C.z,
  ck: DEFAULT_C.w,

  // Per-axis auto-scroll through [C_MIN, C_MAX] (ping-pong)
  autoCr: true,
  autoCi: true,
  autoCj: true,
  autoCk: true,
  // UI speeds 0–2; actual phase rate is multiplied by AUTO_SPEED_SCALE (slow end is usable)
  autoSpeedCr: 0.35,
  autoSpeedCi: 0.35,
  autoSpeedCj: 0.35,
  autoSpeedCk: 0.35,
  autoScrollPaused: false,

  // Morph (small offsets; skipped on axes with auto-scroll on)
  morphSpeed: 0.35,
  morphAmplitude: 0.12,
  morphPaused: false,
  morphCi: true,
  morphCj: true,
  morphCk: true,

  // Camera
  autoOrbit: true,
  orbitSpeed: 0.12,

  // Quality
  maxIter: 11,
  maxSteps: 80,
  epsilon: 1.0,
  bailout: 8.0,
  resolutionScale: Math.min(window.devicePixelRatio || 1, 2) > 1.5 ? 0.85 : 1.0,

  // Appearance
  lookPreset: "Aurora Dark",
  colorScheme: "Neon",
  animateColor: false,
  colorAnimSpeed: 0.45,
  glowStrength: 1.15,
  aoStrength: 1.0,
  fogDensity: 0.75,

  // Slice
  sliceW: 0.0,
  sliceEnabled: false,
  sliceOffset: 0.0,
  sliceAxis: "X",

  // Presets
  preset: "Classic Blob",

  // Actions
  resetCamera() {
    renderer.resetCamera();
  },
  pauseMorph() {
    params.morphPaused = !params.morphPaused;
  },
};

const COLOR_MODES = {
  Ember: 0,
  Ocean: 1,
  Neon: 2,
  Mono: 3,
  Aurora: 4,
  Solar: 5,
  Ice: 6,
};

/**
 * High-contrast look presets: model palette + complementary dark background.
 * bgA = gradient bottom, bgB = gradient top (linear RGB ~0–1).
 */
const LOOK_PRESETS = {
  "Neon Void": {
    colorScheme: "Neon",
    bgA: [0.0, 0.0, 0.0],
    bgB: [0.05, 0.0, 0.1],
    glowStrength: 1.25,
    fogDensity: 0.65,
  },
  "Ember Night": {
    colorScheme: "Ember",
    bgA: [0.02, 0.01, 0.01],
    bgB: [0.08, 0.03, 0.02],
    glowStrength: 1.2,
    fogDensity: 0.7,
  },
  "Ocean Depth": {
    colorScheme: "Ocean",
    bgA: [0.0, 0.01, 0.03],
    bgB: [0.0, 0.04, 0.08],
    glowStrength: 1.1,
    fogDensity: 0.75,
  },
  "Silver Studio": {
    colorScheme: "Mono",
    bgA: [0.04, 0.04, 0.05],
    bgB: [0.1, 0.1, 0.12],
    glowStrength: 0.85,
    fogDensity: 0.55,
  },
  "Aurora Dark": {
    colorScheme: "Aurora",
    bgA: [0.01, 0.0, 0.04],
    bgB: [0.04, 0.02, 0.12],
    glowStrength: 1.2,
    fogDensity: 0.7,
  },
  "Solar Eclipse": {
    colorScheme: "Solar",
    bgA: [0.02, 0.01, 0.0],
    bgB: [0.07, 0.03, 0.01],
    glowStrength: 1.3,
    fogDensity: 0.65,
  },
  "Ice Cave": {
    colorScheme: "Ice",
    bgA: [0.0, 0.01, 0.04],
    bgB: [0.02, 0.05, 0.1],
    glowStrength: 1.05,
    fogDensity: 0.7,
  },
};

function applyLookPreset(name, controllers = {}) {
  const look = LOOK_PRESETS[name];
  if (!look) return;

  params.colorScheme = look.colorScheme;
  params.glowStrength = look.glowStrength;
  params.fogDensity = look.fogDensity;

  renderer.uniforms.uColorMode.value = COLOR_MODES[look.colorScheme];
  renderer.uniforms.uBgColorA.value.set(look.bgA[0], look.bgA[1], look.bgA[2]);
  renderer.uniforms.uBgColorB.value.set(look.bgB[0], look.bgB[1], look.bgB[2]);
  renderer.uniforms.uGlowStrength.value = look.glowStrength;
  renderer.uniforms.uFogDensity.value = look.fogDensity;

  if (controllers.colorScheme) controllers.colorScheme.updateDisplay();
  if (controllers.glow) controllers.glow.updateDisplay();
  if (controllers.fog) controllers.fog.updateDisplay();
}

// ─── GUI ─────────────────────────────────────────────────────────────────────
const gui = new GUI({ title: "Controls" });
gui.domElement.style.right = "12px";
gui.domElement.style.top = "12px";

const fC = gui.addFolder("Julia parameter c");
// .listen() so auto-scroll can move the sliders visibly
const ctrlCr = fC.add(params, "cr", C_MIN, C_MAX, 0.001).name("cr (real)").listen();
const ctrlCi = fC.add(params, "ci", C_MIN, C_MAX, 0.001).name("ci (i)").listen();
const ctrlCj = fC.add(params, "cj", C_MIN, C_MAX, 0.001).name("cj (j)").listen();
const ctrlCk = fC.add(params, "ck", C_MIN, C_MAX, 0.001).name("ck (k)").listen();
const cControllers = { cr: ctrlCr, ci: ctrlCi, cj: ctrlCj, ck: ctrlCk };
fC.open();

// ─── Auto-scroll c (full-range ping-pong per axis) ────────────────────────────
const fAuto = gui.addFolder("Auto-scroll c");
fAuto.open();

const autoToggleCtrls = {};
for (const key of C_KEYS) {
  const autoParam = "auto" + key[0].toUpperCase() + key.slice(1); // autoCr …
  const speedParam = "autoSpeed" + key[0].toUpperCase() + key.slice(1);
  const label = key;

  autoToggleCtrls[key] = fAuto
    .add(params, autoParam)
    .name(`Auto ${label}`)
    .listen()
    .onChange((on) => {
      if (on) {
        // Continue from current value without a jump
        autoPhase[key] = valueToPhase(params[key]);
      }
    });

  // Fine steps so the low end can be set very slow
  fAuto.add(params, speedParam, 0, 2, 0.005).name(`Speed ${label}`);
}

fAuto.add(params, "autoScrollPaused").name("Pause all").listen();

const fMorph = gui.addFolder("Morphing");
fMorph.add(params, "morphSpeed", 0, 2, 0.01).name("Speed");
fMorph.add(params, "morphAmplitude", 0, 0.5, 0.005).name("Amplitude");
fMorph.add(params, "morphPaused").name("Paused").listen();
fMorph.add(params, "morphCi").name("Animate ci");
fMorph.add(params, "morphCj").name("Animate cj");
fMorph.add(params, "morphCk").name("Animate ck");
fMorph.open();

const fCam = gui.addFolder("Camera");
fCam.add(params, "autoOrbit").name("Auto-orbit");
fCam.add(params, "orbitSpeed", 0, 0.5, 0.01).name("Orbit speed");
fCam.add(params, "resetCamera").name("Reset camera");

const fQual = gui.addFolder("Quality");
fQual
  .add(params, "maxIter", 4, 24, 1)
  .name("Iterations")
  .onChange((v) => {
    renderer.uniforms.uMaxIter.value = v | 0;
  });
fQual
  .add(params, "maxSteps", 32, 160, 1)
  .name("Ray steps")
  .onChange((v) => {
    renderer.uniforms.uMaxSteps.value = v | 0;
  });
fQual
  .add(params, "epsilon", 0.3, 3.0, 0.05)
  .name("Hit precision")
  .onChange((v) => {
    renderer.uniforms.uEpsilon.value = v;
  });
fQual
  .add(params, "bailout", 2, 16, 0.5)
  .name("Bailout")
  .onChange((v) => {
    renderer.uniforms.uBailout.value = v;
  });
fQual
  .add(params, "resolutionScale", 0.5, 1.0, 0.05)
  .name("Resolution")
  .onChange((v) => renderer.setResolutionScale(v));

const fLook = gui.addFolder("Appearance");
fLook.open();

const ctrlColorScheme = fLook
  .add(params, "colorScheme", Object.keys(COLOR_MODES))
  .name("Color scheme")
  .onChange((name) => {
    renderer.uniforms.uColorMode.value = COLOR_MODES[name];
  });

const ctrlGlow = fLook
  .add(params, "glowStrength", 0, 2.5, 0.05)
  .name("Glow")
  .onChange((v) => {
    renderer.uniforms.uGlowStrength.value = v;
  });

fLook
  .add(params, "aoStrength", 0, 2, 0.05)
  .name("AO")
  .onChange((v) => {
    renderer.uniforms.uAOStrength.value = v;
  });

const ctrlFog = fLook
  .add(params, "fogDensity", 0, 3, 0.05)
  .name("Fog")
  .onChange((v) => {
    renderer.uniforms.uFogDensity.value = v;
  });

fLook
  .add(params, "lookPreset", Object.keys(LOOK_PRESETS))
  .name("Look preset")
  .onChange((name) => {
    applyLookPreset(name, {
      colorScheme: ctrlColorScheme,
      glow: ctrlGlow,
      fog: ctrlFog,
    });
  });

fLook
  .add(params, "animateColor")
  .name("Animate color")
  .onChange((v) => {
    renderer.uniforms.uColorAnimate.value = v ? 1.0 : 0.0;
  });

fLook
  .add(params, "colorAnimSpeed", 0, 2, 0.01)
  .name("Color speed")
  .onChange((v) => {
    renderer.uniforms.uColorAnimSpeed.value = v;
  });

const fSlice = gui.addFolder("Slicing");
fSlice
  .add(params, "sliceW", -1.0, 1.0, 0.005)
  .name("4D slice W")
  .onChange((v) => {
    renderer.uniforms.uSliceW.value = v;
  });
fSlice
  .add(params, "sliceEnabled")
  .name("Cut plane")
  .onChange((v) => {
    renderer.uniforms.uSliceEnabled.value = v ? 1.0 : 0.0;
  });
fSlice
  .add(params, "sliceOffset", -1.5, 1.5, 0.01)
  .name("Plane offset")
  .onChange((v) => {
    renderer.uniforms.uSliceOffset.value = v;
  });
fSlice
  .add(params, "sliceAxis", ["X", "Y", "Z"])
  .name("Plane axis")
  .onChange((axis) => {
    const n = renderer.uniforms.uSliceNormal.value;
    if (axis === "X") n.set(1, 0, 0);
    else if (axis === "Y") n.set(0, 1, 0);
    else n.set(0, 0, 1);
  });

const fPreset = gui.addFolder("Presets");
const presetNames = PRESETS.map((p) => p.name);
fPreset
  .add(params, "preset", presetNames)
  .name("Load preset")
  .onChange((name) => {
    const p = PRESETS.find((x) => x.name === name);
    if (!p) return;
    params.cr = p.c.x;
    params.ci = p.c.y;
    params.cj = p.c.z;
    params.ck = p.c.w;
    morphTime = 0; // offsets return to 0 so the preset is exact
    // Disable auto-scroll so the preset shape stays stable
    params.autoCr = false;
    params.autoCi = false;
    params.autoCj = false;
    params.autoCk = false;
    for (const key of C_KEYS) {
      autoPhase[key] = valueToPhase(params[key]);
      if (autoToggleCtrls[key]) autoToggleCtrls[key].updateDisplay();
    }
    ctrlCr.updateDisplay();
    ctrlCi.updateDisplay();
    ctrlCj.updateDisplay();
    ctrlCk.updateDisplay();
    applyC();
  });

// Apply initial quality / look uniforms
renderer.uniforms.uMaxIter.value = params.maxIter;
renderer.uniforms.uMaxSteps.value = params.maxSteps;
renderer.uniforms.uEpsilon.value = params.epsilon;
renderer.uniforms.uBailout.value = params.bailout;
renderer.uniforms.uAOStrength.value = params.aoStrength;
renderer.uniforms.uColorAnimate.value = params.animateColor ? 1.0 : 0.0;
renderer.uniforms.uColorAnimSpeed.value = params.colorAnimSpeed;
renderer.setResolutionScale(params.resolutionScale);
// High-contrast default look (scheme + background pair)
applyLookPreset(params.lookPreset, {
  colorScheme: ctrlColorScheme,
  glow: ctrlGlow,
  fog: ctrlFog,
});

// ─── Auto-scroll phase (ping-pong over [C_MIN, C_MAX]) ───────────────────────
// Phase advances by dt * speed * AUTO_SPEED_SCALE.
// Triangle map: 0→1→0 over period 2 of phase (full min→max→min).
// Scale keeps the low end of the slider useful for very slow sweeps:
//   speed 0.05 ≈ ~13 min per full cycle
//   speed 0.35 (default) ≈ ~2 min per full cycle
//   speed 2.0 ≈ ~20 s per full cycle
const AUTO_SPEED_SCALE = 0.05;
const autoPhase = { cr: 0, ci: 0, cj: 0, ck: 0 };

function phaseToValue(phase) {
  let t = phase % 2;
  if (t < 0) t += 2;
  const u = t <= 1 ? t : 2 - t; // 0..1..0
  return C_MIN + u * (C_MAX - C_MIN);
}

/** Invert triangle on the ascending leg so enabling auto is seamless. */
function valueToPhase(v) {
  const u = (v - C_MIN) / (C_MAX - C_MIN);
  return Math.max(0, Math.min(1, u));
}

// Seed phases from initial c
for (const key of C_KEYS) {
  autoPhase[key] = valueToPhase(params[key]);
}

/**
 * Advance enabled auto-scroll axes and write into params.cr/ci/cj/ck.
 */
function updateAutoScroll(dt) {
  if (params.autoScrollPaused) return;

  let any = false;
  for (const key of C_KEYS) {
    const autoParam = "auto" + key[0].toUpperCase() + key.slice(1);
    const speedParam = "autoSpeed" + key[0].toUpperCase() + key.slice(1);
    if (!params[autoParam]) continue;
    const speed = params[speedParam];
    if (speed <= 0) continue;

    autoPhase[key] += dt * speed * AUTO_SPEED_SCALE;
    params[key] = phaseToValue(autoPhase[key]);
    any = true;
  }

  // .listen() already refreshes; force update keeps displays tight
  if (any) {
    for (const key of C_KEYS) {
      cControllers[key].updateDisplay();
    }
  }
}

// ─── Morphing state ──────────────────────────────────────────────────────────
// params.cr/ci/cj/ck are the base. Morphing adds small sinusoidal offsets
// only on axes that are NOT under auto-scroll control.
let morphTime = 0;

function isAuto(key) {
  const autoParam = "auto" + key[0].toUpperCase() + key.slice(1);
  return !!params[autoParam];
}

function applyC(dt) {
  if (dt !== undefined && !params.morphPaused && params.morphSpeed > 0) {
    morphTime += dt * params.morphSpeed;
  }

  const amp = params.morphAmplitude;
  const t = morphTime;

  // Morph only when that axis is not auto-scrolling (auto replaces morph)
  const cr = params.cr;
  const ci =
    params.ci +
    (!isAuto("ci") && params.morphCi ? amp * Math.sin(t * 0.9) : 0);
  const cj =
    params.cj +
    (!isAuto("cj") && params.morphCj
      ? amp * Math.sin(t * 0.7) * Math.cos(t * 0.23)
      : 0);
  const ck =
    params.ck +
    (!isAuto("ck") && params.morphCk ? amp * 0.65 * Math.sin(t * 0.55) : 0);

  renderer.setC(cr, ci, cj, ck);
}

// Live-update when the user drags a c slider (and re-sync phase if auto on)
function onCSliderChange(key) {
  if (isAuto(key)) {
    autoPhase[key] = valueToPhase(params[key]);
  }
  applyC();
}
ctrlCr.onChange(() => onCSliderChange("cr"));
ctrlCi.onChange(() => onCSliderChange("ci"));
ctrlCj.onChange(() => onCSliderChange("cj"));
ctrlCk.onChange(() => onCSliderChange("ck"));

// ─── Auto-orbit ──────────────────────────────────────────────────────────────
function updateOrbit(dt) {
  if (!params.autoOrbit || params.orbitSpeed <= 0) return;

  // Rotate camera around Y through the controls target
  const cam = renderer.camera;
  const target = renderer.controls.target;
  const ox = cam.position.x - target.x;
  const oz = cam.position.z - target.z;
  const angle = params.orbitSpeed * dt;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  cam.position.x = target.x + ox * cos - oz * sin;
  cam.position.z = target.z + ox * sin + oz * cos;
  cam.lookAt(target);
}

// ─── Animation loop ──────────────────────────────────────────────────────────
let last = performance.now();
let frames = 0;
let fpsAccum = 0;
let fpsTime = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) * 0.001);
  last = now;

  updateAutoScroll(dt);
  applyC(dt);
  updateOrbit(dt);

  const tSec = now * 0.001;
  renderer.render(tSec);

  // FPS counter (update ~4×/sec)
  frames++;
  fpsAccum += dt;
  fpsTime += dt;
  if (fpsTime >= 0.25) {
    const fps = frames / fpsAccum;
    if (fpsEl) fpsEl.textContent = `${fps.toFixed(0)} FPS`;
    frames = 0;
    fpsAccum = 0;
    fpsTime = 0;
  }

  requestAnimationFrame(frame);
}

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")) {
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    params.morphPaused = !params.morphPaused;
  } else if (e.code === "KeyR") {
    renderer.resetCamera();
  } else if (e.code === "KeyO") {
    params.autoOrbit = !params.autoOrbit;
  }
});

// Initial c (no time advance)
applyC();
requestAnimationFrame(frame);

console.info(
  "%cQuaternion Julia Set%c · DE ray-march · Space=pause morph · R=reset cam · O=orbit · Auto-scroll c in GUI",
  "color:#c9a07a;font-weight:bold",
  "color:#888"
);
