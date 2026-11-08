"""Turn float images into 8-bit PNGs.

For blinking, all frames of one detector must use the SAME brightness scale – otherwise
a star could look brighter just because the stretch changed. Background levels do change
between epochs (zodiacal light), so we first subtract each frame's own median background,
then compute one asinh stretch from all frames together.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from .flags import bad_mask

STRETCH_VERSION = 5      # bump when the algorithm/output changes -> invalidates the PNG cache (3: bilinear cutouts + float files; 4: + bad-pixel mask files; 5: + "unit" in each frame)
LOW_PCT, HIGH_PCT = 1.0, 99.7
ASINH_A = 0.1            # smaller = stronger boost of faint stuff


def shared_stretch(images: list[np.ndarray]) -> list[np.ndarray]:
    """Return uint8 arrays (same shapes). NaN pixels become black."""
    subtracted = []
    for img in images:
        bg = np.nanmedian(img) if np.isfinite(img).any() else 0.0
        subtracted.append(img - bg)

    pooled = np.concatenate([s[np.isfinite(s)].ravel() for s in subtracted] or [np.zeros(1)])
    if pooled.size == 0:
        pooled = np.zeros(1)
    lo, hi = np.percentile(pooled, [LOW_PCT, HIGH_PCT])
    if hi <= lo:
        hi = lo + 1.0

    out = []
    for s in subtracted:
        x = np.clip((s - lo) / (hi - lo), 0, 1)
        x = np.arcsinh(x / ASINH_A) / np.arcsinh(1 / ASINH_A)
        x = np.nan_to_num(x, nan=0.0)
        out.append((x * 255).round().astype(np.uint8))
    return out


def to_png(arr8: np.ndarray) -> bytes:
    """FITS row 0 is the BOTTOM of the image, PNG row 0 is the top -> flip vertically."""
    buf = io.BytesIO()
    # 2-D uint8 -> grayscale ("L") automatically; the `mode=` argument is deprecated in Pillow 11+.
    Image.fromarray(np.ascontiguousarray(np.flipud(arr8))).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def flags_to_png(flags: np.ndarray | None) -> bytes | None:
    """Transparent RGBA PNG, flagged pixels red. None if nothing is flagged."""
    if flags is None:
        return None
    on = bad_mask(flags)                       # only BAD bits (spherex/flags.py), not "any bit"
    if not on.any():
        return None
    rgba = np.zeros(flags.shape + (4,), dtype=np.uint8)
    rgba[on] = (255, 40, 60, 255)
    buf = io.BytesIO()
    Image.fromarray(np.ascontiguousarray(np.flipud(rgba))).save(buf, format="PNG", optimize=True)
    return buf.getvalue()
