# Scientific scope

## Learn Mode and Astra

- Learn Mode diagrams are schematic illustrations and synthetic examples, not SPHEREx observations. The page labels them and links the astronomy summaries to NASA learning sources.
- The course contains eight short lessons and one progress check per level. These quizzes are not a validated measure of learning or mastery; XP, ranks, badges and streaks are motivational UI.
- Astra is a small offline glossary and curated response guide. It is not a generative AI model, does not answer unrestricted questions reliably, and does not send user text anywhere. Unsupported questions get a fallback instead of an invented answer.
- Progress and the classroom dashboard use local browser storage. There is no cloud backup, account, or cross-device teacher roster. If browser storage is disabled or cleared, progress may be lost.
- Science Mode's Explain Simply controls translate panel titles and known glossary terms into prepared summaries. They do not change analysis values, uncertainty, provenance or scientific status.

The default viewer generates synthetic frames. The results dashboard reads the saved real-data summary. Neither the navigation smoke test nor the offline module checks reproduce those observations.

The imported validation report documents the small field sample, limitations of quick aperture fluxes, and confusion in blind parallax searches. Its targeted Makemake distance fit and its blind recovery experiment answer different questions. Keep their evidence separate. See [the original validation methods and results](VALIDATION.md).

Blink in colours reuses the loaded frames and can centre them on a fitted candidate track. Exposures within a pass may differ in time as well as wavelength. Residual pointing errors, band-dependent PSFs, saturation and blends can also change the appearance. The coloured halo marks a local intensity-weighted centre from the stretched display, with a background and peak check. It is an illustration rather than calibrated chromatic astrometry, and a nearby source can bias it. When no measurement is available, a faint halo can indicate the predicted position.

The Planet X Lab uses synthetic Gaussian sources inserted into nine observed D2 cutout backgrounds in one field. Four trials per distance and flux setting give wide Wilson intervals. The recorded control fields yielded zero candidates in four runs, which is insufficient for a survey-wide false-positive claim. The Earth ephemeris and straight target drift are approximations. Profile distance intervals condition on the selected source association and model.

Photometry uses a small aperture and background annulus. Flux density conversion requires a FITS surface-brightness unit. The parser now respects SI prefix case, so MJy/sr and mJy/sr differ by a factor of one billion. Neither aperture correction nor absolute SPHEREx pipeline calibration is claimed.

The backend marks a frame synthetic when its header explicitly identifies a test file, SPHEREx-format when product header markers are present, and unverified otherwise. Header checks do not authenticate the download source. Mixed and unverified fields carry those labels in the workspace and exports. Cached cutout responses are rebuilt under a new cache key.

---

<!-- Everything below comes from the branch blink-2.0 of mateibut/SPHEREx, a second line of Blink 2.0 work that was merged into this repository on 10 Nov 2026. Where the two halves describe the same thing differently, they describe two different implementations: see docs/MERGE_NOTES.md. -->

# Scientific limitations

The short list. Every number and its test is in [VALIDATION.md](VALIDATION.md); §8 (known limits) and §14 (*Find everything*) are the long forms.
A candidate is a lead with its evidence, never a discovery. Nothing this application has produced is an unknown object.

## Data

- The public demo runs on **synthetic** data. Real SPHEREx cutouts (60 small ones: Barnard's Star, Epsilon Indi B, WISE 0855, the asteroid Arosa,
  Makemake) are used only on the author's machine and are not published; their licence and terms of use have not been reviewed ([CREDITS.md](../CREDITS.md)).
- Fluxes are quick aperture sums on background-subtracted cutouts, 2-10 % below catalogue magnitudes, **not** SPHEREx's calibrated photometry.
- Through SPHEREx's variable filter each image of a star has a different wavelength, so its brightness changes from image to image: movers are
  found from **positions only**, and any flat-spectrum assumption (injection tests, the "absent in other passes" transient tag) is an approximation.
- A cutout of all detectors together and one of a single detector are resampled differently; marginal results can differ between them.

## Overview illustration

