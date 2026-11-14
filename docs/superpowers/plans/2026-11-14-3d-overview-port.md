# Blink 3.0 3D Overview Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Blink 3.0's public Overview with the approved 3D presentation from `EmanuelGeorge-c/proiect-nasa`.

**Architecture:** Keep the experience confined to the standalone `frontend/overview.html` entry page and a small dedicated stylesheet. Reuse Blink's existing theme and header scripts; keep the existing workspace and science modules untouched. Use a progressively enhanced WebGL scene with a static fallback.

**Tech Stack:** HTML, CSS, existing vanilla JavaScript modules, Three.js loaded optionally from CDN.

**Spec:** `docs/superpowers/specs/2026-11-14-3d-overview-port-design.md`

## Global Constraints

- Preserve all Blink 3.0 navigation destinations and six supported theme identifiers.
- Preserve synthetic-data labeling and existing scientific wording.
- Do not edit analysis modules, query parameters, or backend code.
- Do not push or publish.

## Review Focus

- Three.js/WebGL unavailable: static hero and navigation remain usable.
- Reduced motion enabled: nonessential animation stops.
- Keyboard-only use: theme picker, navigation, model callouts and close controls work.
- Narrow viewport: no clipped content or obscured workspace action.
- Theme query/local preference: existing theme behavior remains intact.

---

### Task 1: Port the Overview presentation

**Files:**
- Modify: `frontend/overview.html`
- Create: `frontend/css/overview-3d.css`
- Modify: `docs/CODEX_PROGRESS.md`
- Reference: `docs/FEATURE_STATUS.md` (no science or feature behavior changes)

**Interfaces:**
- Reuse `js/siteHeader.js` and `js/theme.js` if compatible with the source header.
- Keep existing links to `index.html#workspace`, `sky.html`, `planet-x.html`, `simulator.html`, and `results.html`.

- [ ] Confirm the source page's scripts and markup map to existing Blink IDs and routes; remove duplicate IDs and obsolete/unavailable controls.
- [x] Port the 3D Overview markup and styling, keeping layout and motion rules in the dedicated stylesheet; load Three.js only for the model enhancement.
- [x] Implement keyboard-operable component details and graceful fallback without changing Blink analysis behavior.
- [x] Inspect the diff and record actual results and limitations in `docs/CODEX_PROGRESS.md`. Tests and browser checks are outside this task's authorized scope.
