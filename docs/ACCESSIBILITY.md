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

## Colour themes and "Find everything" (added 8 Nov 2026)

- **Themes** (Midnight / dark and the five Paper palettes: violet, blue, green, signal red, earth; the internal ids are `midnight`, `nebula`, `deep-space`, `observatory`, `light`, `classic`): `scratch/test_theme.mjs` reads the CSS tokens and requires 4.5:1 for every text colour
  (text, secondary text, links, warnings, errors, success, secondary accent) on every surface it can sit on, and for the text on an accent fill, in all four themes;
  inputs and buttons need a 3:1 border in the three new themes (Classic keeps its original faint border: a known gap).
- The script audit (`scratch/audit_page.js`, with the background taken from the theme's `--bg` instead of the Classic colour) at 375 px, with real data and the
  *Find everything* dossier open: 0 text nodes under 4.5:1 and no horizontal overflow in all four themes (157, 349, 318 and 157 text nodes). The index and the results
  page were both looked at. The audit cannot see text over a sibling's background: the bar values of the results page (`.rval.inside`) are reported as 1.1:1 by it
  and are a false positive; their colour pair (`--on-accent` on the bar) is covered by the token test.
- Found and fixed: the *Find everything* controls made the page 14 px wider than a phone (a `<select>` sized by its longest option); the light theme's banner text
  and button were unreadable until the banner, the image stage and the charts were given the dark palette (they stay dark in every theme).
- Not checked: a screen reader on the new panel, a real phone, other browsers, a high-contrast mode, the Plotly chart in the light theme.

## Viewer: zoom, pan, readout, layers (added 8 Nov 2026, Phase 2)

- **Keyboard**: `+` `-` zoom, `0` shows the whole image, `Shift` + arrows move a zoomed picture, plain arrows still step the frames (the viewer ignores the keys while a field,
  select or slider has focus). The zoom buttons are real buttons with names and tooltips; the layer list is a `fieldset` with a legend and one labelled checkbox per layer.
- **Pointer**: Ctrl + scroll or a trackpad pinch zooms (a plain scroll still scrolls the page); a drag moves a zoomed picture; a drag never counts as a click, so it does
  not start a measurement. Two fingers pinch. On touch screens `touch-action` is `pan-y` (the page still scrolls) and `none` once the picture is zoomed (a finger moves the picture).
- **Touch targets**: the zoom buttons are 32 px with a mouse and 44 px on a coarse pointer.
- **Not available without a pointer**: the pixel / sky readout follows the mouse (or a finger); a keyboard user gets the position of a measurement from the click text
  and the sky map instead. The readout is not a live region on purpose (it changes with every mouse move).
- Checked with the script audit on a fresh load of each theme at 375 px with real data: no horizontal overflow, 0 low-contrast text nodes (Deep Space, Observatory;
  Light research and Classic: 0 of 164 on a fresh load); the new text uses the existing pairs (`--text-muted` on the panel, `--text` on the dark stage).
  *Method note:* changing `data-theme` from a script in a pane that is not visible leaves CSS transitions frozen at the old colours and reports false contrast failures;
  load the page with `?theme=` instead.
- The **coordinate grid** and its labels, the scale bar and every overlay are drawn on the canvas: a screen reader does not read them (the canvas has a text label for the
  image; the positions of candidates are in their lists and dossiers). *Centre the picture on it* is a normal button in the candidate's description and in the dossier, so the same
  zoom is reachable by keyboard.
- **Timeline** (added 8 Nov 2026): one real button per image with a full-sentence name (number, date, detector, band, flags) and `aria-current` on the one shown; only that one is in the
  tab order (`tabindex`), the others are reached with the arrow keys and the frame slider, which step the same images, so the timeline is a second way to do what the slider does
  (WCAG 2.5.8 allows a smaller target when an equivalent control exists; the buttons are 24 px and overlap a little when 18 images share a phone's width). Survey-pass switches are
  `aria-pressed` buttons; the two wavelength sliders have visible labels and live values; the note under the plot is a polite live region. State is never colour alone: a left-out image is
  hollow, a badly flagged one is a diamond, a switched-off pass is dashed and struck through. Contrast: no text under 4.5:1 in Light and Classic at 375 px; the dots are 3.7:1 against the panel in Classic.
- Not checked: a real touch screen (the pinch was driven with synthetic pointer events), a screen reader, other browsers.

## Candidate table and provenance (added 8 Nov 2026, Phase 3)

- The explorer is a real `<table>` with a caption for screen readers, `scope="col"` headers, a button in each header to sort (the header carries `aria-sort`), and a button in the first cell of
  each row to open it (`aria-current` on the open one). The line "Showing 1–10 of 42" is a polite live region, so filtering and paging are announced. Filter, search and page size are labelled
  controls; the pager is a `nav` with previous/next buttons that disable at the ends.
- The plot of support against S/N is a picture of the same rows and is hidden from assistive technology on purpose (`aria-hidden`): the table is the equivalent. Its points are 24 px buttons
  with a full name, reachable by mouse and touch only; the shape of a point (diamond, ring, circle, square, dashed square) and not only its colour says the class.
- On a phone the table scrolls sideways inside its box and the page does not (no horizontal scroll of the page at 375 px; found and fixed: a grid column had grown to the width of the table).
- "How this search was run" is a `<details>` (closed): the same sentence as in the files.
- Checked at 375 px in the Light theme on the results page: no horizontal overflow of the page, no low-contrast text (the audit script reports the four `rval.inside` bar values, a known false
  positive described above). Not checked: a screen reader, a real phone, the other themes on the new section.

## Re-running

The guided tour modal check runs `scratch/browser_tour_modal.cjs` against the same local server. It verifies that background controls cannot receive pointer input while the tour is open, focus remains within the dialog, Escape restores focus, and an existing inert state survives closing. This is a browser automation check, not a screen reader session.

The Blink 2.0 layout check runs `scratch/browser_layout_audit.cjs` against a local server. It checks all five entry pages at 320, 375, 768 and 1280 CSS pixels in all three themes. It asserts no document-level horizontal overflow, a keyboard-focusable first skip link, and at least 4.5:1 contrast for body, panel and muted text against their solid design-token surfaces. The Planet X recovery table and the detector reference table now scroll within their own containers on small screens. This automated check does not measure text drawn over imagery or canvas plots and does not replace a screen reader audit.

```js
// in the console of the loaded page (resize the window first):
// paste the content of scratch/audit_page.js
```

## Text analysis (10 Nov 2026): the same data without the picture

Section 9 of the page ("Text analysis") lists, as plain tables, every image (date, detector, wavelength, share of flagged pixels, survey pass), every dot the search found (position in pixels and in RA/Dec, S/N, the error of the position in arcseconds, warnings: near the edge, flagged core) and every candidate with its status in words. It exists for a screen reader and the keyboard, and so that a number can be cited and checked.

What was built and checked (`scratch/test_textanalysis.mjs`, `e2e_smoke.mjs`, the built-in browser on real Barnard D2): real tables (caption, `scope="col"`, a row header), no canvas, image or SVG in the section, a polite live region that says what happened ("Text analysis ready: 18 images, 131 dots listed, 1 candidate."), an alert for a failure (nothing is shown in its place), the focus moved to the heading of the result, a selector to show the dots of one image, and a CSV of each table whose first lines say whether the data are real or synthetic.

**Not checked with a real screen reader** (NVDA, JAWS, VoiceOver): the markup follows the usual patterns, but nobody has listened to it. Not done: flux in physical units in the table of dots (it is a separate aperture measurement), the rest of the page (the canvas picture, the maps) has no equivalent text yet, and the full keyboard and focus audit of the dialogs and panels is still to do.

## Keyboard and screen-reader audit (10 Nov 2026; `node scratch/a11y_audit.mjs`)

An automatic audit in headless Chrome with **real key presses** (Tab, Space, Enter, the arrows, Escape) on the synthetic demo, run in all four themes (also a CI job). It checks what a screen reader would be *given*; it does not listen, so it does not replace NVDA, JAWS or VoiceOver.

What it checks (18 checks): every control has a name; no positive tabindex, broken ARIA reference, duplicate id or image without alt; the canvas has `role=img` and a label; one h1 and no skipped heading level; every button, select and link at least 24 × 24 px (WCAG 2.2, 2.5.8); Tab walks the whole page (87 stops) and comes back to the start with **no trap**, every stop has a name and a visible focus indicator in the theme and is scrolled into view, and every control that can take focus was reached; the arrow keys change the view mode, Space presses Play, Enter selects a candidate, Space toggles a layer; the shortcuts dialog opens with Enter, Escape closes it and **the focus returns to the button that opened it**; a live region says something when the image changes, when a coordinate is wrong (and the field is `aria-invalid`, described by its error, and focused) and when a search runs and ends.

**Defects it found, now fixed:** (1) changing the image was **not announced** (the canvas label changed, but a changed label is not spoken): a polite live region now says "Frame 2 of 4: D5, 2025-05-08, 4.07 to 4.10 micrometres", only when the user changes the image, not while the blink plays; (2) **measuring a position needed a mouse**: the picture can now take focus from Tab, the position at the **centre of the view** is read out (and said in a live region), Shift + arrows move the view, + and − zoom, **Enter measures there** and Escape clears the mark; (3) a number field was 21 px high and the pass buttons of the timeline could be 6 px wide: both now at least 24 px. Two apparent failures were mistakes of the audit, not of the page (smooth scrolling measured in mid-scroll; the blink moving the roving focus stop of the timeline while the audit walked), and were fixed in the audit.

**Not done or not covered:** listening with a real screen reader; the comparison view and the measurement panel were not audited for focus when they open and close (the shortcuts dialog was); the maps (Aladin sky map, the all-sky explorer, the Solar System) have no keyboard equivalent beyond their lists and tables; the zoom, high-contrast, forced-colours and touch checks are item 10 of the author's list; the audit runs on the synthetic demo, not on real data.
