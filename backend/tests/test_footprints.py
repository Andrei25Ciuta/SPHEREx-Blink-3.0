"""spherex.footprints: where the files on this machine are on the sky, from their own WCS (and nothing else)."""

from __future__ import annotations

import json
import math

import numpy as np
import pytest

from spherex.footprints import footprint, footprints
from spherex.query import LocalArchive, read_frame_file


def sep_arcsec(ra1, dec1, ra2, dec2):
    """Angular separation (haversine), arcsec."""
    a1, d1, a2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    h = math.sin((d2 - d1) / 2) ** 2 + math.cos(d1) * math.cos(d2) * math.sin((a2 - a1) / 2) ** 2
    return math.degrees(2 * math.asin(math.sqrt(h))) * 3600


def test_the_corners_are_the_corners_of_the_image(write_frame):
    path, _ = write_frame(ra=150.0, dec=20.0, npix=64)
    fp = footprint(read_frame_file(path))
    half_diagonal = 32 * math.sqrt(2) * 6.2                              # 64 pixels of 6.2 arcsec: the corner is 32 pixels east-west and north-south from the centre
    assert len(fp["corners"]) == 4
    for ra, dec in fp["corners"]:
        assert abs(sep_arcsec(ra, dec, 150.0, 20.0) - half_diagonal) < 0.01 * half_diagonal
    assert sep_arcsec(*fp["centre"], 150.0, 20.0) < 1.0
    assert fp["widthArcmin"] == pytest.approx(64 * 6.2 / 60, rel=1e-3) and fp["pixels"] == [64, 64]


def test_the_corners_are_ordered_round_the_image(write_frame):
    path, _ = write_frame(ra=150.0, dec=20.0, npix=64)
    c = footprint(read_frame_file(path))["corners"]                       # FITS pixel (0, 0), (n, 0), (n, n), (0, n): row 0 is the SOUTH edge (FITS rows go up), column 0 the east edge
    assert c[0][1] < 20.0 and c[1][1] < 20.0 and c[2][1] > 20.0 and c[3][1] > 20.0                  # south, south, north, north
    assert c[0][0] > 150.0 and c[3][0] > 150.0 and c[1][0] < 150.0 and c[2][0] < 150.0             # east (larger RA), west, west, east


def test_a_rotated_frame_has_the_same_footprint_size(write_frame):
    path, _ = write_frame(ra=150.0, dec=20.0, npix=64, rot_deg=33)
    c = footprint(read_frame_file(path))["corners"]
    half_diagonal = 32 * math.sqrt(2) * 6.2
    assert all(abs(sep_arcsec(ra, dec, 150.0, 20.0) - half_diagonal) < 0.01 * half_diagonal for ra, dec in c)


def test_right_ascension_is_given_in_0_to_360_across_the_zero(write_frame):
    path, _ = write_frame(ra=0.02, dec=5.0, npix=64)
    fp = footprint(read_frame_file(path))
    assert all(0.0 <= ra < 360.0 for ra, _ in fp["corners"] + [fp["centre"]])
    assert any(ra > 359.0 for ra, _ in fp["corners"]) and any(ra < 1.0 for ra, _ in fp["corners"])      # the image straddles RA = 0


def test_the_list_is_in_time_order_filtered_by_detector_and_has_no_path_or_file_name(write_frame):
    a, _ = write_frame(mjd=60900.0, detector=2, name="secret_name_one.fits")
    b, _ = write_frame(mjd=60800.0, detector=6, name="secret_name_two.fits")
    c, _ = write_frame(mjd=60850.0, detector=2, name="secret_name_three.fits")
    frames = [read_frame_file(p) for p in (a, b, c)]
    allp = footprints(frames)
    assert [f["mjd"] for f in allp] == [60800.0, 60850.0, 60900.0]
    assert [f["detector"] for f in footprints(frames, "D2")] == ["D2", "D2"] and footprints(frames, "D5") == []
    text = json.dumps(allp)
    assert "secret_name" not in text and "fits" not in text.lower() and str(a.parent) not in text
    assert len({f["id"] for f in allp}) == 3 and all(len(f["id"]) == 10 for f in allp)
    assert footprints(frames) == allp                                    # the ids are stable


def test_a_frame_the_wcs_cannot_place_is_left_out_not_fatal(write_frame):
    path, _ = write_frame()
    good = read_frame_file(path)

    class Broken:
        def all_pix2world(self, *_):
            return np.array([[np.nan, np.nan]] * 5)

    bad = read_frame_file(path)
    bad.wcs = Broken()
    assert footprint(bad) is None
    assert len(footprints([good, bad])) == 1


def test_the_endpoint_answers_for_the_files_the_archive_has(write_frame, tmp_path, monkeypatch):
    import app as backend_app

    write_frame(mjd=60801.0, detector=3)
    archive = LocalArchive(tmp_path)
    monkeypatch.setattr(backend_app, "archive", archive)
    answer = backend_app.footprints_endpoint(det="all")
    assert len(answer["footprints"]) == 1 and answer["footprints"][0]["detector"] == "D3"
    assert "not of the SPHEREx survey" in answer["note"]
    assert backend_app.footprints_endpoint(det="D1")["footprints"] == []
