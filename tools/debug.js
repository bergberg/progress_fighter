// Developer viewer: renders robots / poses for visual inspection.
//   debug.html?mode=lineup
//   debug.html?mode=anim&robot=vanguard&anim=light1&n=8
import * as THREE from 'three';
import { Renderer, buildEnvironment } from '../src/engine/renderer.js';
import { buildRobot } from '../src/robots/chassis.js';
import { compile, sample } from '../src/robots/anim.js';
import { CH } from '../src/robots/builder.js';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') || 'lineup';
const R = new Renderer(document.getElementById('game'));
R.dynamicRes = false;
R.setQuality(q.get('quality') || 'high');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.environment = buildEnvironment(R.gl, {
  top: 0x3a4658, bottom: 0x0a0b0e,
  panels: [
    { color: 0xffffff, intensity: 2.5, pos: [0, 30, 10], w: 30, h: 12 },
    { color: 0x66aaff, intensity: 2, pos: [-30, 8, 5], w: 14, h: 20 },
    { color: 0xff8844, intensity: 2, pos: [30, 6, -5], w: 14, h: 20 },
  ],
});
scene.environmentIntensity = 1.4;
const cam = new THREE.PerspectiveCamera(Number(q.get('fov') || 30), 1, 0.1, 200);
const key = new THREE.DirectionalLight(0xfff1e0, 3.2);
key.position.set(5, 9, 8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -9, right: 9, top: 7, bottom: -2, near: 1, far: 30 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0x66bbff, 1.6); rim.position.set(-7, 6, -7); scene.add(rim);
scene.add(new THREE.HemisphereLight(0x9bb4d8, 0x2a2420, 0.9));
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshStandardMaterial({ color: 0x16191f, roughness: 0.55, metalness: 0.4 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

const PAINTS = {
  vanguard: { primary: 0x1f5fd6, secondary: 0xe8ecf2, glow: 0x39d5ff, trim: 0xd9b25a },
  bastion: { primary: 0xc7421a, secondary: 0x2a2d33, glow: 0xff9a2a, trim: 0x8d9299 },
  wraith: { primary: 0x2a2140, secondary: 0x14141c, glow: 0xc04bff, trim: 0x9aa0b4 },
  tempest: { primary: 0xe9edf2, secondary: 0x2b3a67, glow: 0x4dffd2, trim: 0xe0b64f },
};
const stance = {
  hips: -4, spine: -4, chest: -4, head: 8,
  armL: [48, 12, 0], foreL: 96, armR: [12, 14, 0], foreR: 118,
  thighL: [26, 6, 0], shinL: -34, thighR: [-14, 8, 0], shinR: -30,
};

const robots = [];
async function main() {
  let M = null;
  try { M = await import('../src/robots/moveset.js'); } catch (e) { console.warn('no moveset yet', e.message); }
  if (mode === 'lineup') {
    const ids = (q.get('robots') || 'vanguard,bastion,wraith,tempest').split(',');
    const mods = (q.get('mods') || '').split(',').filter(Boolean);
    ids.forEach((id, i) => {
      const rig = buildRobot(id, PAINTS[id], mods);
      rig.root.position.x = (i - (ids.length - 1) / 2) * 2.2;
      rig.pivot.rotation.y = -Number(q.get('yaw') ?? 25) * Math.PI / 180;
      const pose = M ? sample(M.getMoveset(id).anims.idle, Number(q.get('t') || 0), new Float32Array(CH)) : compile(stance);
      rig.applyPose(pose, 1);
      scene.add(rig.root);
      robots.push(rig);
    });
    const z = Number(q.get('dist') || (ids.length > 1 ? 15 : 7));
    cam.position.set(Number(q.get('cx') || 0), Number(q.get('cy') || 1.5), z);
    cam.lookAt(0, Number(q.get('ly') || 1.25), 0);
  } else if (mode === 'anim') {
    const id = q.get('robot') || 'vanguard';
    const name = q.get('anim') || 'idle';
    const n = Number(q.get('n') || 8);
    const ms = M.getMoveset(id);
    const c = ms.anims[name];
    for (let i = 0; i < n; i++) {
      const rig = buildRobot(id, PAINTS[id], []);
      rig.root.position.x = (i - (n - 1) / 2) * 2.4;
      rig.pivot.rotation.y = -Number(q.get('yaw') ?? 20) * Math.PI / 180;
      const t = (c.dur * i) / (c.loop ? n : n - 1);
      const pose = sample(c, t, new Float32Array(CH));
      rig.applyPose(pose, c.ground);
      rig.pivot.rotation.y += rig.poseYaw;
      if (rig.dynamic.blade) { rig.dynamic.blade.visible = true; rig.dynamic.blade.scale.y = 1; }
      scene.add(rig.root);
      robots.push(rig);
    }
    cam.position.set(0, 1.6, Number(q.get('dist') || 4 + n * 2.6));
    cam.lookAt(0, 1.3, 0);
  }
  R.setScene(scene, cam);
  R.render(0.016);
  R.render(0.016);
  window.__ready = true;
  if (q.get('spin')) {
    let last = performance.now();
    const loop = (now) => { const dt = (now - last) / 1000; last = now; robots.forEach((r) => (r.pivot.rotation.y += dt * 0.6)); R.render(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
main().catch((e) => { console.error(e); window.__error = String(e.stack || e); });
