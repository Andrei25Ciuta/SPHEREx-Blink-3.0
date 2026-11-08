"""Aperture photometry at one sky position, on every frame that covers it.

Same algorithm as aperturePhotometry() in frontend/js/data/mockSource.js, so mock and
real behave alike: sum inside a circle of radius r (pixels) minus the median background
of a ring from r+2 to r+5 pixels; nominal error from the ring's scatter after
resampling, without pixel covariance, source noise or calibration terms. Units
= image units (BUNIT) times pixels. For real SPHEREx files (BUNIT = MJy/sr)
the sum is also given in Jansky.

The object may MOVE: with `motion` its position is moved to each frame's date, so the
measurement follows it (that is how a moving object gets a spectrum).
"""

from __future__ import annotations

import math

import numpy as np
from astropy import units as u

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
    try:
        factor = u.Unit(frame.bunit or "").to(u.Jy / u.sr)
    except ValueError:
        return None
    pixel_sr = (frame.pixel_scale_arcsec / ARCSEC_PER_RAD) ** 2
    return factor * pixel_sr


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
        points.append({
            "mjd": round(f.mjd, 6),
            "dateISO": f.date_iso,
            "detector": f.detector,
            "provenance": f.provenance,
            "wavelengthUm": round((f.wave_min_um + f.wave_max_um) / 2, 4),
            "wavelengthMinUm": round(f.wave_min_um, 4),
            "wavelengthMaxUm": round(f.wave_max_um, 4),
            "flux": res[0] if res else None,
            "fluxErr": res[1] if res else None,
            "fluxJy": float(f"{res[0] * jy:.6g}") if res and jy else None,
            "fluxJyErr": float(f"{res[1] * jy:.6g}") if res and jy else None,
            "errorModel": "resampled_sky_scatter",
            "flagged": flagged,
        })
    return points
