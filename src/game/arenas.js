import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { buildEnvironment } from '../engine/renderer.js';
import { rand, seeded, TAU, chance } from '../engine/utils.js';

const NOISE = /* glsl */ `
  float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash21(i), hash21(i+vec2(1,0)), u.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), u.x), u.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;

const ReflShader = {
  name: 'BlurReflector',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
    void main(){ vUv = textureMatrix * vec4(position, 1.0); vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color; uniform sampler2D tDiffuse; varying vec4 vUv; varying vec3 vW;
    void main(){
      vec2 uv = vUv.xy / vUv.w;
      vec3 c = vec3(0.0);
      float r = 0.0035;
      c += texture2D(tDiffuse, uv).rgb * 0.24;
      c += texture2D(tDiffuse, uv + vec2(r, 0.0)).rgb * 0.12;
      c += texture2D(tDiffuse, uv - vec2(r, 0.0)).rgb * 0.12;
      c += texture2D(tDiffuse, uv + vec2(0.0, r * 2.0)).rgb * 0.12;
      c += texture2D(tDiffuse, uv - vec2(0.0, r * 2.0)).rgb * 0.12;
      c += texture2D(tDiffuse, uv + vec2(r, r) * 1.6).rgb * 0.07;
      c += texture2D(tDiffuse, uv - vec2(r, r) * 1.6).rgb * 0.07;
      c += texture2D(tDiffuse, uv + vec2(-r, r) * 1.6).rgb * 0.07;
      c += texture2D(tDiffuse, uv - vec2(-r, r) * 1.6).rgb * 0.07;
      c = max(min(c, vec3(6.0)), vec3(0.0));
      if (!(c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0)) c = vec3(0.0);
      gl_FragColor = vec4(c * color, 1.0);
    }`,
};

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

class Arena {
  constructor(R) {
    this.R = R;
    this.scene = new THREE.Scene();
    this.updaters = [];
    this.q = R.quality;
    this.ambientT = 0;
  }

  env(opts, intensity = 1) {
    this.scene.environment = buildEnvironment(this.R.gl, opts);
    this.scene.environmentIntensity = intensity;
  }

  lights({ key, rims = [], hemi, shadowSoft = 3 }) {
    const k = new THREE.DirectionalLight(key.color, key.intensity);
    k.position.set(...key.pos);
    k.target.position.set(0, 1, 0);
    k.castShadow = true;
    k.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
    Object.assign(k.shadow.camera, { left: -13, right: 13, top: 9, bottom: -5, near: 1, far: 50 });
    k.shadow.bias = -0.0005;
    k.shadow.normalBias = 0.03;
    k.shadow.radius = shadowSoft;
    this.scene.add(k, k.target);
    this.key = k;
    for (const r of rims) {
      const l = new THREE.DirectionalLight(r.color, r.intensity);
      l.position.set(...r.pos);
      this.scene.add(l);
    }
    if (hemi) this.scene.add(new THREE.HemisphereLight(hemi.sky, hemi.ground, hemi.intensity));
  }

  floor({ map, emissiveMap, emissive = 0xffffff, emissiveIntensity = 1, rough = 0.5, metal = 0.6, reflect = 0.5, tint = 0xffffff, size = [64, 26], repeat = [16, 6.5], z = -3, roughnessMap }) {
    const geo = new THREE.PlaneGeometry(size[0], size[1]);
    const useRefl = this.q.reflections && reflect > 0;
    if (map) map.repeat.set(...repeat);
    if (emissiveMap) emissiveMap.repeat.set(...repeat);
    if (roughnessMap) roughnessMap.repeat.set(...repeat);
    const mat = new THREE.MeshStandardMaterial({
      map, color: tint, roughness: rough, metalness: metal, roughnessMap,
      emissiveMap: emissiveMap || null, emissive: emissiveMap ? new THREE.Color(emissive) : new THREE.Color(0),
      emissiveIntensity, transparent: useRefl, opacity: useRefl ? 1 - reflect * 0.55 : 1, depthWrite: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0, z);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    if (useRefl) {
      const refl = new Reflector(geo, { textureWidth: 1024, textureHeight: 512, color: new THREE.Color(reflect, reflect, reflect), shader: ReflShader, multisample: 0, clipBias: 0.003 });
      refl.rotation.x = -Math.PI / 2;
      refl.position.set(0, -0.004, z);
      this.scene.add(refl);
      this.reflector = refl;
    }
    this.floorMesh = mesh;
    return mesh;
  }

  /** soft additive light shaft */
  shaft(color, x, y, z, rTop, rBot, h, intensity = 1, tilt = 0) {
    const geo = new THREE.CylinderGeometry(rTop, rBot, h, 20, 1, true);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(intensity) }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `precision highp float; uniform vec3 uColor; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV; ${NOISE}
        void main(){ float f = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0001, 1.0), 2.2); float n = 0.6 + 0.4 * vnoise(vec2(vUv.x * 14.0, uTime * 0.3));
          float a = f * smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.75, vUv.y) * n * 0.22; gl_FragColor = vec4(uColor * a, a); }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.z = tilt;
    m.renderOrder = 5;
    this.scene.add(m);
    this.updaters.push((dt, t) => (mat.uniforms.uTime.value = t));
    return m;
  }

  add(...o) {
    this.scene.add(...o);
    return o[0];
  }

  update(dt, time, fight) {
    for (const u of this.updaters) u(dt, time, fight);
  }

  dispose() {
    const texs = new Set();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const k of ['map', 'emissiveMap', 'roughnessMap', 'normalMap']) if (m[k]) texs.add(m[k]);
        m.dispose();
      }
      if (o.isReflector) o.dispose?.();
    });
    for (const t of texs) t.dispose();
    if (this.scene.environment) this.scene.environment.dispose();
  }
}

const std = (color, rough = 0.6, metal = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
const glowMat = (color, k = 2.5) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });

function plateTexture(base, line, accent, o = {}) {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const rnd = seeded(o.seed ?? 7);
    for (let i = 0; i < 1400; i++) {
      const v = rnd() < 0.5 ? 255 : 0;
      g.fillStyle = `rgba(${v},${v},${v},${rnd() * 0.035})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 26, 1 + rnd() * 3);
    }
    g.strokeStyle = line;
    g.lineWidth = 3;
    const n = o.cells ?? 2;
    for (let i = 0; i <= n; i++) {
      g.beginPath(); g.moveTo((i * w) / n, 0); g.lineTo((i * w) / n, h); g.stroke();
      g.beginPath(); g.moveTo(0, (i * h) / n); g.lineTo(w, (i * h) / n); g.stroke();
    }
    g.fillStyle = line;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      for (const [dx, dy] of [[14, 14], [w / n - 22, 14], [14, h / n - 22], [w / n - 22, h / n - 22]]) g.fillRect((i * w) / n + dx, (j * h) / n + dy, 8, 8);
    }
    if (accent) {
      g.fillStyle = accent;
      g.fillRect(w * 0.06, h * 0.47, w * 0.2, 6);
      g.fillRect(w * 0.6, h * 0.94, w * 0.3, 5);
    }
  });
}

