"""spherex.survey: the relay that tells which SPHEREx survey images (IRSA table spherex.plane) cover a place on the sky.

No network: the request is injected. The two table rows below are REAL rows of IRSA's `spherex.plane` (public archive metadata: ids, times, footprints; no pixel),
fetched 2026-11-10 for a circle of 0.5 deg around Barnard's Star (RA 269.4462, Dec +4.769).
"""

from __future__ import annotations

import json
import struct

import pytest

from spherex import survey

REAL_CSV = """planeid,energy_bandpassname,time_bounds_lower,time_bounds_upper,energy_bounds_lower,energy_bounds_upper,quality_flag,dataproducttype,poly
b0641d64-7ba7-4fa5-ab65-8a5cfd62e4b2,SPHEREx-D6,60902.864715,60902.866047,4.41150e-06,5.00960e-06,,image,0103000020E61000000100000005000000107A576B515357C07C0529B3C7E3154058087D62A57456C04D4131862099144010E241452B8056C0A5DCEC999B8FFA3FA03A597BEC5F57C0681089C687D8FF3F107A576B515357C07C0529B3C7E31540
875830ee-89a7-4dd2-adb3-eadbd70f7ad9,SPHEREx-D3,60902.864715,60902.866047,1.63010e-06,2.43460e-06,,image,0103000020E6100000010000000500000080D11DF56B5357C0AF94D6F109F31540100D234EEF7456C0FA6C2A9652AF1440D00D96DA158056C02AA751E67AF5FA3F487F1D6D9A5F57C0AC01B5B75611004080D11DF56B5357C0AF94D6F109F31540
"""
REAL_POLY = REAL_CSV.splitlines()[1].split(",")[-1]
XML_ERROR = '<?xml version="1.0" encoding="utf-8"?>\n<VOTABLE version="1.3"><INFO name="QUERY_STATUS" value="ERROR">Invalid or unsupported ADQL query string</INFO></VOTABLE>'
BARNARD = (269.4462, 4.769)


def ewkb(points, *, endian="<", srid=True, kind=3):
    """A polygon of one ring as EWKB hex (the closing point is added)."""
    ring = list(points) + [points[0]]
    flag = 0x20000000 if srid else 0
    head = struct.pack(endian + "BI", 1 if endian == "<" else 0, kind | flag)
    if srid:
        head += struct.pack(endian + "I", 4326)
    body = struct.pack(endian + "II", 1, len(ring)) + b"".join(struct.pack(endian + "dd", x, y) for x, y in ring)
    return (head + body).hex().upper()


def inside(point, ring):
    """Planar point-in-polygon (good enough for a 3.5 degree polygon far from the poles and the RA wrap)."""
    x, y = point
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(survey, "SURVEY_CACHE", tmp_path / "survey")


# ---------------------------------------------------------------- the polygon
def test_a_real_footprint_decodes_to_four_corners_that_contain_the_target():
    corners = survey.decode_polygon(REAL_POLY)
    assert len(corners) == 4                                          # the closing point is dropped
    assert corners[0] == pytest.approx([266.69815556, 5.47244148], abs=1e-6)
    assert all(0 <= ra < 360 for ra, _ in corners)                    # IRSA stores longitude as -93.3: it must come out as 266.7
    assert inside(BARNARD, corners)                                   # the query asked for images that touch Barnard's Star
    assert not inside((250.0, 4.769), corners)
    width = max(c[0] for c in corners) - min(c[0] for c in corners)
    assert 3.0 < width < 4.0                                          # a SPHEREx image is about 3.5 degrees wide


def test_longitude_is_wrapped_into_0_360_and_both_byte_orders_and_a_missing_srid_are_read():
    square = [(-1.0, 10.0), (1.0, 10.0), (1.0, 12.0), (-1.0, 12.0)]
    for endian in "<>":
        for srid in (True, False):
            got = survey.decode_polygon(ewkb(square, endian=endian, srid=srid))
            assert got == [[359.0, 10.0], [1.0, 10.0], [1.0, 12.0], [359.0, 12.0]]


