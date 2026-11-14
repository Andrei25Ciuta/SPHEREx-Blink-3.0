# Credits and sources

SPHEREx Blink is built on other people's data and software. This file lists all of it.
Our own code is under the [MIT licence](LICENSE); the items below keep their own licences.

## Data

| What | Where it comes from | Used for |
|---|---|---|
| **SPHEREx images** (real data, used on the author's machine only) | NASA/JPL-Caltech, SPHEREx mission; distributed by the NASA/IPAC Infrared Science Archive (IRSA), https://irsa.ipac.caltech.edu | Validation (see [docs/VALIDATION.md](docs/VALIDATION.md)): 60 small cutouts (Barnard's Star, Epsilon Indi B, WISE 0855, the asteroid Arosa and the dwarf planet Makemake), fetched with `backend/scripts/fetch_real_sample.py` into `backend/data/real/`, which git ignores. **They are not in this repository and not in the public demo**: the licence and terms of use of the data have not been checked. The results page (`frontend/results.html`) publishes only **numbers derived from them**, no pixels. IRSA's quick-release overview (read on 2026-11-07) asks users to cite the release DOI (10.26131/IRSA629 for QR1, 10.26131/IRSA652 for QR2, 10.26131/IRSA662 for QR3) and to include an acknowledgement, and the part of the page that was read states no other terms. **Still to do before submission:** copy IRSA's exact acknowledgement wording (the footer of the results page is in our own words) and match each of our images to its release (the file names carry pipeline versions v20-v25). The public demo runs on **synthetic mock data** made in the browser (`frontend/js/data/mockSource.js`) or on fake FITS files (`backend/scripts/make_test_fits.py`); neither is SPHEREx data. |
| **Ephemeris of Makemake** | NASA/JPL Horizons on-line solar-system data and ephemeris service, text API https://ssd.jpl.nasa.gov/api/horizons.api (no account or key) | `scratch/find_body_frames.py` asks where Makemake is and how far (geocentric distance) to pick the SPHEREx images that contain it, and `scratch/real_parallax.mjs` compares the fitted distance with Horizons' own. Not used by the app. |
| **Star catalogues for the Jansky check** | 2MASS Point Source Catalog (`fp_psc`) and AllWISE Source Catalog (`allwise_p3as_psd`), through IRSA's TAP service | `scratch/validate_photometry.py` compares aperture fluxes of isolated field stars with their catalogue magnitudes. The zero points used are written from memory in the script (Cohen et al. 2003 for 2MASS, Jarrett et al. 2011 for WISE) and must be checked before the numbers are quoted outside the project. |
| **Known Solar System bodies** | SkyBoT, IMCCE / Paris Observatory (https://ssp.imcce.fr/webservices/skybot/), queried from the browser with no account or key | The "Known asteroids" overlay and the asteroid check of Find movers. Check the service's page for the exact citation it asks for. |
| **Source catalogues for the cross-match** | **Gaia DR3** (ESA/Gaia/DPAC) through the ESA Gaia archive TAP service (`gea.esac.esa.int`), and the **2MASS** Point Source Catalog and **AllWISE** Source Catalog through IRSA's TAP service, all asked by our backend (`backend/spherex/catalogues.py`, which relays them because these services send no CORS headers) | *Find everything*: is a source in the images already catalogued? Only positions, proper motions, magnitudes and epochs of the sources around the field are read, and cached on the backend's disk. **Still to do before submission:** copy each archive's exact acknowledgement / citation wording (Gaia asks for a specific acknowledgement; not yet checked). Gaia's depth (about G 21) is from memory. |
| **Sky pictures** 2MASS, AllWISE, DSS2 | HiPS surveys made by CDS Strasbourg (P. Fernique, A. Oberto, T. Boch), served from ESA's public mirror (`skies.esac.esa.int`) or from IRSA's copy (relayed by our backend). Original data: 2MASS = University of Massachusetts and IPAC/Caltech; AllWISE = UCLA and JPL/Caltech, funded by NASA; DSS = Space Telescope Science Institute (see the `obs_ack` line in each survey's `properties` file for the full acknowledgement) | Section 4 of the page ("What is known here?") |
| **Country borders** | Natural Earth (public domain, from memory: check naturalearthdata.com) at 1:110 million, as TopoJSON in the npm package `world-atlas` 2.0.2 (by Mike Bostock; ISC licence, from memory: check), `https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json` | The country in brackets next to the sky coordinates on the sky map (`frontend/js/features/skyGeo.js`). Loaded by the visitor's browser when the map opens; **not stored in this repository**. Names and borders are Natural Earth's (disputed areas included) and are only approximate at this scale. |
| **Catalogue objects and test targets** | SIMBAD, CDS Strasbourg, queried through its Harvard mirror (`simbad.harvard.edu`). Positions and proper motions of the five test objects are in `frontend/js/targets.js`, each with its reference (`coordRef`) | The sky map, the quick-pick buttons, the predicted-position overlay and the "known object" label of Find movers |

Suggested acknowledgement lines (check the exact wording on each archive's page before the final submission):

- "This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France."
- "This research has made use of the NASA/IPAC Infrared Science Archive, which is operated by the Jet Propulsion Laboratory, California Institute of Technology, under contract with NASA."

## Methods taken from the literature

## Learn Mode educational sources

The Learn Mode lesson summaries and interactive facts use the following NASA educational and mission pages (retrieved 2026-11-14). Page illustrations are original schematic artwork and are not copies of NASA images.

- SPHEREx all-sky map and 102 infrared wavelengths: https://science.nasa.gov/open-science/spherex-universe-map/
- Infrared waves and infrared astronomy: https://science.nasa.gov/ems/07_infraredwaves/ and https://science.nasa.gov/mission/webb/science-overview/science-explainers/infrared-astronomy/
- Nebulae and star formation: https://science.nasa.gov/astrobiology/learning-resources/alp/how-did-our-solar-system-form/ and https://science.nasa.gov/universe/stories/quick-reads/decoding-nebulae/
- Galaxy types and ages: https://science.nasa.gov/universe/galaxies/
- Andromeda distance/type and halo star ages: https://science.nasa.gov/missions/hubble/nasas-hubble-shows-star-formation-in-andromeda-galaxy-winding-down/ and https://science.nasa.gov/asset/hubble/young-and-old-stars-found-in-andromedas-halo/
- Solar System planets: https://science.nasa.gov/solar-system/planets/ and https://science.nasa.gov/solar-system/solar-system-facts/

- **Position of the Earth** (Planet X mode, `frontend/js/features/parallax.js`): the low-precision Sun formula of J. Meeus, *Astronomical Algorithms* (2nd ed., Willmann-Bell, 1998), chapter 25, written from the published formula, then checked against known dates (solstice, perihelion, aphelion, J2000.0) in `scratch/test_parallax.mjs`.
- **Windowed centroid, upper-half sigma, aperture photometry with a background ring**: standard techniques, written for this project.
- **Greenwich sidereal time and first-order precession** (sky map country readout, `frontend/js/features/skyGeo.js`): Meeus, *Astronomical Algorithms*, equations 12.4 and 21.1, written from the published formulas and checked in `scratch/test_skygeo.mjs` against J2000.0 (280.4606°), 0h UT on 2000-01-01 (99.9678°) and Meeus' example 12.a (197.693195°).

## Software loaded in the browser (not copied into this repository)

| Library | Licence | Notes |
|---|---|---|
| **Aladin Lite** v3.6.5 (CDS) | **GPL-3.0** | Loaded unmodified from the jsDelivr CDN when the sky map opens. It is not bundled or redistributed here. Whether a page that loads a GPL library at run time must itself be GPL is a licensing question we have **not** settled; check it before choosing the final licence. |
| **Plotly.js** (basic bundle) 2.35.2 | MIT | Spectrum and light-curve charts, loaded from jsDelivr on demand. |
| **Three.js** r128 | MIT | Loaded from cdnjs on the Overview page for the optional illustrative 3D scene. |
| **Inter**, **Oswald**, **Space Grotesk**, **JetBrains Mono** | SIL Open Font License 1.1 | Loaded from Google Fonts. |
| **Playwright** 1.59.1 (test-only, `playwright` on npm) | Microsoft, Apache-2.0 | Drives a real browser in `scratch/browser_*.cjs` and in the advisory CI job `browser`. Installed outside the repository on every run (`npm install playwright@1.59.1`); nothing of it is shipped or served. Licence from the npm registry listing. |

## Adapted interface

The 3D Overview presentation, illustrative Earth, orbit and spacecraft model are adapted from [EmanuelGeorge-c/proiect-nasa](https://github.com/EmanuelGeorge-c/proiect-nasa), used under its MIT licence. Copy and component details were revised for Blink 3.0's documented behavior and data limits.

## Software in the backend

FastAPI (MIT), Uvicorn (BSD-3-Clause), Astropy (BSD-3-Clause), NumPy (BSD-3-Clause and others), Pillow (MIT-CMU), pytest (MIT, tests only). Licences read from the installed packages' metadata. If Astropy is used in a publication, please cite it as its authors ask: https://www.astropy.org/acknowledging.html

## Images

The header and page-background pictures are **our own work**: they are generated by `scratch/make_nebula.py` (noise and maths, no third-party pixels). They are decorative illustrations, not astronomical observations. An earlier version used a frame from a paid stock-footage clip; it was removed from the repository and is not published.

## How this project was made

Built by the author **with AI assistance (Claude Code, Anthropic)**. The repository was started on **2026-11-05**, before the NASA Space Apps Challenge 2026 weekend (14-15 Nov 2026), as a personal practice project. See the notice at the top of the [README](README.md).
