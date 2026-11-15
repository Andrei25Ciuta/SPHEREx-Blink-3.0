import sys
import types

import pytest

from spherex.firestore_state import FirestoreState, StateUnavailable


def test_state_and_owner_policy_use_separate_named_firestore_databases(monkeypatch):
    clients = []

    class FakeClient:
        def __init__(self, *, database):
            self.database = database
            clients.append(self)

    firestore = types.ModuleType("google.cloud.firestore")
    firestore.Client = FakeClient
    transaction = types.ModuleType("google.cloud.firestore_v1.transaction")
    transaction.transactional = lambda function: function
    firestore_v1 = types.ModuleType("google.cloud.firestore_v1")
    google = types.ModuleType("google")
    cloud = types.ModuleType("google.cloud")
    google.cloud = cloud
    cloud.firestore = firestore
    cloud.firestore_v1 = firestore_v1
    monkeypatch.setitem(sys.modules, "google", google)
    monkeypatch.setitem(sys.modules, "google.cloud", cloud)
    monkeypatch.setitem(sys.modules, "google.cloud.firestore", firestore)
    monkeypatch.setitem(sys.modules, "google.cloud.firestore_v1", firestore_v1)
    monkeypatch.setitem(sys.modules, "google.cloud.firestore_v1.transaction", transaction)
    monkeypatch.setenv("BLINK_FIRESTORE_DATABASE", "blink3-state")
    monkeypatch.setenv("BLINK_POLICY_FIRESTORE_DATABASE", "blink3-policy")

    state = FirestoreState()
    assert state.db.database == "blink3-state"
    assert state.policy_db.database == "blink3-policy"
    assert len(clients) == 2


def test_owner_policy_requires_approved_dr1_doi():
    policy = {
        "enabled": True, "version": "spherex-dr1-owner-v1", "collection": "spherex_dr1",
        "allowedCollections": ["spherex_dr1"], "termsChecked": True,
        "acknowledgement": "This is the approved official SPHEREx DR1 acknowledgement text.",
        "dataDoi": "10.26131/IRSA678",
    }

    class Snapshot:
        exists = True
        def to_dict(self):
            return policy

    class Document:
        def get(self):
            return Snapshot()

    class Collection:
        def document(self, _name):
            return Document()

    state = object.__new__(FirestoreState)
    state.policy_db = type("PolicyDB", (), {"collection": lambda _self, _name: Collection()})()
    assert state.policy()["dataDoi"] == "10.26131/IRSA678"

    policy["dataDoi"] = "10.26131/OTHER"
    with pytest.raises(StateUnavailable, match="DOI"):
        state.policy()
