import { P, clip } from './anim.js';
import { rand, randSign, TAU } from '../engine/utils.js';

// ===========================================================================
// helpers
// ===========================================================================
/** add deltas to a pose spec */
function D(spec, delta) {
  const out = { ...spec };
  for (const k of Object.keys(delta)) {
    const d = delta[k];
    const v = out[k];
    if (k === 'x' || k === 'y' || k === 'yaw') out[k] = (v || 0) + d;
    else {
      const a = typeof v === 'number' ? [v, 0, 0] : v ? [...v] : [0, 0, 0];
      const b = typeof d === 'number' ? [d, 0, 0] : d;
      out[k] = [a[0] + (b[0] || 0), (a[1] || 0) + (b[1] || 0), (a[2] || 0) + (b[2] || 0)];
    }
  }
  return out;
}

const LV = {
  1: { stun: 0.3, block: 0.17, kbx: 2.4, guard: 9, pause: 0.05 },
  2: { stun: 0.4, block: 0.22, kbx: 3.8, guard: 15, pause: 0.075 },
  3: { stun: 0.52, block: 0.28, kbx: 6.5, guard: 26, pause: 0.12 },
};
/** hit window helper */
function H(t0, t1, x0, x1, y0, y1, dmg, level = 1, o = {}) {
  return { t0, t1, x0, x1, y0, y1, dmg, level, fx: 'hit', kby: 0, ...LV[level], ...o };
}

const v3 = (x, y, z = 0) => ({ x, y, z });

// ===========================================================================
// animation shared by all chassis, derived from each robot's stance
// ===========================================================================
function commonClips(st, d, o = {}) {
  const A = {};
  const lieY = -(d.hipY - (o.lie ?? 0.3));
  const breathe = D(st, { spine: -2, chest: -3, head: 2, armL: [4], armR: [3], foreL: -5, foreR: -4, thighL: [3], shinL: -6, thighR: [-2], shinR: -5 });
  A.idle = clip([[0, st], [0.95, breathe], [1.9, st]], { loop: true });
  A.walkF = clip([
    [0, st],
    [0.14, D(st, { hips: [-3], thighL: [16], shinL: -22, thighR: [-8], shinR: 8, armL: [-4], armR: [5] })],
    [0.28, D(st, { thighL: [10], shinL: 2, thighR: [-12], shinR: -4 })],
    [0.42, D(st, { hips: [-2], thighL: [-6], shinL: -4, thighR: [14], shinR: -26, armL: [4], armR: [-4] })],
    [0.56, st],
  ], { loop: true });
  A.walkB = clip([
    [0, st],
    [0.15, D(st, { hips: [3], thighR: [-14], shinR: -18, thighL: [-4], armL: [4] })],
    [0.3, D(st, { thighR: [-12], shinR: 4, thighL: [10] })],
    [0.45, D(st, { hips: [2], thighL: [-14], shinL: -14, thighR: [-4], shinR: -6 })],
    [0.6, st],
  ], { loop: true });
  const dashF = P(st, { hips: [-24, 0, 10], spine: -6, chest: -6, head: 24, armL: [-30, 15], foreL: 50, armR: [-50, 15], foreR: 40, thighL: [78, 5], shinL: -70, thighR: [-22, 5], shinR: -40 });
  A.dashF = clip([[0, st], [0.06, dashF, 'out'], [0.2, D(dashF, { hips: [4] })], [0.32, st]]);
  const dashB = P(st, { hips: [10, 0, 0], spine: 4, chest: 6, head: -6, armL: [60, 10], foreL: 80, armR: [40, 12], foreR: 90, thighL: [40, 5], shinL: -14, thighR: [-2, 5], shinR: -62 });
  A.dashB = clip([[0, st], [0.06, dashB, 'out'], [0.2, dashB], [0.3, st]]);
  const tuck = P(st, { hips: [-8], spine: -4, chest: -6, head: 10, armL: [70, 20], foreL: 70, armR: [40, 25], foreR: 80, thighL: [75, 6], shinL: -110, thighR: [35, 6], shinR: -95, footL: 20, footR: 30 });
  const fall = P(st, { hips: [4], spine: 2, chest: 2, head: 6, armL: [100, 35], foreL: 40, armR: [70, 40], foreR: 50, thighL: [38, 6], shinL: -40, thighR: [-6, 6], shinR: -50, footL: 25, footR: 35 });
  A.jump = clip([[0, D(st, { hips: [-10], thighL: [20], shinL: -30, thighR: [20], shinR: -30 })], [0.1, tuck, 'out'], [0.5, tuck]], { ground: 0 });
  A.fall = clip([[0, fall], [1, fall]], { ground: 0, loop: true });
  const landP = P(st, { hips: [-16], spine: -6, chest: -6, head: 14, thighL: [60, 8], shinL: -80, thighR: [14, 8], shinR: -78, armL: [30, 20], foreL: 60, armR: [10, 22], foreR: 70 });
  A.land = clip([[0, landP], [0.16, st]]);
  const block = o.block ?? P(st, { hips: [2, 0, 0], spine: 2, chest: [-2, 0, 10], head: 10, armL: [72, -4, 20], foreL: 112, armR: [60, 0, 25], foreR: 122, thighL: [30, 6], shinL: -40, thighR: [-18, 8], shinR: -34 });
  A.block = clip([[0, block], [1, D(block, { chest: [-1] })], [2, block]], { loop: true });
  A.blockHit = clip([[0, D(block, { hips: [9], spine: 4, chest: [6], x: -0.08, armL: [-10], armR: [-10] })], [0.22, block, 'out']]);
  A.parry = clip([[0, D(block, { hips: [-6], chest: [-8, 0, -20], armL: [20, 30], foreL: -60, x: 0.06 })], [0.3, block]]);
  A.hitHigh = clip([
    [0, P(st, { hips: [9, 0, -10], spine: 8, chest: [14, 0, -16], head: 26, armL: [-5, 25], foreL: 50, armR: [-25, 25], foreR: 60, x: -0.08 })],
    [0.5, D(st, { hips: [3], chest: [4] }), 'out'],
  ]);
  A.hitLow = clip([
    [0, P(st, { hips: [-22, 0, 8], spine: -14, chest: [-12, 0, 10], head: -14, armL: [40, 10], foreL: 70, armR: [30, 10], foreR: 80, thighL: [34, 6], shinL: -50, thighR: [-6, 8], shinR: -46, x: -0.05 })],
    [0.5, D(st, { hips: [-5], chest: [-4] }), 'out'],
  ]);
  A.hitHeavy = clip([
    [0, P(st, { hips: [16, 0, -25], spine: 10, chest: [18, 0, -30], head: 30, armL: [-30, 40], foreL: 30, armR: [-50, 40], foreR: 40, thighL: [10, 6], shinL: -30, thighR: [-30, 8], shinR: -20, x: -0.16 })],
    [0.6, D(st, { hips: [5], chest: [6] }), 'out'],
  ]);
  const airUp = { hips: [55, 0, 0], spine: 10, chest: 14, head: 20, armL: [120, 30], foreL: 20, armR: [100, 35], foreR: 30, thighL: [50, 10], shinL: -30, thighR: [20, 10], shinR: -50, footL: 30, footR: 30 };
  const airFlat = { hips: [98, 0, 0], spine: 6, chest: 8, head: 10, armL: [150, 30], foreL: 20, armR: [130, 35], foreR: 25, thighL: [40, 10], shinL: -20, thighR: [10, 10], shinR: -35, footL: 30, footR: 30 };
  A.launched = clip([[0, airUp], [0.45, airFlat, 'inOut'], [1.2, D(airFlat, { hips: [14] })]], { ground: 0 });
  const down = { hips: [90, 0, 0], spine: 0, chest: 2, head: 8, armL: [160, 25], foreL: 15, armR: [140, 35], foreR: 25, thighL: [8, 8], shinL: -8, thighR: [-2, 10], shinR: -18, footL: 40, footR: 50, y: lieY };
  A.down = clip([[0, D(down, { y: 0.22, hips: [-8], thighL: [20], thighR: [14] })], [0.16, down, 'in'], [0.3, D(down, { y: 0.05 })], [0.42, down]], { ground: 0 });
  const kneel = P(st, { hips: [-30], spine: -10, chest: -10, head: 20, armL: [40, 10], foreL: 40, armR: [20, 10], foreR: 50, thighL: [85, 8], shinL: -120, thighR: [30, 8], shinR: -125 });
  A.getup = clip([[0, kneel], [0.2, kneel], [0.46, st]]);
  const dz1 = P(st, { hips: [-8, 7, 0], spine: -8, chest: [-14, 6, 0], head: [-20, 10, 0], armL: [10, 8], foreL: 20, armR: [4, 8], foreR: 24, x: -0.04 });
  const dz2 = P(st, { hips: [-6, -7, 0], spine: -6, chest: [-12, -6, 0], head: [-16, -10, 0], armL: [4, 8], foreL: 26, armR: [10, 8], foreR: 18, x: 0.04 });
  A.stunned = clip([[0, dz1], [0.55, dz2], [1.1, dz1]], { loop: true });
  const off = P(st, { hips: [-14], spine: -12, chest: -16, head: -30, armL: [6, 6], foreL: 8, armR: [2, 6], foreR: 10, thighL: [12, 5], shinL: -14, thighR: [-4, 6], shinR: -14 });
  A.intro = clip([[0, off], [0.5, off], [0.9, D(st, { hips: [6], chest: [8], head: -10 }), 'out3'], [1.3, st]]);
  A.defeat = clip([[0, off], [1, off]], { loop: true });
  return A;
}

/** simple strike clip: stance → wind → hit → hold → stance */
function strike(st, wind, hit, tw, th, hold, end, o = {}) {
  const keys = [[0, o.from || st], [tw, wind, o.windEase || 'out'], [th, hit, o.hitEase || 'in3'], [th + hold, o.follow || hit, 'out']];
  if (o.extra) keys.push(...o.extra);
  keys.push([end, o.to || st, 'inOut']);
  return clip(keys, { ground: o.ground ?? 1 });
}

