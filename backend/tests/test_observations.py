"""The archive metadata endpoint accepts bounded, verified SIA2 responses."""

from io import BytesIO

import pytest

from spherex import observations as archive


class Response(BytesIO):
    pass


def test_sia2_product_and_footprint(monkeypatch):
    csv = ("obs_id,energy_bandpassname,t_min,s_region,access_url,obs_collection\n"
           "exp-1,SPHEREx-D2,60811.5,POLYGON ICRS 10 20 11 20 11 21 10 21,"
           "https://irsa.ipac.caltech.edu/ibe/data/spherex/exp-1.fits,spherex_qr2\n")
    monkeypatch.setattr(archive, "urlopen", lambda request, timeout: Response(csv.encode()))
    result = archive.observations(10, 20, 2, "spherex_qr2")
    assert result["records"] == [{"id": "exp-1", "detector": "D2", "startMjd": 60811.5,
                                  "footprint": [(10.0, 20.0), (11.0, 20.0), (11.0, 21.0), (10.0, 21.0)],
                                  "productUrl": "https://irsa.ipac.caltech.edu/ibe/data/spherex/exp-1.fits"}]


def test_sia2_rejects_unrecognised_table(monkeypatch):
    monkeypatch.setattr(archive, "urlopen", lambda request, timeout: Response(b"message,error\nno,results\n"))
    with pytest.raises(OSError, match="unrecognised"):
        archive.observations(10, 20, 2, "spherex_qr2")


def test_sia2_rejects_unapproved_collection():
    with pytest.raises(ValueError):
        archive.observations(10, 20, 2, "other")
