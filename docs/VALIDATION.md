# Validation: what was tested on real SPHEREx data, and what was not

Measured on **7 November 2026**, on this project's own machine. Everything below can be re-run with the commands
shown. The real images are **not** in this repository (not published: the licence and terms of use of the data have
not been checked, see [CREDITS.md](../CREDITS.md)); they live in `backend/data/real/`, which git ignores.

**One line:** with no hint about the target, *Find movers* recovered both fast-moving objects it was pointed at
(Barnard's Star and Epsilon Indi B) in **4 of 4** single-detector runs on real SPHEREx pixels and in both fields when
the two detectors are searched together, all within 0.8 ″/yr of the catalogue motion. The "chance lines expected"
number separates these real lines (at most 1e-4 expected by chance) from the three false ones the original rule let
through (about 17 each). The Jansky scale agrees with 2MASS and AllWISE stars to within about 10 % (2-10 %). The asteroid Arosa is seen in
a real image **and shown to move** between two images 19.5 hours apart. WISE 0855 gives a **suggestive, not
established** flux when stacked along its known path, and a blind search cannot find it. The Earth-parallax fit
recovers the distance of Makemake (52.65 AU against 52.62 AU) **when told where to look**, but the **blind** parallax
search did **not** find Makemake in the same dots (section 5). In a later, fair test (section 12: 11 cutouts of 30′ not centred on it)
the app's default options again found nothing; loosened options found Makemake at 53.3 AU (truth 52-53), as **one of 38 candidates, when
an empty field gives about 33**: the Planet X mode has one real recovery, not a result. Calibration on real frames (section 10) and
the limit for a Planet X (section 11: one image reaches V about 17, a Planet-Nine-like body is 3-5 magnitudes fainter) are new.

## 1. The data

| Field | Detector | Images | Survey passes | Dates | Cutout |
|---|---|---|---|---|---|
| Barnard's Star (RA 269.4462, Dec +4.769) | D2 (1.1-1.6 µm) | 15 | 4 | 2025-08-21 to 2026-09-22 | 5′, 49 × 49 px of 6.14″ |
| Barnard's Star | D6 (4.2-5.1 µm) | 6 | 3 | 2025-08-15 to 2026-08-20 | same |
| Epsilon Indi B (RA 331.0965, Dec −56.8006) | D2 | 11 | 5 | 2025-04-26 to 2026-10-02 | same |
| Epsilon Indi B | D6 | 6 | 4 | 2025-04-29 to 2026-09-28 | same |
| WISE 0855 (RA 133.7598, Dec −7.2422 at 2026.0) | D2 and D6 | 6 + 6 | 3 | 2025-05-05 to 2026-05-14 | same (section 7) |
| Asteroid Arosa | D2 | 2 images, 3 cutouts | 1 | 2026-04-20 (00:10 and 19:42 UTC) | same (section 6) |
| Makemake (dwarf planet, 52 AU) | D2 | 7 | 4 | 2025-06-01 to 2026-06-09 | same, centred on its Horizons position (section 5) |

Cutouts come from IRSA's server-side cutout service (`backend/scripts/fetch_real_sample.py`, which asks before
downloading unless told `--yes`; `scratch/find_body_frames.py` and `scratch/fetch_asteroid_cutout.py` for the
asteroid and Makemake cutouts). The backend serves each cutout as a picture, as **real float32 pixel values**
(`dataUrl`) and as a **bad-pixel mask** from the FLAGS plane (`maskUrl`), so the detector works on the calibrated
numbers, not on an 8-bit picture. Total on disk: 60 files, 279 MB.

## 2. Blind test of *Find movers*

`node scratch/validate_real.mjs --api http://localhost:8003 --ra 269.4462 --dec 4.769 --fov 5 --det D6`
(`--det all` searches D2 and D6 together; `--relaxed 1` switches back to the original rule). Run against a backend that
serves **only** the real files (started with `SPHEREX_DATA_DIR` set to `backend/data/real`): the synthetic files in
`backend/data/fake` sit at the same sky position and would be mixed in.

The detector is **not told** what to look for. Afterwards its candidates are compared with SIMBAD (proper motions in
arcsec/yr: RA × cos Dec, Dec). "Chance lines expected" is the number of lines this good that the dots of that field
would produce by chance (pairs of dots tested × the binomial tail of the number of images that confirm the line); a
candidate is kept only if that number is below 1.

| Field, detector | Candidates | Catalogue match | Catalogue motion | Measured motion | Difference | Seen in | Significance | Chance lines expected |
|---|---|---|---|---|---|---|---|---|
| Barnard, D2 | 1 | Barnard's Star | (−0.80, +10.36) | (−1.03, +10.15) | **0.31 ″/yr** | 15 of 15 | 15 σ | 2e-21 |
| Barnard, D6 | 1 | Barnard's Star | (−0.80, +10.36) | (−0.25, +9.78) | **0.80 ″/yr** | 6 of 6 | 11 σ | 8e-6 |
| Barnard, **D2 + D6** | 1 | Barnard's Star | (−0.80, +10.36) | (−0.91, +10.19) | **0.20 ″/yr** | 21 of 21 | 19 σ | 2e-30 |
| Epsilon Indi B, D2 | 1 | Epsilon Indi B | (+3.98, −2.47) | (+3.45, −2.14) | **0.62 ″/yr** | 11 of 11 | 8 σ | 4e-15 |
| Epsilon Indi B, D6 | 1 | Epsilon Indi B | (+3.98, −2.47) | (+3.34, −2.42) | **0.65 ″/yr** | 6 of 6 | 7 σ | 1e-4 |
| Epsilon Indi B, **D2 + D6** | 1 | Epsilon Indi B | (+3.98, −2.47) | (+3.46, −2.37) | **0.53 ″/yr** | 17 of 17 | 11 σ | 3e-23 |

- **Recovered in every run** (each field has exactly one catalogued fast mover); **0 candidates without a catalogue
  match.** Searching both detectors together uses all images in one line fit: more images (21 and 17) and the
  smallest differences for Barnard.
- 0.2-0.8 ″/yr is 0.03-0.13 pixel per year.
- **The significance column is from the version before Phase 4** (the error of the velocity was a floor of 0.15 px, 2-4 times too large: §15.3). Re-run on 8 Nov with the propagated
  error, on the same data (more images now: Barnard D2 has 18), the same six candidates come out with the same motions, chance numbers and path support, and the faint Epsilon Indi B
  at **15 / 11 / 18 σ** (D2 / D6 / both) instead of 8 / 7 / 11; Barnard's Star, saturated, stays at 16 / 10 / 20 σ.
- **The two D6 differences got a little worse** than in the previous version of this file (0.55 → 0.80 and
  0.54 → 0.65 ″/yr) after the bad-pixel mask and the other changes below; D2 got much better (next subsection).
- **A failure, and the change it caused.** The first run on Epsilon Indi B in D6 (6 images, about 9 dots each) listed
  Epsilon Indi B **and 3 false candidates**: lines of 30-85 ″/yr through dots of only 3 of the 6 images. With so few
  images and so many dots, three chance matches are likely. The rule "a line needs dots in at least half of the
  images" became "at least 60 %" (`minDetectionFraction` in `movers.js`), and later a line is dropped when one or more
  chance lines like it are expected (`maxFalseAlarm`). Re-running the original rule (`--relaxed 1`) reproduces the
  failure with numbers: the real Epsilon Indi B line has **6e-5** chance lines expected, the three false ones
  **about 17 each**. So the number separates them by six orders of magnitude. **Because the rules were set after seeing
  this failure, this D6 run is no longer an independent test of them**; a new field would be needed for that.
- **Path support** (`validate_real.mjs` prints it as a column). For each candidate the app also measures the S/N at the
  predicted position in every image (aperture of 2 pixels, only where the whole aperture is on the image and at least
  80 % of its pixels are valid), whether or not a dot was found there. The six real candidates above are supported in
  **every image that could be measured** (13 of 13 and 6 of 6 for Barnard D2 and D6, 19 of 19 for both detectors; 11 of
  11, 6 of 6 and 17 of 17 for Epsilon Indi B; S/N up to 3490). The three false candidates of the original rule are
  supported in **3 of 6, 2 of 6 and 2 of 4** measurable images.
- Two changes were made earlier because of what the real images showed: **float pixels** (an 8-bit picture turns a
  bright star into a flat-topped blob whose centre jumps) and **image registration** (every exposure has its own
  pointing error, up to about 0.7 px between passes, which over a one-year baseline looks like a motion of several
  arcsec/yr). Both are covered by synthetic tests (`scratch/test_movers.mjs`), not only by these fields.

### 2.1 Remade on 10 Nov 2026 by a command (and a correction: three exposures were counted twice)

`node scratch/make_results.mjs [--write]` (backend on the real files, port 8003; SIMBAD for the catalogue motion) runs the six blind searches above with the code of the app and writes
`frontend/data/real_results_generated.json`, which sections 1-6 of the results page read. Epsilon Indi B is searched at RA 331.0634, Dec -56.7893 (the command's own centre: the centre used on 7 Nov was not recorded).

| Field, detector | Candidates | Catalogue match | Catalogue motion | Measured motion | Difference | Seen in | Significance | Chance lines expected |
|---|---|---|---|---|---|---|---|---|
| Barnard's Star, D2 | 1 | Barnard's Star | (−0.80, +10.36) | (−1.03, +10.15) | **0.31 ″/yr** | 15 of 15 | 15 σ | 2e-21 |
| Barnard's Star, D6 | 1 | Barnard's Star | (−0.80, +10.36) | (−0.25, +9.78) | **0.80 ″/yr** | 6 of 6 | 10 σ | 8e-6 |
| Barnard's Star, **D2 + D6** | 1 | Barnard's Star | (−0.80, +10.36) | (−0.91, +10.19) | **0.20 ″/yr** | 21 of 21 | 19 σ | 2e-30 |
| Epsilon Indi B, D2 | 1 | Epsilon Indi B | (+3.98, −2.47) | (+3.59, −1.93) | **0.66 ″/yr** | 11 of 11 | 16 σ | 5e-15 |
| Epsilon Indi B, D6 | 1 | Epsilon Indi B | (+3.98, −2.47) | (+3.50, −2.74) | **0.56 ″/yr** | 6 of 6 | 18 σ | 1e-5 |
| Epsilon Indi B, **D2 + D6** | 1 | Epsilon Indi B | (+3.98, −2.47) | (+3.61, −2.36) | **0.39 ″/yr** | 15 of 17 | 21 σ | 5e-19 |

- **Barnard's Star: the numbers of 7 Nov are reproduced exactly** (0.31, 0.80, 0.20 ″/yr; 15, 6 and 21 images). Still recovered in every run with no other candidate; both detectors together give the smallest difference for each star; every real line is supported in every image that could be measured; the range is 0.20-0.80 ″/yr (0.03-0.13 pixel per year).
- **Epsilon Indi B differs from the table above** (0.66, 0.56, 0.39 against 0.62, 0.65, 0.53 ″/yr; 16, 18, 21 σ against 8, 7, 11): the significance is the Phase 4 change (15 / 11 / 18 σ on 8 Nov, section 15.3), the motions move by 0.04-0.14 ″/yr with the centre of the field, and the D2 + D6 line is now seen in 15 of 17 images (the search asks for 60 %), not all.
- **A correction made on the way.** The first run of this command, the same day, gave Barnard D2 **0.61 ″/yr in "18 images"** (and D2 + D6 0.42, the mask 3.56 → 0.61). It was wrong: the backend held **three exposures twice** (the files `..._2.fits` and `..._6.fits`, `..._3` and `..._11`, `..._4` and `..._16`: byte for byte identical, the same sha1), so each of them counted as two measurements in every search, fit and count of images. It was found when the reproducibility bundle (item 3) listed the same image id and the same SHA-256 twice. The backend now skips a file that is an exact copy of one already used and reports it in `/api/health` (`duplicateFiles`): 75 files, **72 frames**. With the copies out, the numbers of 7 Nov come back (15 / 6 / 21 images, **3.72 without the mask**). The 0.61, 0.42 and 3.56 that the page showed for some hours were artefacts of the copies.
- **What else is affected.** Every real-data result made while those copies were in the set counted Barnard D2 as "18 images" instead of 15: section 10 (the injection and empty-sky calibrations), 14 (every source, support), 16 (the Planet X Lab map) and the Barnard D2 parts of their tables. They were **not re-run** (sections 8 and 9 of the results page are typed from them): see the notice at the head of each of those sections.
- **The failure of the original rule cannot be remade by the code of today.** `--relaxed 1` (the rule that listed Epsilon Indi B in D6 and three false lines on 7 Nov) now lists only the real line: the dots found per image are 4-8 (they were about 9), so there are no chance matches to join. The numbers of the failure in the section above (6e-5 for the real line, about 17 for the false ones, 3 of 6, 2 of 6 and 2 of 4 images) are a record of the code of 7 Nov, and the page says so. The sentence above, "re-running ... reproduces the failure", was true then and is not now.
- **Barnard in D2 without and with the bad-pixel mask**: **3.72 → 0.31 ″/yr** (the same code with `mask: null` is the code before the mask), reproduced.

### Barnard in D2: from 3.7 to 0.3 ″/yr in RA

Before the mask the D2 result was 3.72 ″/yr off. The star is so bright that on every one of the 21 images (D2 and
D6) its core pixels carry the FLAGS bits 0 (transient), 1 (overflow) and 2 (SUR error): peak 580-1980 MJy/sr; in the
central 5 × 5 pixels bit 0 is set in 48-84 % of them in D2 and 24-40 % in D6, bit 2 in 44-96 % (D2) and 16-24 % (D6),
bit 1 in 16-28 % (D2) and 8-16 % (D6). A centroid of a partly flagged core moves differently on each date.

**The change:** when at least 6 of the 25 pixels around a dot's peak carry a BAD flag (`coreIsCompromised` in
`frontend/js/features/movers.js`), its position is fitted with a Gaussian of fixed width (1.3 px) to the **unflagged**
pixels of the surrounding 11 × 11 window (`fitMaskedGaussian`) instead of the centroid of all pixels. The threshold
matters: applying the masked fit to every star with any flagged pixel made the faint Epsilon Indi B vanish in D6 (a
single flagged core pixel moved it by 0.4 px). Result: **3.72 → 0.31 ″/yr**, which is consistent with the
hypothesis written here earlier (a saturated, partly flagged core moves the centroid). **This was designed after
seeing the 3.72 on the same images, so it is a fix, not an independent test**; what argues it is not tuned to
these images is that it does nothing for the unsaturated star, and that it is covered by synthetic tests
(`scratch/test_movers.mjs`, `backend/tests/test_resample_and_track.py` for the mask).

