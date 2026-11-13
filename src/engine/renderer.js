import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { clamp, damp } from './utils.js';

export const QUALITY = {
  low: { label: 'Performance', pixelRatio: 0.75, msaa: 0, shadows: false, shadowSize: 1024, bloom: true, reflections: false, particles: 0.5 },
  medium: { label: 'Balanced', pixelRatio: 1.0, msaa: 2, shadows: true, shadowSize: 1024, bloom: true, reflections: false, particles: 0.75 },
  high: { label: 'High', pixelRatio: 1.25, msaa: 4, shadows: true, shadowSize: 2048, bloom: true, reflections: true, particles: 1 },
  ultra: { label: 'Ultra', pixelRatio: 2.0, msaa: 4, shadows: true, shadowSize: 4096, bloom: true, reflections: true, particles: 1 },
};

/** Renders the scene into an MSAA HDR target, then hands the resolved image to the composer chain. */
class SceneMSAAPass extends Pass {
  constructor(samples) {
    super();
    this.scene = null;
    this.camera = null;
    this.needsSwap = false;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.copyMat);
  }
  setSize(w, h) {
    this.rt.setSize(w, h);
  }
  setSamples(samples) {
    if (this.rt.samples === samples) return;
    const { width, height } = this.rt;
    this.rt.dispose();
    this.rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples, depthBuffer: true });
  }
  render(renderer, writeBuffer, readBuffer) {
    if (!this.scene) return;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.copyMat.uniforms.tDiffuse.value = this.rt.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.rt.dispose();
    this.copyMat.dispose();
    this.quad.dispose();
  }
}

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAberration: { value: 0 },
    uRadial: { value: 0 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.035 },
    uImpact: { value: 0 },
    uImpactA: { value: new THREE.Color(0x05060a) },
    uImpactB: { value: new THREE.Color(0xffffff) },
    uDesat: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0xffffff) },
    uShadowTint: { value: new THREE.Color(1, 1, 1) },
    uHighTint: { value: new THREE.Color(1, 1, 1) },
    uContrast: { value: 1.06 },
    uFade: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberration, uRadial, uVignette, uGrain, uImpact, uDesat, uFlash, uContrast, uFade;
    uniform vec2 uRes, uCenter;
    uniform vec3 uImpactA, uImpactB, uFlashColor, uShadowTint, uHighTint;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - uCenter;
      float d = length(dir * vec2(uRes.x / uRes.y, 1.0));
      float ab = uAberration * (0.1 + d * d * 0.6) + 0.001 * d * d;
      vec3 c = vec3(0.0);
      float jitter = hash(uv * uRes + uTime) * 0.2;
      for (int i = 0; i < 6; i++) {
        float t = (float(i) + jitter) / 6.0;
        vec2 o = dir * uRadial * t;
        c.r += texture2D(tDiffuse, uv - o + dir * ab).r;
        c.g += texture2D(tDiffuse, uv - o).g;
        c.b += texture2D(tDiffuse, uv - o - dir * ab).b;
      }
      c /= 6.0;
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // split-tone grade
      c *= mix(uShadowTint, uHighTint, smoothstep(0.0, 0.9, lum));
      c = mix(vec3(lum), c, 1.0 - uDesat);
      c = (c - 0.18) * uContrast + 0.18;
      c = max(c, 0.0);
      // anime style impact frame: brutal two tone posterise with a hot rim
      if (uImpact > 0.001) {
        float l2 = smoothstep(0.16, 0.2, lum);
        float hot = smoothstep(1.2, 2.2, lum);
        vec3 imp = mix(uImpactA, uImpactB, l2);
        imp = mix(imp, uImpactA, hot * 0.0);
        // speed streaks
        float ang = atan(dir.y, dir.x);
        float streak = smoothstep(0.55, 1.0, hash(vec2(floor(ang * 60.0), floor(uTime * 40.0)))) * smoothstep(0.25, 0.7, d);
        imp = mix(imp, uImpactB, streak * 0.8);
        c = mix(c, imp * 1.4, uImpact);
      }
      float vig = smoothstep(0.35, 1.25, d * 1.15);
      c *= 1.0 - uVignette * vig;
      float g = hash(uv * uRes + fract(uTime) * 91.7) - 0.5;
      c += g * uGrain * (0.35 + lum);
      c = mix(c, uFlashColor, uFlash);
      c *= 1.0 - uFade;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }
  `,
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;

    this.qualityName = 'high';
    this.quality = QUALITY.high;
    this.dynamicRes = true;
    this.resScale = 1;
    this._ftAvg = 16;
    this._resTimer = 0;

    this.composer = new EffectComposer(
      r,
      new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false })
    );
    this.scenePass = new SceneMSAAPass(4);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.45, 1.0);
    this.final = new ShaderPass(FinalShader);
    this.output = new OutputPass();
    this.composer.addPass(this.scenePass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
    this.composer.addPass(this.output);
    this.u = this.final.uniforms;

    // post fx animated state (decays automatically)
    this.fx = { aberration: 0, radial: 0, impact: 0, flash: 0, desat: 0, desatTarget: 0, fade: 0, fadeTarget: 0, fadeSpeed: 4 };
    this.time = 0;
    this.width = 1;
    this.height = 1;

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  get gl() {
    return this.renderer;
  }

  setQuality(name) {
    if (!QUALITY[name]) name = 'high';
    this.qualityName = name;
    this.quality = QUALITY[name];
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.scenePass.setSamples(this.quality.msaa);
    this.resScale = 1;
    this.resize();
  }

  setScene(scene, camera) {
    this.scenePass.scene = scene;
    this.scenePass.camera = camera;
    this.camera = camera;
    this.resize();
  }

  setGrade(shadow, high, bloomStrength = 0.38, exposure = 1) {
    this.u.uShadowTint.value.set(shadow);
    this.u.uHighTint.value.set(high);
    this.bloom.strength = bloomStrength;
    this.renderer.toneMappingExposure = exposure;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio) * this.resScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.scenePass.setSize(Math.floor(w * pr), Math.floor(h * pr));
    this.u.uRes.value.set(w * pr, h * pr);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---- post fx triggers -------------------------------------------------
  kickAberration(v) {
    this.fx.aberration = Math.max(this.fx.aberration, v);
  }
  kickRadial(v, cx = 0.5, cy = 0.5) {
    this.fx.radial = Math.max(this.fx.radial, v);
    this.u.uCenter.value.set(cx, cy);
  }
  impactFrame(dur = 0.07, dark = 0x05060a, light = 0xffffff) {
    this.fx.impact = Math.max(this.fx.impact, dur);
    this.u.uImpactA.value.set(dark);
    this.u.uImpactB.value.set(light);
  }
  flash(color = 0xffffff, amount = 0.6) {
    this.fx.flash = Math.max(this.fx.flash, amount);
    this.u.uFlashColor.value.set(color);
  }
  setDesat(v) {
    this.fx.desatTarget = v;
  }
  fadeTo(v, speed = 4) {
    this.fx.fadeTarget = v;
    this.fx.fadeSpeed = speed;
  }
  setFade(v) {
    this.fx.fade = this.fx.fadeTarget = v;
  }

  /** advance post-fx animation state and adaptive resolution */
  update(dt, frameMs) {
    const fx = this.fx;
    this.time += dt;
    fx.aberration = damp(fx.aberration, 0, 9, dt);
    fx.radial = damp(fx.radial, 0, 8, dt);
    fx.flash = damp(fx.flash, 0, 10, dt);
    fx.impact = Math.max(0, fx.impact - dt);
    fx.desat = damp(fx.desat, fx.desatTarget, 8, dt);
    const fd = fx.fadeTarget - fx.fade;
    fx.fade += clamp(fd, -fx.fadeSpeed * dt, fx.fadeSpeed * dt);

    // dynamic resolution: keep the frame pacing smooth
    if (this.dynamicRes && frameMs !== undefined) {
      this._ftAvg = this._ftAvg * 0.93 + frameMs * 0.07;
      this._resTimer += dt;
      if (this._resTimer > 1.2) {
        this._resTimer = 0;
        if (this._ftAvg > 19.5 && this.resScale > 0.55) {
          this.resScale = Math.max(0.55, this.resScale - 0.12);
          this.resize();
        } else if (this._ftAvg < 11.5 && this.resScale < 1) {
          this.resScale = Math.min(1, this.resScale + 0.06);
          this.resize();
        }
      }
    }
  }

  render() {
    const fx = this.fx;
    const u = this.u;
    u.uTime.value = this.time;
    u.uAberration.value = fx.aberration;
    u.uRadial.value = fx.radial;
    u.uImpact.value = fx.impact > 0 ? 1 : 0;
    u.uDesat.value = fx.desat;
    u.uFlash.value = fx.flash;
    u.uFade.value = fx.fade;
    this.renderer.info.reset();
    this.composer.render();
  }
}

/**
 * Builds a prefiltered environment map from a tiny procedural "light rig" room so that
 * metal surfaces get rich, art-directed reflections without any image assets.
 */
export function buildEnvironment(renderer, opts = {}) {
  const { top = 0x223344, bottom = 0x050608, panels = [] } = opts;
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { cTop: { value: new THREE.Color(top) }, cBot: { value: new THREE.Color(bottom) } },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 cTop, cBot; varying vec3 vP; void main(){ float t = smoothstep(-0.3, 0.8, normalize(vP).y); gl_FragColor = vec4(mix(cBot, cTop, t), 1.0); }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  for (const p of panels) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(p.w ?? 10, p.h ?? 10),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color).multiplyScalar(p.intensity ?? 4), side: THREE.DoubleSide })
    );
    m.position.set(...p.pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.03);
  pmrem.dispose();
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  return rt.texture;
}
