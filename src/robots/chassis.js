import * as THREE from 'three';
import { RobotBuilder, G } from './builder.js';

// ===========================================================================
// Shared sub-assemblies
// ===========================================================================

/** Inner skeleton: joints, struts, hands and feet shared by every chassis. */
function skeleton(b, o = {}) {
  const d = b.d;
  const ar = o.armR ?? 0.05; // arm strut radius
  const lr = o.legR ?? 0.065;
  // pelvis
  b.add('hips', G.box(0.2 * (o.bulk ?? 1), 0.16, d.hipW * 2 + 0.02, 0.03), 'frame', 0, 0.01, 0);
  b.add('hips', G.cyl(0.05, 0.05, d.hipW * 2 + 0.12, 14), 'chrome', 0, 0, 0, 90, 0, 0);
  // abdomen: stacked flexible segments
  const segs = 3;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const w = (o.waistW ?? 0.3) * (1 + t * 0.18);
    b.add('spine', G.box((o.waistD ?? 0.2) * (1 + t * 0.15), d.spine / segs - 0.012, w, 0.025), 'frame', 0.01, (d.spine / segs) * (i + 0.5), 0);
    b.add('spine', G.box(0.012, 0.012, w + 0.01, 0.004), 'dark', (o.waistD ?? 0.2) * 0.5 + 0.012, (d.spine / segs) * (i + 0.5), 0);
  }
  b.add('hips', G.box((o.waistD ?? 0.2) * 0.9, d.pelvis + 0.04, (o.waistW ?? 0.3) * 0.92, 0.025), 'frame', 0.005, d.pelvis * 0.5 + 0.06, 0);
  // rib cage, exposed reactor and sensor skull: only visible once the plating has been purged
  const cw = (o.waistW ?? 0.3) * 1.05, cd = (o.waistD ?? 0.2);
  for (let i = 0; i < 4; i++) {
    const y = d.chest * (0.14 + i * 0.2);
    b.add('chest', G.box(cd * (0.9 + i * 0.05), d.chest * 0.09, cw * (0.86 + i * 0.06), 0.02), 'frame', 0.02, y, 0);
  }
  b.add('chest', G.cyl(0.035, 0.045, d.chest * 0.86, 10), 'chrome', -cd * 0.3, d.chest * 0.45, 0);
  b.add('chest', G.sphere(Math.min(cd, cw) * 0.36, 14, 10), 'glowDim', cd * 0.12, d.chest * 0.47, 0);
  b.add('chest', G.torus(Math.min(cd, cw) * 0.44, 0.012, 16), 'chrome', cd * 0.12, d.chest * 0.47, 0, 0, 90, 0);
  b.both((S, s) => {
    b.add('chest', G.box(0.05, 0.05, d.shoulderW - cw * 0.4, 0.015), 'frame', 0, d.shoulderY, s * (cw * 0.2 + d.shoulderW * 0.5));
  });
  const hk = d.headH / 0.34;
  b.add('head', G.box(0.13 * hk, 0.14 * hk, 0.125 * hk, 0.03), 'frame', 0.02, d.headH * 0.5, 0);
  b.add('head', G.box(0.03, 0.03 * hk, 0.1 * hk, 0.008), 'glowDim', 0.02 + 0.066 * hk, d.headH * 0.54, 0);
  b.both((S, s) => {
    b.piston('spine', [-0.07, 0.0, s * 0.11], [-0.09, d.spine, s * 0.13], 0.014);
    b.piston('spine', [0.08, 0.0, s * 0.1], [0.1, d.spine, s * 0.13], 0.011);
    // --- arm
    b.add('arm' + S, G.sphere(ar * 1.9, 16, 12), 'frame', 0, 0, 0);
    b.add('arm' + S, G.cyl(ar * 1.25, ar * 1.25, ar * 4.4, 16), 'chrome', 0, 0, 0, 90, 0, 0);
    b.add('arm' + S, G.cyl(ar, ar * 0.9, d.arm, 12), 'frame', 0, -d.arm / 2, 0);
    b.piston('arm' + S, [-ar * 1.1, -0.06, 0], [-ar * 1.0, -d.arm + 0.04, 0], 0.011);
    b.add('fore' + S, G.cyl(ar * 1.35, ar * 1.35, ar * 3.2, 16), 'frame', 0, 0, 0, 90, 0, 0);
    b.add('fore' + S, G.cyl(ar * 0.8, ar * 0.8, ar * 3.5, 12), 'chrome', 0, 0, 0, 90, 0, 0);
    b.add('fore' + S, G.cyl(ar * 0.95, ar * 0.8, d.fore, 12), 'frame', 0, -d.fore / 2, 0);
    // --- hand (fist)
    const hs = o.hand ?? 1;
    b.add('hand' + S, G.cyl(0.04 * hs, 0.04 * hs, 0.05, 10), 'chrome', 0, -0.005, 0);
    b.add('hand' + S, G.box(0.085 * hs, 0.1 * hs, 0.11 * hs, 0.02), 'frame', 0.0, -0.065 * hs, 0);
    b.add('hand' + S, G.box(0.075 * hs, 0.075 * hs, 0.118 * hs, 0.02), 'frame', 0.035 * hs, -0.115 * hs, 0);
    for (let i = 0; i < 4; i++)
      b.add('hand' + S, G.box(0.03 * hs, 0.04 * hs, 0.022 * hs, 0.008), 'dark', 0.072 * hs, -0.118 * hs, (i - 1.5) * 0.029 * hs);
    b.add('hand' + S, G.box(0.04 * hs, 0.06 * hs, 0.03 * hs, 0.01), 'frame', 0.05 * hs, -0.07 * hs, -s * 0.06 * hs, 0, 0, 20);
    // --- leg
    b.add('thigh' + S, G.sphere(lr * 1.5, 16, 12), 'frame', 0, 0, 0);
    b.add('thigh' + S, G.cyl(lr, lr * 0.85, d.thigh, 12), 'frame', 0, -d.thigh / 2, 0);
    b.piston('thigh' + S, [-lr * 1.1, -0.08, 0], [-lr * 0.9, -d.thigh + 0.05, 0], 0.014);
    b.add('shin' + S, G.cyl(lr * 1.3, lr * 1.3, lr * 2.6, 16), 'frame', 0, 0, 0, 90, 0, 0);
    b.add('shin' + S, G.cyl(lr * 0.8, lr * 0.8, lr * 2.9, 12), 'chrome', 0, 0, 0, 90, 0, 0);
    b.add('shin' + S, G.cyl(lr * 0.9, lr * 0.7, d.shin, 12), 'frame', 0, -d.shin / 2, 0);
    b.piston('shin' + S, [-lr * 1.0, -0.1, 0], [-0.05, -d.shin + 0.02, 0], 0.012);
    // --- foot
    b.add('foot' + S, G.cyl(lr * 0.9, lr * 0.9, lr * 2.2, 14), 'chrome', 0, 0, 0, 90, 0, 0);
    const fw = o.footW ?? 0.15;
    b.add('foot' + S, G.plate([[-d.heel, -d.footH], [d.footLen, -d.footH], [d.footLen, -d.footH + 0.035], [0.06, 0.0], [-0.06, 0.0], [-d.heel, -d.footH + 0.05]], fw, 0.015), 'frame', 0, 0, 0);
    b.add('foot' + S, G.box(d.footLen + d.heel - 0.02, 0.02, fw + 0.01, 0.006), 'dark', (d.footLen - d.heel) / 2, -d.footH + 0.008, 0);
  });
}

function anchors(b, o = {}) {
  const d = b.d;
  const rig = b.rig;
  rig.anchor('handR', 'handR', 0.03, -0.1, 0);
  rig.anchor('handL', 'handL', 0.03, -0.1, 0);
  rig.anchor('elbowR', 'foreR', 0, 0, 0);
  rig.anchor('elbowL', 'foreL', 0, 0, 0);
  rig.anchor('footR', 'footR', d.footLen * 0.6, -d.footH * 0.5, 0);
  rig.anchor('footL', 'footL', d.footLen * 0.6, -d.footH * 0.5, 0);
  rig.anchor('kneeR', 'shinR', 0, 0, 0);
  rig.anchor('kneeL', 'shinL', 0, 0, 0);
  rig.anchor('core', 'chest', o.coreX ?? 0.26, o.coreY ?? 0.2, 0);
  rig.anchor('head', 'head', 0.06, d.headH * 0.5, 0);
  rig.anchor('back', 'chest', -(o.backX ?? 0.32), o.backY ?? 0.22, 0);
  rig.anchor('hips', 'hips', 0, 0, 0);
  rig.anchor('neck', 'chest', -0.08, d.chest, 0);
  // weapon tips (default = extended fists)
  rig.anchor('tipR', 'handR', o.tipX ?? 0.06, o.tipY ?? -0.2, 0);
  rig.anchor('tipL', 'handL', o.tipX ?? 0.06, o.tipY ?? -0.2, 0);
}

