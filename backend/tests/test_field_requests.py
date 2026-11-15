from datetime import datetime, timezone
from io import BytesIO
from urllib.error import HTTPError

from spherex.archive_plan import make_plan
from spherex.field_requests import DETECTORS, RequestValidationError, aggregate_progress, normalize_request


def test_normalized_requests_require_all_six_and_have_stable_ids():
    payload = {"ra": 269.4462, "dec": 4.769, "fov": 5}
    first = normalize_request(payload)
    second = normalize_request({**payload, "detectors": list(reversed(DETECTORS))})
    assert first["requestId"] == second["requestId"]
    assert first["detectors"] == list(DETECTORS)
    assert first["selection"] == "latest"
    assert first["samplingMode"] == "monthly"
    try:
        normalize_request({**payload, "detectors": ["D2"]})
    except RequestValidationError as error:
        assert "D1 through D6" in str(error)
    else:
        raise AssertionError("partial detector requests must be rejected")


def test_date_range_changes_request_id_and_checks_calendar_dates():
    base = {"ra": 10, "dec": -10, "fov": 5}
    latest = normalize_request(base)
    historic = normalize_request({**base, "dateFrom": "2025-01-01", "dateTo": "2025-01-31"})
    assert historic["requestId"] != latest["requestId"]
    assert historic["selection"] == "date-range"
    assert historic["mjdStart"] < historic["mjdEnd"]
    for invalid in ({**base, "dateFrom": "2025-02-30"}, {**base, "dateFrom": "2026-01-01", "dateTo": "2025-01-01"}):
        try:
            normalize_request(invalid)
        except RequestValidationError:
            pass
        else:
            raise AssertionError("invalid date range accepted")


def test_real_data_fov_is_limited_to_ten_arcmin():
    assert normalize_request({"ra": 10, "dec": -10, "fov": 10})["query"]["fov"] == 10
    for fov in (0.9, 10.1, 30):
        try:
            normalize_request({"ra": 10, "dec": -10, "fov": fov})
        except RequestValidationError:
            pass
        else:
            raise AssertionError(f"real-data FOV {fov} arcmin was accepted")


def test_latest_plan_keeps_newest_twelve_after_date_filter():
    rows = [{"obs_collection": "spherex_dr1", "energy_bandpassname": "SPHEREx-D1",
             "t_min": str(60000 + i), "obs_id": f"obs-{i}",
             "access_url": f"https://irsa.ipac.caltech.edu/ibe/data/spherex/{i}.fits",
             "access_format": "application/fits", "access_estsize": "10"} for i in range(30)]
    plan = make_plan(rows, ra=10, dec=-10, fov=5, detector="D1", count=12,
                     cutouts=True, newest=True, mjd_start=60010, mjd_end=60030)
    assert len(plan["files"]) == 12
    assert [item["mjd"] for item in plan["files"]] == list(map(float, range(60018, 60030)))


def test_latest_selection_uses_newest_passes_and_date_ranges_spread_across_passes():
    rows = []
    for pass_start in (60000, 60035, 60070, 60105, 60140):
        for offset in range(3):
            mjd = pass_start + offset
            rows.append({"obs_collection": "spherex_dr1", "energy_bandpassname": "SPHEREx-D1",
                         "t_min": str(mjd), "obs_id": f"obs-{mjd}",
                         "access_url": f"https://irsa.ipac.caltech.edu/ibe/data/spherex/{mjd}.fits",
                         "access_format": "application/fits", "access_estsize": "10"})

    latest = make_plan(rows, ra=10, dec=-10, fov=5, detector="D1", count=3, newest=True)
    historic = make_plan(rows, ra=10, dec=-10, fov=5, detector="D1", count=3, newest=False)

    assert [item["mjd"] for item in latest["files"]] == [60072.0, 60107.0, 60142.0]
    assert [item["mjd"] for item in historic["files"]] == [60002.0, 60072.0, 60142.0]

    newest_with_extra = make_plan(rows, ra=10, dec=-10, fov=5, detector="D1", count=6, newest=True)
    assert [item["mjd"] for item in newest_with_extra["files"]] == [
        60002.0, 60037.0, 60072.0, 60107.0, 60141.0, 60142.0,
    ]


def _mjd(year, month, day=5):
    return datetime(year, month, day, tzinfo=timezone.utc).timestamp() / 86400 + 40587


