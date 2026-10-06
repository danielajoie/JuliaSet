/**
 * Three.js renderer shell: full-screen ray-march quad, camera, controls.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { vertexShader, fragmentShader } from "./shaders.js";
import { DEFAULT_C } from "./quaternion.js";

const DEFAULT_CAMERA_POS = new THREE.Vector3(0.0, 0.35, 3.2);

export class JuliaRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.resolutionScale = 1.0;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(this._pixelRatio());

    // Orthographic camera for the full-screen quad only.
    // Ray directions are reconstructed in the fragment shader from
    // a separate "virtual" perspective camera's matrices.
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.copy(DEFAULT_CAMERA_POS);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 1.1;
    this.controls.maxDistance = 10;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.uniforms = {
      uResolution: { value: new THREE.Vector3(1, 1, 1) },
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uInvProjection: { value: new THREE.Matrix4() },
      uInvView: { value: new THREE.Matrix4() },
      uC: {
        value: new THREE.Vector4(DEFAULT_C.x, DEFAULT_C.y, DEFAULT_C.z, DEFAULT_C.w),
      },
      uMaxIter: { value: 11 },
      uMaxSteps: { value: 80 },
      uEpsilon: { value: 1.0 },
      uBailout: { value: 8.0 },
      uSliceW: { value: 0.0 },
      uSliceEnabled: { value: 0.0 },
      uSliceNormal: { value: new THREE.Vector3(1, 0, 0) },
      uSliceOffset: { value: 0.0 },
      uColorMode: { value: 2 }, // Neon — high contrast default
      uBgColorA: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
      uBgColorB: { value: new THREE.Vector3(0.04, 0.0, 0.08) },
      uColorAnimate: { value: 0.0 },
      uColorAnimSpeed: { value: 0.45 },
      uGlowStrength: { value: 1.15 },
      uAOStrength: { value: 1.0 },
      uFogDensity: { value: 0.75 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });

    // Clip-space full-screen triangle strip (two triangles covering NDC)
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geometry, material);

    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this.resize();
  }

  _pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, 2) * this.resolutionScale;
  }

  setResolutionScale(scale) {
    this.resolutionScale = Math.max(0.4, Math.min(1.0, scale));
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = this._pixelRatio();

    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.uniforms.uResolution.value.set(w * pr, h * pr, pr);
  }

  /**
   * Sync camera matrices + position into shader uniforms.
   */
  updateCameraUniforms() {
    this.camera.updateMatrixWorld();
    this.uniforms.uCamPos.value.copy(this.camera.position);
    this.uniforms.uInvProjection.value.copy(this.camera.projectionMatrixInverse);
    // World-from-view = inverse of view matrix = camera.matrixWorld
    this.uniforms.uInvView.value.copy(this.camera.matrixWorld);
  }

  setC(x, y, z, w) {
    this.uniforms.uC.value.set(x, y, z, w);
  }

  getC() {
    const v = this.uniforms.uC.value;
    return { x: v.x, y: v.y, z: v.z, w: v.w };
  }

  resetCamera() {
    this.camera.position.copy(DEFAULT_CAMERA_POS);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /**
   * @param {number} time seconds
   */
  render(time) {
    this.uniforms.uTime.value = time;
    this.controls.update();
    this.updateCameraUniforms();
    this.renderer.render(this.scene, this.quadCamera);
  }

  dispose() {
    window.removeEventListener("resize", this._onResize);
    this.controls.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.renderer.dispose();
  }
}