- The Overview's procedural Earth, orbit, spacecraft, scan beam and starfield are decorative illustrations. They are not to scale and do not encode flight geometry, instrument specifications, live Earth imagery, telescope pointing, or SPHEREx observations. Only the separately labelled synthetic demo is synthetic image data; the 3D scene itself is not a data product.
- The Sky Explorer globe and its star field, grid and colored band are also decorative orientation graphics. Only the five labeled markers use the documented challenge target coordinates; the globe is not an all-sky survey image, coverage map, or live observation.

## Find movers

- Needs images from at least 3 survey passes about 6 months apart; motion below about 0.8 pixel (5″) over the baseline looks like a still star.
- In a field with a saturated star it is 20-30 times less sensitive; one image reaches about 0.6-0.9 mJy in a clean field.
- The "chance lines expected" number is conservative in the empty-sky tests; it is not a probability of being real.
- The leave-one-image-out check needs at least 4 detections spanning 4 survey passes. For each held-out detected image it refits a straight line from the other dots and measures aperture S/N at the predicted position; S/N ≥ 5 counts as supported. It reuses the detections that proposed the candidate, assumes a straight path and the existing image registration, and has only synthetic test coverage so far. A high count is consistency evidence, not independent confirmation or a probability that the source is real. It is not applied to the curved parallax candidates.

## Planet X mode

- Works on bodies single images can show (about V 17). A Planet-Nine-like body (300-800 AU) is 3-5 magnitudes too faint for it (VALIDATION §11).
- Blind test on real Makemake images: default options found nothing; loosened options found it as 1 of 38 candidates, while an empty field gives
  about 33 chance candidates (§12). A candidate resting on 5 dots or fewer carries a caution in the interface.
- The Earth's position is a low-precision formula; the spacecraft's own position is not used (not verified).

## Find everything

- It lists what the images show and what the catalogues explain. On six real 5′ fields all 42 sources were explained; **it found nothing new, and
  that test cannot say whether it would**.
- Depth: a fixed source needs 3 individual detections (about 0.7-1.5 mJy in a clean field); a mover needs about 50 times the detector noise;
  brown dwarfs like WISE 0855 (about 0.4 mJy in a stack) are below it. Stacking would go deeper and is not done.
- The "needs checking" threshold (support 65 and present in 30 % of the images of its passes) lets through about 1 false lead per 21 empty
  fields on average, from 0.005 to 0.16 depending on the field. The score is a sum of documented terms, not a probability.
- Near a very bright star many real sources are classed "possible artefact" (35-65 % of injected ones in the Barnard fields): conservative on purpose.
- Catalogue epochs for 2MASS and AllWISE are approximate; a cut-short catalogue answer or SIMBAD alone cannot call a source new.
- The positions CSV is not an MPC/ADES report.

## Viewer (zoom, pan, readout)

- Zoom enlarges the cutout's pixels (nearest neighbour, no smoothing): it adds no detail and never changes a measurement. Sky position under the cursor uses the same
  flat-sky formula as everything else (`geometry.js`); zooming and panning leave it exactly as it was (`test_view.mjs`).
- **The flat-sky mapping is not exact.** The images are TAN projections; the page maps RA/Dec with a flat approximation. Measured against the exact projection at the
  corner of a field (`scratch/test_grid.mjs`): 5′ cutout 0.002 px at Dec 5° and 0.035 px at Dec 60°; 30′ cutout 0.06 px at Dec 5° but **1.2 px at Dec 60°**. Fine for the
  5′ fields the app mostly uses; for a 30′ field far from the equator a position near a corner is good to about a pixel (6″), and the grid and the readout share that error.
- The **coordinate grid** is drawn on round values (RA in seconds of time, Dec in arcseconds or arcminutes) with the same flat mapping: a line is where the page believes
  that RA or Dec is, to the accuracy above. It is not a WCS from the FITS file. Near a pole the RA lines are left out.
