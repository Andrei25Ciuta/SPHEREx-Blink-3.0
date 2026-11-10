"""spherex.catalogues: the 2MASS / AllWISE / Gaia relay must build safe queries, parse the tables and fail politely.

No network: urlopen is replaced. The CSV samples below are real answers (shortened), checked 2026-11-08.
"""

from __future__ import annotations

import json
import urllib.error

import pytest

from spherex import catalogues as cat

TWOMASS_CSV = """designation,ra,dec,j_m,h_m,k_m,jdate
17574838+0446164,269.451591,4.771246,16.027,15.670,16.779,2451692.9285
17574986+0446217,269.457779,4.772700,,15.969,16.124,2451692.9285
"""
ALLWISE_CSV = """designation,ra,dec,w1mpro,w2mpro,w3mpro,w1mjdmean
J175743.98+044600.0,269.4332785,4.7666776,16.608,16.622,11.815,55355.54713405
"""
GAIA_CSV = """source_id,ra,dec,pmra,pmdec,phot_g_mean_mag,ref_epoch
4472833024292246784,269.4649405198144,4.76368818742851,,,20.95924,2016.0
4472835876142941952,269.43960335476396,4.7699924690726965,-1.0702534375175532,-3.9306567612673446,20.007412,2016.0
"""
XML_ERROR = '<?xml version="1.0" encoding="utf-8"?>\n<VOTABLE version="1.3"><INFO name="QUERY_STATUS" value="ERROR">bad column</INFO></VOTABLE>'


class FakeResponse:
    def __init__(self, data: str):
        self._data = data.encode()

    def read(self) -> bytes:
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def fake_urlopen(monkeypatch, *outcomes):
    """Each call returns/raises the next outcome (the last one repeats). Returns the list of requests made."""
    calls, queue = [], list(outcomes)

    def _urlopen(request, timeout=None):
        calls.append((request, timeout))
        outcome = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(outcome, BaseException):
            raise outcome
        return FakeResponse(outcome)

    monkeypatch.setattr(cat.urllib.request, "urlopen", _urlopen)
    return calls


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(cat, "CATALOGUE_CACHE", tmp_path / "catalogues")


def http_error(code):
    return urllib.error.HTTPError("https://example.invalid", code, "error", {}, None)


# ---- the query text ---------------------------------------------------------------------------------------------

def test_the_query_contains_only_the_fixed_template_and_the_numbers():
    q = cat.build_query("gaia", 269.4462, 4.769, 6)
    assert "FROM gaiadr3.gaia_source" in q
    assert "CIRCLE('ICRS',269.446200,4.769000,0.100000)" in q          # 6 arcmin = 0.1 degree
    assert f"TOP {cat.ROW_LIMIT}" in q


@pytest.mark.parametrize("name", ["simbad", "2MASS", "fp_psc; DROP TABLE x", "", "../gaia"])
def test_only_the_three_known_catalogues_are_offered(name):
    with pytest.raises(cat.NotAllowed):
        cat.build_query(name, 10, 10, 5)


@pytest.mark.parametrize("ra, dec, radius", [(-1, 0, 5), (360, 0, 5), (10, 91, 5), (10, -91, 5), (10, 10, 0), (10, 10, -3),
                                              (10, 10, cat.RADIUS_MAX_ARCMIN + 0.01), (float("nan"), 10, 5)])
def test_positions_and_radius_are_range_checked(ra, dec, radius):
    with pytest.raises(ValueError):
        cat.build_query("2mass", ra, dec, radius)


def test_a_proper_motion_filter_exists_for_gaia_only():
    q = cat.build_query("gaia", 269.4, 4.7, 10, 500)
    assert "pmra*pmra+pmdec*pmdec>250000.0" in q                          # (500 mas/yr)^2
    assert "pmra*pmra" not in cat.build_query("gaia", 269.4, 4.7, 10)
    for bad in ("2mass", "allwise"):
        with pytest.raises(ValueError, match="gaia only"):
            cat.build_query(bad, 269.4, 4.7, 10, 500)
    for value in (-1, cat.MIN_PM_MAX_MAS + 1, float("nan")):
        with pytest.raises(ValueError):
            cat.build_query("gaia", 269.4, 4.7, 10, value)


