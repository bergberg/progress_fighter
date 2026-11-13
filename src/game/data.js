// ===========================================================================
// Static game data: chassis, mods, perks, paints, campaign.
// ===========================================================================

export const CHASSIS = {
  vanguard: {
    id: 'vanguard', name: 'VANGUARD', title: 'Arc-Blade Duelist', tagline: 'Balanced frame. Plasma blade. No weaknesses, no excuses.',
    desc: 'A knightly all-rounder built around a forearm arc-blade. Solid reach, a true projectile and a screen-crossing rush make it strong at every range.',
    stats: { hp: 110, atk: 1.0, def: 1.0, speed: 3.7, jump: 12.2, weight: 1.0, energyRegen: 9, energyMax: 100, guard: 100, height: 2.3, width: 0.46 },
    paint: { primary: 0x1f5fd6, secondary: 0xe8ecf2, glow: 0x39d5ff, trim: 0xd9b25a },
    difficulty: 1,
  },
  bastion: {
    id: 'bastion', name: 'BASTION', title: 'Siege Breaker', tagline: 'Slow to start. Impossible to stop.',
    desc: 'A walking furnace with piston gauntlets. Lumbering, but its heavy strikes shrug off hits and shatter guards. Control space with Faultline, then close in.',
    stats: { hp: 142, atk: 1.14, def: 1.14, speed: 2.75, jump: 10.6, weight: 1.45, energyRegen: 7.5, energyMax: 100, guard: 130, height: 2.45, width: 0.62 },
    paint: { primary: 0xc7421a, secondary: 0x2a2d33, glow: 0xff9a2a, trim: 0x8d9299 },
    difficulty: 2,
  },
  wraith: {
    id: 'wraith', name: 'WRAITH', title: 'Phase Assassin', tagline: 'You only see the afterimage.',
    desc: 'A fragile, blisteringly fast frame with twin mono-blades. Blinks behind targets, leaves exploding decoys and wins by never being where the hit lands.',
    stats: { hp: 88, atk: 0.93, def: 0.9, speed: 4.7, jump: 13.2, weight: 0.8, energyRegen: 11, energyMax: 100, guard: 75, height: 2.2, width: 0.4 },
    paint: { primary: 0x2a2140, secondary: 0x14141c, glow: 0xc04bff, trim: 0x9aa0b4 },
    difficulty: 3,
  },
  tempest: {
    id: 'tempest', name: 'TEMPEST', title: 'Storm Conductor', tagline: 'The forecast is violence.',
    desc: 'A hovering caster crowned by a tesla halo. Long-reaching discharges, sky-called bolts and static traps let it dictate the fight from anywhere on the stage.',
    stats: { hp: 96, atk: 1.0, def: 0.92, speed: 3.45, jump: 12.6, weight: 0.86, energyRegen: 13, energyMax: 110, guard: 85, height: 2.35, width: 0.42 },
    paint: { primary: 0xe9edf2, secondary: 0x2b3a67, glow: 0x4dffd2, trim: 0xe0b64f },
    difficulty: 2,
  },
};
export const CHASSIS_ORDER = ['vanguard', 'bastion', 'wraith', 'tempest'];

export const RARITY = [
  null,
  { name: 'Common', color: '#9aa7b8' },
  { name: 'Rare', color: '#3fa9ff' },
  { name: 'Epic', color: '#c56bff' },
  { name: 'Legendary', color: '#ffb637' },
];

export const SLOTS = [
  { id: 'core', name: 'Reactor Core', icon: '◈' },
  { id: 'arms', name: 'Arm System', icon: '✦' },
  { id: 'legs', name: 'Leg System', icon: '▲' },
  { id: 'plating', name: 'Plating', icon: '⬢' },
  { id: 'chip', name: 'Combat Chip', icon: '◉' },
];

