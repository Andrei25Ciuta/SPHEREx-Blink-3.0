from spherex.archive_plan import make_plan
from spherex.field_requests import DETECTORS, RequestValidationError, aggregate_progress, normalize_request


def test_normalized_requests_require_all_six_and_have_stable_ids():
    payload = {"ra": 269.4462, "dec": 4.769, "fov": 5}
    first = normalize_request(payload)
    second = normalize_request({**payload, "detectors": list(reversed(DETECTORS))})
    assert first["requestId"] == second["requestId"]
    assert first["detectors"] == list(DETECTORS)
    assert first["selection"] == "latest"
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


def test_progress_aggregation_reports_partial_and_terminal_states():
    items = {det: {"status": "queued", "progress": 0} for det in DETECTORS}
    items["D1"] = {"status": "ready", "progress": 1}
    items["D2"] = {"status": "downloading", "progress": 0.4, "completedFiles": 3, "totalFiles": 12}
    aggregate = aggregate_progress(items)
    assert aggregate["status"] == "partial"
    assert aggregate["readyDetectors"] == 1
    assert aggregate["progress"] > 0
