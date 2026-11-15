from __future__ import annotations

import io
import urllib.error

import pytest

from spherex import tap_archive


def request(**overrides):
    value = {
        "collection": "spherex_dr1",
        "detectors": [f"D{i}" for i in range(1, 7)],
        "query": {"ra": 269.4462, "dec": 4.769, "fov": 5},
        "mjdStart": 61000.0,
        "mjdEnd": 61100.0,
    }
    value.update(overrides)
    return value


def tap_row(*, obs_id="p1", band="SPHEREx-D2", mjd="61050.5", uri="ibe/data/spherex/dr1/level2/p1.fits"):
    return {"obs_id": obs_id, "energy_bandpassname": band, "t_min": mjd, "access_url": uri}


def test_build_query_filters_circle_detectors_and_normalized_date_bounds():
    adql = tap_archive.build_query(request(detectors=["D2", "D6"]))
    assert "FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid" in adql
    assert "INTERSECTS(p.poly, CIRCLE('ICRS', 269.44620000, 4.76900000, 0.04166667))" in adql
    assert "p.energy_bandpassname IN ('SPHEREx-D2', 'SPHEREx-D6')" in adql
    assert "a.uri LIKE '%/dr1/%'" in adql
    assert "p.time_bounds_lower >= 61000.00000000" in adql
    assert "p.time_bounds_lower < 61100.00000000" in adql
    assert "TOP 4096" in adql and "ORDER BY p.time_bounds_lower" in adql


@pytest.mark.parametrize("bad", [
    {"query": {"ra": 360, "dec": 0, "fov": 5}},
    {"query": {"ra": 1, "dec": -91, "fov": 5}},
    {"query": {"ra": 1, "dec": 0, "fov": 11}},
    {"collection": "spherex_dr1' OR 1=1 --"},
    {"collection": "spherex_qr2"},
    {"detectors": ["D2' OR 1=1 --"]},
    {"mjdStart": float("nan")},
])
def test_build_query_rejects_unvalidated_request_values(bad):
    data = request()
    data.update(bad)
    with pytest.raises(ValueError):
        tap_archive.build_query(data)


def test_normalize_rows_maps_only_valid_detector_dates_and_ibe_fits_urls():
    rows = [
        tap_row(obs_id="later", mjd="61070"),
        tap_row(obs_id="earlier", mjd="61020"),
        tap_row(obs_id="too-early", mjd="60999.999"),
        tap_row(obs_id="at-end", mjd="61100"),
        tap_row(obs_id="wrong-det", band="SPHEREx-D7"),
        tap_row(obs_id="wrong-host", uri="https://evil.example/ibe/data/spherex/dr1/a.fits"),
        tap_row(obs_id="wrong-path", uri="https://irsa.ipac.caltech.edu/SIA?evil.fits"),
        tap_row(obs_id="wrong-release-qr2", uri="ibe/data/spherex/qr2/level2/old.fits"),
        tap_row(obs_id="wrong-release-qr3", uri="ibe/data/spherex/qr3/level2/other.fits"),
        tap_row(obs_id="duplicate", uri="https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/a.fits?x=1"),
        tap_row(obs_id="duplicate", uri="https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/b.fits"),
    ]
    rows[-1]["access_url"] = "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/duplicate.fits"
    out = tap_archive.normalize_rows(rows, request())
    assert [item["obs_id"] for item in out] == ["earlier", "duplicate", "later"]
    assert out[0] == {
        "obs_collection": "spherex_dr1", "energy_bandpassname": "SPHEREx-D2",
        "t_min": 61020.0, "obs_id": "earlier",
        "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/p1.fits",
        "access_format": "image/fits", "access_estsize": None,
    }


def test_observations_uses_injected_query_and_returns_sampler_contract():
    seen = []
    def fake_query(adql):
        seen.append(adql)
        return [tap_row()]

    rows = tap_archive.observations(request(), tap_query=fake_query)
    assert len(seen) == 1 and "FROM spherex.artifact" in seen[0]
    assert set(rows[0]) == {
        "obs_collection", "energy_bandpassname", "t_min", "obs_id",
        "access_url", "access_format", "access_estsize",
    }
    # The existing sampler can consume the TAP-normalized row without changes.
    from spherex.archive_plan import make_plan
    plan = make_plan(rows, ra=269.4462, dec=4.769, fov=5, detector="D2",
                     collection="spherex_dr1", cutouts=True, monthly=True)
    assert plan["files"][0]["obsId"] == "p1"
    assert plan["files"][0]["month"] == "2026-01"


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload
    def read(self, limit=-1):
        return self.payload[:limit]
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False


def test_query_csv_posts_adql_and_parses_csv():
    seen = []
    def opener(req, timeout=None):
        seen.append((req, timeout))
        return FakeResponse(b"obs_id,energy_bandpassname,t_min,access_url\np1,SPHEREx-D2,61050,ibe/data/spherex/dr1/a.fits\n")

    rows = tap_archive._query_csv("SELECT 1", opener=opener)
    req, timeout = seen[0]
    assert rows[0]["obs_id"] == "p1"
    assert req.full_url == tap_archive.TAP_ENDPOINT and req.data is not None
    assert b"QUERY=SELECT+1" in req.data and timeout == tap_archive.TIMEOUT_SECONDS


def test_query_csv_reports_http_and_tap_query_errors():
    def http_error(_req, timeout=None):
        raise urllib.error.HTTPError(tap_archive.TAP_ENDPOINT, 503, "down", {}, io.BytesIO(b"busy"))
    with pytest.raises(tap_archive.TapArchiveError, match="HTTP 503") as caught:
        tap_archive._query_csv("SELECT 1", opener=http_error)
    assert caught.value.status_code == 503

    def xml_error(_req, timeout=None):
        return FakeResponse(b'<VOTABLE><INFO name="QUERY_STATUS" value="ERROR">bad column</INFO></VOTABLE>')
    with pytest.raises(tap_archive.TapArchiveError, match="bad column"):
        tap_archive._query_csv("SELECT missing", opener=xml_error)


def test_query_csv_rejects_unexpected_or_oversized_responses():
    with pytest.raises(tap_archive.TapArchiveError, match="unrecognized"):
        tap_archive._query_csv("SELECT 1", opener=lambda *_a, **_k: FakeResponse(b"hello\nworld"))
    with pytest.raises(tap_archive.TapArchiveError, match="size limit"):
        tap_archive._query_csv("SELECT 1", opener=lambda *_a, **_k: FakeResponse(b"x" * (tap_archive.MAX_RESPONSE_BYTES + 1)))