def test_a_footprint_that_cannot_be_read_is_an_error_not_a_guess():
    square = [(10.0, 10.0), (11.0, 10.0), (11.0, 11.0), (10.0, 11.0)]
    for bad in ("", "ZZ", REAL_POLY[:60], ewkb(square, kind=1), ewkb([(10.0, 95.0), (11.0, 10.0), (11.0, 11.0), (10.0, 11.0)])):
        with pytest.raises(ValueError):
            survey.decode_polygon(bad)


# ---------------------------------------------------------------- the query
def test_the_query_has_the_polygon_first_and_only_validated_numbers():
    q = survey.build_query(269.4462, 4.769, 0.5, "all", 200)
    assert "1=INTERSECTS(poly, CIRCLE('ICRS', 269.446200, 4.769000, 0.500000))" in q       # CIRCLE first is refused by IRSA
    assert q.startswith("SELECT TOP 200 planeid,") and "FROM spherex.plane" in q and q.endswith("ORDER BY time_bounds_lower")
    assert "energy_bandpassname" not in q.split("WHERE")[1]
    assert "AND energy_bandpassname = 'SPHEREx-D2'" in survey.build_query(10, 10, 0.5, "D2", 5)


@pytest.mark.parametrize("args", [
    (360.0, 0.0, 0.5, "all", 10), (-1.0, 0.0, 0.5, "all", 10), (10.0, 91.0, 0.5, "all", 10),
    (10.0, 10.0, 0.0, "all", 10), (10.0, 10.0, 2.5, "all", 10), (10.0, 10.0, 0.5, "all", 0), (10.0, 10.0, 0.5, "all", 5000),
    (10.0, 10.0, 0.5, "D7", 10), (10.0, 10.0, 0.5, "D2' OR 1=1 --", 10), (10.0, 10.0, 0.5, "", 10),
])
def test_arguments_that_are_not_safe_numbers_or_a_known_detector_are_refused(args):
    with pytest.raises(ValueError):
        survey.build_query(*args)


# ---------------------------------------------------------------- the table
def test_two_real_rows_become_planes_with_units_converted_and_nothing_invented():
    planes, skipped = survey.parse_csv(REAL_CSV)
    assert skipped == 0 and [p["detector"] for p in planes] == ["D6", "D3"]
    d6 = planes[0]
    assert d6["id"] == "b0641d64-7ba7-4fa5-ab65-8a5cfd62e4b2" and d6["product"] == "image" and d6["quality"] is None
    assert d6["mjdStart"] == 60902.864715 and d6["mjdEnd"] == 60902.866047
    assert (d6["wavelengthMinUm"], d6["wavelengthMaxUm"]) == (4.4115, 5.0096)             # IRSA gives metres: 4.4115e-06 m = 4.4115 um
    assert (planes[1]["wavelengthMinUm"], planes[1]["wavelengthMaxUm"]) == (1.6301, 2.4346)
    assert len(d6["corners"]) == 4 and "path" not in d6 and "uri" not in d6


def test_a_row_that_cannot_be_read_is_left_out_and_counted_and_a_non_table_is_an_error():
    lines = REAL_CSV.splitlines()
    broken_poly = lines[1].rsplit(",", 1)[0] + ",0102"
    wrong_band = lines[2].replace("SPHEREx-D3", "SPHEREx-D9")
    no_time = lines[2].replace("60902.864715,60902.866047", ",")
    planes, skipped = survey.parse_csv("\n".join([lines[0], lines[1], broken_poly, wrong_band, no_time]) + "\n")
    assert len(planes) == 1 and skipped == 3
    with pytest.raises(survey.SurveyError):
        survey.parse_csv(XML_ERROR)


# ---------------------------------------------------------------- the search
def make_request(*outcomes):
    calls, queue = [], list(outcomes)

    def _request(adql):
        calls.append(adql)
        out = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(out, BaseException):
            raise out
        return out

    _request.calls = calls
    return _request