// ===========================================================================
// VANGUARD — balanced knight frame with an arc-blade housed in the right arm
// ===========================================================================
function buildVanguard(paint, mods) {
  const d = {
    hipY: 1.16, pelvis: 0.1, spine: 0.2, chest: 0.42, headH: 0.34, shoulderY: 0.3, shoulderW: 0.37, hipW: 0.16,
    arm: 0.4, fore: 0.38, thigh: 0.5, shin: 0.52, footH: 0.14, footLen: 0.27, heel: 0.1,
  };
  const b = new RobotBuilder(d, paint);
  skeleton(b, { armR: 0.05, legR: 0.062 });

  // ---- hips
  b.add('hips', G.plate([[0.08, 0.1], [0.2, 0.06], [0.17, -0.12], [0.06, -0.2], [0.02, -0.06]], 0.17, 0.015), 'armor', 0, 0, 0);
  b.add('hips', G.box(0.014, 0.1, 0.05, 0.004), 'glow', 0.19, -0.02, 0, 0, 0, -8);
  b.add('hips', G.plate([[-0.08, 0.1], [-0.18, 0.06], [-0.2, -0.1], [-0.1, -0.16], [-0.04, -0.04]], 0.24, 0.015), 'armor2', 0, 0, 0);
  b.add('hips', G.box(0.34, 0.05, 0.4, 0.015), 'armor2', 0, 0.1, 0);
  b.bolts('hips', 'chrome', 0.165, 0.1, -0.14, 0.165, 0.1, 0.14, 5, 0.011);
  b.both((S, s) => {
    // side tassets
    b.add('hips', G.plate([[-0.1, 0.08], [0.11, 0.08], [0.14, -0.1], [0.04, -0.26], [-0.08, -0.2], [-0.13, -0.06]], 0.035, 0.012), 'armor', 0, 0, s * 0.245, s * -9, 0, 0);
    b.add('hips', G.box(0.1, 0.012, 0.012, 0.004), 'glow', 0.0, -0.03, s * 0.268, s * -9, 0, -12);
    b.add('hips', G.cyl(0.035, 0.035, 0.02, 12), 'trim', 0.02, 0.045, s * 0.262, 90 + s * -9, 0, 0);
  });

  // ---- chest
  b.add('chest', G.plate([[-0.17, -0.03], [0.14, -0.05], [0.265, 0.12], [0.255, 0.29], [0.13, 0.42], [-0.15, 0.42], [-0.225, 0.24]], 0.5, 0.03), 'armor', 0, 0, 0);
  // sternum ridge + reactor
  b.add('chest', G.plate([[0.13, -0.06], [0.285, 0.11], [0.275, 0.3], [0.15, 0.43], [0.1, 0.4], [0.22, 0.28], [0.225, 0.13], [0.1, -0.03]], 0.12, 0.012), 'armor2', 0, 0, 0);
  b.add('chest', G.cyl(0.062, 0.062, 0.03, 24), 'glow', 0.275, 0.2, 0, 0, 0, 90);
  b.add('chest', G.torus(0.07, 0.014, 24), 'chrome', 0.282, 0.2, 0, 0, 90, 0);
  b.add('chest', G.torus(0.035, 0.007, 16), 'dark', 0.293, 0.2, 0, 0, 90, 0);
  b.both((S, s) => {
    // pectoral plates with chevron lights
    b.add('chest', G.plate([[0.0, 0.0], [0.17, 0.02], [0.2, 0.17], [0.03, 0.2]], 0.03, 0.01), 'armor', 0.14, 0.2, s * 0.262, 0, s * 78, -8);
    b.add('chest', G.box(0.012, 0.022, 0.17, 0.004), 'glow', 0.262, 0.335, s * 0.135, s * -24, s * 12, 0);
    b.add('chest', G.box(0.012, 0.016, 0.12, 0.004), 'glow', 0.268, 0.295, s * 0.15, s * -24, s * 12, 0);
    // rib vents
    b.vent('chest', 0.2, 0.05, s * 0.2, 0.09, 0.1, 4, 'x', -35);
    b.add('chest', G.box(0.2, 0.012, 0.012, 0.004), 'trim', 0.03, 0.0, s * 0.252);
    // shoulder socket
    b.add('chest', G.cyl(0.1, 0.1, 0.07, 18), 'armor2', 0, d.shoulderY, s * 0.27, 90, 0, 0);
    // collar wings
    b.add('chest', G.plate([[-0.14, 0.0], [0.12, 0.0], [0.08, 0.1], [-0.12, 0.13]], 0.03, 0.01), 'armor', 0, 0.41, s * 0.15, s * 24, 0, 0);
    // back thrusters
    b.add('chest', G.cyl(0.05, 0.07, 0.14, 14), 'frame', -0.33, 0.13, s * 0.11, 0, 0, 62);
    b.add('chest', G.cyl(0.04, 0.04, 0.01, 14), 'glow', -0.385, 0.1, s * 0.11, 0, 0, 62);
    b.add('chest', G.plate([[0.0, 0.0], [-0.36, 0.26], [-0.33, 0.33], [-0.02, 0.16], [0.05, 0.08]], 0.035, 0.012), 'armor', -0.2, 0.3, s * 0.17, s * -16, s * -10, 0);
    b.add('chest', G.box(0.2, 0.012, 0.012, 0.004), 'glow', -0.42, 0.52, s * 0.215, s * -16, s * -10, -38);
  });
  b.add('chest', G.box(0.17, 0.32, 0.38, 0.04), 'armor2', -0.235, 0.22, 0);
  b.vent('chest', -0.325, 0.3, 0, 0.2, 0.1, 4, 'x', 0);
  b.add('chest', G.cyl(0.12, 0.15, 0.07, 10), 'armor2', 0, 0.435, 0);

  // ---- head
  b.add('head', G.cyl(0.055, 0.065, 0.1, 12), 'frame', 0, 0.04, 0);
  b.add('head', G.plate([[-0.12, 0.08], [0.06, 0.07], [0.15, 0.13], [0.17, 0.2], [0.1, 0.31], [-0.06, 0.33], [-0.14, 0.24]], 0.2, 0.03), 'armor', 0, 0, 0);
  b.add('head', G.box(0.03, 0.036, 0.17, 0.008), 'visor', 0.148, 0.205, 0, 0, 0, -8);
  b.add('head', G.plate([[0.06, 0.06], [0.17, 0.11], [0.16, 0.165], [0.1, 0.13]], 0.13, 0.01), 'armor2', 0, 0, 0);
  b.add('head', G.plate([[0.1, 0.3], [-0.02, 0.36], [-0.3, 0.46], [-0.24, 0.36], [-0.1, 0.3]], 0.028, 0.01), 'trim', 0, 0, 0);
  b.both((S, s) => {
    b.add('head', G.plate([[-0.1, 0.1], [0.07, 0.1], [0.11, 0.2], [0.02, 0.27], [-0.11, 0.24]], 0.02, 0.008), 'armor2', 0, 0, s * 0.108);
    b.add('head', G.cyl(0.03, 0.03, 0.03, 12), 'chrome', -0.03, 0.17, s * 0.115, 90, 0, 0);
    b.add('head', G.box(0.012, 0.14, 0.012, 0.004), 'frame', -0.06, 0.3, s * 0.118, 0, 0, 18);
  });

  // ---- arms
  b.both((S, s) => {
    const arm = 'arm' + S, fore = 'fore' + S, hand = 'hand' + S;
    // layered pauldron
    b.add(arm, G.plate([[-0.15, -0.04], [0.15, -0.04], [0.17, 0.08], [0.08, 0.17], [-0.1, 0.17], [-0.18, 0.06]], 0.2, 0.03), 'armor', 0, 0, s * 0.045, s * -10, 0, 0);
    b.add(arm, G.plate([[-0.13, -0.14], [0.13, -0.14], [0.155, -0.03], [-0.16, -0.03]], 0.17, 0.02), 'armor2', 0, 0, s * 0.07, s * -16, 0, 0);
    b.add(arm, G.box(0.24, 0.014, 0.014, 0.004), 'glow', 0, -0.03, s * 0.158, s * -12, 0, 0);
    b.add(arm, G.cyl(0.04, 0.04, 0.02, 12), 'trim', 0, 0.07, s * 0.15, 90 + s * -10, 0, 0);
    b.add(arm, G.box(0.13, 0.2, 0.125, 0.03), 'armor', 0.005, -0.24, 0);
    b.add(arm, G.box(0.02, 0.14, 0.05, 0.006), 'armor2', 0.07, -0.24, 0);
    // gauntlet
    b.add(fore, G.plate([[-0.075, -0.05], [0.085, -0.03], [0.1, -0.2], [0.075, -0.36], [-0.06, -0.36], [-0.085, -0.2]], 0.135, 0.025), 'armor', 0, 0, 0);
    b.add(fore, G.plate([[-0.05, 0.05], [-0.12, -0.02], [-0.1, -0.14], [-0.06, -0.06]], 0.07, 0.012), 'armor2', 0, 0, 0);
    b.add(fore, G.box(0.014, 0.2, 0.03, 0.005), 'glow', 0.098, -0.2, 0, 0, 0, 3);
    b.add(fore, G.torus(0.068, 0.012, 16), 'trim', 0, -0.365, 0, 90, 0, 0);
    b.add(hand, G.box(0.05, 0.085, 0.125, 0.015), 'armor', 0.062, -0.075, 0);
  });
  // arc-blade housing on the right forearm (outer side) and plasma blade (dynamic)
  b.add('foreR', G.box(0.07, 0.3, 0.05, 0.015), 'armor2', -0.02, -0.2, 0.085);
  b.add('foreR', G.box(0.03, 0.05, 0.03, 0.008), 'chrome', -0.02, -0.36, 0.085);
  b.add('foreR', G.box(0.012, 0.22, 0.012, 0.004), 'glow', -0.02, -0.2, 0.113);

  // ---- legs
  b.both((S, s) => {
    const th = 'thigh' + S, sh = 'shin' + S, ft = 'foot' + S;
    b.add(th, G.plate([[-0.085, -0.03], [0.1, -0.05], [0.135, -0.24], [0.1, -0.46], [-0.06, -0.44], [-0.1, -0.24]], 0.17, 0.03), 'armor', 0, 0, 0);
    b.add(th, G.plate([[0.07, -0.08], [0.15, -0.22], [0.12, -0.4], [0.09, -0.26]], 0.1, 0.012), 'armor2', 0, 0, 0);
    b.add(th, G.box(0.012, 0.2, 0.02, 0.004), 'glow', 0.02, -0.26, s * 0.088);
    b.add(th, G.cyl(0.05, 0.05, 0.02, 14), 'trim', 0, -0.02, s * 0.09, 90, 0, 0);
    // knee guard
    b.add(sh, G.plate([[0.04, 0.1], [0.14, 0.04], [0.15, -0.08], [0.07, -0.1], [0.03, 0.0]], 0.13, 0.02), 'armor', 0, 0, 0);
    b.add(sh, G.box(0.012, 0.05, 0.07, 0.004), 'glow', 0.152, -0.02, 0);
    // greave
    b.add(sh, G.plate([[-0.07, -0.08], [0.08, -0.1], [0.115, -0.3], [0.1, -0.5], [-0.09, -0.5], [-0.12, -0.3]], 0.16, 0.03), 'armor', 0, 0, 0);
    b.add(sh, G.plate([[-0.1, -0.12], [-0.17, -0.24], [-0.15, -0.44], [-0.1, -0.4]], 0.09, 0.015), 'armor2', 0, 0, 0);
    b.add(sh, G.cyl(0.028, 0.036, 0.06, 10), 'frame', -0.15, -0.46, 0, 0, 0, 20);
    b.add(sh, G.cyl(0.024, 0.024, 0.008, 10), 'glow', -0.162, -0.493, 0, 0, 0, 20);
    b.add(sh, G.torus(0.085, 0.014, 16), 'trim', 0, -0.5, 0, 90, 0, 0);
    // sabaton
    b.add(ft, G.plate([[-0.11, -0.13], [0.29, -0.13], [0.3, -0.08], [0.16, 0.0], [0.06, 0.04], [-0.07, 0.03], [-0.13, -0.06]], 0.175, 0.025), 'armor', 0, 0, 0);
    b.add(ft, G.plate([[0.16, -0.13], [0.31, -0.13], [0.315, -0.075], [0.2, -0.03]], 0.185, 0.012), 'armor2', 0, 0, 0);
    b.add(ft, G.box(0.012, 0.02, 0.1, 0.004), 'glow', 0.2, -0.02, 0, 0, 0, -30);
  });

  anchors(b, { coreX: 0.29, coreY: 0.2, tipY: -0.62, tipX: 0 });
  const rig = b.build();

  // dynamic plasma blade
  const blade = new THREE.Group();
  const bladeGeo = G.plate([[-0.035, 0], [0.035, 0], [0.05, -0.5], [0.0, -0.72], [-0.02, -0.5]], 0.012, 0.004);
  const bm = new THREE.Mesh(bladeGeo, b.M.energy);
  blade.add(bm);
  const coreGeo = G.plate([[-0.012, 0], [0.012, 0], [0.018, -0.48], [0.0, -0.66], [-0.008, -0.48]], 0.02, 0.004);
  blade.add(new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6), toneMapped: false })));
  blade.position.set(-0.02, -0.38, 0.085);
  blade.scale.set(1, 0.001, 1);
  blade.visible = false;
  rig.bones.foreR.add(blade);
  rig.dynamic.blade = blade;
  rig.anchors.tipR.removeFromParent();
  rig.anchor('tipR', 'foreR', -0.02, -1.05, 0.085);
  rig.anchor('baseR', 'foreR', -0.02, -0.38, 0.085);
  return rig;
}