// ===========================================================================
// VANGUARD
// ===========================================================================
function vanguard(d) {
  const st = { hips: [-4, 0, -6], spine: -4, chest: [-4, 0, -8], head: 8, armL: [48, 12, 0], foreL: 96, armR: [12, 14, 0], foreR: 118, thighL: [26, 6, 0], shinL: -34, thighR: [-14, 8, 0], shinR: -30 };
  const A = commonClips(st, d);
  const lunge = { thighL: [58, 6], shinL: -66, thighR: [-36, 6], shinR: -14 };
  const wide = { thighL: [40, 8], shinL: -48, thighR: [-24, 8], shinR: -34 };

  A.light1 = strike(st,
    P(st, { chest: [-4, 0, -16], armL: [30, 10], foreL: 128 }),
    P(st, { hips: [-8, 0, -12], chest: [-8, 0, -22], armL: [86, 4], foreL: 4, armR: [5, 14], foreR: 126, thighL: [36, 6], shinL: -40, x: 0.1 }),
    0.04, 0.09, 0.07, 0.3);
  A.light2 = strike(st,
    P(st, { hips: [-4, 0, -18], chest: [-4, 0, -26], armR: [-10, 16], foreR: 130, armL: [60, 10], foreL: 70 }),
    P(st, { hips: [-10, 0, 22], chest: [-10, 0, 32], armR: [88, 2], foreR: 3, armL: [10, 16], foreL: 128, thighL: [40, 6], shinL: -46, thighR: [-22, 8], shinR: -22, x: 0.18 }),
    0.05, 0.11, 0.08, 0.34);
  A.light3 = strike(st,
    P(st, { hips: [-2, 0, -25], chest: [0, 0, -36], armR: [152, 30], foreR: 70, armL: [60, 10], foreL: 60 }),
    P(st, { hips: [-14, 0, 30], chest: [-14, 0, 40], head: 16, armR: [30, -10, 0], foreR: 8, armL: [-20, 20], foreL: 60, ...lunge, x: 0.25 }),
    0.07, 0.15, 0.1, 0.46);
  A.heavy = strike(st,
    P(st, { hips: [8, 0, -10], spine: 6, chest: [8, 0, -20], head: -4, armR: [172, 10], foreR: 25, armL: [150, 10], foreL: 30, thighL: [20, 6], shinL: -20, thighR: [-20, 8], shinR: -40 }),
    P(st, { hips: [-30, 0, 10], spine: -10, chest: [-12, 0, 15], head: 30, armR: [46, 0], foreR: 2, armL: [34, 0], foreL: 20, thighL: [66, 6], shinL: -74, thighR: [-36, 8], shinR: -14, x: 0.35 }),
    0.14, 0.26, 0.14, 0.64);
  A.launcher = strike(st,
    P(st, { hips: [-26, 0, -20], chest: [-10, 0, -25], head: 20, armR: [-40, 14], foreR: 20, armL: [40, 10], foreL: 90, thighL: [58, 8], shinL: -84, thighR: [20, 8], shinR: -90 }),
    P(st, { hips: [6, 0, 25], spine: 4, chest: [8, 0, 30], head: -10, armR: [160, 6], foreR: 6, armL: [-30, 16], foreL: 50, thighL: [14, 5], shinL: -10, thighR: [-12, 5], shinR: -14, footL: 24, footR: 30 }),
    0.08, 0.16, 0.14, 0.52);
  A.airL = clip([
    [0, { hips: [0, 0, -20], chest: [0, 0, -30], armR: [150, 20], foreR: 50, armL: [60, 20], foreL: 60, thighL: [60, 5], shinL: -90, thighR: [10, 5], shinR: -70, footL: 20, footR: 20 }],
    [0.1, { hips: [-14, 0, 20], chest: [-10, 0, 30], head: 12, armR: [50, 0], foreR: 5, armL: [-30, 20], foreL: 70, thighL: [50, 5], shinL: -80, thighR: [-10, 5], shinR: -60, footL: 20, footR: 20 }, 'in3'],
    [0.4, { hips: [-8, 0, 20], chest: [-10, 0, 30], armR: [30, 0], foreR: 10, armL: [-30, 20], foreL: 70, thighL: [40, 5], shinL: -60, thighR: [-10, 5], shinR: -50, footL: 20, footR: 20 }],
  ], { ground: 0 });
  A.airH = clip([
    [0, { hips: [-10], chest: [-4, 0, -20], armR: [170, 10], foreR: 30, armL: [100, 20], foreL: 40, thighL: [70, 5], shinL: -100, thighR: [30, 5], shinR: -90, footL: 20, footR: 20 }],
    [0.16, { hips: [-44], spine: -6, chest: [-8, 0, 20], head: 34, armR: [74, 0], foreR: 0, armL: [-20, 20], foreL: 50, thighL: [-4, 5], shinL: -30, thighR: [-34, 5], shinR: -56, footL: 40, footR: 40 }, 'in3'],
    [1.0, { hips: [-44], spine: -6, chest: [-8, 0, 20], head: 34, armR: [74, 0], foreR: 0, armL: [-20, 20], foreL: 50, thighL: [-4, 5], shinL: -30, thighR: [-34, 5], shinR: -56, footL: 40, footR: 40 }],
  ], { ground: 0 });
  A.spN = strike(st,
    P(st, { hips: [4, 0, -40], chest: [4, 0, -50], armR: [-55, 20], foreR: 95, armL: [80, 5], foreL: 10, thighL: [40, 6], shinL: -48, thighR: [-24, 8], shinR: -30 }),
    P(st, { hips: [-12, 0, 35], chest: [-10, 0, 45], head: 16, armR: [92, 0], foreR: 0, armL: [-30, 20], foreL: 80, ...lunge, x: 0.3 }),
    0.18, 0.3, 0.2, 0.7);
  const rush = P(st, { hips: [-42, 0, 20], spine: -8, chest: [-6, 0, 25], head: 44, armR: [142, 5], foreR: 0, armL: [-50, 15], foreL: 30, thighL: [80, 5], shinL: -80, thighR: [-20, 5], shinR: -30 });
  A.spF = clip([
    [0, st],
    [0.13, P(st, { hips: [-20, 0, -30], chest: [-6, 0, -40], head: 24, armR: [-30, 20], foreR: 60, armL: [70, 5], foreL: 20, thighL: [60, 8], shinL: -84, thighR: [10, 8], shinR: -80 }), 'out'],
    [0.18, rush, 'in'],
    [0.36, rush],
    [0.44, P(st, { hips: [-20, 0, 60], chest: [-8, 0, 50], head: 10, armR: [-40, 40], foreR: 5, armL: [30, 10], foreL: 100, ...lunge }), 'out'],
    [0.6, P(st, { hips: [-20, 0, 60], chest: [-8, 0, 50], head: 10, armR: [-40, 40], foreR: 5, armL: [30, 10], foreL: 100, ...lunge })],
    [0.78, st],
  ]);
  const kneelStab = P(st, { hips: [-34, 0, 0], chest: -10, head: 30, armR: [44, 0], foreR: 0, armL: [60, 20], foreL: 60, thighL: [78, 8], shinL: -100, thighR: [10, 8], shinR: -95 });
  A.spD = clip([
    [0, st],
    [0.18, P(st, { hips: [6], chest: [6, 0, -10], head: -8, armR: [172, 0], foreR: 10, armL: [150, 10], foreL: 20, thighL: [16, 5], shinL: -14, thighR: [-10, 5], shinR: -14 }), 'out'],
    [0.32, kneelStab, 'in3'],
    [0.62, kneelStab],
    [0.9, st],
  ]);
  const cleave = P(st, { hips: [-30, 0, 10], spine: -10, chest: [-12, 0, 15], head: 30, armR: [46, 0], foreR: 2, armL: [34, 0], foreL: 20, thighL: [66, 6], shinL: -74, thighR: [-36, 8], shinR: -14, x: 0.35 });
  const sky = P(st, { hips: [4, 0, -6], chest: [8, 0, -10], head: -24, armR: [178, 0], foreR: 0, armL: [24, 24], foreL: 100, thighL: [14, 8], shinL: -12, thighR: [-10, 8], shinR: -14 });
  A.overdrive = clip([
    [0, st],
    [0.3, P(st, { hips: [4], chest: [10], head: -12, armR: [-20, 50], foreR: 20, armL: [-20, 50], foreL: 20, ...wide }), 'out'],
    [0.7, sky, 'inOut3'],
    [1.12, D(sky, { hips: [6], chest: [4] })],
    [1.25, cleave, 'in3'],
    [1.75, cleave],
    [2.1, st],
  ]);
  A.victory = clip([[0, st], [0.5, P(st, { hips: [2, 0, -30], chest: [6, 0, -30], head: [-6, 0, 30], armR: [176, 4], foreR: 4, armL: [20, 20], foreL: 110, thighL: [16, 8], shinL: -14, thighR: [-10, 8], shinR: -14 }), 'out3'], [3, P(st, { hips: [2, 0, -30], chest: [6, 0, -30], head: [-6, 0, 30], armR: [176, 4], foreR: 4, armL: [20, 20], foreL: 110, thighL: [16, 8], shinL: -14, thighR: [-10, 8], shinR: -14 })]]);

  const tR = [{ which: 'R' }];
  const M = {};
  M.light1 = { name: 'Servo Jab', anim: A.light1, dur: 0.3, type: 'light', chain: 'light2', hits: [H(0.085, 0.16, 0.15, 1.3, 0.9, 1.9, 4, 1)], vel: [{ t0: 0, t1: 0.1, vx: 2.5 }], ai: [0, 1.5] };
  M.light2 = { name: 'Cross', anim: A.light2, dur: 0.34, type: 'light', chain: 'light3', hits: [H(0.1, 0.18, 0.15, 1.4, 0.9, 1.9, 5, 1)], vel: [{ t0: 0, t1: 0.12, vx: 3 }], ai: [0, 1.6] };
  M.light3 = { name: 'Arc Slash', anim: A.light3, dur: 0.46, type: 'light', blade: [0.03, 0.4], trails: [{ t0: 0.06, t1: 0.28, which: 'R' }], hits: [H(0.14, 0.23, 0.1, 1.95, 0.3, 2.4, 8, 2, { fx: 'slash' })], vel: [{ t0: 0.04, t1: 0.16, vx: 4 }], sfx: 'slash', ai: [0, 2.0] };
  M.heavy = {
    name: 'Skybreaker', anim: A.heavy, dur: 0.64, type: 'heavy', chargeAt: 0.14, blade: [0.02, 0.56], trails: [{ t0: 0.12, t1: 0.42, which: 'R' }],
    hits: [H(0.25, 0.35, 0.1, 2.15, 0.0, 2.9, 13, 3, { fx: 'slash', kbx: 7 })], vel: [{ t0: 0.16, t1: 0.28, vx: 5 }], sfx: 'slashHeavy', ai: [0.6, 2.2],
    events: [{ t: 0.27, do: (f, F) => { F.fx.slash(v3(f.x + f.facing * 0.5, 1.3), { color: f.color, radius: 2.1, a0: 1.9, a1: -1.0, facing: f.facing, dur: 0.24, thick: 0.4 }); } }],
  };
  M.launcher = {
    name: 'Rising Crescent', anim: A.launcher, dur: 0.52, type: 'launcher', blade: [0.02, 0.46], trails: [{ t0: 0.08, t1: 0.34, which: 'R' }],
    hits: [H(0.15, 0.25, 0.1, 1.7, 0.2, 3.0, 9, 2, { fx: 'slash', kby: 12.5, kbx: 1.6 })], vel: [{ t0: 0.06, t1: 0.16, vx: 3 }], sfx: 'slash', ai: [0, 1.7],
    events: [{ t: 0.15, do: (f, F) => { F.fx.slash(v3(f.x + f.facing * 0.5, 1.4), { color: f.color, radius: 1.9, a0: -1.7, a1: 1.5, facing: f.facing, dur: 0.24, thick: 0.36 }); } }],
  };
  M.airL = { name: 'Sky Cut', anim: A.airL, dur: 0.4, type: 'air', blade: [0, 0.36], trails: [{ t0: 0.04, t1: 0.26, which: 'R' }], hits: [H(0.09, 0.2, 0.0, 1.9, -0.9, 1.3, 7, 2, { fx: 'slash' })], sfx: 'slash' };
  M.airH = {
    name: 'Meteor Lance', anim: A.airH, dur: 1.0, type: 'air', dive: { t: 0.14, vx: 9, vy: -19 }, landRecover: 0.24, blade: [0, 1],
    hits: [H(0.14, 1.0, 0.0, 1.5, -1.3, 0.9, 12, 3, { fx: 'slash', knockdown: true, kbx: 5 })], sfx: 'slashHeavy',
    onLand: (f, F) => { F.fx.groundSlam(f.x + f.facing * 0.8, f.color, 0.6); F.shake(0.5); F.sfx('slam'); },
  };
  M.spN = {
    name: 'Arc Lance', anim: A.spN, dur: 0.7, type: 'special', cost: 25, blade: [0.05, 0.6], trails: [{ t0: 0.2, t1: 0.42, which: 'R' }],
    hits: [H(0.29, 0.36, 0.1, 1.9, 0.6, 1.9, 5, 2, { fx: 'slash' })], vel: [{ t0: 0.2, t1: 0.3, vx: 4 }], ai: [2.5, 9],
    events: [
      { t: 0.1, do: (f, F) => { F.fx.implode(f.anchor('tipR'), { color: f.color, count: 14 }); F.sfx('charge'); } },
      { t: 0.3, do: (f, F) => {
        F.sfx('wave');
        F.projectile(f, { kind: 'crescent', x: f.x + f.facing * 1.3, y: 1.25, vx: 14 * f.facing, w: 0.9, h: 1.7, dmg: 10, level: 2, kbx: 5.5, life: 1.0, color: f.color });
      } },
    ],
  };
  M.spF = {
    name: 'Vector Rush', anim: A.spF, dur: 0.78, type: 'special', cost: 30, blade: [0.05, 0.7], trails: [{ t0: 0.14, t1: 0.5, which: 'R' }], passThrough: [0.16, 0.4], invuln: [0.16, 0.36],
    hits: [H(0.17, 0.38, -0.4, 1.7, 0.2, 2.2, 14, 3, { fx: 'slash', kbx: 0.5, stun: 0.7, pause: 0.02, noPush: true })],
    vel: [{ t0: 0.17, t1: 0.36, vx: 27 }], ai: [1.5, 6],
    events: [
      { t: 0.02, do: (f, F) => { F.fx.implode(v3(f.x, 1.2), { color: f.color, count: 12 }); F.sfx('charge'); } },
      { t: 0.17, do: (f, F) => { f.rushX = f.x; F.sfx('dashHeavy'); F.R.kickRadial(0.035); F.fx.ring(v3(f.x, 1.2), { color: f.color, r0: 0.4, r1: 3, dur: 0.3, tiltY: 1.2 }); } },
      { t: 0.38, do: (f, F) => {
        const x0 = f.rushX ?? f.x, x1 = f.x;
        F.fx.beam(v3(Math.min(x0, x1) - 0.5, 1.25, 0.2), v3(Math.max(x0, x1) + 0.5, 1.25, 0.2), { color: f.color, width: 0.5, dur: 0.3 });
        F.fx.slash(v3((x0 + x1) / 2, 1.25), { color: 0xffffff, color2: f.color, radius: Math.abs(x1 - x0) * 0.5 + 0.8, a0: -0.35, a1: 0.35, rot: f.facing > 0 ? 0 : Math.PI, dur: 0.22, thick: 0.1, tilt: 1.2 });
      } },
    ],
    update: (f, F, t) => { if (t > 0.17 && t < 0.38) f.ghostEvery(0.035, 0.28); },
  };
  M.spD = {
    name: 'Aegis Pulse', anim: A.spD, dur: 0.9, type: 'special', cost: 35, blade: [0.05, 0.8], armor: [0, 0.45], trails: [{ t0: 0.16, t1: 0.36, which: 'R' }],
    hits: [H(0.32, 0.42, -2.7, 2.7, 0, 2.8, 13, 3, { kby: 9.5, kbx: 4, fx: 'shock' })], ai: [0, 2.3],
    events: [
      { t: 0.32, do: (f, F) => {
        const x = f.x + f.facing * 0.7;
        F.fx.dome(v3(f.x, 0), { color: f.color, r0: 0.4, r1: 3.1, dur: 0.5 });
        F.fx.groundSlam(x, f.color, 0.8);
        for (let i = 0; i < 6; i++) F.fx.lightning(v3(x, 0.1), v3(f.x + rand(-2.8, 2.8), rand(0.4, 2.6)), { color: f.color, dur: 0.22, width: 0.07 });
        F.shake(0.7); F.sfx('slam'); F.sfx('shock');
      } },
    ],
  };
  M.overdrive = {
    name: 'ZENITH BREAK', anim: A.overdrive, dur: 2.1, type: 'overdrive', blade: [0.2, 1.95], invuln: [0, 1.6], trails: [{ t0: 1.1, t1: 1.5, which: 'R' }],
    hits: [H(1.25, 1.42, -0.2, 10.5, 0, 7, 40, 3, { kby: 11, kbx: 7, guard: 70, chip: 0.25, fx: 'slash', pause: 0.2 })], ai: [0, 8],
    events: [
      { t: 0, do: (f, F) => F.cinematic(f, 1.15) },
      { t: 0.3, do: (f, F) => { F.fx.implode(v3(f.x, 1.3), { color: f.color, count: 40, radius: 3, life: 0.4 }); F.fx.ring(v3(f.x, 0.05), { color: f.color, r0: 3.5, r1: 0.3, dur: 0.4, ground: true, ease: (t) => t }); } },
      { t: 0.7, do: (f, F) => {
        const p = f.anchor('baseR');
        F.fx.beam(v3(p.x, p.y), v3(p.x - f.facing * 0.5, p.y + 11), { color: f.color, width: 1.1, dur: 0.62 });
        F.fx.pillar(p.x, { color: f.color, width: 0.7, height: 14, dur: 0.6, y: p.y });
        F.fx.flare(v3(p.x, p.y + 0.6), { color: f.color, size: 4, life: 0.3 });
        F.fx.light(p, f.color, 60, 0.6, 18);
        for (let i = 0; i < 5; i++) F.fx.lightning(v3(p.x, p.y + 1), v3(p.x + rand(-3, 3), rand(0, 5)), { color: f.color, dur: 0.3 });
        F.shake(0.5); F.sfx('beam'); F.R.kickAberration(0.012);
      } },
      { t: 1.25, do: (f, F) => {
        F.R.impactFrame(0.09, 0x030611, f.color);
        F.fx.slash(v3(f.x + f.facing * 0.6, 1.5), { color: 0xffffff, color2: f.color, radius: 6.5, a0: 1.75, a1: -0.7, facing: f.facing, dur: 0.4, thick: 0.5, intensity: 1.6 });
        for (let i = 0; i < 7; i++) {
          const x = f.x + f.facing * (1.3 + i * 1.45);
          F.after(i * 0.035, () => {
            if (Math.abs(x) > 10.5) return;
            F.fx.pillar(x, { color: f.color, width: 1.1 + i * 0.1, height: 8 + i, dur: 0.55 });
            F.fx.groundSlam(x, f.color, 0.7);
          });
        }
        F.shake(1.4); F.sfx('explosion'); F.sfx('slashHeavy'); F.R.kickAberration(0.03); F.R.kickRadial(0.06);
      } },
    ],
  };
  return { anims: A, moves: M, stance: st };
}

