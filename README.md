# APEX CHASSIS

A 2.5D robot fighting game for the browser: four modular combat frames, 35 mods, 24 perks,
a 16-bout campaign across four arenas, and a full garage.

Everything on screen and everything you hear is generated at runtime — the robot models, animation,
arenas, particle effects, shaders, sound effects and music. There are no image, model or audio assets.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5173`). A production build goes to `dist/`:

```bash
npm run build
```

Needs a browser with WebGL 2 (current Chrome, Edge, Firefox or Safari).

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | `A` / `D` | Stick / D-pad |
| Jump | `W` | `A` |
| Light attack (chain ×3) | `J` | `X` |
| Heavy attack (hold to charge an unblockable guard crush) | `K` | `Y` |
| Launcher | `S` + `K` | Down + `Y` |
| Special · neutral / forward / down | `L` · direction + `L` · `S` + `L` | `B` |
| Block (tap just before impact to parry) | `I` | `RB` |
| Dash (hold back to back-dash) | `Space` | `RT` |
| Overdrive (full meter) | `O` | `LB` |
| Pause | `Esc` | Start |

Arrow keys and `Z` / `X` / `C` / `V` / `F` work as alternates. On phones and tablets an on-screen stick and
buttons appear automatically.

## How fights work

- **Hull, Guard, Energy, Overdrive.** Blocking stops damage but drains Guard; an empty Guard shatters and
  stuns you. Energy fuels specials and refills over time. Overdrive builds as you deal and take damage.
- **Parry.** Tap block the instant before a hit lands: no guard loss, the attacker is stunned, and
  projectiles are reflected back at their owner.
- **Combos.** Lights chain into each other. On hit, lights cancel into heavies and launchers, heavies into
  specials, specials into the Overdrive. Launch, then jump to continue in the air. Damage scales down the
  longer a combo runs.
- **Rounds.** Best of three, 60 seconds each (the first campaign bout is a single round).

## The frames

| Frame | Style | Signature tools |
| --- | --- | --- |
| **Vanguard** | Balanced arc-blade duelist | Arc Lance projectile, Vector Rush dash-cut, Aegis Pulse dome |
| **Bastion** | Slow, armored siege breaker | Faultline ground wave, Freight Charge, Magnet Well |
| **Wraith** | Fragile phase assassin | Phantom Fan shuriken, Blink Sever teleport, exploding Mirage decoy |
| **Tempest** | Hovering storm caster | Ball Lightning, sky-called Chain Bolt, Storm Step static trap |

Each frame has its own stance, a three-hit light chain, heavy, launcher, two air attacks, three specials
and a cinematic Overdrive.

## Progression

- **Campaign** — four sectors of four bouts, each ending in a boss with a guaranteed mod drop. Stage
  modifiers (low gravity, overcharged energy, armored opponents and more) change the rules. Bouts award up
  to three stars and can be replayed.
- **Mods** — five slots per frame (reactor core, arms, legs, plating, combat chip), seven mods per slot,
  four rarities. Every equipped mod is visible on the robot.
- **Perks** — three branches (Offense, Defense, Systems) of eight perks, bought with a point per pilot
  level. Respec is free.
- **Paint** — twelve schemes that unlock with pilot level.
- **Quick Battle** — any opponent frame, arena and difficulty.

Progress is saved in the browser's local storage.

## Project layout

```
src/
  main.js              app shell, main loop, menu showroom
  engine/
    renderer.js        WebGL renderer, HDR bloom, final post pass, adaptive resolution
    fx.js              particles, trails, shockwaves, lightning, beams, slash arcs, hex shields
    audio.js           synthesized sound effects and generative music
    input.js           keyboard, gamepad and touch
  robots/
    builder.js         skeleton rig, geometry helpers, materials, after-image ghosts
    chassis.js         the four robot models and mod attachments
    anim.js            pose format, clips, cross-fading animator
    moveset.js         stances, animation clips and move data for each frame
  game/
    data.js            chassis stats, mods, perks, paints, campaign
    profile.js         save data and stat calculation
    fighter.js         fighter state machine, cancels, damage resolution
    fight.js           match flow, hit detection, projectiles, camera
    ai.js              opponent AI
    arenas.js          the four arenas and the garage hangar
  ui/                  HUD, menus, stylesheet
```

## Developer tools

- `debug.html?mode=lineup` renders the four frames side by side;
  `debug.html?mode=anim&robot=wraith&anim=launcher&n=8` renders a contact sheet of one animation.
- Adding `?manual` to the game URL stops the real-time loop so tests can step frames with
  `__app.debugStep(dt, n)`; `?q=low|medium|high|ultra` overrides the graphics quality for the session.