function roughTexture(seed = 3, base = 150, amp = 90) {
  return canvasTex(256, 256, (g, w, h) => {
    const rnd = seeded(seed);
    g.fillStyle = `rgb(${base},${base},${base})`;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      const x = rnd() * w, y = rnd() * h, r = 8 + rnd() * 50;
      const v = base + (rnd() - 0.5) * 2 * amp;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
      gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, false);
}

// ===========================================================================
// THE FOUNDRY PIT
// ===========================================================================
function foundry(R) {
  const A = new Arena(R);
  const s = A.scene;
  s.background = new THREE.Color(0x0a0605);
  s.fog = new THREE.Fog(0x140a06, 22, 85);
  A.env({ top: 0x1a1410, bottom: 0x2a0e04, panels: [
    { color: 0xff7a2a, intensity: 3.2, pos: [0, -6, -30], w: 60, h: 14 },
    { color: 0x2ad0ff, intensity: 1.6, pos: [-30, 14, 20], w: 20, h: 20 },
    { color: 0xffd9b0, intensity: 2.2, pos: [10, 34, 12], w: 26, h: 10 },
  ] }, 1.0);
  A.lights({
    key: { color: 0xffe2c4, intensity: 2.5, pos: [5, 13, 9] },
    rims: [{ color: 0xff6a1e, intensity: 3.2, pos: [-8, 4, -9] }, { color: 0x3ad6ff, intensity: 1.5, pos: [9, 6, -7] }],
    hemi: { sky: 0x6a5a50, ground: 0x4a1e0a, intensity: 0.75 },
  });
  A.floor({ map: plateTexture('#3a3532', '#161413', '#c9861e', { seed: 11 }), roughnessMap: roughTexture(5), rough: 0.75, metal: 0.75, reflect: 0.5, tint: 0xb8aea6 });

  // hazard edge + railing
  const haz = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d99a1c';
    for (let i = -2; i < 8; i++) { g.beginPath(); g.moveTo(i * 48, h); g.lineTo(i * 48 + 24, h); g.lineTo(i * 48 + 56, 0); g.lineTo(i * 48 + 32, 0); g.fill(); }
  });
  haz.repeat.set(30, 1);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(64, 0.5, 0.6), std(0xffffff, 0.7, 0.4, { map: haz }));
  edge.position.set(0, -0.24, -7.7);
  s.add(edge);
  const dark = std(0x24201e, 0.6, 0.85);
  const darker = std(0x151312, 0.7, 0.8);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 64, 8), dark);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, 1.0, -7.8);
  s.add(rail);
  const postGeo = new THREE.BoxGeometry(0.14, 1.1, 0.14);
  const posts = new THREE.InstancedMesh(postGeo, dark, 33);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 33; i++) { m4.makeTranslation(-32 + i * 2, 0.5, -7.8); posts.setMatrixAt(i, m4); }
  s.add(posts);

  // molten pool
  const lava = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `precision highp float; uniform float uTime; varying vec2 vUv; ${NOISE}
      void main(){
        vec2 p = vUv * vec2(26.0, 12.0);
        float n = fbm(p + vec2(uTime * 0.12, uTime * 0.05));
        float n2 = fbm(p * 2.3 - vec2(uTime * 0.2, 0.0) + n * 2.0);
        float crust = smoothstep(0.42, 0.62, n2);
        vec3 hot = mix(vec3(1.9, 0.5, 0.05), vec3(3.2, 1.7, 0.4), smoothstep(0.25, 0.0, n2));
        vec3 col = mix(hot, vec3(0.05, 0.015, 0.01), crust);
        col += vec3(0.7, 0.16, 0.02) * smoothstep(0.7, 0.4, n2) * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(90, 34), lava);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, -2.6, -26);
  s.add(pool);
  A.updaters.push((dt, t) => (lava.uniforms.uTime.value = t));
  const lavaLight = new THREE.PointLight(0xff6a1e, 34, 40, 1.6);
  lavaLight.position.set(0, 1.5, -12);
  s.add(lavaLight);
  A.updaters.push((dt, t) => (lavaLight.intensity = 34 + Math.sin(t * 3.1) * 5 + Math.sin(t * 7.3) * 3));

  // giant gears
  const gearGeo = (() => {
    const sh = new THREE.Shape();
    const teeth = 18, r0 = 5.2, r1 = 6.1;
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * TAU, a1 = ((i + 0.3) / teeth) * TAU, a2 = ((i + 0.5) / teeth) * TAU, a3 = ((i + 0.8) / teeth) * TAU;
      const pt = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
      if (i === 0) sh.moveTo(...pt(a0, r0));
      sh.lineTo(...pt(a1, r0)); sh.lineTo(...pt(a1 + 0.02, r1)); sh.lineTo(...pt(a2 + 0.06, r1)); sh.lineTo(...pt(a3, r0));
    }
    sh.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, 1.2, 0, TAU, true);
    sh.holes.push(hole);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * 3.3, Math.sin(a) * 3.3, 0.95, 0, TAU, true);
      sh.holes.push(h);
    }
    return new THREE.ExtrudeGeometry(sh, { depth: 0.9, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1, curveSegments: 10 });
  })();
  const gearMat = std(0x3a2e26, 0.5, 0.9);
  const gears = [[-10.5, 5.2, -17, 1, 1], [0.6, 8.6, -19, -1, 0.82], [11.5, 4.4, -16, 1, 1.05], [21, 10, -22, -1, 1.2], [-21, 11, -23, -1, 1.2]].map(([x, y, z, dir, sc]) => {
    const g = new THREE.Mesh(gearGeo, gearMat);
    g.position.set(x, y, z);
    g.scale.setScalar(sc);
    s.add(g);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.5 * sc, 1.5 * sc, 1.6, 20), darker);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(x, y, z + 0.4);
    s.add(hub);
    return { g, dir, sc };
  });
  A.updaters.push((dt) => { for (const g of gears) g.g.rotation.z += dt * 0.12 * g.dir / g.sc; });

  // back wall with furnace windows
  const wall = new THREE.Mesh(new THREE.BoxGeometry(110, 46, 2), std(0x1c1614, 0.85, 0.5));
  wall.position.set(0, 14, -34);
  s.add(wall);
  const winMat = glowMat(0xff7a22, 1.3);
  const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 3.4, 0.2), winMat, 26);
  const rnd = seeded(42);
  for (let i = 0; i < 26; i++) { m4.makeTranslation(-48 + i * 3.8 + rnd() * 1.2, 8 + Math.floor(rnd() * 4) * 6, -32.9); wins.setMatrixAt(i, m4); }
  s.add(wins);
  // I-beam columns + cross beams
  const beamGeo = new THREE.BoxGeometry(1.1, 30, 1.1);
  const beams = new THREE.InstancedMesh(beamGeo, dark, 10);
  [-26, -15, 15, 26].forEach((x, i) => { m4.makeTranslation(x, 12, -9.5); beams.setMatrixAt(i, m4); });
  [-32, -20, -7, 7, 20, 32].forEach((x, i) => { m4.makeTranslation(x, 12, -28); beams.setMatrixAt(4 + i, m4); });
  s.add(beams);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(70, 1.2, 1.2), dark);
  cross.position.set(0, 13.5, -9.5);
  s.add(cross);
  const cross2 = cross.clone();
  cross2.position.set(0, 17, -9.5);
  s.add(cross2);
  for (let i = 0; i < 14; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.2, 0.3), darker);
    d.position.set(-32 + i * 5, 15.2, -9.5);
    d.rotation.z = i % 2 ? 0.75 : -0.75;
    s.add(d);
  }
  // warning lamps
  const lamps = [];
  for (const x of [-15, 15]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), glowMat(0xff3a10, 3));
    l.position.set(x, 6.4, -8.9);
    s.add(l);
    lamps.push(l);
  }
  A.updaters.push((dt, t) => lamps.forEach((l, i) => l.material.color.setRGB(3 * (0.3 + 0.7 * Math.max(0, Math.sin(t * 3 + i * 3))) , 0.5, 0.1)));

  // crucible + pour
  const cru = new THREE.Group();
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1.8, 3.6, 20, 1, true), std(0x2a2422, 0.6, 0.9, { side: THREE.DoubleSide }));
  cru.add(bucket);
  const melt = new THREE.Mesh(new THREE.CircleGeometry(2.25, 20), glowMat(0xff8a1e, 2.2));
  melt.rotation.x = -Math.PI / 2;
  melt.position.y = 1.4;
  cru.add(melt);
  const band = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.16, 8, 24), darker);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.6;
  cru.add(band);
  cru.position.set(-5.5, 9.6, -14);
  cru.rotation.z = -0.5;
  s.add(cru);
  const pourMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `precision highp float; uniform float uTime; varying vec2 vUv; ${NOISE}
      void main(){ float n = vnoise(vec2(vUv.x * 6.0, vUv.y * 8.0 + uTime * 6.0)); float a = (0.55 + n * 0.6) * smoothstep(0.0, 0.08, vUv.y);
        gl_FragColor = vec4(vec3(2.6, 0.9, 0.12) * a, a); }`,
  });
  const pour = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 11, 10, 1, true), pourMat);
  pour.position.set(-3.6, 3.6, -14);
  s.add(pour);
  A.updaters.push((dt, t) => (pourMat.uniforms.uTime.value = t));
  // chains
  const linkGeo = new THREE.TorusGeometry(0.16, 0.05, 6, 10);
  const chains = new THREE.InstancedMesh(linkGeo, dark, 120);
  let ci = 0;
  const e = new THREE.Euler(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1.4, 1);
  for (const [x, z, n] of [[-5.5, -14, 14], [-9, -11, 20], [6, -12, 26], [13, -10.5, 18], [-17, -11, 22], [19, -13, 20]]) {
    for (let i = 0; i < n && ci < 120; i++) {
      e.set(0, i % 2 ? Math.PI / 2 : 0, 0);
      q.setFromEuler(e);
      p.set(x, 19 - i * 0.36, z);
      m4.compose(p, q, sc);
      chains.setMatrixAt(ci++, m4);
    }
  }
  chains.count = ci;
  s.add(chains);
  // pipes foreground silhouettes
  for (const [x, y, z, len, r] of [[-20, 9.5, -8.6, 30, 0.35], [14, 11, -8.8, 40, 0.5], [0, 12.4, -9.2, 70, 0.28]]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), darker);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(x, y, z);
    s.add(pipe);
  }
  A.shaft(0xff8a3a, -3.6, 3, -14, 0.6, 2.2, 12, 0.45);
  A.shaft(0xffb070, 9, 9, -6, 0.5, 3.2, 18, 0.6, 0.2);
  A.shaft(0xffb070, -11, 9, -5, 0.5, 3.2, 18, 0.5, -0.15);

  A.updaters.push((dt, t, F) => {
    if (!F) return;
    A.ambientT -= dt;
    if (A.ambientT <= 0) {
      A.ambientT = 0.03;
      const fx = F.fx;
      // rising embers from the pit
      fx.add.spawn(rand(-22, 22), rand(-1, 0.5), rand(-22, -8.5), rand(-0.6, 0.6), rand(1.2, 3.4), rand(-0.3, 0.3), { color: 0xffb060, color2: 0xff3a08, intensity: 3, life: rand(2, 4.5), size: rand(0.03, 0.08), size1: 0.01, kind: 0, gravity: -0.2, drag: 0.1 });
      // splash where the pour hits
      if (chance(0.5)) fx.add.spawn(-3.6 + rand(-0.3, 0.3), -1.6, -14, rand(-3, 3), rand(3, 8), rand(-2, 2), { color: 0xffe0a0, color2: 0xff5a10, intensity: 4, life: rand(0.5, 1.1), size: rand(0.05, 0.1), size1: 0.01, kind: 1, stretch: 0.05, gravity: 12, drag: 0.3 });
    }
  });
  A.grade = { shadow: 0xe8f2ff, high: 0xfff0e0, bloom: 0.42, exposure: 1.0 };
  return A;
}

// ===========================================================================
// NEON SKYDECK
// ===========================================================================
function skydeck(R) {
  const A = new Arena(R);
  const s = A.scene;
  s.background = new THREE.Color(0x05040c);
  s.fog = new THREE.Fog(0x0b0718, 30, 190);
  A.env({ top: 0x0a0a22, bottom: 0x100618, panels: [
    { color: 0xff3fd0, intensity: 3, pos: [-34, 8, -10], w: 24, h: 22 },
    { color: 0x2ae0ff, intensity: 3, pos: [34, 10, -6], w: 24, h: 22 },
    { color: 0xb8c8ff, intensity: 1.6, pos: [0, 34, 14], w: 30, h: 12 },
  ] }, 1.05);
  A.lights({
    key: { color: 0xdfe6ff, intensity: 2.2, pos: [3, 13, 10] },
    rims: [{ color: 0xff3fd0, intensity: 3.4, pos: [-9, 5, -8] }, { color: 0x2ae0ff, intensity: 3.4, pos: [9, 5, -8] }],
    hemi: { sky: 0x5a5a8a, ground: 0x2a1436, intensity: 0.7 },
  });
  const lines = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ff48d8'; g.lineWidth = 2.5;
    g.strokeRect(2, 2, w - 4, h - 4);
    g.strokeStyle = '#30e0ff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  });
  A.floor({ map: plateTexture('#16161d', '#07070a', null, { seed: 21, cells: 1 }), emissiveMap: lines, emissiveIntensity: 0.55, roughnessMap: roughTexture(9, 110, 100), rough: 0.5, metal: 0.55, reflect: 0.7, tint: 0x9aa0b8, repeat: [10, 4] });

  // parapet with neon tubes
  const dark = std(0x14141c, 0.5, 0.8);
  const par = new THREE.Mesh(new THREE.BoxGeometry(70, 1.1, 0.7), dark);
  par.position.set(0, 0.5, -8.2);
  s.add(par);
  const tube1 = new THREE.Mesh(new THREE.BoxGeometry(70, 0.07, 0.07), glowMat(0xff3fd0, 1.8));
  tube1.position.set(0, 1.1, -7.85);
  s.add(tube1);
  const tube2 = new THREE.Mesh(new THREE.BoxGeometry(70, 0.05, 0.05), glowMat(0x2ae0ff, 1.8));
  tube2.position.set(0, 0.25, -7.83);
  s.add(tube2);

  // city: instanced towers with procedural windows
  const cityMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFog: { value: new THREE.Color(0x0b0718) } },
    vertexShader: /* glsl */ `
      attribute vec3 aTint; varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying float vSeed; varying float vDist;
      void main(){
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normal; vTint = aTint; vSeed = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.11;
        vec4 mv = viewMatrix * w; vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float; uniform float uTime; uniform vec3 uFog; varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying float vSeed; varying float vDist;
      ${NOISE}
      void main(){
        vec2 uv = abs(vN.x) > 0.5 ? vW.zy : vW.xy;
        vec2 cell = uv * vec2(2.6, 1.7);
        vec2 id = floor(cell); vec2 f = fract(cell);
        float lit = step(0.66, hash21(id + floor(vSeed * 13.0)));
        float flick = step(0.985, hash21(id + floor(uTime * 1.5)));
        float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.78);
        float top = step(0.5, vN.y);
        vec3 base = vec3(0.012, 0.012, 0.022) + vTint * 0.012;
        vec3 col = base + vTint * win * lit * (1.0 - flick * 0.7) * (0.12 + hash21(id * 1.7) * 0.62) * (1.0 - top);
        float fog = smoothstep(30.0, 190.0, vDist);
        col = mix(col, uFog, fog * 0.92);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const N = 150;
  const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cityMat, N);
  const tints = new Float32Array(N * 3);
  const rnd = seeded(77);
  const pal = [[1, 0.25, 0.85], [0.2, 0.9, 1], [1, 0.7, 0.3], [0.6, 0.5, 1], [0.9, 0.95, 1]];
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const z = -44 - rnd() * 130;
    const x = (rnd() - 0.5) * (120 + -z * 1.3);
    const w = 6 + rnd() * 12, d = 6 + rnd() * 12, h = 30 + rnd() * 90 * (rnd() < 0.2 ? 1.6 : 1);
    pos.set(x, -60 + h / 2 + rnd() * 10, z);
    scl.set(w, h, d);
    m4.compose(pos, quat, scl);
    city.setMatrixAt(i, m4);
    const c = pal[(rnd() * pal.length) | 0];
    tints.set(c, i * 3);
  }
  city.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
  city.frustumCulled = false;
  s.add(city);
  A.updaters.push((dt, t) => (cityMat.uniforms.uTime.value = t));

  // holo billboards
  const holo = (x, y, z, w, h, c1, c2, seed, ry = 0) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, c1: { value: new THREE.Color(c1) }, c2: { value: new THREE.Color(c2) }, uSeed: { value: seed } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `precision highp float; uniform float uTime, uSeed; uniform vec3 c1, c2; varying vec2 vUv; ${NOISE}
        void main(){
          vec2 uv = vUv;
          float scan = 0.75 + 0.25 * sin(uv.y * 240.0 + uTime * 6.0);
          float frame = step(uv.x, 0.02) + step(0.98, uv.x) + step(uv.y, 0.03) + step(0.97, uv.y);
          // glyph rows
          vec2 g = vec2(uv.x * 14.0 + floor(uv.y * 6.0) * 3.7 - uTime * (0.4 + uSeed * 0.1), uv.y * 6.0);
          vec2 gi = floor(g); vec2 gf = fract(g);
          float gl = step(0.35, hash21(gi + uSeed)) * step(0.15, gf.x) * step(gf.x, 0.85) * step(0.25, gf.y) * step(gf.y, 0.75);
          float rowMask = step(0.5, fract(uv.y * 3.0 + 0.25));
          // big emblem: rotating ring + chevron
          vec2 c = (uv - vec2(0.5, 0.56)) * vec2(1.0, 1.0);
          float d = length(c * vec2(${(1).toFixed(1)}, 1.0));
          float ang = atan(c.y, c.x) + uTime * 0.7;
          float ring = smoothstep(0.02, 0.0, abs(d - 0.26)) * step(0.3, fract(ang / 6.2831 * 6.0));
          float ring2 = smoothstep(0.012, 0.0, abs(d - 0.19));
          float tri = smoothstep(0.02, 0.0, abs(abs(c.x) * 1.4 + c.y - 0.08)) * step(-0.12, c.y) * step(d, 0.17);
          float glitch = step(0.96, hash21(vec2(floor(uv.y * 30.0), floor(uTime * 9.0))));
          float a = (gl * rowMask * 0.55 * step(uv.y, 0.3) + ring + ring2 * 0.7 + tri + frame * 0.8 + 0.06) * scan;
          vec3 col = mix(c1, c2, uv.y + glitch * 0.5) * a * 1.5;
          gl_FragColor = vec4(col, a);
        }`,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    s.add(m);
    A.updaters.push((dt, t) => (mat.uniforms.uTime.value = t));
  };
  holo(-15, 8.5, -16, 10, 13, 0xff3fd0, 0x7a5cff, 1.3, 0.25);
  holo(16, 10, -20, 13, 9, 0x2ae0ff, 0x3a7bff, 4.1, -0.3);
  holo(1, 15, -34, 20, 8, 0xffb23a, 0xff3fd0, 7.7, 0);
  // billboard masts
  for (const [x, z, h] of [[-15, -16.3, 16], [16, -20.3, 16], [-24, -10, 22], [25, -11, 26]]) {
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.5, h, 0.5), dark);
    mast.position.set(x, h / 2 - 2, z);
    s.add(mast);
  }
  // rooftop props: AC units, antennae with blinkers
  const prop = std(0x1c1c26, 0.6, 0.7);
  for (const [x, z, w, h, d] of [[-22, -6.4, 4, 2.2, 2.2], [-27, -5, 3, 3.4, 3], [23, -6.6, 5, 1.8, 2], [28.5, -4.5, 3, 4, 3]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), prop);
    b.position.set(x, h / 2, z);
    b.castShadow = true;
    s.add(b);
  }
  const blinkers = [];
  for (const [x, z, h] of [[-24, -10, 22], [25, -11, 26], [-34, -30, 40], [40, -44, 52]]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), glowMat(0xff2020, 4));
    b.position.set(x, h - 1.8, z);
    s.add(b);
    blinkers.push(b);
  }
  A.updaters.push((dt, t) => blinkers.forEach((b, i) => (b.visible = Math.sin(t * 2.2 + i * 1.9) > 0.2)));
  // searchlights
  const beams = [];
  for (const [x, z, c] of [[-40, -70, 0x8fa8ff], [36, -90, 0xff9af0], [8, -110, 0x9ff0ff]]) {
    const b = A.shaft(c, x, 20, z, 0.6, 7, 120, 1.3);
    b.geometry.translate(0, 60, 0);
    b.position.y = -20;
    beams.push(b);
  }
  A.updaters.push((dt, t) => beams.forEach((b, i) => { b.rotation.z = Math.sin(t * 0.21 + i * 2) * 0.5; b.rotation.x = Math.sin(t * 0.17 + i) * 0.25; }));
  // flying traffic
  const cars = [];
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 0.5), glowMat(i % 2 ? 0xff5a3a : 0xbfe8ff, 3));
    c.userData = { z: -40 - rnd() * 90, y: 4 + rnd() * 34, sp: (6 + rnd() * 10) * (i % 2 ? 1 : -1), off: rnd() * 200 };
    s.add(c);
    cars.push(c);
  }
  A.updaters.push((dt, t) => cars.forEach((c) => {
    const u = c.userData;
    c.position.set((((t * u.sp + u.off) % 260) + 260) % 260 - 130, u.y, u.z);
  }));

  A.updaters.push((dt, t, F) => {
    if (!F) return;
    const fx = F.fx;
    // rain
    const n = Math.round(dt * 520 * fx.density);
    for (let i = 0; i < n; i++) {
      fx.add.spawn(rand(-16, 16), rand(9, 13), rand(-7, 5), -1.5, -24, 0, { color: 0x8fa8d8, intensity: 0.5, life: 0.46, size: 0.012, size1: 0.012, kind: 1, stretch: 0.11, gravity: 0, floor: false, alpha: 0.6 });
    }
    A.ambientT -= dt;
    if (A.ambientT <= 0) {
      A.ambientT = 0.07;
      fx.ring({ x: rand(-11, 11), y: 0.02, z: rand(-6, 4) }, { color: 0x8fb0ff, r0: 0.02, r1: rand(0.18, 0.4), dur: 0.45, ground: true, width: 0.12, alpha: 0.28, intensity: 0.8 });
    }
  });
  A.grade = { shadow: 0xe6e0ff, high: 0xfff0fa, bloom: 0.5, exposure: 1.0 };
  return A;
}