// ===========================================================================
// BASTION
// ===========================================================================
function bastion(d) {
  const st = { hips: [-10, 0, -6], spine: -6, chest: [-6, 0, -8], head: 14, armL: [50, 22, 10], foreL: 92, armR: [18, 26, 10], foreR: 112, thighL: [34, 12, 0], shinL: -44, thighR: [-20, 14, 0], shinR: -36 };
  const A = commonClips(st, d, { lie: 0.42 });
  const lunge = { thighL: [58, 10], shinL: -66, thighR: [-34, 10], shinR: -16 };
  const squat = { thighL: [70, 14], shinL: -100, thighR: [30, 14], shinR: -100 };

  A.light1 = strike(st,
    P(st, { hips: [-8, 0, -20], chest: [-4, 0, -30], armL: [40, 50], foreL: 100 }),
    P(st, { hips: [-12, 0, 20], chest: [-10, 0, 34], armL: [84, -6, 30], foreL: 46, armR: [0, 26], foreR: 120, thighL: [42, 12], shinL: -50, x: 0.12 }),
    0.07, 0.14, 0.09, 0.4);
  A.light2 = strike(st,
    P(st, { hips: [-16, 0, -24], chest: [-8, 0, -30], armR: [-30, 22], foreR: 100, armL: [60, 20], foreL: 80, thighL: [44, 12], shinL: -60 }),
    P(st, { hips: [-18, 0, 24], chest: [-12, 0, 34], head: 20, armR: [62, 6], foreR: 34, armL: [10, 26], foreL: 120, ...lunge, x: 0.2 }),
    0.08, 0.16, 0.09, 0.44);
  A.light3 = strike(st,
    P(st, { hips: [10, 0, 0], spine: 8, chest: 10, head: -10, armL: [172, 14], foreL: 34, armR: [172, 14], foreR: 34, thighL: [24, 12], shinL: -24, thighR: [-16, 14], shinR: -30 }),
    P(st, { hips: [-34, 0, 0], spine: -12, chest: -12, head: 40, armL: [52, 4], foreL: 10, armR: [52, 4], foreR: 10, ...squat, x: 0.28 }),
    0.12, 0.24, 0.12, 0.62);
  A.heavy = strike(st,
    P(st, { hips: [-4, 0, -40], chest: [2, 0, -50], head: [10, 0, 40], armR: [-46, 24], foreR: 112, armL: [70, 10], foreL: 30, thighL: [40, 12], shinL: -54, thighR: [-22, 14], shinR: -40 }),
    P(st, { hips: [-16, 0, 36], chest: [-10, 0, 46], head: 20, armR: [90, 0], foreR: 0, armL: [-20, 30], foreL: 100, ...lunge, x: 0.4 }),
    0.18, 0.34, 0.16, 0.78);
  A.launcher = strike(st,
    P(st, { hips: [-28, 0, -24], chest: [-10, 0, -28], head: 26, armR: [-30, 20], foreR: 70, armL: [50, 20], foreL: 90, ...squat }),
    P(st, { hips: [4, 0, 26], spine: 4, chest: [6, 0, 30], head: -8, armR: [144, 4], foreR: 62, armL: [-20, 28], foreL: 80, thighL: [16, 10], shinL: -12, thighR: [-12, 12], shinR: -14, footL: 20, footR: 26 }),
    0.1, 0.2, 0.14, 0.6);
  A.airL = clip([
    [0, { hips: [-6], chest: [0, 0, -30], armR: [140, 30], foreR: 100, armL: [60, 20], foreL: 60, thighL: [70, 10], shinL: -100, thighR: [30, 10], shinR: -90, footL: 20, footR: 20 }],
    [0.12, { hips: [-16], chest: [-10, 0, 30], head: 14, armR: [60, 0], foreR: 60, armL: [-20, 30], foreL: 80, thighL: [60, 10], shinL: -90, thighR: [10, 10], shinR: -70, footL: 20, footR: 20 }, 'in3'],
    [0.44, { hips: [-10], chest: [-8, 0, 30], armR: [40, 0], foreR: 60, armL: [-20, 30], foreL: 80, thighL: [50, 10], shinL: -70, thighR: [0, 10], shinR: -60, footL: 20, footR: 20 }],
  ], { ground: 0 });
  const drop = { hips: [-20], spine: -6, chest: -6, head: 30, armL: [30, 6], foreL: 6, armR: [30, 6], foreR: 6, thighL: [60, 14], shinL: -110, thighR: [50, 14], shinR: -110, footL: 30, footR: 30 };
  A.airH = clip([
    [0, { hips: [6], chest: 8, armL: [170, 16], foreL: 30, armR: [170, 16], foreR: 30, thighL: [70, 10], shinL: -100, thighR: [40, 10], shinR: -100, footL: 20, footR: 20 }],
    [0.2, drop, 'in3'],
    [1.0, drop],
  ], { ground: 0 });
  const slam = P(st, { hips: [-44, 0, 10], spine: -12, chest: [-10, 0, 14], head: 46, armR: [58, 0], foreR: 2, armL: [20, 30], foreL: 70, ...squat, x: 0.3 });
  A.spN = clip([
    [0, st],
    [0.22, P(st, { hips: [8, 0, -20], spine: 6, chest: [10, 0, -26], head: -10, armR: [176, 10], foreR: 20, armL: [70, 20], foreL: 60, thighL: [24, 12], shinL: -24, thighR: [-16, 14], shinR: -30 }), 'out'],
    [0.38, slam, 'in3'],
    [0.62, slam],
    [0.86, st],
  ]);
  const charge = P(st, { hips: [-34, 0, 40], spine: -8, chest: [-8, 0, 40], head: [34, 0, -40], armL: [26, 4, 20], foreL: 132, armR: [-30, 30], foreR: 90, thighL: [80, 10], shinL: -84, thighR: [-24, 12], shinR: -40 });
  A.spF = clip([
    [0, st],
    [0.18, P(st, { hips: [-20, 0, 20], chest: [-6, 0, 20], head: 20, armL: [30, 10], foreL: 130, armR: [-10, 30], foreR: 100, ...squat }), 'out'],
    [0.26, charge, 'in'],
    [0.42, D(charge, { thighL: [-60], shinL: 50, thighR: [70], shinR: -40 })],
    [0.58, charge],
    [0.72, P(st, { hips: [-10, 0, 50], chest: [0, 0, 50], armL: [70, 40, 10], foreL: 60, armR: [-30, 30], foreR: 80, ...lunge }), 'out'],
    [0.96, st],
  ]);
  const pull = P(st, { hips: [4, 0, 0], spine: 4, chest: 6, head: 2, armL: [82, 30], foreL: 14, armR: [78, 30], foreR: 14, thighL: [40, 14], shinL: -56, thighR: [-26, 14], shinR: -44 });
  const clap = P(st, { hips: [-18, 0, 0], spine: -6, chest: -8, head: 22, armL: [86, -14, 30], foreL: 20, armR: [86, -14, 30], foreR: 20, ...lunge, x: 0.15 });
  A.spD = clip([[0, st], [0.2, pull, 'out'], [0.62, D(pull, { hips: [6], chest: [4] })], [0.72, clap, 'in3'], [0.9, clap], [1.1, st]]);
  const roar = P(st, { hips: [6, 0, 0], spine: 6, chest: 12, head: -16, armL: [10, 60], foreL: 100, armR: [10, 60], foreR: 100, thighL: [44, 16], shinL: -60, thighR: [-30, 16], shinR: -48 });
  const pound = P(st, { hips: [-10], chest: -6, head: 16, armL: [70, -10, 30], foreL: 70, armR: [70, -10, 30], foreR: 70, thighL: [44, 16], shinL: -60, thighR: [-30, 16], shinR: -48 });
  const up = { hips: [10], spine: 8, chest: 12, head: -10, armL: [178, 14], foreL: 20, armR: [178, 14], foreR: 20, thighL: [50, 12], shinL: -90, thighR: [10, 12], shinR: -80, footL: 30, footR: 30 };
  const crash = P(st, { hips: [-46, 0, 0], spine: -12, chest: -10, head: 50, armL: [58, 6], foreL: 0, armR: [58, 6], foreR: 0, ...squat });
  A.overdrive = clip([
    [0, st], [0.25, roar, 'out'], [0.45, pound, 'in3'], [0.55, roar, 'out'], [0.72, pound, 'in3'],
    [0.86, P(st, { hips: [-30], ...squat, armL: [-30, 20], foreL: 40, armR: [-30, 20], foreR: 40 }), 'out'],
    [1.02, up, 'out'], [1.34, up], [1.45, crash, 'in3'], [1.95, crash], [2.3, st],
  ]);
  A.victory = clip([[0, st], [0.3, pound, 'in3'], [0.5, roar, 'out'], [0.7, pound, 'in3'], [1.0, roar, 'out'], [3, roar]]);

  const steam = (f, F, anchor = 'elbowR') => {
    const p = f.anchor(anchor);
    F.fx.smoke(p, { count: 5, color: 0xd8d8e0, color2: 0x7a7a84, size: 0.3, speed: 2.2, vx: -f.facing * 3, alpha: 0.45, life: 0.6 });
  };
  const M = {};
  M.light1 = { name: 'Rivet Hook', anim: A.light1, dur: 0.4, type: 'light', chain: 'light2', trails: [{ t0: 0.08, t1: 0.22, which: 'L' }], hits: [H(0.13, 0.22, 0.15, 1.5, 0.9, 2.1, 7, 1, { pause: 0.065 })], vel: [{ t0: 0.04, t1: 0.14, vx: 2.5 }], ai: [0, 1.6] };
  M.light2 = { name: 'Boiler Blow', anim: A.light2, dur: 0.44, type: 'light', chain: 'light3', trails: [{ t0: 0.08, t1: 0.24, which: 'R' }], hits: [H(0.15, 0.24, 0.15, 1.6, 0.5, 1.8, 8, 2, { anim: 'hitLow' })], vel: [{ t0: 0.04, t1: 0.16, vx: 3 }], ai: [0, 1.7] };
  M.light3 = {
    name: 'Drop Forge', anim: A.light3, dur: 0.62, type: 'light', trails: [{ t0: 0.14, t1: 0.34, which: 'R' }, { t0: 0.14, t1: 0.34, which: 'L' }],
    hits: [H(0.23, 0.33, 0.1, 1.8, 0, 2.6, 12, 3, { knockdown: true, kbx: 4 })], vel: [{ t0: 0.1, t1: 0.24, vx: 3.5 }], sfx: 'whooshHeavy', ai: [0, 1.8],
    events: [{ t: 0.26, do: (f, F) => { F.fx.groundSlam(f.x + f.facing * 1.2, f.color, 0.55); F.shake(0.45); F.sfx('slam'); } }],
  };
  M.heavy = {
    name: 'Piston Driver', anim: A.heavy, dur: 0.78, type: 'heavy', chargeAt: 0.18, armor: [0.1, 0.4], trails: [{ t0: 0.24, t1: 0.46, which: 'R' }],
    hits: [H(0.33, 0.43, 0.2, 2.0, 0.7, 2.2, 17, 3, { kbx: 10, kby: 3.5, pause: 0.15 })], vel: [{ t0: 0.24, t1: 0.36, vx: 7 }], sfx: 'whooshHeavy', ai: [0.5, 2.1],
    events: [
      { t: 0.1, do: (f, F) => steam(f, F) },
      { t: 0.33, do: (f, F) => {
        steam(f, F); steam(f, F);
        const p = f.anchor('handR');
        F.fx.ring(p, { color: f.color, r0: 0.2, r1: 1.8, dur: 0.25, tiltY: 1.3 * f.facing, width: 0.14 });
        F.fx.ring(v3(p.x - f.facing * 0.5, p.y), { color: 0xffffff, r0: 0.2, r1: 1.2, dur: 0.3, tiltY: 1.3 * f.facing, width: 0.07 });
        F.sfx('piston');
      } },
    ],
  };
  M.launcher = {
    name: 'Crane Uppercut', anim: A.launcher, dur: 0.6, type: 'launcher', trails: [{ t0: 0.1, t1: 0.36, which: 'R' }],
    hits: [H(0.19, 0.3, 0.1, 1.5, 0.2, 3.0, 11, 3, { kby: 13.5, kbx: 1.5 })], vel: [{ t0: 0.08, t1: 0.2, vx: 3 }], sfx: 'whooshHeavy', ai: [0, 1.5],
    events: [{ t: 0.19, do: (f, F) => steam(f, F) }],
  };
  M.airL = { name: 'Anvil Elbow', anim: A.airL, dur: 0.44, type: 'air', trails: [{ t0: 0.04, t1: 0.26, which: 'R' }], hits: [H(0.11, 0.24, 0.0, 1.4, -0.8, 1.3, 9, 2)] };
  M.airH = {
    name: 'Meteor Press', anim: A.airH, dur: 1.0, type: 'air', dive: { t: 0.2, vx: 2, vy: -24 }, landRecover: 0.34,
    hits: [H(0.2, 1.0, -0.6, 1.0, -1.2, 0.8, 12, 3, { knockdown: true })], sfx: 'whooshHeavy',
    onLand: (f, F) => {
      F.fx.groundSlam(f.x, f.color, 1); F.shake(0.9); F.sfx('slam');
      F.areaHit(f, { x0: f.x - 2.2, x1: f.x + 2.2, y0: 0, y1: 1.0 }, H(0, 0, 0, 0, 0, 0, 8, 2, { kby: 8, fx: 'shock' }));
    },
  };
  M.spN = {
    name: 'Faultline', anim: A.spN, dur: 0.86, type: 'special', cost: 25, trails: [{ t0: 0.24, t1: 0.42, which: 'R' }],
    hits: [H(0.37, 0.45, 0.2, 1.8, 0, 1.8, 8, 3, { knockdown: true })], ai: [2.2, 8.5],
    events: [
      { t: 0.38, do: (f, F) => {
        const x = f.x + f.facing * 1.25;
        F.fx.groundSlam(x, f.color, 0.75); F.shake(0.7); F.sfx('slam');
        F.projectile(f, { kind: 'quake', x, y: 0.6, vx: 11.5 * f.facing, w: 0.9, h: 1.5, dmg: 11, level: 2, kby: 9, kbx: 2.5, life: 0.85, color: f.color });
      } },
    ],
  };
  M.spF = {
    name: 'Freight Charge', anim: A.spF, dur: 0.96, type: 'special', cost: 30, armor: [0.05, 0.62],
    hits: [H(0.24, 0.6, 0.1, 1.35, 0.3, 2.4, 16, 3, { kbx: 13, kby: 5, pause: 0.16 })], vel: [{ t0: 0.24, t1: 0.58, vx: 13.5 }], ai: [2, 6.5],
    events: [
      { t: 0.05, do: (f, F) => { steam(f, F, 'back'); F.sfx('charge'); } },
      { t: 0.24, do: (f, F) => { F.sfx('dashHeavy'); F.fx.ring(v3(f.x, 1.2), { color: f.color, r0: 0.5, r1: 3.2, dur: 0.35, tiltY: 1.25 }); F.fx.dust(f.x, -f.facing, 10); } },
    ],
    update: (f, F, t, dt) => {
      if (t > 0.24 && t < 0.6) {
        f.ghostEvery(0.06, 0.22);
        if (Math.random() < dt * 40) { F.fx.dust(f.x - f.facing * 0.4, -f.facing, 2); steam(f, F, 'back'); }
        if (Math.random() < dt * 30) F.fx.sparks(v3(f.x, 0.05), { count: 3, color: 0xffd9a0, color2: f.color, dir: [-f.facing, 0.6, 0], speed: 7 });
      }
    },
  };
  M.spD = {
    name: 'Magnet Well', anim: A.spD, dur: 1.1, type: 'special', cost: 35, armor: [0.15, 0.75],
    hits: [H(0.72, 0.8, -0.6, 2.6, 0, 2.8, 17, 3, { kby: 10.5, kbx: 6, fx: 'shock', pause: 0.16 })], ai: [1.5, 6],
    events: [
      { t: 0.18, do: (f, F) => F.sfx('magnet') },
      { t: 0.72, do: (f, F) => {
        const p = v3(f.x + f.facing * 1.2, 1.3);
        F.fx.explosion(p, f.color, 0.9); F.shake(0.9); F.sfx('explosion'); F.R.kickAberration(0.015);
      } },
    ],
    update: (f, F, t, dt) => {
      if (t > 0.2 && t < 0.7) {
        const c = v3(f.x + f.facing * 1.3, 1.3);
        F.pull(f, 11, dt);
        if (Math.random() < dt * 60) F.fx.implode(c, { color: f.color, count: 3, radius: 3.4, life: 0.3 });
        f.fxTimer = (f.fxTimer || 0) - dt;
        if (f.fxTimer <= 0) {
          f.fxTimer = 0.11;
          F.fx.ring(c, { color: f.color, r0: 3.2, r1: 0.2, dur: 0.3, width: 0.07, ease: (x) => x, tiltY: 0.5 * f.facing });
          F.fx.lightning(f.anchor('handR'), f.anchor('handL'), { color: f.color, dur: 0.1, width: 0.05, jitter: 0.2 });
        }
      }
    },
  };
  M.overdrive = {
    name: 'TECTONIC VERDICT', anim: A.overdrive, dur: 2.3, type: 'overdrive', invuln: [0, 1.7], airborne: [0.9, 1.45],
    hits: [H(1.45, 1.6, -5.5, 5.5, 0, 2.6, 42, 3, { kby: 14, kbx: 5, guard: 70, chip: 0.25, fx: 'shock', pause: 0.22 })], ai: [0, 7],
    events: [
      { t: 0, do: (f, F) => F.cinematic(f, 0.95) },
      { t: 0.45, do: (f, F) => { const p = f.anchor('handR'); F.fx.impact(v3(f.x + f.facing * 0.5, p.y), f.color, 0.9, f.facing); F.shake(0.4); F.sfx('hitHeavy'); } },
      { t: 0.72, do: (f, F) => { const p = f.anchor('handR'); F.fx.impact(v3(f.x + f.facing * 0.5, p.y), f.color, 1.2, f.facing); F.shake(0.6); F.sfx('hitHeavy'); F.fx.ring(v3(f.x, 0.05), { color: f.color, r0: 0.4, r1: 5, dur: 0.5, ground: true }); } },
      { t: 0.9, do: (f, F) => {
        const foe = F.foe(f);
        f.jumpFrom = f.x;
        f.jumpTo = Math.max(-8.4, Math.min(8.4, Math.abs(foe.x - f.x) < 7 ? foe.x - f.facing * 0.9 : f.x + f.facing * 7));
        F.fx.groundSlam(f.x, f.color, 0.6); F.sfx('jump'); F.sfx('dashHeavy');
      } },
      { t: 1.45, do: (f, F) => {
        F.R.impactFrame(0.1, 0x0a0300, f.color);
        F.fx.groundSlam(f.x, f.color, 2);
        for (let i = 1; i <= 4; i++) for (const s of [-1, 1]) {
          const x = f.x + s * i * 1.3;
          F.after(i * 0.05, () => { if (Math.abs(x) < 10.5) { F.fx.pillar(x, { color: f.color, width: 0.9, height: 3 + i * 1.2, dur: 0.5 }); F.fx.groundSlam(x, f.color, 0.5); } });
        }
        F.shake(1.6); F.sfx('explosion'); F.sfx('slam'); F.R.kickAberration(0.035); F.R.kickRadial(0.07, 0.5, 0.3);
      } },
    ],
    update: (f, F, t) => {
      if (t >= 0.9 && t < 1.45) {
        const u = (t - 0.9) / 0.55;
        f.x = f.jumpFrom + (f.jumpTo - f.jumpFrom) * Math.min(1, u * 1.15);
        f.y = Math.max(0, 5.2 * 4 * u * (1 - u) * (u < 0.8 ? 1 : 1 - (u - 0.8) * 2.5));
        f.ghostEvery(0.05, 0.25);
      } else if (t >= 1.45) f.y = 0;
    },
  };
  return { anims: A, moves: M, stance: st };
}

