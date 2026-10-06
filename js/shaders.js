/**
 * GLSL shaders for quaternion Julia distance-estimator ray marching.
 *
 * Math summary (fragment shader):
 *   Iterate q_{n+1} = q_n² + c  with q,c ∈ ℍ (quaternions).
 *   Track derivative magnitude dr ← 2|q|·dr so that
 *   DE ≈ 0.5 · |q| · log(|q|) / dr  (Hubbard–Douady / Hart).
 *   Sphere-trace along each camera ray to the isosurface DE=0,
 *   shade with normals from DE gradients, soft AO, and glow.
 */

export const vertexShader = /* glsl */ `
precision highp float;

varying vec2 vUv;

void main() {
  vUv = uv;
  // Full-screen quad in clip space; position is already in [-1,1] NDC
  // when using PlaneGeometry(2,2) with an orthographic camera — but we
  // actually use a perspective camera + inv matrices in the fragment
  // shader, so we just pass through clip-space verts from a unit quad
  // that fills the view. See renderer.js for the mesh setup.
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const fragmentShader = /* glsl */ `
precision highp float;

// ─── Uniforms ───────────────────────────────────────────────────────────────
uniform vec3  uResolution;     // xy = size, z = pixel ratio (unused for now)
uniform float uTime;

uniform vec3  uCamPos;
uniform mat4  uInvProjection;
uniform mat4  uInvView;

// Julia parameter c = (cr, ci, cj, ck)
uniform vec4  uC;

// Quality
uniform int   uMaxIter;        // Julia iterations (detail)
uniform int   uMaxSteps;       // Ray-march steps
uniform float uEpsilon;        // Hit threshold scale
uniform float uBailout;        // Escape radius for DE

// 4D slice + cutting plane
uniform float uSliceW;         // fixed 4th component of sample point
uniform float uSliceEnabled;   // 1.0 = clip with plane
uniform vec3  uSliceNormal;    // plane normal (world)
uniform float uSliceOffset;    // plane: n·p = offset

// Appearance
// 0 Ember, 1 Ocean, 2 Neon, 3 Mono, 4 Aurora, 5 Solar, 6 Ice
uniform int   uColorMode;
uniform vec3  uBgColorA;       // background gradient bottom
uniform vec3  uBgColorB;       // background gradient top
uniform float uColorAnimate;   // 1.0 = animate model hue
uniform float uColorAnimSpeed; // hue cycle speed
uniform float uGlowStrength;
uniform float uAOStrength;
uniform float uFogDensity;

varying vec2 vUv;

// ─── Constants ───────────────────────────────────────────────────────────────
const float PI = 3.14159265359;
const float MAX_DIST = 12.0;
const float MIN_STEP = 0.0004;

// ─── Quaternion algebra ──────────────────────────────────────────────────────
// Stored as vec4(x, y, z, w)  ↔  x + y i + z j + w k

// Full Hamilton product (kept for reference / potential extensions)
vec4 qmul(vec4 a, vec4 b) {
  return vec4(
    a.x * b.x - a.y * b.y - a.z * b.z - a.w * b.w,
    a.x * b.y + a.y * b.x + a.z * b.w - a.w * b.z,
    a.x * b.z - a.y * b.w + a.z * b.x + a.w * b.y,
    a.x * b.w + a.y * b.z - a.z * b.y + a.w * b.x
  );
}

// Optimized square: q² = (x²−y²−z²−w²) + 2xy i + 2xz j + 2xw k
vec4 qsquare(vec4 q) {
  return vec4(
    q.x * q.x - q.y * q.y - q.z * q.z - q.w * q.w,
    2.0 * q.x * q.y,
    2.0 * q.x * q.z,
    2.0 * q.x * q.w
  );
}

// ─── Distance estimator ──────────────────────────────────────────────────────
// Returns vec2(de, trap) where trap is a cheap orbit-trap for coloring.
//
// Derivative tracking (magnitude only):
//   If f(q) = q² + c then Df = 2q, so |Dq_{n+1}| = 2|q_n| · |Dq_n|.
//   Starting from |Dq_0| = 1:
//     dr ← 2 · |q| · dr
//   DE = 0.5 · |q| · log(|q|) / dr
//
// For sphere-tracing safety we return a slightly conservative DE.

