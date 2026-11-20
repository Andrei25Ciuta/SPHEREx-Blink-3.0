"""Opt-in challenge reminders. The public API can subscribe; only a private job sends reminders."""

from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import parseaddr
import hashlib
import hmac
import os
import re
import secrets
import smtplib
import ssl
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

BUCHAREST = ZoneInfo("Europe/Bucharest")
EMAIL = re.compile(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+")
TOKEN = re.compile(r"([a-f0-9]{64})\.([A-Za-z0-9_-]{32,64})")


class DailyEmailUnavailable(Exception):
    pass


class DailyEmailLimit(Exception):
    pass


def normalize_email(value):
    address = value.strip().lower()
    local = address.split("@", 1)[0]
    if (len(address) > 254 or len(local) > 64 or ".." in local
            or local.startswith(".") or local.endswith(".") or not EMAIL.fullmatch(address)):
        raise ValueError("Enter a valid email address.")
    return address


class FirestoreSubscriptions:
    def __init__(self, client, transactional):
        self.db = client
        self.run_transaction = transactional
        self.subscriptions = client.collection("dailyEmailSubscriptions")
        self.limits = client.collection("dailyEmailLimits")

    def change(self, key, update, *, budget_day=None, limit=100):
        ref = self.subscriptions.document(key)
        budget = self.limits.document(budget_day) if budget_day else None

        @self.run_transaction
        def apply(tx):
            old = ref.get(transaction=tx).to_dict() or {}
            replacement = update(old)
            if replacement is None:
                return False
            if budget is not None:
                count = (budget.get(transaction=tx).to_dict() or {}).get("count", 0)
                if count >= limit:
                    raise DailyEmailLimit
                tx.set(budget, {"count": count + 1})
            if replacement:
                tx.set(ref, replacement)
            else:
                tx.delete(ref)
            return True

        return apply(self.db.transaction())

    def entries(self):
        for doc in self.subscriptions.stream():
            yield doc.id, doc.to_dict()


class SMTPMailer:
    def __init__(self, host, port, sender, username, password):
        self.host, self.port, self.sender = host, port, sender
        self.username, self.password = username, password

    def send(self, address, subject, body):
        message = EmailMessage()
        message["From"] = self.sender
        message["To"] = address
        message["Subject"] = subject
        message.set_content(body)
        with smtplib.SMTP_SSL(self.host, self.port, timeout=15, context=ssl.create_default_context()) as smtp:
            if self.username:
                smtp.login(self.username, self.password)
            smtp.send_message(message)


class DailyEmail:
    def __init__(self, store, mailer, site_url, key, *, daily_limit=100, now=None):
        self.store, self.mailer, self.site_url = store, mailer, site_url.rstrip("/")
        self.key, self.daily_limit = key, daily_limit
        self.now = now or (lambda: datetime.now(timezone.utc))

    def mac(self, value):
        return hmac.new(self.key, value.encode(), hashlib.sha256).hexdigest()

    def manage_link(self, action, token):
        # The fragment avoids sending a management token in the static site's HTTP logs.
        return f"{self.site_url}/daily-email.html#{action}={token}"

    def unsubscribe_proof(self, key, record):
        return self.mac(f"unsubscribe:{key}:{record['generation']}")

    def subscribe(self, email):
        address = normalize_email(email)
        key = self.mac(f"email:{address}")
        secret = secrets.token_urlsafe(32)
        digest = self.mac(secret)
        now = self.now()
        pending = {
            "email": address, "created": now, "expires": now + timedelta(hours=24),
            "confirm": digest, "generation": secrets.token_hex(16), "active": False,
        }

        def reserve(old):
            if old.get("active") or (old and old["created"] > now - timedelta(hours=6)):
                return None
            return pending

        if not self.store.change(key, reserve, budget_day=now.date().isoformat(), limit=self.daily_limit):
            return
        confirm = self.manage_link("confirm", f"{key}.{secret}")
        unsubscribe = self.manage_link("unsubscribe", f"{key}.{self.unsubscribe_proof(key, pending)}")
        try:
            self.mailer.send(address, "Confirm your SPHEREx Blink daily reminder",
                             "Confirm to receive one daily challenge reminder at 09:00 Bucharest time.\n\n"
                             f"{confirm}\n\nLink expires after 24 hours.\n\nCancel this request: {unsubscribe}")
        except (OSError, smtplib.SMTPException) as exc:
            self.store.change(key, lambda old: {} if not old.get("active") and old.get("confirm") == digest else None)
            raise DailyEmailUnavailable from exc

    def manage(self, action, token):
        match = TOKEN.fullmatch(token)
        if not match:
            return False
        key, secret = match.groups()
        now = self.now()

        def manage_record(old):
            if not old:
                return None
            if action == "unsubscribe":
                return {} if hmac.compare_digest(self.unsubscribe_proof(key, old), secret) else None
            if not hmac.compare_digest(old["confirm"], self.mac(secret)):
                return None
            if old.get("active"):
                return old
            if old["expires"] <= now:
                return None
            return {**old, "active": True}

        return self.store.change(key, manage_record)

    def send_daily(self):
        now = self.now()
        local = now.astimezone(BUCHAREST)
        if local.hour < 9:
            return 0, 0
        day = local.date().isoformat()
        sent = failed = 0
        for key, record in self.store.entries():
            if not record["active"]:
                if record["expires"] <= now:
                    self.store.change(key, lambda old: {} if old and not old["active"] and old["expires"] <= now else None)
                continue

            def reserve(old):
                if not old or not old["active"] or old["generation"] != record["generation"] or old.get("day") == day:
                    return None
                return {**old, "day": day}

            # Claim before SMTP. A retry cannot duplicate a message accepted by the relay.
            if not self.store.change(key, reserve):
                continue
            unsubscribe = self.manage_link("unsubscribe", f"{key}.{self.unsubscribe_proof(key, record)}")
            try:
                self.mailer.send(record["email"], "Today’s field is ready",
                                 f"Open today’s SPHEREx Blink challenge:\n{self.site_url}/daily.html?challenge=real\n\n"
                                 f"Unsubscribe: {unsubscribe}")
                sent += 1
            except (OSError, smtplib.SMTPException):
                failed += 1
        return sent, failed


def daily_email_from_env():
    if os.getenv("BLINK_EMAIL_ENABLED") != "true":
        return None
    site_url = os.environ["BLINK_EMAIL_SITE_URL"].rstrip("/")
    parsed = urlsplit(site_url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
            or parsed.query or parsed.fragment):
        raise ValueError("BLINK_EMAIL_SITE_URL must be an HTTPS site URL without a query or fragment")
    key = os.environ["BLINK_EMAIL_KEY"].encode()
    if len(key) < 32:
        raise ValueError("BLINK_EMAIL_KEY must be at least 32 bytes")
    sender = os.environ["BLINK_SMTP_FROM"]
    normalize_email(parseaddr(sender)[1])
    mailer = SMTPMailer(os.environ["BLINK_SMTP_HOST"], int(os.getenv("BLINK_SMTP_PORT", "465")),
                        sender, os.getenv("BLINK_SMTP_USER"), os.getenv("BLINK_SMTP_PASSWORD"))
    from google.cloud import firestore
    from google.cloud.firestore_v1.transaction import transactional
    client = firestore.Client(database=os.getenv("BLINK_FIRESTORE_DATABASE", "blink3-state"))
    return DailyEmail(FirestoreSubscriptions(client, transactional), mailer, site_url, key,
                      daily_limit=int(os.getenv("BLINK_EMAIL_CONFIRM_LIMIT", "100")))


class EmailRequest(BaseModel):
    email: str = Field(max_length=254)


class TokenRequest(BaseModel):
    token: str = Field(max_length=129)


def daily_email_router(service):
    router = APIRouter(prefix="/api/daily-email")

    def require_service():
        if service is None:
            raise HTTPException(503, "Daily email reminders are not enabled yet.")
        return service

    @router.post("/subscribe", status_code=202)
    def subscribe(payload: EmailRequest):
        try:
            require_service().subscribe(payload.email)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except DailyEmailLimit as exc:
            raise HTTPException(429, "Try again tomorrow.") from exc
        except DailyEmailUnavailable as exc:
            raise HTTPException(503, "Unable to send a confirmation right now. Try again later.") from exc
        return {"message": "If confirmation is needed, check your inbox for a link."}

    @router.post("/{action}")
    def manage(action: str, payload: TokenRequest):
        if action not in ("confirm", "unsubscribe"):
            raise HTTPException(404)
        updated = require_service().manage(action, payload.token)
        if not updated and action == "confirm":
            raise HTTPException(400, "This confirmation link is invalid or expired.")
        return {"message": "Daily emails enabled." if action == "confirm" else "Daily emails stopped for this link."}

    return router


def main():
    service = daily_email_from_env()
    if service is None:
        raise SystemExit("Daily email reminders are disabled.")
    sent, failed = service.send_daily()
    print(f"Daily reminders: sent={sent}, failed={failed}")
    return int(failed > 0)


if __name__ == "__main__":
    raise SystemExit(main())
