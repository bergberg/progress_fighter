import {
  CHASSIS, CHASSIS_ORDER, MODS, MOD_BY_ID, DEFAULT_MODS, PERKS, PERK_BY_ID, PERK_TIER_REQ, PAINT_BY_ID, STAGES, STAGE_BY_ID,
  MAX_LEVEL, xpForLevel, stageRewards, resolvePaint,
} from './data.js';

const KEY = 'apex-chassis-save-v1';

function fresh() {
  const robots = {};
  for (const id of CHASSIS_ORDER) robots[id] = { mods: { ...DEFAULT_MODS }, paint: 'factory' };
  return {
    version: 1,
    credits: 250,
    xp: 0,
    level: 1,
    perkPoints: 1,
    perks: [],
    owned: Object.values(DEFAULT_MODS),
    robots,
    selected: 'vanguard',
    campaign: {}, // stageId -> stars (1..3)
    seenIntro: false,
    settings: { quality: 'high', sfx: 0.8, music: 0.5, shake: 1, dynamicRes: true },
    record: { wins: 0, losses: 0, perfects: 0, maxCombo: 0 },
  };
}

let memoryStore = null;
function read() {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return memoryStore;
  }
}
function write(s) {
  try {
    window.localStorage.setItem(KEY, s);
  } catch {
    memoryStore = s;
  }
}

export class Profile {
  constructor() {
    this.data = fresh();
    this.load();
  }

  load() {
    const raw = read();
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      const base = fresh();
      this.data = { ...base, ...d, settings: { ...base.settings, ...(d.settings || {}) }, record: { ...base.record, ...(d.record || {}) } };
      for (const id of CHASSIS_ORDER) {
        const r = (this.data.robots[id] ||= { mods: { ...DEFAULT_MODS }, paint: 'factory' });
        r.mods = { ...DEFAULT_MODS, ...r.mods };
        for (const slot of Object.keys(r.mods)) if (!MOD_BY_ID[r.mods[slot]] || !this.data.owned.includes(r.mods[slot])) r.mods[slot] = DEFAULT_MODS[slot];
        if (!PAINT_BY_ID[r.paint]) r.paint = 'factory';
      }
      this.data.perks = this.data.perks.filter((p) => PERK_BY_ID[p]);
      this.data.owned = [...new Set([...Object.values(DEFAULT_MODS), ...this.data.owned.filter((m) => MOD_BY_ID[m])])];
    } catch {
      this.data = fresh();
    }
  }

  save() {
    write(JSON.stringify(this.data));
  }

  reset() {
    const settings = this.data.settings;
    this.data = fresh();
    this.data.settings = settings;
    this.save();
  }

  // ---- robots -------------------------------------------------------------
  get robot() {
    return this.data.robots[this.data.selected];
  }
  select(id) {
    this.data.selected = id;
    this.save();
  }
  owns(modId) {
    return this.data.owned.includes(modId);
  }
  buy(modId) {
    const m = MOD_BY_ID[modId];
    if (!m || this.owns(modId) || this.data.credits < m.price) return false;
    this.data.credits -= m.price;
    this.data.owned.push(modId);
    this.save();
    return true;
  }
  equip(chassisId, modId) {
    const m = MOD_BY_ID[modId];
    if (!m || !this.owns(modId)) return false;
    this.data.robots[chassisId].mods[m.slot] = modId;
    this.save();
    return true;
  }
  setPaint(chassisId, paintId) {
    const p = PAINT_BY_ID[paintId];
    if (!p || p.level > this.data.level) return false;
    this.data.robots[chassisId].paint = paintId;
    this.save();
    return true;
  }
  loadout(chassisId = this.data.selected) {
    const r = this.data.robots[chassisId];
    return {
      chassis: chassisId,
      mods: Object.values(r.mods),
      perks: this.data.perks,
      paint: resolvePaint(chassisId, r.paint),
      name: CHASSIS[chassisId].name,
      level: this.data.level,
    };
  }

  // ---- perks --------------------------------------------------------------
  branchPoints(branch) {
    return this.data.perks.filter((p) => PERK_BY_ID[p].branch === branch).length;
  }
  canBuyPerk(id) {
    const p = PERK_BY_ID[id];
    if (!p || this.data.perks.includes(id) || this.data.perkPoints < 1) return false;
    return this.branchPoints(p.branch) >= PERK_TIER_REQ[p.tier];
  }
  buyPerk(id) {
    if (!this.canBuyPerk(id)) return false;
    this.data.perks.push(id);
    this.data.perkPoints--;
    this.save();
    return true;
  }
  respec() {
    this.data.perkPoints += this.data.perks.length;
    this.data.perks = [];
    this.save();
  }

  // ---- campaign -----------------------------------------------------------
  stars(stageId) {
    return this.data.campaign[stageId] || 0;
  }
  isUnlocked(stageId) {
    const i = STAGES.findIndex((s) => s.id === stageId);
    if (i <= 0) return true;
    return this.stars(STAGES[i - 1].id) > 0;
  }
  nextStage() {
    return STAGES.find((s) => !this.stars(s.id)) || STAGES[STAGES.length - 1];
  }
  get totalStars() {
    return Object.values(this.data.campaign).reduce((a, b) => a + b, 0);
  }
  get campaignComplete() {
    return STAGES.every((s) => this.stars(s.id) > 0);
  }

  /**
   * Apply the outcome of a fight. Returns a summary used by the results screen.
   */
  applyResult({ stageId, won, stars = 0, maxCombo = 0, perfect = false, quick = false, enemyLevel = 1 }) {
    const d = this.data;
    const out = { won, stars, credits: 0, xp: 0, levelsGained: 0, perkPoints: 0, drop: null, firstClear: false, newPaints: [], levelBefore: d.level, xpBefore: d.xp };
    const fxs = this.perkFx();
    let credits, xp;
    if (stageId) {
      const st = STAGE_BY_ID[stageId];
      const base = stageRewards(st);
      const prev = this.stars(stageId);
      if (won) {
        out.firstClear = prev === 0;
        const mult = out.firstClear ? 1 : 0.4;
        credits = base.credits * mult + stars * 40;
        xp = base.xp * (out.firstClear ? 1 : 0.5);
        if (out.firstClear && st.drop && !this.owns(st.drop)) {
          d.owned.push(st.drop);
          out.drop = st.drop;
        }
        if (stars > prev) d.campaign[stageId] = stars;
      } else {
        credits = base.credits * 0.12;
        xp = base.xp * 0.2;
      }
    } else {
      credits = won ? 60 + enemyLevel * 12 : 15;
      xp = won ? 40 + enemyLevel * 10 : 12;
    }
    credits = Math.round(credits * (1 + (fxs.credits || 0)));
    xp = Math.round(xp * (1 + (fxs.xp || 0)));
    out.credits = credits;
    out.xp = xp;
    d.credits += credits;
    d.xp += xp;
    while (d.level < MAX_LEVEL && d.xp >= xpForLevel(d.level)) {
      d.xp -= xpForLevel(d.level);
      d.level++;
      d.perkPoints++;
      out.levelsGained++;
      out.perkPoints++;
      for (const p of Object.values(PAINT_BY_ID)) if (p.level === d.level) out.newPaints.push(p.name);
    }
    if (won) d.record.wins++;
    else d.record.losses++;
    if (perfect) d.record.perfects++;
    d.record.maxCombo = Math.max(d.record.maxCombo, maxCombo);
    out.level = d.level;
    out.xpAfter = d.xp;
    out.xpNeed = xpForLevel(d.level);
    this.save();
    return out;
  }

  perkFx() {
    const fx = {};
    for (const id of this.data.perks) Object.assign(fx, PERK_BY_ID[id].fx);
    return fx;
  }
}

