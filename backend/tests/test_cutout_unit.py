"""Each frame served by /api/cutouts says what unit its float pixels are in (the file's BUNIT), so the viewer's readout can show
"1.23 MJy/sr" instead of a bare number. A file that does not say gives None: the viewer then shows no unit rather than inventing one.
Built from SYNTHETIC frames (conftest.py), no real SPHEREx data."""

from __future__ import annotations

import json

import numpy as np

import app as backend_app
from spherex import cache
from spherex.query import LocalArchive


def _frames_for(archive, ra=150.0, dec=20.0):
    frames = archive.find(ra, dec, "all")
    scale = float(np.median([f.pixel_scale_arcsec for f in frames]))
    return frames, scale


def test_the_unit_of_the_file_goes_into_the_frame(write_frame, tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path / "cache")
    (tmp_path / "cache").mkdir()
    write_frame(mjd=60800.0, header_extra={"BUNIT": "MJy / sr"}, name="a.fits")
    write_frame(mjd=60801.0, header_extra={"BUNIT": "MJy / sr"}, name="b.fits")
    frames, scale = _frames_for(LocalArchive(tmp_path))
    out = backend_app._build(frames, 150.0, 20.0, 3.0, scale, "unit-test")
    assert len(out) == 2
    assert [f["unit"] for f in out] == ["MJy / sr", "MJy / sr"]
    json.dumps(out)                                                       # still serialisable as it goes into the cache and the response


def test_a_file_without_a_unit_gives_none_not_a_guess(write_frame, tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path / "cache")
    (tmp_path / "cache").mkdir()
    write_frame(mjd=60800.0, name="a.fits")
    write_frame(mjd=60801.0, name="b.fits")
    frames, scale = _frames_for(LocalArchive(tmp_path))
    out = backend_app._build(frames, 150.0, 20.0, 3.0, scale, "unit-test-none")
    assert [f["unit"] for f in out] == [None, None]
    assert all("dataUrl" in f and "imageUrl" in f and "pixelScaleArcsec" in f for f in out)   # the rest of the frame is as before


def test_the_cache_is_invalidated_when_the_frame_gained_a_field():
    from spherex.stretch import STRETCH_VERSION
    assert STRETCH_VERSION >= 5            # 5 added "unit": frames cached by version 4 have none and must be built again
