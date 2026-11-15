# Overview Hero Text Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Overview hero's per-character animation with a short word reveal and one gold sheen on “moves”.

**Architecture:** Keep the existing inline GSAP timeline on the Overview page. Mark the headline words in HTML so the timeline can reveal each word in order, then reveal the subtitle and calls to action. CSS supplies the one-shot gold sheen and a visible, static fallback.

**Tech Stack:** HTML, CSS, existing GSAP dependency.

**Spec:** `docs/superpowers/specs/2026-11-15-overview-hero-motion-design.md`

## Global Constraints

- Preserve the title copy, page layout, 3D model, navigation and calls to action.
- Add no libraries or repeated animation loops.
- Keep the title readable when GSAP is unavailable or reduced motion is requested.

## Review Focus

- GSAP is unavailable: title remains visible and correctly worded.
- Reduced motion is enabled: entrance is skipped and the text is immediately visible.
- The gold sheen is one-shot and subtle; it does not compete with the rotating 3D model.

---

### Task 1: Mark the title words and sequence the entrance

**Files:**
- Modify: `frontend/overview.html`
- Modify: `frontend/css/overview-3d.css`

**Interfaces:**
- Consumes: the existing `#overview-title`, `#heroSub`, `#heroActions`, `window.gsap` and `reducedMotion` values.
- Produces: stable word targets for “Find”, “what” and “moves”, with the existing semantic heading text preserved.

- [x] Replace the recursive per-character DOM splitter with semantic word spans in the heading.
- [x] Animate the kicker, word spans, “moves” highlight, subtitle and calls to action in a short one-time sequence.
- [x] Skip the timeline when GSAP is unavailable or `reducedMotion` is true; leave all text visible in either case.
- [ ] Review the rendered hero at desktop and narrow widths, including reduced-motion mode.