## 3. Spectrum along the path, and the Jansky scale

**Error-model clarification (8 November 2026).** The backend's `fluxErr` and
`fluxJyErr` are the standard deviation of sky-ring pixels *after bilinear
resampling*, multiplied by the square root of the aperture pixel count. These
are nominal local sky-scatter estimates, not calibrated uncertainties:
interpolation correlates neighbouring pixels, while the formula treats them
as independent, and it omits source noise and calibration terms. A seeded
white-noise diagnostic (`python scratch/diagnose_resampled_noise.py`) found
empirical aperture-flux scatter / mean reported error of 1.05 without a
subpixel shift, 1.62 at a (0.25, 0.40) pixel shift, and 1.86 at a (0.50, 0.50)
shift. This is a mechanism check on synthetic noise, not a correction factor
for SPHEREx images. Numeric errors were kept for backward compatibility; the
API now marks them `errorModel=resampled_sky_scatter`, and the workspace calls
the resulting ratios **nominal S/N**. Previously listed photometry S/N and
error bars in this document use this nominal model; control-position tests
remain necessary for significance claims.

The backend converts the aperture sum from MJy/sr to Jansky with the pixel's solid angle
(`backend/spherex/photometry.py`). The app measures a candidate **where it is on each image's date** and plots
flux against wavelength.

### Is the Jansky scale right? (`scratch/validate_photometry.py`)

For isolated, unsaturated stars of the real cutouts, the aperture flux (2-pixel radius, no aperture correction) is
compared with the flux expected from the catalogue at that image's wavelength (2MASS J and H for D2, AllWISE W2 for
D6; IRSA TAP):

| Field, detector | Stars | Measurements | Median measured / expected | Robust scatter | 16th-84th percentile |
|---|---|---|---|---|---|
| Barnard field, D2 | 5 | 33 | **0.967** | 0.031 | 0.92-0.99 |
| Barnard field, D6 | 6 | 18 | **0.895** | 0.046 | 0.84-0.93 |
| Epsilon Indi B field, D2 | 4 | 15 | **0.979** | 0.053 | 0.93-1.02 |
| Epsilon Indi B field, D6 | 2 | 3 | **0.932** | 0.024 | 0.90-0.94 |

A ratio a little below 1 is expected because the 2-pixel aperture catches only part of a star's light. So **the
Jansky scale is right to within about 10 %, and D6 is 5-10 % lower than D2**; it is not an absolute calibration. The
zero points (2MASS J 1594 Jy, H 1024 Jy; WISE W2 171.787 Jy) are written **from memory** in the script and should be
checked before the numbers are quoted outside this project.

### Real spectra

- **Barnard's Star** (D2 + D6, 21 images): 2.8-9.4 Jy at 1.1-1.7 µm and 3.3-4.1 Jy at 4.5-4.9 µm. All 21 are flagged
  (section 2), so they are **lower limits**, and the colour hint declines to judge ("21 measurements have flagged
  pixels ... and were left out"). From memory (not checked here), the star is of order 10 Jy in the near infrared
  and a few Jy near 4.6 µm: the same order, which is all we claim.
- **Epsilon Indi B** (D2 + D6, 17 images): 14-19 mJy at 1.1-1.2 µm and 31-41 mJy from 1.25 µm up to 1.6 µm (one
  flagged image at 1.35 µm gives 5.5 mJy), signal-to-noise 130-790 per image in D2; **21-24 mJy at 4.4-4.9 µm**, S/N
  about 150-230 per image in D6 (the four unflagged points: 23.8, 21.0, 21.4 and 23.3 mJy). A rise from 1.1 to 1.3 µm
  is what is expected of a brown dwarf (from memory, not checked).
- **Colour hint** (`frontend/js/features/spectrum.js`): the ratio of the median flux at 4-5 µm to the median at 1-2 µm
  (star-like < 0.3, neutral 0.3-1.5, red 1.5-10, very red > 10). The thresholds are textbook orders of magnitude on
  **aperture sums**; it is a hint to look closer, not a classification.
  **First test on a real object (Epsilon Indi B, 7 points at 1-2 µm and 4 at 4-5 µm): ratio 0.65, "neutral", not
  "red".** This is an unresolved pair of a T1 and a T6 brown dwarf; "very red" is meant for the coldest objects
  (WISE 0855), not for T dwarfs. For Barnard's Star the flagged lower limits give about 0.48 (the app declines to
  judge them). **So the hint does not separate a cool M dwarf from an early T dwarf**, and the text of the "neutral"
  class now says so. The text also reports how smooth the spectrum is, and warns when a second source sits within
  the aperture (see WISE 0855, section 7). The two real objects are recorded as a regression in
  `scratch/test_spectrum.mjs`.

## 4. Float pixels and finer resampling (backend)

- `cutout(..., method="bilinear")` resamples with a NaN-aware bilinear kernel instead of nearest neighbour; the
  flags are never interpolated. Checked with synthetic frames of known star positions
  (`backend/tests/test_resample_and_track.py`).
- The bad-pixel mask (`mask_cutout_bytes`, 1 = a BAD flag bit is set; north up like the float pixels) has its own
  tests there.
- 112 backend tests pass (`pytest backend`). The HTTP layer of `backend/app.py` is still not covered by tests.
- One backend bug found while validating: with several fields indexed, `LocalArchive.find` raised `NoConvergence`
  for a frame whose SIP distortion diverges far from the queried position, so `/api/photometry` answered HTTP 500.
  It now treats that as "not on this frame" (regression test in `backend/tests/test_query.py`).

## 5. Planet X mode (Earth parallax): synthetic tests, and one real test that half works

`frontend/js/features/parallax.js`. A body hundreds of AU away swings across the sky as the Earth goes round the Sun
(412 ″ per 1 AU / 500 AU), plus a slow drift of its own, so its path is not the straight line *Find movers* needs.
The search tests every triple of dots from three survey passes: the middle one must be displaced from the straight
line through the other two exactly as the Earth's motion predicts for *some* distance, and dots in the other images
must confirm it. That gives the distance directly (no distance grid). Images of several fields (a body that swings out
of one cutout into the next) are brought into one common plane with the exact tangent-plane projection.

### Synthetic checks (`node scratch/test_parallax.mjs`, 56 checks)

- **The Earth's position** against independent facts: Sun's longitude 90.01° at the June 2025 solstice (expected 90),
  distance 0.98331 AU at perihelion and 1.01669 AU at aphelion (expected 0.9833 / 1.0167), longitude 100.38° at J2000.0.
- **The parallax formula** against its first-order form: −254.5″ vs −254.4″ east and 50.2″ vs 50.2″ north at 1000 AU.
- **Recovery on synthetic dot lists** (noise 0.15 px, 40 field stars and random dots per image): the distance of a
  body at 300-1200 AU is recovered to within 12 % in 6 of 6 fields, the quoted range contains the truth in 6 of 6,
  and the straight-line search finds nothing there (0 of 6): that is why the mode exists.
- **False alarms**: 0 candidates in 12 fields with no body, 0 in 32 fields with an ordinary straight-line mover.
- **A mosaic of four cutouts** with a body that swings across all of them: found at the right distance in 4 of 4
  fields; a single tile alone does not find it; 0 false candidates in 3 fields without a body.
- **On the simulated sky of the demo** (30′, ~275 dots per image): the simulated body at 600 AU is recovered at
  600-601 AU on three detectors with a drift of 65 ″/yr (injected 65), and an ordinary field gives no candidate.

### Real test: Makemake (`node scratch/real_parallax.mjs --api http://localhost:8003`)

Makemake (a dwarf planet, V ≈ 17, 52 AU) is in many D2 images over the survey; 7 cutouts were downloaded
(`scratch/find_body_frames.py` found the images through JPL Horizons and IRSA, `scratch/fetch_asteroid_cutout.py` cut
them), each **centred on the position Horizons gives for that image's time**. The ephemeris was used only to say where to cut.

1. **Fit, told where to look** (the dot nearest each cutout's centre; found in 4 of 7 images, 0.02-0.27 px from the
   ephemeris, S/N 4.3-8.5): straight drift **plus** Earth parallax gives **52.65 AU** (1σ 52.62-52.67 for a position
   error of 4″; 52.6 AU for 2″, 4″ and 8″), against **52.62 AU** from Horizons. The best straight line without
   parallax has χ² = 2 477 413, the parallax model 6.7 (3 degrees of freedom); residuals are at most 6″ (1 pixel).
   This tests the Earth's position, the parallax formula and the geometry on real images. It is a fit of 5
   parameters (position, drift east and north, distance) to 8 numbers (4 positions), so only 3 degrees of freedom
   check it, and the dots were chosen with the ephemeris.
2. **Blind search: negative result.** The blind search (`findDistantMovers`, no ephemeris) over all 72 dots of the 7
   cutouts returned 10 candidates at 52-54 AU, and **none of them is Makemake**: graded against Horizons (the
   ephemeris is used only to grade), eight of them have no dot within 4 pixels of the Horizons position (8-28 px
   away) and the other two have 2 of their 4 dots on it and the rest 8-14 px away.
   Why, and why this does not say much either way:
   - The cutouts are centred on the body, so **any** dot near a cutout's centre follows Makemake's parallax track.
     That is why every chance combination lands at 52-54 AU.
   - The body is detected in only 4 of 7 images; a 5-parameter model on 4 dots leaves 3 degrees of freedom, and chance
     combinations fit as well (rms 0.5-1.3 px). The "σ better than a straight line" figure was 800-1900 for them.
   - With only the four images in which it was detected, the search returns 58 candidates.
   A fair blind test needs cutouts that are **not** centred on the body and more detections (at least 6 or 7). We do
   not have that, so **the blind Planet X search has not been shown to work on real data.** The app now says so in the
   candidate text when a parallax candidate rests on 5 dots or fewer.
3. **A bug found by this test:** when a new candidate rivalled two earlier ones that did not rival each other, only the
   first was replaced and two mutually rival candidates stayed in the list (two identical lines). Fixed (a new
   candidate must beat all its rivals and then replaces all of them); regression test in `scratch/test_parallax.mjs`
   (the old logic leaves 1 rival pair among 52 candidates in 16 crowded fields, the new one 0).

### What it cannot claim

- The blind search had **not succeeded on real data** when this section was written (above); the fair test of section 12 found
  Makemake once, with loosened options, among about 33 chance candidates. A real field has no such body to find, and the
  simulation and the search share the same ephemeris, so synthetic recovery tests the algorithm, not the ephemeris
  (which was checked separately against the facts above and against Makemake).
- The Earth's position is the low-precision Sun formula of Meeus (good to ~0.0002 AU), measured from the Sun, not
  from the Solar System barycentre (up to 0.005 AU, 2″ at 500 AU, 0.3 px).
- The body's own motion is taken as a straight line over one to two years, and it must be bound to the Sun (own
  speed below 1.5 × the escape speed at that distance); a body that violates this is not reported unless that
  assumption is switched off.
- The geometry decides how well a distance is measured: with the schedule used in the tests, a field at ecliptic
  longitude ~134° swings 133 px at 500 AU, one at RA 45°, Dec +10° only 16 px. (From memory, not checked here:
  SPHEREx looks about 90° from the Sun, which would give every field the large swing on both sides of the year.)
- A body 500 AU away swings up to ~800″ (13 arcmin, more than twice the 5′ default field), so the mode needs the
  widest field the app offers (30′).
- The distance range is statistical (1 σ for the fit); it does not include these systematics.

## 6. Known asteroids (SkyBoT)

`frontend/js/features/skybot.js`, `node scratch/validate_asteroids.mjs --api http://localhost:8003 --ra 269.4462 --dec 4.769 --fov 5 --det D6`

- **Reachability** (checked on 7 Nov 2026 from the project machine): `https://ssp.imcce.fr/webservices/skybot/api/conesearch.php`
  answers JSON with `Access-Control-Allow-Origin: *`, so the browser calls it directly and **no backend proxy is
  needed**. The older `vo.imcce.fr` address answered HTTP 403. An empty circle answers HTTP 204, a bad request HTTP 400
  with a JSON message; both are handled.
- **Speed**: 15 dates in 9.3 s, 11 in 5.7 s, 6 in 4.4 s (4 requests at a time).
- **Geometry check against the service itself**: for the one body SkyBoT lists in the Barnard field, our
  sky-to-image projection puts it 231.6″ from the centre; SkyBoT says 231.571″.
