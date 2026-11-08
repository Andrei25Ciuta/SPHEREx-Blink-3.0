# Accessibility and responsive audit (phone, tablet, projector)

Checked on **7 November 2026** with `scratch/audit_page.js` (paste it in the browser console on the loaded page, with a
candidate list open) at three sizes: phone 375 × 812, tablet 768 × 1024 (not repeated after the fixes), projector 1280 × 720.
It only checks what a script can check. **It does not replace a screen reader, a real phone or another browser** (see the end).

## What was found, and fixed

| Finding (before) | Fix |
|---|---|
| Text of 10-11.5 px: keyboard hints (`kbd`), the metadata labels (`dt`: Detector, Wavelength, MJD, Flags) and the thumbnail captions | minimum 12 px (`.8rem` for the labels and captions) |
| Candidate rank "#1" had a contrast of 4.48:1 against its background (minimum 4.5:1) | lighter colour (`#FF9A86`) |
| The three sliders (field of view, frame, speed) were 6 px tall: a target far under the 24 px minimum (WCAG 2.5.8) | the visible track stays 6 px; the clickable band is 24 px (42 px on touch screens) |
| `summary` elements ("How to spot a moving object", "Show as table") 21 px tall | 34 px |
| Header links 22 px tall | 34 px |
| 35-38 controls under 44 px, the usual comfortable touch size | on touch screens (`pointer: coarse`) every button, chip, candidate row, link, summary and checkbox row is at least 44 px |

After the fixes, at 1280 × 720: **no horizontal overflow, no target under 24 px, no text under 12 px, no low-contrast text** that the
script can measure. At 375 × 812: no horizontal overflow, the main buttons are 44 px high.
(The stylesheet's cache-busting number was raised to `?v=10`, so visitors get the new file.)

Already fine before: every control has an accessible name; the main image is `role="img"` with a label and the thumbnails are
`aria-hidden`; one global `:focus-visible` outline; the guided tour is a dialog that keeps focus inside, closes with Esc and
gives the focus back; reduced motion is respected (no auto-play, the tour does not animate).

## Not checked (do this before relying on it)

- **A screen reader** (NVDA, VoiceOver): not run at all. The live regions and labels exist but their wording was not heard.
- **A real phone** and a real touch screen: the 44 px rule only applies with `pointer: coarse`, which the desktop emulation
  does not trigger, so it was applied by reading the CSS, not seen.
- **Keyboard order and visible focus with a real keyboard**: the focus outline rule exists, but a script cannot trigger
  `:focus-visible`, so it was not seen on every control. Try Tab through the page once.
- **Firefox and Safari**: only Chromium (the app's built-in browser) was used.
- **Text over images and gradients** (the hero banner) is not measured by the contrast check.
- **Tablet** (768 × 1024) was checked before the fixes only.
- **A projector's real colours and brightness**: dark theme only; check the room.

## The results page and the sky-map box (added 7 Nov 2026, evening)

Checked with `scratch/audit_page.js` in the app's built-in browser (Chromium), phone 375 × 812 and desktop:

- **`results.html`**: no horizontal overflow of the page (the wide tables scroll inside their own box); no control without a
  name; a skip link, one `h1`, headings in order; text never below 12 px after one fix (`code` was 11.4 px); links inside
  sentences are 16-19 px high (allowed as inline targets in WCAG 2.5.8); the CSS makes the "Show the numbers" summaries
  and the back link at least 44 px high on touch screens (written, not measured). Re-run after the fix: no text under 12 px,
  nothing wider than the screen outside the table boxes, no control without a name. The charts are HTML and CSS, so text keeps its size on a phone (a scaled SVG would
  have shrunk it to about 7 px); the plot is hidden from screen readers and the **same numbers are in a real table under
  each chart** (`<details>`, closed by default).
- The script reports 4 "low contrast" values (`span.rval.inside`, 1.04:1): **false positives**. The script compares the text
  with the background of the parent, but these values sit inside a pale-teal or orange bar and are dark (`--on-accent`) on it
  (about 7:1 and 4.7:1). Not measured with a tool on the bars themselves.
- **Colour is not the only code**: kept lines are circles and false lines diamonds; the target of the WISE stack is a diamond
  and the controls circles; an off-scale point is a hollow circle with its value written next to it.
- **Sky-map box**: it has `pointer-events: none` (it never takes the mouse), wraps onto two lines on a phone and sits above
  Aladin's own zoom control. It is **not announced by screen readers** on every mouse move on purpose (no `aria-live`); the
  explanation of the country in brackets is a normal paragraph under the map, and the box has a `title` with the same idea.
  The map itself (Aladin Lite) is a canvas and is not keyboard accessible; that is unchanged.
- Not checked: a screen reader on the results page, keyboard-only use of the sky map, Firefox/Safari.

## Re-running

The guided tour modal check runs `scratch/browser_tour_modal.cjs` against the same local server. It verifies that background controls cannot receive pointer input while the tour is open, focus remains within the dialog, Escape restores focus, and an existing inert state survives closing. This is a browser automation check, not a screen reader session.

The Blink 2.0 layout check runs `scratch/browser_layout_audit.cjs` against a local server. It checks all five entry pages at 320, 375, 768 and 1280 CSS pixels in all three themes. It asserts no document-level horizontal overflow, a keyboard-focusable first skip link, and at least 4.5:1 contrast for body, panel and muted text against their solid design-token surfaces. The Planet X recovery table and the detector reference table now scroll within their own containers on small screens. This automated check does not measure text drawn over imagery or canvas plots and does not replace a screen reader audit.

```js
// in the console of the loaded page (resize the window first):
// paste the content of scratch/audit_page.js
```
