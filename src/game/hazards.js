import { rand, randSign, clamp, chance } from '../engine/utils.js';
import { STAGE_HALF } from './fighter.js';

const v3 = (x, y, z = 0) => ({ x, y, z });

/**
 * Every arena has one signature event that periodically changes the fight.
 * A hazard cycles idle → warn (telegraph) → active → idle.
 */
const DEFS = {
  // molten slag is dumped from the crucible onto a marked spot
  foundry: {
    name: 'SLAG POUR', color: 0xff8a2a, first: 9, period: [11, 15], warn: 1.5, active: 0.5,
    pick(F) {
      const t = F.fighters[Math.random() < 0.5 ? 0 : 1];
      const x = clamp(t.x + rand(-1.2, 1.2), -STAGE_HALF + 1, STAGE_HALF - 1);
      return { x, x0: x - 1.2, x1: x + 1.2 };
    },
    warnTick(F, z, u) {
      F.fx.ring(v3(z.x, 0.04), { color: 0xff8a2a, r0: 2.2 - u * 0.9, r1: 1.2, dur: 0.3, ground: true, width: 0.07, ease: (t) => t, alpha: 0.5 + u * 0.5 });
      for (let i = 0; i < 3; i++) {
        F.fx.add.spawn(z.x + rand(-0.5, 0.5), rand(7, 10), rand(-0.3, 0.3), 0, -rand(9, 14), 0, { color: 0xffe0a0, color2: 0xff5a10, intensity: 3, life: 0.7, size: 0.05, size1: 0.02, kind: 1, stretch: 0.06, gravity: 8, floor: true });
      }
    },
    start(F, z) {
      F.fx.beam(v3(z.x, 11.5, -0.2), v3(z.x, 0, -0.2), { color: 0xff7a1e, width: 2.0, dur: 0.6, intensity: 1.1 });
      F.fx.pillar(z.x, { color: 0xff8a2a, width: 1.15, height: 11, dur: 0.6 });
      F.fx.groundSlam(z.x, 0xff8a2a, 1.1);
      F.fx.crack(z.x, 3.4, 0xff6a10, 7);
      F.fx.smoke(v3(z.x, 0.4), { count: 10, size: 0.9, alpha: 0.35, speed: 3, life: 1.4 });
      F.shake(0.9);
      F.sfx('explosion');
      for (const f of F.fighters) {
        if (Math.abs(f.x - z.x) < 1.2 + f.width * 0.5 && f.y < 4) {
          if (F.hazardHit(f, { dmg: 12, level: 3, kbx: 4.5, kby: 9, stun: 0.5, block: 0.3, guard: 30, pause: 0.12, fx: 'hit' }, z.x, 0xff8a2a)) {
            f.burnT = 3;
            f.burnDps = 2;
          }
        }
      }
    },
  },
  // one end of the rooftop rail arcs with lethal current
  skydeck: {
    name: 'RAIL OVERLOAD', color: 0xff4fd8, first: 10, period: [13, 17], warn: 1.6, active: 1.5, tick: 0.36,
    pick() {
      const side = randSign();
      const x0 = side > 0 ? STAGE_HALF - 3.4 : -STAGE_HALF - 0.6;
      return { side, x0, x1: x0 + 4, x: x0 + 2 };
    },
    warnTick(F, z, u) {
      const a = v3(rand(z.x0, z.x1), 0.03), b = v3(rand(z.x0, z.x1), rand(0.1, 0.5 + u));
      F.fx.lightning(a, b, { color: 0xff4fd8, dur: 0.12, width: 0.04, jitter: 0.25 });
      F.fx.ring(v3(z.x, 0.04), { color: 0xff4fd8, r0: 2.0, r1: 2.05, dur: 0.3, ground: true, width: 0.04, alpha: 0.4 + u * 0.6, squash: 1 });
    },
    start(F) {
      F.sfx('thunder');
      F.shake(0.5);
    },
    activeTick(F, z) {
      for (let i = 0; i < 3; i++) {
        const x = rand(z.x0 + 0.3, z.x1 - 0.3);
        F.fx.lightning(v3(x + rand(-0.6, 0.6), rand(5, 9)), v3(x, 0), { color: i ? 0xff4fd8 : 0xffffff, width: 0.16, dur: 0.2, branches: 1, jitter: 0.5 });
        F.fx.pillar(x, { color: 0xff4fd8, width: 0.5, height: 5, dur: 0.3 });
      }
      F.fx.light(v3(z.x, 1.5), 0xff4fd8, 60, 0.25, 12);
      F.sfx('zap');
      for (const f of F.fighters) {
        if (f.x > z.x0 && f.x < z.x1 && f.y < 1.6) {
          F.hazardHit(f, { dmg: 4, level: 2, kbx: 3.5, kby: 0, stun: 0.4, block: 0.22, guard: 12, pause: 0.04, fx: 'shock' }, z.side * (STAGE_HALF + 2), 0xff4fd8);
        }
      }
    },
  },
  // a floor vent floods a zone with cryo fog: no damage, but it slows and stalls energy
  cryo: {
    name: 'CRYO VENT', color: 0x7fdcff, first: 9, period: [12, 16], warn: 1.2, active: 5, tick: 0.08,
    pick() {
      const x = rand(-4.5, 4.5);
      return { x, x0: x - 2.3, x1: x + 2.3 };
    },
    warnTick(F, z) {
      F.fx.ring(v3(z.x, 0.04), { color: 0x7fdcff, r0: 0.4, r1: 2.4, dur: 0.45, ground: true, width: 0.06, alpha: 0.6 });
      F.fx.alpha.spawn(z.x + rand(-1.5, 1.5), 0.1, rand(-0.4, 0.4), rand(-0.5, 0.5), rand(1, 2.5), 0, { color: 0xdff4ff, color2: 0x9fc8de, life: 0.9, size: 0.4, size1: 1.2, kind: 2, drag: 1.5, gravity: -0.5, alpha: 0.25 });
    },
    start(F, z) {
      F.sfx('piston');
      F.fx.ring(v3(z.x, 0.05), { color: 0xdff4ff, r0: 0.3, r1: 3.2, dur: 0.5, ground: true, width: 0.12 });
    },
    activeTick(F, z) {
      for (let i = 0; i < 2; i++) {
        F.fx.alpha.spawn(rand(z.x0, z.x1), rand(0.1, 0.5), rand(-0.7, 0.7), rand(-0.6, 0.6), rand(0.4, 1.6), rand(-0.2, 0.2), { color: 0xe6f6ff, color2: 0xa8cce0, life: rand(1.2, 2), size: rand(0.7, 1.1), size1: rand(1.8, 2.6), kind: 2, drag: 1.2, gravity: -0.15, alpha: 0.2, rotVel: rand(-0.6, 0.6) });
      }
      F.fx.add.spawn(rand(z.x0, z.x1), rand(0.1, 2.4), rand(-0.6, 0.6), rand(-0.3, 0.3), rand(0.2, 0.8), 0, { color: 0xdff4ff, intensity: 1.6, life: 1.1, size: 0.05, size1: 0, kind: 0 });
      for (const f of F.fighters) {
        if (f.x > z.x0 && f.x < z.x1 && f.y < 2.2 && !f.dead) {
          if (f.chillT <= 0) F.hud.popup('CHILLED', f.x, f.y + f.height + 0.3, 'chill');
          f.chillT = 0.3;
        }
      }
    },
  },
  // the station's spin stutters: gravity drops and every launch goes sky high
  orbital: {
    name: 'GRAVITY FLUX', color: 0xffd76a, first: 11, period: [13, 17], warn: 1.5, active: 5.5, tick: 0.1,
    pick() {
      return { x: 0, x0: -99, x1: -99 };
    },
    warnTick(F) {
      F.fx.ring(v3(rand(-7, 7), 0.04), { color: 0xffd76a, r0: 0.2, r1: 1.4, dur: 0.5, ground: true, width: 0.05, alpha: 0.5 });
    },
    start(F) {
      F.gravityScale = F.baseGravity * 0.38;
      F.sfx('magnet');
      F.fx.ring(v3(0, 0.05), { color: 0xffd76a, r0: 1, r1: 14, dur: 0.9, ground: true, width: 0.05 });
    },
    activeTick(F) {
      F.fx.add.spawn(rand(-9, 9), rand(0, 0.4), rand(-3, 2), 0, rand(1.5, 4), 0, { color: 0xffe9a8, intensity: 1.8, life: rand(0.8, 1.6), size: rand(0.03, 0.06), size1: 0, kind: 1, stretch: 0.08, gravity: -1 });
    },
    end(F) {
      F.gravityScale = F.baseGravity;
      F.fx.ring(v3(0, 0.05), { color: 0xffd76a, r0: 12, r1: 1, dur: 0.6, ground: true, width: 0.05, ease: (t) => t });
    },
  },
};

