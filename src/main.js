import * as THREE from 'three';
import { Renderer } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { AudioEngine } from './engine/audio.js';
import { Profile, computeStats } from './game/profile.js';
import { Fight, enemyLoadout } from './game/fight.js';
import { aiLevelFor } from './game/ai.js';
import { createArena } from './game/arenas.js';
import { buildRobot, disposeRig } from './robots/chassis.js';
import { Animator } from './robots/anim.js';
import { getMoveset } from './robots/moveset.js';
import { CHASSIS, STAGE_BY_ID, MODIFIERS, MODS, SECTORS, resolvePaint } from './game/data.js';
import { HUD } from './ui/hud.js';
import { UI } from './ui/ui.js';
import { damp, clamp, pick } from './engine/utils.js';

const QUERY = new URLSearchParams(location.search);

const VIEWS = {
  title: { pos: [0.6, 1.25, 7.4], look: [0, 1.55, 0], spin: 0.25 },
  menu: { pos: [-1.5, 1.5, 7.6], look: [-1.9, 1.38, 0], spin: 0.3 },
  garage: { pos: [0.3, 1.55, 8.2], look: [0.3, 1.32, 0], spin: 0 },
  campaign: { pos: [-0.75, 1.6, 8.8], look: [-0.95, 1.3, 0], spin: 0.35 },
  quick: { pos: [-1.7, 1.6, 8.6], look: [-2.0, 1.3, 0], spin: 0.35 },
  results: { pos: [-1.6, 1.3, 7.4], look: [-2.0, 1.5, 0], spin: 0.2 },
};