// ===========================================================================
// BASTION — siege frame. Colossal piston gauntlets, reactor furnace chest.
// ===========================================================================
function buildBastion(paint, mods) {
  const d = {
    hipY: 1.12, pelvis: 0.12, spine: 0.2, chest: 0.5, headH: 0.26, shoulderY: 0.36, shoulderW: 0.52, hipW: 0.22,
    arm: 0.44, fore: 0.46, thigh: 0.46, shin: 0.48, footH: 0.18, footLen: 0.32, heel: 0.14, neckX: 0.06,
  };
  const b = new RobotBuilder(d, paint);
  skeleton(b, { armR: 0.075, legR: 0.09, waistW: 0.42, waistD: 0.3, bulk: 1.5, hand: 1.55, footW: 0.22 });

  // ---- hips
  b.add('hips', G.box(0.4, 0.14, 0.56, 0.04), 'armor2', 0, 0.09, 0);
  b.add('hips', G.plate([[0.1, 0.14], [0.27, 0.1], [0.25, -0.14], [0.1, -0.24], [0.04, -0.08]], 0.24, 0.02), 'armor', 0, 0, 0);
  b.add('hips', G.box(0.02, 0.14, 0.12, 0.005), 'trim', 0.262, -0.02, 0, 0, 0, -6);
  b.add('hips', G.plate([[-0.1, 0.14], [-0.26, 0.1], [-0.28, -0.1], [-0.12, -0.2]], 0.34, 0.02), 'armor2', 0, 0, 0);
  b.bolts('hips', 'chrome', 0.21, 0.13, -0.22, 0.21, 0.13, 0.22, 7, 0.016);
  b.both((S, s) => {
    b.add('hips', G.plate([[-0.16, 0.12], [0.16, 0.12], [0.2, -0.1], [0.08, -0.3], [-0.12, -0.26], [-0.2, -0.08]], 0.05, 0.015), 'armor', 0, 0, s * 0.33, s * -8, 0, 0);
    b.add('hips', G.box(0.2, 0.03, 0.014, 0.005), 'glow', 0, 0.0, s * 0.362, s * -8, 0, 0);
    b.bolts('hips', 'chrome', -0.1, -0.14, s * 0.372, 0.08, -0.16, s * 0.372, 3, 0.014);
  });

  // ---- chest: barrel furnace
  b.add('chest', G.plate([[-0.26, -0.05], [0.24, -0.07], [0.4, 0.12], [0.41, 0.34], [0.26, 0.52], [-0.22, 0.54], [-0.34, 0.3]], 0.74, 0.05), 'armor', 0, 0, 0);
  // furnace grille
  b.add('chest', G.box(0.04, 0.24, 0.3, 0.01), 'dark', 0.4, 0.22, 0, 0, 0, -3);
  b.add('chest', G.box(0.02, 0.2, 0.26, 0.006), 'glow', 0.395, 0.22, 0, 0, 0, -3);
  for (let i = 0; i < 5; i++) b.add('chest', G.box(0.03, 0.24, 0.022, 0.006), 'armor2', 0.418, 0.22, (i - 2) * 0.062, 0, 0, -3);
  b.add('chest', G.box(0.035, 0.03, 0.34, 0.008), 'trim', 0.42, 0.355, 0, 0, 0, -3);
  b.add('chest', G.box(0.035, 0.03, 0.34, 0.008), 'trim', 0.415, 0.085, 0, 0, 0, -3);
  b.add('chest', G.plate([[0.26, 0.5], [0.42, 0.36], [0.44, 0.42], [0.3, 0.56]], 0.5, 0.015), 'armor2', 0, 0, 0);
  b.both((S, s) => {
    b.add('chest', G.plate([[0.0, 0.0], [0.2, 0.0], [0.22, 0.3], [0.0, 0.34]], 0.04, 0.012), 'armor2', 0.22, 0.08, s * 0.3, 0, s * 62, 0);
    b.bolts('chest', 'chrome', 0.36, 0.1, s * 0.22, 0.37, 0.38, s * 0.22, 5, 0.016);
    b.vent('chest', 0.1, 0.02, s * 0.375, 0.2, 0.12, 4, 'z');
    // shoulder yokes
    b.add('chest', G.cyl(0.16, 0.16, 0.14, 20), 'armor2', 0, d.shoulderY, s * 0.38, 90, 0, 0);
    b.add('chest', G.torus(0.16, 0.02, 20), 'trim', 0, d.shoulderY, s * 0.45, 0, 0, 0);
    // exhaust stacks
    b.add('chest', G.cyl(0.055, 0.065, 0.5, 14), 'frame', -0.3, 0.52, s * 0.2, 0, 0, 14);
    b.add('chest', G.cyl(0.07, 0.07, 0.05, 14), 'trim', -0.345, 0.7, s * 0.2, 0, 0, 14);
    b.add('chest', G.cyl(0.075, 0.062, 0.06, 14), 'armor2', -0.36, 0.76, s * 0.2, 0, 0, 14);
    b.add('chest', G.cyl(0.045, 0.045, 0.01, 14), 'glowDim', -0.368, 0.792, s * 0.2, 0, 0, 14);
    b.add('chest', G.box(0.1, 0.3, 0.04, 0.012), 'armor2', -0.3, 0.3, s * 0.3);
  });
  b.add('chest', G.box(0.2, 0.44, 0.52, 0.05), 'armor2', -0.3, 0.26, 0);
  b.vent('chest', -0.405, 0.3, 0, 0.36, 0.2, 6, 'x', 0);
  b.add('chest', G.cyl(0.2, 0.26, 0.1, 10), 'armor2', 0.04, 0.545, 0);
  b.add('chest', G.plate([[-0.1, 0.52], [0.2, 0.5], [0.26, 0.6], [0.2, 0.7], [-0.06, 0.66]], 0.5, 0.03), 'armor', 0, 0, 0);

  // ---- head: sunk armoured sensor block
  b.add('head', G.cyl(0.09, 0.1, 0.08, 12), 'frame', 0, 0.02, 0);
  b.add('head', G.plate([[-0.14, 0.03], [0.1, 0.03], [0.2, 0.1], [0.19, 0.18], [0.08, 0.27], [-0.1, 0.27], [-0.16, 0.16]], 0.24, 0.03), 'armor', 0, 0, 0);
  b.add('head', G.box(0.03, 0.045, 0.2, 0.01), 'visor', 0.186, 0.15, 0, 0, 0, -6);
  b.add('head', G.plate([[0.08, 0.02], [0.22, 0.08], [0.2, 0.125], [0.1, 0.09]], 0.2, 0.01), 'armor2', 0, 0, 0);
  b.add('head', G.box(0.2, 0.03, 0.06, 0.01), 'trim', 0.0, 0.275, 0);
  b.both((S, s) => {
    b.add('head', G.box(0.16, 0.14, 0.03, 0.01), 'armor2', -0.02, 0.16, s * 0.125);
    b.add('head', G.cyl(0.012, 0.012, 0.16, 6), 'chrome', -0.1, 0.34, s * 0.1, 0, 0, 10);
  });

  // ---- arms: colossal gauntlets
  b.both((S, s) => {
    const arm = 'arm' + S, fore = 'fore' + S, hand = 'hand' + S;
    b.add(arm, G.plate([[-0.22, -0.08], [0.22, -0.08], [0.25, 0.1], [0.14, 0.24], [-0.14, 0.24], [-0.26, 0.08]], 0.3, 0.045), 'armor', 0, 0, s * 0.06, s * -8, 0, 0);
    b.add(arm, G.plate([[-0.2, -0.2], [0.2, -0.2], [0.23, -0.07], [-0.24, -0.07]], 0.27, 0.025), 'armor2', 0, 0, s * 0.08, s * -12, 0, 0);
    b.add(arm, G.box(0.3, 0.03, 0.02, 0.006), 'glow', 0, -0.065, s * 0.225, s * -9, 0, 0);
    b.bolts(arm, 'chrome', -0.14, 0.14, s * 0.2, 0.14, 0.14, s * 0.2, 4, 0.02);
    b.add(arm, G.plate([[0.14, 0.24], [0.2, 0.34], [-0.02, 0.36], [-0.14, 0.24]], 0.1, 0.02), 'trim', 0, 0, s * 0.1);
    b.add(arm, G.box(0.2, 0.22, 0.2, 0.04), 'armor', 0, -0.3, 0);
    // gauntlet drum
    b.add(fore, G.cyl(0.15, 0.17, 0.34, 10), 'armor', 0.0, -0.26, 0);
    b.add(fore, G.cyl(0.175, 0.175, 0.05, 20), 'trim', 0, -0.1, 0);
    b.add(fore, G.cyl(0.19, 0.19, 0.07, 20), 'armor2', 0, -0.43, 0);
    b.add(fore, G.cyl(0.176, 0.176, 0.03, 20), 'glow', 0, -0.385, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.piston(fore, [Math.cos(a) * 0.15, -0.04, Math.sin(a) * 0.15], [Math.cos(a) * 0.18, -0.4, Math.sin(a) * 0.18], 0.02);
    }
    b.add(fore, G.plate([[-0.1, 0.1], [-0.22, 0.0], [-0.2, -0.2], [-0.12, -0.1]], 0.12, 0.02), 'armor2', 0, 0, 0);
    // fist plating
    b.add(hand, G.box(0.11, 0.14, 0.21, 0.03), 'armor', 0.075, -0.12, 0);
    for (let i = 0; i < 4; i++) b.add(hand, G.cone(0.024, 0.05, 8), 'trim', 0.14, -0.16, (i - 1.5) * 0.046, 0, 0, -90);
  });

  // ---- legs
  b.both((S, s) => {
    const th = 'thigh' + S, sh = 'shin' + S, ft = 'foot' + S;
    b.add(th, G.plate([[-0.13, -0.03], [0.14, -0.05], [0.19, -0.22], [0.15, -0.42], [-0.1, -0.42], [-0.16, -0.22]], 0.25, 0.04), 'armor', 0, 0, 0);
    b.add(th, G.box(0.02, 0.22, 0.14, 0.006), 'armor2', 0.172, -0.22, 0);
    b.add(th, G.box(0.014, 0.2, 0.03, 0.005), 'glow', 0.0, -0.22, s * 0.128);
    b.add(sh, G.plate([[0.05, 0.14], [0.2, 0.06], [0.21, -0.1], [0.1, -0.13], [0.04, 0.0]], 0.2, 0.03), 'armor', 0, 0, 0);
    b.bolts(sh, 'chrome', 0.2, 0.0, -0.06, 0.2, 0.0, 0.06, 3, 0.018);
    b.add(sh, G.plate([[-0.11, -0.08], [0.11, -0.1], [0.17, -0.28], [0.17, -0.47], [-0.14, -0.47], [-0.17, -0.28]], 0.25, 0.04), 'armor', 0, 0, 0);
    b.add(sh, G.box(0.02, 0.16, 0.16, 0.006), 'armor2', 0.172, -0.36, 0);
    b.vent(sh, -0.165, -0.34, 0, 0.16, 0.14, 4, 'x', 0);
    b.add(sh, G.torus(0.14, 0.02, 16), 'trim', 0, -0.47, 0, 90, 0, 0);
    b.add(ft, G.plate([[-0.16, -0.18], [0.36, -0.18], [0.37, -0.1], [0.2, 0.02], [0.08, 0.06], [-0.1, 0.05], [-0.18, -0.08]], 0.27, 0.035), 'armor', 0, 0, 0);
    b.add(ft, G.plate([[0.2, -0.18], [0.38, -0.18], [0.385, -0.095], [0.25, -0.03]], 0.285, 0.015), 'trim', 0, 0, 0);
    b.add(ft, G.box(0.1, 0.05, 0.3, 0.012), 'armor2', -0.12, -0.14, 0);
  });

  anchors(b, { coreX: 0.42, coreY: 0.22, backX: 0.36, backY: 0.76, tipY: -0.22, tipX: 0.1 });
  return b.build();
}

