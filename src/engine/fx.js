import * as THREE from 'three';
import { rand, randSign, clamp01, lerp, TAU, Ease } from './utils.js';

const NOISE_GLSL = /* glsl */ `
  float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash21(i), hash21(i+vec2(1,0)), u.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), u.x), u.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;

const HEX_GLSL = /* glsl */ `
  // returns (edgeDistance, cellId)
  vec2 hexGrid(vec2 uv){
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a,a) < dot(b,b) ? a : b;
    vec2 ag = abs(gv);
    float d = max(ag.x, dot(ag, normalize(r)));
    vec2 id = uv - gv;
    return vec2(0.5 - d, hash21(floor(id * 7.0 + 0.5)));
  }
`;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c = new THREE.Color();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

// ===========================================================================
// Instanced billboard particles
// ===========================================================================
export const PK = { GLOW: 0, SPARK: 1, SMOKE: 2, FLARE: 3, SHARD: 4, RING: 5 };

class ParticleSystem {
  constructor(max, additive) {
    this.max = max;
    this.n = 0;
    this.additive = additive;
    const f = (k) => new Float32Array(max * k);
    this.pos = f(3); this.vel = f(3); this.col = f(3); this.col2 = f(3);
    this.life = f(1); this.maxLife = f(1); this.size0 = f(1); this.size1 = f(1);
    this.grav = f(1); this.drag = f(1); this.stretch = f(1); this.kind = f(1);
    this.rot = f(1); this.rotVel = f(1); this.alpha = f(1); this.floor = f(1);

    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    const dyn = (arr, n) => {
      const a = new THREE.InstancedBufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = dyn(new Float32Array(max * 4), 4);
    this.aVel = dyn(new Float32Array(max * 3), 3);
    this.aData = dyn(new Float32Array(max * 4), 4);
    this.aCol = dyn(new Float32Array(max * 3), 3);
    g.setAttribute('iPosRot', this.aPos);
    g.setAttribute('iVel', this.aVel);
    g.setAttribute('iData', this.aData);
    g.setAttribute('iColor', this.aCol);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute vec4 iPosRot; attribute vec3 iVel; attribute vec4 iData; attribute vec3 iColor;
        varying vec2 vUv; varying vec3 vColor; varying float vAlpha; varying float vKind; varying float vSeed;
        void main(){
          vec4 mv = modelViewMatrix * vec4(iPosRot.xyz, 1.0);
          vec2 p = position.xy;
          float size = iData.x;
          vec2 off;
          if (iData.z > 0.0) {
            vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
            float sp = length(vv.xy);
            vec2 dir = sp > 0.0001 ? vv.xy / sp : vec2(0.0, 1.0);
            vec2 perp = vec2(-dir.y, dir.x);
            float len = size * (1.0 + sp * iData.z);
            off = dir * p.y * len + perp * p.x * size;
          } else {
            float c = cos(iPosRot.w), s = sin(iPosRot.w);
            off = vec2(p.x * c - p.y * s, p.x * s + p.y * c) * size;
          }
          mv.xy += off;
          gl_Position = projectionMatrix * mv;
          vUv = uv; vColor = iColor; vAlpha = iData.y; vKind = iData.w;
          vSeed = fract(iPosRot.w * 3.7 + float(gl_InstanceID) * 0.137);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv; varying vec3 vColor; varying float vAlpha; varying float vKind; varying float vSeed;
        ${NOISE_GLSL}
        void main(){
          vec2 q = vUv - 0.5;
          float d = length(q) * 2.0;
          float a = 0.0;
          vec3 col = vColor;
          if (vKind < 0.5) { // glow
            a = pow(max(0.0, 1.0 - d), 2.2);
          } else if (vKind < 1.5) { // spark streak
            float dx = abs(q.x) * 2.0, dy = abs(q.y) * 2.0;
            a = pow(max(0.0, 1.0 - dx), 3.0) * pow(max(0.0, 1.0 - dy), 1.2);
            col = mix(col, vec3(1.0), pow(max(0.0, 1.0 - dx * 2.2), 4.0) * 0.8);
          } else if (vKind < 2.5) { // smoke
            float n = fbm(q * 3.0 + vSeed * 40.0);
            a = smoothstep(1.0, 0.15, d + (n - 0.5) * 0.9) * 0.9;
          } else if (vKind < 3.5) { // 4 point flare
            float sx = 1.0 / (1.0 + pow(abs(q.y) * 46.0, 2.0)) * max(0.0, 1.0 - abs(q.x) * 2.0);
            float sy = 1.0 / (1.0 + pow(abs(q.x) * 46.0, 2.0)) * max(0.0, 1.0 - abs(q.y) * 2.0);
            a = max(sx, sy) + pow(max(0.0, 1.0 - d), 3.0) * 0.9;
            col = mix(col, vec3(1.0), clamp(a - 0.6, 0.0, 1.0));
          } else if (vKind < 4.5) { // hard shard
            float e = max(abs(q.x) * 1.4 + abs(q.y), abs(q.y) * 2.0);
            a = step(e, 0.5);
          } else { // ring
            a = smoothstep(0.16, 0.0, abs(d - 0.8)) ;
          }
          a *= vAlpha;
          if (a < 0.003) discard;
          ${additive ? 'gl_FragColor = vec4(col * a, a);' : 'gl_FragColor = vec4(col, a);'}
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
  }

  spawn(x, y, z, vx, vy, vz, o) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    _c.set(o.color ?? 0xffffff);
    const k = o.intensity ?? 1;
    this.col[i3] = _c.r * k; this.col[i3 + 1] = _c.g * k; this.col[i3 + 2] = _c.b * k;
    if (o.color2 !== undefined) {
      _c.set(o.color2);
      this.col2[i3] = _c.r * k; this.col2[i3 + 1] = _c.g * k; this.col2[i3 + 2] = _c.b * k;
    } else {
      this.col2[i3] = this.col[i3]; this.col2[i3 + 1] = this.col[i3 + 1]; this.col2[i3 + 2] = this.col[i3 + 2];
    }
    this.life[i] = this.maxLife[i] = o.life ?? 0.5;
    this.size0[i] = o.size ?? 0.1;
    this.size1[i] = o.size1 ?? (o.size ?? 0.1) * 0.2;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.stretch[i] = o.stretch ?? 0;
    this.kind[i] = o.kind ?? 0;
    this.rot[i] = o.rot ?? Math.random() * TAU;
    this.rotVel[i] = o.rotVel ?? 0;
    this.alpha[i] = o.alpha ?? 1;
    this.floor[i] = o.floor ? 1 : 0;
  }

  update(dt) {
    const { pos, vel, life, maxLife, grav, drag, floor } = this;
    let n = this.n;
    for (let i = 0; i < n; ) {
      life[i] -= dt;
      if (life[i] <= 0) {
        n--;
        if (i !== n) this._move(n, i);
        continue;
      }
      const i3 = i * 3;
      const dr = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= dr; vel[i3 + 1] = vel[i3 + 1] * dr - grav[i] * dt; vel[i3 + 2] *= dr;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      if (floor[i] && pos[i3 + 1] < 0.02) {
        pos[i3 + 1] = 0.02;
        vel[i3 + 1] *= -0.42;
        vel[i3] *= 0.7; vel[i3 + 2] *= 0.7;
      }
      this.rot[i] += this.rotVel[i] * dt;
      i++;
    }
    this.n = n;
    // upload
    const ap = this.aPos.array, av = this.aVel.array, ad = this.aData.array, ac = this.aCol.array;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, i4 = i * 4;
      const t = 1 - life[i] / maxLife[i];
      ap[i4] = pos[i3]; ap[i4 + 1] = pos[i3 + 1]; ap[i4 + 2] = pos[i3 + 2]; ap[i4 + 3] = this.rot[i];
      av[i3] = vel[i3]; av[i3 + 1] = vel[i3 + 1]; av[i3 + 2] = vel[i3 + 2];
      ad[i4] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      const fadeIn = this.kind[i] === 2 ? Math.min(1, t * 8) : 1;
      ad[i4 + 1] = this.alpha[i] * fadeIn * (this.kind[i] === 2 ? (1 - t) : 1 - t * t * t);
      ad[i4 + 2] = this.stretch[i];
      ad[i4 + 3] = this.kind[i];
      ac[i3] = this.col[i3] + (this.col2[i3] - this.col[i3]) * t;
      ac[i3 + 1] = this.col[i3 + 1] + (this.col2[i3 + 1] - this.col[i3 + 1]) * t;
      ac[i3 + 2] = this.col[i3 + 2] + (this.col2[i3 + 2] - this.col[i3 + 2]) * t;
    }
    this.geo.instanceCount = n;
    if (n > 0) {
      const mark = (a, k) => {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * k);
        a.needsUpdate = true;
      };
      mark(this.aPos, 4); mark(this.aVel, 3); mark(this.aData, 4); mark(this.aCol, 3);
    }
  }

  _move(from, to) {
    const f3 = from * 3, t3 = to * 3;
    for (const a of [this.pos, this.vel, this.col, this.col2]) {
      a[t3] = a[f3]; a[t3 + 1] = a[f3 + 1]; a[t3 + 2] = a[f3 + 2];
    }
    for (const a of [this.life, this.maxLife, this.size0, this.size1, this.grav, this.drag, this.stretch, this.kind, this.rot, this.rotVel, this.alpha, this.floor])
      a[to] = a[from];
  }

  clear() {
    this.n = 0;
    this.geo.instanceCount = 0;
  }
}

// ===========================================================================
// Ribbon trail (weapon swooshes, energy scarves)
// ===========================================================================
export class Trail {
  constructor(color, opts = {}) {
    this.maxPts = opts.points ?? 22;
    this.sub = 3;
    this.lifetime = opts.life ?? 0.22;
    this.pts = []; // {a:Vector3 (base), b:Vector3 (tip), age}
    const maxV = (this.maxPts - 1) * this.sub + 1;
    this.maxV = maxV;
    const g = new THREE.BufferGeometry();
    this.posArr = new Float32Array(maxV * 2 * 3);
    this.dataArr = new Float32Array(maxV * 2 * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aData', new THREE.BufferAttribute(this.dataArr, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < maxV - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uColor2: { value: new THREE.Color(opts.color2 ?? color) },
        uAlpha: { value: opts.alpha ?? 1 },
        uTime: { value: 0 },
        uStyle: { value: opts.style ?? 0 },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec2 aData; varying vec2 vD;
        void main(){ vD = aData; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor, uColor2; uniform float uAlpha, uTime, uStyle; varying vec2 vD;
        ${NOISE_GLSL}
        void main(){
          float age = vD.x;      // 0 fresh .. 1 old
          float side = vD.y;     // 0 base .. 1 tip
          float a;
          vec3 col;
          if (uStyle < 0.5) {
            // blade swoosh: razor bright leading edge at the tip, soft body
            float sd = clamp(side, 0.0001, 1.0);
            float edge = pow(sd, 5.0);
            float body = pow(sd, 1.3) * 0.5;
            float n = fbm(vec2(age * 7.0 - uTime * 2.0, side * 5.0));
            a = (edge * 1.4 + body * (0.55 + n * 0.8)) * pow(clamp(1.0 - age, 0.0, 1.0), 1.6);
            col = mix(uColor2, uColor, side) * (1.0 + edge * 2.0);
            col = mix(col, vec3(1.0), edge * (1.0 - age) * 0.7);
          } else {
            // energy scarf: flowing banded ribbon
            float n = fbm(vec2(age * 5.0 - uTime * 1.5, side * 2.5 + uTime * 0.3));
            float band = smoothstep(0.0, 0.25, side) * smoothstep(1.0, 0.75, side);
            a = band * (0.35 + n * 0.9) * pow(clamp(1.0 - age, 0.0, 1.0), 1.2) * smoothstep(0.0, 0.06, age);
            col = mix(uColor, uColor2, age) * (0.8 + n);
          }
          a *= uAlpha;
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
    this.active = false;
  }

  push(a, b) {
    this.pts.unshift({ a: a.clone(), b: b.clone(), age: 0 });
    if (this.pts.length > this.maxPts) this.pts.pop();
  }

  update(dt, time) {
    const pts = this.pts;
    for (let i = pts.length - 1; i >= 0; i--) {
      pts[i].age += dt;
      if (pts[i].age > this.lifetime) pts.pop();
    }
    this.mat.uniforms.uTime.value = time;
    const n = pts.length;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const P = this.posArr, D = this.dataArr;
    let v = 0;
    const put = (ax, ay, az, bx, by, bz, age) => {
      const o = v * 6, d = v * 4;
      P[o] = ax; P[o + 1] = ay; P[o + 2] = az; P[o + 3] = bx; P[o + 4] = by; P[o + 5] = bz;
      const t = clamp01(age / this.lifetime);
      D[d] = t; D[d + 1] = 0; D[d + 2] = t; D[d + 3] = 1;
      v++;
    };
    const cr = (p0, p1, p2, p3, t) => {
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    };
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
      for (let s = 0; s < this.sub; s++) {
        const t = s / this.sub;
        put(
          cr(p0.a.x, p1.a.x, p2.a.x, p3.a.x, t), cr(p0.a.y, p1.a.y, p2.a.y, p3.a.y, t), cr(p0.a.z, p1.a.z, p2.a.z, p3.a.z, t),
          cr(p0.b.x, p1.b.x, p2.b.x, p3.b.x, t), cr(p0.b.y, p1.b.y, p2.b.y, p3.b.y, t), cr(p0.b.z, p1.b.z, p2.b.z, p3.b.z, t),
          lerp(p1.age, p2.age, t)
        );
      }
    }
    const last = pts[n - 1];
    put(last.a.x, last.a.y, last.a.z, last.b.x, last.b.y, last.b.z, last.age);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aData.needsUpdate = true;
    this.geo.setDrawRange(0, (v - 1) * 6);
  }

  clear() {
    this.pts.length = 0;
    this.geo.setDrawRange(0, 0);
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ===========================================================================
// Hex energy shield (block / parry visual). One per fighter.
// ===========================================================================
export class Shield {
  constructor(color) {
    const geo = new THREE.SphereGeometry(1, 40, 28, Math.PI - 1.25, 2.5, 0.42, Math.PI - 0.84);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uBreak: { value: new THREE.Color(0xff3b2f) },
        uPower: { value: 0 },
        uTime: { value: 0 },
        uHit: { value: 9 },
        uHitPos: { value: new THREE.Vector2(0.5, 0.5) },
        uIntegrity: { value: 1 },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor, uBreak; uniform float uPower, uTime, uHit, uIntegrity; uniform vec2 uHitPos;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        ${NOISE_GLSL}
        ${HEX_GLSL}
        void main(){
          vec2 uv = vUv;
          vec2 huv = vec2(uv.x * 13.0, uv.y * 15.0);
          vec2 hg = hexGrid(huv);
          float line = smoothstep(0.07, 0.0, hg.x);
          float cell = hg.y;
          float fres = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.0);
          // boundary fade of the patch
          float edge = smoothstep(0.0, 0.16, uv.x) * smoothstep(1.0, 0.84, uv.x) * smoothstep(0.0, 0.14, uv.y) * smoothstep(1.0, 0.86, uv.y);
          // scan wave + per cell flicker
          float scan = smoothstep(0.92, 1.0, sin(uv.y * 9.0 - uTime * 5.0) * 0.5 + 0.5);
          float flick = step(0.82, fract(cell * 13.7 + uTime * (0.6 + cell)));
          // impact ripple
          float hd = distance(uv * vec2(1.0, 1.2), uHitPos * vec2(1.0, 1.2));
          float rip = smoothstep(0.12, 0.0, abs(hd - uHit * 1.6)) * exp(-uHit * 4.5);
          float core = exp(-hd * 9.0) * exp(-uHit * 7.0);
          float damage = 1.0 - uIntegrity;
          float crack = step(1.0 - damage * 0.75, cell) ;
          vec3 col = mix(uColor, uBreak, smoothstep(0.45, 0.95, damage));
          float a = line * (0.55 + fres * 1.4) + fres * 0.5 + 0.045 + scan * 0.14 + flick * 0.2 * (1.0 - crack);
          a *= 1.0 - crack * 0.85;
          a += rip * 1.8 + core * 1.8;
          a *= edge * uPower;
          col = mix(col, vec3(1.0), clamp(rip * 0.8 + core, 0.0, 1.0));
          gl_FragColor = vec4(col * a * 1.5, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 22;
    this.mesh.visible = false;
    this.power = 0;
    this.target = 0;
    this.hitT = 9;
  }
  setColor(c) {
    this.mat.uniforms.uColor.value.set(c);
  }
  hit(u = 0.5, v = 0.5) {
    this.hitT = 0;
    this.mat.uniforms.uHitPos.value.set(u, v);
  }
  update(dt, time, x, y, facing, height, integrity) {
    this.power += (this.target - this.power) * (1 - Math.exp(-dt * (this.target > this.power ? 26 : 12)));
    this.hitT += dt;
    const u = this.mat.uniforms;
    u.uPower.value = this.power;
    u.uTime.value = time;
    u.uHit.value = this.hitT;
    u.uIntegrity.value = integrity;
    this.mesh.visible = this.power > 0.01;
    if (this.mesh.visible) {
      const s = 0.72 + this.power * 0.28;
      this.mesh.position.set(x + facing * 0.12, y + height * 0.52, 0);
      this.mesh.scale.set(facing * height * 0.52 * s, height * 0.66 * s, height * 0.56 * s);
    }
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ===========================================================================
// FX manager: pooled one-shot effects
// ===========================================================================
function makePool(n, make) {
  const items = [];
  for (let i = 0; i < n; i++) items.push(make(i));
  let next = 0;
  return {
    items,
    get() {
      // prefer a free one, otherwise steal the oldest
      for (let k = 0; k < n; k++) {
        const it = items[(next + k) % n];
        if (it.life <= 0) {
          next = (next + k + 1) % n;
          return it;
        }
      }
      const it = items[next];
      next = (next + 1) % n;
      return it;
    },
  };
}

export class FX {
  constructor(scene, quality = 1) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'fx';
    scene.add(this.group);
    this.density = quality;
    this.time = 0;

    this.add = new ParticleSystem(5000, true);
    this.alpha = new ParticleSystem(700, false);
    this.group.add(this.alpha.mesh, this.add.mesh);

    // ---- shockwave rings
    const ringGeo = new THREE.PlaneGeometry(2, 2);
    this.rings = makePool(28, () => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uT: { value: 0 }, uWidth: { value: 0.1 }, uSeed: { value: Math.random() * 50 }, uAlpha: { value: 1 }, uFill: { value: 0 } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform vec3 uColor; uniform float uT, uWidth, uSeed, uAlpha, uFill; varying vec2 vUv;
          ${NOISE_GLSL}
          void main(){
            vec2 q = (vUv - 0.5) * 2.0;
            float d = length(q);
            float ang = atan(q.y, q.x);
            float n = fbm(vec2(ang * 3.0 + uSeed, uT * 3.0 + uSeed));
            float r = 0.93 - uWidth;
            float w = max(0.004, uWidth * (1.0 - uT * 0.65) * (0.55 + n * 0.9));
            float ring = smoothstep(w, 0.0, abs(d - r)) ;
            float inner = smoothstep(r, r - 0.5, d) * smoothstep(0.0, r, d) * uFill;
            float streak = pow(max(0.0, sin(ang * 24.0 + n * 9.0)), 6.0) * smoothstep(r, r - 0.35, d) * smoothstep(r - 0.45, r - 0.1, d) * 0.5;
            float a = (ring * 1.5 + inner * 0.35 + streak * 0.6) * pow(clamp(1.0 - uT, 0.0, 1.0), 1.4) * uAlpha;
            vec3 col = mix(uColor, vec3(1.0), ring * 0.55 * (1.0 - uT));
            gl_FragColor = vec4(col * a, a);
          }`,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 19;
      this.group.add(mesh);
      return { mesh, mat, life: 0, dur: 1, r0: 0, r1: 1 };
    });

    // ---- lightning bolts (ribbons in the fight plane)
    this.bolts = makePool(22, () => {
      const SEG = 26;
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array((SEG + 1) * 2 * 3);
      const uv = new Float32Array((SEG + 1) * 2 * 2);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
      const idx = [];
      for (let i = 0; i < SEG; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      g.setIndex(idx);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          precision highp float; uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
          void main(){
            float v = abs(vUv.y - 0.5) * 2.0;
            float core = pow(max(0.0, 1.0 - v * 3.2), 2.0);
            float glow = pow(max(0.0, 1.0 - v), 2.5);
            float a = (core * 2.0 + glow * 0.7) * uAlpha;
            vec3 col = mix(uColor * 1.6, vec3(1.0), core);
            gl_FragColor = vec4(col * a, a);
          }`,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 21;
      this.group.add(mesh);
      return { mesh, mat, g, SEG, life: 0, dur: 1, a: new THREE.Vector3(), b: new THREE.Vector3(), jit: 0.3, width: 0.1, regen: 0 };
    });

    // ---- beams
    const beamGeo = new THREE.PlaneGeometry(1, 1);
    beamGeo.translate(0.5, 0, 0);
    this.beams = makePool(8, () => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uT: { value: 0 }, uTime: { value: 0 }, uLen: { value: 1 } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          precision highp float; uniform vec3 uColor; uniform float uT, uTime, uLen; varying vec2 vUv;
          ${NOISE_GLSL}
          void main(){
            float v = abs(vUv.y - 0.5) * 2.0;
            float u = vUv.x;
            float open = smoothstep(0.0, 0.12, uT) * (1.0 - smoothstep(0.55, 1.0, uT));
            float wv = v / max(0.05, open);
            float n = fbm(vec2(u * uLen * 1.4 - uTime * 14.0, v * 3.0));
            float n2 = fbm(vec2(u * uLen * 3.0 - uTime * 22.0, v * 8.0 + 5.0));
            float core = pow(max(0.0, 1.0 - wv * 2.6), 1.5);
            float body = pow(max(0.0, 1.0 - wv), 2.0) * (0.45 + n * 1.1);
            float fil = pow(max(0.0, 1.0 - abs(wv - 0.55 - n2 * 0.3) * 6.0), 2.0) * 0.7;
            float caps = smoothstep(0.0, 0.03, u) * smoothstep(1.0, 0.92, u);
            float a = (core * 1.5 + body + fil) * caps * open;
            vec3 col = mix(uColor * 1.5, vec3(1.0), core * 0.7);
            gl_FragColor = vec4(col * a, a);
          }`,
      });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 21;
      this.group.add(mesh);
      return { mesh, mat, life: 0, dur: 1 };
    });

    // ---- slash crescents
    const arcGeo = new THREE.PlaneGeometry(2, 2);
    this.arcs = makePool(14, () => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color() }, uColor2: { value: new THREE.Color() }, uT: { value: 0 },
          uA0: { value: 0 }, uA1: { value: 1 }, uThick: { value: 0.3 }, uSeed: { value: Math.random() * 30 },
        },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform vec3 uColor, uColor2; uniform float uT, uA0, uA1, uThick, uSeed; varying vec2 vUv;
          ${NOISE_GLSL}
          void main(){
            vec2 q = (vUv - 0.5) * 2.0;
            float d = length(q);
            float ang = atan(q.y, q.x);
            // param along the sweep 0..1
            float s = (ang - uA0) / (uA1 - uA0);
            if (s < 0.0 || s > 1.0) discard;
            float sweep = clamp(uT * 2.6, 0.0, 1.0);          // leading edge travels quickly
            float lead = smoothstep(sweep, sweep - 0.02, s);
            float tail = smoothstep(max(0.0, uT * 1.7 - 0.5), max(0.0, uT * 1.7 - 0.5) + 0.5, s);
            float prof = max(0.0, sin(s * 3.14159));
            float thick = uThick * pow(max(prof, 0.0001), 0.7);
            float outer = 0.95;
            float n = fbm(vec2(s * 9.0 + uSeed, d * 6.0 - uT * 5.0));
            float inner = outer - thick * (0.75 + n * 0.5);
            float edge = smoothstep(outer, outer - 0.035, d) * smoothstep(outer - 0.11, outer - 0.03, d);
            float body = smoothstep(inner, inner + thick * 0.9 + 0.0005, d) * smoothstep(outer, outer - 0.02, d);
            float streak = pow(fbm(vec2(s * 30.0 + uSeed, d * 2.0)), 2.0);
            float a = (edge * 1.5 + body * body * (0.22 + streak * 0.9)) * lead * tail * (1.0 - smoothstep(0.6, 1.0, uT));
            vec3 col = mix(uColor2, uColor, body);
            col = mix(col, vec3(1.0), edge * 0.55);
            gl_FragColor = vec4(col * a, a);
          }`,
      });
      const mesh = new THREE.Mesh(arcGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 21;
      this.group.add(mesh);
      return { mesh, mat, life: 0, dur: 1, vx: 0, vy: 0, grow: 0, baseScale: 1 };
    });

    // ---- energy pillars
    const pilGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    pilGeo.translate(0, 0.5, 0);
    this.pillars = makePool(10, () => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uT: { value: 0 }, uTime: { value: 0 }, uSeed: { value: Math.random() * 20 } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `
          precision highp float; uniform vec3 uColor; uniform float uT, uTime, uSeed; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          ${NOISE_GLSL}
          void main(){
            float f = abs(dot(normalize(vN), normalize(vV)));
            float n = fbm(vec2(vUv.x * 12.0 + uSeed, vUv.y * 5.0 - uTime * 9.0));
            float streak = pow(n, 2.0) * 2.4;
            float fadeY = smoothstep(1.0, 0.25, vUv.y) * smoothstep(0.0, 0.03, vUv.y);
            float a = (0.25 + streak) * pow(max(f, 0.0001), 0.8) * fadeY * max(0.0, sin(clamp(uT, 0.0, 1.0) * 3.14159));
            vec3 col = mix(uColor, vec3(1.0), streak * 0.35 * f);
            gl_FragColor = vec4(col * a * 1.2, a);
          }`,
      });
      const mesh = new THREE.Mesh(pilGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 20;
      this.group.add(mesh);
      return { mesh, mat, life: 0, dur: 1, w: 1, h: 1 };
    });

    // ---- hex domes (expanding energy hemispheres)
    const domeGeo = new THREE.SphereGeometry(1, 40, 20, 0, TAU, 0, Math.PI / 2);
    this.domes = makePool(4, () => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uT: { value: 0 }, uTime: { value: 0 } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `
          precision highp float; uniform vec3 uColor; uniform float uT, uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          ${NOISE_GLSL}
          ${HEX_GLSL}
          void main(){
            vec2 hg = hexGrid(vec2(vUv.x * 30.0, vUv.y * 9.0));
            float line = smoothstep(0.08, 0.0, hg.x);
            float fres = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.6);
            float wave = smoothstep(0.25, 0.0, abs(vUv.y - (1.0 - uT * 1.3)));
            float flick = step(0.6, fract(hg.y * 9.0 + uTime * 3.0));
            float a = (line * (0.5 + fres) + fres * 0.6 + wave * 0.9 + flick * 0.12) * pow(clamp(1.0 - uT, 0.0, 1.0), 1.2);
            vec3 col = mix(uColor, vec3(1.0), wave * 0.5);
            gl_FragColor = vec4(col * a * 1.4, a);
          }`,
      });
      const mesh = new THREE.Mesh(domeGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 20;
      this.group.add(mesh);
      return { mesh, mat, life: 0, dur: 1, r0: 0.2, r1: 3 };
    });

    // ---- hex shards (instanced)
    this.shardMax = 140;
    const shGeo = new THREE.CylinderGeometry(1, 1, 0.08, 6);
    shGeo.rotateX(Math.PI / 2);
    this.shardMesh = new THREE.InstancedMesh(
      shGeo,
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }),
      this.shardMax
    );
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.frustumCulled = false;
    this.shardMesh.count = 0;
    this.shardMesh.renderOrder = 22;
    this.group.add(this.shardMesh);
    this.shards = [];

    // ---- ground cracks / scorch decals
    const crackTex = makeCrackTexture();
    this.decals = makePool(8, (i) => {
      const mat = new THREE.MeshBasicMaterial({ map: crackTex.dark, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 - i * 0.2 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.012 + i * 0.0012;
      mesh.visible = false;
      mesh.renderOrder = 2;
      const gmat = new THREE.MeshBasicMaterial({ map: crackTex.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false });
      const glow = new THREE.Mesh(mesh.geometry, gmat);
      glow.position.z = 0.002;
      mesh.add(glow);
      this.group.add(mesh);
      return { mesh, mat, gmat, life: 0, dur: 1 };
    });

    // ---- dynamic lights (fixed count => no shader recompiles)
    this.lights = makePool(4, () => {
      const l = new THREE.PointLight(0xffffff, 0, 11, 1.8);
      l.position.set(0, -50, 0);
      this.group.add(l);
      return { light: l, life: 0, dur: 1, peak: 0 };
    });
  }

  // -------------------------------------------------------------------------
  // primitives
  // -------------------------------------------------------------------------
  sparks(pos, o = {}) {
    const n = Math.max(1, Math.round((o.count ?? 12) * this.density));
    const sp = o.speed ?? 7;
    const dir = o.dir; // optional [x,y,z] bias
    const spread = o.spread ?? 1;
    for (let i = 0; i < n; i++) {
      let vx = rand(-1, 1), vy = rand(-1, 1), vz = rand(-1, 1) * 0.6;
      const l = Math.hypot(vx, vy, vz) || 1;
      vx /= l; vy /= l; vz /= l;
      if (dir) {
        vx = dir[0] + vx * spread; vy = dir[1] + vy * spread; vz = (dir[2] || 0) + vz * spread;
      }
      const s = sp * rand(0.25, 1);
      this.add.spawn(pos.x + rand(-0.05, 0.05), pos.y + rand(-0.05, 0.05), (pos.z || 0) + rand(-0.05, 0.05), vx * s, vy * s, vz * s, {
        color: o.color ?? 0xffc878, color2: o.color2 ?? o.color ?? 0xff5a18, intensity: o.intensity ?? 3,
        life: (o.life ?? 0.45) * rand(0.5, 1), size: (o.size ?? 0.035) * rand(0.6, 1.3), size1: 0.004,
        gravity: o.gravity ?? 9, drag: o.drag ?? 1.2, stretch: o.stretch ?? 0.045, kind: PK.SPARK, floor: o.floor ?? true,
      });
    }
  }

  glow(pos, o = {}) {
    this.add.spawn(pos.x, pos.y, pos.z || 0, o.vx ?? 0, o.vy ?? 0, o.vz ?? 0, {
      color: o.color ?? 0xffffff, color2: o.color2, intensity: o.intensity ?? 1.5, life: o.life ?? 0.2,
      size: o.size ?? 1, size1: o.size1 ?? (o.size ?? 1) * 1.6, kind: PK.GLOW, alpha: o.alpha ?? 1, drag: o.drag ?? 0, gravity: o.gravity ?? 0,
    });
  }

  flare(pos, o = {}) {
    this.add.spawn(pos.x, pos.y, (pos.z || 0) + 0.3, 0, 0, 0, {
      color: o.color ?? 0xffffff, intensity: o.intensity ?? 1.5, life: o.life ?? 0.16, size: o.size ?? 2.2, size1: (o.size ?? 2.2) * 0.3,
      kind: PK.FLARE, rot: o.rot ?? rand(-0.5, 0.5), rotVel: o.rotVel ?? rand(-2, 2),
    });
  }

  motes(pos, o = {}) {
    // floating energy motes
    const n = Math.max(1, Math.round((o.count ?? 10) * this.density));
    for (let i = 0; i < n; i++) {
      const a = rand(TAU), r = rand(o.radius ?? 0.6);
      const sp = o.speed ?? 1.5;
      this.add.spawn(pos.x + Math.cos(a) * r, pos.y + Math.sin(a) * r * (o.flat ?? 1), (pos.z || 0) + rand(-0.3, 0.3),
        rand(-1, 1) * sp + (o.vx ?? 0), rand(-0.2, 1) * sp + (o.vy ?? 0), rand(-1, 1) * sp * 0.4, {
          color: o.color ?? 0x66ccff, color2: o.color2, intensity: o.intensity ?? 2.5, life: (o.life ?? 0.7) * rand(0.5, 1),
          size: (o.size ?? 0.07) * rand(0.5, 1.4), size1: 0.0, kind: PK.GLOW, gravity: o.gravity ?? -1.5, drag: o.drag ?? 1.5,
        });
    }
  }

  /** particles converging on a point (charge-ups) */
  implode(pos, o = {}) {
    const n = Math.max(1, Math.round((o.count ?? 10) * this.density));
    for (let i = 0; i < n; i++) {
      const a = rand(TAU), r = (o.radius ?? 1.6) * rand(0.6, 1);
      const life = (o.life ?? 0.35) * rand(0.7, 1);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      this.add.spawn(pos.x + x, pos.y + y, (pos.z || 0) + rand(-0.4, 0.4), -x / life, -y / life, 0, {
        color: o.color ?? 0x66ccff, intensity: o.intensity ?? 3, life, size: (o.size ?? 0.05) * rand(0.6, 1.3), size1: 0.01,
        kind: PK.SPARK, stretch: 0.05, drag: 0, gravity: 0, floor: false,
      });
    }
  }

  smoke(pos, o = {}) {
    const n = Math.max(1, Math.round((o.count ?? 6) * this.density));
    for (let i = 0; i < n; i++) {
      const sp = o.speed ?? 1.2;
      this.alpha.spawn(pos.x + rand(-0.15, 0.15), pos.y + rand(-0.05, 0.1), (pos.z || 0) + rand(-0.2, 0.2),
        rand(-1, 1) * sp + (o.vx ?? 0), rand(0.1, 1) * (o.up ?? 0.8), rand(-1, 1) * sp * 0.5, {
          color: o.color ?? 0x6a6a72, color2: o.color2 ?? 0x2a2a30, life: (o.life ?? 0.9) * rand(0.6, 1), size: (o.size ?? 0.5) * rand(0.6, 1.2),
          size1: (o.size ?? 0.5) * rand(1.8, 2.8), kind: PK.SMOKE, drag: o.drag ?? 2.2, gravity: -0.4, alpha: o.alpha ?? 0.5, rotVel: rand(-1, 1),
        });
    }
  }

  dust(x, dir = 0, count = 6, y = 0.05) {
    for (let i = 0; i < Math.round(count * this.density); i++) {
      this.alpha.spawn(x + rand(-0.2, 0.2), y + rand(0, 0.1), rand(-0.4, 0.4), dir * rand(0.5, 3) + rand(-0.5, 0.5), rand(0.2, 1), rand(-0.6, 0.6), {
        color: 0x8a8580, color2: 0x4a4744, life: rand(0.4, 0.8), size: rand(0.25, 0.4), size1: rand(0.8, 1.3), kind: PK.SMOKE, drag: 3, gravity: -0.3, alpha: 0.32, rotVel: rand(-1, 1),
      });
    }
  }

  ring(pos, o = {}) {
    const r = this.rings.get();
    r.life = r.dur = o.dur ?? 0.4;
    r.r0 = o.r0 ?? 0.2;
    r.r1 = o.r1 ?? 2.5;
    r.mat.uniforms.uColor.value.set(o.color ?? 0xffffff).multiplyScalar(o.intensity ?? 1.0);
    r.mat.uniforms.uWidth.value = o.width ?? 0.12;
    r.mat.uniforms.uAlpha.value = o.alpha ?? 1;
    r.mat.uniforms.uFill.value = o.fill ?? 0;
    r.mat.uniforms.uSeed.value = Math.random() * 50;
    r.mesh.position.set(pos.x, pos.y, pos.z || 0);
    if (o.ground) r.mesh.rotation.set(-Math.PI / 2, 0, 0);
    else r.mesh.rotation.set(o.tiltX ?? 0, o.tiltY ?? 0, o.rot ?? 0);
    r.mesh.scale.setScalar(r.r0);
    r.mesh.visible = true;
    r.ease = o.ease ?? Ease.out3;
    r.sy = o.squash ?? 1;
    return r;
  }

  light(pos, color, intensity = 30, dur = 0.25, dist = 11) {
    const l = this.lights.get();
    l.life = l.dur = dur;
    l.peak = intensity * 0.4;
    l.light.color.set(color);
    l.light.distance = dist;
    l.light.position.set(pos.x, pos.y, (pos.z || 0) + 1.2);
    l.light.intensity = l.peak;
    return l;
  }

  lightning(a, b, o = {}) {
    const L = this.bolts.get();
    L.life = L.dur = o.dur ?? 0.18;
    L.a.set(a.x, a.y, a.z || 0);
    L.b.set(b.x, b.y, b.z || 0);
    L.jit = o.jitter ?? 0.35;
    L.width = o.width ?? 0.12;
    L.regen = 0;
    L.mat.uniforms.uColor.value.set(o.color ?? 0x9fd8ff).multiplyScalar(o.intensity ?? 1.1);
    L.mesh.visible = true;
    this._regenBolt(L);
    const br = o.branches ?? 0;
    for (let i = 0; i < br; i++) {
      const t = rand(0.2, 0.8);
      _v1.lerpVectors(L.a, L.b, t);
      const len = L.a.distanceTo(L.b) * rand(0.15, 0.35);
      const ang = Math.atan2(L.b.y - L.a.y, L.b.x - L.a.x) + rand(0.4, 1.1) * randSign();
      _v2.set(_v1.x + Math.cos(ang) * len, _v1.y + Math.sin(ang) * len, _v1.z);
      this.lightning(_v1.clone(), _v2.clone(), { ...o, branches: 0, width: (o.width ?? 0.12) * 0.55, dur: (o.dur ?? 0.18) * 0.8 });
    }
    return L;
  }

  _regenBolt(L) {
    const { SEG } = L;
    const pos = L.g.attributes.position.array;
    const uv = L.g.attributes.uv.array;
    const dx = L.b.x - L.a.x, dy = L.b.y - L.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    // 1D midpoint displacement
    const off = new Float32Array(SEG + 1);
    const rec = (i0, i1, amp) => {
      if (i1 - i0 < 2) return;
      const m = (i0 + i1) >> 1;
      off[m] = (off[i0] + off[i1]) / 2 + rand(-amp, amp);
      rec(i0, m, amp * 0.55);
      rec(m, i1, amp * 0.55);
    };
    rec(0, SEG, L.jit * Math.min(1.5, len * 0.35));
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const cx = L.a.x + dx * t + nx * off[i];
      const cy = L.a.y + dy * t + ny * off[i];
      const w = L.width * (0.6 + 0.4 * Math.sin(t * Math.PI)) ;
      const o = i * 6;
      pos[o] = cx + nx * w; pos[o + 1] = cy + ny * w; pos[o + 2] = L.a.z + (L.b.z - L.a.z) * t;
      pos[o + 3] = cx - nx * w; pos[o + 4] = cy - ny * w; pos[o + 5] = pos[o + 2];
      const u = i * 4;
      uv[u] = t; uv[u + 1] = 0; uv[u + 2] = t; uv[u + 3] = 1;
    }
    L.g.attributes.position.needsUpdate = true;
    L.g.attributes.uv.needsUpdate = true;
  }

  beam(a, b, o = {}) {
    const B = this.beams.get();
    B.life = B.dur = o.dur ?? 0.35;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    B.mesh.position.set(a.x, a.y, a.z || 0);
    B.mesh.rotation.set(0, 0, Math.atan2(dy, dx));
    B.mesh.scale.set(len, o.width ?? 0.6, 1);
    B.mat.uniforms.uColor.value.set(o.color ?? 0x88ddff).multiplyScalar(o.intensity ?? 0.9);
    B.mat.uniforms.uLen.value = len;
    B.mesh.visible = true;
    return B;
  }

  /**
   * crescent slash. angle0→angle1 in radians (in the effect plane), radius in metres.
   * facing mirrors horizontally. tilt leans the plane away from the camera for depth.
   */
  slash(pos, o = {}) {
    const A = this.arcs.get();
    A.life = A.dur = o.dur ?? 0.22;
    A.hold = false;
    const u = A.mat.uniforms;
    u.uColor.value.set(o.color ?? 0xffffff).multiplyScalar(o.intensity ?? 1.25);
    u.uColor2.value.set(o.color2 ?? o.color ?? 0xffffff).multiplyScalar((o.intensity ?? 1.25) * 0.55);
    let a0 = o.a0 ?? -1, a1 = o.a1 ?? 1;
    u.uA0.value = a0; u.uA1.value = a1;
    u.uThick.value = o.thick ?? 0.32;
    u.uSeed.value = Math.random() * 30;
    const r = o.radius ?? 1.4;
    A.baseScale = r;
    A.grow = o.grow ?? 0.15;
    A.vx = o.vx ?? 0; A.vy = o.vy ?? 0;
    A.mesh.position.set(pos.x, pos.y, pos.z || 0.2);
    A.mesh.rotation.set(o.tilt ?? 0, o.yaw ?? 0, o.rot ?? 0);
    A.facing = o.facing ?? 1;
    A.mesh.scale.set(r * A.facing, r, r);
    A.mesh.visible = true;
    return A;
  }

  pillar(x, o = {}) {
    const p = this.pillars.get();
    p.life = p.dur = o.dur ?? 0.5;
    p.w = o.width ?? 0.8;
    p.h = o.height ?? 7;
    p.mat.uniforms.uColor.value.set(o.color ?? 0x88ddff).multiplyScalar(o.intensity ?? 0.8);
    p.mat.uniforms.uSeed.value = Math.random() * 20;
    p.mesh.position.set(x, o.y ?? 0, o.z ?? 0);
    p.mesh.visible = true;
    return p;
  }

  dome(pos, o = {}) {
    const d = this.domes.get();
    d.life = d.dur = o.dur ?? 0.5;
    d.r0 = o.r0 ?? 0.3;
    d.r1 = o.r1 ?? 3;
    d.mat.uniforms.uColor.value.set(o.color ?? 0x66ccff).multiplyScalar(o.intensity ?? 1.0);
    d.mesh.position.set(pos.x, pos.y ?? 0, pos.z || 0);
    d.mesh.visible = true;
    return d;
  }

  hexShards(pos, o = {}) {
    const n = Math.round((o.count ?? 18) * Math.max(0.6, this.density));
    _c.set(o.color ?? 0x66ccff).multiplyScalar(o.intensity ?? 2.2);
    for (let i = 0; i < n; i++) {
      if (this.shards.length >= this.shardMax) this.shards.shift();
      const a = rand(TAU);
      const sp = (o.speed ?? 7) * rand(0.3, 1);
      const dirx = o.dir ? o.dir * rand(0.3, 1.2) : 0;
      this.shards.push({
        x: pos.x + rand(-0.3, 0.3), y: pos.y + rand(-0.6, 0.6), z: (pos.z || 0) + rand(-0.4, 0.4),
        vx: Math.cos(a) * sp * 0.7 + dirx * sp, vy: Math.sin(a) * sp * 0.8 + 1.5, vz: rand(-1, 1) * sp * 0.5,
        rx: rand(TAU), ry: rand(TAU), rz: rand(TAU), wx: rand(-9, 9), wy: rand(-9, 9), wz: rand(-9, 9),
        size: (o.size ?? 0.1) * rand(0.5, 1.5), life: rand(0.5, 1) * (o.life ?? 0.8), maxLife: 1, r: _c.r, g: _c.g, b: _c.b,
      });
      this.shards[this.shards.length - 1].maxLife = this.shards[this.shards.length - 1].life;
    }
  }

  crack(x, size = 2.5, color = 0xffa040, dur = 4) {
    const d = this.decals.get();
    d.life = d.dur = dur;
    d.mesh.position.x = x;
    d.mesh.position.z = rand(-0.1, 0.1);
    d.mesh.rotation.z = rand(TAU);
    d.mesh.scale.set(size, size, 1);
    d.gmat.color.set(color).multiplyScalar(3);
    d.mesh.visible = true;
  }

  // -------------------------------------------------------------------------
  // composites
  // -------------------------------------------------------------------------
  /** Generic strike impact. power 0..1.5 */
  impact(pos, color, power = 0.5, dirX = 1) {
    const p = Math.max(0.2, power);
    this.flare(pos, { color, size: 1.1 + p * 1.5, life: 0.09 + p * 0.06, intensity: 1.2 });
    this.glow(pos, { color, size: 0.6 + p * 1.0, life: 0.12, intensity: 0.7 });
    this.ring(pos, { color, r0: 0.15, r1: 0.9 + p * 1.7, dur: 0.22 + p * 0.14, width: 0.1, tiltY: 0.9 * dirX, intensity: 0.8 });
    this.sparks(pos, { count: 8 + p * 22, color: 0xfff0c8, color2: color, speed: 6 + p * 9, dir: [dirX * 0.9, 0.35, 0], spread: 0.9, size: 0.03 + p * 0.02 });
    this.sparks(pos, { count: 4 + p * 8, color: 0xffb060, color2: 0xff4a10, speed: 3 + p * 3, gravity: 12, life: 0.8, size: 0.025 });
    this.light(pos, color, 16 + p * 34, 0.18 + p * 0.1);
    if (p > 0.75) {
      this.ring(pos, { color, r0: 0.3, r1: 2.4 + p * 1.4, dur: 0.3, width: 0.04, rot: rand(TAU), intensity: 0.7 });
      this.smoke(pos, { count: 3, size: 0.5, alpha: 0.25, speed: 2 });
    }
  }

  /** Blocked strike: shield crackle */
  blockImpact(pos, color, power = 0.5, dirX = 1) {
    this.flare(pos, { color, size: 1.0 + power * 0.8, life: 0.1, intensity: 1.0 });
    this.sparks(pos, { count: 6 + power * 10, color: 0xffffff, color2: color, speed: 5 + power * 4, dir: [-dirX * 0.7, 0.3, 0], spread: 1, gravity: 4, size: 0.028 });
    this.light(pos, color, 14 + power * 20, 0.14);
  }

  parryBurst(pos, color, dirX = 1) {
    this.flare(pos, { color, size: 3.6, life: 0.2, intensity: 1.8 });
    this.ring(pos, { color, r0: 0.2, r1: 3.6, dur: 0.45, width: 0.16, intensity: 1.2 });
    this.ring(pos, { color: 0xffffff, r0: 0.2, r1: 5.5, dur: 0.55, width: 0.035, intensity: 0.9 });
    this.hexShards(pos, { color, count: 26, speed: 9, dir: dirX });
    this.sparks(pos, { count: 30, color: 0xffffff, color2: color, speed: 13, gravity: 2, size: 0.04, life: 0.6, intensity: 2 });
    this.light(pos, color, 55, 0.3, 14);
  }

  guardBreak(pos, dirX = 1) {
    this.flare(pos, { color: 0xff6a4a, size: 3.6, life: 0.2, intensity: 1.8 });
    this.ring(pos, { color: 0xff3b2f, r0: 0.2, r1: 3.6, dur: 0.4, width: 0.22 });
    this.hexShards(pos, { color: 0xff4030, count: 34, speed: 8, dir: -dirX, size: 0.13 });
    this.sparks(pos, { count: 30, color: 0xffd0a0, color2: 0xff2a10, speed: 10, size: 0.04 });
    this.light(pos, 0xff4030, 50, 0.3, 14);
  }

  explosion(pos, color, scale = 1) {
    this.flare(pos, { color: 0xffffff, size: 4 * scale, life: 0.2, intensity: 2.2 });
    this.glow(pos, { color, size: 2.2 * scale, size1: 4.5 * scale, life: 0.3, intensity: 1.4 });
    this.ring(pos, { color, r0: 0.3, r1: 4.2 * scale, dur: 0.45, width: 0.2, fill: 0.6 });
    this.ring(pos, { color: 0xffffff, r0: 0.3, r1: 5.6 * scale, dur: 0.5, width: 0.05, rot: rand(TAU), tiltX: 1.1 });
    this.sparks(pos, { count: 50 * scale, color: 0xffffff, color2: color, speed: 15 * scale, size: 0.05, life: 0.8, gravity: 6 });
    this.smoke(pos, { count: 10, size: 0.9 * scale, speed: 3 * scale, alpha: 0.4, life: 1.2 });
    this.light(pos, color, 80 * scale, 0.4, 18);
  }

  groundSlam(x, color, scale = 1) {
    const p = { x, y: 0.05, z: 0 };
    this.ring(p, { color, r0: 0.3, r1: 4.5 * scale, dur: 0.55, width: 0.16, ground: true, fill: 0.5 });
    this.ring(p, { color: 0xffffff, r0: 0.3, r1: 6.5 * scale, dur: 0.65, width: 0.05, ground: true });
    this.ring({ x, y: 0.6, z: 0 }, { color, r0: 0.2, r1: 3 * scale, dur: 0.3, width: 0.1, squash: 0.35 });
    this.crack(x, 3.4 * scale, color);
    this.dust(x, 1, 8 * scale);
    this.dust(x, -1, 8 * scale);
    this.sparks({ x, y: 0.15, z: 0 }, { count: 36 * scale, color: 0xffe0b0, color2: color, speed: 11 * scale, dir: [0, 1.1, 0], spread: 0.9, gravity: 14, life: 0.9, size: 0.045 });
    // debris chunks
    for (let i = 0; i < Math.round(10 * scale * this.density); i++) {
      this.alpha.spawn(x + rand(-0.6, 0.6), 0.1, rand(-0.5, 0.5), rand(-4, 4) * scale, rand(4, 10) * scale, rand(-2, 2), {
        color: 0x1c1c20, color2: 0x1c1c20, life: rand(0.7, 1.3), size: rand(0.05, 0.14), size1: 0.05, kind: PK.SHARD, gravity: 20, alpha: 1, rotVel: rand(-12, 12), floor: true,
      });
    }
    this.light({ x, y: 0.6, z: 0 }, color, 55 * scale, 0.35, 16);
  }

  // -------------------------------------------------------------------------
  update(dt, rawDt = dt) {
    this.time += dt;
    this.add.update(dt);
    this.alpha.update(dt);

    for (const r of this.rings.items) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const t = 1 - r.life / r.dur;
      const s = lerp(r.r0, r.r1, r.ease(t));
      r.mesh.scale.set(s, s * r.sy, s);
      r.mat.uniforms.uT.value = t;
    }
    for (const L of this.bolts.items) {
      if (L.life <= 0) continue;
      L.life -= dt;
      if (L.life <= 0) { L.mesh.visible = false; continue; }
      L.regen -= dt;
      if (L.regen <= 0) { L.regen = 0.035; this._regenBolt(L); }
      L.mat.uniforms.uAlpha.value = Math.min(1, (L.life / L.dur) * 1.6) * (0.65 + Math.random() * 0.35);
    }
    for (const B of this.beams.items) {
      if (B.life <= 0) continue;
      B.life -= dt;
      if (B.life <= 0) { B.mesh.visible = false; continue; }
      B.mat.uniforms.uT.value = 1 - B.life / B.dur;
      B.mat.uniforms.uTime.value = this.time;
    }
    for (const A of this.arcs.items) {
      if (A.life <= 0) continue;
      A.life -= dt;
      if (A.hold && A.life < A.dur * 0.55) A.life = A.dur * 0.55; // projectiles keep the crescent fully formed
      if (A.life <= 0) { A.mesh.visible = false; A.hold = false; continue; }
      const t = 1 - A.life / A.dur;
      A.mat.uniforms.uT.value = t;
      A.mesh.position.x += A.vx * dt;
      A.mesh.position.y += A.vy * dt;
      const s = A.baseScale * (1 + A.grow * t);
      A.mesh.scale.set(s * A.facing, s, s);
    }
    for (const p of this.pillars.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      const t = 1 - p.life / p.dur;
      p.mat.uniforms.uT.value = t;
      p.mat.uniforms.uTime.value = this.time;
      const w = p.w * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5)) * (1 - Math.max(0, t - 0.7) * 2.2);
      p.mesh.scale.set(Math.max(0.01, w), p.h, Math.max(0.01, w));
    }
    for (const d of this.domes.items) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.mesh.visible = false; continue; }
      const t = 1 - d.life / d.dur;
      d.mesh.scale.setScalar(lerp(d.r0, d.r1, Ease.out3(t)));
      d.mat.uniforms.uT.value = t;
      d.mat.uniforms.uTime.value = this.time;
    }
    for (const d of this.decals.items) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.mesh.visible = false; continue; }
      const t = 1 - d.life / d.dur;
      d.mat.opacity = Math.min(1, (1 - t) * 3) * 0.85;
      d.gmat.opacity = Math.max(0, 1 - t * 3.5);
    }
    for (const l of this.lights.items) {
      if (l.life <= 0) continue;
      l.life -= dt;
      if (l.life <= 0) { l.light.intensity = 0; l.light.position.y = -50; continue; }
      const t = l.life / l.dur;
      l.light.intensity = l.peak * t * t;
    }
    // shards
    const sh = this.shards;
    let w = 0;
    for (let i = 0; i < sh.length; i++) {
      const s = sh[i];
      s.life -= dt;
      if (s.life <= 0) continue;
      s.vy -= 9 * dt;
      s.vx *= 1 - 1.5 * dt; s.vz *= 1 - 1.5 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < 0.03) { s.y = 0.03; s.vy *= -0.4; s.vx *= 0.6; }
      s.rx += s.wx * dt; s.ry += s.wy * dt; s.rz += s.wz * dt;
      const k = s.life / s.maxLife;
      _e.set(s.rx, s.ry, s.rz);
      _q.setFromEuler(_e);
      _v1.set(s.x, s.y, s.z);
      _s.setScalar(s.size * (0.4 + 0.6 * k));
      _m4.compose(_v1, _q, _s);
      this.shardMesh.setMatrixAt(w, _m4);
      _c.setRGB(s.r * k, s.g * k, s.b * k);
      this.shardMesh.setColorAt(w, _c);
      sh[w++] = s;
    }
    sh.length = w;
    this.shardMesh.count = w;
    if (w > 0) {
      this.shardMesh.instanceMatrix.needsUpdate = true;
      if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    this.add.clear();
    this.alpha.clear();
    for (const pool of [this.rings, this.bolts, this.beams, this.arcs, this.pillars, this.domes, this.decals]) {
      for (const it of pool.items) { it.life = 0; it.mesh.visible = false; }
    }
    for (const l of this.lights.items) { l.life = 0; l.light.intensity = 0; }
    this.shards.length = 0;
    this.shardMesh.count = 0;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}

function makeCrackTexture() {
  const S = 512;
  const mk = (glow) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    ctx.translate(S / 2, S / 2);
    if (!glow) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.42);
      g.addColorStop(0, 'rgba(0,0,0,0.75)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-S / 2, -S / 2, S, S);
    }
    return { c, ctx };
  };
  const dark = mk(false), glow = mk(true);
  const branch = (ctx, x, y, a, len, w, depth, col) => {
    let px = x, py = y;
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, py);
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      a += rand(-0.45, 0.45);
      px += Math.cos(a) * (len / steps);
      py += Math.sin(a) * (len / steps);
      ctx.lineTo(px, py);
      if (depth > 0 && Math.random() < 0.45) {
        ctx.stroke();
        branch(ctx, px, py, a + rand(0.4, 1) * randSign(), len * 0.55, w * 0.6, depth - 1, col);
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(px, py);
      }
    }
    ctx.stroke();
  };
  const seeds = [];
  for (let i = 0; i < 11; i++) seeds.push([rand(TAU), rand(S * 0.24, S * 0.42)]);
  // draw identical structure on both: we simply replay Math.random via stored params (approximate: draw both per branch)
  for (const [a, len] of seeds) {
    const saved = Math.random;
    const seq = [];
    for (let i = 0; i < 400; i++) seq.push(saved());
    let k = 0;
    Math.random = () => seq[k++ % seq.length];
    branch(dark.ctx, 0, 0, a, len, 7, 2, 'rgba(0,0,0,0.95)');
    k = 0;
    branch(glow.ctx, 0, 0, a, len, 3.2, 2, 'rgba(255,255,255,0.95)');
    Math.random = saved;
  }
  const gg = glow.ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.3);
  gg.addColorStop(0, 'rgba(255,255,255,0.5)');
  gg.addColorStop(1, 'rgba(255,255,255,0)');
  glow.ctx.globalCompositeOperation = 'source-atop';
  const td = new THREE.CanvasTexture(dark.c);
  const tg = new THREE.CanvasTexture(glow.c);
  td.colorSpace = THREE.SRGBColorSpace;
  tg.colorSpace = THREE.SRGBColorSpace;
  return { dark: td, glow: tg };
}
