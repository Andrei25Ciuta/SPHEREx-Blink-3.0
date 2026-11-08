"""Where the images are on the sky: the footprint of every indexed file, from its own WCS.

The sky explorer of the page draws these. Nothing here is invented or looked up: a footprint is the four corners of one image (its edges, pixel -0.5 to n - 0.5) taken through
the celestial WCS of the file that is on this machine, so the map shows exactly the files that exist and nothing of the rest of the survey. The answer carries NO path and
NO file name (an opaque id instead): the files are not published, and their names carry pipeline versions.
"""

from __future__ import annotations

import hashlib

import numpy as np

from .query import FrameFile


def footprint(f: FrameFile) -> dict | None:
    """One image: id, detector, date, wavelength range, size, the centre and the four corners (ICRS degrees, RA in [0, 360)). None if the WCS cannot place the corners."""
    ny, nx = f.shape
    pix = [[-0.5, -0.5], [nx - 0.5, -0.5], [nx - 0.5, ny - 0.5], [-0.5, ny - 0.5], [(nx - 1) / 2, (ny - 1) / 2]]
    try:
        sky = np.asarray(f.wcs.all_pix2world(pix, 0), dtype=float)
    except Exception:  # noqa: BLE001 – a file whose WCS fails must not break the list of the others
        return None
    if not np.all(np.isfinite(sky)):
        return None
    sky[:, 0] %= 360.0
    corners = [[round(float(ra), 6), round(float(dec), 6)] for ra, dec in sky[:4]]
    centre = [round(float(sky[4, 0]), 6), round(float(sky[4, 1]), 6)]
    return {
        "id": hashlib.sha1(f"{f.path.name}|{f.mjd:.6f}".encode()).hexdigest()[:10],
        "detector": f.detector,
        "mjd": round(f.mjd, 6),
        "dateISO": f.date_iso,
        "wavelengthMinUm": round(f.wave_min_um, 4),
        "wavelengthMaxUm": round(f.wave_max_um, 4),
        "pixels": [nx, ny],
        "pixelScaleArcsec": round(f.pixel_scale_arcsec, 4),
        "widthArcmin": round(nx * f.pixel_scale_arcsec / 60.0, 3),
        "centre": centre,
        "corners": corners,
    }


def footprints(frames: list[FrameFile], detector: str = "all") -> list[dict]:
    """The footprints of the frames (of one detector, or all), in time order; a frame that cannot be placed is left out."""
    out = []
    for f in sorted(frames, key=lambda g: g.mjd):
        if detector != "all" and f.detector != detector:
            continue
        fp = footprint(f)
        if fp is not None:
            out.append(fp)
    return out