// ===========================================================================
// WRAITH — phase assassin. Twin mono-blades, lean silhouette, cyclopean eye.
// ===========================================================================
function buildWraith(paint, mods) {
  const d = {
    hipY: 1.2, pelvis: 0.08, spine: 0.22, chest: 0.36, headH: 0.3, shoulderY: 0.26, shoulderW: 0.3, hipW: 0.13,
    arm: 0.4, fore: 0.4, thigh: 0.52, shin: 0.56, footH: 0.12, footLen: 0.24, heel: 0.06,
  };
  const b = new RobotBuilder(d, paint);
  skeleton(b, { armR: 0.038, legR: 0.048, waistW: 0.2, waistD: 0.15, bulk: 0.8, hand: 0.85, footW: 0.11 });

  b.add('hips', G.plate([[0.05, 0.09], [0.14, 0.05], [0.1, -0.1], [0.03, -0.17], [0.0, -0.05]], 0.12, 0.012), 'armor', 0, 0, 0);
  b.add('hips', G.plate([[-0.05, 0.09], [-0.13, 0.05], [-0.13, -0.06], [-0.05, -0.12]], 0.18, 0.012), 'armor2', 0, 0, 0);
  b.add('hips', G.box(0.25, 0.035, 0.3, 0.012), 'armor2', 0, 0.085, 0);
  b.add('hips', G.box(0.26, 0.01, 0.31, 0.004), 'glow', 0, 0.085, 0);
  b.both((S, s) => {
    // long trailing hip blades
    b.add('hips', G.plate([[-0.06, 0.08], [0.08, 0.08], [0.06, -0.12], [-0.12, -0.42], [-0.1, -0.1]], 0.02, 0.007), 'armor', 0, 0, s * 0.19, s * -12, 0, 0);
    b.add('hips', G.box(0.01, 0.26, 0.008, 0.003), 'glow', -0.045, -0.16, s * 0.215, s * -12, 0, -22);
  });

  // chest: narrow wedge
  b.add('chest', G.plate([[-0.11, -0.03], [0.1, -0.05], [0.2, 0.1], [0.215, 0.24], [0.1, 0.36], [-0.12, 0.37], [-0.17, 0.2]], 0.36, 0.03), 'armor', 0, 0, 0);
  b.add('chest', G.plate([[0.1, -0.06], [0.215, 0.09], [0.235, 0.24], [0.12, 0.37], [0.09, 0.34], [0.18, 0.23], [0.17, 0.1], [0.07, -0.03]], 0.08, 0.008), 'armor2', 0, 0, 0);
  // diamond core
  b.add('chest', G.cyl(0.045, 0.045, 0.025, 4), 'glow', 0.222, 0.19, 0, 0, 0, 90);
  b.add('chest', G.torus(0.058, 0.008, 4), 'chrome', 0.228, 0.19, 0, 45, 90, 0);
  b.both((S, s) => {
    b.add('chest', G.plate([[0.0, 0.0], [0.13, 0.03], [0.15, 0.16], [0.02, 0.15]], 0.02, 0.007), 'armor2', 0.1, 0.16, s * 0.188, 0, s * 76, -10);
    b.add('chest', G.box(0.01, 0.012, 0.13, 0.003), 'glow', 0.205, 0.285, s * 0.1, s * -30, s * 14, 0);
    b.add('chest', G.box(0.01, 0.01, 0.1, 0.003), 'glow', 0.2, 0.09, s * 0.09, s * 28, s * 14, 0);
    b.add('chest', G.cyl(0.07, 0.07, 0.05, 14), 'armor2', 0, d.shoulderY, s * 0.21, 90, 0, 0);
    // dorsal vanes
    b.add('chest', G.plate([[0.0, 0.0], [-0.3, 0.18], [-0.46, 0.14], [-0.26, 0.06], [-0.02, -0.08]], 0.016, 0.006), 'armor', -0.12, 0.26, s * 0.09, s * -22, s * -14, 0);
    b.add('chest', G.plate([[0.0, 0.0], [-0.24, 0.02], [-0.38, -0.06], [-0.2, -0.07], [0.0, -0.08]], 0.016, 0.006), 'armor2', -0.13, 0.16, s * 0.1, s * -12, s * -18, 0);
    b.add('chest', G.box(0.22, 0.008, 0.008, 0.003), 'glow', -0.3, 0.36, s * 0.16, s * -22, s * -14, -24);
  });
  b.add('chest', G.box(0.1, 0.26, 0.24, 0.03), 'armor2', -0.14, 0.2, 0);
  b.add('chest', G.cyl(0.08, 0.1, 0.05, 8), 'armor2', 0, 0.37, 0);
  // hood cowl
  b.add('chest', G.plate([[-0.16, 0.34], [-0.06, 0.36], [-0.1, 0.56], [-0.2, 0.5]], 0.26, 0.015), 'armor2', 0, 0, 0);

  // head: cyclops hood
  b.add('head', G.cyl(0.04, 0.05, 0.09, 10), 'frame', 0, 0.035, 0);
  b.add('head', G.plate([[-0.11, 0.07], [0.05, 0.06], [0.14, 0.12], [0.15, 0.19], [0.06, 0.3], [-0.08, 0.31], [-0.14, 0.2]], 0.17, 0.03), 'armor2', 0, 0, 0);
  b.add('head', G.plate([[-0.14, 0.2], [-0.08, 0.31], [0.08, 0.3], [0.17, 0.2], [0.19, 0.21], [0.1, 0.34], [-0.1, 0.36], [-0.2, 0.24], [-0.3, 0.2]], 0.19, 0.015), 'armor', 0, 0, 0);
  b.add('head', G.cyl(0.032, 0.032, 0.03, 16), 'visor', 0.142, 0.175, 0, 0, 0, 90);
  b.add('head', G.torus(0.04, 0.008, 16), 'chrome', 0.15, 0.175, 0, 0, 90, 0);
  b.both((S, s) => {
    b.add('head', G.box(0.012, 0.01, 0.06, 0.003), 'glow', 0.13, 0.115, s * 0.05, 0, s * 20, 0);
    b.add('head', G.plate([[-0.02, 0.0], [-0.3, 0.1], [-0.36, 0.06], [-0.04, -0.06]], 0.012, 0.004), 'armor', -0.06, 0.28, s * 0.085, s * -10, s * -12, 0);
  });

  // arms
  b.both((S, s) => {
    const arm = 'arm' + S, fore = 'fore' + S, hand = 'hand' + S;
    b.add(arm, G.plate([[-0.1, -0.05], [0.1, -0.05], [0.12, 0.05], [0.03, 0.14], [-0.18, 0.2], [-0.1, 0.04]], 0.12, 0.02), 'armor', 0, 0, s * 0.04, s * -14, 0, 0);
    b.add(arm, G.box(0.14, 0.01, 0.01, 0.003), 'glow', -0.01, -0.04, s * 0.105, s * -14, 0, 0);
    b.add(arm, G.box(0.085, 0.2, 0.085, 0.02), 'armor2', 0, -0.22, 0);
    b.add(fore, G.plate([[-0.05, -0.04], [0.06, -0.03], [0.075, -0.2], [0.055, -0.38], [-0.045, -0.38], [-0.06, -0.2]], 0.09, 0.018), 'armor', 0, 0, 0);
    b.add(fore, G.box(0.01, 0.2, 0.02, 0.003), 'glow', 0.072, -0.2, 0, 0, 0, 3);
    // mono-blade: mounted on the outer forearm, extends past the fist
    b.add(fore, G.box(0.05, 0.16, 0.03, 0.008), 'armor2', -0.03, -0.22, s * 0.06);
    b.add(fore, G.plate([[-0.065, -0.1], [-0.02, -0.1], [0.005, -0.62], [-0.02, -0.98], [-0.075, -0.56]], 0.012, 0.005), 'chrome', 0, 0, s * 0.066);
    b.add(fore, G.plate([[-0.074, -0.12], [-0.062, -0.12], [-0.022, -0.96], [-0.082, -0.56]], 0.016, 0.004), 'glow', 0, 0, s * 0.066);
    b.add(fore, G.plate([[-0.06, 0.02], [-0.02, 0.0], [-0.02, -0.1], [-0.065, -0.1], [-0.1, 0.1]], 0.014, 0.005), 'armor', 0, 0, s * 0.066);
    b.add(hand, G.box(0.04, 0.07, 0.1, 0.012), 'armor2', 0.052, -0.07, 0);
  });

  // legs: long, with reverse spurs
  b.both((S, s) => {
    const th = 'thigh' + S, sh = 'shin' + S, ft = 'foot' + S;
    b.add(th, G.plate([[-0.06, -0.03], [0.07, -0.04], [0.105, -0.22], [0.07, -0.48], [-0.04, -0.46], [-0.075, -0.24]], 0.115, 0.022), 'armor', 0, 0, 0);
    b.add(th, G.box(0.01, 0.24, 0.014, 0.003), 'glow', 0.03, -0.26, s * 0.06);
    b.add(th, G.plate([[-0.06, -0.1], [-0.16, -0.26], [-0.07, -0.34]], 0.014, 0.005), 'armor2', 0, 0, s * 0.03);
    b.add(sh, G.plate([[0.03, 0.12], [0.1, 0.05], [0.1, -0.07], [0.05, -0.09], [0.02, 0.0]], 0.085, 0.015), 'armor', 0, 0, 0);
    b.add(sh, G.plate([[-0.045, -0.08], [0.055, -0.1], [0.08, -0.3], [0.06, -0.54], [-0.05, -0.54], [-0.085, -0.3]], 0.105, 0.022), 'armor', 0, 0, 0);
    b.add(sh, G.plate([[-0.07, -0.14], [-0.22, -0.02], [-0.12, -0.3], [-0.085, -0.34]], 0.014, 0.005), 'armor2', 0, 0, 0);
    b.add(sh, G.box(0.008, 0.14, 0.008, 0.003), 'glow', -0.135, -0.16, 0.009, 0, 0, -38);
    b.add(sh, G.box(0.01, 0.26, 0.014, 0.003), 'glow', 0.074, -0.3, 0, 0, 0, 2);
    b.add(ft, G.plate([[-0.07, -0.11], [0.26, -0.11], [0.3, -0.085], [0.12, 0.0], [0.04, 0.035], [-0.05, 0.03], [-0.085, -0.05]], 0.115, 0.02), 'armor', 0, 0, 0);
    b.add(ft, G.plate([[-0.06, -0.02], [-0.2, 0.08], [-0.08, -0.08]], 0.016, 0.005), 'armor2', 0, 0, 0);
    b.add(ft, G.box(0.1, 0.008, 0.118, 0.003), 'glow', 0.14, -0.06, 0, 0, 0, -22);
  });

  anchors(b, { coreX: 0.23, coreY: 0.19, backX: 0.2, tipY: -0.98, tipX: -0.02 });
  const rig = b.build();
  // weapon anchors along the forearm blades
  rig.anchors.tipR.removeFromParent();
  rig.anchors.tipL.removeFromParent();
  rig.anchor('tipR', 'foreR', -0.03, -0.98, 0.066);
  rig.anchor('baseR', 'foreR', -0.05, -0.2, 0.066);
  rig.anchor('tipL', 'foreL', -0.03, -0.98, -0.066);
  rig.anchor('baseL', 'foreL', -0.05, -0.2, -0.066);
  return rig;
}