- The **timeline** puts the images in time order (grouped by survey pass, not to scale inside a pass) and by wavelength; a "survey pass" is a run of images with no gap of 30 days or more
  (the rule Find movers uses). Its filter (a wavelength window, passes switched off) changes **only** what the blink visits and what Stack, Trail and Difference are made of:
  Find movers, Find everything, Compare, Measure and the exports always use every image. Difference with a filter takes its reference from the images of *other* passes that
  also pass the filter (fewer wavelength leftovers of bright stars); if none does, it falls back to all other passes. A Stack or Trail of a wavelength window is a picture made
  from a few images, deeper than one but not as deep as the whole set; it says "Stack of 3 of 18". Nothing here is calibrated across wavelengths.
- *Centre the picture on it* puts the candidate's position **on the image shown** in the middle (in Stack, Trail and Compare: the middle of its whole path) and zooms to at
  least ×6. It does not follow the candidate from image to image.
- The **value** in the readout is the pixel of the *cutout the backend made*: resampled onto a common grid (bilinear) and background-subtracted, in the file's own
  unit (its `BUNIT`, shown as is; "MJy/sr" for SPHEREx). It is **not** the original detector pixel and not calibrated photometry. A file without `BUNIT` shows no unit.
  Checked on one real frame (Barnard D2, frame 7 of 18, pixel 24,24: 680.2 and pixel 24,20: 4.206 read from the backend's float file with a separate script; the page showed 680 and 4.21).
- With **synthetic** data there are no float pixels: the readout shows the 8-bit *display level* (0-255 of the picture's stretch), which is not a physical value.
- The value is shown in Blink mode only; in Difference, Stack, Trail and Compare the picture is a combination of images, so no single value belongs to it.
- Pixel numbers count from 0 at the top-left of the cutout; the centre of the field is pixel 24 of a 49-pixel (5′) cutout.

## Errors of positions, motions and fluxes (Phase 4; VALIDATION §15)

- A **position** is a windowed centroid: no bias on average, but a **pixel-phase bias** of up to 0.05 px (0.3″) towards the centre of the pixel, because the PSF is smaller than a pixel.
  Bright stars therefore stop improving at about 0.04 px; the real scatter of bright fixed stars is 0.055 px. A fit of the PSF would do better and was not done.
- The **error of a position** is σ² = (1.05 / dot S/N)² + B² (B 0.014-0.036 px by PSF width). Right on injected stars (spread of z 1.00) and on real stars of S/N 20-60 (0.97);
  **too cautious by 1.5-1.8 times for faint real dots**, and 0.04 px too optimistic for bright ones, which a systematic floor of 0.04 px covers. A star positioned by the masked fit
  (a saturated core) gets 0.15 px, outside the model. The default assumes the narrowest PSF (the most cautious); real PSF widths vary with wavelength and are not passed in.
- The **error of a velocity** is propagated from the dots' errors; checked on injected movers (spread of z 0.89-0.96 for faint ones, cautious for bright ones). Before Phase 4 it was a fixed
  floor, 2-4 times too large, so every earlier "significance" of a mover is 2-4 times lower than the new one for faint stars (the candidates found are the same). On **Epsilon Indi B the measured
  motion is 0.5-0.65″/yr off the catalogue in RA in every run, 1.7-2.3 times its error**: a systematic (the photocentre of a binary brown dwarf moves with the orbit; or the instrument), not explained here.
- The **parallax search** (Planet X mode) still uses its old 0.15 px floor; its "σ" figures were not recalibrated.
- The **explainer** is rule-based: it says what the measured numbers say, in sentences whose figures are checked against the values they cite, and it cannot know anything that was not given to it (no catalogue knowledge of its own, no judgement of whether a number is plausible beyond the fixed thresholds in its rules: a chance above 0.001, support under 80 %, dots in under 60 % of the images, a χ² per degree of freedom above 3). A sentence being grounded does not make the conclusion true: a candidate is a lead.
- The **Solar System simulator** shows the eight planets from an approximate table (1800-2050, differences from JPL Horizons up to 0.013 AU for Saturn, VALIDATION 17), from above the ecliptic, without moons or small bodies; its educational mode is not to scale and says so; the body it can add does not move in space, so it shows the geometry of the swing, not an orbit.
- The **sky explorer** draws the footprints of the image files the backend holds (from their WCS), nothing of the SPHEREx survey; fields are images within 0.6 degrees of each other; the arcminute offsets of a field use the small-angle formula (cos Dec), fine for fields of a degree or less, not for a mosaic of many degrees.
- The **Planet X Lab** measures the app's own search with SYNTHETIC bodies injected into real images (Gaussian PSF of 0.4 px, the same flux in every image, a drift of 0.5-1.0 times the circular speed, a random place): a completeness of this search on these images, not a statement about any real object, and not a prediction of what SPHEREx will find. The map is for one field; with the cadence of the Barnard D2 field (passes 1 and 3 a year apart) three of the four passes see a distant body at nearly the same place, which probably limits the search (a hypothesis not tested by changing the cadence). The comparison of motions assumes 0.15 px per axis for every dot (the parallax search's floor, not calibrated on real dots), and its distance range is only as good as that and as the Earth's low-precision position (VALIDATION 16).
- A **PSF-fit centroid** exists (`psfFit`) and reaches the best possible on ideal injected stars, but on the real images it scatters more than the windowed centroid (the real PSF of the resampled cutouts is not a Gaussian of the header width): it is off by default and the reported position errors are those of the windowed centroid (VALIDATION 15.7).
- The **backend's photometry** (the spectrum and light-curve error bars): `fluxErr` (ring scatter) is 2.3 times too large on the real fields, `fluxErrCal` (robust ring scatter x 2.1) is right to about 20 % by field and is what the error bars use; the old field is kept for compatibility and `stack_wise0855.py`'s nominal error still comes from it (VALIDATION 15.7).
- The **flux** of an aperture is unbiased on injected stars (0.99-1.00). The error to report is 1.00 of the spread for white noise, and on real cutouts the noise is **1.7 times larger** than the
  scatter of single pixels says (robust spread of flux / err over 7 950 empty places: 1.68, per field 1.47-1.85: resampled cutouts have correlated noise, and the sky has faint sources). The S/N the
  searches use is unchanged (their thresholds were tuned with it): the honest error is a separate number, `± mJy` in the dossier.
- The `posErrArcsec` of a candidate is still dominated by the 1″ astrometric floor (the Arosa test), not by the measurement.

## Provenance and the candidate table

- A provenance record says **what a search was run with and when**; it does not say the result is right. The version labels (`movers-1`, `parallax-1`, `discovery-2`) are names the code
  gives itself, first written on 8 Nov 2026: a result made before that has none, and a code change that alters results without a new label would make a record misleading (the
  results page's test fails when the file's version differs from the code's).
- The time of a run is the **browser's clock**; the "settings" are the thresholds and options of the search, not every constant of the maths (the pixel stretch, the registration, the
  catalogue radii are in the code). "Images used" lists their detector and date, not their pixels.
- The plot of support against S/N shows the **median detector S/N** of a source's dots and the support score (a sum of documented terms, not a probability). A source with no
  S/N (no dots found) is only in the table. Both axes describe how well the images support a detection, not whether the object is new.
- The table of the six real fields (results page, section 11) lists **42 sources, every one explained by a catalogue**, as in VALIDATION §14. Positions and designations are derived
  numbers and public catalogue names; no pixel is published. It shows that the cross-match does not leave known stars unexplained; it cannot show what the tool would find that is new.

## Results page: what is made by a command and what is typed

- Sections 1-3 (the blind search on Barnard's Star and Epsilon Indi B, the chance lines, the bad-pixel mask) are remade by `scratch/make_results.mjs` on the images the backend holds on the day it runs: **a different set of images gives different numbers** (Barnard D2: 0.31 ″/yr with 15 images, 0.61 with 18). They are six runs on two fast stars: not a statistical survey, and the rules were tuned on these fields (the page says so).
- The false lines of the **original rule** are a record of the code of 7 Nov: today's code finds fewer dots per image and no longer produces them. Their numbers are typed and dated, not remade.
- Sections 4-6 are remade too (VALIDATION 19): the Jansky scale uses zero points written from memory; the Arosa centre offset (1.0″) and the explanation of the WISE 0855 D2 excess are still typed; Arosa is one asteroid in two images.
- Sections 7-10 (Makemake and the blind Planet X search, the fake-star calibration, the empty-sky test, the Planet X limits) are still the numbers of 7 Nov, typed from the reports of their commands; they do not move when the images do.

## A file loaded into the Results page

- The charts and numbers of a loaded file are **counts and ranges of its own rows**, drawn as they are. They say what is in the file, not that it is right: a candidate list is a list of leads, and the page repeats that for sources nothing explains. Nothing is checked against the images, which the page does not have.
- A file is told by what it contains, and only four kinds are read (the candidate JSON and CSV of the workspace, a list of sources, validation numbers). The candidate JSON keeps the strict check of the workspace: a list with a count that does not agree with its own fit points is **refused, not repaired**. A CSV has fewer fields than the JSON (no fit points, so no positions plot, and its run time is the file date when it has none, which the page says).
- The label of what the data is (real or synthetic) is read from the file and shown above everything; a candidate list that carries none of the known labels is refused, and a list of sources that says nothing about its data is shown as "data of unknown kind". **A label in a file can be edited by whoever edits the file**: the page shows it, it cannot prove it.
- The commentary of sections 1-12 was written for the archived run and is **hidden whenever another file is shown**; a validation file loaded by a person gets its charts with no commentary, and the charts it cannot draw are named as missing. A validation file lacking a section is not completed from the archived one.
- The sky map draws one degree of declination and of right ascension (times cos Dec) at the same length, from the positions in the file, with east to the left; a field larger than a few degrees would need a projection that is not used. The records of one file may come from several fields and then overlap on the map.
- Not checked automatically: the look of the page in each theme and on a phone was inspected by eye in the in-app browser (overflow checked by script); `a11y_audit.mjs` covers the Workspace only. The sources table of section 11 (existing) still has focusable points inside an `aria-hidden` picture.

## Duplicate files, and the reproducibility bundle

- **Until 10 Nov the backend counted three exposures of Barnard's Star in D2 twice** (byte-identical files). Every real-data result made with them treated Barnard D2 as 18 images instead of 15. Sections 1-6 of the results page were remade without them and reproduce the numbers of 7 Nov; sections 8 and 9 (and VALIDATION 10, 14, 16, 15.5) were not re-run and say so. An exposure counted twice is not an independent measurement: those Barnard D2 numbers are probably slightly optimistic.
- The backend now skips a file that is an exact copy of another (same detector, same time, same size, same SHA-1). It does not detect the same exposure saved with different pixels (another cutout, another resampling): two such files would both be used.
- A **reproducibility bundle** proves that two people have the same *pixels* (a SHA-256 of each image) and the same *settings*; it does not prove the images are the right ones, that the archive product is the one claimed (the backend does not report the IRSA product id: `productId` is null), or that the result is correct. The hash is of the bytes as the backend serves them (float32), so a different backend or resampling gives a different hash. Only *Find movers* is replayed by the script.

## The error of a velocity (VALIDATION §20)

- The error bar of a candidate's motion is a model: statistical + excess scatter + a systematic floor measured on stars. Tested with fake movers in the real images it is **too small in Barnard D2** (the true velocity inside 1σ for 61 % of bright fakes, 68 % expected), too large in Barnard D6, about right in four fields, and its **tails are heavy** (1-13 % of axes beyond 3σ). Read it as a guide to the size of the error, not as a probability.
- A large "significance" (σ) is not evidence that a line is real: false candidates of empty copies of a field reach 57-143σ. The "chance lines expected" number answers that question; it lets a false candidate through in about 1 empty field in 8 when there are only 3 survey passes and 6 images.
- Not in the budget: the pointing/WCS of each file, the PSF shape, confusion with a neighbour of the same brightness.

## Cancelling a search

- Cancel works only for the two searches that run in a worker (Find movers, the Planet X search). Find everything, the detection of dots (including the first stage of the Planet X search) and the text analysis run on the page and cannot be stopped. The time shown before a search is a range measured on synthetic images on one machine, not a promise.

## Which survey images cover a place (IRSA; VALIDATION §18)

- The list is **metadata of what IRSA has published** (a live query of `spherex.plane`, retrieved at the time the page shows): it changes weekly as the survey adds images, and it says nothing about whether an image is good. A row with a quality flag is listed, not filtered.
- "Covers" means the footprint polygon **contains the centre**; it does not say that the pixel there has valid data (an edge of the detector, a flagged pixel, a saturated star). It matched IRSA's own `CONTAINS` count at 7 of 7 comparable positions, which tests the geometry, not IRSA's table.
- At most 1000 images are listed. Where the survey is dense (R Draconis, near the ecliptic pole: 2483 images over one position) the list is cut off, oldest first; the page then says the real number of passes may be higher and gives no verdict for Find movers. A smaller circle does not help much, because an image is 3.5 degrees wide: the number that matters is the images over the point.
- Survey passes are the groups of images less than 30 days apart (the rule of Find movers); this is a working definition, not IRSA's. "Enough for Find movers" means at least 3 passes; whether they are about 6 months apart is for the dates shown.
- It needs the backend (IRSA sends no CORS headers): on the public synthetic demo the button is disabled and says so. The images found are not downloaded, and the viewer shows only images the backend holds as files.

## Workers, benchmarks and the end-to-end test (Phase 10)

- A search in a worker works on a **copy** of the pixels or the dots and returns a copy of the result; the page's own data are not changed by it. A worker that cannot run is
  replaced by the same task on the page, so the answer does not depend on it (`test_workers.mjs`), but the page then stops drawing for longer (Find movers: 396-499 ms against 15-28 ms in
  the measurement of BENCHMARKS.md, one machine, three runs). The detection of the dots and *Find everything* are not in a worker.
- The golden digests (`benchmark_baseline.json`) prove that three **synthetic** scenarios still give exactly the same output to 5 significant digits. They are not a validation (that is
  VALIDATION.md, on real data) and they say nothing about a change below the 5th digit. A new baseline is written only when a scientific change is meant, and the commit says so. The
  baseline was written on one machine (Node 24, Windows); the same digests came out in CI on Node 20.20.2 / Linux (10 Nov 2026), and no other Node version or system has been tried.
- The times in BENCHMARKS.md are medians of 3-5 runs on one machine; two runs of the same code differed by 20-25 %. They are for comparing a "before" and an "after" made the same way, not
  absolute figures.
- The end-to-end test uses the **synthetic** demo only. It shows that the main path works in one browser (Chrome); it does not test real data, the backend, other browsers, a touch screen
  or a screen reader, and it is a smoke test (15 checks), not a coverage of the page.

## Spectra

- The colour hint (flux at 4-5 µm over flux at 1-2 µm) cannot tell an M dwarf from an early T dwarf and is not a classification.
- Spectra are built from images taken at different times: a variable source mixes variability with spectral shape.

## Missions and the pin board

- Mission texts (Barnard's Star at about 10″/yr and 6 light-years, 1 AU ≈ 150 million km, d[pc] = 1/p[″], infrared and cold bodies) are textbook facts **written from memory**, not measured here. Mission completion is detected from the learner's clicks and from results appearing on the page; it shows the learner used the tool, not that they understood it.
- The pin tag reads "Discovered/Verified by <name>" at the author's request (14 Nov 2026). Scientifically a pin is still a candidate: the board says so, nothing is checked by anyone else, and synthetic-data pins say "(synthetic demo data)". Pins live in one browser's localStorage; nothing is shared between computers. The SHA-256 shows a pin was not edited afterwards in that browser; it is not a timestamped proof of priority (no outside witness).
