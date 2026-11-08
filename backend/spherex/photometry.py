"""Aperture photometry at one sky position, on every frame that covers it.

Same algorithm as aperturePhotometry() in frontend/js/data/mockSource.js, so mock and
real behave alike: sum inside a circle of radius r (pixels) minus the median background
of a ring from r+2 to r+5 pixels; error from the ring's scatter. Units = image units
(BUNIT) times pixels. For real SPHEREx files (BUNIT = MJy/sr) the sum is also given in Jansky.

The object may MOVE: with `motion` its position is moved to each frame's date, so the
measurement follows it (that is how a moving object gets a spectrum).
"""

from __future__ import annotations

import math

import numpy as np

from .cutout import cutout, target_wcs
from .flags import bad_mask
from .query import FrameFile

ARCSEC_PER_RAD = 206264.806


def aperture(img: np.ndarray, x: float, y: float, r: float):
    """x, y in 'edge' pixel coordinates (pixel i spans [i, i+1)). Returns (flux, err) or None."""
    ny, nx = img.shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    d = np.hypot(xx + 0.5 - x, yy + 0.5 - y)
    finite = np.isfinite(img)
    inside = img[(d <= r) & finite]
    ring = img[(d >= r + 2) & (d <= r + 5) & finite]
    if inside.size == 0 or ring.size < 5:
        return None
    bg = float(np.median(ring))
    flux = float(inside.sum() - bg * inside.size)
    err = float(np.std(ring, ddof=1) * np.sqrt(inside.size))
    return round(flux, 4), round(err, 4)


# Real SPHEREx cutouts are resampled onto a common grid, so the noise of neighbouring pixels is correlated and a sum over a circle scatters more than the pixel scatter
# alone says. Measured on empty sky of the six real fields (scratch/check_photometry_noise.py, docs/VALIDATION.md 15.7): with the error taken from the ROBUST scatter of the
# ring, flux / err has a robust spread of 2.11 (1.67-2.25 by field). Synthetic noise is white: factor 1.
REAL_NOISE_FACTOR = 2.1


def robust_sd(values: np.ndarray) -> float:
    """1.4826 x the median absolute deviation: the scatter of the noise itself, not inflated by a faint source or the wing of a star in the ring."""
    med = float(np.median(values))
    return float(1.4826 * np.median(np.abs(values - med)))


def aperture_calibrated(img: np.ndarray, x: float, y: float, r: float, noise_factor: float = 1.0):
    """Like aperture(), with the error calibrated: the robust ring scatter x sqrt(pixels inside) x noise_factor (REAL_NOISE_FACTOR for real cutouts). (flux, err) or None."""
    ny, nx = img.shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    d = np.hypot(xx + 0.5 - x, yy + 0.5 - y)
    finite = np.isfinite(img)
    inside = img[(d <= r) & finite]
    ring = img[(d >= r + 2) & (d <= r + 5) & finite]
    if inside.size == 0 or ring.size < 5:
        return None
    bg = float(np.median(ring))
    return round(float(inside.sum() - bg * inside.size), 4), round(robust_sd(ring) * float(np.sqrt(inside.size)) * noise_factor, 4)


def position_at(ra: float, dec: float, motion: dict | None, mjd: float) -> tuple[float, float]:
    """Where a moving object is on a given date. motion = {epoch_mjd, pm_east, pm_north} (arcsec/yr)."""
    if not motion:
        return ra, dec
    years = (mjd - motion["epoch_mjd"]) / 365.25
    new_dec = dec + motion["pm_north"] * years / 3600.0
    new_ra = (ra + motion["pm_east"] * years / 3600.0 / math.cos(math.radians(dec))) % 360.0
    return new_ra, new_dec


def jansky_per_image_unit(frame: FrameFile) -> float | None:
    """Factor from 'image unit x pixels' to Jansky, or None if the unit is not a surface brightness in MJy/sr."""
    unit = (frame.bunit or "").replace(" ", "").lower()
    if unit != "mjy/sr":
        return None
    pixel_sr = (frame.pixel_scale_arcsec / ARCSEC_PER_RAD) ** 2
    return 1e6 * pixel_sr


def measure(frames: list[FrameFile], ra: float, dec: float, radius_px: float = 2.0, motion: dict | None = None) -> list[dict]:
    points = []
    for f in frames:
        f_ra, f_dec = position_at(ra, dec, motion, f.mjd)
        size = int(2 * (radius_px + 6))                      # just big enough for the ring
        tgt, npix = target_wcs(f_ra, f_dec, size * f.pixel_scale_arcsec / 60, f.pixel_scale_arcsec)
        img, flags = cutout(f, tgt, npix)
        res = aperture(img, npix / 2, npix / 2, radius_px)   # target is exactly in the centre
        c = npix // 2
        flagged = bool(flags is not None and np.any(bad_mask(flags[c - 2:c + 3, c - 2:c + 3])))
        jy = jansky_per_image_unit(f)
        cal = aperture_calibrated(img, npix / 2, npix / 2, radius_px, REAL_NOISE_FACTOR if jy else 1.0)
        points.append({
            "mjd": round(f.mjd, 6),
            "dateISO": f.date_iso,
            "detector": f.detector,
            "wavelengthUm": round((f.wave_min_um + f.wave_max_um) / 2, 4),
            "wavelengthMinUm": round(f.wave_min_um, 4),
            "wavelengthMaxUm": round(f.wave_max_um, 4),
            "flux": res[0] if res else None,
            "fluxErr": res[1] if res else None,
            "fluxJy": float(f"{res[0] * jy:.6g}") if res and jy else None,
            "fluxJyErr": float(f"{res[1] * jy:.6g}") if res and jy else None,
            # the error to REPORT: from the robust scatter of the ring, times REAL_NOISE_FACTOR on real cutouts (fluxErr above is kept as it was: the
            # plain ring scatter, 2.3 times too large on the real fields, see scratch/check_photometry_noise.py)
            "fluxErrCal": cal[1] if cal else None,
            "fluxJyErrCal": float(f"{cal[1] * jy:.6g}") if cal and jy else None,
            "flagged": flagged,
        })
    return points