// ===========================================================================
// TEMPEST — storm caster. Hover skirt, tesla pylons, orbiting halo array.
// ===========================================================================
function buildTempest(paint, mods) {
  const d = {
    hipY: 1.2, pelvis: 0.1, spine: 0.22, chest: 0.4, headH: 0.34, shoulderY: 0.3, shoulderW: 0.34, hipW: 0.14,
    arm: 0.4, fore: 0.4, thigh: 0.52, shin: 0.54, footH: 0.14, footLen: 0.22, heel: 0.08,
  };
  const b = new RobotBuilder(d, paint);
  skeleton(b, { armR: 0.042, legR: 0.052, waistW: 0.22, waistD: 0.16, bulk: 0.9, hand: 0.95, footW: 0.12 });

  // ---- hips: layered robe skirt of floating plates
  b.add('hips', G.cyl(0.2, 0.24, 0.08, 12), 'armor2', 0, 0.09, 0);
  b.add('hips', G.torus(0.225, 0.012, 24), 'glow', 0, 0.06, 0, 90, 0, 0);
  const skirtN = 8;
  for (let i = 0; i < skirtN; i++) {
    const a = (i / skirtN) * Math.PI * 2 + Math.PI / skirtN;
    const front = Math.cos(a);
    if (front > 0.8) continue; // open at the front so the legs read clearly
    const len = 0.5 + (1 - front) * 0.1;
    const x = Math.cos(a) * 0.25, z = Math.sin(a) * 0.25;
    const ry = (-a * 180) / Math.PI;
    b.add('hips', G.plate([[-0.085, 0.0], [0.085, 0.0], [0.11, -len * 0.6], [0.0, -len], [-0.11, -len * 0.6]], 0.02, 0.008), 'armor', x, 0.05, z, 0, ry + 90, 0, 1, 1, 1);
    b.add('hips', G.box(0.008, len * 0.5, 0.012, 0.003), 'glow', Math.cos(a) * 0.262, 0.05 - len * 0.42, Math.sin(a) * 0.262, 0, ry, 0);
    b.add('hips', G.plate([[-0.05, 0.02], [0.05, 0.02], [0.065, -0.2], [0.0, -0.28], [-0.065, -0.2]], 0.024, 0.008), 'trim', Math.cos(a) * 0.262, 0.07, Math.sin(a) * 0.262, 0, ry + 90, 0);
  }
  b.add('hips', G.plate([[0.06, 0.1], [0.17, 0.06], [0.14, -0.1], [0.05, -0.18], [0.02, -0.05]], 0.13, 0.012), 'armor', 0, 0, 0);

  // ---- chest
  b.add('chest', G.plate([[-0.13, -0.03], [0.11, -0.05], [0.22, 0.1], [0.235, 0.27], [0.12, 0.4], [-0.13, 0.4], [-0.19, 0.22]], 0.42, 0.035), 'armor', 0, 0, 0);
  b.add('chest', G.sphere(0.075, 20, 14), 'glow', 0.2, 0.2, 0);
  b.add('chest', G.torus(0.085, 0.014, 24), 'trim', 0.215, 0.2, 0, 0, 90, 0);
  b.add('chest', G.torus(0.105, 0.006, 24), 'chrome', 0.21, 0.2, 0, 0, 90, 0);
  b.add('chest', G.plate([[0.12, 0.4], [0.24, 0.27], [0.27, 0.3], [0.16, 0.44]], 0.3, 0.012), 'trim', 0, 0, 0);
  b.both((S, s) => {
    b.add('chest', G.plate([[0.0, 0.0], [0.14, 0.02], [0.17, 0.18], [0.02, 0.2]], 0.025, 0.008), 'armor2', 0.11, 0.17, s * 0.218, 0, s * 76, -8);
    b.add('chest', G.box(0.01, 0.014, 0.1, 0.003), 'glow', 0.225, 0.07, s * 0.1, s * 30, s * 12, 0);
    b.add('chest', G.cyl(0.08, 0.08, 0.06, 16), 'armor2', 0, d.shoulderY, s * 0.24, 90, 0, 0);
    // tesla pylons rising from the shoulders/back
    b.add('chest', G.cyl(0.022, 0.035, 0.34, 10), 'frame', -0.16, 0.56, s * 0.2, s * -12, 0, 18);
    for (let i = 0; i < 4; i++)
      b.add('chest', G.torus(0.04 - i * 0.004, 0.008, 14), 'trim', -0.135 - i * 0.021, 0.48 + i * 0.065, s * (0.185 + i * 0.012), 90 + s * -12, 0, 18);
    b.add('chest', G.sphere(0.035, 12, 10), 'glow', -0.215, 0.73, s * 0.236);
    b.add('chest', G.box(0.012, 0.22, 0.012, 0.004), 'glowDim', -0.2, 0.2, s * 0.13);
  });
  b.add('chest', G.box(0.12, 0.3, 0.3, 0.04), 'armor2', -0.17, 0.22, 0);
  b.add('chest', G.cyl(0.1, 0.13, 0.06, 10), 'armor2', 0, 0.41, 0);
  // high collar
  b.add('chest', G.plate([[-0.18, 0.38], [-0.06, 0.4], [-0.08, 0.62], [-0.22, 0.56]], 0.3, 0.015), 'armor', 0, 0, 0);
  b.add('chest', G.box(0.012, 0.16, 0.24, 0.004), 'glow', -0.062, 0.5, 0, 0, 0, 5);

  // ---- head: crowned sensor mask
  b.add('head', G.cyl(0.045, 0.055, 0.1, 10), 'frame', 0, 0.04, 0);
  b.add('head', G.plate([[-0.1, 0.07], [0.05, 0.06], [0.13, 0.11], [0.15, 0.2], [0.09, 0.3], [-0.06, 0.32], [-0.12, 0.22]], 0.18, 0.03), 'armor', 0, 0, 0);
  b.add('head', G.plate([[0.05, 0.05], [0.14, 0.1], [0.165, 0.2], [0.1, 0.31], [0.07, 0.29], [0.12, 0.2], [0.1, 0.12]], 0.07, 0.008), 'trim', 0, 0, 0);
  b.both((S, s) => {
    b.add('head', G.box(0.02, 0.022, 0.05, 0.005), 'visor', 0.138, 0.19, s * 0.055, 0, s * 14, s * 0);
    b.add('head', G.box(0.02, 0.012, 0.035, 0.004), 'visor', 0.132, 0.15, s * 0.06, 0, s * 14, 0);
    // crown prongs
    b.add('head', G.plate([[0.0, 0.0], [0.05, 0.02], [-0.04, 0.3], [-0.06, 0.04]], 0.014, 0.005), 'trim', 0.02, 0.28, s * 0.07, s * -14, 0, 0);
    b.add('head', G.plate([[0.0, 0.0], [0.04, 0.0], [-0.12, 0.2], [-0.08, 0.02]], 0.014, 0.005), 'armor2', -0.06, 0.28, s * 0.085, s * -24, 0, 0);
  });
  b.add('head', G.plate([[0.0, 0.0], [0.05, 0.03], [0.0, 0.4], [-0.05, 0.04]], 0.016, 0.006), 'trim', 0.03, 0.29, 0);
  b.add('head', G.sphere(0.02, 10, 8), 'glow', 0.03, 0.7, 0);

  // ---- arms
  b.both((S, s) => {
    const arm = 'arm' + S, fore = 'fore' + S, hand = 'hand' + S;
    b.add(arm, G.sphere(0.13, 18, 12), 'armor', 0, 0.02, s * 0.03, 0, 0, 0, 1, 0.9, 1);
    b.add(arm, G.torus(0.132, 0.012, 24), 'trim', 0, 0.02, s * 0.03, 90, 0, 0);
    b.add(arm, G.plate([[-0.1, -0.02], [0.1, -0.02], [0.07, -0.2], [0.0, -0.28], [-0.07, -0.2]], 0.02, 0.008), 'armor2', 0, 0, s * 0.11, s * -10, 0, 0);
    b.add(arm, G.box(0.01, 0.16, 0.01, 0.003), 'glow', 0, -0.12, s * 0.125, s * -10, 0, 0);
    b.add(arm, G.box(0.09, 0.2, 0.09, 0.025), 'armor', 0, -0.23, 0);
    // flared bracers with conductor rings
    b.add(fore, G.cyl(0.055, 0.09, 0.3, 12), 'armor', 0, -0.2, 0);
    for (let i = 0; i < 3; i++) b.add(fore, G.torus(0.07 + i * 0.012, 0.009, 18), i === 1 ? 'glow' : 'trim', 0, -0.16 - i * 0.07, 0, 90, 0, 0);
    b.add(fore, G.plate([[-0.05, 0.03], [-0.13, -0.04], [-0.1, -0.2], [-0.06, -0.1]], 0.05, 0.01), 'armor2', 0, 0, 0);
    // emitter palm
    b.add(hand, G.cyl(0.035, 0.035, 0.02, 14), 'glow', 0.05, -0.075, 0, 0, 0, 90);
    b.add(hand, G.box(0.03, 0.08, 0.1, 0.01), 'armor2', -0.045, -0.07, 0);
  });

  // ---- legs: slender with hover soles
  b.both((S, s) => {
    const th = 'thigh' + S, sh = 'shin' + S, ft = 'foot' + S;
    b.add(th, G.plate([[-0.065, -0.03], [0.075, -0.04], [0.11, -0.22], [0.08, -0.47], [-0.045, -0.46], [-0.08, -0.24]], 0.125, 0.025), 'armor', 0, 0, 0);
    b.add(th, G.box(0.01, 0.2, 0.014, 0.003), 'glow', 0.03, -0.24, s * 0.065);
    b.add(sh, G.plate([[0.03, 0.1], [0.11, 0.04], [0.11, -0.07], [0.05, -0.09], [0.02, 0.0]], 0.095, 0.015), 'trim', 0, 0, 0);
    b.add(sh, G.plate([[-0.05, -0.08], [0.06, -0.1], [0.085, -0.28], [0.1, -0.52], [-0.09, -0.52], [-0.1, -0.28]], 0.12, 0.025), 'armor', 0, 0, 0);
    b.add(sh, G.torus(0.09, 0.012, 18), 'glow', 0, -0.52, 0, 90, 0, 0);
    b.add(sh, G.torus(0.075, 0.008, 18), 'trim', 0, -0.4, 0, 90, 0, 0);
    b.add(ft, G.plate([[-0.09, -0.13], [0.23, -0.13], [0.25, -0.09], [0.1, 0.0], [0.04, 0.035], [-0.05, 0.03], [-0.1, -0.05]], 0.125, 0.02), 'armor', 0, 0, 0);
    b.add(ft, G.box(0.24, 0.012, 0.09, 0.004), 'glow', 0.07, -0.137, 0);
    b.add(ft, G.plate([[0.12, -0.13], [0.24, -0.13], [0.255, -0.085], [0.16, -0.03]], 0.135, 0.01), 'trim', 0, 0, 0);
  });

  anchors(b, { coreX: 0.26, coreY: 0.2, backX: 0.3, tipY: -0.14, tipX: 0.1 });
  const rig = b.build();

  // dynamic halo array floating behind the shoulders
  const halo = new THREE.Group();
  const ringGeo = new THREE.TorusGeometry(0.46, 0.014, 8, 48);
  const ring = new THREE.Mesh(ringGeo, b.M.trim);
  halo.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.008, 8, 48), b.M.glow);
  halo.add(ring2);
  const shards = new THREE.Group();
  const shardGeo = G.plate([[-0.03, 0.0], [0.03, 0.0], [0.012, 0.2], [0.0, 0.26], [-0.012, 0.2]], 0.016, 0.005);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const m = new THREE.Mesh(shardGeo, i % 2 ? b.M.armor : b.M.trim);
    m.position.set(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0);
    m.rotation.z = a - Math.PI / 2;
    m.castShadow = true;
    shards.add(m);
    const g = new THREE.Mesh(G.sphere(0.022, 8, 6), b.M.glow);
    g.position.set(Math.cos(a) * 0.47, Math.sin(a) * 0.47, 0);
    shards.add(g);
  }
  halo.add(shards);
  halo.position.set(-0.3, 0.32, 0);
  halo.rotation.y = Math.PI / 2;
  rig.bones.chest.add(halo);
  rig.dynamic.halo = halo;
  rig.dynamic.haloShards = shards;
  rig.dynamic.haloRing = ring2;
  return rig;
}

