import * as THREE from 'three';
import { el, hexToCss, clamp01 } from '../engine/utils.js';

const _v = new THREE.Vector3();

/** In-fight heads-up display. Pure DOM so text stays razor sharp at any resolution. */
export class HUD {
  constructor(root, input) {
    this.input = input;
    this.el = el('div', 'hud hidden');
    root.appendChild(this.el);
    const side = (i) => `
      <div class="pl p${i + 1}">
        <div class="pl-head"><span class="pl-name"></span><span class="pl-lv"></span><span class="pips"></span></div>
        <div class="hp"><i class="hp-lag"></i><i class="hp-fill"></i><i class="hp-barrier"></i><b class="hp-ticks"></b></div>
        <div class="sub">
          <div class="bar guard"><i></i><span>GUARD</span></div>
          <div class="bar en"><i></i><span>ENERGY</span></div>
        </div>
      </div>`;
    this.el.innerHTML = `
      <div class="hud-top">${side(0)}<div class="timer"><span>60</span></div>${side(1)}</div>
      <div class="od p1"><div class="od-label">OVERDRIVE</div><div class="od-bar"><i></i></div><div class="od-ready">READY <kbd>O</kbd></div></div>
      <div class="od p2"><div class="od-label">OVERDRIVE</div><div class="od-bar"><i></i></div><div class="od-ready">READY</div></div>
      <div class="combo p1"></div><div class="combo p2"></div>
      <div class="movename p1"></div><div class="movename p2"></div>
      <div class="modifier"></div>
      <div class="hints hidden"></div>
      <div class="popups"></div>
      <div class="announce"></div>
      <div class="versus"></div>
      <div class="letterbox lb-top"></div><div class="letterbox lb-bot"></div>
      <div class="touch hidden">
        <div class="stick"><div class="stick-knob"></div></div>
        <div class="tbtns">
          <button data-a="overdrive" class="tb od">OD</button>
          <button data-a="block" class="tb blk">BLOCK</button>
          <button data-a="dash" class="tb dsh">DASH</button>
          <button data-a="special" class="tb sp">SP</button>
          <button data-a="heavy" class="tb hv">H</button>
          <button data-a="light" class="tb lt">L</button>
        </div>
        <button class="tpause" data-pause="1">II</button>
      </div>`;
    const q = (s) => this.el.querySelector(s);
    this.sides = [0, 1].map((i) => {
      const p = q(`.pl.p${i + 1}`);
      return {
        root: p, name: p.querySelector('.pl-name'), lv: p.querySelector('.pl-lv'), pips: p.querySelector('.pips'),
        hp: p.querySelector('.hp-fill'), lag: p.querySelector('.hp-lag'), barrier: p.querySelector('.hp-barrier'), hpWrap: p.querySelector('.hp'),
        guard: p.querySelector('.guard i'), guardWrap: p.querySelector('.guard'), en: p.querySelector('.en i'), enWrap: p.querySelector('.en'),
        od: q(`.od.p${i + 1}`), odFill: q(`.od.p${i + 1} .od-bar i`), combo: q(`.combo.p${i + 1}`), move: q(`.movename.p${i + 1}`),
        cache: {},
      };
    });
    this.timerEl = q('.timer span');
    this.timerWrap = q('.timer');
    this.popups = q('.popups');
    this.announceEl = q('.announce');
    this.versusEl = q('.versus');
    this.modEl = q('.modifier');
    this.touch = q('.touch');
    this.fight = null;
    this.lastTimer = -1;
    this.comboTimers = [0, 0];
    this.setupTouch();
  }

