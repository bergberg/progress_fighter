import { BONES, BONE_INDEX, NB, CH, CH_ROOT_X, CH_ROOT_Y, CH_ROOT_YAW } from './builder.js';
import { Ease } from '../engine/utils.js';

// ---------------------------------------------------------------------------
// Pose specs are small plain objects:
//   { hips:[swing,out,twist] | swing, spine, chest, head, armL, foreL, handL, ...,
//     x, y, yaw }       (degrees / metres)
// Positive swing = limb swings forward (torso bones: negative = lean forward).
// Feet that are not specified are automatically kept flat on the floor.
// ---------------------------------------------------------------------------

export function P(base, over) {
  return over ? { ...base, ...over } : { ...base };
}

export function compile(spec) {
  const out = new Float32Array(CH);
  for (let i = 0; i < NB; i++) {
    const v = spec[BONES[i]];
    if (v === undefined) continue;
    if (typeof v === 'number') out[i * 3] = v;
    else {
      out[i * 3] = v[0] || 0;
      out[i * 3 + 1] = v[1] || 0;
      out[i * 3 + 2] = v[2] || 0;
    }
  }
  const hz = out[BONE_INDEX.hips * 3];
  for (const S of ['L', 'R']) {
    if (spec['foot' + S] === undefined) {
      out[BONE_INDEX['foot' + S] * 3] = -(hz + out[BONE_INDEX['thigh' + S] * 3] + out[BONE_INDEX['shin' + S] * 3]);
    }
  }
  out[CH_ROOT_X] = spec.x || 0;
  out[CH_ROOT_Y] = spec.y || 0;
  out[CH_ROOT_YAW] = spec.yaw || 0;
  return out;
}

/**
 * Build an animation clip.
 * keys: [[time, poseSpec, ease?], ...] — ease applies to the segment arriving at that key.
 */
export function clip(keys, opts = {}) {
  const ks = keys.map(([t, spec, e]) => ({ t, p: compile(spec), e: typeof e === 'string' ? Ease[e] : e || Ease.inOut }));
  const dur = opts.dur ?? ks[ks.length - 1].t;
  return { keys: ks, dur, loop: !!opts.loop, ground: opts.ground ?? 1 };
}

export function sample(c, t, out) {
  const ks = c.keys;
  if (c.loop) {
    t = t % c.dur;
    if (t < 0) t += c.dur;
  } else if (t >= ks[ks.length - 1].t) {
    out.set(ks[ks.length - 1].p);
    return out;
  }
  if (t <= ks[0].t) {
    out.set(ks[0].p);
    return out;
  }
  let i = 0;
  while (i < ks.length - 2 && t >= ks[i + 1].t) i++;
  const a = ks[i];
  const b = ks[i + 1];
  const span = b.t - a.t;
  const u = b.e(span > 0 ? Math.min(1, (t - a.t) / span) : 1);
  const pa = a.p;
  const pb = b.p;
  for (let k = 0; k < CH; k++) out[k] = pa[k] + (pb[k] - pa[k]) * u;
  return out;
}

export function blend(a, b, t, out) {
  for (let k = 0; k < CH; k++) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export function addScaled(out, add, ref, w) {
  // out += (add - ref) * w   (additive layering relative to a reference pose)
  for (let k = 0; k < CH; k++) out[k] += (add[k] - ref[k]) * w;
  return out;
}

/** Plays clips with cross fading. One per fighter. */
export class Animator {
  constructor() {
    this.cur = null;
    this.t = 0;
    this.speed = 1;
    this.pose = new Float32Array(CH);
    this.from = new Float32Array(CH);
    this.tmp = new Float32Array(CH);
    this.fade = 1;
    this.fadeDur = 0;
    this.ground = 1;
    this.groundFrom = 1;
  }
  play(c, fade = 0.1, restart = true, startTime = 0) {
    if (!c) return;
    if (this.cur === c && !restart) return;
    this.from.set(this.pose);
    this.groundFrom = this.ground;
    this.cur = c;
    this.t = startTime;
    this.fade = fade > 0 ? 0 : 1;
    this.fadeDur = fade;
  }
  update(dt) {
    if (!this.cur) return this.pose;
    this.t += dt * this.speed;
    sample(this.cur, this.t, this.tmp);
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / this.fadeDur);
      const u = Ease.out(this.fade);
      blend(this.from, this.tmp, u, this.pose);
      this.ground = this.groundFrom + (this.cur.ground - this.groundFrom) * u;
    } else {
      this.pose.set(this.tmp);
      this.ground = this.cur.ground;
    }
    return this.pose;
  }
  get done() {
    return this.cur && !this.cur.loop && this.t >= this.cur.dur;
  }
}
