import { lerp, rand, chance, pick, clamp } from '../engine/utils.js';

const PREF_RANGE = { vanguard: 1.55, bastion: 1.35, wraith: 1.6, tempest: 2.5 };

/**
 * Drives a Fighter through the same control interface as the player.
 * level: 0 (training dummy that occasionally swings) … 1 (frame-perfect menace)
 */
export class AIController {
  constructor(fight, f, level) {
    this.F = fight;
    this.level = clamp(level, 0, 1);
    const L = this.level;
    this.reaction = lerp(0.46, 0.09, L);
    this.blockChance = lerp(0.08, 0.78, L);
    this.parryChance = lerp(0, 0.22, Math.max(0, L - 0.25) / 0.75);
    this.aggression = lerp(0.3, 0.92, L);
    this.specialUse = lerp(0.06, 0.6, L);
    this.punish = lerp(0.1, 0.95, L);
    this.antiAir = lerp(0.05, 0.8, L);
    this.thinkT = rand(0.2, 0.6);
    this.queue = [];
    this.queueT = 0;
    this.blockFrom = -1;
    this.blockUntil = -1;
    this.seenMove = null;
    this.seenProj = new WeakSet();
    this.moveDir = 0;
    this.moveUntil = 0;
    this.holdHeavyUntil = -1;
    this.blockedStreak = 0;
    this.idleUntil = 0;
    this.pref = PREF_RANGE[f.chassis] ?? 1.5;
  }

  press(f, step) {
    // translate a combo step into control state + a buffered press
    const c = f.ctl;
    c.down = false;
    switch (step) {
      case 'light': f.press('light'); break;
      case 'heavy': f.press('heavy'); break;
      case 'charge':
        f.press('heavy');
        this.holdHeavyUntil = this.F.simTime + 0.75;
        break;
      case 'launcher': c.down = true; f.press('heavy'); this.downUntil = this.F.simTime + 0.15; break;
      case 'spN': c.mx = 0; this.moveUntil = this.F.simTime + 0.1; this.moveDir = 0; f.press('special'); break;
      case 'spF': c.mx = f.facing; this.moveDir = f.facing; this.moveUntil = this.F.simTime + 0.15; f.press('special'); break;
      case 'spD': c.down = true; this.downUntil = this.F.simTime + 0.15; f.press('special'); break;
      case 'overdrive': f.press('overdrive'); break;
      case 'jump': c.mx = f.facing; this.moveDir = f.facing; this.moveUntil = this.F.simTime + 0.35; f.press('jump'); break;
      case 'dashF': c.mx = f.facing; f.press('dash'); break;
      case 'dashB': c.mx = -f.facing; this.moveDir = -f.facing; this.moveUntil = this.F.simTime + 0.1; f.press('dash'); break;
      default: break;
    }
  }

  canAfford(f, id) {
    const m = f.moves[id];
    return m && f.energy >= (m.cost || 0) * (1 - Math.min(0.6, f.fx.specialCost || 0));
  }

  pickSpecial(f, d) {
    const opts = [];
    for (const id of ['spN', 'spF', 'spD']) {
      const m = f.moves[id];
      if (!m || !m.ai || !this.canAfford(f, id)) continue;
      if (d >= m.ai[0] && d <= m.ai[1]) opts.push(id);
    }
    return opts.length ? pick(opts) : null;
  }