  setupTouch() {
    const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.isTouch = isTouch;
    if (!isTouch) return;
    this.touch.classList.remove('hidden');
    const inp = this.input;
    for (const b of this.touch.querySelectorAll('.tb')) {
      const a = b.dataset.a;
      const on = (e) => { e.preventDefault(); b.classList.add('on'); inp.setVirtual(a, true); };
      const off = (e) => { e.preventDefault(); b.classList.remove('on'); inp.setVirtual(a, false); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
    }
    this.touch.querySelector('.tpause').addEventListener('pointerdown', (e) => { e.preventDefault(); inp.onPause?.(); });
    const stick = this.touch.querySelector('.stick');
    const knob = this.touch.querySelector('.stick-knob');
    let id = null, cx = 0, cy = 0, jumped = false;
    const set = (dx, dy) => {
      const r = 46;
      const l = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, l / r);
      knob.style.transform = `translate(${(dx / l) * k * r}px, ${(dy / l) * k * r}px)`;
      inp.setVirtual('left', dx < -16);
      inp.setVirtual('right', dx > 16);
      inp.setVirtual('down', dy > 22);
      if (dy < -26) {
        if (!jumped) { jumped = true; inp.press('jump'); }
      } else jumped = false;
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      stick.setPointerCapture(id);
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      set(e.clientX - cx, e.clientY - cy);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e.clientX - cx, e.clientY - cy); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      for (const a of ['left', 'right', 'down']) inp.setVirtual(a, false);
      jumped = false;
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
  }

  showFight(fight) {
    this.fight = fight;
    this.el.classList.remove('hidden');
    this.popups.innerHTML = '';
    this.announceEl.innerHTML = '';
    this.versusEl.innerHTML = '';
    this.lastTimer = -1;
    fight.fighters?.forEach?.(() => {});
    const mod = fight.cfg.modifier;
    this.modEl.innerHTML = mod && fight.cfg.modifierInfo ? `<b>${fight.cfg.modifierInfo.name}</b><span>${fight.cfg.modifierInfo.desc}</span>` : '';
    this.modEl.classList.toggle('on', !!mod);
    const hints = this.el.querySelector('.hints');
    const show = !!fight.cfg.hints && !this.isTouch;
    hints.classList.toggle('hidden', !show);
    if (show) hints.innerHTML = [['A/D', 'move'], ['W', 'jump'], ['J', 'light'], ['K', 'heavy'], ['L', 'special'], ['I', 'block / parry'], ['SPACE', 'dash'], ['O', 'overdrive']].map(([k, v]) => `<span><b>${k}</b>${v}</span>`).join('');
    for (const s of this.sides) {
      s.cache = {};
      s.combo.className = s.combo.className.replace(/ show| end/g, '');
      s.move.classList.remove('show');
    }
    this.el.classList.toggle('demo', !!fight.cfg.demo);
    this._needNames = true;
  }

  hideFight() {
    this.el.classList.add('hidden');
    this.fight = null;
    this.letterbox(false);
  }

  setRounds(w1, w2, need) {
    const pips = (w) => Array.from({ length: need }, (_, i) => `<i class="${i < w ? 'won' : ''}"></i>`).join('');
    this.sides[0].pips.innerHTML = pips(w1);
    this.sides[1].pips.innerHTML = pips(w2);
  }

  updateFight(F, dt) {
    if (this._needNames && F.fighters.length === 2) {
      this._needNames = false;
      F.fighters.forEach((f, i) => {
        const s = this.sides[i];
        s.name.textContent = f.name;
        s.lv.textContent = F.cfg[i ? 'p2' : 'p1'].level ? `LV ${F.cfg[i ? 'p2' : 'p1'].level}` : '';
        const c = hexToCss(f.color);
        s.root.style.setProperty('--c', c);
        s.od.style.setProperty('--c', c);
        s.combo.style.setProperty('--c', c);
        s.move.style.setProperty('--c', c);
      });
    }
    F.fighters.forEach((f, i) => {
      const s = this.sides[i];
      const c = s.cache;
      const set = (key, node, v) => {
        const r = Math.round(v * 500) / 500;
        if (c[key] !== r) { c[key] = r; node.style.transform = `scaleX(${r})`; }
      };
      const hp = clamp01(f.hp / f.hpMax);
      set('hp', s.hp, hp);
      set('lag', s.lag, clamp01(f.hpLag / f.hpMax));
      set('bar', s.barrier, clamp01(f.barrier / f.hpMax));
      set('guard', s.guard, clamp01(f.guard / f.stats.guard));
      set('en', s.en, clamp01(f.energy / f.stats.energyMax));
      set('od', s.odFill, clamp01(f.meter / 100));
      const low = hp < 0.25;
      if (c.low !== low) { c.low = low; s.hpWrap.classList.toggle('low', low); }
      const ready = f.meter >= 100;
      if (c.ready !== ready) { c.ready = ready; s.od.classList.toggle('ready', ready); }
      const gl = f.guard / f.stats.guard < 0.3 || f.state === 'stunned';
      if (c.gl !== gl) { c.gl = gl; s.guardWrap.classList.toggle('low', gl); }
      if (this.comboTimers[i] > 0) {
        this.comboTimers[i] -= dt;
        if (this.comboTimers[i] <= 0) s.combo.classList.remove('show', 'end');
      }
    });
    const t = Math.ceil(F.timer);
    if (t !== this.lastTimer) {
      this.lastTimer = t;
      this.timerEl.textContent = t;
      this.timerWrap.classList.toggle('low', t <= 10);
    }
  }