// ===========================================================================
// CRYO VAULT 9
// ===========================================================================
function cryo(R) {
  const A = new Arena(R);
  const s = A.scene;
  s.background = new THREE.Color(0x060b12);
  s.fog = new THREE.Fog(0x0a141f, 16, 70);
  A.env({ top: 0x2a4258, bottom: 0x060a10, panels: [
    { color: 0xd8f0ff, intensity: 3, pos: [0, 34, 4], w: 40, h: 14 },
    { color: 0x38c8ff, intensity: 2.6, pos: [-30, 6, -14], w: 20, h: 20 },
    { color: 0x7ad8ff, intensity: 2.2, pos: [30, 6, -14], w: 20, h: 20 },
  ] }, 1.1);
  A.lights({
    key: { color: 0xeaf6ff, intensity: 2.7, pos: [-4, 14, 9] },
    rims: [{ color: 0x38c8ff, intensity: 3, pos: [9, 5, -8] }, { color: 0x9fb8ff, intensity: 2, pos: [-9, 6, -8] }],
    hemi: { sky: 0x9fc4de, ground: 0x1c2c3c, intensity: 0.85 },
  });
  const lines = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#48d8ff'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 6); g.lineTo(w, 6); g.stroke();
    g.fillStyle = '#48d8ff';
    for (let i = 0; i < 4; i++) g.fillRect(40 + i * 120, h - 30, 60, 4);
  });
  const frost = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#56646f'; g.fillRect(0, 0, w, h);
    const rnd = seeded(5);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 90;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(225,240,250,0.2)'); gr.addColorStop(1, 'rgba(225,240,250,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.strokeStyle = '#27313a'; g.lineWidth = 4;
    g.strokeRect(0, 0, w, h);
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
  });
  A.floor({ map: frost, emissiveMap: lines, emissiveIntensity: 0.7, roughnessMap: roughTexture(13, 140, 110), rough: 0.55, metal: 0.5, reflect: 0.65, tint: 0xd0e2ee, repeat: [12, 5] });

  const steel = std(0x54626e, 0.45, 0.85);
  const darkSteel = std(0x1c242c, 0.55, 0.85);
  const cyan = glowMat(0x48d8ff, 2.6);
  // vault wall
  const wall = new THREE.Mesh(new THREE.BoxGeometry(80, 30, 2), std(0x27323c, 0.6, 0.7));
  wall.position.set(0, 13, -13);
  wall.receiveShadow = true;
  s.add(wall);
  // wall panel seams
  const seam = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 30, 0.2), darkSteel, 21);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 21; i++) { m4.makeTranslation(-40 + i * 4, 13, -11.95); seam.setMatrixAt(i, m4); }
  s.add(seam);
  // the vault door
  const door = new THREE.Group();
  door.position.set(0, 5.4, -11.6);
  s.add(door);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.8, 48), steel);
  disc.rotation.x = Math.PI / 2;
  door.add(disc);
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.38, 10, 64), darkSteel);
  door.add(ringA);
  const ringGlow = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.05, 6, 64), cyan);
  ringGlow.position.z = 0.45;
  door.add(ringGlow);
  const lock = new THREE.Group();
  lock.position.z = 0.5;
  door.add(lock);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.7, 12), darkSteel);
  hub.rotation.x = Math.PI / 2;
  lock.add(hub);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.36, 0.3), darkSteel);
    spoke.position.set(Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0);
    spoke.rotation.z = a;
    lock.add(spoke);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 8), steel);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(Math.cos(a) * 4.3, Math.sin(a) * 4.3, 0);
    lock.add(bolt);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.08), cyan);
    led.position.set(Math.cos(a + 0.2) * 3.5, Math.sin(a + 0.2) * 3.5, 0.2);
    led.rotation.z = a + 0.2;
    lock.add(led);
  }
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), cyan);
  eye.position.z = 0.9;
  door.add(eye);
  A.updaters.push((dt, t) => { lock.rotation.z = Math.sin(t * 0.25) * 0.8; ringGlow.rotation.z -= dt * 0.2; eye.scale.setScalar(0.8 + Math.sin(t * 2) * 0.15); });

  // cryo tubes
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fdcff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false });
  const coreMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `precision highp float; uniform float uTime; varying vec2 vUv; varying vec3 vP; ${NOISE}
      void main(){ float n = fbm(vec2(vUv.x * 5.0 + vP.x, vUv.y * 5.0 - uTime * 0.5)); float b = 0.5 + n * 1.6 + smoothstep(0.96, 1.0, sin(vUv.y * 20.0 - uTime * 2.0 + vP.x)) * 1.5;
        gl_FragColor = vec4(vec3(0.2, 0.8, 1.2) * b, 1.0); }`,
  });
  A.updaters.push((dt, t) => (coreMat.uniforms.uTime.value = t));
  for (const [x, z] of [[-8.5, -9.2], [-12.5, -8.2], [-17, -9.4], [8.5, -9.2], [12.5, -8.2], [17, -9.4], [-23, -8], [23, -8]]) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, 1, 16), darkSteel);
    base.position.set(x, 0.5, z);
    base.castShadow = true;
    s.add(base);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.25, 1.2, 16), darkSteel);
    cap.position.set(x, 7.4, z);
    s.add(cap);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 6, 20, 1, true), glass);
    tube.position.set(x, 4, z);
    tube.renderOrder = 3;
    s.add(tube);
    const core = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 3.4, 4, 10), coreMat);
    core.position.set(x, 4, z);
    s.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.06, 6, 24), cyan);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 1.05, z);
    s.add(ring);
    const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 6, 8), darkSteel);
    hose.position.set(x, 10.6, z);
    s.add(hose);
  }
  // ice formations
  const ice = new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, roughness: 0.12, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.86 });
  const iceGeo = new THREE.ConeGeometry(0.5, 1, 5);
  const iceI = new THREE.InstancedMesh(iceGeo, ice, 90);
  const rnd = seeded(31);
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), eul = new THREE.Euler();
  for (let i = 0; i < 90; i++) {
    const cluster = [-21, -14.5, -10.5, 10.5, 14.5, 21, -28, 28][i % 8];
    const up = i < 62;
    const h = up ? 0.6 + rnd() * 2.6 : 0.8 + rnd() * 2.8;
    pos.set(cluster + (rnd() - 0.5) * 4.4, up ? h / 2 - 0.05 : 12.2 - h / 2, -7.8 - rnd() * 2.6 + (up ? 0 : 0.5));
    eul.set((rnd() - 0.5) * 0.5 + (up ? 0 : Math.PI), rnd() * 6, (rnd() - 0.5) * 0.5);
    quat.setFromEuler(eul);
    scl.set(0.5 + rnd() * 0.9, h, 0.5 + rnd() * 0.9);
    m4.compose(pos, quat, scl);
    iceI.setMatrixAt(i, m4);
  }
  iceI.castShadow = true;
  s.add(iceI);
  // ceiling gantry + lamps
  const gantry = new THREE.Mesh(new THREE.BoxGeometry(80, 1, 3), darkSteel);
  gantry.position.set(0, 12.6, -8.5);
  s.add(gantry);
  for (const x of [-18, -9, 0, 9, 18]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.7), glowMat(0xdaf2ff, 3));
    lamp.position.set(x, 12.05, -7.6);
    s.add(lamp);
    A.shaft(0xbfe6ff, x, 6, -7.2, 0.8, 3.4, 12.4, 0.75);
  }
  // side bulkheads
  for (const sx of [-1, 1]) {
    const bulk = new THREE.Mesh(new THREE.BoxGeometry(3, 26, 12), std(0x202a33, 0.6, 0.7));
    bulk.position.set(sx * 33, 12, -7);
    s.add(bulk);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 10, 0.15), cyan);
    strip.position.set(sx * 31.4, 5, -1.2);
    s.add(strip);
  }
  const vaultLight = new THREE.PointLight(0x48d8ff, 40, 30, 1.7);
  vaultLight.position.set(0, 5, -8);
  s.add(vaultLight);

  A.updaters.push((dt, t, F) => {
    if (!F) return;
    A.ambientT -= dt;
    if (A.ambientT <= 0) {
      A.ambientT = 0.045;
      const fx = F.fx;
      fx.add.spawn(rand(-16, 16), rand(1, 10), rand(-8, 5), rand(-0.5, 0.1), rand(-0.6, -0.1), rand(-0.1, 0.2), { color: 0xdff4ff, intensity: 1.2, life: rand(3, 6), size: rand(0.02, 0.05), size1: 0.02, kind: 0, gravity: 0, drag: 0, alpha: 0.8 });
      if (chance(0.2)) fx.alpha.spawn(rand(-18, 18), 0.15, rand(-7.5, -5), rand(-0.6, 0.6), 0.1, rand(0.1, 0.5), { color: 0xcfe6f4, color2: 0xaac4d4, life: rand(2.5, 4), size: rand(1.2, 2), size1: rand(2.6, 4), kind: 2, drag: 0.4, gravity: 0, alpha: 0.12 });
    }
  });
  A.grade = { shadow: 0xdcecff, high: 0xf4fbff, bloom: 0.42, exposure: 0.98 };
  return A;
}

