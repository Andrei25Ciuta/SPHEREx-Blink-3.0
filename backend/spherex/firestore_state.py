"""Durable Firestore state for acquisition requests, detector slots and catalog entries."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os

from .cloud_limits import MAX_ACTIVE_DOWNLOAD_JOBS
from .field_requests import aggregate_progress, detector_progress


class StateUnavailable(RuntimeError):
    pass


class FirestoreState:
    def __init__(self, client=None, policy_client=None):
        try:
            from google.cloud import firestore
            self._firestore = firestore
            from google.cloud.firestore_v1.transaction import transactional
            self._transactional = transactional
        except ImportError as exc:
            raise StateUnavailable("Firestore client library is unavailable") from exc
        make_clients = client is None
        self.db = client or firestore.Client(database=os.getenv("BLINK_FIRESTORE_DATABASE", "blink3-state"))
        self.policy_db = policy_client or (
            firestore.Client(database=os.getenv("BLINK_POLICY_FIRESTORE_DATABASE", "blink3-policy"))
            if make_clients else self.db
        )

    def policy(self, *, require_enabled=True):
        snapshot = self.policy_db.collection("config").document("acquisition-policy").get()
        if not snapshot.exists:
            raise StateUnavailable("The administrator acquisition policy is not configured")
        value = snapshot.to_dict() or {}
        if require_enabled and value.get("enabled") is not True:
            raise StateUnavailable("New SPHEREx data requests are temporarily disabled")
        if value.get("collection") != "spherex_dr1" or value.get("termsChecked") is not True:
            raise StateUnavailable("The configured archive policy is incomplete")
        if value.get("allowedCollections", ["spherex_dr1"]) != ["spherex_dr1"]:
            raise StateUnavailable("Only SPHEREx DR1 is enabled by the current policy")
        if (not 1 <= int(value.get("maxObservationsPerDetector", 12)) <= 12
                or not 0 < int(value.get("maxFileBytes", 32 * 1024**2)) <= 32 * 1024**2
                or not 0 < int(value.get("maxTotalBytesPerDetector", 128 * 1024**2)) <= 128 * 1024**2
                or not 1 <= int(value.get("maxConcurrentDownloads", MAX_ACTIVE_DOWNLOAD_JOBS))
                <= MAX_ACTIVE_DOWNLOAD_JOBS):
            raise StateUnavailable("The configured workload exceeds the approved DR1 bounds")
        if not isinstance(value.get("acknowledgement"), str) or len(value["acknowledgement"].strip()) < 50:
            raise StateUnavailable("The configured SPHEREx acknowledgement is missing")
        if value.get("dataDoi") != "10.26131/IRSA678":
            raise StateUnavailable("The configured SPHEREx DR1 DOI is missing or unsupported")
        return value

    def create_request(self, normalized, policy):
        request_id = normalized["requestId"]
        ref = self.db.collection("fieldRequests").document(request_id)
        transaction = self.db.transaction()

        @self._transactional
        def create(tx):
            snapshot = ref.get(transaction=tx)
            if snapshot.exists:
                return snapshot.to_dict(), False
            detectors = {
                detector: {
                    "status": "queued", "phase": "queued", "progress": 0.0,
                    "attempt": 0, "completedFiles": 0, "totalFiles": 0,
                    "downloadedBytes": 0, "frameCount": 0,
                }
                for detector in normalized["detectors"]
            }
            doc = {
                "requestId": request_id,
                "fieldKey": normalized["fieldKey"],
                "query": normalized["query"],
                "collection": normalized["collection"],
                "processingVersion": normalized["processingVersion"],
                "detectors": detectors,
                "selection": normalized["selection"],
                "dateFrom": normalized["dateFrom"], "dateTo": normalized["dateTo"],
                "mjdStart": normalized["mjdStart"], "mjdEnd": normalized["mjdEnd"],
                "policyVersion": policy["version"],
                "acknowledgement": policy["acknowledgement"],
                "dataDoi": policy["dataDoi"],
                "status": "queued", "progress": 0.0,
                "createdAt": self._firestore.SERVER_TIMESTAMP,
                "updatedAt": self._firestore.SERVER_TIMESTAMP,
            }
            tx.create(ref, doc)
            return doc, True

        return create(transaction)

    def get_request(self, request_id):
        snap = self.db.collection("fieldRequests").document(request_id).get()
        return snap.to_dict() if snap.exists else None

    def update_request(self, request_id, changes):
        ref = self.db.collection("fieldRequests").document(request_id)
        changes = {**changes, "updatedAt": self._firestore.SERVER_TIMESTAMP}
        ref.set(changes, merge=True)
        return ref.get().to_dict()

    def update_detector(self, request_id, detector, changes):
        ref = self.db.collection("fieldRequests").document(request_id)
        transaction = self.db.transaction()

        @self._transactional
        def update(tx):
            snapshot = ref.get(transaction=tx)
            if not snapshot.exists:
                return None
            doc = snapshot.to_dict()
            detectors = doc.get("detectors", {})
            previous = detectors.get(detector)
            if previous is None:
                return doc
            merged = detector_progress(changes, previous)
            detectors[detector] = merged
            aggregate = aggregate_progress(detectors)
            doc.update({"detectors": detectors, **aggregate,
                        "updatedAt": self._firestore.SERVER_TIMESTAMP})
            tx.set(ref, doc)
            return doc

        return update(transaction)

    def claim_slot(self, request_id, detector, attempt_id,
                   max_active=MAX_ACTIVE_DOWNLOAD_JOBS):
        request_ref = self.db.collection("fieldRequests").document(request_id)
        slot_ref = self.db.collection("jobSlots").document(f"{request_id}-{detector.lower()}")
        control_ref = self.db.collection("jobControl").document("global")
        transaction = self.db.transaction()

        @self._transactional
        def claim(tx):
            request_snapshot = request_ref.get(transaction=tx)
            if not request_snapshot.exists:
                return "missing"
            request = request_snapshot.to_dict()
            detector_state = request.get("detectors", {}).get(detector, {})
            slot_snapshot = slot_ref.get(transaction=tx)
            if slot_snapshot.exists:
                slot = slot_snapshot.to_dict()
                if slot.get("attemptId") == attempt_id:
                    return "already-claimed"
                return "active"
            if detector_state.get("status") in ("ready", "unavailable"):
                return "terminal"
            control_snapshot = control_ref.get(transaction=tx)
            active = int((control_snapshot.to_dict() or {}).get("activeJobs", 0)) if control_snapshot.exists else 0
            if active >= max_active:
                return "full"
            now = datetime.now(timezone.utc)
            tx.set(control_ref, {"activeJobs": active + 1, "updatedAt": self._firestore.SERVER_TIMESTAMP}, merge=True)
            tx.create(slot_ref, {
                "requestId": request_id, "detector": detector,
                "attemptId": attempt_id, "state": "launching", "createdAt": now,
                "updatedAt": self._firestore.SERVER_TIMESTAMP,
            })
            return "claimed"

        return claim(transaction)

    def attach_execution(self, request_id, detector, attempt_id, execution_name):
        slot_ref = self.db.collection("jobSlots").document(f"{request_id}-{detector.lower()}")
        snapshot = slot_ref.get()
        if snapshot.exists and snapshot.to_dict().get("attemptId") == attempt_id:
            slot_ref.set({"executionName": execution_name, "state": "running",
                          "updatedAt": self._firestore.SERVER_TIMESTAMP}, merge=True)

    def heartbeat_slot(self, request_id, detector, attempt_id):
        slot_ref = self.db.collection("jobSlots").document(f"{request_id}-{detector.lower()}")
        snapshot = slot_ref.get()
        if snapshot.exists and snapshot.to_dict().get("attemptId") == attempt_id:
            slot_ref.set({"updatedAt": self._firestore.SERVER_TIMESTAMP}, merge=True)

    def claim_job_execution(self, request_id, detector, attempt_id, execution_name):
        slot_ref = self.db.collection("jobSlots").document(f"{request_id}-{detector.lower()}")
        transaction = self.db.transaction()

        @self._transactional
        def claim(tx):
            snapshot = slot_ref.get(transaction=tx)
            if not snapshot.exists or snapshot.to_dict().get("attemptId") != attempt_id:
                return False
            slot = snapshot.to_dict()
            owner = slot.get("workerExecution")
            if owner and owner != execution_name:
                return False
            tx.set(slot_ref, {"workerExecution": execution_name, "state": "running",
                              "updatedAt": self._firestore.SERVER_TIMESTAMP}, merge=True)
            return True

        return claim(transaction)

    def claim_work_lock(self, lock_id, owner, *, lease_seconds=1800):
        ref = self.db.collection("requestLocks").document(lock_id)
        transaction = self.db.transaction()

        @self._transactional
        def claim(tx):
            snapshot = ref.get(transaction=tx)
            now = datetime.now(timezone.utc)
            if snapshot.exists:
                value = snapshot.to_dict() or {}
                expires = value.get("expiresAt")
                if expires and expires.replace(tzinfo=timezone.utc) > now:
                    return False
            tx.set(ref, {"owner": owner, "expiresAt": now + timedelta(seconds=lease_seconds),
                         "updatedAt": self._firestore.SERVER_TIMESTAMP})
            return True

        return claim(transaction)

    def work_lock_active(self, lock_id):
        snapshot = self.db.collection("requestLocks").document(lock_id).get()
        if not snapshot.exists:
            return False
        expires = (snapshot.to_dict() or {}).get("expiresAt")
        return bool(expires and expires.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc))

    def release_work_lock(self, lock_id, owner):
        ref = self.db.collection("requestLocks").document(lock_id)
        transaction = self.db.transaction()

        @self._transactional
        def release(tx):
            snapshot = ref.get(transaction=tx)
            if not snapshot.exists or (snapshot.to_dict() or {}).get("owner") != owner:
                return False
            tx.delete(ref)
            return True

        return release(transaction)

    def release_slot(self, request_id, detector, attempt_id):
        slot_ref = self.db.collection("jobSlots").document(f"{request_id}-{detector.lower()}")
        control_ref = self.db.collection("jobControl").document("global")
        transaction = self.db.transaction()

        @self._transactional
        def release(tx):
            slot = slot_ref.get(transaction=tx)
            if not slot.exists or slot.to_dict().get("attemptId") != attempt_id:
                return False
            control = control_ref.get(transaction=tx)
            active = int((control.to_dict() or {}).get("activeJobs", 0)) if control.exists else 0
            tx.delete(slot_ref)
            tx.set(control_ref, {"activeJobs": max(0, active - 1),
                                 "updatedAt": self._firestore.SERVER_TIMESTAMP}, merge=True)
            return True

        return release(transaction)

    def active_slots(self, limit=100):
        return [snapshot.to_dict() for snapshot in self.db.collection("jobSlots").limit(limit).stream()]

    def queued_requests(self, limit=100):
        query = self.db.collection("fieldRequests").where("status", "in", ["queued", "running", "partial", "discovering"])
        return [snapshot.to_dict() for snapshot in query.limit(limit).stream()]

    def register_catalog(self, request, detector, manifest_key, manifest):
        sequence_id = manifest["sequenceId"]
        ref = self.db.collection("fieldCatalog").document(sequence_id)
        doc = {
            "sequenceId": sequence_id, "requestId": request["requestId"],
            "fieldKey": request["fieldKey"], "detector": detector,
            "ra": request["query"]["ra"], "dec": request["query"]["dec"],
            "fov": request["query"]["fov"],
            "raKey": f"{request['query']['ra']:.8f}",
            "decKey": f"{request['query']['dec']:.8f}",
            "fovKey": f"{request['query']['fov']:.4f}",
            "collection": request["collection"],
            "processingVersion": request["processingVersion"],
            "manifest": manifest_key, "revision": manifest["revision"],
            "frameCount": len(manifest["frames"]),
            "dateFrom": request.get("dateFrom"), "dateTo": request.get("dateTo"),
            "latestMjd": max((float(item["mjd"]) for item in manifest.get("originals", [])
                              if item.get("mjd") is not None), default=0.0),
            "policyVersion": request["policyVersion"],
            "readyAt": self._firestore.SERVER_TIMESTAMP,
        }
        try:
            ref.create(doc)
        except Exception:
            existing = ref.get()
            if not existing.exists or existing.to_dict().get("manifest") != manifest_key:
                raise
        self.update_detector(request["requestId"], detector, {
            "status": "ready", "phase": "ready", "progress": 1.0,
            "sequenceId": sequence_id, "manifest": manifest_key,
            "revision": manifest["revision"], "frameCount": len(manifest["frames"]),
            "error": None,
        })
        return doc

    def catalog_doc(self, sequence_id):
        snap = self.db.collection("fieldCatalog").document(sequence_id).get()
        return snap.to_dict() if snap.exists else None

    def catalog_for_request(self, request_id):
        return [s.to_dict() for s in self.db.collection("fieldCatalog").where("requestId", "==", request_id).limit(6).stream()]

    def catalog_for_field(self, ra, dec, fov, detector="all", limit=100):
        if detector == "all":
            return [pointer for item in (f"D{i}" for i in range(1, 7))
                    for pointer in self.catalog_for_field(ra, dec, fov, item, limit=1)]
        query = self.db.collection("fieldCatalog").where("raKey", "==", f"{ra:.8f}")
        query = query.where("decKey", "==", f"{dec:.8f}").where("fovKey", "==", f"{fov:.4f}")
        query = query.where("collection", "==", "spherex_dr1").where("processingVersion", "==", "blink3-cloud-1")
        if detector != "all":
            query = query.where("detector", "==", detector)
        query = query.order_by("latestMjd", direction=self._firestore.Query.DESCENDING)
        return [s.to_dict() for s in query.limit(limit).stream()]

    def list_catalog(self, limit=50, after=None):
        query = self.db.collection("fieldCatalog").order_by("sequenceId").limit(limit)
        if after:
            snapshot = self.db.collection("fieldCatalog").document(after).get()
            if snapshot.exists:
                query = query.start_after(snapshot)
        docs = list(query.stream())
        return [s.to_dict() for s in docs], (docs[-1].id if len(docs) == limit else None)

    def reset_expired_slot(self, slot, *, lease_seconds=600):
        updated = slot.get("updatedAt") or slot.get("createdAt")
        if not updated or (datetime.now(timezone.utc) - updated.replace(tzinfo=timezone.utc)).total_seconds() < lease_seconds:
            return False
        return self.release_slot(slot["requestId"], slot["detector"], slot["attemptId"])