export class Hazard {
  constructor(fight, arenaId) {
    this.F = fight;
    this.def = DEFS[arenaId] || null;
    this.reset();
  }

  get name() {
    return this.def ? this.def.name : '';
  }

  reset() {
    const d = this.def;
    if (this.phase === 'active' && d && d.end) d.end(this.F, this.zone);
    this.phase = 'idle';
    this.t = d ? d.first : Infinity;
    this.zone = null;
    this.tickT = 0;
    this.F.danger = null;
  }

  update(dt) {
    const d = this.def;
    const F = this.F;
    if (!d || !F.live) return;
    this.t -= dt;
    this.tickT -= dt;
    if (this.phase === 'idle') {
      if (this.t <= 0) {
        this.phase = 'warn';
        this.t = d.warn;
        this.zone = d.pick(F);
        F.danger = { x0: this.zone.x0, x1: this.zone.x1 };
        F.hud.hazard(d.name, d.color);
        F.sfx('alarm');
      }
    } else if (this.phase === 'warn') {
      if (this.tickT <= 0) {
        this.tickT = 0.09;
        d.warnTick?.(F, this.zone, 1 - this.t / d.warn);
      }
      if (this.t <= 0) {
        this.phase = 'active';
        this.t = d.active;
        this.tickT = 0;
        d.start?.(F, this.zone);
      }
    } else {
      if (d.activeTick && this.tickT <= 0) {
        this.tickT = d.tick ?? 0.1;
        d.activeTick(F, this.zone);
      }
      if (this.t <= 0) {
        d.end?.(F, this.zone);
        this.phase = 'idle';
        this.t = rand(d.period[0], d.period[1]);
        this.zone = null;
        F.danger = null;
      }
    }
  }
}

export const HAZARD_INFO = {
  foundry: 'SLAG POUR — molten slag crashes onto a marked spot. Get off the ring.',
  skydeck: 'RAIL OVERLOAD — one end of the roof arcs with current. Hold the centre.',
  cryo: 'CRYO VENT — freezing fog slows movement and stalls energy inside it.',
  orbital: 'GRAVITY FLUX — gravity drops for a few seconds. Launches fly much higher.',
};
