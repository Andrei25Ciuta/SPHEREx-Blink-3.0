"""Show how bilinear interpolation changes the existing aperture error estimate.

Synthetic independent Gaussian input pixels, not a calibrated SPHEREx noise
model. Run with backend/requirements-dev.txt installed. This is a diagnostic,
not a test of absolute astronomical uncertainty.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from spherex.cutout import _bilinear  # noqa: E402
from spherex.photometry import aperture  # noqa: E402


def main() -> None:
    rng = np.random.default_rng(73)
    yy, xx = np.indices((33, 33))
    for shift_x, shift_y in [(0.0, 0.0), (0.25, 0.4), (0.5, 0.5)]:
        fluxes, reported_errors = [], []
        for _ in range(1500):
            raw = rng.normal(0, 1, (35, 35)).astype(np.float32)
            sampled = _bilinear(raw, xx + shift_x + 1, yy + shift_y + 1)
            flux, error = aperture(sampled, 16.5, 16.5, 2.0)
            fluxes.append(flux)
            reported_errors.append(error)
        empirical = float(np.std(fluxes, ddof=1))
        nominal = float(np.mean(reported_errors))
        print(f"shift=({shift_x:.2f}, {shift_y:.2f}): "
              f"empirical flux scatter={empirical:.3f}, "
              f"mean reported error={nominal:.3f}, ratio={empirical / nominal:.2f}")


if __name__ == "__main__":
    main()
