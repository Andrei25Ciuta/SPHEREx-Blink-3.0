# SPHEREx Blink

> **Notice:** this repository is a **personal practice / mock project** (built with AI assistance, Claude Code), started on 2026-11-05, **before** the NASA Space Apps 2026 hackathon (14-15 Nov 2026). It is not a competition submission.

![Blink and difference of a synthetic field: stars stay, the brown dwarf moves. Labelled SYNTHETIC DATA - NOT SPHEREx](docs/img/demo.gif)

*Blink and difference of a **synthetic** field (invented data, **not** SPHEREx; the label is on every frame). Made by `scripts/make_demo_gif.py`.*

**NASA Space Apps Challenge 2026 – "Planet X and SPHEREx".**
Enter a sky position → see NASA SPHEREx infrared images of that spot taken on different
dates, flipped like a mini-video ("blinking"). Stars stay still; things that **move**
(nearby brown dwarfs, fast stars, asteroids) or **change brightness** stand out.

## What it does

| Feature | How it helps find moving objects |
|---|---|
| **Blink** | Same detector, different dates, one after another (play/pause, speed, frame slider, ← →). |
| **Difference** | Each image minus the median of images from *other* survey passes: still stars vanish, orange = "it is here now", blue = "it was here before / faded". |
| **Stack** | Average of all dates: deeper, less noisy picture. |
| **Trail** | Brightest value of each pixel over all dates: a mover leaves a **trail of dots**. |
| **Compare** | You pick **image A** and **image B** (single images, or a whole survey pass averaged) and an operation: **A − B** (orange = brighter in A, blue = fainter in A: a mover is an orange dot next to a blue one, still stars vanish) or **A + B** (average, a deeper picture). Starts at "latest pass − earliest pass". Note: other dates are also other wavelengths, so bright stars can leave a faint leftover. |
| **Find movers** | One button: finds the dots in every image, links them across survey passes and lists the ones that **moved**, best first (speed in ″/yr, direction, position, how many images, significance, and **how many chance lines like it are expected in the field**: a candidate is kept only if that is below 1). With the **Use all detectors** box ticked the images of every detector go into one line fit. Each candidate also says whether its path is supported in every image (the S/N at the predicted spot, found dot or not) and warns when another source sits inside the measuring circle. Click one to see its path on the blink; objects from the test list (and SIMBAD objects, with real data) are labelled "(known)"; **Check in sky map** opens the map on it. Details and limits: see below. |
| **Find everything** | The button under *Find movers*: lists **every source** in the images on screen, not only movers. Each is measured in every image (its spectrum), vetted (edge, flagged pixels, the halo of a brighter star, a blend, too few detections), cross-matched with **SIMBAD, Gaia DR3, 2MASS and AllWISE at each catalogue's own epoch** (proper motion carried to the image date) and with SkyBoT, scored (a documented sum, not a probability) and classed: *in a catalogue*, *in a catalogue and moving*, *known Solar System body*, *possible artefact*, **unknown: needs checking** or *unknown, weakly supported*. Nothing is hidden: a filter and a sort choose what to look at; a click opens the **dossier** (small pictures in several images, position, motion, support, catalogue matches, flags, what to check next) and draws the source's path on the blink. Save the table (CSV / JSON), a dossier (Markdown) or a source's positions (CSV; **not** an MPC/ADES report). On the six real fields it explained all 42 sources, and says in its own limits what that does not prove: [docs/VALIDATION.md](docs/VALIDATION.md) §14. With synthetic data there is no real sky to check against and every source stays "not checked". |
| **Spectrum along its path** | For a candidate, measures it **where it is on each image's date** (not at one fixed spot) and plots flux against wavelength (in Jansky with real data). A colour hint compares the flux at 4–5 µm with 1–2 µm: star-like, neutral, red (a warm asteroid or a cool brown dwarf) or very red (a cold brown dwarf). It is a hint on uncalibrated aperture sums, and it says so when the pixels are flagged (a very bright star can overflow the detector) instead of guessing. |
| **Look for a distant body** (Planet X mode) | A body hundreds of AU away is not a straight-line mover: as the Earth goes round the Sun it swings back and forth (412″ per 1 AU / 500 AU). This button tests every triple of dots from three survey passes for "the middle one is displaced exactly as the Earth's motion predicts, for some distance" and lists the bodies that follow it, with a distance and range, the body's own drift, and whether that is a speed a body bound to the Sun can have. The synthetic demo has a **simulated** body at 600 AU: press the dashed **Planet X (simulated)** chip, then the button. Images of several fields are joined into one plane, so a body that swings out of one cutout is followed into the next. **Honest status:** the distance fit recovers a real dwarf planet (Makemake, 52.65 AU against 52.62 AU from JPL Horizons) when told where to look, but in a **blind**, fair test on real Makemake images (cutouts not centred on it) the app's default options found nothing; loosened options found it, as one of 38 candidates, and an empty field gives about 33 chance candidates ([docs/VALIDATION.md](docs/VALIDATION.md) §12). A candidate resting on 5 dots or fewer carries a caution. Details and limits: [docs/VALIDATION.md](docs/VALIDATION.md) §5. |
| **Known asteroids** (real data) | Tick "Known asteroids (SkyBoT)": the known asteroids and comets inside the field are drawn as amber diamonds **at the date of each image** (a main-belt asteroid crosses a 5′ field in about half a day, so it is a different dot in every image and can never be linked over months). After *Find movers*, a candidate sitting on a known body says so. IMCCE's SkyBoT answers directly to the browser (no backend proxy). |
| **Export** | After a search, **Save list (CSV / JSON)**: one line per candidate (position, motion, significance, distance, known object, asteroid check) with a column saying whether the data is real or **synthetic** and a link back to the exact view. |
| **Tour** | "Take the 1-minute tour": eight coach marks over the workspace; works offline, changes nothing. |
| **Sky map: country overhead** | The box in the corner of the sky map gives the sky coordinates under the cursor (or of the centre) and, in brackets, **the country that sky point is straight above right now** (latitude = Dec, longitude = RA − sidereal time; it moves west 15° an hour). Over water: the distance to the nearest coast. Borders: Natural Earth 110 m via `world-atlas`, loaded from a CDN when the map opens. It is not where SPHEREx is. Details: [docs/VALIDATION.md](docs/VALIDATION.md) §9. |
| **Real-data results page** | [`frontend/results.html`](frontend/results.html): what the detector did on real SPHEREx images, as **numbers and charts only** (no image, no pixel): blind runs, chance lines, the bad-pixel fix, the Jansky scale, an asteroid that moved, WISE 0855, Makemake. The failures (the blind Planet X search found nothing) are on the same page as the successes. Data in `frontend/data/real_results.json`. |
| **Predicted position** | For the test objects, cream ticks show where the catalogue (SIMBAD position + proper motion) says the object must be on each frame's date, plus how far it moves in pixels. If the object sits on the ticks, the whole chain (archive → cutout → orientation → timing) is right. |
| **Catalogue stars** (real data) | Tick "Catalogue stars (SIMBAD)": the catalogued objects of the field are drawn as small teal rings, **moved to the date of each image** with their catalogue proper motion; those moving more than 1″/yr also get their name and path. SIMBAD positions are for the year 2000, so fast movers are searched in a wider circle (Barnard's Star is 4.5′ from its year-2000 spot). The same list lets **Find movers** say "(known)" for any SIMBAD object, not only the 5 test objects. Off with synthetic data (invented stars would not match SIMBAD). |
| **All detectors** | One averaged thumbnail per detector (D1–D6, 0.75–5 µm); click to blink it. |
| **Measure** | Click a source → its **spectrum** (brightness vs wavelength, per survey pass) and **light curve** (brightness vs date, per detector), plus a table. |
| **Flags** | Show flagged pixels in red (a legend says what the red means: bad pixels, not "known source"); optionally skip frames with > 1 % flagged pixels. |
| **Sky context** | Aladin Lite map of 2MASS / AllWISE / DSS2 with SIMBAD objects and the blink field outlined. Old surveys show where a fast mover *was* decades ago. A **Full screen** button gives the map the whole screen (Esc leaves it). |
| **Share** | Save the current image (PNG), record the blink as a video (WebM), copy a link that restores the exact view (`?ra=&dec=&fov=&det=&mode=`). |
| **Embed** | "Embed code" copies an `<iframe>` snippet for another web page. `?embed=1` shows only the workspace (no banner, About or footer) and keeps a one-line note saying what the data is. |
| **Test objects** | Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis – SIMBAD positions propagated with proper motion to the SPHEREx era. |

Accessible: keyboard shortcuts, ARIA labels/live regions, visible focus, reduced-motion
respected (no auto-play), colour-blind-checked chart palette, table view of all numbers. A script audit at phone, tablet and projector
sizes (touch targets, text size, contrast) and what it did **not** check (screen reader, real phone, other browsers):
[docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).

### How "Find movers" works (and what it cannot do)

1. **Detect** dots in each image of the chosen detector (peaks above 5 σ, centred to sub-pixel accuracy).
2. **Link**: two dots from two *different survey passes* define a straight line (position = start + velocity × time). A line counts only if dots from **at least 3 passes** and from at least 60 % of the images lie on it (two points always make a line; a third pass is the proof). Still stars are found first (zero velocity); movers are lines whose velocity is significantly different from zero (≥ 6 σ and at least ~1 pixel of total motion).
3. **Report** the movers, best first. Checked by `scratch/test_movers.mjs`: on the mock sky it finds the planted mover in 35 of 39 fields with no false candidates, and re-discovers Barnard's Star and WISE 0855 on their real catalogue speeds.

With **real data** it works on the real float pixel values the backend serves (`dataUrl`), not on the 8-bit pictures, and first registers the images on the field stars (every exposure has its own pointing error, up to ~0.7 px between passes). A bad-pixel mask from the FLAGS plane (`maskUrl`) lets it fit the position of a saturated star from its unflagged pixels only. With synthetic data it uses the 8-bit pictures of the player.

Instead of a fixed significance threshold it estimates the **false alarms**: the number of lines this good that the dots of the field would make by chance (pairs of dots tested × the binomial tail of the number of images that confirm the line). Lines with one or more expected chance lines are dropped, and the number is shown for every candidate.

Limits, on purpose for v1: it uses **positions only** (through SPHEREx's variable filter the same star has a different brightness in every image, so brightness says nothing about motion); motion below ~1 pixel (6″) over the whole period looks like a still star; a mover that blends with a bright star is missed; a very bright star saturates and its position is unreliable (see Validation); a dot too faint in one wavelength band is missed, so **try another detector**; it needs images from ≥ 3 survey passes about 6 months apart, otherwise the button says so.

### Validation on real data

Run blind on real SPHEREx cutouts (not in this repository), **Find movers** recovered Barnard's Star and Epsilon Indi B in all 4 single-detector runs and in both fields with the two detectors together; the measured motion is within 0.2-0.8 ″/yr of the catalogue. For Barnard in detector D2, where the core is saturated, it was first 3.7 ″/yr off; fitting the position from the unflagged pixels brought it to 0.3 ″/yr (a fix made after seeing the error, not an independent test). One run first gave **3 false candidates**, which led to a stricter rule; with the original rule their expected chance count is about 17 each, against at most 1e-4 for the real ones. The Jansky scale agrees with 2MASS and AllWISE stars to 2-10 %. The asteroid Arosa (V 14.6) is found in a real image 1.0″ from where SkyBoT predicts it and **shown to move**: absent from that spot 19.5 hours earlier, present 563″ away where SkyBoT puts it then. The colour hint gave "neutral" for the real brown-dwarf pair Epsilon Indi B and **cannot separate an M dwarf from an early T dwarf**. WISE 0855 is a **suggestive stack (0.4 mJy, 4.3× the control scatter), not a detection**. The Planet X distance fit recovers Makemake (52.65 against 52.62 AU) when told where to look; **the blind Planet X search did not find Makemake** in the first (biased) test, and in a fair one (11 cutouts of 30′ not centred on it) the app's default options found nothing while loosened options found it as **1 of 38 candidates, when an empty field gives about 33**. **Calibrated on the same real frames** (injected fake movers; scrambled "empty sky"): in a clean field one image finds a star down to about 0.6-0.9 mJy (50 % of the time; 20-30 × worse around a saturated star), a mover above that is recovered 70-98 % of the time once it moves more than about 0.8 pixel over the baseline, the "chance lines expected" number is conservative (a false candidate in 0-13 % of empty fields with the default rule, 94-100 % with the original rule that failed), and **a single exposure reaches V ≈ 17, so a Planet-Nine-like body (3-5 magnitudes fainter) is out of reach of single images**. Everything measured, how to re-run it and every limit: **[docs/VALIDATION.md](docs/VALIDATION.md)**. Material for presenting it: [docs/PITCH.md](docs/PITCH.md).

## Run – frontend only (mock data, no install)

```bash
py scripts/serve_frontend.py
```

Open http://localhost:8765 (or e.g. `/?ra=133.75976&dec=-7.24219&fov=5&det=D6&mode=diff`).
ES modules don't load from `file://`, so always serve over http.

> `scripts/serve_frontend.py` is `py -m http.server` plus a `Cache-Control: no-cache` header, so a normal reload picks up edited JS/CSS. With the plain `http.server` the browser may keep running old modules: use **Ctrl+F5**.

The mock invents a star field per position with one moving source and one variable star
(see `frontend/js/data/mockSource.js`). At a random position the mover is exaggerated
(12 px/yr) so the effect is obvious; at a **test object** the mover *is* that object and
moves with its **real** catalogue speed (WISE 0855: 1.3 px/yr). The header badge says **Synthetic demo data**.

### Public demo (GitHub Pages)

The frontend alone is a static site, so it can be published as a demo that runs on the synthetic data (no backend, no data files).
`.github/workflows/pages.yml` publishes only the `frontend/` folder. One-time setup after you push the repository to GitHub:
**Settings → Pages → Build and deployment → Source: GitHub Actions**; the next push to `main` deploys it.
The page labels itself "Synthetic demo data"; keep it that way until real SPHEREx data is wired in.
**Public demo (synthetic data):** https://mateibut.github.io/SPHEREx/ (live only after the repository is pushed and Pages is switched on as above; check it from a private window and on a phone before relying on it). Results on real data, numbers only: `results.html` on the same site.

**Sky map (section 4 of the page):** its survey pictures (2MASS, AllWISE, DSS2) come from the first of these that answers: ESA's public mirror of the CDS surveys (`skies.esac.esa.int`, no setup), our backend's relay of IRSA's copies (when the backend runs), CDS (Strasbourg) directly. Some networks block CDS; then only the first two give a picture (the catalogue circles show either way). The text under the map says which source is in use; "Re-centre sky map" checks again. Set `SKY_TILES` in `frontend/js/config.js` to force one source.

## Run – with the backend (Python 3.14, FastAPI)

One-time setup:

```bash
py -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
```

Test data – **fake** files (synthetic, NOT SPHEREx) until real ones are available.
They contain WISE 0855 moving with its real SIMBAD proper motion, computed with astropy
(independent of the frontend) – the app's green "predicted position" lands on it within
~0.2 px:

```bash
backend/.venv/Scripts/python.exe backend/scripts/make_test_fits.py
```

Real files go in `backend/data/real/` (any `*.fits` under `backend/data/` is indexed).
To fetch a first real SPHEREx cutout from IRSA (search first, download only after a `[y/N]` question, report saved for pasting), follow **[docs/REAL_DATA_TEST.md](docs/REAL_DATA_TEST.md)**: `backend/scripts/fetch_real_sample.py`.
Real files in `backend/data/real/` are served by the backend: open the frontend with **`?data=api`** (add `&api=http://localhost:PORT` if the backend is not on 8001; restart the backend after code changes), e.g. `/?data=api&ra=269.4462&dec=4.769&fov=3&det=D2` after downloading Barnard's Star.
Inspect a new file first and tick off [docs/DATA_CHECKLIST.md](docs/DATA_CHECKLIST.md):

```bash
backend/.venv/Scripts/python.exe backend/scripts/inspect_fits.py backend/data/real/FILE.fits
```

Start the backend:

```bash
backend/.venv/Scripts/python.exe -m uvicorn app:app --app-dir backend --port 8001
```

Then set `DATA_SOURCE = "api"` in `frontend/js/config.js` (`API_BASE = "http://localhost:8001"`).
Nothing else changes. http://localhost:8001/ also serves the frontend itself.

### API

| Endpoint | Returns |
|---|---|
| `GET /api/cutouts?ra=&dec=&fov=&det=` | `{ frames: Frame[] }` – contract in `frontend/js/data/getCutouts.js`; each frame also has `dataUrl`, the same pixels as raw little-endian float32, and `maskUrl`, one byte per pixel (1 = a BAD flag bit is set there, e.g. a saturated core; north up like the pixels) |
| `GET /api/photometry?ra=&dec=&det=&radius=` | `{ points: Point[] }` – aperture photometry per frame, in image units and (files in MJy/sr) in Jansky. For a **moving** object add `epoch_mjd=&pm_east=&pm_north=` (arcsec/yr): each frame is measured where the object is on its date |
| `GET /api/catalogue?cat=&ra=&dec=&radius=[&minpm=]` | `{ rows, truncated }` – known sources around a position for the cross-match of *Find everything*: `cat` is `2mass`, `allwise` or `gaia` (IRSA and ESA TAP; nothing else can be asked), `radius` in arcmin (at most 25), `minpm` (Gaia only) keeps stars faster than that many mas/yr. Answers are cached; `truncated` means the field was too dense for the 20 000-row limit |
| `GET /api/hips/<survey>/<file>` | IRSA HiPS sky tiles relayed with CORS (allowlist of 3 surveys) |
| `GET /api/health` | indexed files + files that could not be read |
| `GET /cutouts/<file>.png` | cached cutout / flag-mask PNGs |

How a cutout is made: find frames containing the position → resample each onto **one
north-up grid** (frames can be rotated differently on the sky) → subtract each frame's
median background → **one shared asinh stretch per detector** (so brightness is comparable
within a blink) → PNG, cached on disk. Delete `backend/cache/` if you change the
stretch/cutout code without bumping `STRETCH_VERSION`.

## Limitations

- The public demo runs on **synthetic** data; real SPHEREx images are used only on the author's machine (with the Python backend) and are not published. The page [`frontend/results.html`](frontend/results.html) shows what came out, as numbers only.
- **Find movers** needs images from at least 3 survey passes about 6 months apart, finds nothing that moves less than about 0.8 pixel over the whole period, uses positions only, and in a field with a saturated star it loses a factor of about 30 in sensitivity ([docs/VALIDATION.md](docs/VALIDATION.md) §10).
- **Planet X mode** works on bodies that single images can show (to roughly V 17, i.e. a 2-4 Earth-radius planet out to 150-270 AU); on real data the blind search found Makemake once, with loosened options, among about 33 chance candidates per field (§12), and a Planet-Nine-like body at 300-800 AU is 3-5 magnitudes too faint for it (§11).
- **Find everything** needs 3 individual detections of a fixed source: about 1.5 times shallower than one image (0.7-1.5 mJy in a clean field; a brown dwarf like WISE 0855 is below it), movers need about 50 times the noise, and the "needs checking" threshold lets through about 1 false lead per 21 empty fields on average (0.005-0.16 depending on the field). Nothing new was found by it; see [docs/VALIDATION.md](docs/VALIDATION.md) §14.
- Fluxes are quick aperture sums (2-10 % below catalogue magnitudes), not SPHEREx's calibrated photometry; WISE 0855 is a suggestive stack, not a detection.
- Candidates are leads, never discoveries. The licence and terms of use of the real data have not been reviewed (see [CREDITS.md](CREDITS.md)). Everything is listed in [docs/VALIDATION.md](docs/VALIDATION.md) §8.

## Tests

Frontend (Node, no install):

```bash
node scratch/test_coords.mjs
node scratch/test_mock.mjs
node scratch/test_measure.mjs
node scratch/test_movers.mjs
node scratch/test_compare.mjs
node scratch/test_catalogue.mjs
node scratch/test_spectrum.mjs
node scratch/test_parallax.mjs
node scratch/test_skybot.mjs
node scratch/test_export.mjs
node scratch/test_tour.mjs
node scratch/test_results.mjs
node scratch/test_skygeo.mjs
node scratch/test_discovery.mjs
node scratch/test_catalogue_relay.mjs
node scratch/test_discover_panel.mjs
```

More scripts need the backend and real files (they print a report; run them against a backend started with `SPHEREX_DATA_DIR` set to `backend/data/real`, so it serves only the real files; otherwise the synthetic frames at the same sky position get mixed in): `scratch/validate_real.mjs` (blind test of Find movers against SIMBAD; `--det all` for both detectors, `--relaxed 1` for the original rule), `scratch/validate_asteroids.mjs` (known asteroids against real cutouts), `scratch/validate_photometry.py` (Jansky scale against 2MASS/AllWISE stars), `scratch/stack_wise0855.py` (WISE 0855 stacked along its path, with control positions) and `scratch/real_parallax.mjs` (Earth-parallax fit and blind search on real Makemake cutouts; `scratch/find_body_frames.py` finds such images through JPL Horizons), `scratch/calibrate_real.mjs` (injection and recovery of fake movers, and the empty-sky calibration of the false-alarm number), `scratch/planet_x_limits.mjs` (what a single image can see, in magnitudes) and `scratch/fetch_body_cutouts.py` (plans and, after a yes, downloads off-centre 30′ cutouts around a moving body for a fair blind test); see [docs/VALIDATION.md](docs/VALIDATION.md). To remake the README GIF from the synthetic files: `backend/.venv/Scripts/python.exe scripts/make_demo_gif.py` (backend running).

Backend (pytest; synthetic FITS files made on the fly, no real data and no network needed):

```bash
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
backend/.venv/Scripts/python.exe -m pytest backend
```

143 tests cover `cutout` (north up / east left, rotated frames, edges, flags, the bad-pixel mask, bilinear resampling), `photometry` (including a moving object), `query` (headers, bad files, distortion that cannot be inverted), `stretch`, the `hips_proxy` allowlist and the `catalogues` relay (allowlisted catalogues only, range-checked numbers, CSV parsing, retries, cache, truncation; the network is replaced). The HTTP layer in `backend/app.py` is covered only through that last route, called as a function (`httpx`, which `TestClient` needs, is not installed). The browser-side modules have 480 checks in the Node tests above (the results page, which checks its data file against `docs/VALIDATION.md`, and the sky-map country readout, which uses a tiny invented world map, are among them).

`scratch/check_track.js` is a browser-console helper that measures, frame by frame, how far
WISE 0855 is from its predicted position (use it again on real data).

## Project layout

```
frontend/            static site, no build step (ES modules)
  js/main.js         wires UI ↔ modules
  js/player.js       blink player + difference / stack / trail maths
  js/data/           getCutouts.js (THE interface), mockSource.js, apiSource.js
  js/features/       movers.js (Find movers), parallax.js (Planet X mode), spectrum.js (colour hint), skybot.js (known asteroids),
                     compare.js (Compare A − B), catalogue.js (SIMBAD overlay), measure.js (spectrum + light curve), export.js (CSV / JSON),
                     tour.js (guided tour), skyContext.js (Aladin), fullscreen.js, exporters.js,
                     discovery.js + vetting.js + crossmatch.js + catalogueRelay.js + dossier.js + discoverPanel.js (Find everything)
backend/             FastAPI + astropy
  spherex/           query.py, cutout.py, stretch.py, photometry.py, flags.py, floatdata.py, cache.py, hips_proxy.py, catalogues.py
  scripts/           inspect_fits.py, make_test_fits.py, fetch_real_sample.py
  tests/             pytest suite
scripts/             serve_frontend.py (dev server for the frontend, no stale cache), make_demo_gif.py (README GIF, labelled synthetic)
scratch/             Node tests (test_*.mjs), validate_real.mjs, validate_asteroids.mjs and helpers
.github/workflows/   pages.yml (GitHub Pages demo), tests.yml (Node tests and pytest on every push)
docs/                VALIDATION.md (what was measured on real data), PITCH.md (3-minute script, slides, questions),
                     DATA_CHECKLIST.md, IRSA_FACTS.md, REAL_DATA_TEST.md, SUBMISSION.md, img/demo.gif
```

## Licence, credits & data

Code: [MIT](LICENSE). Full list of sources, third-party licences and how the project was made (with AI assistance): **[CREDITS.md](CREDITS.md)**. In short:

- **SPHEREx** – NASA/JPL-Caltech; data from the NASA/IPAC Infrared Science Archive (IRSA).
- **2MASS, AllWISE, DSS2** sky images – HiPS surveys made by CDS Strasbourg, served from ESA's public mirror (skies.esac.esa.int) or IRSA's copy (relayed by our backend); original data: UMass/IPAC-Caltech (2MASS), NASA/IPAC (AllWISE), STScI (DSS).
- **SIMBAD** – CDS Strasbourg, queried through its Harvard mirror.
- **Gaia DR3** – ESA/Gaia/DPAC, queried through the ESA Gaia archive TAP service by our backend; **2MASS** and **AllWISE** source catalogues – NASA/IPAC IRSA TAP, through the same backend relay (*Find everything*).
- **SkyBoT** – known Solar System bodies at a given date, IMCCE / Paris Observatory, queried from the browser (see CREDITS.md).
- **Aladin Lite** v3 (CDS) and **Plotly.js** – loaded from the jsDelivr CDN on demand.
- Test object coordinates: SIMBAD, with references in `frontend/js/targets.js`.