// stat keys: hp, atk, def, speed, energyRegen (all multiplicative %), energyMax, guard (%), meter (%), crit (flat chance), critDmg, weight(%)
// fx: gameplay flags consumed by the combat engine
const mod = (id, slot, name, rarity, price, desc, stats = {}, fx = {}, visual = null) => ({ id, slot, name, rarity, price, desc, stats, fx, visual });

export const MODS = [
  // ------------------------------------------------------------ CORE
  mod('core_stock', 'core', 'Stock Fusion Cell', 1, 0, 'Factory reactor. Reliable, unremarkable.'),
  mod('core_overclock', 'core', 'Overclocked Cell', 1, 300, 'Energy regeneration +20%.', { energyRegen: 0.2 }, {}, 'cells'),
  mod('core_capacitor', 'core', 'Capacitor Bank', 2, 700, 'Maximum energy +40.', { energyMax: 40 }, {}, 'cells'),
  mod('core_surge', 'core', 'Surge Reactor', 2, 800, 'Overdrive meter builds 30% faster.', { meter: 0.3 }, {}, 'ring'),
  mod('core_vampiric', 'core', 'Vampiric Coil', 3, 1600, 'Siphons hull integrity: heal for 7% of damage dealt.', {}, { lifesteal: 0.07 }, 'twin'),
  mod('core_singularity', 'core', 'Singularity Core', 3, 1800, 'Specials cost 25% less energy and deal 10% more damage.', {}, { specialCost: 0.25, specialDmg: 0.1 }, 'ring'),
  mod('core_phoenix', 'core', 'Phoenix Protocol', 4, 3500, 'Once per match, a fatal blow instead reboots you at 30% hull with a shockwave.', {}, { revive: 0.3 }, 'dorsal'),
  // ------------------------------------------------------------ ARMS
  mod('arms_stock', 'arms', 'Standard Actuators', 1, 0, 'Factory arm servos.'),
  mod('arms_tungsten', 'arms', 'Tungsten Knuckles', 1, 300, 'All damage +8%.', { atk: 0.08 }, {}, 'knuckles'),
  mod('arms_thermal', 'arms', 'Thermal Coils', 2, 750, 'Strikes ignite the target: 6 burn damage over 3 seconds.', {}, { burn: 6 }, 'coils'),
  mod('arms_shock', 'arms', 'Shock Emitters', 2, 750, 'Strikes inflict 12% longer hitstun and 20% more guard damage.', {}, { shock: 0.12, guardDmg: 0.2 }, 'coils'),
  mod('arms_mono', 'arms', 'Monomolecular Edges', 3, 1500, 'Critical chance +15%. Criticals deal 160% damage.', { crit: 0.15, critDmg: 0.1 }, {}, 'fins'),
  mod('arms_siege', 'arms', 'Siege Rams', 3, 1700, 'Heavy attacks deal +25% damage and gain super armor during wind-up.', {}, { heavyDmg: 0.25, heavyArmor: true }, 'cannon'),
  mod('arms_executioner', 'arms', 'Executioner Claws', 4, 3200, '+5% damage. +35% damage against targets below 35% hull.', { atk: 0.05 }, { execute: 0.35 }, 'claws'),
  // ------------------------------------------------------------ LEGS
  mod('legs_stock', 'legs', 'Standard Servos', 1, 0, 'Factory leg servos.'),
  mod('legs_sprint', 'legs', 'Sprint Servos', 1, 300, 'Movement speed +12%.', { speed: 0.12 }, {}, 'stabilizers'),
  mod('legs_gyro', 'legs', 'Gyro Stabilizers', 2, 650, 'Knockback taken -30%. Guard +10%.', { weight: 0.3, guard: 0.1 }, {}, 'stabilizers'),
  mod('legs_jets', 'legs', 'Jump Jets', 2, 800, 'Grants a second jump in mid-air.', {}, { doubleJump: true }, 'thrusters'),
  mod('legs_vector', 'legs', 'Vector Thrusters', 3, 1500, 'Dash in mid-air. Dash cooldown -35%.', {}, { airDash: true, dashCd: 0.35 }, 'thrusters'),
  mod('legs_spurs', 'legs', 'Razor Spurs', 3, 1400, 'Launchers and aerial attacks deal +20% damage.', {}, { airDmg: 0.2 }, 'spurs'),
  mod('legs_phase', 'legs', 'Phase Striders', 4, 3000, 'Dashes phase through attacks. Movement speed +10%.', { speed: 0.1 }, { phaseDash: true }, 'legcoils'),
  // ------------------------------------------------------------ PLATING
  mod('plating_stock', 'plating', 'Standard Plating', 1, 0, 'Factory armor panels.'),
  mod('plating_reinforced', 'plating', 'Reinforced Plating', 1, 300, 'Maximum hull +12%.', { hp: 0.12 }, {}, 'pauldrons'),
  mod('plating_ablative', 'plating', 'Ablative Shell', 2, 700, 'Damage taken -10%.', { def: 0.1 }, {}, 'bulwark'),
  mod('plating_reactive', 'plating', 'Reactive Plating', 2, 800, 'Blocking takes no chip damage and jolts melee attackers for 3 damage.', {}, { noChip: true, thorns: 3 }, 'hexplate'),
  mod('plating_spiked', 'plating', 'Spiked Bulwark', 3, 1500, 'Guard +20%. Guard regenerates 50% faster.', { guard: 0.2 }, { guardRegen: 0.5 }, 'spikes'),
  mod('plating_nano', 'plating', 'Nanoweave Mantle', 3, 1700, 'Self-repairs 1.2 hull per second.', {}, { regen: 1.2 }, 'mantle'),
  mod('plating_aegis', 'plating', 'Aegis Barrier', 4, 3300, 'Start every round with a 25 point energy barrier. Hull +8%.', { hp: 0.08 }, { barrier: 25 }, 'hexplate'),
  // ------------------------------------------------------------ CHIP
  mod('chip_stock', 'chip', 'Baseline OS', 1, 0, 'Factory combat firmware.'),
  mod('chip_targeting', 'chip', 'Targeting Suite', 1, 300, 'Critical chance +8%.', { crit: 0.08 }, {}, 'optics'),
  mod('chip_reflex', 'chip', 'Reflex Booster', 2, 700, 'Parry window +50%.', {}, { parryWindow: 0.5 }, 'antenna'),
  mod('chip_combo', 'chip', 'Combo Compiler', 2, 800, 'Combo damage decays far more slowly.', {}, { comboScale: true }, 'antenna'),
  mod('chip_berserk', 'chip', 'Berserker Kernel', 3, 1500, 'Below 30% hull, deal +30% damage.', {}, { lastStand: 0.3 }, 'horns'),
  mod('chip_counter', 'chip', 'Counter Matrix', 3, 1600, 'A successful parry restores 30 energy and 15% overdrive.', {}, { parryRefund: true }, 'crest'),
  mod('chip_apex', 'chip', 'Apex Predator OS', 4, 3400, '+10% damage, +10% speed. The first hit of each round deals +50%.', { atk: 0.1, speed: 0.1 }, { firstStrike: 0.5 }, 'horns'),
];
export const MOD_BY_ID = Object.fromEntries(MODS.map((m) => [m.id, m]));
export const DEFAULT_MODS = { core: 'core_stock', arms: 'arms_stock', legs: 'legs_stock', plating: 'plating_stock', chip: 'chip_stock' };