def test_the_fast_star_question_is_cached_apart_from_the_all_star_question(monkeypatch):
    calls = fake_urlopen(monkeypatch, GAIA_CSV)
    cat.cone_search("gaia", 269.4, 4.7, 10)
    cat.cone_search("gaia", 269.4, 4.7, 10, 500)
    cat.cone_search("gaia", 269.4, 4.7, 10, 500)
    assert len(calls) == 2


# ---- parsing ----------------------------------------------------------------------------------------------------

def test_2mass_rows_get_magnitudes_and_a_per_source_epoch():
    rows = cat.parse_csv("2mass", TWOMASS_CSV)
    assert [r["id"] for r in rows] == ["2MASS J17574838+0446164", "2MASS J17574986+0446217"]
    assert rows[0]["mags"] == {"J": 16.027, "H": 15.670, "K": 16.779}
    assert rows[1]["mags"] == {"H": 15.969, "K": 16.124}                  # the missing J is left out, not 0
    assert rows[0]["epochMjd"] == pytest.approx(2451692.9285 - 2400000.5)  # JD -> MJD
    assert rows[0]["pmra"] is None and rows[0]["pmdec"] is None


def test_allwise_rows_use_their_own_mean_epoch_and_carry_no_proper_motion():
    (row,) = cat.parse_csv("allwise", ALLWISE_CSV)
    assert row["id"] == "AllWISE J175743.98+044600.0"
    assert row["epochMjd"] == pytest.approx(55355.547134)
    assert row["mags"]["W2"] == 16.622
    assert row["pmra"] is None                                            # poorly measured for faint sources: not offered


def test_gaia_rows_keep_proper_motion_in_mas_per_year_and_convert_the_reference_epoch():
    rows = cat.parse_csv("gaia", GAIA_CSV)
    assert rows[0]["pmra"] is None                                        # 2-parameter solution: no proper motion
    assert rows[1]["pmra"] == pytest.approx(-1.0702534) and rows[1]["pmdec"] == pytest.approx(-3.9306567)
    assert rows[1]["epochMjd"] == pytest.approx(57388.5)                  # J2016.0
    assert rows[1]["mags"] == {"G": 20.007412}


def test_an_empty_table_is_an_empty_list_not_an_error():
    assert cat.parse_csv("2mass", "designation,ra,dec,j_m,h_m,k_m,jdate\n") == []


def test_rows_without_a_position_are_dropped():
    text = "designation,ra,dec,j_m,h_m,k_m,jdate\nX,,4.0,1,2,3,2451692.9\nY,10.0,4.0,1,2,3,2451692.9\n"
    assert [r["id"] for r in cat.parse_csv("2mass", text)] == ["2MASS JY"]


def test_an_xml_error_page_is_a_catalogue_error_not_an_empty_answer():
    with pytest.raises(cat.CatalogueError, match="not a table"):
        cat.parse_csv("allwise", XML_ERROR)


# ---- network behaviour ------------------------------------------------------------------------------------------

def test_irsa_is_asked_with_get_and_gaia_with_post(monkeypatch):
    calls = fake_urlopen(monkeypatch, TWOMASS_CSV)
    cat.cone_search("2mass", 269.4462, 4.769, 5)
    req, timeout = calls[0]
    assert req.get_method() == "GET" and req.full_url.startswith(cat.IRSA_TAP + "?")
    assert "fp_psc" in req.full_url and "FORMAT=csv" in req.full_url
    assert timeout == cat.TIMEOUT_S["2mass"]
    assert req.get_header("User-agent").startswith("SPHEREx-Blink")

    calls = fake_urlopen(monkeypatch, GAIA_CSV)
    cat.cone_search("gaia", 269.4462, 4.769, 5)
    req, _ = calls[0]
    assert req.get_method() == "POST" and req.full_url == cat.GAIA_TAP
    assert b"gaiadr3.gaia_source" in req.data and b"REQUEST=doQuery" in req.data


