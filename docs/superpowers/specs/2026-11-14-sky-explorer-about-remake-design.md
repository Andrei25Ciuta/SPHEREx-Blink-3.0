# Sky Explorer and About Refresh

## Intent

Make Sky Explorer more inviting, colorful, and interactive, and give the About section a more pleasant visual story. The user asked to combine a richer existing atlas with a new globe-style view.

## Goals

- Add an interactive, rotatable celestial globe that shows the five documented challenge targets.
- Retain and visually refresh the existing 2D orientation atlas as the precise, accessible target selector.
- Keep target selection synchronized between the globe, atlas, target list, and archive coordinate fields.
- Restyle the About section into a colorful, readable introduction with a stronger hero and visually distinct project/stat/story panels.
- Keep all navigation, themes, IRSA search, Aladin map, workspace links, and scientific wording and limitations intact.

## Non-goals

- Do not add or change astronomy data, search endpoints, archive behavior, coordinate calculations, target identities, or survey-coverage claims.
- Do not replace the atlas with a globe-only interface.
- Do not add a dependency or a live Earth/sky imagery service.

## Approaches

1. **Color the current atlas only.** Lowest risk and preserves the existing navigator, but does not combine both requested views.
2. **Replace the atlas with a new globe.** Adds depth but removes the established 2D orientation and direct target-selection surface.
3. **Combine the views (chosen).** Add a lightweight, interactive celestial-sphere illustration above the existing atlas. Both views use the same documented target positions and selection state; the atlas remains the accessible navigator and the globe adds an immersive overview. This is the user's requested combination.

## Design

Use the existing Midnight theme and shared tokens as the base, with more saturated cyan, violet, blue, and warm accent treatments for the atlas, target markers, status cards, and About artwork. Keep text contrast and the other saved themes intact. Prefer the project's vanilla HTML, CSS, and JavaScript; draw the globe without a new runtime dependency. Drag rotates it, pointer selection chooses a target, and the accessible target buttons remain available for keyboard and touch use. The 2D atlas remains labeled as an orientation aid, not a coverage map. The About section remains at `index.html#about` and retains its current scientific explanation, data caveat, and route to the workspace.

## Constraints

- Preserve the original shared navigation bar and theme selector.
- Reuse current target definitions and propagated coordinates; do not duplicate or invent coordinate records.
- Reduced-motion preferences disable decorative automatic motion; manual target selection still works.
- Keep responsive layouts usable without horizontal overflow, and keep the canvas/globe from blocking header controls.
- Do not alter IRSA query or result behavior.

## Review focus

- Globe markers and atlas selection stay synchronized with archive coordinate fields.
- Keyboard users can choose every target without dragging.
- The page remains understandable when canvas rendering is unavailable.
- The About content remains readable and clearly labels synthetic data and generated artwork.
- Navigation and theme control retain their existing layout and behavior at desktop and mobile widths.