// ---------------------------------------------------------------------------
const perk = (id, branch, tier, name, desc, stats = {}, fx = {}) => ({ id, branch, tier, name, desc, stats, fx });
export const PERK_BRANCHES = [
  { id: 'offense', name: 'OFFENSE', color: '#ff5a3c' },
  { id: 'defense', name: 'DEFENSE', color: '#3fa9ff' },
  { id: 'systems', name: 'SYSTEMS', color: '#4dffd2' },
];
export const PERKS = [
  perk('sharp', 'offense', 1, 'Sharpened Servos', 'All damage +5%.', { atk: 0.05 }),
  perk('gambit', 'offense', 1, 'Opening Gambit', 'The first hit of each round deals +30% damage.', {}, { firstStrike: 0.3 }),
  perk('juggler', 'offense', 2, 'Juggler', '+15% damage against airborne targets.', {}, { juggle: 0.15 }),
  perk('crusher', 'offense', 2, 'Guard Crusher', '+25% guard damage.', {}, { guardDmg: 0.25 }),
  perk('critsub', 'offense', 3, 'Critical Subroutines', 'Critical chance +8%.', { crit: 0.08 }),
  perk('punisher', 'offense', 3, 'Punisher', '+20% damage against stunned or recovering targets.', {}, { punish: 0.2 }),
  perk('overkill', 'offense', 4, 'Overkill', 'Overdrive attacks deal +20% damage.', {}, { overdriveDmg: 0.2 }),
  perk('momentum', 'offense', 4, 'Momentum', 'Each hit in a combo adds +2% damage (max +20%).', {}, { momentum: 0.02 }),

  perk('frame', 'defense', 1, 'Hardened Frame', 'Maximum hull +8%.', { hp: 0.08 }),
  perk('brace', 'defense', 1, 'Brace', 'Guard +15%.', { guard: 0.15 }),
  perk('absorb', 'defense', 2, 'Shock Absorbers', 'Hitstun taken -12%.', {}, { stunResist: 0.12 }),
  perk('deflector', 'defense', 2, 'Deflector', 'Parry window +25%.', {}, { parryWindow: 0.25 }),
  perk('wind', 'defense', 3, 'Second Wind', 'Once per round, dropping below 25% hull triggers an emergency repair of 12%.', {}, { secondWind: 0.12 }),
  perk('fortress', 'defense', 3, 'Fortress', 'Damage taken -8%.', { def: 0.08 }),
  perk('unbreak', 'defense', 4, 'Unbreakable', 'Guard-break stun -40%. Guard regenerates 40% faster.', {}, { breakResist: 0.4, guardRegen: 0.4 }),
  perk('laststand', 'defense', 4, 'Last Stand', 'Below 25% hull, take 25% less damage.', {}, { lastDef: 0.25 }),

  perk('coils', 'systems', 1, 'Efficient Coils', 'Energy regeneration +15%.', { energyRegen: 0.15 }),
  perk('tap', 'systems', 1, 'Meter Tap', 'Overdrive builds 15% faster.', { meter: 0.15 }),
  perk('specops', 'systems', 2, 'Spec Ops', 'Specials cost 10% less energy.', {}, { specialCost: 0.1 }),
  perk('scavenger', 'systems', 2, 'Scavenger', '+20% credits from every fight.', {}, { credits: 0.2 }),
  perk('learner', 'systems', 3, 'Fast Learner', '+20% experience from every fight.', {}, { xp: 0.2 }),
  perk('battery', 'systems', 3, 'Kinetic Battery', 'Blocking a hit restores 5 energy.', {}, { blockEnergy: 5 }),
  perk('overflow', 'systems', 4, 'Overflow', 'Start every round with 35% overdrive.', {}, { startMeter: 35 }),
  perk('twin', 'systems', 4, 'Twin Drive', 'Maximum energy +30.', { energyMax: 30 }),
];
export const PERK_BY_ID = Object.fromEntries(PERKS.map((p) => [p.id, p]));
/** points that must already be invested in the branch to unlock a tier */
export const PERK_TIER_REQ = [0, 0, 2, 4, 6];