// ===========================================================================
// ORBITAL CROWN
// ===========================================================================
function orbital(R) {
  const A = new Arena(R);
  const s = A.scene;
  s.background = new THREE.Color(0x010103);
  A.env({ top: 0x05060c, bottom: 0x0a0806, panels: [
    { color: 0xfff4e0, intensity: 6, pos: [-28, 26, 14], w: 16, h: 16 },
    { color: 0xffc04a, intensity: 2.4, pos: [32, 4, -12], w: 20, h: 20 },
    { color: 0x4a8cff, intensity: 2, pos: [0, -30, -20], w: 50, h: 20 },
  ] }, 1.0);
  A.lights({
    key: { color: 0xfff2dc, intensity: 3.3, pos: [-7, 13, 8] },
    rims: [{ color: 0xffb637, intensity: 3, pos: [9, 4, -8] }, { color: 0x4a8cff, intensity: 2.4, pos: [-8, 2, -9] }],
    hemi: { sky: 0x5a6a9a, ground: 0x3a2c1a, intensity: 0.6 },
  });
  const hexTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#1d1f26'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#0a0b0e'; g.lineWidth = 5;
    const r = 64;
    for (let j = -1; j < 6; j++) for (let i = -1; i < 6; i++) {
      const cx = i * r * 1.5, cy = j * r * 1.732 + (i % 2 ? r * 0.866 : 0);
      g.beginPath();
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      g.closePath(); g.stroke();
    }
  });
  const gold = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffc54a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, 8); g.lineTo(w, 8); g.stroke();
    g.beginPath(); g.moveTo(0, h - 8); g.lineTo(w, h - 8); g.stroke();
  });
  A.floor({ map: hexTex, emissiveMap: gold, emissiveIntensity: 0.45, roughnessMap: roughTexture(17, 120, 90), rough: 0.42, metal: 0.85, reflect: 0.7, tint: 0xc4c8d4, size: [46, 16], repeat: [9.2, 3.2], z: 0 });
  // platform rim
  const goldMat = std(0xd9a520, 0.28, 1);
  const dark = std(0x15171c, 0.5, 0.85);
  for (const z of [-8, 8]) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(46.6, 0.7, 0.5), dark);
    rim.position.set(0, -0.33, z);
    s.add(rim);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(46.6, 0.05, 0.06), glowMat(0xffc54a, 1.3));
    strip.position.set(0, 0.03, z + (z < 0 ? 0.3 : -0.3));
    s.add(strip);
  }
  const under = new THREE.Mesh(new THREE.BoxGeometry(46, 2.4, 15.6), dark);
  under.position.set(0, -1.6, 0);
  s.add(under);
  // crown pylons
  const pylGeo = new THREE.CylinderGeometry(0.22, 0.5, 7, 6);
  for (const [x, z] of [[-13, -7.2], [13, -7.2], [-21, -6.6], [21, -6.6]]) {
    const p = new THREE.Mesh(pylGeo, dark);
    p.position.set(x, 3.5, z);
    p.castShadow = true;
    s.add(p);
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), goldMat);
    tip.position.set(x, 7.6, z);
    s.add(tip);
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), glowMat(0xfff0b0, 4));
    g.position.set(x, 7.6, z);
    s.add(g);
    A.updaters.push((dt, t) => { tip.rotation.y += dt * 1.2; tip.position.y = 7.6 + Math.sin(t * 1.4 + x) * 0.15; g.position.y = tip.position.y; });
  }

  // stars
  const starN = 3200;
  const sp = new Float32Array(starN * 3), sc = new Float32Array(starN * 3);
  const rnd = seeded(99);
  for (let i = 0; i < starN; i++) {
    const u = rnd() * 2 - 1, th = rnd() * TAU, r = 300;
    const q = Math.sqrt(1 - u * u);
    sp[i * 3] = Math.cos(th) * q * r; sp[i * 3 + 1] = u * r; sp[i * 3 + 2] = Math.sin(th) * q * r;
    const b = 0.4 + rnd() * 2.2, tint = rnd();
    sc[i * 3] = b * (tint < 0.2 ? 1.2 : 0.9); sc[i * 3 + 1] = b * 0.95; sc[i * 3 + 2] = b * (tint > 0.8 ? 1.3 : 1);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, toneMapped: false, depthWrite: false }));
  stars.frustumCulled = false;
  s.add(stars);
  A.updaters.push((dt) => (stars.rotation.y += dt * 0.004));

  // planet
  const planetMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(-0.62, 0.55, 0.56).normalize() } },
    vertexShader: `varying vec3 vN; varying vec3 vP; varying vec3 vV; void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = position; vec4 w = modelMatrix*vec4(position,1.0); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `precision highp float; uniform float uTime; uniform vec3 uSun; varying vec3 vN; varying vec3 vP; varying vec3 vV; ${NOISE}
      void main(){
        vec3 n = normalize(vN);
        vec3 p = normalize(vP);
        float lat = p.y;
        float lon = atan(p.z, p.x) + uTime * 0.006;
        float bands = fbm(vec2(lon * 2.0 + fbm(vec2(lon * 3.0, lat * 9.0)) * 1.4, lat * 9.0));
        float storm = fbm(vec2(lon * 7.0 - uTime * 0.01, lat * 22.0));
        vec3 a = vec3(0.05, 0.16, 0.34), b = vec3(0.55, 0.36, 0.2), c = vec3(0.85, 0.8, 0.72);
        vec3 col = mix(a, b, smoothstep(0.35, 0.65, bands));
        col = mix(col, c, smoothstep(0.55, 0.8, storm) * 0.6);
        float day = smoothstep(-0.15, 0.5, dot(n, uSun));
        // city lights on the night side
        float lights = step(0.78, vnoise(vec2(lon * 90.0, lat * 90.0))) * smoothstep(0.5, 0.62, bands) * (1.0 - day);
        float fres = pow(clamp(1.0 - dot(n, normalize(vV)), 0.0001, 1.0), 2.6);
        vec3 atm = vec3(0.3, 0.6, 1.4) * fres * (0.25 + day * 1.4);
        gl_FragColor = vec4(col * day * 0.4 + vec3(1.6, 1.0, 0.4) * lights * 0.5 + atm * 0.3, 1.0);
      }`,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(120, 64, 48), planetMat);
  planet.position.set(40, -118, -190);
  planet.rotation.z = 0.3;
  s.add(planet);
  A.updaters.push((dt, t) => (planetMat.uniforms.uTime.value = t));
  // atmosphere halo
  const halo = new THREE.Mesh(new THREE.SphereGeometry(124, 48, 32), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `precision highp float; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(clamp(dot(normalize(vN), -normalize(vV)), 0.0001, 1.0), 3.0); gl_FragColor = vec4(vec3(0.25, 0.55, 1.3) * f * 0.4, f); }`,
  }));
  halo.position.copy(planet.position);
  s.add(halo);
  // sun
  const sunTex = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(255,244,220,0.9)'); gr.addColorStop(0.25, 'rgba(255,200,120,0.25)'); gr.addColorStop(1, 'rgba(255,160,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, color: new THREE.Color(5, 4.6, 4), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  sun.position.set(-150, 95, -210);
  sun.scale.setScalar(120);
  s.add(sun);

  // the Crown: a colossal station ring with running lights
  const crown = new THREE.Group();
  crown.position.set(0, 6, -60);
  crown.rotation.set(1.25, 0, 0.12);
  s.add(crown);
  const ringMat = std(0x2a2e38, 0.45, 0.9);
  const big = new THREE.Mesh(new THREE.TorusGeometry(64, 2.2, 10, 120), ringMat);
  crown.add(big);
  const big2 = new THREE.Mesh(new THREE.TorusGeometry(58, 0.7, 8, 120), goldMat);
  crown.add(big2);
  const lightN = 160;
  const lGeo = new THREE.BoxGeometry(0.9, 0.35, 0.35);
  const lInst = new THREE.InstancedMesh(lGeo, glowMat(0xffe2a0, 1.8), lightN);
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(1, 1, 1), eul = new THREE.Euler();
  for (let i = 0; i < lightN; i++) {
    const a = (i / lightN) * TAU;
    pos.set(Math.cos(a) * 64, Math.sin(a) * 64, i % 2 ? 2.3 : -2.3);
    eul.set(0, 0, a + Math.PI / 2);
    quat.setFromEuler(eul);
    m4.compose(pos, quat, scl);
    lInst.setMatrixAt(i, m4);
  }
  crown.add(lInst);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(60, 0.8, 0.8), ringMat);
    spoke.position.set(Math.cos(a) * 32, Math.sin(a) * 32, 0);
    spoke.rotation.z = a;
    crown.add(spoke);
  }
  A.updaters.push((dt) => (crown.rotation.z += dt * 0.012));

  // spectator stands: thousands of tiny lights on two floating arcs
  const crowdMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `attribute vec3 aCol; varying vec3 vC; varying float vS; void main(){ vC = aCol; vS = float(gl_InstanceID); gl_Position = projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0); }`,
    fragmentShader: `precision highp float; uniform float uTime; varying vec3 vC; varying float vS; void main(){ float f = 0.45 + 0.55 * step(0.5, fract(sin(vS * 12.9898) * 43758.5 + uTime * (0.3 + fract(vS * 0.37)))); gl_FragColor = vec4(vC * f * 0.8, 1.0); }`,
  });
  const CN = 1500;
  const crowd = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.07), crowdMat, CN);
  const cc = new Float32Array(CN * 3);
  const palette = [[1, 0.78, 0.3], [1, 1, 1], [0.4, 0.7, 1], [1, 0.4, 0.3]];
  for (let i = 0; i < CN; i++) {
    const side = i % 2 ? 1 : -1;
    const u = rnd(), v = rnd();
    const ang = (0.25 + u * 0.5) * Math.PI;
    pos.set(Math.cos(ang) * 34, 2.2 + v * 5.5 + Math.sin(ang) * 1.5, -16 - Math.sin(ang) * 16 - v * 6);
    m4.makeTranslation(pos.x, pos.y, pos.z);
    crowd.setMatrixAt(i, m4);
    cc.set(palette[(rnd() * 4) | 0], i * 3);
  }
  crowd.geometry.setAttribute('aCol', new THREE.InstancedBufferAttribute(cc, 3));
  crowd.frustumCulled = false;
  s.add(crowd);
  A.updaters.push((dt, t) => (crowdMat.uniforms.uTime.value = t));
  const stand = new THREE.Mesh(new THREE.TorusGeometry(34, 5.5, 4, 48, Math.PI * 0.5), new THREE.MeshStandardMaterial({ color: 0x0c0d12, roughness: 0.8, metalness: 0.5, side: THREE.DoubleSide }));
  stand.rotation.set(Math.PI / 2 - 0.28, 0, Math.PI * 0.25);
  stand.position.set(0, 4.5, -15);
  stand.scale.set(1, 1, 1);
  s.add(stand);

  // camera drones
  const drones = [];
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Group();
    d.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.28), ringMat));
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), glowMat(i % 2 ? 0xff4030 : 0x60c8ff, 4));
    l.position.z = 0.26;
    d.add(l);
    s.add(d);
    drones.push(d);
  }
  A.updaters.push((dt, t) => drones.forEach((d, i) => {
    d.position.set(Math.sin(t * 0.23 + i * 1.7) * 14, 6.5 + Math.sin(t * 0.5 + i) * 1.5, -9 + Math.cos(t * 0.31 + i * 2.1) * 2.5);
    d.rotation.y = t * 0.6 + i;
  }));
  A.shaft(0xfff0d0, -9, 8, -5, 0.5, 4, 17, 0.5, -0.5);
  A.shaft(0xffd890, 11, 8, -6, 0.5, 4, 17, 0.4, 0.45);

  A.updaters.push((dt, t, F) => {
    if (!F) return;
    A.ambientT -= dt;
    if (A.ambientT <= 0) {
      A.ambientT = 0.09;
      F.fx.add.spawn(rand(-18, 18), rand(0.5, 9), rand(-7, 4), rand(-0.2, 0.2), rand(0.05, 0.3), 0, { color: 0xffd98a, intensity: 1.6, life: rand(2, 4), size: rand(0.02, 0.045), size1: 0.0, kind: 0, gravity: 0, drag: 0 });
    }
  });
  A.grade = { shadow: 0xe4ecff, high: 0xfff6e6, bloom: 0.46, exposure: 1.0 };
  return A;
}

// ===========================================================================
// HANGAR (menus / garage)
// ===========================================================================
function hangar(R) {
  const A = new Arena(R);
  const s = A.scene;
  s.background = new THREE.Color(0x05070a);
  s.fog = new THREE.Fog(0x070a0f, 14, 48);
  A.env({ top: 0x1c2836, bottom: 0x05070a, panels: [
    { color: 0xffffff, intensity: 3.2, pos: [0, 30, 8], w: 26, h: 10 },
    { color: 0x4aa8ff, intensity: 2.4, pos: [-26, 8, -4], w: 14, h: 22 },
    { color: 0xff8a3a, intensity: 2.0, pos: [26, 6, -6], w: 14, h: 22 },
  ] }, 1.15);
  A.lights({
    key: { color: 0xfff4e6, intensity: 2.8, pos: [4, 10, 8] },
    rims: [{ color: 0x4aa8ff, intensity: 3.2, pos: [-7, 5, -7] }, { color: 0xff8a3a, intensity: 2.2, pos: [8, 3, -6] }],
    hemi: { sky: 0x7088a8, ground: 0x1a1612, intensity: 0.7 },
  });
  A.floor({ map: plateTexture('#20242b', '#0b0d10', '#2f7fd0', { seed: 3 }), roughnessMap: roughTexture(23, 120, 100), rough: 0.45, metal: 0.8, reflect: 0.75, tint: 0xaab4c4, size: [60, 40], repeat: [15, 10], z: -6 });
  const dark = std(0x171b21, 0.5, 0.85);
  const mid = std(0x2a313b, 0.5, 0.8);
  // turntable
  const table = new THREE.Group();
  s.add(table);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 3.0, 0.22, 48), dark);
  base.position.y = 0.11;
  base.receiveShadow = true;
  table.add(base);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.45, 0.06, 48), mid);
  top.position.y = 0.24;
  top.receiveShadow = true;
  table.add(top);
  const ringMat = glowMat(0x4ac8ff, 1.5);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.58, 0.035, 6, 96), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.25;
  table.add(ring);
  const ticks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.02, 0.05), ringMat, 24);
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(1, 1, 1), eul = new THREE.Euler();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    pos.set(Math.cos(a) * 2.2, 0.275, Math.sin(a) * 2.2);
    eul.set(0, -a, 0);
    quat.setFromEuler(eul);
    m4.compose(pos, quat, scl);
    ticks.setMatrixAt(i, m4);
  }
  table.add(ticks);
  A.table = table;
  A.tableTop = 0.27;
  A.accent = (c) => ringMat.color.set(c).multiplyScalar(1.5);
  // back wall with light bars
  const wall = new THREE.Mesh(new THREE.BoxGeometry(70, 26, 1), std(0x12161b, 0.7, 0.6));
  wall.position.set(0, 12, -13);
  s.add(wall);
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 7.5, 0.08), glowMat(0x4a9cff, 1.25), 28);
  for (let i = 0; i < 28; i++) { m4.makeTranslation(-27 + i * 2 + (i % 2 ? 0.26 : 0), 5.4 + (i % 2 ? 0.8 : 0), -12.4); bars.setMatrixAt(i, m4); }
  s.add(bars);
  // horizontal wall banding + status panels
  const bands = new THREE.InstancedMesh(new THREE.BoxGeometry(70, 0.16, 0.2), dark, 6);
  for (let i = 0; i < 6; i++) { m4.makeTranslation(0, 1.4 + i * 2.1, -12.35); bands.setMatrixAt(i, m4); }
  s.add(bands);
  const panelMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `precision highp float; uniform float uTime; varying vec2 vUv; ${NOISE}
      void main(){
        vec2 g = vec2(vUv.x * 18.0, vUv.y * 10.0); vec2 gi = floor(g); vec2 gf = fract(g);
        float cell = step(0.45, hash21(gi + floor(uTime * 0.6 + gi.y * 0.3))) * step(0.12, gf.x) * step(gf.x, 0.88) * step(0.3, gf.y) * step(gf.y, 0.7);
        float bar = step(vUv.x, 0.35 + 0.3 * sin(uTime * 0.7 + floor(vUv.y * 5.0))) * step(0.4, fract(vUv.y * 5.0)) * step(vUv.y, 0.4);
        float frame = step(vUv.x, 0.012) + step(0.988, vUv.x) + step(vUv.y, 0.03) + step(0.97, vUv.y);
        float a = (cell * 0.5 * step(0.45, vUv.y) + bar * 0.7 + frame + 0.04) * (0.8 + 0.2 * sin(vUv.y * 160.0 + uTime * 4.0));
        gl_FragColor = vec4(vec3(0.25, 0.62, 1.0) * a * 0.9, a);
      }`,
  });
  for (const [x, y, w, h] of [[-8.6, 6.6, 4.4, 2.6], [8.6, 6.6, 4.4, 2.6], [-15, 4.2, 3.2, 4.2], [15, 4.2, 3.2, 4.2]]) {
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(w, h), panelMat);
    pm.position.set(x, y, -11.3);
    s.add(pm);
  }
  A.updaters.push((dt, t) => (panelMat.uniforms.uTime.value = t));
  const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 26, 1.6), dark, 8);
  for (let i = 0; i < 8; i++) { m4.makeTranslation(-28 + i * 8, 12, -12.2); ribs.setMatrixAt(i, m4); }
  s.add(ribs);
  // gantry arms
  for (const sx of [-1, 1]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9, 0.9), dark);
    col.position.set(sx * 5.4, 4.5, -3.4);
    col.castShadow = true;
    s.add(col);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 0.6), mid);
    arm.position.set(sx * 4.0, 5.6, -3.2);
    arm.rotation.z = sx * 0.25;
    s.add(arm);
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), dark);
    claw.position.set(sx * 2.5, 4.8, -3.1);
    s.add(claw);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), glowMat(sx < 0 ? 0x4aa8ff : 0xff8a3a, 3));
    lamp.position.set(sx * 5.4, 4.4, -2.9);
    s.add(lamp);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 2), mid);
    crate.position.set(sx * 9.5, 0.8, -6);
    crate.rotation.y = sx * 0.3;
    crate.castShadow = true;
    s.add(crate);
    const crate2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.6), dark);
    crate2.position.set(sx * 9.2, 2.15, -6.1);
    crate2.rotation.y = sx * -0.2;
    s.add(crate2);
  }
  A.shaft(0xcfe4ff, 0, 7.5, -0.5, 0.7, 3.6, 15, 0.9);
  A.shaft(0x8fbfff, -7, 7.5, -5, 0.5, 2.6, 15, 0.5, -0.12);
  A.shaft(0xffc090, 7, 7.5, -5, 0.5, 2.6, 15, 0.4, 0.12);
  A.grade = { shadow: 0xe6eeff, high: 0xfff6ee, bloom: 0.42, exposure: 1.0 };
  return A;
}

const BUILDERS = { foundry, skydeck, cryo, orbital, hangar };

export function createArena(id, R) {
  const A = (BUILDERS[id] || foundry)(R);
  const g = A.grade;
  R.setGrade(g.shadow, g.high, g.bloom, g.exposure);
  return A;
}
