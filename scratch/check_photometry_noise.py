"""Is the flux error of the backend's aperture photometry right on REAL SPHEREx images?

    backend/.venv/Scripts/python.exe -I scratch/check_photometry_noise.py

backend/spherex/photometry.py measures a source in a circle and takes the error from the scatter of the pixels of a ring around it (std x sqrt(pixels inside)).
That is right for white noise. The real cutouts are resampled onto a common grid, so the noise of neighbouring pixels is correlated and a sum over a circle
scatters MORE than the pixel scatter says. This script measures that on empty sky: apertures at random places of the real cutouts of the six fields
(the same ones as scratch/check_astrometry_real.mjs), z = flux / err for each, and the robust spread of z (1.4826 x the median absolute deviation, so that the
few real faint sources inside some "empty" apertures do not count as noise). A right error gives 1. Needs backend/data/real (git-ignored, never published);
prints numbers only. No download.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("SPHEREX_DATA_DIR", str(ROOT / "backend" / "data" / "real"))

import numpy as np  # noqa: E402

from spherex.cutout import cutout, target_wcs  # noqa: E402
from spherex.photometry import aperture  # noqa: E402
from spherex.query import LocalArchive  # noqa: E402

FIELDS = [("Barnard", 269.4462, 4.769), ("Epsilon Indi B", 331.0965, -56.8006), ("WISE 0855", 133.7598, -7.2422)]
FOV_ARCMIN = 5.0
RADIUS_PX = 2.0
PER_FRAME = 150


def robust_sd(v: np.ndarray) -> float:
    med = np.median(v)
    return float(1.4826 * np.median(np.abs(v - med)))


def aperture_robust(img: np.ndarray, x: float, y: float, r: float):
    """The same aperture as the backend's, with the error from the ROBUST scatter of the ring (1.4826 x MAD): faint sources in the ring do not inflate it."""
    ny, nx = img.shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    d = np.hypot(xx + 0.5 - x, yy + 0.5 - y)
    finite = np.isfinite(img)
    inside = img[(d <= r) & finite]
    ring = img[(d >= r + 2) & (d <= r + 5) & finite]
    if inside.size == 0 or ring.size < 5:
        return None
    bg = float(np.median(ring))
    return float(inside.sum() - bg * inside.size), robust_sd(ring) * float(np.sqrt(inside.size))


def main() -> None:
    archive = LocalArchive()
    rng = np.random.default_rng(4242)
    pooled: list[float] = []
    pooled2: list[float] = []
    print("| field | detector | images | apertures | robust spread, error as in photometry.py | robust spread, error from the robust ring scatter |")
    print("|---|---|---|---|---|---|")
    for name, ra, dec in FIELDS:
        for det in ("D2", "D6"):
            frames = archive.find(ra, dec, det)
            z: list[float] = []
            z2: list[float] = []
            used = 0
            for f in frames:
                tgt, npix = target_wcs(ra, dec, FOV_ARCMIN, f.pixel_scale_arcsec)
                img, _flags = cutout(f, tgt, npix)
                if np.isfinite(img).mean() < 0.5:
                    continue
                used += 1
                got = 0
                for _ in range(4000):
                    if got >= PER_FRAME:
                        break
                    x, y = rng.uniform(9, npix - 9), rng.uniform(9, npix - 9)
                    res = aperture(img, x, y, RADIUS_PX)
                    if not res or res[1] <= 0:
                        continue
                    z.append(res[0] / res[1])
                    alt = aperture_robust(img, x, y, RADIUS_PX)
                    if alt and alt[1] > 0:
                        z2.append(alt[0] / alt[1])
                    got += 1
            if z:
                zz = np.array(z)
                pooled.extend(z)
                pooled2.extend(z2)
                print(f"| {name} | {det} | {used} | {len(z)} | {robust_sd(zz):.2f} | {robust_sd(np.array(z2)):.2f} |")
    if pooled:
        print()
        print(f"Pooled: {len(pooled)} apertures; robust spread of flux / err = {robust_sd(np.array(pooled)):.2f} as in photometry.py, {robust_sd(np.array(pooled2)):.2f} with the robust ring scatter")


if __name__ == "__main__":
    main()