// ---------------------------------------------------------------------------
export const PAINTS = [
  { id: 'factory', name: 'Factory', level: 1 }, // uses the chassis default
  { id: 'crimson', name: 'Crimson Ace', level: 1, primary: 0xb3122a, secondary: 0x1b1c22, glow: 0xff5a3c, trim: 0xd6d9df },
  { id: 'ghost', name: 'Ghost White', level: 2, primary: 0xe6e9ee, secondary: 0x9aa3b2, glow: 0x7fd4ff, trim: 0x3a4250 },
  { id: 'toxic', name: 'Toxic', level: 3, primary: 0x1d2a1f, secondary: 0x0f1210, glow: 0x7dff3a, trim: 0x6b7a5e },
  { id: 'sunforge', name: 'Sunforge', level: 4, primary: 0xe08a12, secondary: 0x2a2018, glow: 0xffe15a, trim: 0x3b3b40 },
  { id: 'midnight', name: 'Midnight', level: 5, primary: 0x10162e, secondary: 0x0a0c14, glow: 0x3b6bff, trim: 0x8892a8 },
  { id: 'sakura', name: 'Sakura', level: 6, primary: 0xf2c4d2, secondary: 0x3a2a36, glow: 0xff5fa8, trim: 0xf0e6d6 },
  { id: 'verdigris', name: 'Verdigris', level: 8, primary: 0x1f6b62, secondary: 0x3a2f22, glow: 0x5affd0, trim: 0xb07a3c },
  { id: 'obsidian', name: 'Obsidian', level: 10, primary: 0x0b0b0e, secondary: 0x1a1a20, glow: 0xff2a2a, trim: 0x54545c, metal: 0.9, rough: 0.3 },
  { id: 'royal', name: 'Royal', level: 12, primary: 0x4a1f8f, secondary: 0x19122a, glow: 0xffc94a, trim: 0xe6c15a },
  { id: 'chrome', name: 'Liquid Chrome', level: 14, primary: 0xcfd6e0, secondary: 0x6b7482, glow: 0x9fe8ff, trim: 0xffffff, metal: 1, rough: 0.16, coat: 1 },
  { id: 'apex', name: 'Apex Gold', level: 16, primary: 0xd9a520, secondary: 0x16130c, glow: 0xfff2a0, trim: 0xfff0c0, metal: 1, rough: 0.22, coat: 1 },
];
export const PAINT_BY_ID = Object.fromEntries(PAINTS.map((p) => [p.id, p]));

