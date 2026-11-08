# Epsilon Indi B D6 workspace replication

On 2026-11-08, `backend/scripts/fetch_real_sample.py` queried the IRSA SPHEREx TAP
archive for Epsilon Indi B at RA 331.09625230°, Dec −56.80052316° and bandpass
`SPHEREx-D6`. The query returned 92 products across four survey passes. We
downloaded three 3-arcminute level-2 cutouts centered at RA 331.09691743°,
Dec −56.80074878°, from three dates. The FITS files stay in the ignored
`backend/data/real/` directory; they are not in Git or the public demo.

Reproduce the acquisition with Python dependencies from
`backend/requirements-dev.txt` installed and:

```text
python backend/scripts/fetch_real_sample.py --target epsindb --bandpass SPHEREx-D6 --download 3 --size-arcmin 3 --max-mb 20 --yes
```

| Observation (UTC) | IRSA cutout | SHA-256 of downloaded FITS |
| --- | --- | --- |
| 2025-04-29, MJD 60794.065 | [QR2 product](https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W18_1B/l2b-v20-2025-240/6/level2_2025W18_1B_0081_2D6_spx_l2b-v20-2025-240.fits?center=331.09691743,-56.80074878d&size=0.050000) | `070d3e65bc79f7baa439726c79b1d8726670fc82f90d10c31862fcc72e872dfa` |
| 2026-04-29, MJD 61159.232 | [QR2 product](https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2026W18_1A/l2b-v24-2026-124/6/level2_2026W18_1A_0457_2D6_spx_l2b-v24-2026-124.fits?center=331.09691743,-56.80074878d&size=0.050000) | `78fe9034175d1b813894641f23ae52026491af97a24886314c389ec1073b24f5` |
| 2026-09-28, MJD 61311.337 | [QR3 product](https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W40_1A/l2b-v27-2026-276/6/level2_2026W40_1A_0070_2D6_spx_l2b-v27-2026-276.fits?center=331.09691743,-56.80074878d&size=0.050000) | `23272195aff7ba9ec81a1e0bdc48b276746d06071547f424c9cac9b9daf8bd2d` |

All three files had an `IMAGE` HDU with celestial WCS, `MJy / sr` units,
`DETECTOR=6`, and observation times in their headers. `read_frame_file`
accepted each cutout. A local backend indexed the existing 17 Barnard D2
files and these three D6 files without an unreadable-file error. The D6
photometry endpoint returned three finite `fluxJy` points marked
`spherex_header`. At the catalogued position, the nearby peak was 3.8,
1.8, and 1.6 arcseconds from the expected track, each under one approximately
6.16-arcsecond pixel. This is a location sanity check, not a precision
astrometric measurement.

Run `scratch/browser_real_responsive.cjs` against a local backend serving
these files with `BLINK_REAL_FIELD=epsind-d6`. The test covers 320, 375, and
1280 CSS-pixel widths: loading three observed frames, provenance text,
timeline selection, difference mode, both paired cutouts, three measurement
rows, and a JSON export with finite fluxes and D6 detector labels. Without
that environment variable, it exercises the earlier Barnard D2 field.

These three selected cutouts validate the workspace data path for a second
field and detector. They do not establish blind mover recovery, calibrated
photometric accuracy, a survey-wide detection rate, or independent source
identification. Other detectors, fields, flags, and uncertainty calibration
still need dedicated checks.
