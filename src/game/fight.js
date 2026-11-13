import * as THREE from 'three';
import { Fighter, STAGE_HALF } from './fighter.js';
import { AIController } from './ai.js';
import { FX } from '../engine/fx.js';
import { createArena } from './arenas.js';
import { computeStats } from './profile.js';
import { CHASSIS, MODIFIERS } from './data.js';
import { clamp, damp, lerp, rand, noise1, Ease, TAU } from '../engine/utils.js';

const SUB = 1 / 120;
const _v = new THREE.Vector3();
const v3 = (x, y, z = 0) => ({ x, y, z });

class PlayerController {
  constructor(input) {
    this.input = input;
  }
  update(f) {
    const inp = this.input;
    f.ctl.mx = inp.axisX();
    f.ctl.down = inp.held('down');
    f.ctl.block = inp.held('block');
    f.ctl.heavyHeld = inp.held('heavy');
    for (const a of inp.takePresses()) {
      if (a === 'light' || a === 'heavy' || a === 'special' || a === 'overdrive' || a === 'jump' || a === 'dash') f.press(a);
    }
  }
}

export class Fight {
  /**
   * cfg: { p1, p2 (loadouts), arena, rounds, modifier, aiLevel, stageId, onEnd, demo }
   */
  constructor(app, cfg) {
    this.app = app;
    this.cfg = cfg;
    this.R = app.renderer;
    this.audio = app.audio;
    this.hud = app.hud;
    this.arena = createArena(cfg.arena, this.R);
    this.scene = this.arena.scene;
    this.fx = new FX(this.scene, this.R.quality.particles);
    this.camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 400);
    this.R.setScene(this.scene, this.camera);

    this.gravityScale = 1;
    this.energyMul = 1;
    this.damageMul = 1;
    this.meterMul = 1;
    this.roundsToWin = cfg.rounds ?? 2;
    const mod = cfg.modifier;
    if (mod === 'overcharged') this.energyMul = 2;
    if (mod === 'lowgrav') this.gravityScale = 0.6;
    if (mod === 'sudden') { this.damageMul = 1.5; this.roundsToWin = 1; }
    if (mod === 'nometer') this.meterMul = 0.5;

    const s1 = computeStats(cfg.p1.chassis, cfg.p1.mods, cfg.p1.perks || []);
    const s2 = computeStats(cfg.p2.chassis, cfg.p2.mods, cfg.p2.perks || [], { level: cfg.p2.level, boss: cfg.p2.boss });
    this.fighters = [];
    this.fighters.push(new Fighter(this, 0, cfg.p1, s1));
    this.fighters.push(new Fighter(this, 1, cfg.p2, s2));
    if (mod === 'armored') this.fighters[1].modArmor = true;

    this.controllers = [
      cfg.demo ? new AIController(this, this.fighters[0], cfg.demoLevel ?? 0.6) : new PlayerController(app.input),
      new AIController(this, this.fighters[1], cfg.aiLevel ?? 0.4),
    ];

    this.projectiles = [];
    this.traps = [];
    this.decoys = [];
    this.timers = [];
    this.simTime = 0;
    this.realTime = 0;
    this.hitstop = 0;
    this.timeScale = 1;
    this.slowT = 0;
    this.slowScale = 1;
    this.cine = null;
    this.trauma = 0;
    this.camPos = new THREE.Vector3(0, 2.2, 13);
    this.camLook = new THREE.Vector3(0, 1.4, 0);
    this.camKick = 0;
    this.camFocus = null;
    this.live = false;
    this.round = 0;
    this.phase = 'boot';
    this.phaseT = 0;
    this.timer = 60;
    this.paused = false;
    this.ended = false;
    this.stats = { maxCombo: 0, dmgDealt: 0, dmgTaken: 0, parries: 0, roundsLost: 0, perfectRounds: 0, lastHpPct: 1 };
    this.combo = [{ hits: 0, dmg: 0 }, { hits: 0, dmg: 0 }]; // combo performed BY fighter idx