def test_an_answer_is_cached_and_the_second_call_does_not_touch_the_network(monkeypatch):
    calls = fake_urlopen(monkeypatch, ALLWISE_CSV)
    first = cat.cone_search("allwise", 269.4462, 4.769, 5)
    second = cat.cone_search("allwise", 269.4462, 4.769, 5)
    assert first == second and len(first["rows"]) == 1 and first["truncated"] is False
    assert len(calls) == 1
    other = cat.cone_search("allwise", 269.4462, 4.769, 6)                # another radius is another question
    assert len(calls) == 2 and other["radiusArcmin"] == 6


def test_a_broken_cache_file_is_ignored(monkeypatch, tmp_path):
    calls = fake_urlopen(monkeypatch, TWOMASS_CSV)
    cat.cone_search("2mass", 10, 10, 5)
    (cached,) = list((tmp_path / "catalogues").glob("*.json"))
    cached.write_text("{not json", encoding="utf-8")
    assert len(cat.cone_search("2mass", 10, 10, 5)["rows"]) == 2
    assert len(calls) == 2


def test_server_errors_are_retried_once_then_reported(monkeypatch):
    calls = fake_urlopen(monkeypatch, http_error(503))
    with pytest.raises(cat.CatalogueError, match="unreachable"):
        cat.cone_search("gaia", 10, 10, 5)
    assert len(calls) == 2


def test_a_refused_query_is_not_retried(monkeypatch):
    calls = fake_urlopen(monkeypatch, http_error(400))
    with pytest.raises(cat.CatalogueError):
        cat.cone_search("2mass", 10, 10, 5)
    assert len(calls) == 1


def test_a_timeout_then_success_still_returns_the_table(monkeypatch):
    calls = fake_urlopen(monkeypatch, TimeoutError("slow"), TWOMASS_CSV)
    assert len(cat.cone_search("2mass", 10, 10, 5)["rows"]) == 2
    assert len(calls) == 2


def test_an_unusable_answer_is_never_cached(monkeypatch, tmp_path):
    fake_urlopen(monkeypatch, XML_ERROR)
    with pytest.raises(cat.CatalogueError):
        cat.cone_search("allwise", 10, 10, 5)
    assert not list((tmp_path / "catalogues").glob("*.json")) if (tmp_path / "catalogues").exists() else True


def test_a_full_answer_is_marked_truncated_and_not_cached(monkeypatch, tmp_path):
    monkeypatch.setattr(cat, "ROW_LIMIT", 2)
    fake_urlopen(monkeypatch, TWOMASS_CSV)                                # exactly 2 rows = the limit
    answer = cat.cone_search("2mass", 10, 10, 5)
    assert answer["truncated"] is True
    assert not (tmp_path / "catalogues").exists() or not list((tmp_path / "catalogues").glob("*.json"))


# ---- the HTTP route (called as a function: httpx, needed for TestClient, is not installed) -----------------------

def test_the_route_returns_rows_or_a_polite_error(monkeypatch):
    import app as backend_app

    fake_urlopen(monkeypatch, TWOMASS_CSV)
    out = backend_app.catalogue(cat="2mass", ra=10.0, dec=10.0, radius=5.0, minpm=0.0)
    assert out["catalogue"] == "2mass" and len(out["rows"]) == 2
    json.dumps(out)                                                       # serialisable as it is

    refused = backend_app.catalogue(cat="simbad", ra=10.0, dec=10.0, radius=5.0, minpm=0.0)
    assert refused.status_code == 403

    fake_urlopen(monkeypatch, http_error(503))
    down = backend_app.catalogue(cat="gaia", ra=11.0, dec=11.0, radius=5.0, minpm=0.0)
    assert down.status_code == 502 and b"unreachable" in down.body
