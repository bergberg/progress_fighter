import { el, formatNum, hexToCss } from '../engine/utils.js';
import {
  CHASSIS, CHASSIS_ORDER, RARITY, SLOTS, MODS, MOD_BY_ID, PERKS, PERK_BRANCHES, PERK_BY_ID, PERK_TIER_REQ, PAINTS, SECTORS, STAGES, STAGE_BY_ID,
  MODIFIERS, ARENAS, CONTROLS, xpForLevel, stageRewards, resolvePaint, MAX_LEVEL,
} from '../game/data.js';
import { computeStats, statRatings } from '../game/profile.js';
import { getMoveset } from '../robots/moveset.js';
import { QUALITY } from '../engine/renderer.js';

const stars = (n, max = 3) => Array.from({ length: max }, (_, i) => `<i class="star ${i < n ? 'on' : ''}">★</i>`).join('');
const cr = (n) => `<span class="cr">◈ ${formatNum(n)}</span>`;

/** All menu screens. Rendering is plain DOM; the 3D showroom renders behind it. */
export class UI {
  constructor(root, app) {
    this.app = app;
    this.root = root;
    this.layer = el('div', 'screens');
    this.modal = el('div', 'modal hidden');
    this.toastEl = el('div', 'toasts');
    root.append(this.layer, this.modal, this.toastEl);
    this.screen = null;
    this.garageTab = 'mods';
    this.garageSlot = 'core';
    this.selPerk = null;
    this.pendingBuy = null;
    this.selStage = null;
    this.quick = { chassis: 'bastion', level: 4, arena: 'skydeck' };

    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      this.onAct(t.dataset.act, t.dataset, t);
    });
    root.addEventListener('pointerover', (e) => {
      const t = e.target.closest('button,[data-act]');
      if (t && t !== this._hover) {
        this._hover = t;
        this.app.audio.play('uiMove');
      }
    });
    root.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.set) this.app.setSetting(t.dataset.set, t.type === 'checkbox' ? t.checked : parseFloat(t.value));
    });
  }

  get P() {
    return this.app.profile;
  }

  set(html, cls) {
    this.layer.innerHTML = `<div class="screen ${cls}">${html}</div>`;
    this.screen = cls.split(' ')[0];
  }

  clear() {
    this.layer.innerHTML = '';
    this.screen = null;
    this.closeModal();
  }

  toast(html, cls = '') {
    const n = el('div', `toast ${cls}`, html);
    this.toastEl.appendChild(n);
    setTimeout(() => n.remove(), 3200);
  }

  topbar(title, back = 'menu') {
    const d = this.P.data;
    const need = xpForLevel(d.level);
    return `
      <header class="topbar">
        <button class="back" data-act="${back}">◀ <span>BACK</span></button>
        <h1>${title}</h1>
        <div class="pilot">
          <div class="pilot-lv"><b>LV ${d.level}</b><div class="xp"><i style="width:${d.level >= MAX_LEVEL ? 100 : (d.xp / need) * 100}%"></i></div></div>
          ${cr(d.credits)}
        </div>
      </header>`;
  }

  // ---------------------------------------------------------------- title
  showTitle() {
    this.set(`
      <div class="logo">
        <div class="logo-kicker">MODULAR COMBAT LEAGUE</div>
        <div class="logo-main"><span>APEX</span><b>CHASSIS</b></div>
        <div class="logo-line"></div>
      </div>
      <button class="press" data-act="menu">PRESS ANY KEY</button>
      <div class="foot">Every model, effect and sound is generated in real time · no assets</div>`, 'title');
  }

  // ---------------------------------------------------------------- main menu
  showMain() {
    const P = this.P;
    const cleared = STAGES.filter((s) => P.stars(s.id) > 0).length;
    const ch = CHASSIS[P.data.selected];
    const next = P.nextStage();
    this.set(`
      <div class="mm-left">
        <div class="mm-logo"><span>APEX</span><b>CHASSIS</b></div>
        <nav class="mm-nav">
          <button data-act="campaign"><i>01</i><b>CAMPAIGN</b><span>${P.campaignComplete ? 'Crown secured · replay any bout' : `Next: ${next.id} “${next.name}”`} · ${cleared}/${STAGES.length} cleared · ${P.totalStars}★</span></button>
          <button data-act="quick"><i>02</i><b>QUICK BATTLE</b><span>Any opponent, any arena, any difficulty</span></button>
          <button data-act="garage"><i>03</i><b>GARAGE</b><span>Chassis, mods, perks and paint${P.data.perkPoints ? ` · <em>${P.data.perkPoints} perk point${P.data.perkPoints > 1 ? 's' : ''} ready</em>` : ''}</span></button>
          <button data-act="help"><i>04</i><b>HOW TO PLAY</b><span>Controls and combat systems</span></button>
          <button data-act="settings"><i>05</i><b>SETTINGS</b><span>Graphics, audio, save data</span></button>
        </nav>
      </div>
      <div class="mm-robot">
        <small>ACTIVE FRAME</small>
        <b>${ch.name}</b>
        <span>${ch.title}</span>
        <div class="mm-pilot">PILOT LV ${P.data.level} · ${cr(P.data.credits)} · ${P.data.record.wins}W ${P.data.record.losses}L</div>
      </div>`, 'mainmenu');
  }

  // ---------------------------------------------------------------- garage
  showGarage() {
    const P = this.P;
    const id = P.data.selected;
    const ch = CHASSIS[id];
    const lo = P.loadout(id);
    const st = computeStats(id, lo.mods, lo.perks);
    const rate = statRatings(st);
    const chassisList = CHASSIS_ORDER.map((c) => {
      const x = CHASSIS[c];
      return `<button class="ch ${c === id ? 'on' : ''}" data-act="chassis" data-id="${c}" style="--c:${hexToCss(resolvePaint(c, P.data.robots[c].paint).glow)}"><b>${x.name}</b><span>${x.title}</span></button>`;
    }).join('');
    const bars = Object.entries(rate).map(([k, v]) => `<div class="stat"><span>${k}</span><div class="sbar"><i style="width:${Math.max(4, v * 100)}%"></i></div></div>`).join('');
    const nums = `
      <div class="nums">
        <div><b>${st.hp}</b><span>HULL</span></div>
        <div><b>${Math.round(st.atk * 100)}%</b><span>DAMAGE</span></div>
        <div><b>${Math.round(st.def * 100)}%</b><span>ARMOR</span></div>
        <div><b>${st.speed.toFixed(1)}</b><span>SPEED</span></div>
        <div><b>${st.energyMax}</b><span>ENERGY</span></div>
        <div><b>${st.guard}</b><span>GUARD</span></div>
        <div><b>${Math.round(st.crit * 100)}%</b><span>CRIT</span></div>
        <div><b>${st.energyRegen.toFixed(1)}/s</b><span>REGEN</span></div>
      </div>`;
    const tabs = [['mods', 'MODS'], ['perks', `PERKS${P.data.perkPoints ? ` <em>${P.data.perkPoints}</em>` : ''}`], ['paint', 'PAINT']]
      .map(([t, n]) => `<button class="tab ${this.garageTab === t ? 'on' : ''}" data-act="gtab" data-id="${t}">${n}</button>`).join('');
    let body = '';
    if (this.garageTab === 'mods') body = this.modsTab(id);
    else if (this.garageTab === 'perks') body = this.perksTab();
    else body = this.paintTab(id);
    this.set(`
      ${this.topbar('GARAGE')}
      <aside class="g-left">
        <div class="ch-list">${chassisList}</div>
        <div class="ch-info">
          <h2>${ch.name}</h2>
          <h3>${ch.title} · <span class="diff">${'◆'.repeat(ch.difficulty)}${'◇'.repeat(3 - ch.difficulty)}</span></h3>
          <p>${ch.desc}</p>
          <div class="stats">${bars}</div>
          ${nums}
          <button class="btn ghost" data-act="moves">MOVE LIST</button>
        </div>
      </aside>
      <aside class="g-right">
        <div class="tabs">${tabs}</div>
        <div class="g-body">${body}</div>
      </aside>
      <div class="g-hint">drag to rotate</div>`, 'garage');
  }

  modsTab(chassisId) {
    const P = this.P;
    const eq = P.data.robots[chassisId].mods;
    const slots = SLOTS.map((s) => {
      const m = MOD_BY_ID[eq[s.id]];
      return `<button class="slot ${this.garageSlot === s.id ? 'on' : ''} r${m.rarity}" data-act="gslot" data-id="${s.id}"><i>${s.icon}</i><span>${s.name}</span><b>${m.name}</b></button>`;
    }).join('');
    const list = MODS.filter((m) => m.slot === this.garageSlot).map((m) => {
      const owned = P.owns(m.id);
      const equipped = eq[m.slot] === m.id;
      const afford = P.data.credits >= m.price;
      let cta;
      if (equipped) cta = '<span class="cta eq">EQUIPPED</span>';
      else if (owned) cta = '<span class="cta">EQUIP</span>';
      else if (this.pendingBuy === m.id) cta = `<span class="cta buy confirm">CONFIRM ${cr(m.price)}</span>`;
      else cta = `<span class="cta buy ${afford ? '' : 'no'}">${afford ? 'BUY' : 'NEED'} ${cr(m.price)}</span>`;
      return `<button class="mod r${m.rarity} ${equipped ? 'equipped' : ''} ${owned ? 'owned' : 'shop'}" data-act="mod" data-id="${m.id}" style="--rc:${RARITY[m.rarity].color}">
        <div class="mod-top"><b>${m.name}</b><em>${RARITY[m.rarity].name}</em></div><p>${m.desc}</p>${cta}</button>`;
    }).join('');
    return `<div class="slots">${slots}</div><div class="modlist">${list}</div>`;
  }

  perksTab() {
    const P = this.P;
    const cols = PERK_BRANCHES.map((b) => {
      const pts = P.branchPoints(b.id);
      const tiers = [1, 2, 3, 4].map((t) => {
        const locked = pts < PERK_TIER_REQ[t];
        const nodes = PERKS.filter((p) => p.branch === b.id && p.tier === t).map((p) => {
          const has = P.data.perks.includes(p.id);
          return `<button class="perk ${has ? 'has' : ''} ${locked && !has ? 'locked' : ''} ${this.selPerk === p.id ? 'sel' : ''}" data-act="perk" data-id="${p.id}"><b>${p.name}</b></button>`;
        }).join('');
        return `<div class="tier ${locked ? 'locked' : ''}"><span class="tier-n">T${t}${locked ? ` · ${PERK_TIER_REQ[t]} pts` : ''}</span>${nodes}</div>`;
      }).join('');
      return `<div class="branch" style="--bc:${b.color}"><h4>${b.name}<small>${pts}/8</small></h4>${tiers}</div>`;
    }).join('');
    const sp = this.selPerk ? PERK_BY_ID[this.selPerk] : null;
    let detail = '<div class="perk-detail empty">Select a perk to inspect it. Earn one perk point per pilot level.</div>';
    if (sp) {
      const has = P.data.perks.includes(sp.id);
      const can = P.canBuyPerk(sp.id);
      detail = `<div class="perk-detail"><div><b>${sp.name}</b><p>${sp.desc}</p></div>
        ${has ? '<span class="cta eq">ACTIVE</span>' : `<button class="btn ${can ? '' : 'disabled'}" data-act="buyperk" data-id="${sp.id}" ${can ? '' : 'disabled'}>${can ? 'UNLOCK · 1 PT' : P.data.perkPoints < 1 ? 'NO POINTS' : 'TIER LOCKED'}</button>`}</div>`;
    }
    return `<div class="perk-head"><span>PERK POINTS <b>${P.data.perkPoints}</b></span><button class="btn ghost sm" data-act="respec">RESPEC</button></div><div class="branches">${cols}</div>${detail}`;
  }

  paintTab(chassisId) {
    const P = this.P;
    const cur = P.data.robots[chassisId].paint;
    const items = PAINTS.map((p) => {
      const c = resolvePaint(chassisId, p.id);
      const locked = p.level > P.data.level;
      return `<button class="paint ${cur === p.id ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="paint" data-id="${p.id}">
        <i style="background:linear-gradient(135deg, ${hexToCss(c.primary)} 0 50%, ${hexToCss(c.secondary)} 50% 78%, ${hexToCss(c.glow)} 78%)"></i>
        <b>${p.name}</b><span>${locked ? `LV ${p.level}` : cur === p.id ? 'APPLIED' : ''}</span></button>`;
    }).join('');
    return `<div class="paints">${items}</div><p class="note">New paint schemes unlock as your pilot level rises.</p>`;
  }

  showMoves(chassisId = this.P.data.selected, inFight = false) {
    const ms = getMoveset(chassisId).moves;
    const row = (keys, m, extra = '') => `<tr><td class="keys">${keys}</td><td><b>${m.name}</b>${extra ? `<span>${extra}</span>` : ''}</td><td>${m.cost ? `${m.cost} EN` : ''}</td></tr>`;
    const k = (s) => s.split(' ').map((x) => (x === '+' || x === '›' ? `<i>${x}</i>` : `<kbd>${x}</kbd>`)).join('');
    this.openModal(`
      <h2>${CHASSIS[chassisId].name} · MOVE LIST</h2>
      <table class="moves">
        ${row(k('J › J › J'), { name: `${ms.light1.name} › ${ms.light2.name} › ${ms.light3.name}` }, 'light chain — cancels into heavy, launcher or specials on hit')}
        ${row(k('K'), ms.heavy, 'hold to charge an unblockable guard crush')}
        ${row(k('S + K'), ms.launcher, 'launches — press W on hit to follow into the air')}
        ${row(`<small>air</small> ${k('J')}`, ms.airL)}
        ${row(`<small>air</small> ${k('K')}`, ms.airH, 'dive attack, knocks down')}
        ${row(k('L'), ms.spN)}
        ${row(k('D + L'), ms.spF, 'hold a direction')}
        ${row(k('S + L'), ms.spD)}
        ${row(k('O'), ms.overdrive, 'requires a full Overdrive meter')}
      </table>
      <div class="modal-btns"><button class="btn" data-act="${inFight ? 'pauseback' : 'closemodal'}">CLOSE</button></div>`, 'wide');
  }

  // ---------------------------------------------------------------- campaign
  showCampaign() {
    const P = this.P;
    if (!this.selStage || !STAGE_BY_ID[this.selStage] || !P.isUnlocked(this.selStage)) this.selStage = P.nextStage().id;
    const sel = STAGE_BY_ID[this.selStage];
    const sectors = SECTORS.map((sec, si) => {
      const nodes = sec.stages.map((st) => {
        const unlocked = P.isUnlocked(st.id);
        const s = P.stars(st.id);
        return `<button class="node ${st.boss ? 'boss' : ''} ${unlocked ? '' : 'locked'} ${s ? 'done' : ''} ${st.id === this.selStage ? 'sel' : ''}" data-act="stage" data-id="${st.id}" ${unlocked ? '' : 'disabled'}>
          <span class="node-id">${st.boss ? 'BOSS' : st.id}</span><b>${unlocked ? st.name : '— LOCKED —'}</b><span class="node-en">${unlocked ? st.enemy.name : ''}</span><span class="node-stars">${stars(s)}</span></button>`;
      }).join('');
      const open = P.isUnlocked(sec.stages[0].id);
      return `<section class="sector ${open ? '' : 'locked'}" style="--sc:${sec.color}"><h3><i>SECTOR ${si + 1}</i>${sec.name}</h3><p>${sec.blurb}</p><div class="nodes">${nodes}</div></section>`;
    }).join('');
    const e = sel.enemy;
    const rw = stageRewards(sel);
    const first = P.stars(sel.id) === 0;
    const mod = sel.modifier ? MODIFIERS[sel.modifier] : null;
    const drop = sel.drop ? MOD_BY_ID[sel.drop] : null;
    const me = CHASSIS[P.data.selected];
    this.set(`
      ${this.topbar('CAMPAIGN')}
      <div class="c-map">${sectors}</div>
      <aside class="brief" style="--sc:${SECTORS.find((s) => s.id === sel.sector).color}">
        <div class="brief-head"><span>${sel.boss ? 'BOSS BOUT' : 'BOUT'} ${sel.id}</span><h2>${sel.name}</h2></div>
        <div class="brief-enemy"><small>OPPONENT</small><b>${e.name}</b><span>${CHASSIS[e.chassis].name} frame · LV ${e.level} · ${ARENAS[sel.arena].name}</span></div>
        <p class="brief-text">${sel.intro || ''}</p>
        ${mod ? `<div class="brief-mod"><b>${mod.name}</b>${mod.desc}</div>` : ''}
        <div class="brief-rw">
          <div><small>${first ? 'FIRST CLEAR' : 'REPLAY'}</small>${cr(Math.round(rw.credits * (first ? 1 : 0.4)))} <span class="xpv">+${Math.round(rw.xp * (first ? 1 : 0.5))} XP</span></div>
          ${drop ? `<div class="brief-drop ${P.owns(drop.id) ? 'got' : ''}" style="--rc:${RARITY[drop.rarity].color}"><small>${P.owns(drop.id) ? 'DROP CLAIMED' : 'GUARANTEED DROP'}</small><b>${drop.name}</b></div>` : ''}
        </div>
        <div class="brief-go">
          <div class="brief-me"><small>YOUR FRAME</small><b>${me.name}</b><button class="link" data-act="garage">change ▸</button></div>
          <button class="btn big" data-act="deploy">DEPLOY</button>
        </div>
        <div class="brief-fmt">${sel.rounds === 1 ? 'Single round' : 'Best of 3 rounds'} · 60 seconds</div>
      </aside>`, 'campaign');
  }

  // ---------------------------------------------------------------- quick battle
  showQuick() {
    const q = this.quick;
    const chs = CHASSIS_ORDER.map((c) => `<button class="opt ${q.chassis === c ? 'on' : ''}" data-act="qch" data-id="${c}"><b>${CHASSIS[c].name}</b><span>${CHASSIS[c].title}</span></button>`).join('');
    const ars = Object.values(ARENAS).map((a) => `<button class="opt ${q.arena === a.id ? 'on' : ''}" data-act="qar" data-id="${a.id}"><b>${a.name}</b></button>`).join('');
    const names = ['', 'Rookie', 'Rookie', 'Amateur', 'Amateur', 'Contender', 'Contender', 'Veteran', 'Veteran', 'Elite', 'Elite', 'Champion', 'Champion', 'Legend', 'Legend', 'Apex', 'Apex', 'Apex'];
    this.set(`
      ${this.topbar('QUICK BATTLE')}
      <div class="q-panel">
        <h3>OPPONENT FRAME</h3><div class="opts">${chs}</div>
        <h3>ARENA</h3><div class="opts four">${ars}</div>
        <h3>DIFFICULTY · <b>${names[q.level]} (${q.level})</b></h3>
        <input type="range" min="1" max="17" step="1" value="${q.level}" class="range" data-quick="level" />
        <div class="q-go"><div class="brief-me"><small>YOUR FRAME</small><b>${CHASSIS[this.P.data.selected].name}</b><button class="link" data-act="garage">change ▸</button></div>
        <button class="btn big" data-act="quickgo">FIGHT</button></div>
      </div>`, 'quick');
    this.layer.querySelector('[data-quick]').addEventListener('input', (e) => {
      q.level = +e.target.value;
      this.showQuick();
      this.app.previewQuick();
    });
  }

  // ---------------------------------------------------------------- results
  showResults(r, ctx) {
    const P = this.P;
    const drop = r.drop ? MOD_BY_ID[r.drop] : null;
    const pct0 = (r.levelsGained ? 0 : r.xpBefore / xpForLevel(r.levelBefore)) * 100;
    const pct1 = (r.xpAfter / r.xpNeed) * 100;
    const champion = ctx.stageId === STAGES[STAGES.length - 1].id && r.won && r.firstClear;
    this.set(`
      <div class="res-card">
        <div class="res-title">${r.won ? (champion ? 'CHAMPION' : 'VICTORY') : 'DEFEAT'}</div>
        <div class="res-sub">${ctx.title || ''}</div>
        ${r.won && ctx.stageId ? `<div class="res-stars">${stars(r.stars)}</div><div class="res-star-note">★ win · ★ no rounds dropped · ★ finish above 50% hull</div>` : ''}
        ${champion ? '<p class="res-champ">The Orbital Crown is yours. Nine billion viewers just learned your callsign.<br>Every bout can be replayed for missing stars — and the garage is never finished.</p>' : ''}
        <div class="res-grid">
          <div><small>CREDITS</small><b>${cr(r.credits)}</b></div>
          <div><small>EXPERIENCE</small><b>+${r.xp} XP</b></div>
          <div><small>MAX COMBO</small><b>${ctx.maxCombo} hits</b></div>
          <div><small>DAMAGE</small><b>${ctx.dmgDealt} / ${ctx.dmgTaken}</b></div>
          <div><small>PARRIES</small><b>${ctx.parries}</b></div>
        </div>
        <div class="res-xp"><span>PILOT LV ${r.level}</span><div class="xp big"><i style="width:${pct0}%" data-to="${pct1}"></i></div><span>${r.level >= MAX_LEVEL ? 'MAX' : `${r.xpAfter} / ${r.xpNeed}`}</span></div>
        ${r.levelsGained ? `<div class="res-lvl">LEVEL UP! <b>+${r.perkPoints} PERK POINT${r.perkPoints > 1 ? 'S' : ''}</b>${r.newPaints.length ? ` · paint unlocked: ${r.newPaints.join(', ')}` : ''}</div>` : ''}
        ${drop ? `<div class="res-drop" style="--rc:${RARITY[drop.rarity].color}"><small>MOD ACQUIRED · ${RARITY[drop.rarity].name.toUpperCase()}</small><b>${drop.name}</b><p>${drop.desc}</p></div>` : ''}
        ${!r.won ? '<p class="res-tip">Tip: block (I) drains your guard — a parry (tap I right before impact) costs nothing and stuns the attacker. Spend credits and perk points in the Garage.</p>' : ''}
        <div class="res-btns">
          ${ctx.stageId ? `<button class="btn big" data-act="campaign">${r.won ? 'CONTINUE' : 'CAMPAIGN'}</button>` : '<button class="btn big" data-act="quick">CONTINUE</button>'}
          <button class="btn ghost" data-act="retry">${r.won ? 'REPLAY' : 'RETRY'}</button>
          <button class="btn ghost" data-act="garage">GARAGE</button>
        </div>
      </div>`, `results ${r.won ? 'win' : 'lose'}`);
    requestAnimationFrame(() => {
      const bar = this.layer.querySelector('.res-xp i');
      if (bar) setTimeout(() => (bar.style.width = bar.dataset.to + '%'), 350);
    });
    const a = this.app.audio;
    if (r.won) {
      for (let i = 0; i < r.stars; i++) setTimeout(() => a.play('star'), 500 + i * 260);
      if (r.levelsGained) setTimeout(() => a.play('levelUp'), 1400);
      if (drop) setTimeout(() => a.play('reward'), 1900);
    }
  }

  // ---------------------------------------------------------------- modals
  openModal(html, cls = '') {
    this.modal.className = `modal ${cls}`;
    this.modal.innerHTML = `<div class="modal-card">${html}</div>`;
  }
  closeModal() {
    this.modal.className = 'modal hidden';
    this.modal.innerHTML = '';
  }
  get modalOpen() {
    return !this.modal.classList.contains('hidden');
  }

  showHelp(inFight = false) {
    const rows = CONTROLS.map(([k, v]) => `<tr><td class="keys">${k.split(' ').map((x) => (x === '+' || x === '/' ? `<i>${x}</i>` : `<kbd>${x}</kbd>`)).join('')}</td><td>${v}</td></tr>`).join('');
    this.openModal(`
      <h2>HOW TO PLAY</h2>
      <div class="help">
        <table class="moves">${rows}</table>
        <div class="help-txt">
          <h4>HULL · GUARD · ENERGY · OVERDRIVE</h4>
          <p><b>Blocking</b> stops damage but drains your <b>Guard</b>. When it empties your shield shatters and you are stunned. A charged heavy (hold K) is unblockable.</p>
          <p><b>Parry</b> by tapping block the instant before a hit lands: no guard loss, the attacker is stunned, and projectiles are reflected back.</p>
          <p><b>Combos</b>: lights chain J›J›J. On hit, cancel lights into a heavy or launcher, heavies into specials, and specials into your Overdrive. Launch (S+K), then press W to chase into the air.</p>
          <p><b>Energy</b> fuels specials and refills over time. <b>Overdrive</b> fills as you deal and take damage — unleash it with O.</p>
          <p>Gamepad: stick move · A jump · X light · Y heavy · B special · RB block · RT dash · LB overdrive. Touch controls appear automatically on phones and tablets.</p>
        </div>
      </div>
      <div class="modal-btns"><button class="btn" data-act="${inFight ? 'pauseback' : 'closemodal'}">CLOSE</button></div>`, 'wide');
  }

  showSettings(inFight = false) {
    const s = this.P.data.settings;
    const qs = Object.entries(QUALITY).map(([k, v]) => `<button class="opt sm ${s.quality === k ? 'on' : ''}" data-act="quality" data-id="${k}"><b>${v.label}</b></button>`).join('');
    this.openModal(`
      <h2>SETTINGS</h2>
      <div class="settings">
        <label>GRAPHICS QUALITY</label><div class="opts four">${qs}</div>
        <label class="row"><span>Dynamic resolution <small>(keeps the frame rate smooth)</small></span><input type="checkbox" data-set="dynamicRes" ${s.dynamicRes ? 'checked' : ''} /></label>
        <label class="row"><span>Effects volume</span><input type="range" class="range" min="0" max="1" step="0.05" value="${s.sfx}" data-set="sfx" /></label>
        <label class="row"><span>Music volume</span><input type="range" class="range" min="0" max="1" step="0.05" value="${s.music}" data-set="music" /></label>
        <label class="row"><span>Screen shake</span><input type="range" class="range" min="0" max="1.5" step="0.1" value="${s.shake}" data-set="shake" /></label>
        ${inFight ? '' : '<label class="row"><span>Save data <small>(stored in this browser)</small></span><button class="btn ghost sm danger" data-act="resetsave">RESET PROGRESS</button></label>'}
      </div>
      <div class="modal-btns"><button class="btn" data-act="${inFight ? 'pauseback' : 'closemodal'}">DONE</button></div>`);
  }

  showPause() {
    this.openModal(`
      <h2>PAUSED</h2>
      <div class="pause">
        <button class="btn big" data-act="resume">RESUME</button>
        <button class="btn ghost" data-act="pausemoves">MOVE LIST</button>
        <button class="btn ghost" data-act="pausehelp">HOW TO PLAY</button>
        <button class="btn ghost" data-act="pausesettings">SETTINGS</button>
        <button class="btn ghost" data-act="restart">RESTART BOUT</button>
        <button class="btn ghost danger" data-act="quit">FORFEIT</button>
      </div>`, 'narrow');
  }

  confirm(text, act) {
    this.openModal(`<h2>CONFIRM</h2><p class="confirm">${text}</p><div class="modal-btns"><button class="btn ghost" data-act="closemodal">CANCEL</button><button class="btn danger" data-act="${act}">CONFIRM</button></div>`, 'narrow');
  }

  // ---------------------------------------------------------------- actions
  onAct(act, d) {
    const app = this.app;
    const P = this.P;
    const a = app.audio;
    switch (act) {
      case 'menu': a.play(this.screen === 'title' ? 'uiSelect' : 'uiBack'); app.go('menu'); break;
      case 'campaign': a.play('uiSelect'); app.go('campaign'); break;
      case 'quick': a.play('uiSelect'); app.go('quick'); break;
      case 'garage': a.play('uiSelect'); app.go('garage'); break;
      case 'help': a.play('uiSelect'); this.showHelp(); break;
      case 'settings': a.play('uiSelect'); this.showSettings(); break;
      case 'closemodal': a.play('uiBack'); this.closeModal(); break;
      case 'chassis': a.play('uiEquip'); P.select(d.id); this.pendingBuy = null; this.showGarage(); app.refreshRobot(true); break;
      case 'gtab': a.play('uiSelect'); this.garageTab = d.id; this.pendingBuy = null; this.showGarage(); break;
      case 'gslot': a.play('uiSelect'); this.garageSlot = d.id; this.pendingBuy = null; this.showGarage(); break;
      case 'mod': {
        const m = MOD_BY_ID[d.id];
        const id = P.data.selected;
        if (P.owns(m.id)) {
          if (P.data.robots[id].mods[m.slot] !== m.id) { P.equip(id, m.id); a.play('uiEquip'); app.refreshRobot(); }
        } else if (P.data.credits < m.price) {
          a.play('deny');
          this.toast(`Not enough credits for <b>${m.name}</b>`, 'warn');
        } else if (this.pendingBuy !== m.id) {
          this.pendingBuy = m.id;
          a.play('uiSelect');
        } else {
          P.buy(m.id);
          P.equip(id, m.id);
          this.pendingBuy = null;
          a.play('uiBuy');
          this.toast(`<b>${m.name}</b> installed`, 'good');
          app.refreshRobot();
        }
        this.showGarage();
        break;
      }
      case 'perk': a.play('uiSelect'); this.selPerk = d.id; this.showGarage(); break;
      case 'buyperk': if (P.buyPerk(d.id)) { a.play('levelUp'); this.toast(`Perk unlocked: <b>${PERK_BY_ID[d.id].name}</b>`, 'good'); } else a.play('deny'); this.showGarage(); break;
      case 'respec': if (P.data.perks.length) { P.respec(); a.play('uiEquip'); this.toast('Perk points refunded'); this.showGarage(); } break;
      case 'paint': {
        const id = P.data.selected;
        if (P.setPaint(id, d.id)) { a.play('uiEquip'); app.refreshRobot(); this.showGarage(); } else a.play('deny');
        break;
      }
      case 'moves': a.play('uiSelect'); this.showMoves(); break;
      case 'stage': a.play('uiSelect'); this.selStage = d.id; this.showCampaign(); app.previewStage(d.id); break;
      case 'deploy': a.play('fight'); app.startStage(this.selStage); break;
      case 'qch': a.play('uiSelect'); this.quick.chassis = d.id; this.showQuick(); app.previewQuick(); break;
      case 'qar': a.play('uiSelect'); this.quick.arena = d.id; this.showQuick(); break;
      case 'quickgo': a.play('fight'); app.startQuick(this.quick); break;
      case 'retry': a.play('fight'); app.retry(); break;
      case 'quality': a.play('uiSelect'); app.setSetting('quality', d.id); this.showSettings(!!app.fight); break;
      case 'resetsave': this.confirm('Erase all campaign progress, mods, perks and credits?', 'resetsave2'); break;
      case 'resetsave2': P.reset(); this.closeModal(); this.toast('Progress reset'); app.go('menu'); app.refreshRobot(true); break;
      case 'resume': a.play('uiSelect'); app.togglePause(false); break;
      case 'pausemoves': this.showMoves(P.data.selected, true); break;
      case 'pausehelp': this.showHelp(true); break;
      case 'pausesettings': this.showSettings(true); break;
      case 'pauseback': this.showPause(); break;
      case 'restart': app.togglePause(false); app.retry(); break;
      case 'quit': app.togglePause(false); app.quitFight(); break;
      default: break;
    }
  }
}
