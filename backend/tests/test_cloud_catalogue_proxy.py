"""The prepared-data API exposes the same bounded real-catalogue query as local mode."""

import json

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from cloud_app import create_app
from spherex import catalogues
from spherex.storage import LocalStore


def cloud_catalogue_endpoint(tmp_path):
    app = create_app(
        LocalStore(tmp_path / "store"),
        [],
        pixels=True,
        origins=["https://iooonut.github.io"],
        workflow=False,
        registry=None,
    )
    routes = [route for route in app.routes if getattr(route, "path", None) == "/api/catalogue"]
    assert len(routes) == 1
    return routes[0].endpoint


def test_cloud_catalogue_route_preserves_local_response_for_each_allowlisted_catalog(
    tmp_path, monkeypatch
):
    calls = []

    def fake_search(cat, ra, dec, radius, minpm):
        calls.append((cat, ra, dec, radius, minpm))
        return {
            "catalogue": cat,
            "ra": ra,
            "dec": dec,
            "radiusArcmin": radius,
            "minPmMas": minpm,
            "rows": [{"id": f"{cat} source", "ra": ra, "dec": dec, "mags": {}}],
            "truncated": False,
        }

    monkeypatch.setattr(catalogues, "cone_search", fake_search)
    endpoint = cloud_catalogue_endpoint(tmp_path)

    for name in ("2mass", "allwise", "gaia"):
        minpm = 250 if name == "gaia" else 0
        answer = endpoint(cat=name, ra=269.4, dec=4.7, radius=6.0, minpm=float(minpm))
        assert answer["catalogue"] == name
        assert answer["rows"] == [
            {"id": f"{name} source", "ra": 269.4, "dec": 4.7, "mags": {}}
        ]

    assert calls == [
        ("2mass", 269.4, 4.7, 6.0, 0.0),
        ("allwise", 269.4, 4.7, 6.0, 0.0),
        ("gaia", 269.4, 4.7, 6.0, 250.0),
    ]


def test_cloud_catalogue_route_refuses_unknown_catalog_without_querying_upstream(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(
        catalogues,
        "cone_search",
        lambda *_args: (_ for _ in ()).throw(catalogues.NotAllowed("catalogue not offered")),
    )
    endpoint = cloud_catalogue_endpoint(tmp_path)
    try:
        endpoint(cat="simbad", ra=10.0, dec=10.0, radius=5.0, minpm=0.0)
    except HTTPException as exc:
        assert exc.status_code == 403
        assert exc.detail == "catalogue not offered"
    else:
        raise AssertionError("unknown catalog must be refused")


def test_cloud_catalogue_route_maps_upstream_failure_to_502(tmp_path, monkeypatch):
    monkeypatch.setattr(
        catalogues,
        "cone_search",
        lambda *_args: (_ for _ in ()).throw(catalogues.CatalogueError("catalogue unavailable")),
    )
    result = cloud_catalogue_endpoint(tmp_path)(
        cat="gaia", ra=10.0, dec=10.0, radius=5.0, minpm=0.0
    )
    assert isinstance(result, JSONResponse)
    assert result.status_code == 502
    assert json.loads(result.body) == {"detail": "catalogue unavailable"}