    this.hud.showFight(this);
    this.startRound(true);
  }

  foe(f) {
    return this.fighters[1 - f.idx];
  }

  sfx(name, opts) {
    this.audio.play(name, opts);
  }

  shake(amount) {
    this.trauma = Math.min(1.6, this.trauma + amount * (this.app.profile.data.settings.shake ?? 1));
  }

  after(delay, fn) {
    this.timers.push({ t: this.simTime + delay, fn });
  }

  slowmo(scale, dur) {
    this.slowScale = scale;
    this.slowT = dur;
  }

  // -------------------------------------------------------------------------
  // round flow
  // -------------------------------------------------------------------------
  startRound(first = false) {
    this.round++;
    const [a, b] = this.fighters;
    a.reset(-2.6, 1);
    b.reset(2.6, -1);
    if (this.cfg.modifier === 'frenzy') b.meter = 100;
    this.clearEntities();
    this.timer = 60;
    this.live = false;
    this.roundDamageTaken = 0;
    this.combo[0].hits = this.combo[1].hits = 0;
    this.hud.setRounds(a.wins, b.wins, this.roundsToWin);
    this.R.setDesat(0);
    this.cine = null;
    this.camFocus = null;
    this.hud.letterbox(false);
    if (first) {
      this.phase = 'intro';
      this.phaseT = 0;
      for (const f of this.fighters) {
        f.setState('intro');
        f.animator.play(f.anims.intro, 0);
      }
      this.R.setFade(1);
      this.R.fadeTo(0, 1.6);
      this.sfx('intro');
    } else {
      this.phase = 'ready';
      this.phaseT = 0;
      this.R.fadeTo(0, 3);
      this.announceRound();
    }
  }

  announceRound() {
    const final = this.fighters[0].wins === this.roundsToWin - 1 && this.fighters[1].wins === this.roundsToWin - 1 && this.roundsToWin > 1;
    this.hud.announce(final ? 'FINAL ROUND' : `ROUND ${this.round}`, '', 'round', 1.1);
    this.sfx('round');
  }

  clearEntities() {
    for (const p of this.projectiles) this.killProjectile(p, false);
    this.projectiles.length = 0;
    this.traps.length = 0;
    this.decoys.length = 0;
    this.timers.length = 0;
  }

  updatePhase(dt) {
    this.phaseT += dt;
    const [a, b] = this.fighters;
    switch (this.phase) {
      case 'intro':
        if (this.phaseT > 0.4 && !this._introShown) {
          this._introShown = true;
          this.hud.versus(a.name, b.name, this.cfg.subtitle || '');
        }
        if (this.phaseT > 2.4 || (this.phaseT > 0.6 && this.app.input.anyPressed())) {
          for (const f of this.fighters) {
            f.setState('idle');
            f.play('idle', 0.2);
          }
          this.phase = 'ready';
          this.phaseT = 0;
          this.announceRound();
        }
        break;
      case 'ready':
        if (this.phaseT > 1.25) {
          this.phase = 'fight';
          this.phaseT = 0;
          this.live = true;
          this.hud.announce('FIGHT!', '', 'fight', 0.8);
          this.sfx('fight');
          this.R.kickAberration(0.012);
        }
        break;
      case 'fight':
        this.timer -= dt * (this.hitstop > 0 ? 0 : 1);
        if (this.timer <= 0) {
          this.timer = 0;
          this.endRound(a.hp / a.hpMax >= b.hp / b.hpMax ? a : b, true);
        }
        break;
      case 'ko':
        if (this.phaseT > 3.4) this.finishRound();
        else if (this.phaseT > 1.5 && !this._victoryPlayed) {
          this._victoryPlayed = true;
          const w = this.roundWinner;
          if (w && !w.dead && w.grounded) {
            w.setState('victory');
            w.play('victory', 0.25);
            w.glowBoost = 2;
            this.camFocus = { f: w, t: 99 };
          }
          const l = this.foe(w);
          if (!l.dead && l.grounded) {
            l.setState('defeat');
            l.play('defeat', 0.4);
          }
        } else if (this.phaseT > 2.9) this.R.fadeTo(1, 2.5);
        break;
      default:
        break;
    }
  }

  endRound(winner, timeUp = false) {
    if (this.phase !== 'fight') return;
    this.phase = 'ko';
    this.phaseT = 0;
    this.live = false;
    this._victoryPlayed = false;
    this.roundWinner = winner;
    winner.wins++;
    const playerWon = winner.idx === 0;
    const p = this.fighters[0];
    if (!playerWon) this.stats.roundsLost++;
    const perfect = playerWon && p.hp >= p.hpMax - 0.5;
    if (perfect) this.stats.perfectRounds++;
    this.stats.lastHpPct = p.hp / p.hpMax;
    this.hud.setRounds(this.fighters[0].wins, this.fighters[1].wins, this.roundsToWin);
    for (const f of this.fighters) f.ctl.mx = 0, f.ctl.block = false;
    if (timeUp) {
      this.hud.announce('TIME UP', '', 'ko', 2.2);
      this.sfx('round');
    } else {
      this.hud.announce(perfect ? 'PERFECT' : 'K.O.', '', 'ko', 2.4);
      this.sfx('ko');
    }
  }

  finishRound() {
    const [a, b] = this.fighters;
    if (a.wins >= this.roundsToWin || b.wins >= this.roundsToWin) {
      this.endMatch(a.wins >= this.roundsToWin);
    } else {
      this.startRound(false);
    }
  }

  endMatch(playerWon) {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'over';
    const s = this.stats;
    let stars = 0;
    if (playerWon) {
      stars = 1;
      if (s.roundsLost === 0) stars++;
      if (s.lastHpPct >= 0.5) stars++;
    }
    this.cfg.onEnd?.({ won: playerWon, stars, maxCombo: s.maxCombo, perfect: s.perfectRounds > 0, parries: s.parries, dmgDealt: Math.round(s.dmgDealt), dmgTaken: Math.round(s.dmgTaken) });
  }

  // -------------------------------------------------------------------------
  // hooks from fighters
  // -------------------------------------------------------------------------
  onMoveStart(f, m) {
    if (m.type === 'special' || m.type === 'overdrive') {
      this.hud.moveName(f.idx, m.name, m.type === 'overdrive');
      f.glowBoost = 2;
    }
  }
  onNoEnergy(f) {
    if (f.idx === 0) {
      this.hud.flashEnergy(0);
      this.sfx('deny');
    }
  }
  onComboEnd(def) {
    const c = this.combo[1 - def.idx];
    if (c.hits > 1) this.hud.comboEnd(1 - def.idx, c.hits, c.dmg);
    c.hits = 0;
    c.dmg = 0;
  }
  onBarrierBreak(f) {
    const p = v3(f.x, f.y + f.height * 0.5);
    this.fx.hexShards(p, { color: f.color, count: 24, speed: 7 });
    this.fx.ring(p, { color: f.color, r0: 0.3, r1: 3, dur: 0.4 });
    this.sfx('guardBreak');
    this.hud.popup('BARRIER DOWN', f.x, f.y + f.height + 0.3, 'warn');
  }
  onSecondWind(f) {
    this.fx.pillar(f.x, { color: 0x7dff8a, width: 1.0, height: 4, dur: 0.6 });
    this.fx.motes({ x: f.x, y: f.y + 1, z: 0 }, { color: 0x7dff8a, count: 20, radius: 0.8, vy: 3 });
    this.hud.popup('SECOND WIND', f.x, f.y + f.height + 0.3, 'gold');
  }
  onRevive(f) {
    const p = v3(f.x, f.y + 1.2);
    this.fx.explosion(p, 0xffb637, 1.3);
    this.fx.pillar(f.x, { color: 0xffb637, width: 1.8, height: 10, dur: 0.9 });
    this.fx.dome(v3(f.x, 0), { color: 0xffb637, r0: 0.5, r1: 4.5, dur: 0.7 });
    this.shake(1.2);
    this.R.flash(0xffd080, 0.5);
    this.sfx('explosion');
    this.sfx('overdrive');
    this.hud.popup('PHOENIX PROTOCOL', f.x, f.y + f.height + 0.5, 'gold');
    this.hitstop = 0.3;
    const foe = this.foe(f);
    if (Math.abs(foe.x - f.x) < 4 && !foe.invulnerable) {
      foe.vx = (foe.x >= f.x ? 1 : -1) * 12;
      foe.vy = 8;
      foe.y = Math.max(foe.y, 0.02);
      foe.setState('launched');
      foe.animator.play(foe.anims.launched, 0.05);
    }
  }

  cinematic(f, dur) {
    this.cine = { f, t: dur, dur };
    this.hud.letterbox(true);
    this.sfx('overdrive');
    this.R.flash(f.color, 0.14);
    this.R.kickAberration(0.02);
    this.R.setDesat(0.55);
    this.fx.ring(v3(f.x, f.y + 1.2), { color: f.color, r0: 0.3, r1: 7, dur: 0.6, width: 0.08 });
    this.fx.flare(v3(f.x, f.y + 1.3), { color: f.color, size: 4, life: 0.25 });
    f.glowBoost = 2.5;
  }

  pull(f, strength, dt) {
    const foe = this.foe(f);
    if (foe.invulnerable || foe.dead) return;
    const tx = f.x + f.facing * 1.2;
    const d = tx - foe.x;
    if (Math.abs(d) > 0.15 && Math.abs(d) < 8) foe.x += Math.sign(d) * Math.min(Math.abs(d), strength * dt / foe.stats.weight);
  }

  // -------------------------------------------------------------------------
  // hits
  // -------------------------------------------------------------------------
  hurtbox(f) {
    const w = f.width;
    const lying = f.state === 'launched';
    return { x0: f.x - w, x1: f.x + w, y0: f.y + (lying ? 0.15 : 0.05), y1: f.y + f.height * (lying ? 0.7 : 1) };
  }

  areaHit(att, box, hit) {
    const def = this.foe(att);
    const hb = this.hurtbox(def);
    if (hb.x1 < box.x0 || hb.x0 > box.x1 || hb.y1 < box.y0 || hb.y0 > box.y1) return false;
    const res = this.resolveHit(att, def, hit, { remote: true, move: att.move, px: clamp((box.x0 + box.x1) / 2, hb.x0, hb.x1), py: clamp((box.y0 + box.y1) / 2, hb.y0 + 0.4, hb.y1 - 0.3) });
    return res && (res.type === 'hit' || res.type === 'armor');
  }

  checkMelee(att) {
    const m = att.move;
    if (att.state !== 'attack' || !m || att.landed) return;
    const def = this.foe(att);
    const t = att.moveT;
    for (let i = 0; i < m.hits.length; i++) {
      const h = m.hits[i];
      if (t < h.t0 || t > h.t1 || att.moveHit[i] >= 0) continue;
      const sc = att.scale;
      const xa = att.x + att.facing * h.x0 * sc, xb = att.x + att.facing * h.x1 * sc;
      const bx0 = Math.min(xa, xb), bx1 = Math.max(xa, xb);
      const by0 = att.y + h.y0 * sc, by1 = att.y + h.y1 * sc;
      const hb = this.hurtbox(def);
      if (hb.x1 < bx0 || hb.x0 > bx1 || hb.y1 < by0 || hb.y0 > by1) continue;
      const px = clamp(att.x + att.facing * Math.min(Math.abs(def.x - att.x), Math.max(h.x0, h.x1) * sc), hb.x0, hb.x1);
      const py = clamp((Math.max(by0, hb.y0) + Math.min(by1, hb.y1)) / 2, hb.y0 + 0.3, hb.y1 - 0.2);
      const res = this.resolveHit(att, def, h, { move: m, charged: att.charged, px, py });
      if (res) {
        att.moveHit[i] = t;
        if (res.type !== 'parry') att.hitConfirmed = true;
      }
    }
  }

  resolveHit(att, def, hit, o = {}) {
    const res = def.receive(att, hit, o);
    if (!res) return null;
    const dir = res.dir;
    const pos = v3(o.px ?? def.x - dir * def.width * 0.5, o.py ?? def.y + def.height * 0.6, 0.35);
    const lvl = hit.level || 1;
    const power = (lvl / 3) * (o.charged ? 1.3 : 1) * (res.crit ? 1.25 : 1);
    const fxKind = hit.fx || 'hit';
    const playerIsAtt = att.idx === 0;

    if (res.type === 'hit' || res.type === 'armor') {
      const col = fxKind === 'hit' ? 0xffc27a : att.color;
      this.fx.impact(pos, col, power * (res.type === 'armor' ? 0.5 : 1), dir);
      if (fxKind === 'slash') {
        this.fx.slash(pos, { color: 0xffffff, color2: att.color, radius: 0.9 + power * 1.3, a0: -1.2, a1: 1.2, rot: rand(TAU), dur: 0.2, thick: 0.18 });
      } else if (fxKind === 'shock') {
        for (let i = 0; i < 3 + lvl; i++) {
          this.fx.lightning(pos, v3(pos.x + rand(-1.3, 1.3) * (0.6 + power), pos.y + rand(-1.2, 1.4) * (0.6 + power)), { color: att.color, dur: 0.16, width: 0.06 });
        }
      } else {
        this.fx.sparks(pos, { count: 6 + lvl * 4, color: 0xffffff, color2: def.color, speed: 9, dir: [dir, 0.5, 0], spread: 0.7, size: 0.03 });
      }
      if (res.type === 'armor') {
        this.sfx('armor');
        this.hud.popup('ARMOR', def.x, def.y + def.height + 0.1, 'warn');
      } else this.sfx(lvl >= 3 ? 'hitHeavy' : lvl === 2 ? 'hitMedium' : 'hitLight', { power });
      this.hitstop = Math.max(this.hitstop, (hit.pause ?? 0.06) * (res.crit ? 1.35 : 1) * (o.charged ? 1.3 : 1));
      this.shake(0.12 + lvl * 0.14 + (o.charged ? 0.3 : 0));
      this.R.kickAberration(0.003 + lvl * 0.004);
      this.camKick = Math.max(this.camKick, lvl * 0.14);
      if (lvl >= 3 || res.crit) {
        const sp = this.project(pos);
        this.R.kickRadial(0.012 + (res.crit ? 0.012 : 0), sp.x, sp.y);
      }
      if ((o.charged || (res.crit && lvl >= 2)) && !res.ko) this.R.impactFrame(0.05, 0x05060a, att.color);

      // combos & hud
      const c = this.combo[att.idx];
      c.hits = def.comboHits;
      c.dmg = def.comboDmg;
      if (c.hits > 1) this.hud.combo(att.idx, c.hits, c.dmg);
      if (playerIsAtt) {
        this.stats.maxCombo = Math.max(this.stats.maxCombo, c.hits);
        this.stats.dmgDealt += res.dmg;
      } else {
        this.stats.dmgTaken += res.dmg;
      }
      this.hud.damage(res.dmg, pos.x + dir * 0.3, pos.y + 0.5, res.crit, att.idx);
      if (res.crit) this.hud.popup('CRITICAL', pos.x, pos.y + 1.0, 'crit');
      if (res.first) this.hud.popup('FIRST STRIKE', pos.x, pos.y + 1.3, 'gold');
      if (o.charged) this.hud.popup('GUARD CRUSH', pos.x, pos.y + 1.2, 'warn');
      if (res.ko) this.onKO(att, def, pos);
    } else if (res.type === 'block') {
      const sp = v3(def.x + def.facing * 0.55, pos.y, 0.4);
      this.fx.blockImpact(sp, def.color, power, dir);
      this.sfx('block', { power });
      this.hitstop = Math.max(this.hitstop, 0.035 + lvl * 0.012);
      this.shake(0.08 + lvl * 0.05);
      if (!o.projectile && !o.remote && !hit.noPush) att.vx -= att.facing * (1.5 + lvl * 0.8);
    } else if (res.type === 'parry') {
      const sp = v3(def.x + def.facing * 0.6, pos.y, 0.4);
      this.fx.parryBurst(sp, def.color, def.facing);
      this.sfx('parry');
      this.hitstop = Math.max(this.hitstop, 0.16);
      this.slowmo(0.3, 0.45);
      this.shake(0.5);
      this.R.flash(def.color, 0.07);
      this.R.kickAberration(0.014);
      const s2 = this.project(sp);
      this.R.kickRadial(0.045, s2.x, s2.y);
      this.hud.popup('PARRY', sp.x, sp.y + 1.1, 'parry');
      if (def.idx === 0) this.stats.parries++;
      if (!o.projectile && !o.remote) att.parried(dir);
    } else if (res.type === 'break') {
      const sp = v3(def.x + def.facing * 0.5, def.y + def.height * 0.55, 0.4);
      this.fx.guardBreak(sp, dir);
      this.sfx('guardBreak');
      this.hitstop = Math.max(this.hitstop, 0.14);
      this.shake(0.7);
      this.R.kickAberration(0.015);
      this.hud.popup('GUARD BREAK', sp.x, sp.y + 1.2, 'warn');
      if (playerIsAtt) this.stats.dmgDealt += res.dmg;
      else this.stats.dmgTaken += res.dmg;
    }
    return res;
  }

  onKO(att, def, pos) {
    this.hitstop = 0.32;
    this.slowmo(0.22, 1.35);
    this.R.impactFrame(0.13, 0x05060a, att.color);
    this.R.kickAberration(0.04);
    const sp = this.project(pos);
    this.R.kickRadial(0.06, sp.x, sp.y);
    this.shake(1.3);
    this.fx.explosion(pos, att.color, 0.9);
    this.fx.sparks(pos, { count: 60, color: 0xffffff, color2: def.color, speed: 16, life: 1.1, size: 0.05 });
    this.camFocus = { f: def, t: 1.6 };
    for (const p of this.projectiles) this.killProjectile(p, true);
    this.projectiles.length = 0;
    this.endRound(att);
  }

  // -------------------------------------------------------------------------
  // projectiles / traps / decoys
  // -------------------------------------------------------------------------
  projectile(owner, spec) {
    const p = {
      owner, kind: spec.kind, x: spec.x, y: spec.y, vx: spec.vx || 0, vy: spec.vy || 0, w: spec.w, h: spec.h,
      life: spec.life ?? 1, age: 0, multi: spec.multi || 1, interval: spec.interval || 0.2, lastHit: -9, color: spec.color ?? owner.color,
      hit: { dmg: spec.dmg, level: spec.level || 1, kbx: spec.kbx ?? 3, kby: spec.kby || 0, stun: spec.stun ?? (spec.level >= 2 ? 0.42 : 0.3), block: 0.2, guard: spec.guard ?? 8 + (spec.level || 1) * 4, pause: 0.05, fx: spec.kind === 'orb' ? 'shock' : spec.kind === 'quake' ? 'hit' : 'slash' },
      fxT: 0, spin: 0, dead: false,
    };
    p.x = clamp(p.x, -STAGE_HALF - 0.5, STAGE_HALF + 0.5);
    const dirX = Math.sign(p.vx) || owner.facing;
    if (p.kind === 'crescent') {
      p.vis = this.fx.slash(v3(p.x, p.y), { color: 0xffffff, color2: p.color, radius: 1.15, a0: -1.2, a1: 1.2, facing: dirX, dur: 0.22, thick: 0.42, grow: 0, intensity: 2 });
      p.vis.hold = true;
    } else if (p.kind === 'shuriken') {
      p.vis = this.fx.slash(v3(p.x, p.y), { color: 0xffffff, color2: p.color, radius: 0.42, a0: -2.9, a1: 2.9, facing: dirX, dur: 0.12, thick: 0.6, grow: 0, intensity: 2 });
      p.vis.hold = true;
    } else if (p.kind === 'orb') {
      p.orb = this.makeOrb(p.color, 0.42);
    }
    this.projectiles.push(p);
    return p;
  }

  makeOrb(color, radius) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(1.3) }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `precision highp float; uniform vec3 uColor; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        void main(){
          float f = abs(dot(normalize(vN), normalize(vV)));
          float bands = sin(vP.y * 22.0 + uTime * 16.0) * sin(vP.x * 17.0 - uTime * 11.0) * sin(vP.z * 19.0 + uTime * 13.0);
          float a = pow(f, 1.5) * 1.3 + pow(1.0 - f, 2.0) * 0.9 + smoothstep(0.35, 0.9, bands) * 1.2;
          vec3 col = mix(uColor, vec3(1.0), pow(f, 6.0) * 0.6);
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), mat);
    mesh.renderOrder = 21;
    this.scene.add(mesh);
    return { mesh, mat };
  }

  killProjectile(p, burst = true) {
    if (p.dead) return;
    p.dead = true;
    if (p.vis) {
      p.vis.hold = false;
      p.vis.life = Math.min(p.vis.life, p.vis.dur * 0.25);
    }
    if (p.orb) {
      this.scene.remove(p.orb.mesh);
      p.orb.mesh.geometry.dispose();
      p.orb.mat.dispose();
    }
    if (burst) {
      const pos = v3(p.x, p.y, 0.2);
      this.fx.ring(pos, { color: p.color, r0: 0.2, r1: 1.6, dur: 0.25 });
      this.fx.sparks(pos, { count: 14, color: 0xffffff, color2: p.color, speed: 7, gravity: 3 });
      this.fx.flare(pos, { color: p.color, size: 2 });
    }
  }

  updateProjectiles(dt) {
    const list = this.projectiles;
    for (const p of list) {
      if (p.dead) continue;
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.fxT -= dt;
      const dirX = Math.sign(p.vx) || 1;
      // visuals
      if (p.kind === 'crescent') {
        p.vis.mesh.position.set(p.x - dirX * 0.95, p.y, 0.25);
        if (p.fxT <= 0) {
          p.fxT = 0.02;
          this.fx.sparks(v3(p.x, p.y + rand(-0.7, 0.7)), { count: 1, color: 0xffffff, color2: p.color, speed: 2, dir: [-dirX, 0, 0], spread: 0.5, gravity: 0, life: 0.3, floor: false });
          this.fx.glow(v3(p.x - dirX * 0.2, p.y), { color: p.color, size: 1.3, size1: 0.6, life: 0.1, intensity: 0.5 });
        }
      } else if (p.kind === 'shuriken') {
        p.spin += dt * 30;
        p.vis.mesh.position.set(p.x, p.y, 0.25);
        p.vis.mesh.rotation.z = p.spin * dirX;
        if (p.fxT <= 0) {
          p.fxT = 0.025;
          this.fx.glow(v3(p.x, p.y), { color: p.color, size: 0.5, size1: 0.1, life: 0.16, intensity: 0.9 });
        }
      } else if (p.kind === 'orb') {
        p.orb.mesh.position.set(p.x, p.y + Math.sin(p.age * 9) * 0.06, 0.2);
        p.orb.mat.uniforms.uTime.value = p.age;
        p.orb.mesh.rotation.y += dt * 5;
        if (p.fxT <= 0) {
          p.fxT = 0.07;
          this.fx.lightning(v3(p.x, p.y), v3(p.x + rand(-1, 1), p.y + rand(-1, 1)), { color: p.color, dur: 0.09, width: 0.045, jitter: 0.3 });
          this.fx.glow(v3(p.x, p.y), { color: p.color, size: 1.3, size1: 0.9, life: 0.12, intensity: 0.22 });
          if (Math.random() < 0.4) this.fx.lightning(v3(p.x, p.y), v3(p.x + rand(-0.6, 0.6), 0), { color: p.color, dur: 0.1, width: 0.04 });
        }
      } else if (p.kind === 'quake') {
        if (p.fxT <= 0) {
          p.fxT = 0.05;
          const h = 1.2 + Math.sin(p.age * 18) * 0.5;
          this.fx.pillar(p.x, { color: p.color, width: 0.42, height: h + 0.8, dur: 0.32 });
          this.fx.sparks(v3(p.x, 0.1), { count: 5, color: 0xffe0b0, color2: p.color, speed: 7, dir: [0, 1, 0], spread: 0.6, gravity: 16, life: 0.6 });
          this.fx.dust(p.x, -dirX, 2);
          for (let i = 0; i < 3; i++) {
            this.fx.alpha.spawn(p.x + rand(-0.3, 0.3), 0.1, rand(-0.4, 0.4), rand(-2, 2), rand(4, 9), rand(-1, 1), { color: 0x16161a, color2: 0x16161a, life: rand(0.5, 0.9), size: rand(0.08, 0.2), size1: 0.06, kind: 4, gravity: 22, alpha: 1, rotVel: rand(-10, 10), floor: true });
          }
          if (Math.random() < 0.3) this.fx.crack(p.x, 1.6, p.color, 2.5);
          this.shake(0.06);
        }
      }
      // collide with fighter
      const def = this.foe(p.owner);
      const hb = this.hurtbox(def);
      const hw = p.w / 2, hh = p.h / 2;
      if (p.age - p.lastHit >= p.interval && !(hb.x1 < p.x - hw || hb.x0 > p.x + hw || hb.y1 < p.y - hh || hb.y0 > p.y + hh)) {
        const res = this.resolveHit(p.owner, def, p.hit, { projectile: true, srcX: p.x - dirX * 2, px: clamp(p.x, hb.x0, hb.x1), py: clamp(p.y, hb.y0 + 0.3, hb.y1 - 0.2) });
        if (res) {
          if (res.type === 'parry') {
            // reflected!
            p.owner = def;
            p.vx = -p.vx * 1.25;
            p.vy = -p.vy;
            p.age = 0;
            p.lastHit = -9;
            p.color = def.color;
            if (p.vis) {
              p.vis.mat.uniforms.uColor2.value.set(def.color);
              p.vis.facing = -p.vis.facing;
            }
            if (p.orb) p.orb.mat.uniforms.uColor.value.set(def.color).multiplyScalar(1.3);
          } else {
            p.lastHit = p.age;
            p.multi--;
            if (p.multi <= 0 || res.type === 'block') this.killProjectile(p, true);
          }
        }
      }
      if (!p.dead && (p.age > p.life || Math.abs(p.x) > STAGE_HALF + 2.5 || p.y < -0.5 || p.y > 12)) this.killProjectile(p, p.age > p.life);
    }
    // projectile clashes
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead || a.owner === b.owner) continue;
        if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2) {
          const pos = v3((a.x + b.x) / 2, (a.y + b.y) / 2, 0.2);
          this.fx.explosion(pos, 0xffffff, 0.55);
          this.sfx('clash');
          this.shake(0.4);
          this.killProjectile(a, true);
          this.killProjectile(b, true);
          break;
        }
      }
    }
    for (let i = list.length - 1; i >= 0; i--) if (list[i].dead) list.splice(i, 1);
  }

  trap(owner, spec) {
    this.traps.push({ owner, x: spec.x, life: spec.life, radius: spec.radius, age: 0, fxT: 0, color: owner.color,
      hit: { dmg: spec.dmg, level: spec.level || 2, kbx: spec.kbx ?? 1, kby: 0, stun: spec.stun ?? 0.6, block: 0.24, guard: 14, pause: 0.08, fx: 'shock' } });
  }

  decoy(owner, spec) {
    const ghost = owner.spawnGhost(spec.life + 0.1, 1.4);
    this.decoys.push({ owner, x: owner.x, y: owner.y, life: spec.life, age: 0, radius: spec.radius, ghost, color: owner.color, fxT: 0,
      hit: { dmg: spec.dmg, level: spec.level || 3, kbx: spec.kbx ?? 4, kby: spec.kby ?? 8, stun: 0.5, block: 0.26, guard: 22, pause: 0.12, fx: 'shock' } });
  }

  updateTraps(dt) {
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const t = this.traps[i];
      t.age += dt;
      t.fxT -= dt;
      if (t.fxT <= 0) {
        t.fxT = 0.28;
        this.fx.ring(v3(t.x, 0.04), { color: t.color, r0: t.radius * 0.3, r1: t.radius, dur: 0.5, ground: true, width: 0.09, alpha: 0.8 });
        this.fx.lightning(v3(t.x + rand(-t.radius, t.radius) * 0.7, 0.02), v3(t.x + rand(-t.radius, t.radius) * 0.7, rand(0.2, 0.7)), { color: t.color, dur: 0.12, width: 0.035, jitter: 0.25 });
      }
      const foe = this.foe(t.owner);
      if (t.age > 0.35 && foe.y < 0.6 && Math.abs(foe.x - t.x) < t.radius + foe.width * 0.5 && !foe.invulnerable) {
        this.fx.lightning(v3(t.x, 0), v3(foe.x, foe.y + foe.height * 0.6), { color: t.color, dur: 0.25, width: 0.14, branches: 3 });
        this.fx.pillar(t.x, { color: t.color, width: 0.9, height: 3.5, dur: 0.35 });
        this.sfx('zap');
        this.sfx('thunder');
        this.resolveHit(t.owner, foe, t.hit, { remote: true, srcX: t.x, px: foe.x, py: foe.y + 1 });
        this.traps.splice(i, 1);
        continue;
      }
      if (t.age > t.life) this.traps.splice(i, 1);
    }
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i];
      d.age += dt;
      d.fxT -= dt;
      if (d.fxT <= 0) {
        d.fxT = 0.09;
        this.fx.motes(v3(d.x, d.y + 1.2), { color: d.color, count: 2, radius: 0.6, speed: 0.6 });
      }
      const foe = this.foe(d.owner);
      const near = d.age > 0.22 && Math.abs(foe.x - d.x) < d.radius * 0.75 && Math.abs(foe.y - d.y) < 2;
      if (near || d.age > d.life) {
        d.ghost.life = 0.01;
        const c = v3(d.x, d.y + 1.2);
        this.fx.explosion(c, d.color, 0.9);
        this.fx.hexShards(c, { color: d.color, count: 16, speed: 8 });
        this.sfx('explosion');
        this.shake(0.6);
        this.areaHit(d.owner, { x0: d.x - d.radius, x1: d.x + d.radius, y0: d.y - 0.5, y1: d.y + 3 }, { ...d.hit, dirFrom: d.x });
        this.decoys.splice(i, 1);
      }
    }
  }

  // -------------------------------------------------------------------------
  // main update
  // -------------------------------------------------------------------------
  step(h) {
    this.simTime += h;
    const [a, b] = this.fighters;
    // scheduled callbacks
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].t <= this.simTime) {
        const fn = this.timers[i].fn;
        this.timers.splice(i, 1);
        fn();
      }
    }
    const cine = this.cine;
    for (const f of this.fighters) {
      if (cine && cine.f !== f) continue; // frozen during overdrive cut-ins
      f.update(h);
    }
    if (cine) {
      cine.t -= h;
      if (cine.t <= 0 || cine.f.state !== 'attack') {
        this.cine = null;
        this.hud.letterbox(false);
        this.R.setDesat(0);
      }
      return;
    }
    // body push
    const solid = (f) => !f.hidden && !f.dead && f.state !== 'down' && !(f.state === 'attack' && f.move?.passThrough && f.moveT >= f.move.passThrough[0] && f.moveT < f.move.passThrough[1]);
    if (solid(a) && solid(b) && Math.abs(a.y - b.y) < 1.3) {
      const min = a.width + b.width;
      let dx = b.x - a.x;
      if (Math.abs(dx) < min) {
        const s = dx >= 0 ? 1 : -1;
        const pen = min - Math.abs(dx);
        const wa = b.stats.weight / (a.stats.weight + b.stats.weight);
        a.x -= s * pen * wa;
        b.x += s * pen * (1 - wa);
        for (const f of this.fighters) {
          if (f.x < -STAGE_HALF) { const d = -STAGE_HALF - f.x; a.x += d; b.x += d; }
          if (f.x > STAGE_HALF) { const d = f.x - STAGE_HALF; a.x -= d; b.x -= d; }
        }
      }
    }
    this.checkMelee(a);
    this.checkMelee(b);
    this.updateProjectiles(h);
    this.updateTraps(h);
  }

  update(dt) {
    if (this.paused) return;
    this.realTime += dt;
    const [a, b] = this.fighters;
    for (const f of this.fighters) f.preStep();
    // controllers
    if (this.live) {
      this.controllers[0].update(a, dt);
      this.controllers[1].update(b, dt);
    } else {
      this.app.input.takePresses();
      for (const f of this.fighters) { f.ctl.mx = 0; f.ctl.block = false; f.buf = null; }
    }
    this.updatePhase(dt);

    let simDt = 0;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
    } else {
      if (this.slowT > 0) {
        this.slowT -= dt;
        this.timeScale = damp(this.timeScale, this.slowScale, 30, dt);
      } else this.timeScale = damp(this.timeScale, 1, 6, dt);
      simDt = Math.min(dt, 0.05) * this.timeScale;
      const n = Math.max(1, Math.ceil(simDt / SUB));
      const h = simDt / n;
      for (let i = 0; i < n; i++) this.step(h);
    }
    const visDt = simDt > 0 ? simDt : dt * 0.02;
    for (const f of this.fighters) f.applyVisual(visDt, this.simTime, dt);
    this.fx.update(simDt > 0 ? simDt : dt * 0.12);
    this.arena.update(dt * (0.3 + 0.7 * this.timeScale), this.realTime, this);
    this.updateCamera(dt);
    this.hud.updateFight(this, dt);
    for (const f of this.fighters) f.hpLag = f.hpLag > f.hp ? Math.max(f.hp, f.hpLag - dt * f.hpMax * 0.35 * (f.state === 'hitstun' || f.state === 'launched' ? 0 : 1)) : f.hp;
  }

  project(p) {
    _v.set(p.x, p.y, p.z || 0).project(this.camera);
    return { x: _v.x * 0.5 + 0.5, y: _v.y * 0.5 + 0.5 };
  }

  updateCamera(dt) {
    const [a, b] = this.fighters;
    const cam = this.camera;
    const aspect = cam.aspect;
    let tx, ty, tz, lx, ly;
    const focus = this.cine ? this.cine.f : this.camFocus ? this.camFocus.f : null;
    if (this.camFocus) {
      this.camFocus.t -= dt;
      if (this.camFocus.t <= 0) this.camFocus = null;
    }
    if (this.phase === 'intro') {
      const u = clamp(this.phaseT / 2.4, 0, 1);
      const e = Ease.inOut3(u);
      const ang = lerp(-0.9, 0, e);
      const dist = lerp(8, 10.5, e);
      tx = Math.sin(ang) * dist;
      tz = Math.cos(ang) * dist;
      ty = lerp(3.4, 1.9, e);
      lx = 0;
      ly = 1.3;
    } else if (focus) {
      const other = this.foe(focus);
      const side = this.cine ? focus.facing : 0;
      tx = focus.x + side * 1.4;
      ty = focus.y + (this.cine ? 1.35 : 1.3);
      tz = this.cine ? 5.4 : 6.8;
      lx = focus.x + side * 0.2;
      ly = focus.y + (this.cine ? 1.45 : 1.0);
      if (!this.cine && this.phase === 'ko' && !this._victoryPlayed) {
        lx = lerp(focus.x, other.x, 0.25);
      }
    } else {
      const mid = (a.x + b.x) / 2;
      const sep = Math.abs(a.x - b.x);
      const top = Math.max(a.y, b.y);
      const wide = clamp(sep + 3.4, 5.6, 16) / Math.min(1.78, Math.max(0.5, aspect)) * 1.78;
      tz = clamp(wide * 0.92 + top * 0.95, 7.2, aspect < 1 ? 30 : 17) - this.camKick;
      tx = clamp(mid, -5.4, 5.4);
      ty = 1.75 + top * 0.4;
      lx = clamp(mid, -5.8, 5.8);
      ly = 1.28 + top * 0.5;
    }
    this.camKick = damp(this.camKick, 0, 10, dt);
    const k = focus ? 7 : 5.5;
    this.camPos.x = damp(this.camPos.x, tx, k, dt);
    this.camPos.y = damp(this.camPos.y, ty, k, dt);
    this.camPos.z = damp(this.camPos.z, tz, focus ? 6 : 4.2, dt);
    this.camLook.x = damp(this.camLook.x, lx, k + 2, dt);
    this.camLook.y = damp(this.camLook.y, ly, k + 2, dt);
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    const sh = Math.min(1, this.trauma) ** 2;
    const t = this.realTime * 34;
    const sx = noise1(t) * sh * 0.34, sy = noise1(t + 91.7) * sh * 0.28;
    const sway = Math.sin(this.realTime * 0.5) * 0.06;
    cam.position.set(this.camPos.x + sx + sway, this.camPos.y + sy, this.camPos.z);
    cam.lookAt(this.camLook.x + sx * 0.5, this.camLook.y + sy * 0.5, 0);
    cam.rotation.z += noise1(t + 40) * sh * 0.035;
  }

  setPaused(p) {
    this.paused = p;
  }

  dispose() {
    this.clearEntities();
    for (const f of this.fighters) f.dispose();
    this.fx.dispose();
    this.arena.dispose();
    this.hud.hideFight();
    this.R.setDesat(0);
  }
}

export function enemyLoadout(e) {
  return { chassis: e.chassis, mods: e.mods || [], perks: [], paint: e.paint || CHASSIS[e.chassis].paint, name: e.name, level: e.level, boss: !!e.boss };
}

export { MODIFIERS };
