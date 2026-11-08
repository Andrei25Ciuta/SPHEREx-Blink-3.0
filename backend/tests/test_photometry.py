"""spherex.photometry: aperture photometry (same algorithm as the frontend mock) and measure()."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from conftest import add_star
from spherex.photometry import aperture, jansky_per_image_unit, measure
from spherex.query import read_frame_file

SIGMA, RADIUS = 0.9, 2.0


def star_image(flux=1000.0, n=41, background=0.0):
    img = np.full((n, n), background, dtype=np.float32)
    add_star(img, 20.0, 20.0, flux, SIGMA)           # star on the centre of pixel (20, 20) = edge coords (20.5, 20.5)
    return img


def test_aperture_recovers_the_enclosed_fraction_of_a_star():
    flux, _ = aperture(star_image(), 20.5, 20.5, RADIUS)
    enclosed = 1 - np.exp(-RADIUS ** 2 / (2 * SIGMA ** 2))            # fraction of a Gaussian inside radius r
    assert abs(flux - 1000.0 * enclosed) < 0.05 * 1000.0              # pixelisation of the circle: a few percent


def test_a_constant_background_does_not_change_the_flux():
    plain, _ = aperture(star_image(background=0.0), 20.5, 20.5, RADIUS)
    lifted, _ = aperture(star_image(background=500.0), 20.5, 20.5, RADIUS)
    assert abs(plain - lifted) < 1.0


def test_error_follows_the_background_noise():
    img = np.random.default_rng(1).normal(0.0, 5.0, (41, 41)).astype(np.float32)
    _, err = aperture(img, 20.5, 20.5, RADIUS)
    yy, xx = np.mgrid[0:41, 0:41]
    n_inside = np.count_nonzero(np.hypot(xx + 0.5 - 20.5, yy + 0.5 - 20.5) <= RADIUS)
    assert 0.6 * 5.0 * np.sqrt(n_inside) < err < 1.4 * 5.0 * np.sqrt(n_inside)


def test_nan_pixels_are_ignored():
    img = star_image()
    img[20, 21] = np.nan                                              # inside the aperture
    img[20, 30] = np.nan                                              # in the background ring
    result = aperture(img, 20.5, 20.5, RADIUS)
    assert result is not None and np.isfinite(result[0]) and np.isfinite(result[1])


def test_no_usable_background_ring_gives_none():
    assert aperture(np.full((3, 3), np.nan, dtype=np.float32), 1.5, 1.5, RADIUS) is None
    assert aperture(np.ones((3, 3), dtype=np.float32), 1.5, 1.5, RADIUS) is None      # no room for the ring


def test_measure_follows_a_star_through_rotated_frames_and_sees_nothing_where_it_is_absent(write_frame):
    star = (150.0, 20.0, 1000.0)
    present, _ = write_frame(stars=[star], mjd=60800.0, detector=3)
    absent, _ = write_frame(stars=[], mjd=60980.0, detector=3, rot_deg=25)         # later epoch, rotated, empty sky
    points = measure([read_frame_file(present), read_frame_file(absent)], 150.0, 20.0)
    enclosed = 1000.0 * (1 - np.exp(-RADIUS ** 2 / (2 * SIGMA ** 2)))
    assert 0.5 * enclosed < points[0]["flux"] < 1.1 * enclosed
    assert abs(points[1]["flux"]) < 1.0
    assert [p["detector"] for p in points] == ["D3", "D3"]
    assert points[0]["mjd"] < points[1]["mjd"]


def test_measure_reports_flagged_pixels_next_to_the_target(write_frame):
    flags = np.zeros((64, 64), dtype=np.int32)
    flags[30:34, 30:34] = 1                                           # around the frame centre = the target
    clean, _ = write_frame(mjd=60800.0)
    dirty, _ = write_frame(mjd=60801.0, flags=flags)
    points = measure([read_frame_file(clean), read_frame_file(dirty)], 150.0, 20.0)
    assert [p["flagged"] for p in points] == [False, True]

def test_surface_brightness_preserves_si_prefix_case(write_frame):
    path, _ = write_frame()
    frame = read_frame_file(path)
    mega = jansky_per_image_unit(replace(frame, bunit="MJy / sr"))
    milli = jansky_per_image_unit(replace(frame, bunit="mJy / sr"))
    assert mega / milli == pytest.approx(1e9)
    assert jansky_per_image_unit(replace(frame, bunit="Jy / beam")) is None