vec2 juliaDE(vec3 p) {
  vec4 q = vec4(p, uSliceW);
  vec4 c = uC;

  // |Dq₀| = 1  (differentiate w.r.t. the sample point)
  float dr = 1.0;
  float trap = 1e20;
  float r = length(q);
  bool escaped = false;

  // Classic order (Hart / IQ):
  //   dr ← 2|q|·dr ;  q ← q²+c ;  bailout on |q|
  // Fixed upper bound for WebGL; actual iterations = uMaxIter.
  for (int i = 0; i < 32; i++) {
    if (i >= uMaxIter) break;

    trap = min(trap, r);

    // |d(q²)/dq| = 2|q|  (magnitude-only — |ab|=|a||b| for quaternions)
    dr = 2.0 * r * dr + 1e-12;

    // q ← q² + c
    q = qsquare(q) + c;
    r = length(q);

    if (r > uBailout) {
      escaped = true;
      break;
    }
  }

  // Interior / non-escaping: solid fill (DE = 0 so the march registers a hit).
  // Exterior potential requires r > 1 for a meaningful log.
  if (!escaped || r <= 1.0) {
    return vec2(0.0, trap);
  }

  // Hubbard–Douady / Hart exterior DE:
  //   DE ≈ 0.5 · |q| · log(|q|) / |dq|
  // One extra ½ keeps the estimate conservative for sphere tracing
  // (mathematicians prove ½·approx is a lower bound; see IQ notes).
  float de = 0.25 * r * log(r) / max(dr, 1e-12);

  return vec2(max(de, 0.0), trap);
}

// Scene map: DE with optional planar cut (reveals interior as a solid face)
float mapScene(vec3 p, out float trap, out float cutFace) {
  vec2 jt = juliaDE(p);
  float d = jt.x;
  trap = jt.y;
  cutFace = 0.0;

  if (uSliceEnabled > 0.5) {
    // Half-space clip: keep n·p >= offset (discard the other half)
    float plane = dot(uSliceNormal, p) - uSliceOffset;
    // Solid interior on the cut side: when inside the set (small DE) and
    // past the plane, show a flat cut face.
    // We combine via smooth max so the cut is a hard plane through the body.
    if (plane < 0.0) {
      // Outside the kept half-space → far away (or just the plane distance)
      d = max(d, -plane);
      if (-plane > jt.x) {
        cutFace = 1.0;
      }
    }
  }

  return d;
}

float mapDE(vec3 p) {
  float trap, cut;
  return mapScene(p, trap, cut);
}

// ─── Normals via central differences on the DE ───────────────────────────────
vec3 calcNormal(vec3 p) {
  float e = max(0.0008, length(p) * 0.0004);
  vec2 h = vec2(e, 0.0);
  return normalize(vec3(
    mapDE(p + h.xyy) - mapDE(p - h.xyy),
    mapDE(p + h.yxy) - mapDE(p - h.yxy),
    mapDE(p + h.yyx) - mapDE(p - h.yyx)
  ));
}

// Cheap multi-sample ambient occlusion along the normal
float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.01 + 0.12 * float(i) / 4.0;
    float d = mapDE(p + n * h);
    occ += (h - d) * sca;
    sca *= 0.85;
  }
  return clamp(1.0 - uAOStrength * occ, 0.0, 1.0);
}

// Soft shadow by marching toward the light
float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
  float res = 1.0;
  float t = mint;
  for (int i = 0; i < 24; i++) {
    if (t >= maxt) break;
    float h = mapDE(ro + rd * t);
    if (h < 0.0005) return 0.0;
    res = min(res, k * h / t);
    t += clamp(h, 0.01, 0.2);
  }
  return clamp(res, 0.0, 1.0);
}