- **Why per image date**: that body moves 570″ per day, so it is a different dot in every image and can never be
  linked over months; it must be looked up at each image's own date.
- **Real images, negative control**: three body-dates fall inside our real cutouts (2015 HV228 on 2026-08-21, V = 23.4,
  listed twice by the service for that date; 2005 LF3 on 2026-03-23, V = 20.6). All are far too faint for a single
  SPHEREx exposure. For 2015 HV228 the flux at its predicted position is zero within the noise on its own date (S/N −1.0
  and −0.3) and on the other dates (median −1.0 and −0.1); for 2005 LF3 the measurement on its own date could not be
  made (median −1.1 on the other four dates). That is a consistent **negative control**, not a detection.
- **Positive test and proof of motion** (`scratch/find_asteroid_frame.py` found the target, `scratch/fetch_asteroid_cutout.py`
  downloaded three cutouts of two images, about 5 MB each): the asteroid **Arosa** (main belt, V = 14.6) lies in two
  D2 images of the same survey pass, 19.5 hours apart, and SkyBoT gives its position at each time:

  | Image (UTC) | Wavelength | At the position for 19:42 (RA 296.40882, Dec −24.04831) | At the position for 00:10 (RA 296.24573, Dec −24.00048) |
  |---|---|---|---|
  | 2026-04-20 00:10 (`..._0003_1D2`) | 1.21 µm | **0.02 ± 0.84 mJy (absent)** | **8.67 ± 0.27 mJy (S/N 33)** |
  | 2026-04-20 19:42 (`..._0163_1D2`) | 1.34 µm | **8.56 ± 0.98 mJy (S/N 8.7)** | not in this cutout |

  The source is at the SkyBoT position at each time and absent from the other one: it **moved 563″ in 19.5 hours**
  (28.8″/hour; SkyBoT says 29.0″/hour). Its flux is the same at the two wavelengths (8.67 and 8.56 mJy), as expected of
  a sunlit rock. The flux at the later position is a **107 σ** peak in the central pixel of the cutout (peak 3.58 MJy/sr
  over a background noise of 0.033); its centroid is **0.17 px = 1.0″ from the predicted position**, with no bad-flag
  pixel in the central 5 × 5. The app's own chain (SkyBoT, projection, backend photometry) gives S/N 8.7 in its
  2-pixel aperture, and the overlay draws "Arosa · V 14.5" on the dot. The other two bodies SkyBoT lists in the field
  (V = 18.9 and 22.8) have no source at their positions (the faintest measures −0.2σ).
  - It is **not unique by brightness**: it is the 4th-brightest source of the cutout (the others: 1994 σ, 112 σ,
    110 σ), and six other peaks are at least half as bright. Besides the motion, what argues it is not a star:
    **2MASS** (queried through IRSA's TAP, 43 sources with J < 16 in the field) has **no source within 10″** of the
    position, while 8.55 mJy at 1.34 µm corresponds to J ≈ 13.4 (zero point 1594 Jy, from memory), well within 2MASS's
    reach. SIMBAD is almost empty here (1 object in the whole field) and cannot be used as a star list.
- The position is geocentric; SPHEREx's own height shifts a main-belt asteroid by up to ~8″ (about one pixel); the
  measured offset is 1.0″.

## 7. WISE 0855 (the namesake object)

`backend/.venv/Scripts/python.exe -I scratch/stack_wise0855.py --api http://localhost:8003 --det D6`

WISE 0855 (the coldest known brown dwarf, 8.2 ″/yr) is bright only near 4.5 µm (W2 ≈ 13.9, from memory) and very
faint at 1 µm. In a single exposure it is at most a 3-5 σ speck, below the 5 σ detection threshold, so a **blind
search cannot find it** (tried; nothing at its position). The weaker question is whether there is flux at the
position its catalogue motion predicts. Method: the aperture sum on every image at the predicted position (epoch
2026.0, moving-object mode of `/api/photometry`), averaged with inverse-variance weights over the unflagged images,
and the same stack at 16 **control** positions (the same path shifted by 40 and 60″, where nothing is expected).

| | Unflagged images | Stack (target) | Nominal S/N | Controls: median, robust scatter | Target against controls |
|---|---|---|---|---|---|
| D6 (4.5-5.0 µm) | 4 of 6 | **0.415 ± 0.076 mJy** | 5.4 σ | +0.025 mJy, 0.091 mJy | 4.3 × the robust scatter; brighter than 15 of 16 controls |
| D2 (1.1-1.6 µm) | 5 of 6 | 0.635 ± 0.086 mJy | 7.3 σ | +0.022 mJy, 0.129 mJy | 4.7 × the robust scatter; brighter than 16 of 16 controls |

- **D6 is suggestive, not a detection.** 0.415 mJy at 4.5-5.0 µm is the same order as the expected W2 flux of the
  object (about 0.47 mJy for W2 = 13.9, both from memory; our apertures lose 5-10 %, section 3). But it rests on 4 images (two flagged
  ones are left out and would push the stack in opposite directions: +0.47 and −0.70 mJy), the nominal 5.4 σ is only
  4.3 σ against the robust scatter of the controls, and one of the 16 controls (at +4.8 mJy, on a field star) makes
  the plain scatter 1.2 mJy, which would make the target 0.1 σ. The significance depends on how the controls are
  chosen: we do not claim a detection.
- **D2 is not WISE 0855.** At 1 µm the object is millions of times fainter (J ≈ 25, from memory) than the 0.635 mJy
  measured. The flux belongs to a **2MASS star of J = 15.4, 7.5″ away**, which lies inside the measurement (a J = 15.4
  star is about 1 mJy at 1.2 µm). The app now warns about this ("a second source sits within the aperture", `blendWarning`
  in `movers.js`), and the colour hint declines to use a blended 1-2 µm measurement. So the app's colour ratio for this
  object would be wrong without the warning.
- Single measurements: D6 flux on the four unflagged dates 0.16 ± 0.15, 0.53 ± 0.11, 0.46 ± 0.54 and 0.47 ± 0.16 mJy.

## 8. Known limits, in one list

1. Six real runs on two fast-moving objects, one asteroid and one dwarf planet: not a statistical survey.
2. Saturated stars: position needs the bad-pixel mask (section 2); their flux stays a lower limit.
3. Motion below about 1 pixel (6″) over the whole period looks like a still star (Epsilon Indi B moves 4.7″/yr and is
   found only because the baseline is 1.4 years).
4. Needs images from at least 3 survey passes about 6 months apart (one detector, or both when "Use all detectors" is on).
5. Positions only, never brightness: through the variable filter the same star has a different brightness in each image.
6. Colour hint cannot separate an M dwarf from an early T dwarf (section 3). **Planet X mode: the distance fit
   works on real data when told where to look; the blind search found Makemake once, with loosened options, as one of 38
   candidates when an empty field gives about 33** (sections 5 and 12).
7. Calibration: fluxes are quick aperture sums, 2-10 % below catalogue magnitudes (section 3), not SPHEREx's own
   calibrated photometry.
8. WISE 0855 is a suggestive stack, not a detection (section 7).
9. Not checked: the licence of the real data and of Aladin Lite (GPL-3, loaded from a CDN) for a public release. What was
   found out about the data (section 9): IRSA asks for a citation (DOI) and an acknowledgement and states no other
   terms on the page that was read; that is not a licence review, and **no SPHEREx pixel is published** anywhere.

## 9. The real-data results page, and the country readout of the sky map (added 7 Nov 2026, evening)

### The results page (`frontend/results.html`, `frontend/data/real_results.json`)

A public page with **only derived numbers and charts**: no image, no pixel, no FITS name. It is the visual version of
sections 2-7 of this file: the six blind runs, the chance-line numbers (kept lines against the three false ones of the
original rule), the Barnard mask fix, the Jansky scale, the Arosa motion, the WISE 0855 stacks (the 16 control values of
each detector were taken from a fresh run of `scratch/stack_wise0855.py` on 7 Nov and reproduce the numbers above:
0.415 ± 0.076 mJy against controls with a robust scatter of 0.091 mJy in D6, 0.635 ± 0.086 mJy and 0.129 mJy in D2) and
Makemake with its **negative blind-search result written next to the successful fit**. Charts are HTML + CSS (no library, no
canvas), so text keeps its size on a phone, and every chart is followed by a real table (the chart itself is hidden from
screen readers). The numbers in the prose are filled in from the JSON (`data-n`), so they cannot drift from the charts.
Since 8 Nov 2026 the JSON also has `origins`: for each of sections 1-10 the command (or commands) and the section of this file that
reports it, shown as a line under the heading. **These numbers were typed into the JSON from the printed reports of those commands on the
day of the measurement; no script writes the file** (only section 11 of the page, `real_sources.json`, is made by a command), and the page says
so. `test_results.mjs` checks that every named script and every cited section of this file exists, and that the headline numbers stand here.

`node scratch/test_results.mjs` (47 checks): the helpers (ticks, scales, lane spreading, number formats); the JSON agrees
with itself (every stated difference is the distance between its measured and catalogue vectors; the control median, the
robust scatter, "x times the scatter", "brighter than n of 16" and the nominal sigma are recomputed from the control
values; Arosa's speed is distance over time); **no image, data URL, base64, file name or pixel field, and no array
longer than 20 numbers**; every headline number also stands in this file; every chart the page asks for is built;
every number the page fills in exists in the JSON; ids, anchors and labels resolve. In the browser: desktop and phone
(375 px) without horizontal overflow, 8 charts drawn, no console errors; `scratch/audit_page.js` finds no target under
24 px except inline links, no unnamed control, and 4 "low contrast" results that are false positives of the script (the
value sits inside a pale or orange bar and is dark on it; the script only looks at the background of the parent).

Data use: the IRSA quick-release overview asks users to cite the release DOI (10.26131/IRSA629 for QR1, 10.26131/IRSA652
for QR2, 10.26131/IRSA662 for QR3, as printed on that page, read on 7 Nov) and to include an acknowledgement, and the part
of the page that was read states no other terms. The page credits SPHEREx and IRSA and lists the three DOIs; **which
release each image of ours comes from has not been matched** (the file names carry pipeline versions v20-v25), and the
acknowledgement text of the footer is in our own words, to be replaced by IRSA's exact wording before submission
(`CREDITS.md`).

### Country readout on the sky map (`frontend/js/features/skyGeo.js`, `skyContext.js`)

The box in the corner of the sky map gives the sky coordinates under the cursor (or of the centre when the pointer is
away) and, **in brackets, the country that sky point is straight above right now**: a point (RA, Dec) is at the zenith of
latitude = Dec and longitude = RA - Greenwich sidereal time at any moment. It is a way to put a country next to a sky
coordinate; it is not where SPHEREx is. It moves west by 15° an hour, so the country changes during the day. Over water the
text says how far the nearest coast is ("water, about 850 km from Brazil").

- **Astronomy**: sidereal time from Meeus 12.4; first-order precession of the coordinates to the equinox of the date
  (0.34° in 2026, 40 km on the ground); nutation and aberration ignored.
- **Borders**: Natural Earth through the `world-atlas` package, version 2.0.2 (TopoJSON, 110 m scale, 177 countries, about
  105 KB), **loaded by the browser from the jsDelivr CDN** when the map opens, like Aladin Lite. It is not stored in this
  repository (fetching it into the project would be a new download, not done without asking). If it cannot be loaded the box
  shows coordinates only and says so.
- **Tests** (`node scratch/test_skygeo.mjs`, 25 checks; the world map in them is a tiny invented one, nothing is
  downloaded): sidereal time at J2000.0 (280.4606°), at 0h UT on 2000-01-01 (99.9678°) and Meeus' example 12.a
  (197.693195°), 15.0411° an hour; precession (0.344° and 0.150° for a point at (0, 0) after 26.85 years); a sky point whose
  RA equals the sidereal time is on the Greenwich meridian; six hours later it is 90.25° west; the TopoJSON decoder (delta
  encoding, reversed arcs, a ring of two arcs, holes, a multi-polygon island); point in polygon; nearest coast against
  closed-form great-circle distances.
- **Real map, checked in the browser**: 46 of 46 interior points that I chose from memory (Romania, Indonesia, Brazil, Kenya,
  Iceland, ...) get the right country; decoding takes 11 ms, a land lookup 0.05 ms, a lookup over water 4-26 ms (done at most
  every 60 ms). Over water the nearest country can be too far: the 110 m map has no small islands (a point in the mid-Atlantic
  reports Canada instead of the Azores). That test only covers countries' interiors; near borders the answer can be off by
  tens of kilometres, as the page says.
- In the app, with five sky positions (WISE 0855, Barnard's Star, Epsilon Indi B, RA 45° Dec +89.2° and RA 10° Dec -60°) the
  readout gave a country or the distance to the nearest coast each time, hovering over the map changed it, and the console
  stayed free of errors. The box sits above Aladin's own zoom control and wraps onto two lines on a phone. Not tried: touch
  panning on a real phone, and the full-screen mode.

## 10. How good is *Find movers*? Calibration on real frames (added 7 Nov 2026, night)

> **Notice of 10 Nov 2026.** This is the calibration on the real fields (the fake movers and the empty-sky copies). Until 10 Nov the backend held **three exposures of Barnard's Star in D2 twice** (byte-identical files; section 2.1), so "Barnard D2, 18 images" below was 15 distinct images plus 3 copies. The numbers of this section that rest on Barnard D2 were measured with the copies in and **have not been re-run**; read them as probably slightly optimistic for that field (an exposure counted twice is not an independent measurement). The other fields (Barnard D6, Epsilon Indi B, WISE 0855, Makemake) have no copies.

`scratch/calibrate_real.mjs` (the header of the script explains every step). Two experiments on the real cutouts, **no new download**:
(1) **injection and recovery**: a fake mover (a star with the PSF of the FITS headers, FWHM 5.15″ in D2 and 6.61″ in D6, integrated
over the pixels, so 100 % of its light falls in the 2-pixel aperture) is added to the real frames along a straight path of known
speed and flux, placed where the field stars of each image really are (the registration shifts), and the **unchanged** detector
runs on the result: 40 fakes in each of 10 flux × 6 speed cells per field, 2400 runs per field; (2) **empty-sky calibration**:
every real frame is rotated/mirrored at random and moved by a random number of pixels, independently of the others, 300 times
per field: real noise, real star counts, real fluxes, every correspondence between images destroyed, so any candidate is false by
construction. Fields: Barnard D2 (**18 images**: it had 15 until 22:47, when four more cutouts, fetched by the user's own run of
`fetch_real_sample.py --target barnard --download 4`, were added to `backend/data/real/`; sections 1-7 were measured on the
earlier 15), Barnard D6, Epsilon Indi B D2 and D6, WISE 0855 D2 and D6 (63 FITS files in the directory when the runs started).

### What one image can detect

The dot detector compares the peak of the smoothed image with 5 times a noise it estimates itself (84th percentile minus median of
the smoothed image). In a clean field that is 0.6-1.4 × the plain pixel noise; around a bright, saturated star (Barnard) it is
**2.9-3.5 ×** it, because the halo thickens the upper tail. So the faintest star found depends on the field:

| field | detector noise / pixel noise | 50 % of fakes found at (total flux) | 90 % at |
|---|---|---|---|
| WISE 0855, D2 | 1.43 | **0.63 mJy** (S/N 12.9 in the aperture) | 0.96 mJy (S/N 19.8) |
| WISE 0855, D6 | 0.63 | 0.86 mJy (S/N 5.6) | 1.34 mJy (S/N 8.8) |
| Epsilon Indi B, D6 | 0.68 | 0.68 mJy (S/N 6.4) | 1.12 mJy (S/N 10.5) |
| Epsilon Indi B, D2 (noisier frames) | 1.34 | 1.52 mJy | 3.84 mJy |
| Barnard, D6 | 2.90 | 7.4 mJy | 12.4 mJy |
| Barnard, D2 | 3.46 | **21.7 mJy**, 90 % never reached | - |

Next to a real star (9-19 % of the placements had a real dot within 3 px) the fake merges with it; those placements are in the
recovery table below and left out of this one. Changing the PSF width (sigma) from the headers' 0.36 px to 0.6 px raises the
clean-field limits by 12-25 % (WISE D2 0.63 → 0.79 mJy at 50 %); letting the flux vary by 0.6-1.4 × from image to image (a stand-in
for the variable filter) changes nothing measurable (WISE D6: 0.87 and 1.33 mJy). **Two earlier runs with a wrong PSF width (1.3 px,
then 0.9 px) gave limits 2-3 × too high; the error was found because Makemake is detected at fluxes well below that limit** (next
section).

### Recovery of a mover: flux and speed

Share of fakes recovered (a candidate whose path is within 1.5 px of the fake's in at least half of the images), default rule. The
four numbers of a cell go with the four total fluxes of the row:

| field (images, passes, baseline) | total flux (mJy) | 4″/yr | 10″/yr | 30″/yr | 100″/yr |
|---|---|---|---|---|---|
| Epsilon Indi B D2 (11, 5, 1.43 yr) | 1.22 / 1.50 / 1.87 / 2.34 | 15 / 48 / 78 / 78 % | 23 / 68 / 95 / 90 % | 10 / 70 / 88 / 85 % | 5 / 73 / 95 / 98 % |
| WISE 0855 D2 (6, 4, 1.03 yr) | 0.55 / 0.67 / 0.84 / 1.05 | 0 / 3 / 3 / 3 % | 0 / 63 / 68 / 83 % | 8 / 73 / 85 / 75 % | 5 / 68 / 63 / 78 % |
| WISE 0855 D6 (6, 3, 1.03 yr) | 0.66 / 0.81 / 1.01 / 1.27 | 0 / 0 / 3 / 0 % | 3 / 13 / 70 / 88 % | 0 / 33 / 68 / 80 % | 5 / 28 / 70 / 75 % |
| Epsilon Indi B D6 (6, 4, 1.41 yr) | 0.56 / 0.69 / 0.86 / 1.08 | 3 / 5 / 28 / 35 % | 3 / 20 / 75 / 78 % | 3 / 10 / 53 / 75 % | 0 / 13 / 58 / 58 % |
| Barnard D6 (6, 3, 1.02 yr) | 4.5 / 5.5 / 6.9 / 8.6 | 0 / 0 / 3 / 0 % | 5 / 40 / 70 / 80 % | 5 / 18 / 75 / 83 % | 3 / 30 / 53 / 45 % |
| Barnard D2 (18, 4, 1.08 yr) | 15.5 / 19.1 / 23.9 / 29.9 | 3 / 18 / 15 / 15 % | 23 / 75 / 78 / 85 % | 18 / 73 / 75 / 78 % | 15 / 70 / 70 / 80 % |

- **A sharp threshold**: a factor of about 1.2 in flux takes the recovery from under 25 % to 60-90 %, and it then stays at **70-98 %**
  in clean fields (45-85 % in the 3-pass fields at 100″/yr). It does not reach 100 % because of blends with real stars, flagged
  pixels and the rule of dots in 60 % of the images.
- **A speed floor**: a candidate must move at least 0.8 pixel over the whole baseline (`minMotionPx`), i.e. about 3.5″/yr for 1.4
  years and 4.9″/yr for 1.0 year. Measured: at 4″/yr almost nothing is found when the baseline is about 1 year (0-3 %) and 78 % when
  it is 1.43 years (Epsilon Indi B D2); at 1-2″/yr nothing, in any field.
- **False candidates besides the fake**: 5-23 in 2400 runs per field (0.2-1.0 % per run) with the default rule.

### Empty-sky calibration of the "chance lines expected" number

Share of the 300 scrambled copies of a field that show at least one candidate whose chance-line number is at most f (the
detector lists a candidate only when it is at most 1):

| field (images, passes) | f = 1e-3 | f = 1e-2 | f = 0.1 | **f = 1 (the default rule)** | original rule (half of the images, no limit) |
|---|---|---|---|---|---|
| Barnard D2 (18, 4) | 0 % | 0 % | 0 % | 0 % | 0 % |
| Epsilon Indi B D2 (11, 5) | 0 % | 0 % | 0 % | 0 % | 1.3 % |
| Epsilon Indi B D6 (6, 4) | 0 % | 0 % | 0.7 % | **1.3 %** (4/300) | **100 %** |
| WISE 0855 D2 (6, 4) | 0 % | 0 % | 0 % | 2.0 % (6/300) | **100 %** |
| Barnard D6 (6, 3) | 0 % | 0 % | 0 % | 11.3 % (34/300) | **95.3 %** |
| WISE 0855 D6 (6, 3) | 0 % | 0.3 % | 0.3 % | 13.3 % (40/300) | **94.0 %** |

(95 % confidence limit of 0 out of 300: 1.3 %.) What this says:

- **The number is conservative.** If it were exact, a share f of empty fields would show a candidate at most as unlikely as f;
  the observed shares are at or below f in every cell (for f = 1 an exact number would give up to about 63 %, we see 0-13 %).
- **The default rule (f ≤ 1) still lets a false candidate through in about 1 empty field in 8 when there are only 3 survey
  passes and 6 images** (Barnard D6, WISE 0855 D6), 1-2 % with 4 passes, and none with 5 passes or 18 images. A limit of 0.01
  instead of 1 would hold every field here at 0.3 % or less, and all six real candidates (1e-4 or less) would stay. **That change
  is not made** (it would be tuned on six fields), but a candidate with a chance-line number above 0.01 should be read as weak.
- **The test would have predicted the failure that changed the rule.** The original rule (dots in half of the images, no limit)
  gives a false candidate in **94-100 %** of empty fields of 6 images with 3-4 passes. The real Epsilon Indi B D6 field showed 3
  of them. So the repair (60 % of the images and the chance-line limit) is now supported by data that were not used to design it.

### Limits of this calibration

Fakes are Gaussians with the headers' FWHM, not the real PSF (121 position-dependent PSFs in each file); the width was wrong in two
earlier runs. The empty-sky copies destroy real clusters of faint sources and real variable stars, which would add false lines;
a field star near the centre stays near the centre under rotation. 40 fakes per cell give about ±15 % (95 %) on a share near 50 %.
Only 49 × 49 pixel (5′) cutouts of six field-detector pairs were used, and the Barnard fields are special (a saturated star).
**A detector that subtracted a local background before looking for peaks would probably not lose a factor 30 in the Barnard
fields; that change was not made and not tested.**

## 11. Could SPHEREx see a "Planet X"? A limit from measured noise (added 7 Nov 2026, night)

`node scratch/planet_x_limits.mjs --api http://localhost:8003`. It turns the single-image limit of section 10 (clean fields: 50 % of
fakes found at **0.63 mJy** and 90 % at **0.96 mJy** total flux in D2, AB 16.9 and 16.4; 0.86 and 1.34 mJy in D6) into a magnitude and
asks how far a planet of a given size would be found. A planet shines by reflected sunlight (V = H + 5 log10(r·Δ); its diameter
follows from H and the albedo). **From memory, not checked here:** that relation and its 1329 km constant; the Sun's colour
(J_AB = V - 0.29); the Earth's radius; and the size, albedo and orbit of the hypothetical Planet Nine (radius 2-4 Earth radii,
semi-major axis 400-800 AU, perihelion 200-350 AU). Thermal emission is ignored: at 40 K the Planck curve at 4.6 µm is a factor
e^-78 below its own scale.

| radius, albedo | V at 300 AU | V at 500 AU | V at 1000 AU | farthest AU in one image (50 % / 90 %) | in a stack of 15 / 60 images |
|---|---|---|---|---|---|
| 2 R_E, 0.3 | 19.7 | 21.9 | 24.9 | 170 / 153 | 214 / 255 |
| 3 R_E, 0.3 | 18.8 | 21.0 | 24.0 | 208 / 187 | 263 / 312 |
| 4 R_E, 0.5 | 17.6 | 19.8 | 22.8 | 273 / 246 | 344 / 410 |

- **A single exposure reaches V ≈ 16.7-17.2**, so a body of 2-4 Earth radii is found only out to about **150-270 AU**. The Planet X
  mode lists dots found in single images, so that is its range; a hypothetical Planet Nine at 300-800 AU (V about 18-22 for these
  sizes) is **3-5 magnitudes below** what one exposure shows.
- Stacking 15 or 60 images along the body's track (noise falls as the square root, so -1.5 and -2.2 magnitudes; the images would
  have to be shifted along an assumed orbit first, as in the WISE 0855 stack of section 7, which is not what the mode does) pushes
  the range to 215-410 AU: still short of 500 AU for these sizes. A 3 R_E body at 500 AU is 4 magnitudes below the one-image
  limit: a plain stack would need about 1500 images.
- **Check on a real body:** Makemake (Horizons gives V = 17.03-17.14 over the period) was measured in the seven real D2 cutouts:
  total flux 0.05-0.46 mJy, median 0.21 mJy = AB 18.1, a dot found in 4 of 7 images (at a threshold of 4 σ, not 5). That is about
  **1 magnitude fainter than a Sun-coloured body of V = 17.1 would be** (J_AB ≈ 16.8) and 3 × below the 50 % limit: the scale is right
  to the order of magnitude, and Makemake's methane ice, which absorbs inside the D2 band, may account for part of the difference
  (from memory); this is a consistency check, not a calibration.
- **What this means for the project:** Planet X mode is a method that works on bodies bright enough to be seen in single images (the
  Makemake fit; a simulated 600 AU body at a brightness the user sets), **not** a claim that SPHEREx can find a Planet Nine. The
  honest sentence for the pitch: "a single SPHEREx exposure reaches V ≈ 17; a Planet-Nine-like body is 3-5 magnitudes fainter, so
  finding it takes stacking along trial orbits, which this tool does not do".

## 12. A fair blind test of Planet X mode on a real body (added 7 Nov 2026, night)

The test of section 5 was biased (every cutout centred on Makemake, only 4 detections). This one removes both problems.
`scratch/fetch_body_cutouts.py` planned and downloaded (with the user's approval for this idea; 75 MB in all, 6.0-6.4 MB each
against my estimate of 6.1) **12 D1 cutouts of 30′ × 30′ around Makemake, each cut off its position by a random 3-8′ in each axis**
(seeded), 4 from each of the 3 survey passes (2025-06, 2025-12/2026-01, 2026-06), chosen **by date only**. D1 (0.75-1.1 µm) was
picked because a sunlit body should be brighter at shorter wavelengths (an expectation, not checked beforehand); afterwards the
detections came out stronger than in D2 (S/N 7-19 in 8 of 11 images, against 4-8 in 4 of 7 for the D2 cutouts of section 5). `scratch/blind_planet_x.mjs` runs the app's own `detectSources` (default threshold) and
`findDistantMovers` on the 11 images the backend serves (the twelfth is a cutout of 85 × 152 px cut by the edge of the image, with
the body outside it) in a common tangent plane; JPL Horizons' positions are used **only to grade** the candidates.

**The body is a dot** (within 0.5 px of its Horizons position, S/N 7-19 in the detector's units) in **8 of 11** images; in a ninth the
nearest dot is a bright star 1.0 px (6″) from it (S/N 4595), and in two it is lost (one image of 40 dots and one of 11, mostly cut
off by the footprint). The images hold 245-324 dots each.

| search | candidates | Makemake among them? | time |
|---|---|---|---|
| **the app's default options** (A) | **0** | **no** | 100 s |
| default options with 250 seed dots per image (B) | 0 | no (the 4 × 10^7 triple limit was reached) | 242 s |
| **options loosened as in `real_parallax.mjs`** (C: 1 dot per pass enough, 50 % of the dates, rms up to 1.5 px, 4 σ) | **38** | **yes, one of them**: 53.3 AU (1 σ 52.7-53.8), dots in 8 of 11 images, **all 8 within 4 px of Horizons' position** | 285 s |

The geocentric distance of Makemake from Horizons over these dates is 52-53 AU. The other 37 candidates (50.5-66 AU, 6-8 dots)
**have no dot on the body**: they are chance combinations, and the "σ better than a straight line" the app prints (800-4100 for
all 38, the body's 3696 ranks second) does not tell them apart. Counting dots, then the rms of the fit, puts the body first
(8 dots, rms 0.46 px; the other two 8-dot candidates have 1.0 and 1.1 px), **but that ordering was found after seeing the answer**.

**Control: how many chance candidates does the loosened search give in an empty field?** The same 11 images were scrambled 8
times (each rotated or mirrored and moved at random, independently, so there is no body and no field star where it was) and
variant C was run on each (`--skipReal 1 --nulls 1 --seed 101..108`, about 9 minutes each, run in parallel):

| copy (seed) | 101 | 102 | 103 | 104 | 105 | 106 | 107 | 108 | the real images |
|---|---|---|---|---|---|---|---|---|---|
| candidates | 31 | 41 | 31 | 33 | 29 | 27 | 32 | 37 | **38** |
| most dots in one candidate | 8 | 7 | 8 | 7 | 7 | 7 | 8 | 8 | **8** |
| rms of the candidates with the most dots (px) | 0.85, 0.85, 1.04, 1.00 | 0.69-1.23 | 1.04 | 0.62-1.29 | 0.79-1.11 | 0.88-1.21 | 0.94, 0.96 | 0.94 | **0.46 (the body)**, 1.01, 1.12 |

So **an empty field gives 27-41 chance candidates (mean 33) with the loosened options**: the 38 of the real run is what chance alone
gives, and the body is one of them. What sets it apart in these data is the **fit rms: 0.46 px for the body against 0.85-1.04 px for
the 8-dot chance candidates of the controls** (7-dot ones go down to 0.62). With 8 controls this is a hint, not a calibrated rule;
no rule built from it is in the app.

**What this says, and what it does not.**
- It is the **first time the blind search finds a real body**, and the distance it reports is right (53.3 AU, truth 52-53); but it
  is one of **38 candidates, and an empty field gives about 33 of them** (control above).
- It needs the **loosened options**: with the app's defaults it finds nothing, although the body is a dot in 8 of 11 images, at
  least 2 in every pass, with an rms of 0.46 px. **Which of the changed options makes the difference was not tested**; a suspect is
  the list of seeds (only the 80 brightest dots that are not still stars in each image start a search, and the body is a dot of
  modest brightness among 250-320). The app's defaults are therefore too strict for a body like this, and the loosened options
  return a list in which the body is **1 of 38**.
- One body, one field, one detector, chosen by date: **not a statistic**, and 11 images with 8 detections is the easy end (V = 17
  is well above the single-image limit of section 11: a body at 150-250 AU, at the limit, would be seen in far fewer images).
- Nothing here changes section 11: Planet X mode finds bodies that single images show.

## 13. A first look at "see any object": the dots of one image against 2MASS and AllWISE (added 7 Nov 2026, night)

`node scratch/sources_vs_catalogues.mjs --api http://localhost:8003` (IRSA TAP queries only, nothing downloaded). In the image of
each real field and detector that has most dots, the app's `detectSources` finds the dots; each is looked up in 2MASS (`fp_psc`,
epochs 1997-2001) and AllWISE (`allwise_p3as_psd`, 2010) within 8″ (1.3 pixel).

| field, detector | dots | in 2MASS | in AllWISE | in either | **in neither** |
|---|---|---|---|---|---|
| Barnard's Star D2 | 9 | 8 | 8 | 8 | **1** |
| Barnard's Star D6 | 9 | 5 | 5 | 5 | **4** |
| Epsilon Indi B D2 | 8 | 6 | 6 | 6 | **2** |
| Epsilon Indi B D6 | 10 | 3 | 3 | 3 | **7** |
| WISE 0855 D2 | 15 | 13 | 13 | 13 | **2** |
| WISE 0855 D6 | 9 | 4 | 4 | 4 | **5** |
| total | 60 | 39 | 39 | 39 | **21** |

- **65 % of the dots are in the catalogues; 35 % are not**, and the share is much higher in D6 (16 of 28 dots) than in D2 (5 of 32).
- **Four of the 21 are the known fast movers** (Barnard's Star in D2 and D6, Epsilon Indi B in D2 and D6, each at the position it has
  now, far from where the 1998 and 2010 catalogues put it).
- **The other 17 were not examined one by one.** What the list shows is that several are bright (tens to thousands of mJy: stars that these
  catalogues should hold) with the nearest catalogue source 11-57″ away, and that several lie within 12 pixels of the image edge. That
  points to artefacts (the FITS headers count ghosts, halos of bright stars and snowballs) and to proper motion rather than to
  new objects; **none was shown to be anything new**.
- So **"not in 2MASS or AllWISE" is not a useful definition of "unknown"** on its own: it needs at least a check of the quality flags
  and of bright-star halos, the proper motion from SIMBAD carried to the image date, and a detection in three or more images.
  The same dots could be seen in the other bands, too: a "see anything" mode is a larger piece of work than a new button.
  (That work is §14.)

## 14. "Find everything": every source, checked against four catalogues (added 8 Nov 2026)

The §13 conclusion was that "not in 2MASS or AllWISE" is not a useful definition of "unknown". **Find everything** (the button under *Find movers*)
is the larger piece of work that §13 called for. For the images on screen it (1) finds the dots in every image and links them into
**sources** (the same dot in 3 or more images: fixed; a straight line: mover), (2) measures each source in **every** image, with that
image's wavelength, (3) **vets** it (edge, flagged core, halo of a much brighter star, blend, scatter, too few detections), (4) **cross-matches**
it with SIMBAD, **Gaia DR3**, 2MASS and AllWISE, each **at the catalogue's own epoch** (Gaia and SIMBAD objects are moved to the image date
with their proper motion; a candidate with a real motion is carried back to 1999 and 2010 for 2MASS and AllWISE), and with SkyBoT, (5) gives it
a **support score** (0-100, a sum of documented terms, not a probability) and a **class**: known, known and moving, Solar System body, possible
artefact, **unknown: needs checking** (support at least 65 and present in at least 30 % of the images of its passes), unknown but weakly
supported, or *not checked* when no deep catalogue could be asked (synthetic data; backend down). Every source is listed; the filter only
chooses what to look at. Code: `frontend/js/features/{discovery,vetting,crossmatch,dossier,catalogueRelay,discoverPanel}.js` and
`backend/spherex/catalogues.py` (`GET /api/catalogue`, a relay for 2MASS, AllWISE and Gaia, which send no CORS headers; SIMBAD and SkyBoT are
asked by the browser itself). `node scratch/validate_discovery.mjs --mode real|control|inject --field "Barnard D2"` re-runs everything below; it
needs the real-only backend (`SPHEREX_DATA_DIR=backend/data/real`, port 8003) and internet.

Tests that run without any of that: `scratch/test_discovery.mjs` (60 checks on a synthetic field with a known answer: 12 catalogued stars, a
bright star, a catalogued fast star, an uncatalogued faint star, an uncatalogued mover, a halo ghost, an edge artefact, a one-pass transient and
a SkyBoT asteroid; exactly three sources come out "needs checking"), `test_catalogue_relay.mjs` (26), `test_discover_panel.mjs` (31) and
`backend/tests/test_catalogues.py` (31, network replaced). **They show that the code does what it says; they do not show that it finds new
objects.** The three measurements below are the real-data part.

### Test 1: the six real fields (`--mode real`, each detector alone)

| field | images | dots per image | sources | in a catalogue (moving ones) | **unexplained** |
|---|---|---|---|---|---|
| Barnard's Star D2 | 15 | 3-9 | 8 | 8 (1) | **0** |
| Barnard's Star D6 | 6 | 6-9 | 6 | 6 (1) | **0** |
| Epsilon Indi B D2 | 11 | 4-8 | 7 | 7 (1) | **0** |
| Epsilon Indi B D6 | 6 | 7-10 | 3 | 3 (1) | **0** |
| WISE 0855 D2 | 6 | 14-15 | 14 | 14 (0) | **0** |
| WISE 0855 D6 | 6 | 5-9 | 4 | 4 (1) | **0** |
| total | | | 42 | 42 | **0** |

- **All 42 sources are explained**, every one of them by **Gaia DR3** (G down to about 21), most also by 2MASS and AllWISE. Barnard's Star is
  found as a mover at 10.1″/yr and matched to its Gaia entry with a consistent proper motion. No source was classed as an artefact and none as
  unknown.
- **Repeated and written to a file (8 Nov 2026, 12:51 local).** `node scratch/make_results_sources.mjs` ran the same six fields again (real-only backend, the four catalogues and SkyBoT asked again) and
  wrote every source, as derived numbers, to `frontend/data/real_sources.json` (the results page's section 11). It reproduced the table above field by field (8, 6, 7, 3, 14 and 4 sources = 42,
  every one in a catalogue, the moving ones 1, 1, 1, 1, 0 and 1; the images 18, 6, 11, 6, 6 and 6); all four catalogues answered, no problem was noted. The run took 4-11 s per field. `scratch/test_results.mjs`
  compares the file with this table and fails if the file was made by another version of the algorithm (`discovery-2`) or other thresholds than the code has.
- **The honest reading: in these six small (5′) fields the detector shows only stars that the catalogues already hold.** It says nothing about
  how many *new* objects the tool would find, because there were none to find. The test does show that the cross-match, with proper motion and
  epochs, does not leave real stars unexplained (§13 had 21 of 60 dots "in neither 2MASS nor AllWISE").

### Test 2: empty-sky control for the threshold (`--mode control`)

Every image of a real field is rotated/mirrored at random and moved by a random whole number of pixels, independently, which destroys every
correspondence between images; the catalogues are passed as "checked, and empty". Every source that survives is false by construction.
200 such copies of each of the six fields (1200 in all). False "needs checking" sources for several thresholds of the support score (a source
must also be present in 30 % of the images of its passes):

| support threshold | 40 | 50 | 60 | **65** (used) | 70 | 80 |
|---|---|---|---|---|---|---|
| false leads per empty field, all six fields | 0.24 | 0.17 | 0.084 | **0.047** | 0.011 | 0 |

- **At the chosen 65 about 1 empty field in 21 shows a false lead, and it varies a lot with the field**: 0.005 (Barnard D6, 6 images) to 0.16
  (WISE 0855 D2, 14 dots per image: one empty copy in 6). Crowded fields and fields with many images give more.
- Almost all false leads are the **minimum case**: 3 detections (a chance alignment of 3 dots of different images) in 2-3 survey passes. A
  person dismisses them in seconds from the small pictures, which show nothing at that place in the other images.
- The first control (before the persistence term of the score, 60 copies per field) gave 0.083 per field at 60; with it, 0.084. **The
  persistence term did not make the control cleaner**: in a field with structured background (the halo of a bright star) a chance position is
  3 sigma in many images too. It stays because injected real sources score high with it (below). **The threshold is what controls the false
  rate.**
- Not covered: real variable stars, real clustering of faint sources, and everything the scrambling keeps in common between images.

### Test 3: injected sources (`--mode inject`, catalogues "checked, and empty")

Fake point sources (the PSF of the FITS headers, integrated over the pixels) are added to the real images at a known place; the flux is in
units of the detector's own noise (5 sigma per image is the detection limit, as in §10). **Fixed sources**, 60 trials per cell, how many are
listed as a source:

| field | flux 16 | 22 | **32** | 50 | 80 | 32 in mJy | classed "possible artefact" (at 50) |
|---|---|---|---|---|---|---|---|
| Barnard D2 | 0 | 6 | 55 | 60 | 60 | 19 | 25 of 60 (halo of the saturated star) |
| Barnard D6 | 0 | 0 | 43 | 59 | 59 | 5.5 | 38 of 60 |
| Epsilon Indi B D2 | 1 | 4 | 55 | 60 | 60 | 1.5 | 0 |
| Epsilon Indi B D6 | 0 | 0 | 33 | 60 | 60 | 0.69 | 5 |
| WISE 0855 D2 | 1 | 1 | 50 | 60 | 60 | 0.67 | 0 |
| WISE 0855 D6 | 0 | 0 | 40 | 60 | 60 | 0.81 | 12 |

- **The cliff is steep: nothing below 22 times the noise, almost everything from 32.** In a clean field that is **0.7-1.5 mJy** for a fixed
  source; around the saturated star of Barnard's field 5-19 mJy. Fixed sources need 3 individual detections, so this is about **1.5 times worse
  than the single-image limit of §10** (0.6-0.9 mJy). Stacking all images would go deeper; it is not done.
- In the clean fields most listed sources score 80 or more (e.g. Epsilon Indi B D2: all 60 at 50 times the noise).
- **In Barnard's fields 35-65 % of the injected sources are classed "possible artefact"** (the halo flag: a 20-times brighter source within 14
  pixels). The rule is conservative there on purpose; they are still listed, with the reason.
- **Moving sources** (12 trials per cell, 6-image D6 fields): at 22 times the noise none is listed; at 32 times 1-10 of 12 (the slower, 4″/yr,
  are found more often than 30″/yr); at **50 times (1.1-1.3 mJy in the clean fields, 8.6 mJy in Barnard's) 11-12 of 12**; most of the listed
  ones come out "needs checking" (their scores are 60-79: the chance-line term is the main part, and a 5′ field gives it little room).

### What real data taught (defects found and fixed during this work)

1. **`apertureSnr` rejected one pixel grid in fifty**: its "no holes" test compared the pixel count with 0.8 x pi x r^2 = 10.05, but a circle of
   radius 2 pixels centred at some positions holds only 10 pixel centres. Fixed in `movers.js` (it now compares with the number of geometric
   centres); `scratch/test_movers.mjs` holds the regression check, shown to fail on the old rule.
2. **A "mover" that was a bright star** near the picture edge: four of its dots formed a line of 12″/yr (6 sigma), while the same star was also
   linked as a fixed source in all 12 images; its Gaia entry says 0.02″/yr. Two rules came out of it: a mover whose dots are within 1.5 pixels
   of a fixed source with at least as many detections is dropped (`isShadowOf`), and a catalogue match whose own proper motion disagrees with
   the measured one is not "known": the source becomes a *possible artefact* with the flag `motion-disagrees`.
3. **Cutouts of `det=all` and of one detector are not the same pixels** (about 2100 of 2401 pixels differ: the backend resamples all detectors
   onto a common grid for the first). The mover finder is sensitive to that for marginal lines: the line of item 2 appeared with `det=all` and
   not with a single detector. All numbers above use single-detector cutouts, so **they do not describe the page's default "Use all detectors"
   exactly**; the page runs the same code and showed the same classes on Barnard's and WISE 0855's fields.
4. A fixed source seen in only 3 of 18 images scored 57-66 in the first version of the score; the persistence term and the minimum
   persistence for "unknown" came from that.
5. The answers of IRSA and Gaia can be cut short in a dense field (limit 20 000 rows): such a list is marked `truncated`, counts for the sources
   it matched, and **does not count as "not in the catalogue"**. Without a deep catalogue (Gaia, 2MASS, AllWISE) nothing is called unknown.

### Limits, in one list

- **Nothing new was found, and nothing here says the tool would find it**: Test 1 has no unexplained source; Test 3 measures sensitivity with
  artificial sources of a flat spectrum (the variable filter changes a real source's brightness from image to image).
- Depth: fixed sources 1.5 times worse than a single image, movers need about 50 times the noise; around a saturated star 20-30 times worse
  still. A brown dwarf like WISE 0855 (about 0.4 mJy in a stack, §7) is **below** the limit of this button.
- The score is a sum, not a probability; the threshold (65) comes from six small real fields; the false rate depends strongly on the field.
- 2MASS and AllWISE dates are approximations (2MASS: a date per source from the catalogue; AllWISE: the mean epoch of the W1 exposures);
  the carry-back of a moving candidate adds at most 12″ of search radius.
- Gaia was reachable for all six fields in the last run; from this network a plain GET to the ESA service hangs, so the relay uses POST (some
  answers still took over a minute). The page waits up to 130 s per catalogue and says what failed.
- The positions CSV of a source is **not** an MPC/ADES report: the observatory code and the spacecraft position were not verified, so it is
  not called that.
- Not checked by a person on a phone; script checks only (see docs/ACCESSIBILITY.md).

## 15. Are the positions, the motions and the fluxes right, and are their errors? (Phase 4, added 8 Nov 2026)

The question is not only "is the value right" but "is the **error** that goes with it right": a velocity of 10.2 ± 0.3 ″/yr is worth something only if
the real spread of such velocities is 0.3. Two kinds of check, one command each:

- **Injected stars** (`node scratch/calibrate_astrometry.mjs`, about a minute; `node scratch/test_astrometry.mjs` is the same code with fixed seeds and
  assertions, in CI): point sources with a **pixel-integrated Gaussian PSF** (the PSF of SPHEREx is smaller than a pixel: σ 0.356 px = FWHM 5.15″ in D2,
  0.457 px = 6.61″ in D6, from the headers' median `PSF_FWHM`) on white noise.
- **Real fixed stars and empty sky** (`node scratch/check_astrometry_real.mjs`, needs the real-only backend): the six real fields of §14.

### 15.1 The position of a star (`detectSources`, a windowed centroid)

| PSF σ | flux / pixel noise | found | bias | rms per axis | best possible (Cramér–Rao) | rms / best |
|---|---|---|---|---|---|---|
| 0.356 px (5.15″) | 12 | 78 % | 0.002 | 0.176 px | 0.120 | 1.47 |
| | 20 | 100 % | 0.001 | 0.110 | 0.067 | 1.64 |
| | 40 | 100 % | 0.002 | 0.064 | 0.034 | 1.87 |
| | 80 | 100 % | 0.001 | 0.045 | 0.017 | 2.65 |
| | 200 | 100 % | 0.002 | 0.037 | 0.007 | 5.5 |
| | 600 | 100 % | 0.001 | 0.036 | 0.002 | 16 |
| 0.457 px (6.61″) | 20 | 100 % | 0.001 | 0.117 | 0.080 | 1.47 |
| | 200 | 100 % | 0.001 | 0.018 | 0.008 | 2.3 |
| | 600 | 100 % | 0.000 | 0.015 | 0.003 | 5.5 |

- **No bias on average, but a pixel-phase bias.** An undersampled star pulls the centroid towards the centre of its pixel: in x, for σ = 0.356 and a bright
  star, +0.017 / +0.042 / +0.049 / +0.038 / +0.015 px in the five tenths of the pixel before its centre and the same with the opposite sign after it. Up to
  0.05 px = 0.3″. Because of it the error **stops falling at about 0.036 px** however bright the star is (16 times the best possible at flux 600):
  a fit of the PSF could do 5-10 times better for bright stars; it was **not done** (the real PSF is not a Gaussian, and the real floor is larger anyway, §15.5).
- For faint stars (flux 20-40 times the pixel noise) the centroid is within 1.5-1.9 times the best possible error, and 0.4-0.5 px is the worst error found at flux 20.

### 15.2 The error model, and the error that was reported before

The error of a dot's position follows **σ² = (A / S/N)² + B²** per axis (S/N = the dot's own, from `detectSources`): fitted on 14 000 stars of flux 8-900
(`sigmaPx` of every dot, `centroidSigmaPx` in `movers.js`):

| PSF σ | fitted A | fitted B | in the code | spread of z on 4 000 other stars | inside 1σ / 2σ |
|---|---|---|---|---|---|
| 0.356 | 1.059 px | 0.036 px | 1.05, 0.036 | **1.00** | 61 % / 98 % |
| 0.400 | 1.037 | 0.024 | 1.05, 0.024 | 0.98 | 64 % / 98 % |
| 0.457 | 1.050 | 0.014 | 1.05, 0.014 | 0.98 | 67 % / 97 % |

z = (measured − true) / σ of the dot. 61-67 % rather than 68 % inside 1σ because the error at high S/N is the (bounded) pixel-phase bias, not a Gaussian.
The code assumes the cautious PSF width (0.356, the largest B) unless the caller gives one; on a wider PSF that is conservative (spread of z 0.71).

### 15.3 The velocity of a mover (`findMovers`), and the error that was reported before

18 images in 4 survey passes (the cadence of Barnard's Star in D2), a star in a random direction, 150 trials per row, all found:

| speed | flux / noise | spread of the fitted velocity | **error reported now** | spread of z | inside 1σ / 2σ |
|---|---|---|---|---|---|
| 1.7 px/yr | 40 | 0.048 px/yr | 0.053 | 0.89 | 75 % / 98 % |
| 1.7 | 80 | 0.030 | 0.041 | 0.74 | 83 % / 99 % |
| 1.7 | 200 | 0.026 | 0.037 | 0.70 | 86 % / 99 % |
| 5 | 40 | 0.049 | 0.053 | 0.92 | 73 % / 96 % |
| 5 | 80 | 0.037 | 0.041 | 0.91 | 68 % / 99 % |
| 5 | 200 | 0.036 | 0.037 | 0.96 | 64 % / 98 % |

- **Before Phase 4 the error was a floor**: 0.15 px / √Σdt² = **0.101 px/yr for every star**, 2-4 times the real spread (spread of z 0.26-0.48; 96-100 % of the
  fitted velocities inside "1σ"). So the "significance" of a mover was 2-4 times too low.
- Now the error is propagated from the errors of the dots: for the ordinary least-squares line the velocity has the exact error √(Σ dt²σ²) / Σ dt² (checked:
  6 000 simulated lines, spread of z 1.01, 67.6 % inside 1σ), multiplied by max(1, scatter / modelled scatter) and combined in quadrature with a
  **systematic floor of 0.04 px per dot** (found on real stars, §15.5). Faint stars: the error is the spread (z 0.89-0.92). Bright ones: cautious (z 0.70-0.74), because of that floor.
- **On the six real runs** (`node scratch/validate_real.mjs`): the same candidate, the same motion, the same chance-line number and the same path support
  as before in every one; the significance of the faint Epsilon Indi B went from 8 / 7 / 11 σ to **15 / 11 / 18 σ**, the saturated Barnard's Star stays at 16 / 10 / 20 σ (a
  star positioned by the masked fit keeps an error of 0.15 px). Compared with the catalogue: Barnard's Star is 0.2-0.8″/yr off, **0.4-0.8 of its error**;
  Epsilon Indi B is 0.5-0.65″/yr off in RA in D2, D6 and both, **1.7-2.3 of its error**: the same offset in both detectors, so a systematic: the catalogue
  motion of a binary brown dwarf (its photocentre moves with the orbit) or the instrument; not decided here.
- **Nothing else moved.** Same seeds, old code against new: the empty-sky control (200 copies of each of the six fields) gives 316 / 225 / 86 / 12 / 0
  false "needs checking" sources at support 40 / 50 / 60 / 70 / 80 with the old code and 315 / 225 / 86 / 12 / 0 with the new one; the injection table of §14 (Barnard D6) is
  identical cell by cell; the 42 sources of the six fields are the same in class, position, motion, support, flux and match.

### 15.4 The flux in an aperture (`apertureSnr`, radius 2 px)

White noise, 3 000 stars per row: the flux is unbiased (0.991-0.999 of the injected), and the old error (`err`: the scatter of the ring times √N) is 8-13 % too small
(spread of z 1.08-1.13) because it leaves out the error of the background level; with that term (`errTotal`) the spread is 0.99-1.04. `snr` (flux / `err`) is left as it was:
the thresholds of §10-§14 were tuned with it. The error to **report** is `calibratedFluxErr`: `errTotal` for synthetic data, and for real cutouts `err` × 1.7 (next).

### 15.5 The same errors on the real images (`node scratch/check_astrometry_real.mjs`)

> **Notice of 10 Nov 2026.** These are the errors checked on the real fields. Until 10 Nov the backend held **three exposures of Barnard's Star in D2 twice** (byte-identical files; section 2.1), so "Barnard D2, 18 images" below was 15 distinct images plus 3 copies. The numbers of this section that rest on Barnard D2 were measured with the copies in and **have not been re-run**; read them as probably slightly optimistic for that field (an exposure counted twice is not an independent measurement). The other fields (Barnard D6, Epsilon Indi B, WISE 0855, Makemake) have no copies.

- **Positions of fixed stars** (a dot at the same place in at least 6 images, after the registration, a star that moves removed; the saturated stars, positioned by the masked fit, are outside the model and left out): 183 dots. Pooled spread of z
  **0.85**. By S/N of the dot:

| dot S/N | dots | modelled error | real rms residual | spread of z | floor needed |
|---|---|---|---|---|---|
| 3-8 | 51 | 0.164 px | 0.087 | 0.55 | 0 |
| 8-20 | 70 | 0.099 | 0.060 | 0.65 | 0 |
| 20-60 | 37 | 0.050 | 0.046 | **0.97** | 0 |
| above 60 | 25 | 0.038 | 0.055 | 1.48 | **0.040** |

  The model is right where most of the information is (S/N 20-60), **too cautious for faint dots** (by 1.5-1.8 times: linking dots within 1.2 px keeps the less scattered ones, and the
  real noise is correlated) and **too optimistic for bright ones** by 0.04 px: that is `SYSTEMATIC_SIGMA_PX`. Stars positioned by the masked fit (saturated cores) are outside the model and get 0.15 px.
- **Flux in empty sky** (7 950 apertures of radius 2 px far from every dot): the robust spread (1.4826 × MAD) of flux / `err` is **1.68** (1.47-1.85 per field), the plain
  spread 13 (sources below the detection threshold and the wings of bright stars sit in some "empty" apertures; WISE 0855 D2 gives 37). The cutouts are resampled, so their noise is correlated between pixels:
  a sum over an aperture scatters more than the pixel scatter says. `REAL_APERTURE_NOISE_FACTOR = 1.7`; it is an upper-ish figure (part of it is real faint sources).

### 15.6 What this does not settle

- White noise and a Gaussian PSF in the injections; real noise and the real PSF only in the two checks of §15.5, on 6 small fields (183 dots, 7 950 apertures).
- The centroid is not a PSF fit: bright stars are limited by the pixel-phase floor, and the real floor (0.055 px = 0.34″) is larger still.
- The astrometric floor of 1″ (`ASTROMETRIC_FLOOR_ARCSEC`, from the Arosa test) still dominates the position error that is reported for a candidate.
- The **parallax search** (Planet X mode) still uses the old floor of 0.15 px for its fits: not changed, and not re-validated.
- Versions: `movers-2` and `discovery-3` (the numbers of the errors changed; the classes and thresholds did not).

### 15.7 A PSF-fit centroid, and the error of the backend's photometry (8 Nov 2026, the remainder of Phase 4)

**A PSF fit.** `fitPsfCentroid` (movers.js) fits, by least squares, a Gaussian of the true PSF width **integrated over each pixel** (centre and total flux free, background fixed at the
measured median) in a 7 x 7 window; `detectSources(..., { psfFit: true })` uses it to refine every dot whose core is intact (a saturated, masked star keeps the masked fit; a fit that does
not converge keeps the windowed centroid). `node scratch/compare_centroids.mjs` (800 injected stars per row, white noise, PSF integrated over pixels, the star at a random place inside its pixel):

| PSF sigma (px) | total flux / pixel noise | windowed centroid, rms per axis (px) | PSF fit, rms (px) | Cramér-Rao limit (px) | fit / limit | pixel-phase bias, windowed / fit (px) |
|---|---|---|---|---|---|---|
| 0.356 | 20 | 0.110 | 0.074 | 0.063 | 1.17 | 0.073 / 0.014 |
| 0.356 | 80 | 0.044 | 0.018 | 0.016 | 1.11 | 0.049 / 0.001 |
| 0.356 | 320 | 0.037 | 0.004 | 0.004 | 1.08 | 0.048 / 0.001 |
| 0.457 | 20 | 0.119 | 0.085 | 0.079 | 1.08 | 0.026 / 0.013 |
| 0.457 | 80 | 0.032 | 0.020 | 0.020 | 1.01 | 0.023 / 0.004 |
| 0.457 | 320 | 0.015 | 0.005 | 0.005 | 1.04 | 0.017 / 0.000 |

On ideal stars the fit reaches the best any estimator can do (1.01-1.17 times the limit) and has no pixel-phase bias. Its error model, fitted with the **same method** as §15.2 (the windowed rows of the
script reproduce the A and B written in movers.js: A 1.00-1.02, B 0.036 / 0.024 / 0.014): sigma^2 = (0.73 / S/N)^2 + 0.005^2 per axis (A 0.715-0.729, B 0.001; `PSF_FIT_NOISE_COEFF`, `PSF_FIT_FLOOR_PX`).

**On the real images it is NOT better, so it is off by default.** `node scratch/check_astrometry_real.mjs [--psf 1] [--s2 W --s6 W]`: the same fixed stars as §15.5, the rms of each dot about the
mean position of its star (a measure of repeatability from one image to another):

| dot S/N | windowed centroid (183 dots) | PSF fit, the header's PSF width (223 dots) | PSF fit, a wider model (D2 0.9 px, D6 1.0 px; 215 dots) |
|---|---|---|---|
| 3-8 | 0.087 px | 0.111 | 0.089 |
| 8-20 | 0.060 | 0.090 | 0.069 |
| 20-60 | 0.046 | 0.061 | 0.056 |
| above 60 | 0.055 | 0.102 | 0.072 |

The fit with the PSF of the headers scatters MORE than the windowed centroid (0.061 against 0.046 px at S/N 20-60, 0.102 against 0.055 above 60) and the error it reports (0.027 px in the S/N 20-60 bin, 0.009 px above 60)
is far too small there (sd(z) 3.45 pooled, 11.8 above S/N 60): the real PSF of the resampled cutouts is not a Gaussian of the header width, and a fit that trusts the model moves with the pixel phase of each
image. A wider model gets closer and is still not better. **The windowed centroid stays the default**; the PSF fit is available (`psfFit`) for ideal or better-modelled data, with its tests
(`test_astrometry.mjs`, +9). A real PSF (the file's PSF extension) was not tried: that is the next step if a better position is needed. Not changed: the systematic floor of 0.04 px.

**The error of the backend's photometry (`photometry.py`).** `backend/.venv/Scripts/python.exe -I scratch/check_photometry_noise.py`: 7 950 apertures of radius 2 px at random places of the real cutouts of
the six fields, z = flux / error, robust spread (1.4826 x MAD):

| error taken from | pooled robust spread of z | by field (D2 / D6 of Barnard, Epsilon Indi B, WISE 0855) |
|---|---|---|
| the scatter of the ring, as `photometry.py` always did (`fluxErr`) | **0.44**: too LARGE by 2.3 times | 0.28, 0.27, 0.53, 0.66, 0.63, 0.82 |
| the robust scatter of the ring (1.4826 x MAD) | 2.11: too small by 2.1 times | 2.19, 2.25, 2.02, 1.89, 2.23, 1.67 |

The plain scatter of the ring is inflated by the faint stars and the wings in it; the robust one is the noise, and a sum over a circle of resampled (correlated) pixels scatters 2.1 times more than that
noise says. The backend now also sends `fluxErrCal` / `fluxJyErrCal`: robust ring scatter x sqrt(pixels inside) x `REAL_NOISE_FACTOR` = 2.1 for real cutouts (BUNIT MJy/sr), 1 for synthetic ones. By
construction the pooled robust spread of z is 1; by field it is 0.8-1.1 (1.67-2.25 divided by 2.1), so a single factor is right to about 20 %, not better. The spectrum and light-curve error bars use
`fluxErrCal`. The old `fluxErr` is unchanged (nothing that consumed it broke): `scratch/stack_wise0855.py`'s "nominal" error still comes from it, so the WISE 0855 numbers of §7 are as they were.

**Epsilon Indi B, 0.5″/yr from the catalogue** (§15.5, still unexplained). A possible cause, **from memory and not checked here**: Epsilon Indi B is a close pair of brown dwarfs (Ba and Bb, about 0.6″ apart,
orbit of about 11 years), unresolved in a 6.14″ pixel, so what is measured is the motion of their light centre, which has the orbital motion on top of the proper motion that SIMBAD lists. A test would
need the orbit; none was made.

## 16. The Planet X Lab: which motion fits, and how likely is a distant body to be found (Phase 5, 8 Nov 2026)

> **Notice of 10 Nov 2026.** This is the Planet X Lab's map on the real Barnard D2 field (its injections went into the real images, copies included). Until 10 Nov the backend held **three exposures of Barnard's Star in D2 twice** (byte-identical files; section 2.1), so "Barnard D2, 18 images" below was 15 distinct images plus 3 copies. The numbers of this section that rest on Barnard D2 were measured with the copies in and **have not been re-run**; read them as probably slightly optimistic for that field (an exposure counted twice is not an independent measurement). The other fields (Barnard D6, Epsilon Indi B, WISE 0855, Makemake) have no copies.

Section 5 of the page (`planetLab.js`, `planetLabView.js`, `planetLabWorker.js`; version `planetlab-1`) has two parts.

**Which motion fits?** For the dots of one candidate (positions on the dates of their images) three models are fitted by least squares: *stationary* (2 parameters), *straight line* (4) and
*straight drift + Earth parallax* (5: the same and the distance; the straight line is its limit at an infinite distance, so it can never fit worse: a first version showed it doing so on real
Barnard's Star, found in the browser, fixed, test added). They are compared with **BIC = χ² + k ln N** (N = 2 numbers per position; the words for ΔBIC are Kass & Raftery's, **from memory**). The
distance is quoted **only when it is constrained**: the parallax model must beat the straight line by ΔBIC ≥ 10 and its 95 % range (χ² within 4 of the best, one parameter) must be closed on both
sides inside the 20-20 000 AU that are tried and no wider than a factor of 3; otherwise the answer is "no distance claimed", a lower limit, an upper limit or "not constrained". The ranges come from a
second, fine scan around the minimum (the coarse grid has steps of 3 %, wider than the 1σ range of good data). `node scratch/test_planetlab.mjs` (57): on 60 simulated bodies at 500 AU
(positions good to 3″) the 95 % range holds the true distance in **58 of 60** and the 68 % range in **37 of 60**; a stationary object is called stationary in at least 54 of 60 noise realisations
(noise alone favours a line about 4 % of the time) and never gets a distance. **In the browser on real Barnard's Star** (Barnard D2 + D6, 24 dots, error 0.15 px per axis): stationary χ² 560 (ΔBIC +499),
straight line χ² 54.0 (χ²/dof 1.23), parallax χ² 54.0 (ΔBIC +3.9): a straight line, no distance claimed. This one is an observation, not a command: the 0.15 px is the floor the parallax search gives a dot and
was not calibrated on real dots (§15.6), so χ²/dof near 1 here is a coincidence of that choice, not a validation of it.

**How likely is a distant body to be found?** A **synthetic** body (a Gaussian PSF of σ 0.4 px integrated over the pixels, a drift of 0.5-1.0 times the circular speed in a random direction, a random place
in the middle half of the field, the same flux in every image) is added to the **real** images of the field on screen where a real body would be (the Earth's swing from `parallaxOffsetArcsec`, and the
pointing shift of each exposure from `registerShifts` of the uninjected images), the dots are detected with `detectSources` and `findDistantMovers` is run with its default options. A try succeeds when a
candidate lies within 3 px of the body on at least half of the images; "distance right" when it is also within a factor 1.5. The page runs it in a module worker (the page stays usable) and draws the map
(tries, found, the word, the share as colour, the swing of each distance against the field); `node scratch/planet_lab_map.mjs --trials 20 --distances 2500,3500,5000 --fluxes 50,150,400` is the same from
the command line (4 s here), against the real-only backend, on the Barnard D2 field (5′, 49 × 49 px, 18 real images, 4 survey passes, 60909-61306 MJD), seed 1:

| flux (mJy) | 2500 AU (swing 2.7′: leaves the 5′ field) | 3500 AU (swing 1.9′) | 5000 AU (swing 1.4′) |
|---|---|---|---|
| 400 | 12 / 20 (95 %: 39-78 %) | 17 / 20 (64-95 %) | 6 / 20 (15-52 %) |
| 150 | 8 / 20 (22-61 %) | 17 / 20 (64-95 %) | 6 / 20 (15-52 %) |
| 50 | 7 / 20 (18-57 %) | 14 / 20 (48-85 %), distance right in 13 | 4 / 20 (8-42 %) |

Reading it: in this field the search finds a body of 50-400 mJy at 3500 AU in 70-85 % of the tries and at 5000 AU in 20-30 % (a swing of 1.4′ is 14 pixels at most: little lever arm); at 2500 AU the body often
leaves the 5′ field, which is why a 30′ field is needed for nearer bodies. Above about 150 mJy more light adds nothing at 3500 and 5000 AU (17 / 20 and 6 / 20 for both 400 and 150 mJy): there the limit is not the
brightness. A fact that is measured here and a cause that is **a hypothesis**: (`planet_lab_map.mjs` also prints it) the swing alone puts a body 0.3-0.5 px apart on pass 1 and pass 3 (362 days: the Earth is back at the same point), 1.9-3.7 px apart on passes 1 and 4,
2.1-4.2 px on passes 3 and 4, and 13-25 px away only on pass 2 (distances 5000-2500 AU): of the four passes only one carries a large swing; the search wants three well-separated ones. That would be a property of this observing cadence, not of the
code; it was not tested by changing the cadence. Rms of the dots of the 91 bodies that were found about their model: **median 0.037 px**, 10th-90th percentile 0.030-0.206 px, against the 0.15 px floor the
parallax search gives every dot: for ideal (Gaussian) bodies the floor is 4 times cautious; for real ones nothing is known (§15.6, and the real PSF is not Gaussian, §15.7).

**What it does not show.** The images are real, the bodies are synthetic: it measures this search on these images, not any real object. The PSF is Gaussian; the flux is the same in every image (a body with a
spectrum would be brighter in some images than in others); one field at a time; 20 tries give wide intervals (the Wilson 95 % intervals are in the table); the flux is a total flux in mJy from the image's own unit and
the pixel's solid angle. Detection is judged against the images' own noise, so the same map on another field differs. Not done: a map on a 30′ real field of the same patch (the author's 30′ Makemake cutouts lie on
different bits of sky: §12), a body with a spectrum, the real PSF.

## 17. The Solar System simulator: are the planets where JPL Horizons puts them? (Phase 8, 8 Nov 2026)

Historical Workspace panel (removed 14 Nov 2026; its validated calculation remains in `solarSystem.js`): a top-down view of the ecliptic with the planets on a date, and a distant body in the direction of the field with the lines of
sight from the Earth on the dates of the survey passes. **Scientific mode** is to scale (linear in AU); **educational mode** compresses the distances (square root), enlarges the planets and says it
is NOT TO SCALE. The planets come from the six Keplerian elements and their rates of JPL's table of approximate positions (Standish; valid 1800-2050), **written from memory and therefore checked**;
the Earth is not taken from that table but is the Earth of `parallax.js` (`earthPositionAU`, the Sun formula of Meeus), turned into ecliptic axes, so the simulator and the parallax of the Planet X
search can never disagree (`test_solarsystem.mjs`: the two Earths are the same to 1e-12 AU).

`node scratch/check_planets.mjs` asks JPL Horizons (an ephemeris query: heliocentric vectors, ecliptic J2000, one request per planet, no file downloaded) for the same positions on five dates (MJD 60909, 61114,
61271, 61306 = the survey passes of the Barnard D2 field, and 61041 = 1 Jan 2026) and prints the largest difference:

| planet | distance from the Sun (AU) | largest difference (AU) | largest difference seen from the Sun (arcsec) |
|---|---|---|---|
| Mercury | 0.32 | 0.00002 | 11 |
| Venus | 0.72 | 0.00003 | 8 |
| Earth (Meeus) | 1.01 | 0.00015 | 29 |
| Mars | 1.59 | 0.00042 | 58 |
| Jupiter | 5.16 | 0.00310 | 74 |
| Saturn | 9.56 | 0.01278 | 267 |
| Uranus | 19.51 | 0.00741 | 21 |
| Neptune | 29.89 | 0.00591 | 34 |

So the elements recalled from memory are right (a wrong constant would put a planet whole AU away, not hundredths), and the differences are those of an approximate table, largest for Saturn (4.5 arcmin, 0.013 AU).
They are far too small to be seen at any range of the simulator. `test_solarsystem.mjs` keeps the Horizons numbers (fetched on 8 Nov 2026) and checks every planet against a bound about 1.5 times the difference
measured, so a change that worsens a position fails without a network. The swing of a body that does not move (the angle between the lines of sight from two Earths) equals the parallax the search uses
(`parallaxOffsetArcsec`) to 0.3 % on the dates of the Barnard passes (angles of several hundred arcsec). Found by the tests: a Kepler solver that started at pi for high eccentricities ran away for negative mean
anomalies (residuals of 3e5); it is now confined to [M - e, M + e]. Found while writing the check: Horizons does not return the dates in the order they are asked, so the rows are matched by their Julian date.

**What it does not show.** Only the eight planets (no moons, asteroids, comets or dwarf planets; Pluto is not in the table), 1800-2050 (the table's range), an ecliptic top view (not 3D), and no orbit of a
hypothetical Planet X (only a body that does not move, to show the geometry of the swing). The periods are derived from the semi-major axis by Kepler's third law, not looked up.

## 18. Which survey images cover a place: does the page agree with IRSA? (10 Nov 2026)

The sky explorer can ask which images of the SPHEREx **survey** (not the files on this computer) touch a circle around a position: the backend asks IRSA's table `spherex.plane` (a catalogue query: no FITS file is downloaded) and the page draws each footprint and counts the images that **cover the centre**. The footprints are spherical polygons; the page projects them on the tangent plane (gnomonic), where their edges are straight lines, and tests whether the centre is inside.

The check is IRSA's own answer to the same question: `SELECT COUNT(*) FROM spherex.plane WHERE 1=CONTAINS(POINT('ICRS', ra, dec), poly)` against the number of images of a 6′ circle (backend `/api/survey`, limit 1000) whose footprint contains the point by the page's test. Command (needs the network and a running backend, any of them): `node scratch/check_survey_live.mjs` (`--api http://localhost:8003`).

| position | RA, Dec (deg) | IRSA: images covering the point | page | passes (30-day rule) | same |
|---|---|---|---|---|---|
| Barnard's Star | 269.452, 4.693 | 364 | 364 | 3 | yes |
| Epsilon Indi B | 331.044, -56.783 | 449 | 449 | 4 | yes |
| WISE 0855 | 133.819, -7.247 | 259 | 259 | 3 | yes |
| RW Aurigae | 76.957, 30.401 | 333 | 333 | 3 | yes |
| R Draconis | 248.168, 66.755 | 2483 | 919 (list cut off at 1000) | 2 | not compared |
| across RA 0 | 0.300, 10.000 | 373 | 373 | 3 | yes |
| near the north pole | 100.000, 85.000 | 356 | 356 | 3 | yes |
| on the ecliptic | 90.000, 23.400 | 327 | 327 | 3 | yes |

**7 of 7 comparable positions agree exactly**, including a footprint across RA 0 and one near the pole. Also, around Barnard's Star (269.4462, +4.769) a 30′ circle has 559 images touching it and 359 covering its centre by both IRSA's `COUNT` and the page. The passes are counted with the rule of Find movers (images 30 days or more apart are different passes; `passIndices`): Barnard D2 has 61 covering images in 3 passes (2025-08-21 to 2025-08-30, 2026-03-15 to 2026-03-22, 2026-08-18 to 2026-09-22).

What it does not show. "Covers" means the footprint contains the point, not that the pixel there has valid data (an edge, a flagged pixel). Where the survey is dense (R Draconis, near the ecliptic pole, has 2483 images over its position) the list of 1000 images is cut off, the page says so and does not claim a number of passes. The test is of the geometry against IRSA's, on eight positions; it does not test IRSA's table itself, which changes weekly (the answers above are of 10 Nov 2026). Found while building it: IRSA refuses `INTERSECTS(CIRCLE(...), poly)` as "Invalid or unsupported ADQL query string" and accepts the polygon first, `INTERSECTS(poly, CIRCLE(...))`; the polygon comes as EWKB hex with longitude in [-180, 180].

## 19. Sections 4-6 of the results page remade by a command (10 Nov 2026)

`node scratch/make_results.mjs [--write]` (backend on the real files; IRSA TAP and SkyBoT for the catalogue magnitudes and the asteroid positions) remakes the Jansky scale (section 3 of this file), the asteroid Arosa (section 6) and the WISE 0855 stack (section 7) and writes them to `frontend/data/real_results_generated.json`; the tables of those sections stay as measured on 7 Nov. The fields and the code are the same, so most numbers did not move.

**Jansky scale** (`validate_photometry.py`, aperture of 2 pixels, isolated unsaturated stars, 2MASS J/H or AllWISE W2). "Stars" is the number of stars with at least two usable measurements (3 of the 5 isolated stars in Barnard D2): the table of 7 Nov counted the isolated stars of the field, which is a different number.

| Field, detector | Stars | Measurements | Median measured / catalogue | Scatter | 16th-84th percentile |
|---|---|---|---|---|---|
| Barnard field · D2 | 3 | 33 | **0.967** | 0.031 | 0.92-0.99 |
| Barnard field · D6 | 5 | 18 | **0.895** | 0.046 | 0.84-0.93 |
| Epsilon Indi B field · D2 | 2 | 15 | **0.979** | 0.053 | 0.93-1.02 |
| Epsilon Indi B field · D6 | 1 | 3 | **0.932** | 0.024 | 0.90-0.94 |

The medians, the scatter and the number of measurements are **the same as on 7 Nov** (after the copies were removed: a first run of the same day counted 38 measurements and a median of 0.968 for Barnard D2, because it counted three exposures twice, see 2.1); D6 is still lower than D2 in both fields. The zero points are still written from memory (section 3).

**Arosa**: SkyBoT gives its position at each time, the backend measures the flux there: it moved **563″ in 19.5 hours** (28.8″/hour; SkyBoT says 28.8″/hour, it said 29.0 on 7 Nov: the average of its two dates, not one).

| Image | Flux |
|---|---|
| Image of 00:10 UTC (1.21 µm), at the 00:10 position | 8.66 ± 0.30 mJy |
| Image of 00:10 UTC (1.22 µm), at the 19:42 position | 0.02 ± 0.95 mJy |
| Image of 19:42 UTC (1.34 µm), at the 19:42 position | 8.56 ± 1.11 mJy |
| Image of 19:42 UTC (1.34 µm), at the 00:10 position | not in this cutout |

The fluxes are the same as on 7 Nov to 0.02 mJy (8.67, 0.02, 8.56; two runs of the command a minute apart gave 8.66 and 8.68 for the first, because SkyBoT answers a slightly different position each time); the errors are 10-30 % larger (0.27 → 0.30, 0.84 → 0.95, 0.98 → 1.11) because the backend's flux error was changed in Phase 4 (15.7). The centre offset of the source (1.0″) is still the typed value of 7 Nov: the script does not measure it.

**WISE 0855** (`stack_wise0855.py`): **identical to 7 Nov**: D6 stack 0.415 ± 0.076 mJy, 4.3 times the robust scatter of the controls, brighter than 15 of 16 controls, one control at +4.81 mJy on a field star; D2 stack 0.635 ± 0.086 mJy, brighter than 16 of 16 (the 2MASS star inside the aperture). The explanation of the D2 excess is text, not measured by the script.

## 20. Is the reported error of a velocity right on real frames, and how often does a search fail? (10 Nov 2026)

`node scratch/validate_uncertainty_real.mjs --api http://localhost:8003 --field "<field>" --trials 100 --nulls 300 --seed 1` (backend on the real files; a few seconds per field; no download). Fake movers (a Gaussian star with the header's FWHM, integrated over the pixels, as `calibrate_real.mjs`) are added to the real frames along straight paths of **known velocity**, at three brightnesses (15, 26 and 50 times the detector's own noise) and three speeds (4, 10 and 30 ″/yr), 100 per cell, 900 per field; the unchanged detector runs; for each recovered fake `z = (measured − true) / error` per axis. If the error is right, 68 % of the z are inside ±1, 95 % inside ±2 and the median of |z| is 0.67. Then the empty-field control: 300 copies of the field with every frame rotated/mirrored and shifted at random, so no correspondence is left and any candidate is false by construction. The error budget itself (`features/uncertainty.js`): the reported error is the quadrature sum of a statistical part (S/N of the dots), an excess-scatter part (the dots scatter more than their errors say) and the systematic floor of 15.1; `test_uncertainty.mjs` checks that the three parts rebuild the reported number.

**Bright fakes only (50 × noise; the fainter ones are mostly "found" by a chance line near their path):**

| Field | Images (passes) | Found, 10″/yr | Found, 30″/yr | Inside 1σ | Inside 2σ | Median \|z\| | Beyond 3σ (all brightnesses, one axis) | Empty copies that list a candidate |
|---|---|---|---|---|---|---|---|---|
| Barnard D2 | 15 (4) | 85 % | 82 % | **61 %** | **83 %** | 0.77 | **13 %** | 0 % (0/300) |
| Barnard D6 | 6 (3) | 84 % | 82 % | 82 % | 91 % | 0.30 | 7 % | **11 %** (34/300) |
| Epsilon Indi B D2 | 11 (5) | 87 % | 89 % | 75 % | 90 % | 0.54 | 8 % | 0 % (0/300) |
| Epsilon Indi B D6 | 6 (4) | 73 % | 72 % | 75 % | 93 % | 0.60 | 3 % | 1 % (4/300) |
| WISE 0855 D2 | 6 (4) | 86 % | 82 % | 72 % | 89 % | 0.58 | 6 % | 2 % (6/300) |
| WISE 0855 D6 | 6 (3) | 81 % | 88 % | 75 % | 95 % | 0.55 | 1 % | **13 %** (40/300) |

What this says:

- **In the core the error is about right in four of six fields:** Epsilon Indi B D2 and D6 and WISE 0855 D2 and D6 have a median |z| of 0.54-0.60 (0.67 expected) and 72-75 % of bright fakes inside 1σ. In **Barnard D6 it is too large** (median |z| 0.30, 82 % inside 1σ).
- **In Barnard D2 it is too small:** 61 % inside 1σ, 83 % inside 2σ, 13 % of all axes beyond 3σ, and a fake that is found at all is found more than 3σ (both axes together) from the true velocity 22 % of the time. Barnard D2 is the field with a saturated star and 15 images; the cause was **not** found, so the error of a candidate there should be read as optimistic. The error model was **not changed** by this test.
- **The tails are heavy everywhere** (1-13 % of axes beyond 3σ, rms of z 1.0-2.2 for bright fakes against 1 expected): a Gaussian error bar understates the chance of a large miss. Using only the statistical part of the error (the "nominal" error of the budget) is worse still in every field (rms of z 1.3-10 over all recovered fakes, against 1.0-5.6 with the calibrated error), so the added parts are needed, but they are not enough for the tails.
- **Failure rates are large for faint and slow movers, by design of the grid:** 77-80 % of all 900 fakes per field are not found (0-2 % at 15 × noise; 0-20 % at 26 × noise; at 4″/yr almost none unless the fake is bright and the field has 5 passes: Epsilon Indi B D2 65 %, D6 37 %, the others 1-12 %). A false candidate besides the fake appears in 0-2 % of the runs.
- **The empty-field control agrees with section 10** (same method, a different seed offset): 0, 0, 1, 2, 11 and 13 % of empty copies list a candidate with the default rule, the two bad fields being the two with only 3 survey passes and 6 images. **The "significance" of such a false candidate is not small: up to 143σ** (Barnard D6), 108σ (WISE 0855 D6), 72σ, 57σ. A significance in σ says how far the line is from a still star; it says nothing about whether the line is real. That is what the "chance lines expected" number is for.

Limits: Gaussian fakes with the header's FWHM, not the real PSF; the stars supply their own pointing shifts; no real variable stars or clustering in the empty copies (they are destroyed); 49 × 49 px cutouts of six field-detector pairs; one seed; Barnard D2 de-duplicated (15 images). A found fake counts when its path is within 1.5 px of the truth, which at 4″/yr (0.65 px/yr) lets a chance line near the path pass for it, so the 4″/yr "found" cells say little.
