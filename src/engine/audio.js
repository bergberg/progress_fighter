// Fully procedural audio: every sound effect and all music is synthesised with WebAudio.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

const TRACKS = {
  menu: { bpm: 92, root: 45, scale: [0, 3, 5, 7, 10], prog: [0, -4, -7, -2], mood: 'calm' },
  foundry: { bpm: 126, root: 38, scale: [0, 3, 5, 6, 7, 10], prog: [0, 0, -2, 3], mood: 'heavy' },
  skydeck: { bpm: 132, root: 42, scale: [0, 2, 3, 7, 8, 10], prog: [0, -4, 3, -2], mood: 'synth' },
  cryo: { bpm: 118, root: 40, scale: [0, 2, 3, 7, 10], prog: [0, 5, -4, -2], mood: 'airy' },
  orbital: { bpm: 138, root: 36, scale: [0, 3, 5, 7, 8, 10], prog: [0, -2, -4, 3], mood: 'epic' },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxVol = 0.8;
    this.musicVol = 0.5;
    this.track = null;
    this.wantTrack = null;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.lastPlayed = {};
  }

  /** must be called from a user gesture */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.2;
    this.comp.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVol;
    this.sfx.connect(this.comp);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicVol * 0.55;
    this.music.connect(this.comp);
    // music bus fx: feedback delay
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.32;
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    this.delay.connect(dl);
    dl.connect(fb);
    fb.connect(this.delay);
    dl.connect(this.music);
    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.wantTrack) this.playMusic(this.wantTrack);
  }

  setVolumes(sfx, music) {
    this.sfxVol = sfx;
    this.musicVol = music;
    if (this.ctx) {
      this.sfx.gain.value = sfx;
      this.music.gain.setTargetAtTime(music * 0.55, this.ctx.currentTime, 0.05);
    }
  }

  // ---- primitives -----------------------------------------------------------
  tone(o) {
    const ctx = this.ctx;
    const t = ctx.currentTime + (o.at || 0);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, o.f0), t);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
    const g = ctx.createGain();
    const a = o.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain ?? 0.3), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.lp, t);
      if (o.lp1) f.frequency.exponentialRampToValueAtTime(o.lp1, t + o.dur);
      f.Q.value = o.q ?? 1;
      node.connect(f);
      node = f;
    }
    if (o.vib) {
      const l = ctx.createOscillator();
      l.frequency.value = o.vib;
      const lg = ctx.createGain();
      lg.gain.value = o.vibDepth ?? o.f0 * 0.05;
      l.connect(lg);
      lg.connect(osc.frequency);
      l.start(t);
      l.stop(t + o.dur + 0.05);
    }
    node.connect(g);
    g.connect(o.out || this.sfx);
    if (o.send) {
      const s = ctx.createGain();
      s.gain.value = o.send;
      g.connect(s);
      s.connect(this.delay);
    }
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  noise(o) {
    const ctx = this.ctx;
    const t = ctx.currentTime + (o.at || 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
    f.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    const a = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain ?? 0.3), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(o.out || this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + o.dur + 0.05);
  }

  // ---- sound effects --------------------------------------------------------
  play(name, opts = {}) {
    if (!this.ctx || this.sfxVol <= 0) return;
    const now = this.ctx.currentTime;
    // avoid machine-gunning identical sounds in the same instant
    if (this.lastPlayed[name] && now - this.lastPlayed[name] < 0.035) return;
    this.lastPlayed[name] = now;
    const at = opts.delay || 0;
    const p = opts.power ?? 0.6;
    const T = (o) => this.tone({ ...o, at: at + (o.at || 0) });
    const N = (o) => this.noise({ ...o, at: at + (o.at || 0) });
    const r = () => 0.94 + Math.random() * 0.12;
    switch (name) {
      case 'whoosh': N({ f0: 500 * r(), f1: 2200, dur: 0.14, gain: 0.16, q: 1.2 }); break;
      case 'whooshHeavy': N({ f0: 220 * r(), f1: 1500, dur: 0.26, gain: 0.26, q: 1 }); N({ type: 'lowpass', f0: 300, f1: 90, dur: 0.22, gain: 0.2 }); break;
      case 'slash': N({ type: 'highpass', f0: 2200 * r(), f1: 7000, dur: 0.13, gain: 0.2 }); T({ f0: 2100 * r(), f1: 900, dur: 0.1, gain: 0.05, type: 'triangle' }); break;
      case 'slashHeavy': N({ type: 'highpass', f0: 1400, f1: 6500, dur: 0.24, gain: 0.26 }); T({ f0: 1500, f1: 420, dur: 0.22, gain: 0.08, type: 'sawtooth', lp: 4000 }); N({ f0: 300, f1: 1200, dur: 0.22, gain: 0.16 }); break;
      case 'hitLight': N({ type: 'lowpass', f0: 2400, f1: 500, dur: 0.07, gain: 0.5 }); T({ f0: 210 * r(), f1: 80, dur: 0.09, gain: 0.5 }); T({ f0: 900 * r(), f1: 500, dur: 0.04, gain: 0.12, type: 'square', lp: 3000 }); break;
      case 'hitMedium': N({ type: 'lowpass', f0: 2000, f1: 300, dur: 0.11, gain: 0.6 }); T({ f0: 170 * r(), f1: 55, dur: 0.14, gain: 0.7 }); T({ f0: 640 * r(), f1: 320, dur: 0.07, gain: 0.16, type: 'square', lp: 2600 }); break;
      case 'hitHeavy':
        N({ type: 'lowpass', f0: 1800, f1: 120, dur: 0.24, gain: 0.8 });
        T({ f0: 140 * r(), f1: 36, dur: 0.32, gain: 0.95 });
        T({ f0: 317 * r(), f1: 290, dur: 0.22, gain: 0.14, type: 'square', lp: 2200 });
        T({ f0: 503 * r(), f1: 470, dur: 0.18, gain: 0.1, type: 'square', lp: 2600 });
        N({ type: 'highpass', f0: 4000, dur: 0.05, gain: 0.3 });
        break;
      case 'block': T({ f0: 820 * r(), f1: 780, dur: 0.08, gain: 0.14, type: 'square', lp: 5000 }); T({ f0: 1290 * r(), f1: 1240, dur: 0.1, gain: 0.1, type: 'square', lp: 6000 }); N({ type: 'highpass', f0: 3000, dur: 0.04, gain: 0.25 }); T({ f0: 150, f1: 70, dur: 0.07, gain: 0.3 }); break;
      case 'armor': T({ f0: 233 * r(), f1: 220, dur: 0.2, gain: 0.2, type: 'square', lp: 1800 }); T({ f0: 349, f1: 330, dur: 0.16, gain: 0.14, type: 'square', lp: 2000 }); N({ type: 'lowpass', f0: 900, dur: 0.08, gain: 0.4 }); break;
      case 'parry':
        for (const [f, g2] of [[1318, 0.22], [1976, 0.16], [2637, 0.12], [3951, 0.06]]) T({ f0: f, dur: 0.6, gain: g2, type: 'sine' });
        N({ type: 'highpass', f0: 5000, dur: 0.06, gain: 0.35 });
        T({ f0: 300, f1: 60, dur: 0.25, gain: 0.5 });
        break;
      case 'guardBreak':
        for (let i = 0; i < 7; i++) N({ type: 'highpass', f0: 2500 + Math.random() * 4000, dur: 0.07 + Math.random() * 0.1, gain: 0.3, at: i * 0.035 });
        T({ f0: 700, f1: 70, dur: 0.4, gain: 0.3, type: 'sawtooth', lp: 3000 });
        T({ f0: 120, f1: 35, dur: 0.35, gain: 0.7 });
        break;
      case 'zap': T({ f0: 1500 * r(), f1: 180, dur: 0.13, gain: 0.16, type: 'sawtooth', vib: 70, vibDepth: 500 }); N({ f0: 3500, f1: 1500, dur: 0.1, gain: 0.2, q: 2 }); break;
      case 'shock': T({ f0: 900, f1: 120, dur: 0.3, gain: 0.2, type: 'sawtooth', vib: 55, vibDepth: 400 }); N({ f0: 2500, f1: 800, dur: 0.3, gain: 0.2 }); break;
      case 'thunder': N({ type: 'highpass', f0: 2500, dur: 0.06, gain: 0.6 }); N({ type: 'lowpass', f0: 900, f1: 70, dur: 0.8, gain: 0.8 }); T({ f0: 90, f1: 30, dur: 0.6, gain: 0.7 }); break;
      case 'beam': T({ f0: 220, f1: 240, dur: 0.5, gain: 0.2, type: 'sawtooth', lp: 600, lp1: 5000, vib: 28, vibDepth: 30 }); T({ f0: 331, f1: 350, dur: 0.5, gain: 0.14, type: 'sawtooth', lp: 800, lp1: 6000 }); N({ f0: 800, f1: 5000, dur: 0.45, gain: 0.24 }); break;
      case 'explosion': N({ type: 'lowpass', f0: 2600, f1: 60, dur: 0.8, gain: 1.0 }); T({ f0: 110, f1: 26, dur: 0.7, gain: 1.0 }); N({ type: 'highpass', f0: 3000, dur: 0.08, gain: 0.4 }); break;
      case 'slam': T({ f0: 95, f1: 28, dur: 0.4, gain: 1.0 }); N({ type: 'lowpass', f0: 700, f1: 80, dur: 0.35, gain: 0.7 }); break;
      case 'charge': T({ f0: 180, f1: 900, dur: 0.34, gain: 0.09, type: 'sawtooth', lp: 2500, vib: 24, vibDepth: 40 }); N({ f0: 600, f1: 4000, dur: 0.32, gain: 0.07 }); break;
      case 'chargeReady': T({ f0: 1400, dur: 0.07, gain: 0.16, type: 'square', lp: 5000 }); T({ f0: 2100, dur: 0.12, gain: 0.16, type: 'square', lp: 6000, at: 0.07 }); break;
      case 'teleport': T({ f0: 1800, f1: 240, dur: 0.2, gain: 0.14, type: 'triangle' }); N({ f0: 4000, f1: 500, dur: 0.22, gain: 0.16, q: 2 }); break;
      case 'dash': N({ f0: 1400, f1: 500, dur: 0.14, gain: 0.16 }); break;
      case 'dashHeavy': N({ f0: 300, f1: 2400, dur: 0.3, gain: 0.3 }); T({ f0: 90, f1: 320, dur: 0.28, gain: 0.2, type: 'sawtooth', lp: 1200 }); break;
      case 'jump': T({ f0: 260, f1: 520, dur: 0.09, gain: 0.1, type: 'triangle' }); N({ type: 'lowpass', f0: 800, dur: 0.06, gain: 0.14 }); break;
      case 'land': T({ f0: opts.heavy ? 95 : 130, f1: 45, dur: opts.heavy ? 0.22 : 0.09, gain: opts.heavy ? 0.7 : 0.3 }); N({ type: 'lowpass', f0: 700, f1: 150, dur: opts.heavy ? 0.2 : 0.07, gain: opts.heavy ? 0.5 : 0.2 }); break;
      case 'wave': N({ f0: 700, f1: 3200, dur: 0.3, gain: 0.26 }); T({ f0: 520, f1: 1300, dur: 0.26, gain: 0.1, type: 'sawtooth', lp: 3000 }); break;
      case 'throw': N({ type: 'highpass', f0: 2600, f1: 6000, dur: 0.16, gain: 0.2 }); T({ f0: 1700, f1: 2600, dur: 0.12, gain: 0.05, type: 'triangle' }); break;
      case 'orb': T({ f0: 150, f1: 300, dur: 0.4, gain: 0.2, type: 'sawtooth', lp: 900, vib: 34, vibDepth: 60 }); N({ f0: 2000, dur: 0.3, gain: 0.1, q: 3 }); break;
      case 'magnet': T({ f0: 55, f1: 170, dur: 0.55, gain: 0.34, type: 'sawtooth', lp: 500, lp1: 1800, vib: 18, vibDepth: 14 }); break;
      case 'piston': N({ type: 'highpass', f0: 3000, f1: 1200, dur: 0.22, gain: 0.3 }); T({ f0: 100, f1: 40, dur: 0.14, gain: 0.6 }); break;
      case 'clash': T({ f0: 990, dur: 0.3, gain: 0.14, type: 'square', lp: 5000 }); T({ f0: 1485, dur: 0.3, gain: 0.1, type: 'square', lp: 5000 }); N({ type: 'lowpass', f0: 2000, f1: 200, dur: 0.3, gain: 0.5 }); break;
      case 'overdrive':
        T({ f0: 80, f1: 900, dur: 0.55, gain: 0.26, type: 'sawtooth', lp: 500, lp1: 6000 });
        N({ f0: 400, f1: 6000, dur: 0.55, gain: 0.24 });
        T({ f0: 70, f1: 30, dur: 0.8, gain: 0.9, at: 0.5 });
        for (const f of [523, 784, 1046]) T({ f0: f, dur: 0.9, gain: 0.1, type: 'sawtooth', lp: 3000, at: 0.5 });
        break;
      case 'ko':
        T({ f0: 100, f1: 22, dur: 1.4, gain: 1.0 });
        N({ type: 'lowpass', f0: 3000, f1: 50, dur: 1.6, gain: 0.8 });
        T({ f0: 880, f1: 110, dur: 1.2, gain: 0.12, type: 'sawtooth', lp: 2000 });
        break;
      case 'round': for (const [f, a2] of [[392, 0], [523, 0.12]]) { T({ f0: f, dur: 0.35, gain: 0.14, type: 'sawtooth', lp: 2400, at: a2 }); T({ f0: f * 1.5, dur: 0.35, gain: 0.08, type: 'square', lp: 2400, at: a2 }); } break;
      case 'fight':
        for (const f of [196, 294, 392, 587]) T({ f0: f, dur: 0.6, gain: 0.14, type: 'sawtooth', lp: 800, lp1: 5000 });
        N({ f0: 500, f1: 5000, dur: 0.3, gain: 0.2 });
        T({ f0: 90, f1: 40, dur: 0.3, gain: 0.7 });
        break;
      case 'intro': T({ f0: 55, f1: 110, dur: 2.2, gain: 0.3, type: 'sawtooth', lp: 200, lp1: 1600, attack: 0.8 }); N({ f0: 300, f1: 2500, dur: 2.0, gain: 0.08, attack: 1.2 }); break;
      case 'purge':
        for (let i = 0; i < 5; i++) T({ f0: 500 + Math.random() * 900, f1: 300, dur: 0.12, gain: 0.12, type: 'square', lp: 3500, at: i * 0.025 });
        N({ type: 'highpass', f0: 1800, f1: 6000, dur: 0.3, gain: 0.35 });
        N({ type: 'lowpass', f0: 1400, f1: 120, dur: 0.35, gain: 0.6 });
        T({ f0: 160, f1: 45, dur: 0.3, gain: 0.7 });
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) T({ f0: 880, f1: 660, dur: 0.14, gain: 0.1, type: 'square', lp: 2600, at: i * 0.2 });
        break;
      case 'deny': T({ f0: 150, dur: 0.16, gain: 0.16, type: 'square', lp: 900 }); break;
      case 'uiMove': T({ f0: 980, dur: 0.035, gain: 0.07, type: 'triangle' }); break;
      case 'uiSelect': T({ f0: 700, dur: 0.06, gain: 0.1, type: 'triangle' }); T({ f0: 1050, dur: 0.1, gain: 0.1, type: 'triangle', at: 0.05 }); break;
      case 'uiBack': T({ f0: 520, f1: 340, dur: 0.1, gain: 0.1, type: 'triangle' }); break;
      case 'uiEquip': T({ f0: 300, f1: 280, dur: 0.1, gain: 0.14, type: 'square', lp: 2000 }); N({ type: 'highpass', f0: 2500, dur: 0.05, gain: 0.2 }); T({ f0: 880, dur: 0.14, gain: 0.09, type: 'triangle', at: 0.05 }); break;
      case 'uiBuy': [660, 880, 1100, 1320].forEach((f, i) => T({ f0: f, dur: 0.12, gain: 0.1, type: 'triangle', at: i * 0.055 })); break;
      case 'levelUp': [523, 659, 784, 1046, 1318].forEach((f, i) => T({ f0: f, dur: 0.3, gain: 0.12, type: 'sawtooth', lp: 3500, at: i * 0.08 })); break;
      case 'reward': [1046, 1318, 1568, 2093].forEach((f, i) => T({ f0: f, dur: 0.25, gain: 0.08, type: 'sine', at: i * 0.06 })); break;
      case 'star': T({ f0: 1320, f1: 1760, dur: 0.22, gain: 0.14, type: 'triangle' }); N({ type: 'highpass', f0: 5000, dur: 0.1, gain: 0.12 }); break;
      case 'tick': T({ f0: 1500, dur: 0.02, gain: 0.04, type: 'square', lp: 4000 }); break;
      default: break;
    }
  }

  // ---- generative music -----------------------------------------------------
  playMusic(id) {
    this.wantTrack = id;
    if (!this.ctx) return;
    if (this.track === id) return;
    this.track = id;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 40);
  }

  stopMusic() {
    this.wantTrack = null;
    this.track = null;
  }

  schedule() {
    if (!this.ctx || !this.track || this.musicVol <= 0) return;
    const tr = TRACKS[this.track];
    if (!tr) return;
    const spb = 60 / tr.bpm / 4; // 16th notes
    while (this.nextTime < this.ctx.currentTime + 0.16) {
      this.playStep(tr, this.step, this.nextTime - this.ctx.currentTime, spb);
      this.nextTime += spb;
      this.step++;
    }
  }

  playStep(tr, step, at, spb) {
    const out = this.music;
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const chord = tr.prog[bar % tr.prog.length];
    const root = tr.root + chord;
    const sc = tr.scale;
    const deg = (i) => root + sc[((i % sc.length) + sc.length) % sc.length] + 12 * Math.floor(i / sc.length);
    const section = Math.floor(bar / 8) % 3; // arrangement changes every 8 bars
    const calm = tr.mood === 'calm';
    const T = (o) => this.tone({ ...o, at, out });
    const N = (o) => this.noise({ ...o, at, out });
    // drums
    if (!calm) {
      const kick = s16 % 4 === 0 || (tr.mood === 'heavy' && s16 === 10) || (section === 2 && s16 === 14);
      if (kick) T({ f0: 150, f1: 42, dur: 0.22, gain: 0.85 });
      if (s16 === 4 || s16 === 12) { N({ type: 'bandpass', f0: 1800, dur: 0.14, gain: 0.34, q: 0.7 }); T({ f0: 190, f1: 120, dur: 0.1, gain: 0.25 }); }
      if (s16 % 2 === 0 || (section > 0 && s16 % 4 === 3)) N({ type: 'highpass', f0: 7500, dur: s16 % 4 === 2 ? 0.07 : 0.03, gain: s16 % 4 === 2 ? 0.14 : 0.08 });
      if (bar % 4 === 3 && s16 >= 12) N({ type: 'bandpass', f0: 1200 + s16 * 150, dur: 0.07, gain: 0.2 });
    } else if (s16 === 0 && bar % 2 === 0) {
      T({ f0: 90, f1: 45, dur: 0.5, gain: 0.3 });
    }
    // bass
    const bassPat = calm ? [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0] : tr.mood === 'synth' ? [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1] : [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0];
    if (bassPat[s16]) {
      const n = root + (s16 === 14 || s16 === 7 ? 12 : 0) + (s16 === 13 ? sc[2] : 0);
      T({ f0: NOTE(n), dur: calm ? spb * 6 : spb * 1.7, gain: calm ? 0.3 : 0.4, type: 'sawtooth', lp: calm ? 500 : 900, lp1: 180, q: 4 });
      T({ f0: NOTE(n - 12), dur: calm ? spb * 6 : spb * 1.6, gain: 0.32, type: 'sine' });
    }
    // pad chord on the bar
    if (s16 === 0) {
      const dur = spb * 16;
      for (const i of [0, 2, 4]) {
        const f = NOTE(deg(i) + 12);
        T({ f0: f * 1.004, dur, gain: calm ? 0.06 : 0.04, type: 'sawtooth', lp: calm ? 900 : 1300, attack: dur * 0.3, send: 0.4 });
        T({ f0: f * 0.996, dur, gain: calm ? 0.06 : 0.04, type: 'sawtooth', lp: calm ? 900 : 1300, attack: dur * 0.3 });
      }
    }
    // arp / lead
    const arpOn = calm ? s16 % 4 === 2 || s16 % 8 === 5 : section > 0 ? s16 % 2 === 0 || s16 % 8 === 3 : s16 % 4 === 0 || s16 % 8 === 6;
    if (arpOn) {
      const seq = [0, 2, 4, 5, 4, 2, 7, 4, 0, 2, 4, 9, 7, 4, 2, 5];
      const n = deg(seq[(s16 + bar * 3) % 16]) + (calm ? 24 : 24);
      T({ f0: NOTE(n), dur: spb * (calm ? 3 : 1.4), gain: calm ? 0.07 : 0.075, type: tr.mood === 'airy' || calm ? 'triangle' : 'square', lp: 3200, send: 0.55 });
    }
    // epic lead line in the third section
    if (!calm && section === 2 && (s16 === 0 || s16 === 6 || s16 === 10)) {
      const line = [4, 5, 7, 4, 9, 7, 5, 4];
      const n = deg(line[(bar * 3 + s16 / 2) % line.length | 0]) + 24;
      T({ f0: NOTE(n), dur: spb * 5, gain: 0.07, type: 'sawtooth', lp: 2600, vib: 5.5, vibDepth: 6, send: 0.5 });
    }
  }
}