/** The 3D scene behind the menus: a hangar turntable showing a robot. */
class Showroom {
  constructor(app) {
    this.app = app;
    this.camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camPos = new THREE.Vector3(0, 1.4, 9);
    this.camLook = new THREE.Vector3(0, 1.4, 0);
    this.view = VIEWS.title;
    this.rig = null;
    this.key = '';
    this.animator = new Animator();
    this.yaw = -0.5;
    this.yawVel = 0;
    this.dragging = false;
    this.time = 0;
    this.build();
    const c = app.renderer.canvas;
    let lastX = 0;
    c.addEventListener('pointerdown', (e) => { this.dragging = true; lastX = e.clientX; });
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging || app.fight) return;
      this.yawVel = (e.clientX - lastX) * 0.012 * 60;
      this.yaw += (e.clientX - lastX) * 0.012;
      lastX = e.clientX;
    });
  }

  build() {
    this.arena = createArena('hangar', this.app.renderer);
    this.scene = this.arena.scene;
    if (this.rig) this.scene.add(this.rig.root);
  }

  rebuild() {
    if (this.rig) this.scene.remove(this.rig.root);
    this.arena.dispose();
    this.build();
    this.activate();
  }

  activate() {
    const R = this.app.renderer;
    R.setScene(this.scene, this.camera);
    const g = this.arena.grade;
    R.setGrade(g.shadow, g.high, g.bloom, g.exposure);
    R.setDesat(0);
  }

  setView(name) {
    this.view = VIEWS[name] || VIEWS.menu;
  }

  setRobot(chassisId, paint, visuals, scale = 1, anim = 'idle') {
    const key = JSON.stringify([chassisId, paint, visuals, scale]);
    if (key === this.key) return;
    this.key = key;
    if (this.rig) {
      this.scene.remove(this.rig.root);
      disposeRig(this.rig);
    }
    this.rig = buildRobot(chassisId, paint, visuals);
    this.rig.root.scale.setScalar(scale);
    this.rig.root.position.y = this.arena.tableTop;
    this.scene.add(this.rig.root);
    this.ms = getMoveset(chassisId);
    this.animator = new Animator();
    this.animator.play(this.ms.anims.idle, 0);
    this.arena.accent(paint.glow);
    this.chassisId = chassisId;
    this.flourish();
  }

  flourish() {
    // a short power-up pose when a new build rolls onto the turntable
    this.animator.play(this.ms.anims.intro, 0);
    this.animator.t = 0.45;
    this.introT = 0.9;
    this.glow = 3;
  }

  update(dt) {
    this.time += dt;
    const v = this.view;
    const aspect = this.camera.aspect;
    const narrow = aspect < 1;
    const px = narrow ? 0 : v.pos[0], lx = narrow ? 0 : v.look[0];
    const pz = v.pos[2] * (narrow ? 1.5 : aspect < 1.5 ? 1.15 : 1);
    this.camPos.x = damp(this.camPos.x, px, 3.2, dt);
    this.camPos.y = damp(this.camPos.y, v.pos[1] + (narrow ? 0.4 : 0), 3.2, dt);
    this.camPos.z = damp(this.camPos.z, pz, 3.2, dt);
    this.camLook.x = damp(this.camLook.x, lx, 3.2, dt);
    this.camLook.y = damp(this.camLook.y, v.look[1] - (narrow ? 0.9 : 0), 3.2, dt);
    this.camera.position.set(this.camPos.x + Math.sin(this.time * 0.3) * 0.12, this.camPos.y + Math.sin(this.time * 0.23) * 0.05, this.camPos.z);
    this.camera.lookAt(this.camLook.x, this.camLook.y, 0);
    if (!this.dragging) {
      this.yaw += (v.spin + this.yawVel) * dt;
      this.yawVel = damp(this.yawVel, 0, 3, dt);
    }
    this.arena.table.rotation.y = this.yaw;
    this.arena.update(dt, this.time, null);
    const rig = this.rig;
    if (rig) {
      if (this.introT > 0) {
        this.introT -= dt;
        if (this.introT <= 0) this.animator.play(this.ms.anims.idle, 0.3);
      }
      this.animator.update(dt);
      rig.applyPose(this.animator.pose, 1);
      rig.pivot.rotation.y = this.yaw - 0.4;
      const hover = this.chassisId === 'tempest' ? 0.12 + Math.sin(this.time * 2.4) * 0.04 : 0;
      rig.root.position.y = this.arena.tableTop + hover;
      this.glow = Math.max(0, (this.glow || 0) - dt * 3);
      const M = rig.materials;
      M.glow.emissiveIntensity = M.glowBase * (1 + Math.sin(this.time * 3) * 0.1 + this.glow);
      M.visor.emissiveIntensity = M.glowBase * 0.9 * (1 + this.glow);
      if (rig.dynamic.haloShards) {
        rig.dynamic.haloShards.rotation.z += dt * 0.9;
        rig.dynamic.haloRing.rotation.z -= dt * 0.5;
      }
    }
  }
}

