import * as THREE from 'three';
import { buildRobot, disposeRig } from '../robots/chassis.js';
import { Ghost } from '../robots/builder.js';
import { Animator } from '../robots/anim.js';
import { getMoveset } from '../robots/moveset.js';
import { Trail, Shield } from '../engine/fx.js';
import { clamp, damp, rand, chance } from '../engine/utils.js';

export const STAGE_HALF = 8.6;
const GRAVITY = 34;
const OPEN_YAW = 0.42; // how far fighters turn their chest toward the camera
const NEUTRAL = new Set(['idle', 'walk']);

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Fighter {
  constructor(fight, idx, loadout, stats) {
    this.F = fight;
    this.idx = idx;
    this.name = loadout.name;
    this.chassis = loadout.chassis;
    this.stats = stats;
    this.fx = stats.fx;
    this.isBoss = !!loadout.boss;
    this.rig = buildRobot(loadout.chassis, loadout.paint, stats.visuals);
    this.rig.root.scale.setScalar(stats.scale);
    this.scale = stats.scale;
    this.color = loadout.paint.glow;
    this.M = this.rig.materials;
    this.ms = getMoveset(loadout.chassis);
    this.anims = this.ms.anims;
    this.moves = this.ms.moves;
    this.animator = new Animator();
    this.height = stats.height;
    this.width = stats.width;

    this.trails = {};
    for (const k of ['R', 'L', 'footR', 'footL']) {
      const t = new Trail(this.color, { color2: this.color, life: 0.2 });
      this.trails[k] = t;
      fight.scene.add(t.mesh);
    }
    if (this.chassis === 'wraith') {
      this.scarf = new Trail(this.color, { style: 1, life: 0.55, points: 26, color2: 0x3a0a6a, alpha: 0.9 });
      fight.scene.add(this.scarf.mesh);
    }
    this.shield = new Shield(this.color);
    fight.scene.add(this.shield.mesh);
    this.ghosts = [];
    for (let i = 0; i < 6; i++) {
      const g = new Ghost(this.rig, this.color);
      this.ghosts.push(g);
      fight.scene.add(g.group);
    }
    this.ghostIdx = 0;
    this.ghostTimer = 0;
    fight.scene.add(this.rig.root);

    this.ctl = { mx: 0, down: false, block: false, heavyHeld: false };
    this.buf = null;
    this.bufT = 0;
    this.modArmor = false; // "armored" stage modifier
    this.reviveUsed = false;
    this.wins = 0;
    this.reset(idx === 0 ? -3 : 3, idx === 0 ? 1 : -1);
  }

  // -------------------------------------------------------------------------
  reset(x, facing) {
    const s = this.stats;
    this.x = x; this.y = 0; this.vx = 0; this.vy = 0;
    this.facing = facing;
    this.yaw = facing > 0 ? -OPEN_YAW : Math.PI + OPEN_YAW;
    this.hpMax = s.hp;
    this.hp = s.hp;
    this.hpLag = s.hp;
    this.energy = s.energyMax * 0.6;
    this.guard = s.guard;
    this.guardLock = 0;
    this.meter = this.fx.startMeter || 0;
    this.barrier = this.fx.barrier || 0;
    this.state = 'idle';
    this.stateT = 0;
    this.stunT = 0;
    this.move = null;
    this.moveT = 0;
    this.dashCd = 0;
    this.invulnT = 0;
    this.blockT = 0;
    this.airJumps = 0;
    this.airDashed = false;
    this.juggle = 0;
    this.comboHits = 0; // hits received in the current combo
    this.comboDmg = 0;
    this.burnT = 0;
    this.flashT = 0;
    this.firstStrikeReady = true;
    this.armorBroken = false;
    this.windUsed = false;
    this.hidden = false;
    this.dead = false;
    this.buf = null;
    this.glowBoost = 0;
    this.animator.play(this.anims.idle, 0);
    this.rig.root.visible = true;
    for (const t of Object.values(this.trails)) t.clear();
    this.applyVisual(0);
  }

  get foe() {
    return this.F.fighters[1 - this.idx];
  }
  get grounded() {
    return this.y <= 0.001;
  }
  get airborne() {
    if (this.y > 0.05) return true;
    const m = this.move;
    return !!(m && m.airborne && this.moveT >= m.airborne[0] && this.moveT <= m.airborne[1]);
  }
  get neutral() {
    return NEUTRAL.has(this.state);
  }
  get vulnerableState() {
    return this.state === 'stunned' || (this.state === 'attack' && this.move && this.moveT > this.lastHitEnd());
  }
  lastHitEnd() {
    const h = this.move?.hits;
    return h && h.length ? h[h.length - 1].t1 : 0.2;
  }

  anchor(name) {
    const a = this.rig.anchors[name];
    return a ? a.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(this.x, this.y + 1.2, 0);
  }

  setState(s, t = 0) {
    this.state = s;
    this.stateT = 0;
    this.stunT = t;
    if (s !== 'attack') {
      this.move = null;
      this.hidden = false;
      this.moveScriptedY = false;
    }
  }

  play(name, fade = 0.1, restart = true) {
    const c = this.anims[name];
    if (c) this.animator.play(c, fade, restart);
  }

  faceFoe(snap = false) {
    const dx = this.foe.x - this.x;
    if (Math.abs(dx) > 0.02) this.facing = dx > 0 ? 1 : -1;
    if (snap) this.snapYaw();
  }
  snapYaw() {
    this.yaw = this.facing > 0 ? -OPEN_YAW : Math.PI + OPEN_YAW;
  }

  press(action) {
    this.buf = action;
    this.bufT = action === 'jump' || action === 'dash' ? 0.12 : 0.2;
  }

  spendEnergy(cost) {
    const c = cost * (1 - Math.min(0.6, this.fx.specialCost || 0));
    if (this.energy < c) return false;
    this.energy -= c;
    return true;
  }

  // -------------------------------------------------------------------------
  // moves
  // -------------------------------------------------------------------------
  startMove(id, fade = 0.06) {
    const m = this.moves[id];
    if (!m) return false;
    if (m.cost && !this.spendEnergy(m.cost)) {
      this.F.onNoEnergy(this);
      return false;
    }
    if (m.type === 'overdrive') {
      if (this.meter < 100) return false;
      this.meter = 0;
    }
    this.state = 'attack';
    this.stateT = 0;
    this.move = m;
    this.moveT = 0;
    this.moveHit = new Array(m.hits.length).fill(-1); // time of last connect per hit window
    this.moveEv = 0;
    this.hitConfirmed = false;
    this.charged = false;
    this.chargeT = 0;
    this.landed = false;
    this.fxTimer = 0;
    this.buf = null;
    if (m.type !== 'air') this.faceFoe();
    this.animator.play(m.anim, fade);
    if (m.sfx) this.F.sfx(m.sfx, { delay: Math.max(0, (m.hits[0]?.t0 ?? 0.1) - 0.06) });
    else if (m.hits.length) this.F.sfx(m.type === 'heavy' || m.type === 'launcher' ? 'whooshHeavy' : 'whoosh', { delay: Math.max(0, m.hits[0].t0 - 0.05) });
    this.F.onMoveStart(this, m);
    return true;
  }

  tryAction(a) {
    const c = this.ctl;
    if (a === 'light') return this.startMove(this.grounded ? 'light1' : 'airL');
    if (a === 'heavy') return this.startMove(this.grounded ? (c.down ? 'launcher' : 'heavy') : 'airH');
    if (a === 'special') {
      if (!this.grounded) return false;
      return this.startMove(c.down ? 'spD' : c.mx !== 0 ? 'spF' : 'spN');
    }
    if (a === 'overdrive') return this.grounded && this.meter >= 100 && this.startMove('overdrive');
    if (a === 'jump') return this.doJump();
    if (a === 'dash') return this.doDash();
    return false;
  }

  doJump() {
    if (this.grounded) {
      this.vy = this.stats.jump * (this.F.gravityScale < 1 ? 0.9 : 1);
      this.vx = this.ctl.mx * this.stats.speed * 0.95;
      this.y = 0.01;
      this.airJumps = this.fx.doubleJump ? 1 : 0;
      this.airDashed = false;
      this.setState('jump');
      this.play('jump', 0.05);
      this.F.sfx('jump');
      this.F.fx.dust(this.x, 0, 4);
      return true;
    }
    if (this.airJumps > 0 && this.state === 'jump') {
      this.airJumps--;
      this.vy = this.stats.jump * 0.88;
      this.vx = this.ctl.mx * this.stats.speed * 0.95;
      this.play('jump', 0.05);
      this.F.sfx('jump');
      this.F.fx.ring({ x: this.x, y: this.y, z: 0 }, { color: this.color, r0: 0.2, r1: 1.4, dur: 0.25, ground: true });
      return true;
    }
    return false;
  }

  doDash() {
    if (this.dashCd > 0) return false;
    const air = !this.grounded;
    if (air && (!this.fx.airDash || this.airDashed || this.state !== 'jump')) return false;
    let dir = this.ctl.mx !== 0 ? this.ctl.mx : this.facing;
    const back = dir !== this.facing;
    this.dashDir = dir;
    this.setState('dash');
    this.dashT = back ? 0.24 : 0.22;
    this.vx = dir * (back ? 11.5 : 14) * (0.8 + this.stats.speed / 18);
    if (air) {
      this.vy = 2;
      this.airDashed = true;
    }
    this.dashCd = 0.55 * (1 - (this.fx.dashCd || 0));
    if (back || this.fx.phaseDash) this.invulnT = Math.max(this.invulnT, this.fx.phaseDash ? 0.2 : 0.13);
    this.play(back ? 'dashB' : 'dashF', 0.04);
    this.F.sfx('dash');
    if (!air) this.F.fx.dust(this.x, -dir, 5);
    this.spawnGhost(0.22, 0.7);
    this.ghostTimer = 0.05;
    return true;
  }

  spawnGhost(life = 0.3, alpha = 1) {
    this.rig.root.updateMatrixWorld(true);
    const g = this.ghosts[this.ghostIdx++ % this.ghosts.length];
    g.snapshot(life, alpha);
    return g;
  }
  ghostEvery(interval, life) {
    if (this.ghostTimer <= 0) {
      this.spawnGhost(life, 0.8);
      this.ghostTimer = interval;
    }
  }

  // -------------------------------------------------------------------------
  // simulation step
  // -------------------------------------------------------------------------
  update(dt) {
    const F = this.F;
    const s = this.stats;
    this.stateT += dt;
    this.dashCd -= dt;
    this.invulnT -= dt;
    this.ghostTimer -= dt;
    this.guardLock -= dt;
    if (this.bufT > 0) {
      this.bufT -= dt;
      if (this.bufT <= 0) this.buf = null;
    }
    const live = F.live; // fighters may act
    // resources
    if (!this.dead && live) {
      const regenMul = F.energyMul;
      if (!(this.state === 'attack' && this.move && this.move.cost)) this.energy = Math.min(s.energyMax, this.energy + s.energyRegen * regenMul * dt);
      if (this.state !== 'block' && this.state !== 'blockstun' && this.state !== 'stunned' && this.guardLock <= 0) {
        this.guard = Math.min(s.guard, this.guard + s.guard * 0.16 * (1 + (this.fx.guardRegen || 0)) * dt);
      }
      if (this.fx.regen && this.hp > 0) this.hp = Math.min(this.hpMax, this.hp + this.fx.regen * dt);
      if (this.burnT > 0) {
        this.burnT -= dt;
        this.hp = Math.max(1, this.hp - this.burnDps * dt);
        if (chance(dt * 14)) F.fx.sparks(this.anchor('core'), { count: 2, color: 0xffa040, color2: 0xff3010, speed: 2.5, gravity: -3, life: 0.5 });
      }
    }

    const c = this.ctl;
    switch (this.state) {
      case 'idle':
      case 'walk': {
        if (!live) {
          this.vx = damp(this.vx, 0, 16, dt);
          this.animator.play(this.anims.idle, 0.15, false);
          break;
        }
        this.faceFoe();
        if (this.buf && this.tryAction(this.buf)) break;
        if (c.block && this.guard > 0) {
          this.setState('block');
          this.blockT = 0;
          this.play('block', 0.06);
          this.vx = 0;
          break;
        }
        if (c.mx !== 0) {
          const fwd = c.mx === this.facing;
          this.vx = c.mx * s.speed * (fwd ? 1 : 0.78);
          this.state = 'walk';
          this.animator.speed = s.speed / 3.4;
          this.animator.play(fwd ? this.anims.walkF : this.anims.walkB, 0.12, false);
        } else {
          this.vx = damp(this.vx, 0, 22, dt);
          this.state = 'idle';
          this.animator.speed = 1;
          this.animator.play(this.anims.idle, 0.16, false);
        }
        break;
      }
      case 'block': {
        this.blockT += dt;
        this.vx = damp(this.vx, 0, 18, dt);
        this.faceFoe();
        if (!c.block || !live) {
          this.setState('idle');
          this.play('idle', 0.1);
        } else if (this.buf === 'dash' && this.tryAction('dash')) break;
        break;
      }
      case 'blockstun': {
        this.vx = damp(this.vx, 0, 9, dt);
        this.stunT -= dt;
        if (this.stunT <= 0) {
          if (c.block && this.guard > 0) {
            this.setState('block');
            this.blockT = 1; // no parry straight out of block stun
            this.animator.play(this.anims.block, 0.08, false);
          } else {
            this.setState('idle');
            this.play('idle', 0.1);
          }
        }
        break;
      }
      case 'dash': {
        this.dashT -= dt;
        if (!this.grounded) this.vy = Math.max(this.vy, -1);
        this.ghostEvery(0.05, 0.2);
        if (this.buf && this.buf !== 'dash' && this.dashT < 0.12 && this.grounded && this.tryAction(this.buf)) break;
        if (this.dashT <= 0) {
          this.vx *= 0.35;
          if (this.grounded) {
            this.setState('idle');
            this.play('idle', 0.12);
          } else {
            this.setState('jump');
            this.play('fall', 0.15);
          }
        }
        break;
      }
      case 'jump': {
        this.vx = damp(this.vx, c.mx * s.speed * 0.9, 3, dt);
        if (this.vy < 0) this.animator.play(this.anims.fall, 0.18, false);
        if (live && this.buf && this.tryAction(this.buf)) break;
        break;
      }
      case 'attack':
        this.updateMove(dt);
        break;
      case 'hitstun': {
        this.vx = damp(this.vx, 0, 7, dt);
        this.stunT -= dt;
        if (this.stunT <= 0) this.recover();
        break;
      }
      case 'stunned': {
        this.vx = damp(this.vx, 0, 10, dt);
        this.stunT -= dt;
        if (chance(dt * 12)) F.fx.sparks(this.anchor('head'), { count: 2, color: 0xfff3a0, color2: this.color, speed: 2.4, gravity: 3, life: 0.4 });
        if (this.stunT <= 0) this.recover();
        break;
      }
      case 'launched':
        break; // physics below handles landing
      case 'down': {
        this.vx = damp(this.vx, 0, 8, dt);
        this.stunT -= dt;
        if (this.stunT <= 0 && !this.dead) {
          this.setState('getup', 0.44);
          this.play('getup', 0.2);
          this.invulnT = 0.5;
        }
        break;
      }
      case 'getup': {
        this.stunT -= dt;
        if (this.stunT <= 0) this.recover();
        break;
      }
      default:
        this.vx = damp(this.vx, 0, 12, dt);
        break;
    }

    // ---- physics
    const scripted = this.state === 'attack' && this.move && this.move.update && this.moveScriptedY;
    if (!this.grounded || this.vy > 0) {
      if (!scripted) {
        const g = GRAVITY * F.gravityScale * (this.state === 'launched' ? 0.82 + this.juggle * 0.09 : 1);
        this.vy -= g * dt;
        this.y += this.vy * dt;
      }
      if (this.y <= 0 && this.vy <= 0) {
        this.y = 0;
        this.vy = 0;
        this.onLand();
      }
    }
    this.x += this.vx * dt;
    if (this.x < -STAGE_HALF) {
      this.x = -STAGE_HALF;
      if (this.state === 'launched' && this.vx < -6) this.wallBounce(1);
    } else if (this.x > STAGE_HALF) {
      this.x = STAGE_HALF;
      if (this.state === 'launched' && this.vx > 6) this.wallBounce(-1);
    }

    // ---- animation
    this.animator.update(dt);
  }

  wallBounce(dir) {
    this.vx = dir * Math.min(5, Math.abs(this.vx) * 0.4);
    this.vy = Math.max(this.vy, 6);
    const p = { x: this.x - dir * 0.3, y: this.y + 1.2, z: 0 };
    this.F.fx.impact(p, 0xffffff, 0.8, dir);
    this.F.fx.ring(p, { color: this.color, r0: 0.3, r1: 3, dur: 0.35, tiltY: 1.4 });
    this.F.shake(0.6);
    this.F.sfx('hitHeavy');
  }

  recover() {
    this.comboHits = 0;
    this.comboDmg = 0;
    this.juggle = 0;
    this.F.onComboEnd(this);
    if (this.grounded) {
      this.setState('idle');
      this.play('idle', 0.14);
    } else {
      this.setState('jump');
      this.play('fall', 0.15);
    }
  }

  onLand() {
    const F = this.F;
    switch (this.state) {
      case 'jump':
        this.setState('idle');
        this.play('land', 0.03);
        F.fx.dust(this.x, 0, 4);
        F.sfx('land');
        this.vx *= 0.4;
        break;
      case 'dash':
        break;
      case 'attack': {
        const m = this.move;
        if (m && m.type === 'air') {
          if (m.onLand && !this.landed) m.onLand(this, F);
          this.landed = true;
          if (m.landRecover) {
            this.landT = m.landRecover;
            this.vx = 0;
            this.play('land', 0.04);
          } else {
            this.setState('idle');
            this.play('land', 0.04);
            F.fx.dust(this.x, 0, 3);
          }
        }
        break;
      }
      case 'launched':
        F.fx.dust(this.x, 1, 5);
        F.fx.dust(this.x, -1, 5);
        F.fx.ring({ x: this.x, y: 0.05, z: 0 }, { color: 0xbbbbbb, r0: 0.3, r1: 2.2, dur: 0.3, ground: true, alpha: 0.5 });
        F.shake(0.35);
        F.sfx('land', { heavy: true });
        this.vx *= 0.35;
        this.setState('down', this.dead ? 99 : 0.55);
        this.play('down', 0.06);
        break;
      default:
        break;
    }
  }

  updateMove(dt) {
    const m = this.move;
    const F = this.F;
    const c = this.ctl;
    if (!m) return this.setState('idle');
    const prev = this.moveT;

    // landing recovery of dive attacks
    if (this.landed && m.landRecover) {
      this.landT -= dt;
      this.vx = damp(this.vx, 0, 14, dt);
      if (this.landT <= 0) {
        this.setState('idle');
        this.play('idle', 0.12);
      }
      return;
    }

    // charge hold
    let hold = false;
    if (m.chargeAt !== undefined && !this.chargeDone && prev >= m.chargeAt && prev < m.chargeAt + 0.03) {
      if (c.heavyHeld && this.chargeT < 0.75) {
        hold = true;
        this.chargeT += dt;
        if (chance(dt * 50)) F.fx.implode(this.anchor(this.rig.anchors.tipR ? 'tipR' : 'handR'), { color: this.color, count: 2, radius: 1.1, life: 0.22 });
        if (!this.charged && this.chargeT >= 0.36) {
          this.charged = true;
          const p = this.anchor('handR');
          F.fx.flare(p, { color: 0xff5a3c, size: 3.2, life: 0.2 });
          F.fx.ring(p, { color: 0xff5a3c, r0: 0.2, r1: 1.6, dur: 0.25 });
          F.sfx('chargeReady');
          this.glowBoost = 2.5;
        }
      }
    }
    if (hold) {
      this.animator.t = m.chargeAt; // freeze the wind-up pose
      this.vx = damp(this.vx, 0, 14, dt);
      return;
    }
    this.moveT += dt;
    const t = this.moveT;
    this.moveScriptedY = false;

    // movement
    let moving = false;
    if (m.vel) {
      for (const v of m.vel) {
        if (t >= v.t0 && t < v.t1) {
          this.vx = v.vx * this.facing * this.scale;
          moving = true;
        }
      }
    }
    if (m.type === 'air') {
      if (m.dive && prev < m.dive.t && t >= m.dive.t) {
        this.vx = m.dive.vx * this.facing;
        this.vy = m.dive.vy;
      }
    } else if (!moving) this.vx = damp(this.vx, 0, 16, dt);

    // events
    while (this.moveEv < m.events.length && m.events[this.moveEv].t <= t) {
      m.events[this.moveEv].do(this, F);
      this.moveEv++;
      if (this.move !== m) return;
    }
    if (m.update) {
      const y0 = this.y;
      m.update(this, F, t, dt);
      if (this.y !== y0 || (m.airborne && t >= m.airborne[0] && t <= m.airborne[1] && this.y > 0)) this.moveScriptedY = true;
      if (this.moveScriptedY) this.vy = 0;
    }
    this.hidden = !!(m.hidden && t >= m.hidden[0] && t < m.hidden[1]);

    // trails
    if (m.trails) {
      for (const tr of m.trails) {
        if (t >= tr.t0 && t <= tr.t1) this.trailActive[tr.which] = true;
      }
    }

    // cancels
    if (this.buf && F.live) {
      const b = this.buf;
      const firstHit = m.hits[0];
      const after = firstHit ? firstHit.t1 : m.dur * 0.5;
      if (m.type === 'light' && b === 'light' && m.chain && t >= after - 0.02) {
        this.startMove(m.chain, 0.05);
        return;
      }
      if (this.hitConfirmed && t >= (firstHit ? firstHit.t0 + 0.04 : 0.1)) {
        let ok = false;
        if (m.type === 'light') ok = b === 'heavy' || b === 'special' || b === 'overdrive';
        else if (m.type === 'heavy') ok = b === 'special' || b === 'overdrive';
        else if (m.type === 'launcher') ok = b === 'special' || b === 'overdrive' || b === 'jump';
        else if (m.type === 'special') ok = b === 'overdrive';
        if (ok && this.grounded && this.y <= 0.001) {
          if (b === 'jump') {
            this.setState('idle');
            if (this.doJump()) { this.vx = this.facing * 2.2; this.buf = null; return; }
          } else if (this.tryAction(b)) return;
        }
      }
    }

    if (t >= m.dur) {
      this.hidden = false;
      if (this.grounded) {
        this.setState('idle');
        this.animator.play(this.anims.idle, 0.14, false);
      } else {
        this.setState('jump');
        this.play('fall', 0.15);
      }
    }
  }

  // -------------------------------------------------------------------------
  // receiving hits
  // -------------------------------------------------------------------------
  get invulnerable() {
    if (this.invulnT > 0 || this.hidden || this.dead) return true;
    const st = this.state;
    if (st === 'down' || st === 'getup' || st === 'intro' || st === 'victory' || st === 'defeat') return true;
    const m = this.move;
    if (st === 'attack' && m && m.invuln && this.moveT >= m.invuln[0] && this.moveT < m.invuln[1]) return true;
    return false;
  }
  get hasArmor() {
    const m = this.move;
    if (this.state === 'attack' && m) {
      if (m.armor && this.moveT >= m.armor[0] && this.moveT < m.armor[1]) return true;
      if (this.fx.heavyArmor && m.type === 'heavy' && this.moveT < (m.hits[0]?.t0 ?? 0.2)) return true;
    }
    return false;
  }

  /**
   * Resolve an incoming hit.
   * @returns {{type:'hit'|'block'|'parry'|'armor'|'break', dmg:number, crit?:boolean, ko?:boolean}|null}
   */
  receive(att, hit, o = {}) {
    if (this.invulnerable) return null;
    const F = this.F;
    const srcX = o.srcX ?? att.x;
    const dir = hit.dirFrom !== undefined ? (this.x >= hit.dirFrom ? 1 : -1) : this.x >= srcX ? 1 : -1; // direction the hit pushes us
    const a = att.fx;
    const move = o.move;
    const type = move?.type;
    const charged = !!o.charged;

    // ---- damage calculation
    let dmg = hit.dmg * att.stats.atk * F.damageMul;
    if (charged) dmg *= 1.45;
    if (type === 'heavy' && a.heavyDmg) dmg *= 1 + a.heavyDmg;
    if ((type === 'air' || type === 'launcher') && a.airDmg) dmg *= 1 + a.airDmg;
    if ((type === 'special' || o.projectile) && a.specialDmg) dmg *= 1 + a.specialDmg;
    if (type === 'overdrive' && a.overdriveDmg) dmg *= 1 + a.overdriveDmg;
    if (a.execute && this.hp / this.hpMax < 0.35) dmg *= 1 + a.execute;
    if (a.lastStand && att.hp / att.hpMax < 0.3) dmg *= 1 + a.lastStand;
    if (a.juggle && this.airborne) dmg *= 1 + a.juggle;
    if (a.punish && this.vulnerableState) dmg *= 1 + a.punish;
    if (a.momentum) dmg *= 1 + Math.min(0.2, this.comboHits * a.momentum);

    const blocking = (this.state === 'block' || this.state === 'blockstun') && dir === -this.facing;
    const unblockable = hit.unblockable || charged;

    if (blocking && !unblockable) {
      const parryWin = 0.13 * (1 + (this.fx.parryWindow || 0));
      if (this.state === 'block' && this.blockT <= parryWin && !hit.noParry) {
        this.blockT = 1;
        this.meter = Math.min(100, this.meter + 8 * this.stats.meter);
        if (this.fx.parryRefund) {
          this.energy = Math.min(this.stats.energyMax, this.energy + 30);
          this.meter = Math.min(100, this.meter + 15);
        }
        this.guard = Math.min(this.stats.guard, this.guard + this.stats.guard * 0.25);
        this.play('parry', 0.03);
        this.shield.hit(0.5, 0.5);
        this.glowBoost = 3;
        return { type: 'parry', dmg: 0, dir };
      }
      // normal block
      const gd = (hit.guard ?? 10) * (1 + (a.guardDmg || 0)) * (att.stats.atk > 1 ? 1 + (att.stats.atk - 1) * 0.5 : 1);
      this.guard -= gd;
      this.guardLock = 1.1;
      let chip = 0;
      if (!this.fx.noChip) {
        const cf = hit.chip ?? (type === 'special' || type === 'overdrive' || o.projectile ? 0.12 : 0.03);
        chip = dmg * cf / this.stats.def;
        this.hp = Math.max(1, this.hp - chip);
      }
      if (this.fx.blockEnergy) this.energy = Math.min(this.stats.energyMax, this.energy + this.fx.blockEnergy);
      if (this.fx.thorns && !o.projectile && !o.remote) att.hp = Math.max(1, att.hp - this.fx.thorns);
      this.meter = Math.min(100, this.meter + dmg * 0.25 * this.stats.meter);
      att.meter = Math.min(100, att.meter + dmg * 0.3 * att.stats.meter);
      if (this.guard <= 0) {
        this.guardBreak(dir);
        return { type: 'break', dmg: chip, dir };
      }
      this.setState('blockstun', hit.block ?? 0.2);
      this.vx = (dir * (hit.kbx ?? 3) * 0.75) / this.stats.weight;
      this.animator.play(this.anims.blockHit, 0.02);
      this.shield.hit(0.5 + rand(-0.15, 0.15), 0.5 + rand(-0.2, 0.2));
      return { type: 'block', dmg: chip, dir };
    }
    if (blocking && unblockable) {
      this.guard = 0;
      dmg *= 0.75;
    }

    // ---- clean hit
    let crit = false;
    if (chance(att.stats.crit)) {
      crit = true;
      dmg *= att.stats.critDmg;
    }
    let first = false;
    if (att.firstStrikeReady) {
      att.firstStrikeReady = false;
      if (a.firstStrike) {
        dmg *= 1 + a.firstStrike;
        first = true;
      }
    }
    // combo scaling
    const n = this.comboHits;
    const minScale = a.comboScale ? 0.5 : 0.3;
    const decay = a.comboScale ? 0.06 : 0.1;
    dmg *= Math.max(minScale, 1 - Math.max(0, n - 1) * decay);
    dmg /= this.stats.def;
    if (this.fx.lastDef && this.hp / this.hpMax < 0.25) dmg *= 1 - this.fx.lastDef;

    const armored = (this.hasArmor || (this.modArmor && !this.armorBroken && hit.level < 3)) && type !== 'overdrive' && !(blocking && unblockable);
    if (armored) dmg *= 0.75;

    if (this.barrier > 0) {
      const ab = Math.min(this.barrier, dmg);
      this.barrier -= ab;
      dmg -= ab;
      if (this.barrier <= 0) F.onBarrierBreak(this);
    }
    this.hp -= dmg;
    this.flashT = 1;
    this.comboHits++;
    this.comboDmg += dmg;
    const mg = dmg * 0.95;
    att.meter = Math.min(100, att.meter + mg * att.stats.meter * F.meterMul);
    this.meter = Math.min(100, this.meter + dmg * 0.6 * this.stats.meter * F.meterMul);
    if (a.lifesteal) att.hp = Math.min(att.hpMax, att.hp + dmg * a.lifesteal);
    if (a.burn) {
      this.burnT = 3;
      this.burnDps = a.burn / 3;
    }

    if (this.fx.secondWind && !this.windUsed && this.hp > 0 && this.hp / this.hpMax < 0.25) {
      this.windUsed = true;
      this.hp += this.hpMax * this.fx.secondWind;
      F.onSecondWind(this);
    }
    if (this.hp <= 0) {
      if (this.fx.revive && !this.reviveUsed) {
        this.reviveUsed = true;
        this.hp = this.hpMax * this.fx.revive;
        this.invulnT = 1.2;
        this.setState('idle');
        this.play('idle', 0.1);
        this.comboHits = 0;
        F.onRevive(this);
        return { type: 'hit', dmg, crit, dir, first, revived: true };
      }
      this.hp = 0;
      this.dead = true;
      this.hidden = false;
      this.juggle = 0;
      this.vx = (dir * Math.max(7, (hit.kbx ?? 4) * 1.2));
      this.vy = Math.max(9, hit.kby || 0);
      this.y = Math.max(this.y, 0.02);
      this.setState('launched');
      this.animator.play(this.anims.launched, 0.05);
      return { type: 'hit', dmg, crit, dir, ko: true, first };
    }

    if (armored) return { type: 'armor', dmg, crit, dir, first };

    if (blocking && unblockable) {
      this.guardBreak(dir);
      return { type: 'break', dmg, dir, crit };
    }

    // ---- reaction
    const stunMul = (1 - (this.fx.stunResist || 0)) * (1 + (a.shock || 0)) * Math.pow(0.95, Math.max(0, n - 2));
    const air = this.airborne || this.state === 'launched';
    if (this.state === 'attack' && this.move) this.hidden = false;
    if (hit.hold) {
      // pinned in place by multi-hit supers
      this.vx = 0;
      if (air) {
        this.vy = 1.5;
        this.setState('launched');
        this.animator.play(this.anims.launched, 0.1, false);
      } else {
        this.setState('hitstun', hit.stun * stunMul);
        this.animator.play(n % 2 ? this.anims.hitHigh : this.anims.hitLow, 0.03);
      }
    } else if ((hit.kby || 0) > 0 || air || hit.knockdown) {
      this.juggle += air ? 1 : 0;
      const kby = hit.kby > 0 ? hit.kby : hit.knockdown && !air ? 5.5 : 6.5;
      this.vy = kby * (air && hit.kby > 0 ? Math.max(0.55, 1 - this.juggle * 0.12) : 1) / Math.sqrt(this.stats.weight);
      this.vx = (dir * (hit.kbx ?? 3) * (hit.knockdown && !hit.kby ? 0.7 : 1)) / this.stats.weight;
      this.y = Math.max(this.y, 0.02);
      this.setState('launched');
      this.animator.play(this.anims.launched, 0.06);
    } else {
      this.setState('hitstun', hit.stun * stunMul);
      this.vx = (dir * (hit.kbx ?? 3)) / this.stats.weight;
      const an = hit.anim || (hit.level >= 3 ? 'hitHeavy' : n % 2 ? 'hitLow' : 'hitHigh');
      this.animator.play(this.anims[an], 0.03);
    }
    return { type: 'hit', dmg, crit, dir, first };
  }

  guardBreak(dir) {
    this.guard = this.stats.guard * 0.5;
    this.guardLock = 0;
    this.armorBroken = true;
    this.setState('stunned', 1.5 * (1 - (this.fx.breakResist || 0)));
    this.vx = dir * 3;
    this.play('stunned', 0.08);
  }

  /** attacker got parried */
  parried(dir) {
    this.hidden = false;
    this.setState('stunned', 1.05);
    this.vx = -dir * 4.5;
    this.play('stunned', 0.06);
  }

  // -------------------------------------------------------------------------
  // per render-frame visuals
  // -------------------------------------------------------------------------
  preStep() {
    this.trailActive = {};
  }

  applyVisual(dt, time = 0) {
    const rig = this.rig;
    const pose = this.animator.pose;
    rig.applyPose(pose, this.grounded && !this.moveScriptedY ? this.animator.ground : this.animator.ground * (this.y < 0.3 ? 1 - this.y / 0.3 : 0));
    // yaw
    const target = this.facing > 0 ? -OPEN_YAW : Math.PI + OPEN_YAW;
    let d = target - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * (1 - Math.exp(-dt * 16));
    rig.pivot.rotation.y = this.yaw + (rig.poseYaw || 0) * this.facing;
    let hover = 0;
    if (this.chassis === 'tempest' && this.state !== 'down' && this.state !== 'launched') hover = 0.12 + Math.sin(time * 2.4 + this.idx) * 0.04;
    rig.root.position.set(this.x, this.y + hover * this.scale, 0);
    rig.root.visible = !this.hidden;
    rig.root.updateMatrixWorld(true);

    // glow & hit flash
    const M = this.M;
    this.glowBoost = Math.max(0, this.glowBoost - dt * 4);
    let g = 1 + Math.sin(time * 3 + this.idx * 2) * 0.08 + this.glowBoost;
    if (this.meter >= 100) g += 0.5 + Math.sin(time * 12) * 0.35;
    if (this.state === 'stunned') g *= 0.35 + (Math.sin(time * 40) > 0 ? 0.5 : 0);
    if (this.dead) g = 0.12;
    M.glow.emissiveIntensity = M.glowBase * g;
    M.visor.emissiveIntensity = M.glowBase * 0.9 * g;
    this.flashT = Math.max(0, this.flashT - dt * 7);
    const f = this.flashT * this.flashT * 1.6;
    for (const m of M.flashable) m.emissive.setRGB(f, f, f);

    // chassis specific dynamics
    const dyn = rig.dynamic;
    if (dyn.blade) {
      const m = this.move;
      const on = this.state === 'attack' && m && m.blade && this.moveT >= m.blade[0] && this.moveT <= m.blade[1];
      const sY = dyn.blade.scale.y;
      const ny = sY + ((on ? 1 : 0) - sY) * (1 - Math.exp(-dt * (on ? 30 : 14)));
      dyn.blade.scale.set(1, Math.max(0.001, ny), 1);
      dyn.blade.visible = ny > 0.02;
    }
    if (dyn.halo) {
      dyn.haloShards.rotation.z += dt * (0.8 + (this.meter / 100) * 2.5 + (this.state === 'attack' ? 3 : 0));
      dyn.haloRing.rotation.z -= dt * 0.5;
      const s = 1 + (this.state === 'attack' && this.move?.type === 'overdrive' ? Math.min(1, this.moveT) * 0.6 : 0);
      dyn.halo.scale.setScalar(dyn.halo.scale.x + (s - dyn.halo.scale.x) * (1 - Math.exp(-dt * 6)));
    }

    // trails
    for (const k of Object.keys(this.trails)) {
      const tr = this.trails[k];
      if (this.trailActive && this.trailActive[k] && !this.hidden) {
        const an = rig.anchors;
        let a, b;
        if (k === 'R') { a = an.baseR || an.elbowR; b = an.tipR; }
        else if (k === 'L') { a = an.baseL || an.elbowL; b = an.tipL; }
        else if (k === 'footR') { a = an.kneeR; b = an.footR; }
        else { a = an.kneeL; b = an.footL; }
        a.getWorldPosition(_a);
        b.getWorldPosition(_b);
        tr.push(_a, _b);
      }
      tr.update(dt, time);
    }
    if (this.scarf) {
      if (!this.hidden && !this.dead) {
        rig.anchors.neck.getWorldPosition(_a);
        _b.copy(_a);
        _b.y += 0.2 * this.scale;
        _a.y -= 0.06;
        this.scarf.push(_a, _b);
      }
      // drift backwards & flutter so the scarf flows even when standing still
      const pts = this.scarf.pts;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        const w = Math.sin(time * 9 - i * 0.7) * 0.5;
        const dx = -this.facing * 1.6 * dt, dy = (w * 0.9 - 0.25) * dt;
        p.a.x += dx; p.b.x += dx; p.a.y += dy; p.b.y += dy * 1.3;
      }
      this.scarf.update(dt, time);
    }

    // shield
    const blocking = this.state === 'block' || this.state === 'blockstun';
    this.shield.target = blocking ? 1 : 0;
    this.shield.update(dt, time, this.x, this.y, this.facing, this.height, clamp(this.guard / this.stats.guard, 0, 1));

    for (const gh of this.ghosts) gh.update(dt);

    // battle damage
    if (!this.dead && this.hp / this.hpMax < 0.35 && chance(dt * 5)) {
      const names = ['core', 'elbowR', 'kneeL', 'back', 'head'];
      const p = this.anchor(names[(Math.random() * names.length) | 0]);
      this.F.fx.sparks(p, { count: 4, speed: 4, color: 0xfff0c0, color2: this.color, life: 0.4 });
      if (chance(0.4)) this.F.fx.smoke(p, { count: 1, size: 0.3, alpha: 0.35, life: 1.1, up: 1.4 });
    }
    if (this.chassis === 'tempest' && !this.dead && this.grounded && chance(dt * 10)) {
      const p = this.anchor(chance(0.5) ? 'footL' : 'footR');
      this.F.fx.glow(p, { color: this.color, size: 0.25, size1: 0.02, life: 0.3, vy: -1.5, intensity: 1.2 });
    }
  }

  dispose() {
    const sc = this.F.scene;
    sc.remove(this.rig.root);
    for (const t of Object.values(this.trails)) { sc.remove(t.mesh); t.dispose(); }
    if (this.scarf) { sc.remove(this.scarf.mesh); this.scarf.dispose(); }
    sc.remove(this.shield.mesh);
    this.shield.dispose();
    for (const g of this.ghosts) { sc.remove(g.group); g.dispose(); }
    disposeRig(this.rig);
  }
}
