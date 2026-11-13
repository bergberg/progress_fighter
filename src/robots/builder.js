import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEG } from '../engine/utils.js';

// ---------------------------------------------------------------------------
// Skeleton definition. Local frame: +X forward, +Y up, +Z = the robot's right.
// ---------------------------------------------------------------------------
export const BONES = [
  'hips', 'spine', 'chest', 'head',
  'armL', 'foreL', 'handL',
  'armR', 'foreR', 'handR',
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
];
export const NB = BONES.length;
export const BONE_INDEX = Object.fromEntries(BONES.map((b, i) => [b, i]));
/** channels: 3 per bone (swing, out, twist) + root x, root y, root yaw */
export const CH = NB * 3 + 3;
export const CH_ROOT_X = NB * 3;
export const CH_ROOT_Y = NB * 3 + 1;
export const CH_ROOT_YAW = NB * 3 + 2;

const SIDE = BONES.map((b) => (b.endsWith('L') ? 1 : b.endsWith('R') ? -1 : 1));
const IS_SIDED = BONES.map((b) => b.endsWith('L') || b.endsWith('R'));

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Rig {
  constructor(dims) {
    this.dims = dims;
    this.root = new THREE.Group(); // world placement (feet on ground)
    this.pivot = new THREE.Group(); // facing yaw
    this.root.add(this.pivot);
    this.bones = {};
    this.list = [];
    const d = dims;
    const mk = (name, parent, x, y, z) => {
      const b = new THREE.Group();
      b.name = name;
      b.position.set(x, y, z);
      b.rotation.order = 'ZXY';
      (parent || this.pivot).add(b);
      this.bones[name] = b;
      return b;
    };
    const hips = mk('hips', null, 0, d.hipY, 0);
    const spine = mk('spine', hips, 0, d.pelvis, 0);
    const chest = mk('chest', spine, 0, d.spine, 0);
    mk('head', chest, d.neckX || 0, d.chest, 0);
    for (const [S, s] of [['L', -1], ['R', 1]]) {
      const arm = mk('arm' + S, chest, d.shoulderX || 0, d.shoulderY, s * d.shoulderW);
      const fore = mk('fore' + S, arm, 0, -d.arm, 0);
      mk('hand' + S, fore, 0, -d.fore, 0);
      const thigh = mk('thigh' + S, hips, 0, 0, s * d.hipW);
      const shin = mk('shin' + S, thigh, 0, -d.thigh, 0);
      mk('foot' + S, shin, 0, -d.shin, 0);
    }
    for (const n of BONES) this.list.push(this.bones[n]);
    this.anchors = {};
    this.plates = {}; // bone -> armour meshes that can be blown off
    this.dynamic = {}; // animated sub-objects (blades, halos ...)
    this.materials = null;
    this.height = d.hipY + d.pelvis + d.spine + d.chest + (d.headH || 0.3);
    this.groundOffset = 0;
  }

  anchor(name, bone, x, y, z) {
    const a = new THREE.Object3D();
    a.position.set(x, y, z);
    this.bones[bone].add(a);
    this.anchors[name] = a;
    return a;
  }

  anchorPos(name, out) {
    return this.anchors[name].getWorldPosition(out);
  }

  /**
   * Apply a pose (Float32Array of CH channels, degrees) to the skeleton.
   * ground: 0..1 — how strongly feet are auto planted on the floor.
   */
  applyPose(p, ground = 1) {
    const d = this.dims;
    for (let i = 0; i < NB; i++) {
      const b = this.list[i];
      const k = i * 3;
      const s = IS_SIDED[i] ? SIDE[i] : 1;
      b.rotation.set(p[k + 1] * DEG * s, p[k + 2] * DEG * (IS_SIDED[i] ? -s : 1), p[k] * DEG);
    }
    const hips = this.list[0];
    hips.position.set(p[CH_ROOT_X], d.hipY + p[CH_ROOT_Y], 0);
    this.poseYaw = p[CH_ROOT_YAW] * DEG;
    this.groundOffset = 0;
    if (ground > 0) {
      // find the lowest sole point relative to the root and plant it at y = 0
      this.pivot.updateMatrix();
      let minY = Infinity;
      for (const f of ['footL', 'footR']) {
        const foot = this.bones[f];
        // compose matrix chain manually relative to pivot (cheap: 4 levels)
        _m.identity();
        let n = foot;
        const chain = [];
        while (n && n !== this.pivot) {
          chain.push(n);
          n = n.parent;
        }
        for (let i = chain.length - 1; i >= 0; i--) {
          chain[i].updateMatrix();
          _m.multiply(chain[i].matrix);
        }
        _v.set(d.footLen, -d.footH, 0).applyMatrix4(_m);
        if (_v.y < minY) minY = _v.y;
        _v.set(-d.heel, -d.footH, 0).applyMatrix4(_m);
        if (_v.y < minY) minY = _v.y;
      }
      this.groundOffset = -minY * ground;
      hips.position.y += this.groundOffset;
    }
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers (all return non-indexed geometry so anything can be merged)
// ---------------------------------------------------------------------------
const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    if (g.index) g = g.toNonIndexed();
    // normalise attribute set
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    geoCache.set(key, g);
  }
  return g;
}