def _archive_row(mjd, obs_id):
    return {"obs_collection": "spherex_dr1", "energy_bandpassname": "SPHEREx-D1",
            "t_min": str(mjd), "obs_id": obs_id,
            "access_url": f"https://irsa.ipac.caltech.edu/ibe/data/spherex/{obs_id}.fits",
            "access_format": "application/fits", "access_estsize": "10"}


def test_monthly_plan_uses_earliest_candidate_then_fallbacks_within_each_month():
    rows = [
        _archive_row(_mjd(2025, 1, 3), "jan-early"),
        _archive_row(_mjd(2025, 1, 18), "jan-late"),
        _archive_row(_mjd(2025, 2, 2), "feb-early"),
        _archive_row(_mjd(2025, 2, 22), "feb-late"),
        _archive_row(_mjd(2025, 3, 4), "mar-only"),
    ]

    plan = make_plan(rows, ra=10, dec=-10, fov=5, detector="D1", count=12,
                     cutouts=True, monthly=True)

    assert plan["samplingMode"] == "monthly"
    assert plan["requestedMonths"] == ["2025-01", "2025-02", "2025-03"]
    assert plan["monthGroups"] == [
        {"month": "2025-01", "obsIds": ["jan-early", "jan-late"]},
        {"month": "2025-02", "obsIds": ["feb-early", "feb-late"]},
        {"month": "2025-03", "obsIds": ["mar-only"]},
    ]
    assert len(plan["files"]) == 5
    assert all(item["url"].startswith("https://irsa.ipac.caltech.edu/ibe/data/spherex/") for item in plan["files"])


def test_monthly_plan_builds_independent_samples_for_all_six_detectors():
    rows = []
    for detector in DETECTORS:
        for month in (1, 2, 3):
            item = _archive_row(_mjd(2025, month), f"{detector}-{month}")
            item["energy_bandpassname"] = f"SPHEREx-{detector}"
            rows.append(item)

    for detector in DETECTORS:
        plan = make_plan(rows, ra=10, dec=-10, fov=5, detector=detector,
                         cutouts=True, monthly=True)
        assert plan["requestedMonths"] == ["2025-01", "2025-02", "2025-03"]
        assert [group["obsIds"] for group in plan["monthGroups"]] == [
            [f"{detector}-1"], [f"{detector}-2"], [f"{detector}-3"],
        ]


def test_monthly_plan_keeps_newest_twelve_available_months_and_applies_date_bounds():
    rows = [_archive_row(_mjd(2024 + (month - 1) // 12, (month - 1) % 12 + 1), f"obs-{month}")
            for month in range(1, 16)]

    plan = make_plan(rows, ra=10, dec=-10, fov=5, detector="D1", count=12,
                     cutouts=True, monthly=True, mjd_start=_mjd(2024, 2),
                     mjd_end=_mjd(2025, 4))

    assert len(plan["requestedMonths"]) == 12
    assert plan["requestedMonths"][0] == "2024-04"
    assert plan["requestedMonths"][-1] == "2025-03"
    assert all(_mjd(2024, 2) <= item["mjd"] < _mjd(2025, 4) for item in plan["files"])


def test_monthly_plan_retries_transient_product_resolution_failures():
    row = _archive_row(_mjd(2025, 1, 5), "jan")
    row["access_url"] = "https://irsa.ipac.caltech.edu/datalink/obs/jan"
    row["access_format"] = "application/x-votable+xml+datalink"

    def transient_archive_error(_url):
        raise HTTPError(_url, 503, "Temporarily unavailable", {}, BytesIO())

    try:
        make_plan([row], ra=10, dec=-10, fov=5, detector="D1", cutouts=True,
                  monthly=True, fetch=transient_archive_error)
    except HTTPError as error:
        assert error.code == 503
    else:
        raise AssertionError("transient product-resolution failure was hidden as missing coverage")


def test_progress_aggregation_reports_partial_and_terminal_states():
    items = {det: {"status": "queued", "progress": 0} for det in DETECTORS}
    items["D1"] = {"status": "ready", "progress": 1}
    items["D2"] = {"status": "downloading", "progress": 0.4, "completedFiles": 3, "totalFiles": 12}
    aggregate = aggregate_progress(items)
    assert aggregate["status"] == "partial"
    assert aggregate["readyDetectors"] == 1
    assert aggregate["progress"] > 0
