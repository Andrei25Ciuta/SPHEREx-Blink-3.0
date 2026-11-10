"""Find which SPHEREx frames cover a sky position.

Step 7: a LOCAL archive – every *.fits under DATA_DIR (default backend/data/) is indexed.
Step 8: replaced/extended by an IRSA query (SIA / TAP / cutout service – TBD, not guessed here).

Everything that depends on the real file layout is in the CONFIG block below, so that when
scripts/inspect_fits.py shows the real names we change them in ONE place.
"""

from __future__ import annotations

import os
import re
import hashlib
import threading
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.time import Time
from astropy.utils.exceptions import AstropyWarning
from astropy.wcs import WCS, NoConvergence
from astropy.wcs.utils import proj_plane_pixel_scales

# ------------------------------------------------------------------ CONFIG (ASSUMPTIONS)
DATA_DIR = Path(os.environ.get("SPHEREX_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))

IMAGE_HDU = ("IMAGE", 1)    # try EXTNAME first, then index. ASSUMPTION: science in HDU 1
FLAGS_HDU = ("FLAGS", 2)    # ASSUMPTION: bitmask in HDU 2

# Candidate header keywords, tried in order. Only the fake files' names are known to exist.
MJD_KEYS = ("MJD-OBS", "MJD-AVG", "MJD_AVG", "MJD-MID", "MJDMID", "MJD-BEG", "MJD")
DATE_KEYS = ("DATE-OBS", "DATE-AVG", "DATE-BEG")
DETECTOR_KEYS = ("DETECTOR", "DETNUM", "DET", "ARRAY")
WAVEMIN_KEYS = ("WAVEMIN",)          # µm
WAVEMAX_KEYS = ("WAVEMAX",)          # µm

# Used only if the header has no wavelength keywords. ASSUMPTION (rough SPHEREx bands, µm).
# NOTE: on real SPHEREx the wavelength changes ACROSS the detector (linear variable filter),
# so the correct value is the wavelength at the cutout position – see docs/DATA_CHECKLIST.md.
NOMINAL_WAVE_UM = {"D1": (0.75, 1.09), "D2": (1.10, 1.62), "D3": (1.63, 2.41),
                   "D4": (2.42, 3.82), "D5": (3.83, 4.41), "D6": (4.42, 5.00)}
# ---------------------------------------------------------------------------------------


@dataclass
class FrameFile:
    path: Path
    mtime: float
    mjd: float
    date_iso: str
    detector: str
    wave_min_um: float
    wave_max_um: float
    wcs: WCS                 # celestial WCS of the image HDU
    shape: tuple[int, int]   # (ny, nx)
    pixel_scale_arcsec: float
    image_hdu: int
    flags_hdu: int | None
    bunit: str | None = None  # e.g. "MJy / sr" (real SPHEREx): lets photometry give Jansky
    provenance: str = "unverified"


def _first(header, keys):
    for k in keys:
        if k in header and header[k] not in (None, ""):
            return header[k]
    return None


def _hdu_index(hdul, name, fallback):
    for i, h in enumerate(hdul):
        if h.header.get("EXTNAME", "").strip().upper() == name:
            return i
    if fallback < len(hdul) and getattr(hdul[fallback], "data", None) is not None:
        return fallback
    return None


def normalize_detector(value) -> str | None:
    """1, '1', 'D1', 'SPHEREx-D1' ... -> 'D1'."""
    if value is None:
        return None
    m = re.search(r"(\d+)", str(value))
    return f"D{int(m.group(1))}" if m else str(value)


def _wavelength_range_from_wcs(hdul, img_i) -> tuple[float, float] | None:
    """Wavelength band (um) at the image CENTRE, from the WCS-WAVE extension of real SPHEREx files.

    SPHEREx's filters are linear variable filters: the wavelength changes across the detector and
    from one exposure to the next, so every frame has its own band (seen on real cutouts of one
    detector: 1.10, 1.52, 1.66 um). Recipe from IRSA's tutorial: WCS(header, fobj=hdul, key="W"),
    sip = None, pixel_to_world(x, y) -> (wavelength, bandwidth). A 5-arcmin cutout is tiny next
    to the detector, so its centre is representative. None = no such WCS (fake files, other layouts).
    """
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", AstropyWarning)
            w = WCS(header=hdul[img_i].header, fobj=hdul, key="W")
            w.sip = None
            ny, nx = hdul[img_i].shape[-2:]
            wavelength, bandwidth = w.pixel_to_world(nx / 2, ny / 2)
        centre, width = float(wavelength.to_value("um")), float(bandwidth.to_value("um"))
    except Exception:  # noqa: BLE001 - any problem means "not available"; the caller has a fallback
        return None
    if not (0.5 < centre < 6.0 and 0 < width < 1.0):
        return None
    return centre - width / 2, centre + width / 2


def read_frame_file(path: Path) -> FrameFile:
    """Read only the headers (data is memory-mapped, not loaded)."""
    with fits.open(path, memmap=True) as hdul:
        img_i = _hdu_index(hdul, *IMAGE_HDU)
        if img_i is None:
            raise ValueError("no image HDU")
        flg_i = _hdu_index(hdul, *FLAGS_HDU)
        hdr = hdul[img_i].header
        # Keywords may live in the primary header instead – merge (image header wins).
        merged = hdul[0].header.copy()
        merged.update(hdr)

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", AstropyWarning)
            wcs = WCS(hdr).celestial
        if not wcs.has_celestial:
            raise ValueError("no celestial WCS")

        mjd = _first(merged, MJD_KEYS)
        date = _first(merged, DATE_KEYS)
        if mjd is None and date is None:
            raise ValueError(f"no time keyword (tried {MJD_KEYS + DATE_KEYS})")
        t = Time(float(mjd), format="mjd") if mjd is not None else Time(date)

        det = normalize_detector(_first(merged, DETECTOR_KEYS)) or "D?"
        wmin, wmax = _first(merged, WAVEMIN_KEYS), _first(merged, WAVEMAX_KEYS)
        if wmin is None or wmax is None:
            # Real SPHEREx files: per-frame band from WCS-WAVE; otherwise the rough nominal band.
            from_wcs = _wavelength_range_from_wcs(hdul, img_i)
            wmin, wmax = from_wcs or NOMINAL_WAVE_UM.get(det, (float("nan"), float("nan")))

        ny, nx = hdul[img_i].shape[-2:]
        scale = float(np.mean(proj_plane_pixel_scales(wcs)) * 3600)
        bunit = _first(merged, ("BUNIT",))
        bunit = str(bunit) if bunit is not None else None
        comments = " ".join(str(c) for c in merged.get("COMMENT", []))
        if "SYNTHETIC TEST FILE" in comments or any(
            "FAKE" in str(merged.comments[key]) for key in ("MJD-OBS", "DETECTOR", "WAVEMIN", "WAVEMAX") if key in merged
        ):
            provenance = "synthetic"
        elif "OBSID" in merged and "SPS_TARGET" in merged and "EXTTYPE" in merged:
            provenance = "spherex_header"
        else:
            provenance = "unverified"

    return FrameFile(path=path, mtime=path.stat().st_mtime, mjd=float(t.mjd),
                     date_iso=t.utc.isot[:19] + "Z", detector=det,
                     wave_min_um=float(wmin), wave_max_um=float(wmax), wcs=wcs,
                     shape=(ny, nx), pixel_scale_arcsec=scale,
                     image_hdu=img_i, flags_hdu=flg_i, bunit=bunit, provenance=provenance)


class LocalArchive:
    """Index of the FITS files under DATA_DIR. Re-reads a file only when it changed."""

    def __init__(self, root: Path = DATA_DIR):
        self.root = root
        self._index: dict[Path, FrameFile] = {}
        self._errors: dict[Path, str] = {}
        self._dups: dict[Path, Path] = {}                 # a file that is a byte-for-byte copy of another -> the file that is used
        self._digests: dict[Path, tuple[float, str]] = {}  # (mtime, sha1) so that a copy is recognised without reading the file again
        self._lock = threading.Lock()

    def refresh(self):
        with self._lock:
            paths = {p for ext in ("*.fits", "*.fits.gz", "*.fit") for p in self.root.rglob(ext)}
            for gone in set(self._index) - paths:
                del self._index[gone]
            for p in paths:
                old = self._index.get(p)
                if old and old.mtime == p.stat().st_mtime:
                    continue
                try:
                    self._index[p] = read_frame_file(p)
                    self._errors.pop(p, None)
                except Exception as exc:  # noqa: BLE001 – a bad file must not break the API
                    self._errors[p] = str(exc)
                    self._index.pop(p, None)
            self._find_duplicates()

    def _sha1(self, p: Path) -> str:
        mtime = p.stat().st_mtime
        hit = self._digests.get(p)
        if hit and hit[0] == mtime:
            return hit[1]
        digest = hashlib.sha1(p.read_bytes()).hexdigest()
        self._digests[p] = (mtime, digest)
        return digest

    def _find_duplicates(self):
        """Files that are exact copies of each other (the same exposure fetched twice): only the first (by name) is used. The same exposure counted twice would count one measurement as two in every fit."""
        groups: dict[tuple, list[Path]] = {}
        for p, f in self._index.items():
            groups.setdefault((f.detector, round(f.mjd, 6), p.stat().st_size), []).append(p)
        dups: dict[Path, Path] = {}
        for paths in groups.values():
            if len(paths) < 2:
                continue
            by_hash: dict[str, list[Path]] = {}
            for p in sorted(paths):
                by_hash.setdefault(self._sha1(p), []).append(p)
            for same in by_hash.values():
                for extra in same[1:]:
                    dups[extra] = same[0]
        self._dups = dups

    @property
    def duplicates(self) -> dict[Path, Path]:
        return dict(self._dups)

    def frames(self) -> list[FrameFile]:
        """Every indexed frame that is not a copy of another one."""
        self.refresh()
        return [f for p, f in self._index.items() if p not in self._dups]

    @property
    def errors(self):
        return dict(self._errors)

    def find(self, ra: float, dec: float, detector: str = "all") -> list[FrameFile]:
        """Frames whose image contains (ra, dec), sorted by time."""
        self.refresh()
        hits = []
        for p, f in self._index.items():
            if p in self._dups:
                continue                                  # an exact copy of a file already used
            if detector != "all" and f.detector != detector:
                continue
            try:
                x, y = f.wcs.all_world2pix([[ra, dec]], 0)[0]
            except NoConvergence:
                # The SIP distortion terms diverge far outside their image (a file of another field):
                # the position is simply not on this frame. It must not break the query for the others.
                continue
            if np.isfinite(x) and np.isfinite(y) and 0 <= x < f.shape[1] and 0 <= y < f.shape[0]:
                hits.append(f)
        return sorted(hits, key=lambda f: f.mjd)
