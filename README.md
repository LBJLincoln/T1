# LUMEN

A living digital organism, rendered live in your browser. One page, one canvas,
two shaders, zero libraries.

```bash
npx http-server -p 8123 .    # any static server works
```

A quarter of a million particles condense out of the dark and become five
bodies as you scroll — a nebula, a torus knot, a double helix, the word LUMEN,
and a spiral galaxy that follows your cursor. Click anywhere and a shockwave
rolls through it. Turn the sound on and a generative drone breathes with the
page, retuning as each scene arrives.

## How it works

- **GPU simulation.** Positions and velocities live in float textures,
  advanced entirely on the GPU: spring toward a morph target, divergence-free
  curl noise, a cursor force field (repulsive in early scenes, attractive in
  the last), and click shockwaves. The CPU only uploads new target shapes.
- **Fixed-substep physics.** The sim steps at 90Hz regardless of display rate,
  so a slow GPU gets slow motion — never different dynamics or exploded
  springs. Breath is evaluated per-substep in the shader; computing it
  per-frame aliases badly under substepping (found the hard way).
- **Scene transitions are physical.** Two target textures and a blend uniform:
  the organism swims to its next body, it never cuts. Every simulation
  parameter, colour, and camera angle blends continuously with scroll.
- **Adaptive fidelity.** A quality ladder (resolution, then draw fraction)
  steps down when sustained frame time exceeds budget and recovers slowly.
  Particle count is chosen from hardware hints at boot (65k–262k).
- **Sound is opt-in and generative.** Two detuned saws through a filter whose
  cutoff follows your scroll velocity, a noise bed, and a pluck on click.
  Scene changes glide the chord root. Nothing plays until you press the button.
- **The DOM is the readable half.** All copy is real HTML. No WebGL2 → a dark,
  legible document. `prefers-reduced-motion` → no idle animation, no custom
  cursor, instant reveals. Headings keep `aria-label` when split into letters.

## Files

```
index.html   structure and copy
style.css    typography, reveals, cursor, nav, reduced-motion rules
main.js      engine, shaders, scenes, audio, wiring (~1000 lines)
```

`?turbo` raises the substep cap (testing on software rasterizers);
`?calm` zeroes the curl noise (debugging convergence).
