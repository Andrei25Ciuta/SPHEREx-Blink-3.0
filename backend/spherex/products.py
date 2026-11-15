"""Shared product builder extracted unchanged from app.py; science stays identical."""
from collections import defaultdict
import numpy as np
from . import cache
from .cutout import cutout, flag_summary, target_wcs
from .floatdata import float_cutout_bytes, mask_cutout_bytes
from .stretch import flags_to_png, shared_stretch, to_png
MIN_VALID_FRACTION = 0.5


def build(frames, ra, dec, fov, scale, key, cache=cache, on_progress=None):
    tgt, npix = target_wcs(ra, dec, fov, scale)

    # Cut everything first, then stretch per detector (shared scale within a detector).
    cut = []
    for i, f in enumerate(frames, 1):
        img, flags = cutout(f, tgt, npix)
        if np.isfinite(img).mean() < MIN_VALID_FRACTION:
            if on_progress:
                on_progress(i, len(frames), 'cutout')
            continue
        cut.append((f, img, flags))
        if on_progress:
            on_progress(i, len(frames), 'cutout')

    by_det = defaultdict(list)
    for item in cut:
        by_det[item[0].detector].append(item)

    out = []
    completed = 0
    total = len(cut)
    for det_items in by_det.values():
        stretched = shared_stretch([img for _, img, _ in det_items])
        for (f, img, flags), arr8 in zip(det_items, stretched):
            i = len(out)
            mask_png = flags_to_png(flags)
            out.append({
                "mjd": round(f.mjd, 6),
                "dateISO": f.date_iso,
                "detector": f.detector,
                "provenance": f.provenance,
                "wavelengthMinUm": round(f.wave_min_um, 4),
                "wavelengthMaxUm": round(f.wave_max_um, 4),
                "imageUrl": cache.save_png(key, i, to_png(arr8)),
                # the same pixels as real numbers (float32, background-subtracted, north up): for detection
                "dataUrl": cache.save_bytes(key, i, float_cutout_bytes(img), "f32"),
                # 1 = a BAD flag bit is set here (a saturated core, hot pixels ...): the position of a bright star is fitted without them
                "maskUrl": cache.save_bytes(key, f"{i}_mask", mask_cutout_bytes(flags, img.shape), "u8"),
                "flags": flag_summary(flags),
                "flagsUrl": cache.save_png(key, f"{i}_flags", mask_png) if mask_png else None,
                "pixelScaleArcsec": round(scale, 4),
                # the unit of the float pixels (BUNIT of the file, e.g. "MJy / sr"), or None if the file does not say; the viewer's readout shows it
                "unit": f.bunit,
            })
            completed += 1
            if on_progress:
                on_progress(completed, total, 'products')
    out.sort(key=lambda fr: fr["mjd"])
    return out
