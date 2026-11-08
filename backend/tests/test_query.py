"""spherex.query: reading frame headers and finding which frames cover a position."""

from __future__ import annotations

import numpy as np
import pytest
from astropy.io import fits

from spherex.query import LocalArchive, normalize_detector, read_frame_file


@pytest.mark.parametrize("raw, expected", [
    (1, "D1"), ("1", "D1"), ("D1", "D1"), ("SPHEREx-D4", "D4"), ("d6", "D6"), ("det-02", "D2"), (None, None),
])
def test_detector_names_are_normalised(raw, expected):
    assert normalize_detector(raw) == expected


def test_a_name_without_a_number_is_kept_as_it_is():
    assert normalize_detector("abc") == "abc"


def test_reads_time_detector_wavelength_and_pixel_scale(write_frame):
    path, _ = write_frame(mjd=60812.5, detector=2, header_extra={"WAVEMIN": 1.2, "WAVEMAX": 1.3})
    frame = read_frame_file(path)
    assert frame.mjd == pytest.approx(60812.5)
    assert frame.date_iso == "2025-05-17T12:00:00Z"
    assert frame.detector == "D2"
    assert (frame.wave_min_um, frame.wave_max_um) == (1.2, 1.3)
    assert frame.pixel_scale_arcsec == pytest.approx(6.2, rel=0.01)
    assert frame.shape == (64, 64)
    assert frame.provenance == "unverified"


def test_provenance_uses_header_evidence(write_frame):
    synthetic, _ = write_frame(header_extra={"COMMENT": "SYNTHETIC TEST FILE - NOT SPHEREx DATA"})
    assert read_frame_file(synthetic).provenance == "synthetic"
    archive, _ = write_frame(header_extra={"OBSID": "2025W34_2B_0090_4", "SPS_TARGET": "SURVEY", "EXTTYPE": "IMAGE"})
    assert read_frame_file(archive).provenance == "spherex_header"


def test_missing_wavelength_keywords_fall_back_to_the_nominal_band(write_frame):
    path, _ = write_frame(detector=4)
    frame = read_frame_file(path)
    assert (frame.wave_min_um, frame.wave_max_um) == (2.42, 3.82)


def test_a_file_without_wcs_wave_has_no_wavelength_from_wcs(write_frame):
    from spherex.query import _wavelength_range_from_wcs
    path, _ = write_frame()
    with fits.open(path) as hdul:
        assert _wavelength_range_from_wcs(hdul, 1) is None


def test_the_band_from_wcs_wave_is_used_when_available(write_frame, monkeypatch):
    from spherex import query
    monkeypatch.setattr(query, "_wavelength_range_from_wcs", lambda hdul, i: (1.088, 1.113))
    path, _ = write_frame(detector=2)
    frame = read_frame_file(path)
    assert (frame.wave_min_um, frame.wave_max_um) == (1.088, 1.113)              # not the nominal 1.10-1.62


def test_a_file_without_a_time_keyword_is_rejected(write_frame):
    path, _ = write_frame(time_keyword=False)
    with pytest.raises(ValueError, match="no time keyword"):
        read_frame_file(path)


def test_a_file_without_a_sky_wcs_is_rejected(tmp_path):
    path = tmp_path / "no_wcs.fits"
    hdr = fits.Header()
    hdr["MJD-OBS"] = 60800.0
    fits.HDUList([fits.PrimaryHDU(), fits.ImageHDU(np.zeros((8, 8), np.float32), hdr, name="IMAGE")]).writeto(path)
    with pytest.raises(ValueError, match="celestial WCS"):
        read_frame_file(path)


def test_a_file_without_an_image_is_rejected(tmp_path):
    path = tmp_path / "empty.fits"
    fits.HDUList([fits.PrimaryHDU()]).writeto(path)
    with pytest.raises(ValueError, match="no image HDU"):
        read_frame_file(path)


def test_archive_finds_frames_that_cover_a_position_sorted_by_time(write_frame, tmp_path):
    write_frame(mjd=60990, detector=1, name="late.fits")
    write_frame(mjd=60800, detector=1, name="early.fits")
    write_frame(mjd=60900, detector=2, name="other_detector.fits")
    write_frame(ra=10.0, dec=-30.0, mjd=60850, detector=1, name="elsewhere.fits")
    archive = LocalArchive(tmp_path)

    names = lambda frames: [f.path.name for f in frames]                     # noqa: E731
    assert names(archive.find(150.0, 20.0)) == ["early.fits", "other_detector.fits", "late.fits"]
    assert names(archive.find(150.0, 20.0, "D1")) == ["early.fits", "late.fits"]
    assert names(archive.find(10.0, -30.0)) == ["elsewhere.fits"]


def test_a_position_just_outside_every_frame_finds_nothing(write_frame, tmp_path):
    write_frame()                                                            # 64 px = about 6.6 arcmin wide
    assert LocalArchive(tmp_path).find(150.1, 20.0) == []                    # about 5.6 arcmin east of the centre


def test_a_frame_whose_distortion_cannot_be_inverted_far_away_is_skipped(write_frame, tmp_path, monkeypatch):
    """Real SIP polynomials diverge far outside their image and astropy raises NoConvergence (seen with 50 real
    files of several fields: every /api/photometry call answered HTTP 500). That must mean "not on this frame"."""
    from astropy.wcs import WCS, NoConvergence

    write_frame(name="here.fits")
    write_frame(ra=10.0, dec=-30.0, name="elsewhere.fits")
    original = WCS.all_world2pix

    def diverging(self, *args, **kwargs):
        if abs(float(np.ravel(args[0])[0]) - float(self.wcs.crval[0])) > 5:      # far from this frame's own field
            raise NoConvergence("the solution is diverging", best_solution=np.zeros((1, 2)))
        return original(self, *args, **kwargs)

    monkeypatch.setattr(WCS, "all_world2pix", diverging)
    archive = LocalArchive(tmp_path)
    assert [f.path.name for f in archive.find(150.0, 20.0)] == ["here.fits"]
    assert [f.path.name for f in archive.find(10.0, -30.0)] == ["elsewhere.fits"]


def test_a_bad_file_is_reported_but_does_not_break_the_archive(write_frame, tmp_path):
    write_frame(name="good.fits")
    (tmp_path / "corrupt.fits").write_text("this is not a FITS file")
    write_frame(time_keyword=False, name="no_time.fits")
    archive = LocalArchive(tmp_path)

    assert [f.path.name for f in archive.find(150.0, 20.0)] == ["good.fits"]
    errors = {p.name: message for p, message in archive.errors.items()}
    assert set(errors) == {"corrupt.fits", "no_time.fits"}
    assert "no time keyword" in errors["no_time.fits"]


def test_a_deleted_file_disappears_from_the_index(write_frame, tmp_path):
    path, _ = write_frame(name="a.fits")
    archive = LocalArchive(tmp_path)
    assert len(archive.find(150.0, 20.0)) == 1
    path.unlink()
    assert archive.find(150.0, 20.0) == []
