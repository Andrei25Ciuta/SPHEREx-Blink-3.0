import copy
from datetime import datetime, timezone

import pytest

from spherex.manifest import validate_dynamic_manifest
from spherex.storage import StoreError


ACKNOWLEDGEMENT = (
    "This publication makes use of data products from the Spectro-Photometer for the "
    "History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which "
    "is a joint project of the Jet Propulsion Laboratory and the California Institute "
    "of Technology, and is funded by the National Aeronautics and Space Administration."
)


@pytest.fixture
def dynamic_manifest():
    sequence_id = "fr-" + "a" * 32 + "-d1"
    revision = "b" * 32
    prefix = f"sequences/{sequence_id}/{revision}/"
    assets = {
        name: {"key": prefix + name, "sizeBytes": 10, "sha256": "c" * 64}
        for name in ("image.png", "frame.f32", "mask.png")
    }
    return {
        "version": 1, "sequenceId": sequence_id, "revision": revision,
        "dataKind": "real", "processingVersion": "blink3-cloud-1",
        "collection": "spherex_dr1",
        "query": {"ra": 10.0, "dec": -10.0, "fov": 5.0, "det": "D1"},
        "frames": [{
            "mjd": 61000.0, "detector": "D1", "wavelengthMinUm": 0.75,
            "wavelengthMaxUm": 0.91, "provenance": "spherex_header",
            "imageUrl": "image.png", "dataUrl": "frame.f32", "maskUrl": "mask.png",
        }],
        "assets": assets,
        "originals": [{
            "key": prefix + "private/input.fits", "sizeBytes": 10,
            "sha256": "d" * 64, "obsId": "obs-d1", "mjd": 61000.0,
            "sourceUrl": "https://irsa.ipac.caltech.edu/ibe/data/spherex/example.fits",
        }],
        "requestId": "fr-" + "a" * 32, "policyVersion": "spherex-dr1-owner-v1",
        "termsChecked": True, "acknowledgement": ACKNOWLEDGEMENT,
        "dataDoi": "10.26131/IRSA678",
    }


def test_dynamic_manifest_requires_separate_approved_doi(dynamic_manifest):
    validated = validate_dynamic_manifest(
        dynamic_manifest, policy_version="spherex-dr1-owner-v1", acknowledgement=ACKNOWLEDGEMENT,
    )
    assert validated["dataDoi"] == "10.26131/IRSA678"

    wrong_doi = copy.deepcopy(dynamic_manifest)
    wrong_doi["dataDoi"] = "10.26131/OTHER"
    with pytest.raises(StoreError, match="owner acquisition policy"):
        validate_dynamic_manifest(
            wrong_doi, policy_version="spherex-dr1-owner-v1", acknowledgement=ACKNOWLEDGEMENT,
        )


def test_monthly_processing_manifest_requires_one_verified_image_per_ready_month(dynamic_manifest):
    dynamic_manifest["processingVersion"] = "blink3-cloud-3"
    month = datetime.fromtimestamp((61000.0 - 40587) * 86400, timezone.utc).strftime("%Y-%m")
    dynamic_manifest["samplingMode"] = "monthly"
    dynamic_manifest["monthlySelection"] = {
        "mode": "one-per-utc-month", "requestedMonths": [month], "missingMonths": [],
        "monthResults": [{"month": month, "status": "ready", "selectedObsId": "obs-d1",
                          "attemptedObsIds": ["obs-d1"]}],
    }
    validated = validate_dynamic_manifest(
        dynamic_manifest, policy_version="spherex-dr1-owner-v1", acknowledgement=ACKNOWLEDGEMENT,
    )
    assert validated["monthlySelection"]["requestedMonths"] == [month]

    inconsistent = copy.deepcopy(dynamic_manifest)
    inconsistent["monthlySelection"]["missingMonths"] = [month]
    with pytest.raises(StoreError, match="owner acquisition policy"):
        validate_dynamic_manifest(
            inconsistent, policy_version="spherex-dr1-owner-v1", acknowledgement=ACKNOWLEDGEMENT,
        )