// ─── Color helpers ───────────────────────────────────────────────────────────
// High-chroma palettes + HSV for optional model color animation.

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// High-contrast surface palettes (dark lows → bright highs)
vec3 palette(float t, int mode) {
  t = clamp(t, 0.0, 1.0);
  if (mode == 0) {
    // Ember — crimson → hot gold
    vec3 lo = vec3(0.18, 0.02, 0.01);
    vec3 mid = vec3(0.95, 0.22, 0.04);
    vec3 hi = vec3(1.0, 0.85, 0.35);
    vec3 c = mix(lo, mid, smoothstep(0.0, 0.55, t));
    c = mix(c, hi, smoothstep(0.45, 1.0, t));
    return c + t * t * vec3(0.35, 0.12, 0.0);
  } else if (mode == 1) {
    // Ocean — abyss teal → bright aqua
    vec3 lo = vec3(0.0, 0.08, 0.12);
    vec3 mid = vec3(0.0, 0.55, 0.75);
    vec3 hi = vec3(0.55, 0.98, 1.0);
    vec3 c = mix(lo, mid, smoothstep(0.0, 0.5, t));
    return mix(c, hi, smoothstep(0.45, 1.0, t));
  } else if (mode == 2) {
    // Neon — black → electric magenta / cyan
    vec3 lo = vec3(0.05, 0.0, 0.12);
    vec3 mid = vec3(1.0, 0.08, 0.75);
    vec3 hi = vec3(0.25, 0.95, 1.0);
    vec3 c = mix(lo, mid, smoothstep(0.0, 0.55, t));
    return mix(c, hi, smoothstep(0.5, 1.0, t));
  } else if (mode == 3) {
    // Mono — near-black → bright silver
    float g = mix(0.06, 0.98, pow(t, 0.85));
    return vec3(g * 0.96, g, g * 1.04);
  } else if (mode == 4) {
    // Aurora — saturated green / cyan / violet bands
    return 0.45 + 0.55 * cos(6.2831 * (vec3(0.0, 0.18, 0.42) + t * vec3(0.9, 1.15, 0.75)));
  } else if (mode == 5) {
    // Solar — black → orange → yellow-white
    vec3 lo = vec3(0.08, 0.02, 0.0);
    vec3 mid = vec3(1.0, 0.4, 0.05);
    vec3 hi = vec3(1.0, 0.95, 0.55);
    vec3 c = mix(lo, mid, smoothstep(0.0, 0.5, t));
    return mix(c, hi, smoothstep(0.5, 1.0, t));
  } else {
    // Ice — midnight blue → ice white
    vec3 lo = vec3(0.02, 0.05, 0.18);
    vec3 mid = vec3(0.2, 0.55, 0.95);
    vec3 hi = vec3(0.9, 0.97, 1.0);
    vec3 c = mix(lo, mid, smoothstep(0.0, 0.5, t));
    return mix(c, hi, smoothstep(0.55, 1.0, t));
  }
}

// Shift surface color in HSV when animation is enabled
vec3 animateColor(vec3 rgb) {
  if (uColorAnimate < 0.5) return rgb;
  vec3 hsv = rgb2hsv(max(rgb, vec3(1e-5)));
  hsv.x = fract(hsv.x + uTime * uColorAnimSpeed * 0.12);
  // Keep motion vivid on dark fractal surfaces
  hsv.y = clamp(hsv.y * 1.15 + 0.08, 0.0, 1.0);
  hsv.z = clamp(hsv.z * 1.05, 0.0, 1.0);
  return hsv2rgb(hsv);
}

// Background gradient from look-preset uniforms
vec3 backgroundColor(vec2 uv, vec3 rd) {
  float h = 0.5 + 0.5 * rd.y;
  // Slight horizontal bias for depth without washing contrast
  float v = mix(h, uv.y, 0.35);
  return mix(uBgColorA, uBgColorB, clamp(v, 0.0, 1.0));
}

// ─── Camera ray from UV ──────────────────────────────────────────────────────
// Reconstruct a world-space ray by unprojecting the near and far clip points.
// uInvView is the camera matrixWorld (view → world).
void getRay(in vec2 uv, out vec3 ro, out vec3 rd) {
  // NDC: uv [0,1] → clip [-1,1]. PlaneGeometry UVs: V=0 bottom, +Y up in NDC.
  vec2 ndc = uv * 2.0 - 1.0;

  vec4 nearView = uInvProjection * vec4(ndc, -1.0, 1.0);
  vec4 farView  = uInvProjection * vec4(ndc,  1.0, 1.0);
  nearView /= nearView.w;
  farView  /= farView.w;

  vec3 nearWorld = (uInvView * vec4(nearView.xyz, 1.0)).xyz;
  vec3 farWorld  = (uInvView * vec4(farView.xyz, 1.0)).xyz;

  ro = uCamPos;
  rd = normalize(farWorld - nearWorld);
}

