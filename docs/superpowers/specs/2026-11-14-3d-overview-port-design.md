# Blink 3.0 3D Overview Port

## Intent

Port the public presentation interface from `EmanuelGeorge-c/proiect-nasa` into `mateibut/SPHEREx-Blink-3.0` so Blink 3.0 opens with the requested immersive 3D overview.

## Design

Replace only `frontend/overview.html` with the approved 3D overview experience. Bring over its visual hierarchy, interactive observatory model, component callouts, theme selector, and transitions. Keep Blink 3.0's existing routes, copy about synthetic data, theme persistence, and workspace behavior. Keep the research workspace and companion tools intact. Make the model controls keyboard-operable, disable decorative motion under `prefers-reduced-motion`, and provide a clear static fallback if WebGL or the external 3D library is unavailable.

## Approaches

- Replace the Overview with the source presentation: chosen because the request is to port that interface into 3.0.
- Add only a 3D section to the current academic Overview: rejected because it would retain the old visual identity rather than port the requested interface.

## Constraints

- Preserve existing Blink links and the six supported theme identifiers.
- Do not change analysis code, scientific claims, query formats, or data behavior.
- External fonts and Three.js remain optional presentation dependencies; the page must remain readable without them.
- Do not publish or push changes.

## Review focus

- Missing or failed WebGL/Three.js still leaves a useful static overview.
- Reduced-motion and keyboard users can navigate and use component details.
- Mobile layout does not cover navigation or the workspace action.
- Theme selection keeps the existing stored preference and query override behavior.