  buildCombo(f, foe) {
    const L = this.level;
    const od = f.meter >= 100;
    const stunned = foe.state === 'stunned';
    const r = Math.random();
    let q;
    if (L < 0.2) q = r < 0.6 ? ['light'] : ['light', 'light'];
    else if (L < 0.45) q = r < 0.35 ? ['light', 'light'] : r < 0.7 ? ['light', 'light', 'light'] : r < 0.85 ? ['heavy'] : ['light', 'light', 'heavy'];
    else if (L < 0.7) {
      q = r < 0.3 ? ['light', 'light', 'light'] : r < 0.55 ? ['light', 'light', 'heavy'] : r < 0.75 ? ['light', 'light', 'heavy', 'sp'] : r < 0.9 ? ['launcher', 'jump', 'airL'] : ['heavy', 'sp'];
    } else {
      q = r < 0.22 ? ['light', 'light', 'light', 'sp'] : r < 0.44 ? ['light', 'light', 'heavy', 'sp'] : r < 0.64 ? ['light', 'light', 'launcher', 'jump', 'airL', 'airH'] : r < 0.8 ? ['launcher', 'jump', 'airL', 'airH'] : r < 0.9 ? ['heavy', 'sp'] : ['light', 'light', 'light'];
    }
    if (stunned && L > 0.3) q = L > 0.6 ? ['heavy', 'sp'] : ['light', 'light', 'heavy'];
    if (stunned && L > 0.5 && chance(0.5)) q = ['light', 'light', 'launcher', 'jump', 'airL', 'airH'];
    if (od && L > 0.2 && chance(0.4 + L * 0.5)) {
      // end the string with the ultimate
      const i = q.indexOf('sp');
      if (i >= 0) q[i] = 'overdrive';
      else if (q.length <= 3 && !q.includes('launcher')) q.push('overdrive');
    }
    return q;
  }

