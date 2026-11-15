from cloud_app import Catalog


class FakeRegistry:
    def __init__(self, pointers):
        self.pointers = pointers

    def catalog_for_field(self, *_args, **_kwargs):
        return self.pointers


def test_combined_detector_lookup_returns_one_newest_dynamic_sequence_per_detector():
    def manifest(sequence_id, detector, latest_mjd):
        return {
            "sequenceId": sequence_id,
            "query": {"ra": 10.0, "dec": -10.0, "fov": 5.0, "det": detector},
            "originals": [{"mjd": latest_mjd}],
        }

    docs = {
        "d1-old": manifest("d1-old", "D1", 60000),
        "d1-new": manifest("d1-new", "D1", 61000),
        "d2": manifest("d2", "D2", 60500),
    }
    pointers = [{"sequenceId": key, "manifest": key, "revision": "x"} for key in docs]
    registry = FakeRegistry(pointers)
    catalog = Catalog(store=None, approved=[], pixels=True, registry=registry)
    catalog.dynamic_docs.update(docs)

    result = catalog.matching(10, -10, 5, "all")
    assert [doc["query"]["det"] for doc in result] == ["D1", "D2"]
    assert [doc["sequenceId"] for doc in result] == ["d1-new", "d2"]
