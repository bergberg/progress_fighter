// Unified input: keyboard, gamepad and on-screen touch controls.

const KEYMAP = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyW: 'jump', ArrowUp: 'jump',
  KeyS: 'down', ArrowDown: 'down',
  KeyJ: 'light', KeyZ: 'light',
  KeyK: 'heavy', KeyX: 'heavy',
  KeyL: 'special', KeyC: 'special',
  KeyI: 'block', KeyV: 'block', ShiftLeft: 'block', ShiftRight: 'block',
  Space: 'dash',
  KeyO: 'overdrive', KeyF: 'overdrive',
  Escape: 'pause', KeyP: 'pause',
  Enter: 'confirm',
};
// standard gamepad mapping
const PADMAP = { 0: 'jump', 2: 'light', 3: 'heavy', 1: 'special', 5: 'block', 4: 'overdrive', 7: 'dash', 6: 'block', 9: 'pause', 12: 'jump', 13: 'down', 14: 'left', 15: 'right' };

export class Input {
  constructor() {
    this.keys = new Set(); // keyboard held actions
    this.virt = new Set(); // touch held actions
    this.pad = new Set(); // gamepad held actions
    this.presses = [];
    this.any = false;
    this.padAxis = 0;
    this.padDown = false;
    this.lastDevice = 'keyboard';
    this.onPause = null;
    this.onAny = null;

    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.lastDevice = 'keyboard';
      if (!e.repeat) {
        this.any = true;
        this.onAny?.();
      }
      if (!a) return;
      if (!e.repeat && !this.keys.has(e.code)) this.press(a);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.virt.clear();
    });
    window.addEventListener('pointerdown', () => {
      this.any = true;
      this.onAny?.();
    });
  }

  press(a) {
    if (a === 'pause') {
      this.onPause?.();
      return;
    }
    this.presses.push(a);
    if (this.presses.length > 12) this.presses.shift();
  }

  setVirtual(action, on) {
    this.lastDevice = 'touch';
    if (on) {
      if (!this.virt.has(action)) this.press(action);
      this.virt.add(action);
    } else this.virt.delete(action);
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') { gp = p; break; }
    if (!gp) for (const p of pads) if (p && p.connected) { gp = p; break; }
    const now = new Set();
    this.padAxis = 0;
    if (gp) {
      gp.buttons.forEach((b, i) => {
        const a = PADMAP[i];
        if (a && (b.pressed || b.value > 0.5)) now.add(a);
      });
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (ax < -0.4) now.add('left');
      if (ax > 0.4) now.add('right');
      if (ay > 0.55) now.add('down');
      for (const a of now) {
        if (!this.pad.has(a)) {
          this.lastDevice = 'gamepad';
          this.any = true;
          this.onAny?.();
          this.press(a);
        }
      }
    }
    this.pad = now;
  }

  held(action) {
    if (this.virt.has(action) || this.pad.has(action)) return true;
    for (const code of this.keys) if (KEYMAP[code] === action) return true;
    return false;
  }

  axisX() {
    return (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
  }

  takePresses() {
    if (!this.presses.length) return this.presses;
    const p = this.presses;
    this.presses = [];
    return p;
  }

  anyPressed() {
    const a = this.any;
    this.any = false;
    return a;
  }
}