  update(f, dt) {
    const F = this.F;
    const foe = f.foe;
    const c = f.ctl;
    const now = F.simTime;
    const d = Math.abs(foe.x - f.x);
    const L = this.level;
    c.block = false;
    c.heavyHeld = now < this.holdHeavyUntil;
    c.down = now < (this.downUntil ?? -1);
    c.mx = now < this.moveUntil ? this.moveDir : 0;
    if (f.dead || !F.live) return;

    // armour purge as a combo breaker / escape from a guard break
    if (f.plates > 0 && f.purgeCd <= 0 && L > 0.15) {
      const caught = (f.state === 'hitstun' || f.state === 'launched') && f.comboHits >= (L > 0.6 ? 3 : 4);
      const broken = f.state === 'stunned' && d < 3.2;
      const dying = f.hp / f.hpMax < 0.3 && f.plates >= 3 && (f.state === 'hitstun' || f.state === 'launched');
      if ((caught || broken || dying) && chance(dt * (2 + L * 9))) {
        f.press('purge');
        return;
      }
    }
    // step out of telegraphed arena hazards
    const dz = F.danger;
    if (dz && f.neutral && f.x > dz.x0 - 0.3 && f.x < dz.x1 + 0.3 && L > 0.2 && now >= this.moveUntil) {
      const mid = (dz.x0 + dz.x1) / 2;
      let dir = f.x >= mid ? 1 : -1;
      if ((dir > 0 && dz.x1 > 8) || (dir < 0 && dz.x0 < -8)) dir = -dir; // don't run into the wall
      this.moveDir = dir;
      this.moveUntil = now + 0.35;
      if (f.dashCd <= 0 && chance(0.3 + L * 0.4)) { c.mx = dir; f.press('dash'); }
    }

    // ------------------------------------------------ react to enemy attacks
    const fm = foe.state === 'attack' ? foe.move : null;
    if (fm && fm !== this.seenMove) {
      this.seenMove = fm;
      this.blockFrom = -1;
      const reach = fm.hits.length ? Math.max(...fm.hits.map((h) => Math.max(Math.abs(h.x0), Math.abs(h.x1)))) * foe.scale + 1.6 : 0;
      const threatening = fm.hits.length && d < reach + (fm.vel ? 3.5 : 0);
      if (threatening && (f.neutral || f.state === 'block' || f.state === 'blockstun')) {
        const first = fm.hits[0];
        const tti = Math.max(0, first.t0 - foe.moveT);
        const last = fm.hits[fm.hits.length - 1].t1 - foe.moveT;
        const roll = Math.random();
        const notice = this.reaction * 0.55;
        if (tti >= notice * 0.6 || f.state === 'block' || f.state === 'blockstun') {
          if (fm.type === 'overdrive' && L > 0.5 && chance(0.5) && f.dashCd <= 0) {
            this.press(f, 'dashB');
          } else if (roll < this.parryChance) {
            this.blockFrom = now + Math.max(0, tti - 0.07);
            this.blockUntil = now + last + 0.12;
          } else if (roll < this.blockChance) {
            this.blockFrom = now + Math.min(tti * 0.5, notice);
            this.blockUntil = now + last + 0.14;
          } else if (roll < this.blockChance + 0.1 * L && f.dashCd <= 0 && tti > 0.12) {
            this.press(f, 'dashB');
          }
        }
      }
    } else if (!fm) this.seenMove = null;
    // a visibly charging heavy can't be blocked: get out
    if (fm && foe.chargeT > 0.25 && L > 0.35 && d < 3 && f.neutral && f.dashCd <= 0 && chance(dt * 6)) {
      this.blockUntil = -1;
      this.press(f, 'dashB');
    }
    // incoming projectiles
    for (const p of F.projectiles) {
      if (p.owner === f || p.dead || this.seenProj.has(p)) continue;
      const dx = f.x - p.x;
      if (Math.sign(dx) !== Math.sign(p.vx) && p.kind !== 'orb') continue;
      const tti = (Math.abs(dx) - 0.6) / Math.max(1, Math.abs(p.vx));
      if (tti < 0.42) {
        this.seenProj.add(p);
        const roll = Math.random();
        if (roll < this.parryChance * 0.8) {
          this.blockFrom = now + Math.max(0, tti - 0.07);
          this.blockUntil = now + tti + 0.25;
        } else if (roll < this.blockChance + 0.1) {
          this.blockFrom = now;
          this.blockUntil = now + tti + (p.multi > 1 ? 1.0 : 0.25);
        } else if (roll < this.blockChance + 0.25 && f.neutral && p.kind !== 'orb') {
          this.press(f, 'jump');
          this.moveDir = 0;
        }
      }
    }
    if (now >= this.blockFrom && now < this.blockUntil && this.blockFrom >= 0) {
      if (f.neutral || f.state === 'block' || f.state === 'blockstun') {
        c.block = true;
        c.mx = 0;
        if (f.buf && f.buf !== 'dash') f.buf = null;
        return;
      }
    }

    // ------------------------------------------------ continue combos
    if (this.queue.length) {
      this.queueT -= dt;
      const next = this.queue[0];
      if (f.state === 'attack' && f.move) {
        const m = f.move;
        const firstEnd = m.hits[0] ? m.hits[0].t1 : 0.15;
        const chain = next === 'light' && m.type === 'light' && m.chain;
        if (f.moveT >= firstEnd - 0.03 && !f.buf) {
          if (f.hitConfirmed || (chain && (L < 0.5 || chance(0.5)))) {
            let step = this.queue.shift();
            if (step === 'sp') step = this.pickSpecial(f, d) || (this.queue.length = 0, null);
            if (step && !(step === 'airL' || step === 'airH')) this.press(f, step);
            else if (step) this.queue.unshift(step);
          } else if (f.moveT > firstEnd + 0.06) {
            // whiffed or blocked: bail (sometimes crush the guard instead)
            const blocked = foe.state === 'blockstun' || foe.state === 'block';
            this.queue.length = 0;
            if (blocked) {
              this.blockedStreak++;
              if (L > 0.45 && chance(0.25 + this.blockedStreak * 0.15)) { this.queue = ['charge']; this.queueT = 1; this.blockedStreak = 0; }
            }
          }
        }
      } else if (f.state === 'jump' && (next === 'airL' || next === 'airH')) {
        if (d < 2.2 && Math.abs(foe.y - f.y) < 1.6 && f.stateT > 0.1) {
          this.queue.shift();
          f.press(next === 'airL' ? 'light' : 'heavy');
        } else if (f.vy < -4) this.queue.length = 0;
        c.mx = f.facing;
      } else if (f.neutral) {
        if (next === 'charge' || this.queueT > 0) {
          const step = this.queue.shift();
          if (d < 2.4) this.press(f, step === 'sp' ? this.pickSpecial(f, d) || 'light' : step);
          else this.queue.length = 0;
        } else this.queue.length = 0;
      } else if (f.state !== 'jump' && f.state !== 'dash') this.queue.length = 0;
      return;
    }

    if (!f.neutral) {
      // air options
      if (f.state === 'jump' && !f.buf && d < 2.3 && f.vy < 2 && chance(dt * 8 * this.aggression)) f.press(chance(0.5) ? 'heavy' : 'light');
      return;
    }

    // ------------------------------------------------ neutral decisions
    this.thinkT -= dt;
    // spacing every frame
    if (now >= this.moveUntil) {
      if (now < this.idleUntil) c.mx = 0;
      else if (d > this.pref + 0.25) c.mx = f.facing;
      else if (d < this.pref - 0.55 && f.chassis === 'tempest') c.mx = -f.facing;
      else c.mx = 0;
    }
    if (this.thinkT > 0) return;
    this.thinkT = this.reaction * rand(0.7, 1.5);

    const foeVuln = foe.state === 'stunned' || (foe.state === 'attack' && foe.move && foe.moveT > foe.lastHitEnd() + 0.02 && foe.move.dur - foe.moveT > 0.12);
    const foeAir = foe.airborne && foe.state !== 'launched';
    const range = (f.moves.light1.hits[0].x1 + 0.35) * f.scale + foe.width;

    // punish openings
    if (foeVuln && d < range + 0.3 && chance(this.punish)) {
      this.queue = this.buildCombo(f, foe);
      this.queueT = 0.5;
      this.press(f, this.queue.shift());
      return;
    }
    if (foe.state === 'stunned' && d >= range) {
      c.mx = f.facing; this.moveDir = f.facing; this.moveUntil = now + 0.25;
      if (d > 3 && f.dashCd <= 0) this.press(f, 'dashF');
      return;
    }
    // anti air
    if (foeAir && d < 2.2 && foe.vy < 2 && chance(this.antiAir)) {
      this.queue = L > 0.6 ? ['jump', 'airL', 'airH'] : [];
      this.press(f, 'launcher');
      this.queueT = 0.6;
      return;
    }
    // ultimate from neutral
    if (f.meter >= 100 && d >= f.moves.overdrive.ai[0] && d <= f.moves.overdrive.ai[1] * 0.8 && chance(0.12 + L * 0.2) && !foe.invulnerable && foe.state !== 'block') {
      this.press(f, 'overdrive');
      return;
    }
    // random hesitation makes weak opponents readable
    if (chance(lerp(0.45, 0.04, L))) {
      this.idleUntil = now + rand(0.3, 0.9);
      return;
    }
    if (d <= range) {
      if (chance(this.aggression)) {
        if (foe.state === 'block' && L > 0.4 && chance(0.3)) { this.press(f, 'charge'); return; }
        this.queue = this.buildCombo(f, foe);
        this.queueT = 0.5;
        this.press(f, this.queue.shift());
      } else if (chance(0.3) && f.dashCd <= 0) {
        this.press(f, 'dashB');
      } else if (chance(0.25 * L)) {
        const sp = this.pickSpecial(f, d);
        if (sp) this.press(f, sp);
      }
      return;
    }
    // mid / long range
    if (chance(this.specialUse)) {
      const sp = this.pickSpecial(f, d);
      if (sp) { this.press(f, sp); return; }
    }
    if (d > 3.2 && f.dashCd <= 0 && chance(this.aggression * 0.5)) { this.press(f, 'dashF'); return; }
    if (d > 2.2 && d < 4.6 && chance(0.1 + this.aggression * 0.12)) {
      this.queue = ['airH'];
      this.queueT = 1;
      this.press(f, 'jump');
      return;
    }
    if (f.chassis === 'tempest' && d < 1.6 && f.dashCd <= 0 && chance(0.4)) this.press(f, 'dashB');
  }
}

export function aiLevelFor(enemyLevel, boss = false) {
  return clamp(0.05 + ((enemyLevel - 1) / 16) * 0.74 + (boss ? 0.05 : 0), 0, 0.9);
}