export const G = {
  box: (w, h, d, r = 0.015) =>
    cached(`rb|${w}|${h}|${d}|${r}`, () => {
      const rr = Math.min(r, Math.min(w, h, d) * 0.49);
      return new RoundedBoxGeometry(w, h, d, 2, rr);
    }),
  cyl: (rt, rb, h, seg = 16, open = false) =>
    cached(`cy|${rt}|${rb}|${h}|${seg}|${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)),
  sphere: (r, ws = 16, hs = 12) => cached(`sp|${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs)),
  capsule: (r, len, seg = 12) => cached(`cap|${r}|${len}|${seg}`, () => new THREE.CapsuleGeometry(r, len, 4, seg)),
  torus: (r, t, seg = 24, arc = Math.PI * 2, tube = 8) =>
    cached(`to|${r}|${t}|${seg}|${arc}|${tube}`, () => new THREE.TorusGeometry(r, t, tube, seg, arc)),
  cone: (r, h, seg = 12) => cached(`co|${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  /** Extruded polygon. pts: [[x,y],...] in the side-view plane; depth along Z (centred). */
  plate: (pts, depth, bevel = 0.012) =>
    cached(`pl|${pts.flat().join(',')}|${depth}|${bevel}`, () => {
      const shape = new THREE.Shape();
      // ensure counter clockwise for consistent normals
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        area += x1 * y2 - x2 * y1;
      }
      const P = area < 0 ? [...pts].reverse() : pts;
      shape.moveTo(P[0][0], P[0][1]);
      for (let i = 1; i < P.length; i++) shape.lineTo(P[i][0], P[i][1]);
      shape.closePath();
      const b = Math.min(bevel, depth * 0.45);
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.001, depth - b * 2),
        bevelEnabled: b > 0,
        bevelThickness: b,
        bevelSize: b,
        bevelOffset: -b,
        bevelSegments: 1,
        steps: 1,
        curveSegments: 1,
      });
      g.translate(0, 0, -(depth - b * 2) / 2);
      return g;
    }),
  lathe: (pts, seg = 20) =>
    cached(`la|${pts.flat().join(',')}|${seg}`, () => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg)),
  tube: (pts, r, seg = 12, rs = 6) =>
    cached(`tu|${pts.flat().join(',')}|${r}`, () => {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
      return new THREE.TubeGeometry(curve, seg, r, rs, false);
    }),
};

function flipWinding(g) {
  for (const name of ['position', 'normal', 'uv']) {
    const a = g.attributes[name];
    if (!a) continue;
    const n = a.itemSize;
    const arr = a.array;
    for (let i = 0; i < arr.length; i += n * 3) {
      for (let k = 0; k < n; k++) {
        const t = arr[i + n + k];
        arr[i + n + k] = arr[i + 2 * n + k];
        arr[i + 2 * n + k] = t;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
let wearTex = null;
function getWearTexture() {
  if (wearTex) return wearTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d0d0d0';
  ctx.fillRect(0, 0, S, S);
  // smudges
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 6 + Math.random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = Math.random() < 0.5 ? 255 : 0;
    g.addColorStop(0, `rgba(${v},${v},${v},${0.03 + Math.random() * 0.07})`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // fine scratches
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const a = Math.random() * Math.PI;
    const l = 3 + Math.random() * 22;
    ctx.strokeStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.1})`;
    ctx.lineWidth = 0.5 + Math.random() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  wearTex = new THREE.CanvasTexture(c);
  wearTex.wrapS = wearTex.wrapT = THREE.RepeatWrapping;
  wearTex.repeat.set(3, 3);
  wearTex.colorSpace = THREE.NoColorSpace;
  return wearTex;
}

export function makeMaterials(paint) {
  const wear = getWearTexture();
  const glowColor = new THREE.Color(paint.glow);
  // normalise emissive strength by luminance so every hue blooms equally
  const lum = 0.2126 * glowColor.r + 0.7152 * glowColor.g + 0.0722 * glowColor.b;
  const gi = Math.min(6, Math.max(1.5, 1.35 / Math.max(lum, 0.05)));
  const M = {
    armor: new THREE.MeshPhysicalMaterial({
      color: paint.primary, metalness: paint.metal ?? 0.6, roughness: paint.rough ?? 0.56,
      clearcoat: paint.coat ?? 0.45, clearcoatRoughness: 0.5, roughnessMap: wear,
    }),
    armor2: new THREE.MeshPhysicalMaterial({
      color: paint.secondary, metalness: 0.85, roughness: 0.6, clearcoat: 0.25, clearcoatRoughness: 0.5, roughnessMap: wear,
    }),
    trim: new THREE.MeshStandardMaterial({ color: paint.trim ?? 0xc8a04a, metalness: 1, roughness: 0.28, roughnessMap: wear }),
    frame: new THREE.MeshStandardMaterial({ color: 0x1b1e24, metalness: 0.85, roughness: 0.55, roughnessMap: wear }),
    dark: new THREE.MeshStandardMaterial({ color: 0x07080a, metalness: 0.4, roughness: 0.8 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe5ee, metalness: 1, roughness: 0.14 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: glowColor, emissiveIntensity: gi, roughness: 0.4 }),
    glowDim: new THREE.MeshStandardMaterial({ color: 0x050505, emissive: glowColor, emissiveIntensity: gi * 0.4, roughness: 0.5 }),
    visor: new THREE.MeshPhysicalMaterial({
      color: 0x020203, emissive: glowColor, emissiveIntensity: gi * 0.9, metalness: 1, roughness: 0.08, clearcoat: 1,
    }),
    energy: new THREE.MeshBasicMaterial({
      color: glowColor.clone().multiplyScalar(gi * 1.6), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }),
  };
  M.glowBase = gi;
  M.glowColor = glowColor;
  M.flashable = [M.armor, M.armor2, M.frame, M.trim, M.chrome];
  for (const k of Object.keys(M)) if (M[k] && M[k].isMaterial) M[k].name = k;
  return M;
}

const PLATE_MATS = new Set(['armor', 'armor2', 'trim', 'glow']);
/** armour layers in the order they are purged */
export const PLATE_LAYERS = [
  { id: 'arms', name: 'ARM PLATING', bones: ['armL', 'foreL', 'handL', 'armR', 'foreR', 'handR'] },
  { id: 'legs', name: 'LEG PLATING', bones: ['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'] },
  { id: 'head', name: 'HELM & SKIRT', bones: ['head', 'hips'] },
  { id: 'core', name: 'CORE PLATING', bones: ['chest', 'spine'] },
];

// ---------------------------------------------------------------------------
// Part builder: collects transformed geometry per bone/material and merges it.
// ---------------------------------------------------------------------------
export class RobotBuilder {
  constructor(dims, paint) {
    this.rig = new Rig(dims);
    this.M = makeMaterials(paint);
    this.rig.materials = this.M;
    this.buckets = new Map(); // bone|mat -> geometries
    this.d = dims;
  }

  /**
   * add geometry `g` to `bone` using material key `mat`.
   * t = [x,y,z, rx,ry,rz (deg), sx,sy,sz]
   */
  add(bone, g, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx * DEG, ry * DEG, rz * DEG, 'ZYX');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    const geo = g.clone();
    geo.applyMatrix4(_m);
    if (sx * sy * sz < 0) flipWinding(geo);
    const key = bone + '|' + mat;
    let arr = this.buckets.get(key);
    if (!arr) this.buckets.set(key, (arr = []));
    arr.push(geo);
    return this;
  }

  /** run fn(S, s) for both sides — S: 'L'|'R', s: -1|+1 (z sign) */
  both(fn) {
    fn('L', -1);
    fn('R', 1);
  }

  /** a row of bolts along a line */
  bolts(bone, mat, x0, y0, z0, x1, y1, z1, n, r = 0.012) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this.add(bone, G.sphere(r, 8, 6), mat, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t);
    }
  }

  /** vent grille: n dark slats inside a frame, facing along X (front/back) or Z (sides) */
  vent(bone, x, y, z, w, h, n, axis = 'x', rz = 0) {
    const t = 0.012;
    for (let i = 0; i < n; i++) {
      const yy = y - h / 2 + (h / n) * (i + 0.5);
      if (axis === 'x') this.add(bone, G.box(t, (h / n) * 0.45, w, 0.003), 'dark', x, yy, z, 0, 0, rz + 25);
      else this.add(bone, G.box(w, (h / n) * 0.45, t, 0.003), 'dark', x, yy, z, 25, 0, rz);
    }
  }

  /** piston between two points on the same bone */
  piston(bone, a, b, r = 0.016) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const g1 = G.cyl(r * 1.5, r * 1.5, len * 0.55, 10);
    const g2 = G.cyl(r, r, len, 8);
    // orient Y axis along direction
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const push = (g, mat, t) => {
      const geo = g.clone();
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(a[0] + dx * t, a[1] + dy * t, a[2] + dz * t), q, new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(m);
      const key = bone + '|' + mat;
      let arr = this.buckets.get(key);
      if (!arr) this.buckets.set(key, (arr = []));
      arr.push(geo);
    };
    push(g1, 'frame', 0.3);
    push(g2, 'chrome', 0.5);
  }

  /** Finalise: merge buckets into meshes parented to bones. */
  build() {
    const rig = this.rig;
    const ghostParts = {};
    for (const [key, geos] of this.buckets) {
      const [bone, mat] = key.split('|');
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      const mesh = new THREE.Mesh(merged, this.M[mat]);
      const emissive = mat === 'glow' || mat === 'glowDim' || mat === 'energy';
      mesh.castShadow = !emissive;
      mesh.receiveShadow = !emissive;
      rig.bones[bone].add(mesh);
      // armour shell (as opposed to the inner skeleton) can be purged in combat
      if (PLATE_MATS.has(mat)) (rig.plates[bone] ||= []).push(mesh);
      if (!emissive || mat === 'glow') (ghostParts[bone] ||= []).push(merged);
    }
    // merged per-bone geometry for after-image ghosts
    rig.ghostGeo = {};
    for (const bone of Object.keys(ghostParts)) {
      const list = ghostParts[bone];
      rig.ghostGeo[bone] = list.length === 1 ? list[0] : mergeGeometries(list, false);
    }
    this.buckets.clear();
    return rig;
  }
}