def test_a_search_gives_the_planes_says_where_they_come_from_and_is_cached_for_a_day():
    request, clock = make_request(REAL_CSV), {"t": 1_000_000.0}
    first = survey.search(*BARNARD, 0.5, "all", 200, request=request, now=lambda: clock["t"])
    assert len(first["planes"]) == 2 and first["fromCache"] is False and first["truncated"] is False and first["skipped"] == 0
    assert "spherex.plane" in first["source"] and "not the files on this computer" in first["source"]
    assert first["retrievedAt"].endswith("UTC") and first["query"] == {"ra": BARNARD[0], "dec": BARNARD[1], "radiusDeg": 0.5, "det": "all", "limit": 200}
    clock["t"] += 3600
    again = survey.search(*BARNARD, 0.5, "all", 200, request=request, now=lambda: clock["t"])
    assert again["fromCache"] is True and again["planes"] == first["planes"] and len(request.calls) == 1
    clock["t"] += 24 * 3600
    survey.search(*BARNARD, 0.5, "all", 200, request=request, now=lambda: clock["t"])
    assert len(request.calls) == 2                                                          # a day-old answer is asked again
    survey.search(*BARNARD, 0.5, "D6", 200, request=request, now=lambda: clock["t"])
    assert len(request.calls) == 3                                                          # another detector is another question


def test_an_answer_that_fills_the_limit_says_it_is_cut_off():
    out = survey.search(*BARNARD, 0.5, "all", 2, request=make_request(REAL_CSV), now=lambda: 5.0)
    assert out["truncated"] is True


def test_a_failure_is_an_error_and_is_not_cached():
    request = make_request(survey.SurveyError("IRSA unreachable"), REAL_CSV)
    with pytest.raises(survey.SurveyError):
        survey.search(*BARNARD, 0.5, "all", 200, request=request, now=lambda: 7.0)
    assert len(survey.search(*BARNARD, 0.5, "all", 200, request=request, now=lambda: 8.0)["planes"]) == 2
    with pytest.raises(survey.SurveyError):
        survey.search(*BARNARD, 0.5, "D1", 200, request=make_request(XML_ERROR), now=lambda: 9.0)


def test_a_damaged_cache_file_is_ignored():
    request = make_request(REAL_CSV)
    survey.search(*BARNARD, 0.5, "all", 200, request=request, now=lambda: 1.0)
    for f in survey.SURVEY_CACHE.glob("*.json"):
        f.write_text("{not json", encoding="utf-8")
    assert len(survey.search(*BARNARD, 0.5, "all", 200, request=request, now=lambda: 2.0)["planes"]) == 2


def test_the_real_request_function_retries_once_and_gives_a_survey_error(monkeypatch):
    calls = []

    def boom(req, timeout=None):
        calls.append(req)
        raise OSError("connection reset")

    monkeypatch.setattr(survey.urllib.request, "urlopen", boom)
    with pytest.raises(survey.SurveyError, match="unreachable"):
        survey._request("SELECT 1")
    assert len(calls) == 2 and calls[0].data is not None and b"QUERY=" in calls[0].data      # a POST: the query is in the body, not in a URL


def test_the_endpoint_answers_and_turns_an_upstream_failure_into_502(monkeypatch):
    import app as backend_app
    monkeypatch.setattr(backend_app.survey, "search", lambda ra, dec, radius, det, limit: {"planes": [], "ra": ra, "det": det})
    assert backend_app.survey_endpoint(ra=10.0, dec=-5.0, radius=0.25, det="D2", limit=50) == {"planes": [], "ra": 10.0, "det": "D2"}

    def down(*args):
        raise survey.SurveyError("IRSA unreachable")

    monkeypatch.setattr(backend_app.survey, "search", down)
    out = backend_app.survey_endpoint(ra=10.0, dec=-5.0, radius=0.25, det="all", limit=50)
    assert out.status_code == 502 and json.loads(out.body)["detail"] == "IRSA unreachable"