class App {
  constructor() {
    const canvas = document.getElementById('game');
    const uiRoot = document.getElementById('ui');
    this.profile = new Profile();
    this.renderer = new Renderer(canvas);
    const s = this.profile.data.settings;
    this.renderer.dynamicRes = s.dynamicRes;
    this.renderer.setQuality(QUERY.get('q') || s.quality);
    this.input = new Input();
    this.audio = new AudioEngine();
    this.audio.setVolumes(s.sfx, s.music);
    this.hud = new HUD(uiRoot, this.input);
    this.ui = new UI(uiRoot, this);
    this.showroom = new Showroom(this);
    this.fight = null;
    this.lastCfg = null;
    this.state = 'title';
    this.paused = false;

    this.input.onAny = () => {
      this.audio.unlock();
      if (this.state === 'title' && this._titleReady) this.go('menu');
    };
    this.input.onPause = () => {
      if (this.fight) this.togglePause();
      else if (this.ui.modalOpen) this.ui.closeModal();
      else if (this.state !== 'title' && this.state !== 'menu' && this.state !== 'results') this.go('menu');
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.fight && !this.paused && this.fight.phase === 'fight') this.togglePause(true);
    });

    this.showroom.activate();
    this.refreshRobot(true);
    this.go('title');
    this.audio.playMusic('menu');
    this.renderer.setFade(1);
    this.renderer.fadeTo(0, 1.2);
    setTimeout(() => (this._titleReady = true), 500);

    this.last = performance.now();
    this.frame = this.frame.bind(this);
    // ?manual disables the real-time loop so automated tests can step frames deterministically
    this.manual = QUERY.has('manual');
    if (!this.manual) requestAnimationFrame(this.frame);
    window.__app = this;
  }

  // ---- navigation -----------------------------------------------------------
  go(state) {
    this.state = state;
    const ui = this.ui;
    ui.closeModal();
    this.showroom.setView(state);
    switch (state) {
      case 'title': ui.showTitle(); break;
      case 'menu': ui.showMain(); this.refreshRobot(); break;
      case 'garage': ui.showGarage(); this.refreshRobot(); break;
      case 'campaign': ui.showCampaign(); this.previewStage(ui.selStage); break;
      case 'quick': ui.showQuick(); this.previewQuick(); break;
      default: break;
    }
  }

  refreshRobot(force = false) {
    const lo = this.profile.loadout();
    const st = computeStats(lo.chassis, lo.mods, []);
    if (force) this.showroom.key = '';
    this.showroom.setRobot(lo.chassis, lo.paint, st.visuals);
  }

  previewStage(id) {
    const st = STAGE_BY_ID[id];
    if (!st) return;
    const e = enemyLoadout(st.enemy);
    const s = computeStats(e.chassis, e.mods, []);
    this.showroom.setRobot(e.chassis, e.paint, s.visuals, e.boss ? 1.12 : 1);
  }

  previewQuick() {
    const q = this.ui.quick;
    const e = this.quickEnemy(q);
    const s = computeStats(e.chassis, e.mods, []);
    this.showroom.setRobot(e.chassis, e.paint, s.visuals);
  }

  quickEnemy(q) {
    // deterministic loadout for a given frame + difficulty
    const n = Math.min(5, Math.floor(q.level / 3));
    const slots = ['arms', 'plating', 'core', 'legs', 'chip'];
    const mods = [];
    for (let i = 0; i < n; i++) {
      const pool = MODS.filter((m) => m.slot === slots[i] && m.price > 0 && m.rarity <= 1 + Math.floor(q.level / 5));
      if (pool.length) mods.push(pool[(q.level + i * 3) % pool.length].id);
    }
    const names = { vanguard: 'SPARRING KNIGHT', bastion: 'IRON SPARRER', wraith: 'SHADOW SPARRER', tempest: 'STORM SPARRER' };
    return { chassis: q.chassis, mods, perks: [], paint: CHASSIS[q.chassis].paint, name: names[q.chassis], level: q.level, boss: false };
  }

  // ---- fights ---------------------------------------------------------------
  startStage(id) {
    const st = STAGE_BY_ID[id];
    const sector = SECTORS.find((s) => s.id === st.sector);
    this.launch({
      stageId: id,
      p1: this.profile.loadout(),
      p2: enemyLoadout(st.enemy),
      arena: st.arena,
      rounds: st.rounds,
      modifier: st.modifier,
      modifierInfo: st.modifier ? MODIFIERS[st.modifier] : null,
      aiLevel: aiLevelFor(st.enemy.level, st.boss),
      hints: st.enemy.level <= 3,
      subtitle: `${sector.name} · ${st.boss ? 'BOSS BOUT' : 'BOUT ' + st.id}`,
      title: `${st.id} · ${st.name}`,
    });
  }

  startQuick(q) {
    this.launch({
      p1: this.profile.loadout(),
      p2: this.quickEnemy(q),
      arena: q.arena,
      rounds: 2,
      aiLevel: aiLevelFor(q.level),
      subtitle: 'QUICK BATTLE',
      title: 'Quick Battle',
    });
  }

  launch(cfg) {
    if (this.busy) return;
    this.busy = true;
    this.lastCfg = cfg;
    this.audio.unlock();
    this.renderer.fadeTo(1, 4);
    setTimeout(() => {
      this.ui.clear();
      this.renderer.setFade(1);
      if (this.fight) this.fight.dispose();
      const run = { ...cfg, p1: this.profile.loadout() };
      run.onEnd = (res) => this.onFightEnd(run, res);
      this.fight = new Fight(this, run);
      this.state = 'fight';
      this.audio.playMusic(cfg.arena);
      this.busy = false;
    }, 320);
  }

  retry() {
    if (this.lastCfg) this.launch(this.lastCfg);
  }

  onFightEnd(cfg, res) {
    const summary = this.profile.applyResult({ stageId: cfg.stageId, won: res.won, stars: res.stars, maxCombo: res.maxCombo, perfect: res.perfect, enemyLevel: cfg.p2.level });
    this.endFight();
    this.state = 'results';
    this.showroom.setView('results');
    this.refreshRobot(true);
    this.ui.showResults(summary, { ...res, stageId: cfg.stageId, title: cfg.title });
    this.audio.play(res.won ? 'levelUp' : 'deny');
  }

  endFight() {
    if (this.fight) {
      this.fight.dispose();
      this.fight = null;
    }
    this.paused = false;
    this.showroom.activate();
    this.renderer.setFade(1);
    this.renderer.fadeTo(0, 2);
    this.audio.playMusic('menu');
  }

  quitFight() {
    const cfg = this.lastCfg;
    this.endFight();
    this.refreshRobot(true);
    this.go(cfg && cfg.stageId ? 'campaign' : 'quick');
  }

  togglePause(force) {
    if (!this.fight) return;
    const p = force ?? !this.paused;
    if (p && this.fight.phase !== 'fight' && this.fight.phase !== 'ready') return;
    this.paused = p;
    this.fight.setPaused(p);
    if (p) {
      this.ui.showPause();
      this.audio.play('uiSelect');
    } else this.ui.closeModal();
  }

  setSetting(key, value) {
    const s = this.profile.data.settings;
    s[key] = value;
    this.profile.save();
    if (key === 'quality') {
      this.renderer.setQuality(value);
      if (!this.fight) this.showroom.rebuild();
      else this.ui.toast('Quality applies fully from the next bout');
    } else if (key === 'dynamicRes') {
      this.renderer.dynamicRes = value;
      if (!value) { this.renderer.resScale = 1; this.renderer.resize(); }
    } else if (key === 'sfx' || key === 'music') this.audio.setVolumes(s.sfx, s.music);
  }

  // ---- main loop ------------------------------------------------------------
  frame(now) {
    requestAnimationFrame(this.frame);
    const ms = now - this.last;
    this.last = now;
    const dt = clamp(ms / 1000, 0.0005, 0.05);
    this.input.pollGamepad();
    if (this.fight) this.fight.update(dt);
    else {
      this.input.takePresses();
      this.showroom.update(dt);
    }
    this.renderer.update(dt, this.paused ? undefined : ms);
    this.renderer.render();
  }

  /** deterministic stepping for automated tests */
  debugStep(dt = 1 / 60, n = 1) {
    for (let i = 0; i < n; i++) {
      if (this.fight) this.fight.update(dt);
      else this.showroom.update(dt);
      this.renderer.update(dt);
    }
    this.renderer.render();
  }
}

function boot() {
  try {
    new App();
    window.__ready = true;
  } catch (e) {
    console.error(e);
    window.__error = String(e.stack || e);
    document.getElementById('ui').innerHTML = `<div class="fatal"><h2>Could not start the renderer</h2><p>APEX CHASSIS needs WebGL 2. Try a recent version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.</p><pre>${String(e.message || e)}</pre></div>`;
  }
}
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();