export function resolvePaint(chassisId, paintId) {
  const p = PAINT_BY_ID[paintId];
  if (!p || p.id === 'factory' || p.primary === undefined) return CHASSIS[chassisId].paint;
  return p;
}

// ---------------------------------------------------------------------------
export const ARENAS = {
  foundry: { id: 'foundry', name: 'The Foundry Pit' },
  skydeck: { id: 'skydeck', name: 'Neon Skydeck' },
  cryo: { id: 'cryo', name: 'Cryo Vault 9' },
  orbital: { id: 'orbital', name: 'Orbital Crown' },
};

export const MODIFIERS = {
  overcharged: { name: 'OVERCHARGED', desc: 'Both fighters regenerate energy twice as fast.' },
  armored: { name: 'HEAVY ARMOR', desc: 'The opponent shrugs off light attacks until its guard is broken once.' },
  lowgrav: { name: 'LOW GRAVITY', desc: 'Gravity is reduced by 40%. Juggles go on forever.' },
  sudden: { name: 'SUDDEN DEATH', desc: 'One round only. Everything hits 50% harder.' },
  nometer: { name: 'DAMPENED', desc: 'Overdrive builds at half speed.' },
  frenzy: { name: 'FRENZY', desc: 'The opponent starts with a full Overdrive meter.' },
};

const E = (name, chassis, level, paint, mods, opts = {}) => ({ name, chassis, level, paint, mods, ...opts });
const stage = (id, name, enemy, o = {}) => ({ id, name, enemy, rounds: 2, ...o });