/**
 * Combine chassis base stats with mods and perks into final combat stats.
 * opts: { level (enemy scaling), boss }
 */
export function computeStats(chassisId, modIds = [], perkIds = [], opts = {}) {
  const base = CHASSIS[chassisId].stats;
  const pct = { hp: 0, atk: 0, def: 0, speed: 0, energyRegen: 0, guard: 0, meter: 0, weight: 0 };
  const flat = { energyMax: 0, crit: 0.04, critDmg: 1.5 };
  const fx = {};
  const visuals = [];
  const addFx = (src) => {
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'number') fx[k] = (fx[k] || 0) + v;
      else fx[k] = v;
    }
  };
  const addStats = (st) => {
    for (const [k, v] of Object.entries(st)) {
      if (k in pct) pct[k] += v;
      else if (k in flat) flat[k] += v;
    }
  };
  for (const id of modIds) {
    const m = MOD_BY_ID[id];
    if (!m) continue;
    addStats(m.stats);
    addFx(m.fx);
    if (m.visual) visuals.push(m.visual);
  }
  for (const id of perkIds) {
    const p = PERK_BY_ID[id];
    if (!p) continue;
    addStats(p.stats);
    addFx(p.fx);
  }
  let hpMul = 1, atkMul = 1;
  if (opts.level) {
    // enemy scaling by campaign level
    hpMul = 0.8 + 0.035 * opts.level;
    atkMul = 0.74 + 0.027 * opts.level;
    if (opts.boss) { hpMul *= 1.2; atkMul *= 1.05; }
  }
  return {
    chassis: chassisId,
    hp: Math.round(base.hp * (1 + pct.hp) * hpMul),
    atk: base.atk * (1 + pct.atk) * atkMul,
    def: base.def * (1 + pct.def),
    speed: base.speed * (1 + pct.speed),
    jump: base.jump,
    weight: base.weight * (1 + pct.weight),
    energyRegen: base.energyRegen * (1 + pct.energyRegen),
    energyMax: base.energyMax + flat.energyMax,
    guard: Math.round(base.guard * (1 + pct.guard)),
    meter: 1 + pct.meter,
    crit: flat.crit,
    critDmg: flat.critDmg,
    height: base.height * (opts.boss ? 1.12 : 1),
    width: base.width * (opts.boss ? 1.12 : 1),
    scale: opts.boss ? 1.12 : 1,
    fx,
    visuals,
  };
}

/** 0..1 ratings for the garage stat bars */
export function statRatings(s) {
  return {
    Power: Math.min(1, (s.atk - 0.7) / 0.8),
    Hull: Math.min(1, (s.hp * s.def - 60) / 160),
    Speed: Math.min(1, (s.speed - 2.2) / 3.4),
    Energy: Math.min(1, (s.energyRegen * 5 + s.energyMax - 110) / 110),
    Guard: Math.min(1, (s.guard - 50) / 130),
  };
}

export { MODS, PERKS };
