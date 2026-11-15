#!/usr/bin/env python3
"""Create the owner-controlled SPHEREx DR1 standing acquisition policy."""
import argparse
import json
import subprocess

ACKNOWLEDGEMENT = (
    "This publication makes use of data products from the Spectro-Photometer for the "
    "History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which "
    "is a joint project of the Jet Propulsion Laboratory and the California Institute "
    "of Technology, and is funded by the National Aeronautics and Space Administration."
)
POLICY = {
    "version": "spherex-dr1-owner-v1",
    "enabled": False,
    "collection": "spherex_dr1",
    "allowedCollections": ["spherex_dr1"],
    "processingVersion": "blink3-cloud-1",
    "termsChecked": True,
    "acknowledgement": ACKNOWLEDGEMENT,
    "dataDoi": "10.26131/IRSA678",
    "maxObservationsPerDetector": 12,
    "maxFileBytes": 32 * 1024**2,
    "maxTotalBytesPerDetector": 128 * 1024**2,
    "maxConcurrentDownloads": 3,
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default="spherex-blink")
    parser.add_argument("--database", default="blink3-policy")
    parser.add_argument("--apply", action="store_true", help="write the policy using ADC")
    parser.add_argument("--enable", action="store_true", help="enable public field requests (owner decision)")
    args = parser.parse_args()
    document = {**POLICY, "enabled": args.enable}
    print(json.dumps({"project": args.project, "database": args.database,
                      "document": "config/acquisition-policy",
                      "policy": document, "write": args.apply}, indent=2))
    if not args.apply:
        print("Dry run only. Add --apply to write; add --enable only when production is ready.")
        return
    from google.cloud import firestore
    try:
        import google.auth
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    except Exception:
        # On a developer workstation, the active gcloud login may exist without ADC.
        from google.oauth2.credentials import Credentials
        token = subprocess.check_output(
            ["gcloud", "auth", "print-access-token", f"--project={args.project}"], text=True
        ).strip()
        credentials = Credentials(token=token)
    db = firestore.Client(project=args.project, database=args.database, credentials=credentials)
    ref = db.collection("config").document("acquisition-policy")
    existing = ref.get()
    if existing.exists:
        old = existing.to_dict() or {}
        if old.get("version") != document["version"]:
            raise SystemExit("A different policy version already exists; review it before migration.")
    ref.set(document)


if __name__ == "__main__":
    main()