  flashEnergy(i) {
    const w = this.sides[i].enWrap;
    w.classList.remove('deny');
    void w.offsetWidth;
    w.classList.add('deny');
  }

  announce(text, sub = '', style = 'round', dur = 1.2) {
    const n = el('div', `ann ${style}`, `<span data-t="${text}">${text}</span>${sub ? `<small>${sub}</small>` : ''}`);
    n.style.setProperty('--dur', dur + 's');
    this.announceEl.innerHTML = '';
    this.announceEl.appendChild(n);
    setTimeout(() => n.remove(), dur * 1000 + 400);
  }

  versus(a, b, sub) {
    this.versusEl.innerHTML = `<div class="vs-a">${a}</div><div class="vs-x">VS</div><div class="vs-b">${b}</div>${sub ? `<div class="vs-sub">${sub}</div>` : ''}`;
    this.versusEl.classList.remove('show');
    void this.versusEl.offsetWidth;
    this.versusEl.classList.add('show');
    setTimeout(() => this.versusEl.classList.remove('show'), 2300);
  }

  toScreen(x, y) {
    const cam = this.fight?.camera;
    if (!cam) return null;
    _v.set(x, y, 0.3).project(cam);
    return { x: (_v.x * 0.5 + 0.5) * window.innerWidth, y: (-_v.y * 0.5 + 0.5) * window.innerHeight };
  }

  popup(text, x, y, cls = '') {
    const p = this.toScreen(x, y);
    if (!p) return;
    const n = el('div', `pop ${cls}`, text);
    n.style.left = p.x + 'px';
    n.style.top = p.y + 'px';
    this.popups.appendChild(n);
    n.addEventListener('animationend', () => n.remove());
    if (this.popups.childElementCount > 40) this.popups.firstChild.remove();
  }

  damage(dmg, x, y, crit, attIdx) {
    if (dmg < 0.5) return;
    const p = this.toScreen(x, y);
    if (!p) return;
    const n = el('div', `dmg ${crit ? 'crit' : ''} a${attIdx}`, String(Math.round(dmg)));
    n.style.left = p.x + (Math.random() - 0.5) * 30 + 'px';
    n.style.top = p.y + 'px';
    n.style.fontSize = Math.min(52, 20 + dmg * 1.3) + 'px';
    this.popups.appendChild(n);
    n.addEventListener('animationend', () => n.remove());
  }

  combo(i, hits, dmg) {
    const c = this.sides[i].combo;
    c.innerHTML = `<b>${hits}</b><span>HITS</span><em>${Math.round(dmg)} DMG</em>`;
    c.classList.remove('end', 'bump');
    void c.offsetWidth;
    c.classList.add('show', 'bump');
    this.comboTimers[i] = 2.2;
  }

  comboEnd(i, hits, dmg) {
    const c = this.sides[i].combo;
    const rank = hits >= 12 ? 'UNSTOPPABLE' : hits >= 9 ? 'DEVASTATING' : hits >= 6 ? 'BRUTAL' : hits >= 4 ? 'SLICK' : '';
    if (rank) c.innerHTML = `<b>${hits}</b><span>HITS</span><em>${Math.round(dmg)} DMG</em><u>${rank}</u>`;
    c.classList.add('end');
    this.comboTimers[i] = 1.0;
  }

  moveName(i, name, big) {
    const m = this.sides[i].move;
    m.textContent = name;
    m.classList.remove('show', 'big');
    void m.offsetWidth;
    m.classList.add('show');
    if (big) m.classList.add('big');
  }

  letterbox(on) {
    this.el.classList.toggle('cine', on);
  }
}