/** After-image "ghost": a frozen copy of a rig's pose rendered with a fresnel energy shader. */
export class Ghost {
  constructor(rig, color) {
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV;
        void main(){
          float f = clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0001, 1.0);
          float a = (0.12 + pow(f, 1.6) * 1.6) * uAlpha;
          gl_FragColor = vec4(uColor * a * 2.2, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.parts = [];
    for (const name of BONES) {
      const geo = rig.ghostGeo[name];
      if (!geo) continue;
      const m = new THREE.Mesh(geo, this.material);
      m.matrixAutoUpdate = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.parts.push({ mesh: m, bone: rig.bones[name] });
    }
    this.life = 0;
    this.maxLife = 1;
    this.group.visible = false;
  }
  snapshot(life = 0.3, alpha = 1) {
    for (const p of this.parts) {
      p.mesh.matrix.copy(p.bone.matrixWorld);
      p.mesh.matrixWorld.copy(p.bone.matrixWorld);
    }
    this.life = this.maxLife = life;
    this.alpha = alpha;
    this.group.visible = true;
  }
  update(dt) {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.group.visible = false;
      return;
    }
    this.material.uniforms.uAlpha.value = (this.life / this.maxLife) * this.alpha;
  }
  dispose() {
    this.material.dispose();
  }
}
