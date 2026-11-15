# Overview hero text motion design

## Intent

Make the Overview headline feel more polished and connect its emphasis to the moving-space theme, without drawing attention away from the Earth and SPHEREx illustration.

## Approved direction

Replace the per-character headline entrance with a short word-by-word reveal. Give the gold word “moves” one brief sheen as it appears, then reveal the subtitle and calls to action in sequence. The animation runs once on page entry and does not loop. With reduced motion enabled, all text appears immediately and remains readable.

## Scope and constraints

- Change only the Overview hero heading and its entrance sequence.
- Keep the existing copy, layout, Earth/telescope scene, navigation and calls to action unchanged.
- Use the page's existing GSAP dependency; add no libraries.
- Keep the heading's accessible text intact and visible if GSAP is unavailable.
- Honor `prefers-reduced-motion` by skipping the entrance animation.

## Approaches considered

- **Word reveal with one gold sheen (selected):** restrained, readable, and tied to the word that carries the message.
- Hover-only emphasis: subtle, but leaves the first impression unchanged and is not discoverable on touch.
- Repeating shimmer or typing effect: more prominent, but competes with the animated 3D model and can distract from the copy.

## Open choices

None. Timing and travel distance are implementation details; keep them short and subtle.