// ─── Tone mapping ────────────────────────────────────────────────────────────
vec3 ACESFilm(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// ─── Main ────────────────────────────────────────────────────────────────────
void main() {
  vec2 uv = vUv;
  vec3 ro, rd;
  getRay(uv, ro, rd);

  // Soft primary + fill light directions
  vec3 lightDir  = normalize(vec3(0.55, 0.75, 0.35));
  vec3 lightDir2 = normalize(vec3(-0.6, 0.2, -0.5));

  float t = 0.0;
  float minDist = 1e10;
  float trapHit = 1.0;
  float cutFace = 0.0;
  bool hit = false;
  vec3 p = ro;

  // Bounding sphere early-out: set typically lives inside |p| < ~2.5
  // March from near plane
  float tNear = 0.0;
  // Ray-sphere against radius 3 around origin for a cheap start
  {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - 9.0;
    float h = b * b - c;
    if (h < 0.0 && length(ro) > 3.0) {
      // Miss bounding sphere entirely → background
      vec3 bg = backgroundColor(uv, rd);
      float vig = smoothstep(1.35, 0.15, length(uv - 0.5));
      bg *= 0.55 + 0.45 * vig;
      bg = ACESFilm(bg * 1.05);
      bg = pow(bg, vec3(1.0 / 2.2));
      gl_FragColor = vec4(bg, 1.0);
      return;
    }
    if (h >= 0.0) {
      h = sqrt(h);
      tNear = max(0.0, -b - h);
      t = tNear;
    }
  }

  for (int i = 0; i < 160; i++) {
    if (i >= uMaxSteps) break;
    if (t > MAX_DIST) break;

    p = ro + rd * t;
    float trap;
    float cut;
    float d = mapScene(p, trap, cut);

    minDist = min(minDist, d);

    // Relative epsilon: more tolerant far away, tighter near camera
    float eps = uEpsilon * max(t, 0.5) * 0.01;
    eps = max(eps, 0.00035);

    if (d < eps) {
      hit = true;
      trapHit = trap;
      cutFace = cut;
      break;
    }

    // Adaptive step — clamp to avoid huge leaps missing thin features
    t += clamp(d, MIN_STEP, 0.35);
  }

  // Background gradient from look preset (high contrast vs model)
  vec3 col = backgroundColor(uv, rd);

  // Soft volumetric glow from closest approach (silhouette halo)
  float glow = exp(-7.0 * max(minDist, 0.0)) * uGlowStrength;
  float glowT = 0.55 + 0.25 * sin(uTime * 0.35);
  vec3 glowCol = animateColor(palette(glowT, uColorMode));
  col += glowCol * glow * 0.65;

  if (hit) {
    vec3 n;
    if (cutFace > 0.5) {
      // Flat cut face uses the slice plane normal
      n = normalize(uSliceNormal);
      // Face the camera
      if (dot(n, rd) > 0.0) n = -n;
    } else {
      n = calcNormal(p);
    }

    float ao = calcAO(p, n);

    // Orbit-trap + spatial modulation → rich surface color
    float tCol = clamp(trapHit * 1.35, 0.0, 1.0);
    tCol = clamp(tCol + 0.14 * sin(p.x * 3.0 + p.y * 2.0 + p.z * 1.5), 0.0, 1.0);
    // When animating, also slide along the palette before HSV shift
    if (uColorAnimate > 0.5) {
      tCol = fract(tCol + uTime * uColorAnimSpeed * 0.08);
    }
    vec3 albedo = animateColor(palette(tCol, uColorMode));

    if (cutFace > 0.5) {
      // Interior cut: darker but still tinted
      albedo = mix(albedo * 0.4, uBgColorA + vec3(0.06), 0.35);
    }

    // Lighting — slightly brighter key so the solid pops off dark BGs
    float dif  = max(dot(n, lightDir), 0.0);
    float dif2 = max(dot(n, lightDir2), 0.0) * 0.5;
    float fre  = pow(1.0 - max(dot(n, -rd), 0.0), 2.8);
    vec3  h    = normalize(lightDir - rd);
    float spe  = pow(max(dot(n, h), 0.0), 40.0);

    float sh = softShadow(p + n * 0.004, lightDir, 0.02, 4.0, 8.0);

    vec3 lit = vec3(0.0);
    lit += albedo * dif  * vec3(1.05, 0.98, 0.9) * sh * 1.15;
    lit += albedo * dif2 * vec3(0.4, 0.55, 1.0);
    lit += albedo * 0.18 * ao;                       // ambient lift
    lit += vec3(1.0, 0.97, 0.9) * spe * 0.65 * sh;  // specular
    lit += glowCol * fre * 0.35;                     // rim glow
    lit *= mix(0.55, 1.0, ao);                       // softer AO crush

    // Distance fog into themed background (keep model readable)
    float fog = 1.0 - exp(-uFogDensity * t * t * 0.035);
    col = mix(lit, col, clamp(fog, 0.0, 0.7));
  }

  // Gentle vignette — keep contrast without crushing to black
  float vig = smoothstep(1.35, 0.2, length(uv - 0.5));
  col *= 0.5 + 0.5 * vig;

  // Tone map + gamma
  col = ACESFilm(col * 1.2);
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));

  gl_FragColor = vec4(col, 1.0);
}
`;
