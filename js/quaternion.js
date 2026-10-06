/**
 * CPU-side quaternion helpers and curated Julia-set presets.
 *
 * A quaternion is stored as { x, y, z, w } matching GLSL vec4(x,y,z,w)
 * where q = x + y·i + z·j + w·k.
 *
 * Used for:
 *  - Preset library (interesting starting values of c)
 *  - Optional self-check of square / multiply vs known identities
 */

/** @typedef {{ x: number, y: number, z: number, w: number }} Quat */

/**
 * Quaternion multiplication: a * b
 * (x1 + y1 i + z1 j + w1 k)(x2 + y2 i + z2 j + w2 k)
 */
export function qmul(a, b) {
  return {
    x: a.x * b.x - a.y * b.y - a.z * b.z - a.w * b.w,
    y: a.x * b.y + a.y * b.x + a.z * b.w - a.w * b.z,
    z: a.x * b.z - a.y * b.w + a.z * b.x + a.w * b.y,
    w: a.x * b.w + a.y * b.z - a.z * b.y + a.w * b.x,
  };
}

/** q² using the optimized square formula */
export function qsquare(q) {
  // q² = (x² - y² - z² - w²) + 2xy i + 2xz j + 2xw k
  return {
    x: q.x * q.x - q.y * q.y - q.z * q.z - q.w * q.w,
    y: 2.0 * q.x * q.y,
    z: 2.0 * q.x * q.z,
    w: 2.0 * q.x * q.w,
  };
}

export function qlength(q) {
  return Math.hypot(q.x, q.y, q.z, q.w);
}

export function qadd(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z, w: a.w + b.w };
}

/**
 * Hubbard–Douady style distance estimate for the Julia set of f(q)=q²+c
 * (CPU reference; the GPU version lives in shaders.js).
 *
 * DE ≈ 0.5 · |q| · log(|q|) / |dq|
 * with |dq| tracked by the recurrence dr ← 2·|q|·dr
 */
export function distanceEstimate(p, c, maxIter = 16, bailout = 8.0) {
  let qx = p.x;
  let qy = p.y;
  let qz = p.z;
  let qw = p.w;
  let dr = 1.0;
  let r = Math.hypot(qx, qy, qz, qw);
  let escaped = false;

  // Match GLSL order: dr ← 2|q|dr ; q ← q²+c ; bailout
  for (let i = 0; i < maxIter; i++) {
    dr = 2.0 * r * dr;

    const nx = qx * qx - qy * qy - qz * qz - qw * qw + c.x;
    const ny = 2.0 * qx * qy + c.y;
    const nz = 2.0 * qx * qz + c.z;
    const nw = 2.0 * qx * qw + c.w;
    qx = nx;
    qy = ny;
    qz = nz;
    qw = nw;

    r = Math.hypot(qx, qy, qz, qw);
    if (r > bailout) {
      escaped = true;
      break;
    }
  }

  if (!escaped || r <= 1.0 || dr < 1e-12) return 0.0;
  // Same conservative factor as the fragment shader (0.25 = 0.5 × 0.5)
  return (0.25 * r * Math.log(r)) / dr;
}

/**
 * Curated interesting values of the Julia parameter c.
 * Each entry: { name, c: {x,y,z,w}, description }
 */
export const PRESETS = [
  {
    name: "Classic Blob",
    c: { x: -0.2, y: 0.6, z: 0.2, w: 0.2 },
    description: "Rounded organic form — strong default for demos",
  },
  {
    name: "Twisted",
    c: { x: -0.125, y: -0.256, z: 0.847, w: 0.0895 },
    description: "Elongated twist with dramatic arms",
  },
  {
    name: "Double",
    c: { x: 0.285, y: 0.01, z: 0.0, w: 0.0 },
    description: "Near-classical 2D Julia extruded into 3D",
  },
  {
    name: "Spiky",
    c: { x: -0.4, y: 0.6, z: 0.0, w: 0.0 },
    description: "Sharp protrusions and thinner filaments",
  },
  {
    name: "Soft Cross",
    c: { x: 0.18, y: 0.4875, z: 0.02, w: 0.02 },
    description: "Cross-like lobes with soft joints",
  },
  {
    name: "Ghost",
    c: { x: -0.08, y: 0.0, z: 0.85, w: 0.0 },
    description: "Thin sheet-like structure",
  },
  {
    name: "Coral",
    c: { x: -0.291, y: -0.399, z: 0.339, w: 0.437 },
    description: "Branching coral-like morphology",
  },
  {
    name: "Pearl",
    c: { x: -0.162, y: 0.163, z: 0.56, w: -0.599 },
    description: "Compact pearl with subtle folds",
  },
];

export const DEFAULT_C = { ...PRESETS[0].c };

/**
 * Lightweight self-check run once at load (console only).
 * Verifies square identities and DE positivity far from the set.
 */
export function selfCheck() {
  const eps = 1e-9;
  const one = { x: 1, y: 0, z: 0, w: 0 };
  const i = { x: 0, y: 1, z: 0, w: 0 };
  const j = { x: 0, y: 0, z: 1, w: 0 };

  const s1 = qsquare(one);
  const sI = qsquare(i);
  const sJ = qsquare(j);

  const ok1 = Math.abs(s1.x - 1) < eps && Math.abs(s1.y) < eps;
  // i² = -1
  const okI = Math.abs(sI.x + 1) < eps && Math.abs(sI.y) < eps;
  // j² = -1
  const okJ = Math.abs(sJ.x + 1) < eps;

  // i*j = k
  const ij = qmul(i, j);
  const okIJ = Math.abs(ij.w - 1) < eps;

  const c = DEFAULT_C;
  const far = distanceEstimate({ x: 5, y: 0, z: 0, w: 0 }, c, 12, 8);
  const okDE = far > 1.0; // far from set ⇒ large positive DE

  const all = ok1 && okI && okJ && okIJ && okDE;
  if (!all) {
    console.warn("[quaternion] self-check failed", { ok1, okI, okJ, okIJ, okDE, far });
  } else {
    console.info("[quaternion] self-check passed (square identities + DE sanity)");
  }
  return all;
}
