"""Compare the local D6 API's photometry method with native IRSA FITS pixels.

Requires the three ignored Epsilon Indi B D6 files in docs/REAL_D6_REPLICATION.md.
This uses the original IMAGE plane, a separate WCS position and pixel-area
calculation, without calling the backend's cutout or aperture functions.
"""

from __future__ import annotations

import hashlib
import math
import sys
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from astropy.wcs.utils import proj_plane_pixel_area

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from spherex.photometry import measure  # noqa: E402
from spherex.query import read_frame_file  # noqa: E402

RA, DEC = 331.0969, -56.8007
FILES = {
    "spherex_SPHEREx-D6_60794.065_1.fits": "070d3e65bc79f7baa439726c79b1d8726670fc82f90d10c31862fcc72e872dfa",
    "spherex_SPHEREx-D6_61159.232_2.fits": "78fe9034175d1b813894641f23ae52026491af97a24886314c389ec1073b24f5",
    "spherex_SPHEREx-D6_61311.337_3.fits": "23272195aff7ba9ec81a1e0bdc48b276746d06071547f424c9cac9b9daf8bd2d",
}


def native_flux_jy(path: Path) -> tuple[float, float, int]:
    with fits.open(path, memmap=True) as hdul:
        image = np.asarray(hdul["IMAGE"].data, dtype=np.float64)
        header = hdul["IMAGE"].header
        if header.get("BUNIT", "").replace(" ", "") != "MJy/sr":
            raise AssertionError(f"Unexpected unit in {path.name}: {header.get('BUNIT')}")
        wcs = WCS(header).celestial
        x, y = wcs.all_world2pix(RA, DEC, 0)
        yy, xx = np.indices(image.shape)
        distance = np.hypot(xx - x, yy - y)
        aperture = image[np.isfinite(image) & (distance <= 2.0)]
        sky = image[np.isfinite(image) & (distance >= 4.0) & (distance <= 7.0)]
        if aperture.size < 8 or sky.size < 5:
            raise AssertionError(f"Insufficient native pixels in {path.name}")
        signal = float(aperture.sum() - aperture.size * np.median(sky))
        # Native WCS pixel area, in steradians. The backend computes its own
        # factor from the mean projected pixel scale.
        pixel_sr = float(proj_plane_pixel_area(wcs)) * (math.pi / 180) ** 2
        return signal * 1e6 * pixel_sr, float(np.std(sky, ddof=1) * math.sqrt(aperture.size) * 1e6 * pixel_sr), aperture.size


def main() -> None:
    paths = [ROOT / "backend" / "data" / "real" / name for name in FILES]
    for path, expected in zip(paths, FILES.values()):
        if not path.is_file():
            raise SystemExit(f"Missing ignored FITS input: {path}")
        with path.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != expected:
            raise AssertionError(f"Input hash changed: {path.name}")

    frames = [read_frame_file(path) for path in paths]
    backend = measure(frames, RA, DEC, 2.0)
    if len(backend) != len(paths):
        raise AssertionError("Backend did not return one measurement per archived frame")
    for path, point in zip(paths, backend):
        direct, noise, pixels = native_flux_jy(path)
        measured = point["fluxJy"]
        if not np.isfinite(direct) or direct <= 0 or measured is None or not np.isfinite(measured):
            raise AssertionError(f"No finite backend flux in {path.name}")
        difference = abs(direct - measured) / abs(direct)
        if difference > 0.10:
            raise AssertionError(f"Native and backend flux differ by {difference:.1%}: {path.name}")
        print(f"{path.name}: native={direct:.6g} Jy, backend={measured:.6g} Jy, "
              f"difference={difference:.1%}, native sky-noise proxy={noise:.3g} Jy, "
              f"backend fluxErr={point['fluxJyErr']:.3g} Jy, "
              f"aperture pixels={pixels}, backend flagged={point['flagged']}")


if __name__ == "__main__":
    main()