export const SECTORS = [
  {
    id: 's1', name: 'SCRAPYARD CIRCUIT', arena: 'foundry', color: '#ff8a3c',
    blurb: 'Unsanctioned pit fights under the old smelter. Win here and people start learning your callsign.',
    stages: [
      stage('1-1', 'First Blood', E('RUSTBUCKET', 'vanguard', 1, { primary: 0x6b4a32, secondary: 0x3a3a3a, glow: 0xffb040, trim: 0x55504a }, []), { rounds: 1, intro: 'A salvage-rig duelist held together by spite. Learn the basics.' }),
      stage('1-2', 'Quick Hands', E('FLICKER', 'wraith', 2, { primary: 0x3a4a3a, secondary: 0x151a15, glow: 0xa0ff50, trim: 0x707a70 }, ['legs_sprint']), { intro: 'Fast and fragile. Block the flurry, punish the gap.' }),
      stage('1-3', 'Live Wire', E('STATIC', 'tempest', 3, { primary: 0x8a8f96, secondary: 0x33363c, glow: 0xffe14a, trim: 0x55585e }, ['core_overclock']), { intro: 'Keeps you at arm\'s length. Dash through the gaps.' }),
      stage('1-4', 'King of the Pit', E('GRINDER', 'bastion', 4, { primary: 0x35383d, secondary: 0x1a1b1e, glow: 0xff3b1f, trim: 0xb08a3c }, ['arms_tungsten', 'plating_reinforced'], { boss: true }), { boss: true, drop: 'arms_thermal', intro: 'The pit champion. He has crushed forty frames. Do not trade heavy blows.' }),
    ],
  },
  {
    id: 's2', name: 'NEON UNDERLEAGUE', arena: 'skydeck', color: '#ff4fd8',
    blurb: 'Rooftop bouts broadcast to the whole arcology. The crowd wants spectacle. Give it to them.',
    stages: [
      stage('2-1', 'Bouncer', E('BULKHEAD', 'bastion', 5, { primary: 0x263a7a, secondary: 0x14161c, glow: 0x4fd8ff, trim: 0x9aa0aa }, ['plating_ablative']), { intro: 'Club security turned prizefighter.' }),
      stage('2-2', 'Showtime', E('PALADIN-7', 'vanguard', 6, { primary: 0xe6e9ee, secondary: 0xb3122a, glow: 0xff4fd8, trim: 0xe6c15a }, ['core_surge', 'arms_tungsten']), { modifier: 'overcharged', intro: 'A league poster-bot. Expect a storm of specials.' }),
      stage('2-3', 'Silk and Steel', E('SILK', 'wraith', 7, { primary: 0xf2c4d2, secondary: 0x2a1a26, glow: 0xff5fa8, trim: 0xf0e6d6 }, ['arms_mono', 'legs_jets']), { intro: 'Never stops moving. Parry to pin her down.' }),
      stage('2-4', 'Eye of the Storm', E('MAELSTROM', 'tempest', 8, { primary: 0x1a1030, secondary: 0x0c0818, glow: 0xff4fd8, trim: 0x4fd8ff }, ['core_capacitor', 'chip_targeting', 'plating_reinforced'], { boss: true }), { boss: true, drop: 'core_singularity', intro: 'Underleague champion. The sky itself is on its side.' }),
    ],
  },
  {
    id: 's3', name: 'CRYO VAULT TRIALS', arena: 'cryo', color: '#6fd6ff',
    blurb: 'A corporate proving ground deep under the ice. Prototype frames. Zero spectators. No mercy protocols.',
    stages: [
      stage('3-1', 'Cold Open', E('FROSTBYTE', 'tempest', 9, { primary: 0xcfe8f6, secondary: 0x2b4a67, glow: 0x7fd4ff, trim: 0xffffff }, ['core_overclock', 'chip_reflex', 'legs_gyro']), { intro: 'Prototype caster with tuned reflexes.' }),
      stage('3-2', 'Permafrost', E('GLACIER', 'bastion', 10, { primary: 0x9fc4d6, secondary: 0x1c2a36, glow: 0xc8f4ff, trim: 0x5a6a78 }, ['plating_spiked', 'arms_siege', 'legs_gyro']), { modifier: 'armored', intro: 'Break its guard or it will simply walk through you.' }),
      stage('3-3', 'White Knight', E('IVORY', 'vanguard', 11, { primary: 0xf2f4f6, secondary: 0x8892a8, glow: 0x7fb6ff, trim: 0xc8d2e0 }, ['chip_combo', 'arms_mono', 'plating_ablative', 'legs_sprint']), { modifier: 'nometer', intro: 'A flawless duelist. Fundamentals win this one.' }),
      stage('3-4', 'Zero Signal', E('NULL', 'wraith', 12, { primary: 0x0b0b0e, secondary: 0x16161c, glow: 0xff2a2a, trim: 0x44444c, metal: 0.9, rough: 0.3 }, ['legs_vector', 'arms_executioner', 'chip_reflex', 'core_vampiric'], { boss: true }), { boss: true, drop: 'legs_vector', intro: 'The Vault\'s black project. It was built to delete frames like yours.' }),
    ],
  },
  {
    id: 's4', name: 'ORBITAL CROWN', arena: 'orbital', color: '#ffd76a',
    blurb: 'The championship ring, in orbit, live to nine billion viewers. One frame leaves with the Crown.',
    stages: [
      stage('4-1', 'Evening Star', E('VESPER', 'wraith', 13, { primary: 0x4a1f8f, secondary: 0x19122a, glow: 0xffc94a, trim: 0xe6c15a }, ['legs_phase', 'arms_mono', 'chip_counter', 'plating_nano']), { intro: 'Three-time finalist. Punishes every mistake.' }),
      stage('4-2', 'Solar Wind', E('HELIOS', 'tempest', 14, { primary: 0xe08a12, secondary: 0x2a2018, glow: 0xffe15a, trim: 0xfff0c0 }, ['core_singularity', 'chip_targeting', 'plating_aegis', 'legs_jets']), { modifier: 'lowgrav', intro: 'Low-gravity exhibition. Whoever owns the air owns the round.' }),
      stage('4-3', 'Gatekeeper', E('TITANFALL', 'bastion', 15, { primary: 0x16130c, secondary: 0x3b3b40, glow: 0xffb637, trim: 0xd9a520 }, ['arms_siege', 'plating_aegis', 'core_surge', 'chip_berserk', 'legs_gyro']), { modifier: 'frenzy', intro: 'Nothing has gotten past it in six seasons.' }),
      stage('4-4', 'The Crown', E('APEX PRIME', 'vanguard', 17, { primary: 0xd9a520, secondary: 0x16130c, glow: 0xfff2a0, trim: 0xfff0c0, metal: 1, rough: 0.22, coat: 1 }, ['core_phoenix', 'arms_executioner', 'legs_vector', 'plating_aegis', 'chip_apex'], { boss: true }), { boss: true, rounds: 2, drop: 'chip_apex', intro: 'The undefeated champion. Every trick you have, it has already seen. Show it one more.' }),
    ],
  },
];
export const STAGES = SECTORS.flatMap((s) => s.stages.map((st) => ({ ...st, sector: s.id, arena: s.arena })));
export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]));

export const MAX_LEVEL = 30;
export function xpForLevel(level) {
  // xp required to go from `level` to `level + 1`
  return Math.round(120 + 70 * Math.pow(level, 1.35));
}

export function stageRewards(st) {
  const lv = st.enemy.level;
  return { credits: 160 + 62 * lv + (st.boss ? 300 : 0), xp: 90 + 34 * lv + (st.boss ? 150 : 0) };
}

export const CONTROLS = [
  ['A / D', 'Move'],
  ['W', 'Jump'],
  ['J', 'Light attack (tap ×3 to chain)'],
  ['K', 'Heavy attack (hold to charge a guard-breaker)'],
  ['S + K', 'Launcher'],
  ['L', 'Special · neutral'],
  ['→ + L', 'Special · forward'],
  ['S + L', 'Special · down'],
  ['I', 'Block (tap just before impact to PARRY)'],
  ['SPACE', 'Dash (hold back to back-dash)'],
  ['O', 'OVERDRIVE (full meter)'],
  ['ESC', 'Pause'],
];