// ===========================================================================
// WRAITH
// ===========================================================================
function wraith(d) {
  const st = { hips: [-16, 0, -10], spine: -8, chest: [-8, 0, -12], head: 26, armL: [62, 14, 0], foreL: 40, armR: [-28, 22, 0], foreR: 58, thighL: [48, 8, 0], shinL: -62, thighR: [-24, 10, 0], shinR: -44 };
  const block = P(st, { hips: [-8], chest: [-4, 0, 10], head: 16, armL: [96, -10, 30], foreL: 80, armR: [70, -6, 30], foreR: 110 });
  const A = commonClips(st, d, { block });
  const lunge = { thighL: [70, 6], shinL: -76, thighR: [-40, 6], shinR: -12 };

  A.light1 = strike(st,
    P(st, { chest: [-6, 0, -30], armL: [120, 40], foreL: 50 }),
    P(st, { hips: [-18, 0, 14], chest: [-10, 0, 26], armL: [50, -16, 10], foreL: 10, armR: [-40, 26], foreR: 40, x: 0.12 }),
    0.03, 0.07, 0.07, 0.26);
  A.light2 = strike(st,
    P(st, { hips: [-18, 0, 30], chest: [-10, 0, 40], armR: [10, 10], foreR: 70, armL: [20, 20], foreL: 60 }),
    P(st, { hips: [-14, 0, -30], chest: [-6, 0, -44], armR: [122, 30], foreR: 6, armL: [-10, 26], foreL: 60, ...lunge, x: 0.18 }),
    0.035, 0.08, 0.07, 0.28);
  A.light3 = clip([
    [0, st],
    [0.06, P(st, { hips: [-12, 0, 0], chest: [-6, 0, 30], armL: [84, 50], foreL: 10, armR: [84, 50], foreR: 10, yaw: -60 }), 'out'],
    [0.2, P(st, { hips: [-12, 0, 0], chest: [-6, 0, 0], armL: [84, 70], foreL: 4, armR: [84, 70], foreR: 4, thighL: [40, 14], shinL: -50, thighR: [-10, 14], shinR: -50, yaw: -400, x: 0.2 }), 'linear'],
    [0.28, P(st, { armL: [70, 40], foreL: 20, armR: [40, 40], foreR: 30, yaw: -360, x: 0.2 }), 'out'],
    [0.42, P(st, { yaw: -360 })],
  ]);
  A.heavy = strike(st,
    P(st, { hips: [-24, 0, 0], spine: -10, chest: -12, head: 40, armL: [70, -30, 40], foreL: 96, armR: [70, -30, 40], foreR: 96, thighL: [70, 8], shinL: -100, thighR: [0, 10], shinR: -84 }),
    P(st, { hips: [-22, 0, 0], chest: [4, 0, 0], head: 24, armL: [40, 76], foreL: 4, armR: [40, 76], foreR: 4, ...lunge, x: 0.45 }),
    0.1, 0.2, 0.12, 0.54);
  // back-flip kick: hips swing a full turn while airborne
  A.launcher = clip([
    [0, st],
    [0.08, P(st, { hips: [-30], thighL: [80, 8], shinL: -110, thighR: [20, 8], shinR: -100, armL: [20, 20], foreL: 60, armR: [0, 20], foreR: 60 }), 'out'],
    [0.16, { hips: [40], spine: 10, chest: 10, head: -10, armL: [-40, 30], foreL: 20, armR: [-60, 30], foreR: 20, thighL: [120, 6], shinL: -6, thighR: [20, 6], shinR: -70, footL: 40, footR: 30, y: 0.5 }, 'in'],
    [0.28, { hips: [190], spine: 14, chest: 12, head: -10, armL: [-50, 30], foreL: 20, armR: [-70, 30], foreR: 20, thighL: [60, 6], shinL: -40, thighR: [10, 6], shinR: -90, footL: 40, footR: 30, y: 1.1 }, 'linear'],
    [0.4, { hips: [330], spine: -4, chest: -6, head: 10, armL: [30, 30], foreL: 40, armR: [0, 30], foreR: 50, thighL: [70, 6], shinL: -80, thighR: [30, 6], shinR: -80, footL: 20, footR: 20, y: 0.45 }, 'linear'],
    [0.48, D(st, { hips: [360 - 14], thighL: [20], shinL: -30, thighR: [20], shinR: -30 }), 'out'],
    [0.56, D(st, { hips: [360] })],
  ], { ground: 0 });
  A.airL = clip([
    [0, { hips: [-10, 0, 30], chest: [0, 0, 40], armR: [20, 20], foreR: 60, armL: [130, 30], foreL: 40, thighL: [70, 5], shinL: -100, thighR: [20, 5], shinR: -80, footL: 30, footR: 30 }],
    [0.08, { hips: [-20, 0, -20], chest: [-8, 0, -30], head: 20, armR: [110, 30], foreR: 4, armL: [30, -10], foreL: 10, thighL: [60, 5], shinL: -90, thighR: [0, 5], shinR: -70, footL: 30, footR: 30 }, 'in3'],
    [0.34, { hips: [-14, 0, -20], chest: [-8, 0, -30], armR: [90, 30], foreR: 10, armL: [20, 0], foreL: 20, thighL: [50, 5], shinL: -70, thighR: [0, 5], shinR: -60, footL: 30, footR: 30 }],
  ], { ground: 0 });
  const plunge = { hips: [-50], spine: -6, chest: -4, head: 46, armL: [96, 8], foreL: 0, armR: [90, 8], foreR: 0, thighL: [-10, 5], shinL: -20, thighR: [-34, 5], shinR: -70, footL: 50, footR: 50 };
  A.airH = clip([
    [0, { hips: [20], chest: 10, armL: [170, 20], foreL: 60, armR: [170, 20], foreR: 60, thighL: [80, 5], shinL: -120, thighR: [50, 5], shinR: -110, footL: 30, footR: 30 }],
    [0.13, plunge, 'in3'], [1.0, plunge],
  ], { ground: 0 });
  A.spN = strike(st,
    P(st, { hips: [-10, 0, 40], chest: [-4, 0, 60], head: [20, 0, -50], armR: [70, -30, 60], foreR: 110, armL: [10, 30], foreL: 40 }),
    P(st, { hips: [-18, 0, -30], chest: [-8, 0, -50], head: [24, 0, 30], armR: [96, 50], foreR: 0, armL: [-30, 30], foreL: 50, ...lunge, x: 0.15 }),
    0.12, 0.2, 0.16, 0.58);
  const sever = P(st, { hips: [-24, 0, -40], chest: [-8, 0, -50], head: 30, armR: [130, 40], foreR: 0, armL: [130, 20], foreL: 6, ...lunge, x: 0.2 });
  A.spF = clip([
    [0, st],
    [0.1, P(st, { hips: [-30, 0, 30], chest: [-10, 0, 40], armR: [-20, 10], foreR: 100, armL: [-10, 10], foreL: 110, thighL: [80, 8], shinL: -110, thighR: [10, 8], shinR: -100 }), 'out'],
    [0.3, P(st, { hips: [-20, 0, 40], chest: [-10, 0, 50], armR: [-30, 20], foreR: 90, armL: [-20, 10], foreL: 100, ...lunge })],
    [0.36, sever, 'in3'],
    [0.54, sever],
    [0.7, st],
  ]);
  A.spD = clip([
    [0, st],
    [0.06, P(st, { hips: [-26], thighL: [80, 8], shinL: -110, thighR: [20, 8], shinR: -100 }), 'out'],
    [0.16, { hips: [-120], spine: -10, chest: -10, head: 20, armL: [60, 30], foreL: 60, armR: [40, 30], foreR: 60, thighL: [100, 6], shinL: -120, thighR: [80, 6], shinR: -120, footL: 30, footR: 30, y: 0.9 }, 'linear'],
    [0.28, { hips: [-250], spine: -10, chest: -10, head: 20, armL: [60, 30], foreL: 60, armR: [40, 30], foreR: 60, thighL: [100, 6], shinL: -120, thighR: [80, 6], shinR: -120, footL: 30, footR: 30, y: 0.9 }, 'linear'],
    [0.4, D(st, { hips: [-360 - 14], thighL: [20], shinL: -30, thighR: [20], shinR: -30 }), 'linear'],
    [0.56, D(st, { hips: [-360] }), 'out'],
  ], { ground: 0 });
  const sheath = P(st, { hips: [-10, 0, 60], spine: -4, chest: [-4, 0, 50], head: [-4, 0, -60], armR: [30, 10, 40], foreR: 100, armL: [-20, 20], foreL: 30, thighL: [40, 10], shinL: -70, thighR: [-30, 10], shinR: -70 });
  A.overdrive = clip([
    [0, st],
    [0.3, P(st, { hips: [-30, 0, 30], spine: -10, chest: [-10, 0, 30], head: 44, armL: [60, -30, 40], foreL: 110, armR: [60, -30, 40], foreR: 110, thighL: [84, 8], shinL: -116, thighR: [10, 8], shinR: -100 }), 'out'],
    [0.5, P(st, { hips: [-30, 0, 30], spine: -10, chest: [-10, 0, 30], head: 44, armL: [60, -30, 40], foreL: 110, armR: [60, -30, 40], foreR: 110, thighL: [84, 8], shinL: -116, thighR: [10, 8], shinR: -100 })],
    [0.56, sever, 'in3'],
    [1.6, sever],
    [1.75, sheath, 'out3'],
    [2.2, sheath],
    [2.45, st],
  ]);
  A.victory = clip([[0, st], [0.4, sheath, 'out3'], [3, sheath]]);

  const tB = (t0, t1) => [{ t0, t1, which: 'R' }, { t0, t1, which: 'L' }];
  const cut = (f, F, o) => F.fx.slash(v3(f.x + f.facing * (o.x ?? 0.7), o.y ?? 1.25), { color: f.color, facing: f.facing, dur: 0.18, thick: 0.26, radius: 1.5, ...o });
  const M = {};
  M.light1 = { name: 'Needle', anim: A.light1, dur: 0.26, type: 'light', chain: 'light2', trails: [{ t0: 0.02, t1: 0.16, which: 'L' }], hits: [H(0.065, 0.13, 0.1, 1.75, 0.6, 2.0, 3, 1, { fx: 'slash' })], vel: [{ t0: 0, t1: 0.08, vx: 3 }], sfx: 'slash', ai: [0, 1.8] };
  M.light2 = { name: 'Riposte', anim: A.light2, dur: 0.28, type: 'light', chain: 'light3', trails: [{ t0: 0.03, t1: 0.18, which: 'R' }], hits: [H(0.075, 0.14, 0.1, 1.85, 0.5, 2.3, 4, 1, { fx: 'slash' })], vel: [{ t0: 0, t1: 0.09, vx: 3.5 }], sfx: 'slash', ai: [0, 1.9] };
  M.light3 = {
    name: 'Gyre', anim: A.light3, dur: 0.42, type: 'light', trails: tB(0.04, 0.3),
    hits: [H(0.08, 0.13, -0.6, 1.9, 0.6, 1.9, 3, 1, { fx: 'slash', kbx: 0.6 }), H(0.15, 0.22, -0.6, 2.0, 0.6, 1.9, 6, 2, { fx: 'slash' })],
    vel: [{ t0: 0.04, t1: 0.2, vx: 4 }], sfx: 'slash', ai: [0, 2],
    events: [{ t: 0.08, do: (f, F) => { cut(f, F, { x: 0.1, y: 1.3, a0: 2.9, a1: -2.9, radius: 2.0, tilt: 1.25, dur: 0.24 }); } }],
  };
  M.heavy = {
    name: 'Scissor Veil', anim: A.heavy, dur: 0.54, type: 'heavy', chargeAt: 0.1, trails: tB(0.12, 0.34),
    hits: [H(0.19, 0.28, 0.1, 2.3, 0.3, 2.3, 11, 3, { fx: 'slash' })], vel: [{ t0: 0.1, t1: 0.22, vx: 8 }], sfx: 'slashHeavy', ai: [0.8, 2.6],
    events: [{ t: 0.19, do: (f, F) => {
      cut(f, F, { x: 1.0, a0: 2.3, a1: -0.9, radius: 1.7, thick: 0.3 });
      cut(f, F, { x: 1.0, a0: -2.3, a1: 0.9, radius: 1.7, thick: 0.3 });
    } }],
  };
  M.launcher = {
    name: 'Crescent Flip', anim: A.launcher, dur: 0.56, type: 'launcher', trails: [{ t0: 0.1, t1: 0.36, which: 'footL' }], airborne: [0.1, 0.5], invuln: [0.08, 0.2],
    hits: [H(0.14, 0.24, 0.0, 1.5, 0.3, 3.0, 8, 2, { kby: 12.5, kbx: 1.4 })], vel: [{ t0: 0.05, t1: 0.14, vx: 2 }, { t0: 0.14, t1: 0.44, vx: -3 }], sfx: 'whoosh', ai: [0, 1.5],
    events: [{ t: 0.14, do: (f, F) => cut(f, F, { x: 0.5, y: 1.4, a0: -1.6, a1: 1.9, radius: 1.6, thick: 0.3 }) }],
  };
  M.airL = { name: 'Swallow Cut', anim: A.airL, dur: 0.34, type: 'air', trails: [{ t0: 0.02, t1: 0.2, which: 'R' }], hits: [H(0.07, 0.17, 0.0, 1.9, -0.8, 1.4, 5, 1, { fx: 'slash' })], sfx: 'slash' };
  M.airH = {
    name: 'Guillotine Dive', anim: A.airH, dur: 1.0, type: 'air', dive: { t: 0.12, vx: 13, vy: -20 }, landRecover: 0.2, trails: tB(0.1, 1),
    hits: [H(0.12, 1.0, 0.0, 1.5, -1.3, 0.9, 10, 3, { fx: 'slash', knockdown: true })], sfx: 'slashHeavy',
    onLand: (f, F) => { F.fx.dust(f.x, 1, 5); F.fx.dust(f.x, -1, 5); F.fx.ring(v3(f.x, 0.05), { color: f.color, r0: 0.3, r1: 2.4, dur: 0.3, ground: true }); F.sfx('land'); },
  };
  M.spN = {
    name: 'Phantom Fan', anim: A.spN, dur: 0.58, type: 'special', cost: 22, trails: [{ t0: 0.12, t1: 0.3, which: 'R' }], ai: [2.5, 9],
    events: [{ t: 0.2, do: (f, F) => {
      F.sfx('throw');
      for (const a of [-0.2, 0, 0.2]) {
        F.projectile(f, { kind: 'shuriken', x: f.x + f.facing * 1.0, y: 1.35, vx: 15 * Math.cos(a) * f.facing, vy: 15 * Math.sin(a), w: 0.55, h: 0.55, dmg: 4.5, level: 1, kbx: 2, life: 0.9, color: f.color });
      }
    } }],
  };
  M.spF = {
    name: 'Blink Sever', anim: A.spF, dur: 0.7, type: 'special', cost: 30, trails: tB(0.3, 0.5), invuln: [0.1, 0.36], hidden: [0.12, 0.31],
    hits: [H(0.35, 0.44, -0.3, 2.0, 0.3, 2.3, 14, 3, { fx: 'slash', stun: 0.6 })], ai: [1.5, 8],
    events: [
      { t: 0.12, do: (f, F) => { f.spawnGhost(0.45); F.fx.implode(v3(f.x, 1.2), { color: f.color, count: 20, radius: 0.2 }); F.fx.motes(v3(f.x, 1.2), { color: f.color, count: 22, radius: 0.7, speed: 2.5 }); F.sfx('teleport'); } },
      { t: 0.3, do: (f, F) => {
        const foe = F.foe(f);
        const side = f.facing;
        const nx = Math.max(-8.4, Math.min(8.4, foe.x + side * 1.25));
        F.fx.lightning(v3(f.x, 1.2), v3(nx, 1.2), { color: f.color, dur: 0.16, width: 0.05, jitter: 0.15 });
        f.x = nx;
        f.faceFoe(true);
        F.fx.motes(v3(f.x, 1.2), { color: f.color, count: 22, radius: 0.7, speed: 2.5 });
        F.fx.flare(v3(f.x, 1.3), { color: f.color, size: 3 });
      } },
      { t: 0.35, do: (f, F) => { cut(f, F, { x: 0.6, a0: 2.2, a1: -1.2, radius: 2.1, thick: 0.34, dur: 0.22 }); F.sfx('slashHeavy'); } },
    ],
  };
  M.spD = {
    name: 'Mirage', anim: A.spD, dur: 0.56, type: 'special', cost: 25, invuln: [0.03, 0.34], airborne: [0.06, 0.44],
    vel: [{ t0: 0.06, t1: 0.4, vx: -11 }], ai: [0, 2.2],
    events: [{ t: 0.05, do: (f, F) => {
      F.sfx('teleport');
      F.decoy(f, { life: 1.5, radius: 1.7, dmg: 13, level: 3, kby: 8.5, kbx: 4 });
    } }],
    update: (f, F, t) => { if (t > 0.06 && t < 0.42) f.ghostEvery(0.05, 0.2); },
  };
  M.overdrive = {
    name: 'THOUSANDFOLD ECLIPSE', anim: A.overdrive, dur: 2.45, type: 'overdrive', invuln: [0, 2.1], hidden: [0.62, 1.58], trails: tB(0.5, 0.7),
    ai: [0, 9],
    events: [
      { t: 0, do: (f, F) => F.cinematic(f, 0.55) },
      { t: 0.3, do: (f, F) => { F.fx.implode(v3(f.x, 1.0), { color: f.color, count: 30, radius: 2.4 }); F.sfx('charge'); } },
      { t: 0.56, do: (f, F) => {
        const foe = F.foe(f);
        f.spawnGhost(0.5); F.sfx('teleport'); F.sfx('dashHeavy');
        F.fx.beam(v3(f.x, 1.2), v3(foe.x, 1.2), { color: f.color, width: 0.35, dur: 0.25 });
        F.R.setDesat(0.75);
        f.eclipseHits = 0;
      } },
      ...Array.from({ length: 9 }, (_, i) => ({
        t: 0.66 + i * 0.1,
        do: (f, F) => {
          const foe = F.foe(f);
          const c = v3(foe.x, foe.y + 1.2);
          const a = rand(TAU);
          const L = 5.5;
          const p0 = v3(c.x - Math.cos(a) * L, c.y - Math.sin(a) * L * 0.6, 0.3), p1 = v3(c.x + Math.cos(a) * L, c.y + Math.sin(a) * L * 0.6, 0.3);
          F.fx.beam(p0, p1, { color: i % 2 ? 0xffffff : f.color, width: 0.22, dur: 0.2, intensity: 2.2 });
          F.fx.slash(c, { color: f.color, radius: 1.6 + rand(0.8), a0: -1.3, a1: 1.3, rot: a + rand(-0.4, 0.4), dur: 0.16, thick: 0.2 });
          F.sfx('slash');
          const hit = F.areaHit(f, { x0: c.x - 1.4, x1: c.x + 1.4, y0: c.y - 2, y1: c.y + 2 }, H(0, 0, 0, 0, 0, 0, 3.2, 1, { fx: 'slash', kbx: 0, stun: 0.5, pause: 0.02, hold: true }));
          if (hit) f.eclipseHits++;
          F.shake(0.2);
        },
      })),
      { t: 1.58, do: (f, F) => {
        const foe = F.foe(f);
        f.x = Math.max(-8.4, Math.min(8.4, foe.x + f.facing * 2.2));
        f.faceFoe(true);
        f.facing = -f.facing; f.snapYaw(); // back turned to the target: sheathing pose
        F.fx.motes(v3(f.x, 1.2), { color: f.color, count: 26, radius: 0.8, speed: 2 });
        F.sfx('teleport');
      } },
      { t: 2.0, do: (f, F) => {
        const foe = F.foe(f);
        const c = v3(foe.x, foe.y + 1.2);
        F.R.setDesat(0);
        F.R.impactFrame(0.1, 0x06000c, f.color);
        F.areaHit(f, { x0: c.x - 1.6, x1: c.x + 1.6, y0: c.y - 2.2, y1: c.y + 2.2 }, H(0, 0, 0, 0, 0, 0, 15, 3, { fx: 'slash', kby: 9.5, kbx: 5, guard: 60, chip: 0.25, pause: 0.2, dirFrom: f.x }));
        F.fx.explosion(c, f.color, 1.2);
        for (let i = 0; i < 6; i++) F.fx.slash(c, { color: i % 2 ? 0xffffff : f.color, radius: 2.4 + i * 0.3, a0: -1.5, a1: 1.5, rot: rand(TAU), dur: 0.3, thick: 0.16 });
        F.shake(1.3); F.sfx('explosion'); F.R.kickAberration(0.03);
      } },
      { t: 2.2, do: (f, F) => { f.faceFoe(true); } },
    ],
  };
  return { anims: A, moves: M, stance: st };
}