// ===========================================================================
// Mod attachments — visible hardware for every equipped mod
// ===========================================================================
function attachMods(b, visuals) {
  const d = b.d;
  const k = d.shoulderW / 0.37; // rough chassis scale
  for (const v of visuals) {
    switch (v) {
      // ---------------- arms
      case 'knuckles':
        b.both((S, s) => {
          b.add('hand' + S, G.box(0.05 * k, 0.1 * k, 0.15 * k, 0.012), 'trim', 0.085 * k, -0.11 * k, 0);
          for (let i = 0; i < 3; i++) b.add('hand' + S, G.cone(0.02 * k, 0.07 * k, 6), 'chrome', 0.13 * k, -0.11 * k, (i - 1) * 0.045 * k, 0, 0, -90);
        });
        break;
      case 'coils':
        b.both((S, s) => {
          for (let i = 0; i < 3; i++) b.add('fore' + S, G.torus(0.105 * k, 0.012, 20), i === 1 ? 'chrome' : 'glow', 0, -0.1 - i * 0.07, 0, 90, 0, 0);
        });
        break;
      case 'fins':
        b.both((S, s) => {
          b.add('fore' + S, G.plate([[-0.06, -0.02], [-0.26, 0.12], [-0.2, -0.1], [-0.07, -0.3]], 0.016, 0.005), 'trim', 0, 0, 0);
          b.add('fore' + S, G.box(0.14, 0.008, 0.02, 0.003), 'glow', -0.15, 0.02, 0, 0, 0, -34);
        });
        break;
      case 'cannon':
        b.both((S, s) => {
          b.add('fore' + S, G.cyl(0.035 * k, 0.035 * k, 0.3, 12), 'frame', 0.09 * k, -0.24, s * 0.02);
          b.add('fore' + S, G.cyl(0.045 * k, 0.045 * k, 0.04, 12), 'chrome', 0.09 * k, -0.4, s * 0.02);
          b.add('fore' + S, G.cyl(0.025 * k, 0.025 * k, 0.01, 12), 'glow', 0.09 * k, -0.422, s * 0.02);
        });
        break;
      case 'claws':
        b.both((S, s) => {
          for (let i = 0; i < 3; i++)
            b.add('hand' + S, G.plate([[0, 0], [0.04, -0.02], [0.03, -0.2], [-0.01, -0.1]], 0.012, 0.004), 'chrome', 0.07 * k, -0.1 * k, (i - 1) * 0.04 * k, 0, 0, 20);
        });
        break;
      // ---------------- legs
      case 'thrusters':
        b.both((S, s) => {
          b.add('shin' + S, G.cyl(0.04 * k, 0.06 * k, 0.2, 12), 'frame', -0.14 * k, -0.26, 0, 0, 0, 12);
          b.add('shin' + S, G.cyl(0.062 * k, 0.062 * k, 0.03, 12), 'chrome', -0.16 * k, -0.36, 0, 0, 0, 12);
          b.add('shin' + S, G.cyl(0.045 * k, 0.045 * k, 0.01, 12), 'glow', -0.164 * k, -0.378, 0, 0, 0, 12);
        });
        break;
      case 'spurs':
        b.both((S, s) => {
          b.add('foot' + S, G.plate([[-0.06, 0.0], [-0.3, 0.14], [-0.1, -0.08]], 0.016, 0.005), 'chrome', 0, 0, 0);
          b.add('shin' + S, G.plate([[0.1, 0.06], [0.26, 0.14], [0.14, -0.04]], 0.016, 0.005), 'trim', 0, 0, 0);
        });
        break;
      case 'stabilizers':
        b.both((S, s) => {
          b.add('shin' + S, G.plate([[0, -0.1], [0.02, -0.4], [-0.02, -0.46], [-0.03, -0.1]], 0.2 * k, 0.006), 'armor2', 0.0, 0, s * 0.02);
          b.add('shin' + S, G.box(0.01, 0.2, 0.012, 0.003), 'glow', 0, -0.28, s * (0.1 * k + 0.02));
        });
        break;
      case 'legcoils':
        b.both((S, s) => {
          for (let i = 0; i < 3; i++) b.add('thigh' + S, G.torus(0.125 * k, 0.01, 20), i === 1 ? 'glow' : 'chrome', 0.01, -0.14 - i * 0.1, 0, 90, 0, 0);
        });
        break;
      // ---------------- armor
      case 'pauldrons':
        b.both((S, s) => {
          b.add('arm' + S, G.plate([[-0.2, 0.06], [0.2, 0.06], [0.24, 0.16], [0.0, 0.26], [-0.24, 0.16]], 0.2 * k, 0.02), 'trim', 0, 0.03, s * 0.08 * k, s * -14, 0, 0, k, k, 1);
        });
        break;
      case 'spikes':
        b.both((S, s) => {
          for (let i = 0; i < 3; i++)
            b.add('arm' + S, G.cone(0.03 * k, 0.16 * k, 8), 'chrome', (i - 1) * 0.09 * k, 0.2 * k, s * 0.1 * k, s * 20, 0, (1 - i) * 14);
        });
        break;
      case 'hexplate':
        for (let r = 0; r < 2; r++)
          for (let c = -1; c <= 1; c++)
            b.add('chest', G.cyl(0.045, 0.045, 0.02, 6), 'trim', (b.rig.anchors.core?.position.x ?? 0.26) - 0.02 - r * 0.012, 0.34 + r * 0.075 - (b.d.chest < 0.4 ? 0.04 : 0), (c + (r % 2) * 0.5) * 0.085, 0, 0, 90);
        break;
      case 'bulwark':
        b.both((S, s) => {
          b.add('chest', G.plate([[-0.1, 0.0], [0.14, 0.0], [0.1, 0.22], [-0.12, 0.26]], 0.04, 0.012), 'trim', 0.02, d.chest - 0.02, s * (d.shoulderW * 0.62), s * 30, 0, 0);
        });
        break;
      case 'mantle':
        b.both((S, s) => {
          b.add('chest', G.plate([[0, 0], [-0.2, -0.1], [-0.3, -0.6], [-0.14, -0.86], [-0.06, -0.5]], 0.02, 0.006), 'armor2', -0.14, d.chest - 0.04, s * 0.12, s * -8, s * -10, 0);
          b.add('chest', G.box(0.008, 0.5, 0.008, 0.003), 'glow', -0.36, d.chest - 0.5, s * 0.2, s * -8, 0, -14);
        });
        break;
      // ---------------- core
      case 'ring':
        b.add('chest', G.torus(0.12 * k, 0.012, 28), 'glow', (b.coreX ?? 0.27) + 0.015, b.coreY ?? 0.2, 0, 0, 90, 0);
        break;
      case 'twin':
        b.both((S, s) => {
          b.add('chest', G.sphere(0.03 * k, 12, 8), 'glow', (b.coreX ?? 0.27) - 0.03, (b.coreY ?? 0.2) + 0.1, s * 0.11 * k);
        });
        break;
      case 'dorsal':
        for (let i = 0; i < 4; i++)
          b.add('chest', G.plate([[0, 0], [-0.2, 0.1], [-0.16, 0.0], [0, -0.06]], 0.02, 0.006), i % 2 ? 'glow' : 'trim', -(b.backX ?? 0.3), 0.06 + i * 0.1, 0);
        break;
      case 'cells':
        b.both((S, s) => {
          for (let i = 0; i < 3; i++) {
            b.add('chest', G.cyl(0.03, 0.03, 0.14, 10), 'chrome', -(b.backX ?? 0.3) - 0.02, 0.1 + i * 0.09, s * 0.1, 90, 0, 0);
            b.add('chest', G.cyl(0.032, 0.032, 0.03, 10), 'glow', -(b.backX ?? 0.3) - 0.02, 0.1 + i * 0.09, s * 0.1, 90, 0, 0);
          }
        });
        break;
      // ---------------- chip
      case 'antenna':
        b.add('head', G.cyl(0.006, 0.01, 0.4, 6), 'chrome', -0.1, d.headH + 0.12, 0.06, 0, 0, 16);
        b.add('head', G.sphere(0.018, 8, 6), 'glow', -0.155, d.headH + 0.31, 0.06);
        break;
      case 'crest':
        b.add('head', G.plate([[0.12, 0.0], [0.0, 0.14], [-0.3, 0.22], [-0.16, 0.06], [-0.06, 0.0]], 0.02, 0.006), 'glow', 0, d.headH - 0.02, 0);
        break;
      case 'horns':
        b.both((S, s) => {
          b.add('head', G.plate([[0.0, 0.0], [0.08, 0.02], [0.16, 0.22], [0.04, 0.1]], 0.02, 0.006), 'trim', 0.02, d.headH - 0.08, s * 0.09, s * -20, 0, 0);
        });
        break;
      case 'optics':
        b.both((S, s) => {
          b.add('head', G.cyl(0.022, 0.022, 0.05, 10), 'chrome', 0.1, d.headH - 0.07, s * 0.09, 0, 0, 90);
          b.add('head', G.cyl(0.016, 0.016, 0.01, 10), 'glow', 0.128, d.headH - 0.07, s * 0.09, 0, 0, 90);
        });
        break;
      default:
        break;
    }
  }
}

