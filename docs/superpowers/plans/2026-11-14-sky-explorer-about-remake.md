# Sky Explorer and About Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh Sky Explorer with a colorful, rotatable celestial globe synchronized to the existing atlas, and make the About section more visual and welcoming.

**Architecture:** Add a dependency-free Canvas 2D sphere renderer for the sky view, using the existing documented targets and coordinate propagation. Keep the existing Hammer atlas, target list, IRSA search, archive products, and Aladin map. Restyle only the About section and the Sky Explorer presentation; keep the shared site header and theme handling.

**Tech Stack:** Existing vanilla HTML, CSS, ES modules, Canvas 2D, and existing target/math modules. No package or runtime dependency changes.

**Spec:** `docs/superpowers/specs/2026-11-14-sky-explorer-about-remake-design.md`

## Global Constraints

- Preserve the original shared navigation bar and theme selector.
- Reuse current target definitions and propagated coordinates; do not duplicate or invent coordinate records.
- Reduced-motion preferences disable decorative automatic motion; manual target selection still works.
- Keep the atlas labeled as an orientation aid, not a survey-coverage map.
- Do not alter IRSA query or result behavior.
- Do not add a runtime dependency or live imagery service.

## Review Focus

- Rotating the globe leaves target identities and their coordinates unchanged.
- Selecting a globe marker updates the atlas, target detail, and archive coordinate fields together.
- Keyboard users can choose every target through accessible controls without dragging.
- The globe remains understandable if Canvas rendering is unavailable, and reduced motion disables automatic rotation.
- About content preserves synthetic-data and generated-artwork caveats and remains responsive.

---

### Task 1: Add the interactive celestial globe and shared target selection

**Files:**
- Modify: `frontend/sky.html`
- Create: `frontend/js/skyGlobe.js`
- Modify: `frontend/js/skyExplorer.js`
- Modify: `frontend/css/exploration.css`

**Interfaces:**
- `skyGlobe.js` consumes `TARGETS` and `positionAtEpoch` from `js/targets.js`.
- Globe selection emits `sky-target-select` with the selected target `id`.
- `skyExplorer.js` handles that event through the existing atlas selection path so coordinates and detail text stay in one state flow.

- [ ] Add the globe canvas, labelled control/legend text, and an accessible non-drag target control surface to Sky Explorer without moving or removing its shared header.
- [ ] Implement a responsive Canvas sphere with celestial grid, colorful guide paths, and propagated markers for the existing five targets. Map pointer dragging to sphere rotation; disable automatic rotation for reduced motion.
- [ ] Route marker selections through the `sky-target-select` event into the existing atlas selection handler; keyboard target buttons continue to use that same handler.
- [ ] Add theme-token-based color, hover, focus, touch, and fallback styles for the globe and the existing atlas. Keep labels and current data caveats.
- [ ] Update `docs/FEATURE_STATUS.md`, `docs/SCIENTIFIC_LIMITATIONS.md`, and `docs/CODEX_PROGRESS.md` with the illustration/data limits and actual verification performed.

### Task 2: Refresh the About section

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/css/contact-sheet.css`

**Interfaces:**
- Preserve the existing `#about` anchor used by `siteHeader.js` and all `#workspace` links.
- Preserve the current project, data-source, telescope, and synthetic-artwork wording; style its existing content rather than replacing scientific claims.

- [ ] Reorganize the About hero and content into a colorful but readable editorial layout, with a prominent start-exploring action, compact SPHEREx statistics, and visually distinct workflow/data cards.
- [ ] Add responsive and reduced-motion styles scoped to `#about`; keep all existing links and content legible in the saved themes.
- [ ] Review the final diff and run `git diff --check`; do not run or add tests unless requested.