// ===========================================================================
// TEMPEST
// ===========================================================================
function tempest(d) {
  const st = { hips: [0, 0, -6], spine: 2, chest: [2, 0, -8], head: 4, armL: [38, 30, 0], foreL: 62, armR: [10, 34, 0], foreR: 78, thighL: [14, 4, 0], shinL: -22, thighR: [-6, 5, 0], shinR: -26, footL: 28, footR: 34 };
  const block = P(st, { hips: [4], chest: [2, 0, 10], head: 8, armL: [84, 10, 30], foreL: 70, armR: [80, 14, 30], foreR: 76 });
  const A = commonClips(st, d, { block });
  const lean = { hips: [-12, 0, 0], thighL: [30, 4], shinL: -30, thighR: [-16, 5], shinR: -20, footL: 28, footR: 40 };

  A.light1 = strike(st,
    P(st, { chest: [0, 0, -20], armL: [40, 20], foreL: 120 }),
    P(st, { hips: [-6, 0, -12], chest: [-6, 0, -20], armL: [90, 6], foreL: 2, armR: [0, 30], foreR: 90, x: 0.06 }),
    0.045, 0.1, 0.08, 0.32);
  A.light2 = strike(st,
    P(st, { hips: [0, 0, 30], chest: [0, 0, 40], armR: [60, -20, 40], foreR: 100, armL: [20, 30], foreL: 80 }),
    P(st, { hips: [-6, 0, -24], chest: [-4, 0, -34], armR: [86, 44], foreR: 4, armL: [10, 34], foreL: 70, ...lean, x: 0.1 }),
    0.055, 0.12, 0.09, 0.36);
  A.light3 = strike(st,
    P(st, { hips: [8], chest: [10], armL: [-20, 20], foreL: 110, armR: [-20, 20], foreR: 110 }),
    P(st, { ...lean, hips: [-14], chest: -8, head: 20, armL: [92, 6], foreL: 2, armR: [92, 6], foreR: 2, x: 0.14 }),
    0.08, 0.16, 0.12, 0.5);
  A.heavy = strike(st,
    P(st, { hips: [6, 0, -40], chest: [8, 0, -54], head: [0, 0, 60], armR: [-30, 40], foreR: 100, armL: [86, 10], foreL: 6, thighL: [20, 4], shinL: -24 }),
    P(st, { ...lean, hips: [-14, 0, 34], chest: [-8, 0, 46], head: [14, 0, -40], armR: [90, 0], foreR: 0, armL: [-30, 34], foreL: 60, x: 0.2 }),
    0.16, 0.3, 0.2, 0.72);
  A.launcher = strike(st,
    P(st, { hips: [-20], spine: -8, chest: -10, head: 30, armL: [10, 40], foreL: 20, armR: [10, 40], foreR: 20, thighL: [40, 6], shinL: -60, thighR: [10, 6], shinR: -60 }),
    P(st, { hips: [8], spine: 6, chest: 10, head: -16, armL: [168, 24], foreL: 10, armR: [168, 24], foreR: 10, thighL: [8, 4], shinL: -8, thighR: [-4, 5], shinR: -10, footL: 40, footR: 44 }),
    0.09, 0.18, 0.16, 0.56);
  A.airL = clip([
    [0, { hips: [0], chest: [0, 0, -20], armL: [60, 20], foreL: 110, armR: [20, 30], foreR: 80, thighL: [40, 5], shinL: -60, thighR: [10, 5], shinR: -60, footL: 40, footR: 40 }],
    [0.1, { hips: [-16], chest: [-8, 0, -10], head: 20, armL: [66, 6], foreL: 0, armR: [-10, 34], foreR: 70, thighL: [30, 5], shinL: -50, thighR: [-10, 5], shinR: -50, footL: 40, footR: 40 }, 'in3'],
    [0.38, { hips: [-10], chest: [-8, 0, -10], armL: [60, 6], foreL: 10, armR: [-10, 34], foreR: 70, thighL: [30, 5], shinL: -50, thighR: [-10, 5], shinR: -50, footL: 40, footR: 40 }],
  ], { ground: 0 });
  const stomp = { hips: [-6], chest: -4, head: 24, armL: [20, 50], foreL: 30, armR: [20, 50], foreR: 30, thighL: [10, 4], shinL: -4, thighR: [40, 5], shinR: -90, footL: -10, footR: 30 };
  A.airH = clip([
    [0, { hips: [4], chest: 6, armL: [150, 30], foreL: 30, armR: [150, 30], foreR: 30, thighL: [70, 5], shinL: -110, thighR: [50, 5], shinR: -100, footL: 30, footR: 30 }],
    [0.16, stomp, 'in3'], [1.0, stomp],
  ], { ground: 0 });
  const conjure = P(st, { hips: [4, 0, -20], chest: [6, 0, -30], head: [0, 0, 30], armL: [70, 20], foreL: 60, armR: [60, 24], foreR: 70 });
  const cast = P(st, { ...lean, chest: [-6, 0, 10], head: 14, armL: [88, 14], foreL: 4, armR: [84, 18], foreR: 8, x: 0.08 });
  A.spN = clip([[0, st], [0.14, conjure, 'out'], [0.26, D(conjure, { armL: [6, -10], armR: [6, -10] })], [0.32, cast, 'in3'], [0.52, cast], [0.72, st]]);
  const point = P(st, { hips: [2, 0, -10], chest: [4, 0, -14], head: -6, armR: [150, 10], foreR: 4, armL: [20, 34], foreL: 60 });
  const strikeDown = P(st, { ...lean, chest: [-8, 0, 20], head: 20, armR: [50, 4], foreR: 2, armL: [-20, 34], foreL: 50 });
  A.spF = clip([[0, st], [0.16, point, 'out'], [0.34, point], [0.42, strikeDown, 'in3'], [0.6, strikeDown], [0.76, st]]);
  A.spD = clip([[0, st], [0.08, P(st, { hips: [10], chest: [10], head: -10, armL: [-10, 60], foreL: 30, armR: [-10, 60], foreR: 30 }), 'out'], [0.3, P(st, { armL: [40, 50], foreL: 40, armR: [30, 50], foreR: 50 })], [0.5, st]]);
  const rise = P(st, { hips: [6], spine: 6, chest: 12, head: -20, armL: [150, 50], foreL: 20, armR: [150, 50], foreR: 20, thighL: [10, 4], shinL: -30, thighR: [-4, 5], shinR: -44, footL: 44, footR: 48 });
  const judge = P(st, { hips: [-8], spine: -4, chest: -8, head: 24, armL: [80, 30], foreL: 0, armR: [80, 30], foreR: 0, thighL: [10, 4], shinL: -30, thighR: [-4, 5], shinR: -44, footL: 44, footR: 48 });
  A.overdrive = clip([[0, st], [0.3, D(st, { hips: [-10], chest: [-10], armL: [0, -20], foreL: 60, armR: [0, -20], foreR: 50 }), 'out'], [0.8, rise, 'inOut3'], [1.0, rise], [1.12, judge, 'in3'], [2.25, D(judge, { hips: [-4] })], [2.6, st]], { ground: 0 });
  A.victory = clip([[0, st], [0.6, rise, 'out3'], [3, rise]]);

  const zap = (f, F, from, to, o = {}) => F.fx.lightning(from, to, { color: f.color, dur: 0.14, width: 0.08, ...o });
  const palmBurst = (f, F, anchor, size = 1) => {
    const p = f.anchor(anchor);
    F.fx.flare(p, { color: f.color, size: 1.6 * size, life: 0.12 });
    F.fx.ring(p, { color: f.color, r0: 0.1, r1: 0.9 * size, dur: 0.2, tiltY: 1.2 * f.facing });
    for (let i = 0; i < 3; i++) zap(f, F, p, v3(p.x + f.facing * rand(0.5, 1.3) * size, p.y + rand(-0.5, 0.5) * size), { width: 0.05 });
    F.sfx('zap');
  };
  const M = {};
  M.light1 = { name: 'Static Palm', anim: A.light1, dur: 0.32, type: 'light', chain: 'light2', hits: [H(0.095, 0.17, 0.15, 1.75, 0.8, 2.0, 4, 1, { fx: 'shock' })], vel: [{ t0: 0, t1: 0.1, vx: 2 }], ai: [0, 1.8], events: [{ t: 0.09, do: (f, F) => palmBurst(f, F, 'handL') }] };
  M.light2 = {
    name: 'Arc Backhand', anim: A.light2, dur: 0.36, type: 'light', chain: 'light3', trails: [{ t0: 0.05, t1: 0.22, which: 'R' }], hits: [H(0.115, 0.19, 0.15, 1.85, 0.7, 2.1, 5, 1, { fx: 'shock' })], vel: [{ t0: 0, t1: 0.12, vx: 2.5 }], ai: [0, 1.9],
    events: [{ t: 0.11, do: (f, F) => { palmBurst(f, F, 'handR'); F.fx.slash(v3(f.x + f.facing * 0.4, 1.5), { color: f.color, facing: f.facing, a0: 1.3, a1: -1.0, radius: 1.5, thick: 0.2, dur: 0.2, tilt: 1.0 }); } }],
  };
  M.light3 = {
    name: 'Twin Discharge', anim: A.light3, dur: 0.5, type: 'light', hits: [H(0.155, 0.25, 0.15, 2.2, 0.6, 2.2, 8, 2, { fx: 'shock', kbx: 5 })], vel: [{ t0: 0.04, t1: 0.16, vx: 2.5 }], ai: [0, 2.2],
    events: [{ t: 0.155, do: (f, F) => {
      palmBurst(f, F, 'handR', 1.6);
      const p = f.anchor('handR');
      F.fx.beam(v3(p.x, p.y), v3(p.x + f.facing * 1.6, p.y), { color: f.color, width: 1.0, dur: 0.2 });
    } }],
  };
  M.heavy = {
    name: 'Fulgur Lance', anim: A.heavy, dur: 0.72, type: 'heavy', chargeAt: 0.16,
    hits: [H(0.29, 0.4, 0.2, 4.2, 0.9, 1.9, 14, 3, { fx: 'shock', kbx: 7 })], ai: [1.2, 4.2],
    events: [
      { t: 0.08, do: (f, F) => { F.fx.implode(f.anchor('handR'), { color: f.color, count: 12, radius: 1.2 }); F.sfx('charge'); } },
      { t: 0.29, do: (f, F) => {
        const p = f.anchor('handR');
        const e = v3(p.x + f.facing * 4.2, p.y);
        F.fx.beam(p, e, { color: f.color, width: 0.9, dur: 0.3 });
        for (let i = 0; i < 4; i++) zap(f, F, p, v3(e.x, e.y + rand(-0.5, 0.5)), { jitter: 0.5, dur: 0.22 });
        F.fx.flare(p, { color: 0xffffff, size: 3.5 });
        F.fx.light(v3(p.x + f.facing * 2, p.y), f.color, 80, 0.3, 14);
        F.sfx('beam'); F.shake(0.4); F.R.kickAberration(0.01);
      } },
    ],
  };
  M.launcher = {
    name: 'Updraft', anim: A.launcher, dur: 0.56, type: 'launcher',
    hits: [H(0.17, 0.3, 0.2, 1.9, 0, 3.2, 8, 2, { fx: 'shock', kby: 13, kbx: 1.2 })], ai: [0, 1.9],
    events: [{ t: 0.17, do: (f, F) => {
      const x = f.x + f.facing * 1.1;
      F.fx.pillar(x, { color: f.color, width: 0.9, height: 4.5, dur: 0.45 });
      F.fx.ring(v3(x, 0.05), { color: f.color, r0: 0.2, r1: 2.2, dur: 0.35, ground: true });
      for (let i = 0; i < 4; i++) zap(f, F, v3(x + rand(-0.4, 0.4), 0), v3(x + rand(-0.6, 0.6), rand(2, 4)), { dur: 0.2 });
      F.fx.motes(v3(x, 0.4), { color: f.color, count: 16, vy: 6, radius: 0.5 });
      F.sfx('zap'); F.sfx('whooshHeavy');
    } }],
  };
  M.airL = { name: 'Sky Spark', anim: A.airL, dur: 0.38, type: 'air', hits: [H(0.095, 0.2, 0.1, 1.9, -1.0, 1.2, 6, 1, { fx: 'shock' })], events: [{ t: 0.09, do: (f, F) => palmBurst(f, F, 'handL', 1.2) }] };
  M.airH = {
    name: 'Thunder Heel', anim: A.airH, dur: 1.0, type: 'air', dive: { t: 0.16, vx: 3, vy: -22 }, landRecover: 0.26,
    hits: [H(0.16, 1.0, -0.5, 0.9, -1.2, 0.8, 9, 2, { fx: 'shock', knockdown: true })],
    onLand: (f, F) => {
      F.fx.lightning(v3(f.x, 9), v3(f.x, 0), { color: f.color, width: 0.2, dur: 0.22, branches: 2 });
      F.fx.groundSlam(f.x, f.color, 0.7); F.shake(0.6); F.sfx('thunder');
      F.areaHit(f, { x0: f.x - 1.8, x1: f.x + 1.8, y0: 0, y1: 1.2 }, H(0, 0, 0, 0, 0, 0, 6, 2, { kby: 7, fx: 'shock' }));
    },
  };
  M.spN = {
    name: 'Ball Lightning', anim: A.spN, dur: 0.72, type: 'special', cost: 25, ai: [2.5, 9],
    events: [
      { t: 0.12, do: (f, F) => { F.fx.implode(v3(f.x + f.facing * 0.7, 1.45), { color: f.color, count: 18, radius: 1.3 }); F.sfx('charge'); } },
      { t: 0.32, do: (f, F) => {
        F.sfx('orb');
        F.projectile(f, { kind: 'orb', x: f.x + f.facing * 1.1, y: 1.4, vx: 4.6 * f.facing, w: 1.0, h: 1.0, dmg: 4, level: 1, kbx: 1.2, stun: 0.36, life: 2.6, multi: 4, interval: 0.2, color: f.color });
      } },
    ],
  };
  M.spF = {
    name: 'Chain Bolt', anim: A.spF, dur: 0.76, type: 'special', cost: 30, ai: [2, 10],
    events: [
      { t: 0.16, do: (f, F) => {
        const foe = F.foe(f);
        const x = foe.x + foe.vx * 0.2;
        f.boltX = x;
        F.fx.ring(v3(x, 0.05), { color: f.color, r0: 2.4, r1: 0.5, dur: 0.3, ground: true, ease: (t) => t, width: 0.08 });
        F.fx.ring(v3(x, 0.05), { color: 0xffffff, r0: 0.7, r1: 0.75, dur: 0.3, ground: true, width: 0.05 });
        zap(f, F, f.anchor('handR'), v3(f.x, 9), { dur: 0.2 });
        F.sfx('zap');
      } },
      { t: 0.44, do: (f, F) => {
        const x = f.boltX;
        F.fx.lightning(v3(x + rand(-1, 1), 11), v3(x, 0), { color: f.color, width: 0.34, dur: 0.26, branches: 4, jitter: 0.6 });
        F.fx.lightning(v3(x, 11), v3(x, 0), { color: 0xffffff, width: 0.16, dur: 0.2, jitter: 0.3 });
        F.fx.pillar(x, { color: f.color, width: 0.8, height: 9, dur: 0.35 });
        F.fx.groundSlam(x, f.color, 0.8);
        F.R.flash(f.color, 0.18); F.shake(0.9); F.sfx('thunder');
        F.areaHit(f, { x0: x - 0.85, x1: x + 0.85, y0: 0, y1: 9 }, H(0, 0, 0, 0, 0, 0, 15, 3, { fx: 'shock', stun: 0.65, kbx: 3, dirFrom: f.x }));
      } },
    ],
  };
  M.spD = {
    name: 'Storm Step', anim: A.spD, dur: 0.5, type: 'special', cost: 20, invuln: [0.05, 0.3], hidden: [0.1, 0.22], ai: [0, 2.4],
    events: [
      { t: 0.1, do: (f, F) => {
        const ox = f.x;
        f.spawnGhost(0.4);
        F.fx.motes(v3(f.x, 1.2), { color: f.color, count: 20, radius: 0.6, speed: 2.5 });
        let nx = f.x - f.facing * 4.5;
        if (Math.abs(nx) > 8.4) nx = f.x + f.facing * 4.5; // cornered: step through instead
        nx = Math.max(-8.4, Math.min(8.4, nx));
        F.fx.lightning(v3(ox, 1.3), v3(nx, 1.3), { color: f.color, dur: 0.2, width: 0.1, jitter: 0.5 });
        f.x = nx;
        F.trap(f, { x: ox, life: 3.2, radius: 0.95, dmg: 8, level: 2, stun: 0.75, kbx: 0.5 });
        F.sfx('teleport');
      } },
      { t: 0.22, do: (f, F) => { f.faceFoe(true); F.fx.flare(v3(f.x, 1.3), { color: f.color, size: 3 }); F.fx.motes(v3(f.x, 1.2), { color: f.color, count: 16, radius: 0.6 }); } },
    ],
  };
  M.overdrive = {
    name: 'CATACLYSM HALO', anim: A.overdrive, dur: 2.6, type: 'overdrive', invuln: [0, 2.3], airborne: [0.3, 2.5], ai: [0, 10],
    events: [
      { t: 0, do: (f, F) => F.cinematic(f, 1.0) },
      { t: 0.3, do: (f, F) => { F.fx.implode(v3(f.x, 1.6), { color: f.color, count: 40, radius: 3.2, life: 0.45 }); F.sfx('charge'); } },
      { t: 0.8, do: (f, F) => {
        const c = v3(f.x, f.y + 1.9);
        F.fx.ring(c, { color: f.color, r0: 0.5, r1: 7, dur: 0.6, width: 0.1 });
        F.fx.ring(c, { color: 0xffffff, r0: 0.5, r1: 3.4, dur: 0.5, width: 0.05, rot: 1 });
        F.fx.flare(c, { color: 0xffffff, size: 8, life: 0.3 });
        F.R.flash(f.color, 0.25); F.sfx('thunder'); F.shake(0.6);
      } },
      ...Array.from({ length: 10 }, (_, i) => ({
        t: 1.12 + i * 0.105,
        do: (f, F) => {
          const foe = F.foe(f);
          const x = i % 2 === 0 ? foe.x + rand(-0.3, 0.3) : Math.max(-9, Math.min(9, foe.x + rand(1.5, 4) * randSign()));
          F.fx.lightning(v3(x + rand(-1.5, 1.5), 11), v3(x, 0), { color: i % 3 ? f.color : 0xffffff, width: 0.26, dur: 0.2, branches: 2, jitter: 0.6 });
          F.fx.pillar(x, { color: f.color, width: 0.7, height: 9, dur: 0.3 });
          F.fx.groundSlam(x, f.color, 0.5);
          F.shake(0.45); F.sfx('thunder'); if (i % 3 === 0) F.R.flash(f.color, 0.12);
          F.areaHit(f, { x0: x - 0.9, x1: x + 0.9, y0: 0, y1: 9 }, H(0, 0, 0, 0, 0, 0, 4.4, 2, { fx: 'shock', kbx: 0.3, stun: 0.5, pause: 0.03, hold: true, guard: 9, dirFrom: f.x }));
        },
      })),
      { t: 2.2, do: (f, F) => {
        const foe = F.foe(f);
        const x = foe.x;
        F.R.impactFrame(0.1, 0x00100c, f.color);
        F.fx.lightning(v3(x, 12), v3(x, 0), { color: 0xffffff, width: 0.7, dur: 0.4, branches: 5, jitter: 0.8 });
        F.fx.pillar(x, { color: f.color, width: 2.4, height: 12, dur: 0.7 });
        F.fx.explosion(v3(x, 1), f.color, 1.5); F.fx.groundSlam(x, f.color, 1.6);
        F.shake(1.6); F.sfx('explosion'); F.sfx('thunder'); F.R.kickAberration(0.035);
        F.areaHit(f, { x0: x - 1.7, x1: x + 1.7, y0: 0, y1: 10 }, H(0, 0, 0, 0, 0, 0, 12, 3, { fx: 'shock', kby: 11, kbx: 5, guard: 60, chip: 0.25, pause: 0.2, dirFrom: f.x }));
      } },
    ],
    update: (f, F, t, dt) => {
      const u = t < 0.3 ? 0 : t < 0.9 ? (t - 0.3) / 0.6 : t < 2.2 ? 1 : Math.max(0, 1 - (t - 2.2) / 0.3);
      f.y = 1.7 * u * u * (3 - 2 * u);
      if (t > 0.8 && t < 2.2 && Math.random() < dt * 30) {
        const c = f.anchor('back');
        zap(f, F, c, v3(c.x + rand(-2.5, 2.5), c.y + rand(-1.5, 2.5)), { width: 0.05 });
      }
    },
  };
  return { anims: A, moves: M, stance: st };
}

// ===========================================================================
const FACTORIES = { vanguard, bastion, wraith, tempest };
const DIMS = {
  vanguard: { hipY: 1.16 },
  bastion: { hipY: 1.12 },
  wraith: { hipY: 1.2 },
  tempest: { hipY: 1.2 },
};
const cache = {};
export function getMoveset(id) {
  if (!cache[id]) {
    const ms = FACTORIES[id](DIMS[id]);
    for (const [key, m] of Object.entries(ms.moves)) {
      m.id = key;
      m.hits = m.hits || [];
      m.events = (m.events || []).sort((a, b) => a.t - b.t);
    }
    cache[id] = ms;
  }
  return cache[id];
}