// ===========================================================================
const BUILDERS = { vanguard: buildVanguard, bastion: buildBastion, wraith: buildWraith, tempest: buildTempest };

/**
 * Build a robot rig.
 * @param {string} chassisId
 * @param {object} paint  {primary, secondary, glow, trim}
 * @param {string[]} visuals mod visual keys
 */
export function buildRobot(chassisId, paint, visuals = []) {
  // mod attachments have to be merged into the same buckets, so we hook the builder
  const origBuild = RobotBuilder.prototype.build;
  let rig;
  RobotBuilder.prototype.build = function () {
    const a = this.rig.anchors;
    this.coreX = a.core ? a.core.position.x : 0.27;
    this.coreY = a.core ? a.core.position.y : 0.2;
    this.backX = a.back ? -a.back.position.x : 0.3;
    attachMods(this, visuals);
    return origBuild.call(this);
  };
  try {
    rig = BUILDERS[chassisId](paint, visuals);
  } finally {
    RobotBuilder.prototype.build = origBuild;
  }
  rig.chassisId = chassisId;
  return rig;
}

export function disposeRig(rig) {
  const geos = new Set();
  rig.root.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
  });
  for (const g of geos) g.dispose();
  for (const g of Object.values(rig.ghostGeo || {})) g.dispose();
  const M = rig.materials;
  for (const k of Object.keys(M)) if (M[k] && M[k].isMaterial) M[k].dispose();
}
