from datetime import datetime, timedelta, timezone
import re
import smtplib

from fastapi import FastAPI
from fastapi.testclient import TestClient

from spherex.daily_email import DailyEmail, daily_email_router


class MemorySubscriptions:
    def __init__(self):
        self.records = {}
        self.budgets = {}

    def change(self, key, update, *, budget_day=None, limit=100):
        from spherex.daily_email import DailyEmailLimit
        replacement = update(self.records.get(key, {}))
        if replacement is None:
            return False
        if budget_day:
            count = self.budgets.get(budget_day, 0)
            if count >= limit:
                raise DailyEmailLimit
            self.budgets[budget_day] = count + 1
        if replacement:
            self.records[key] = replacement
        else:
            self.records.pop(key, None)
        return True

    def entries(self):
        return list(self.records.items())


class RecordingMailer:
    def __init__(self):
        self.messages = []
        self.fail = False

    def send(self, address, subject, body):
        if self.fail:
            raise smtplib.SMTPServerDisconnected("test failure")
        self.messages.append((address, subject, body))


def setup():
    time = [datetime(2026, 11, 20, 7, tzinfo=timezone.utc)]
    store, mailer = MemorySubscriptions(), RecordingMailer()
    service = DailyEmail(store, mailer, "https://example.test/blink", b"test-key",
                         daily_limit=2, now=lambda: time[0])
    app = FastAPI()
    app.include_router(daily_email_router(service))
    return TestClient(app), service, mailer, time


def token(body, operation):
    return re.search(r"#" + operation + r"=([\w.-]+)", body)[1]


def test_daily_reminder_requires_confirmation_and_is_idempotent():
    client, service, mailer, time = setup()
    endpoint = "/api/daily-email"
    payload = {"email": "Observer@example.test"}
    assert client.post(f"{endpoint}/subscribe", json=payload).status_code == 202
    assert client.post(f"{endpoint}/subscribe", json=payload).status_code == 202
    assert len(mailer.messages) == 1
    address, _, confirmation = mailer.messages[0]
    assert address == "observer@example.test"
    assert service.send_daily() == (0, 0)
    confirm = {"token": token(confirmation, "confirm")}
    assert client.get(f"{endpoint}/confirm").status_code == 405
    assert client.post(f"{endpoint}/confirm", json=confirm).status_code == 200
    assert service.send_daily() == (1, 0)
    assert service.send_daily() == (0, 0)
    assert mailer.messages[-1][1] == "Today’s field is ready"
    assert "https://example.test/blink/daily.html?challenge=real" in mailer.messages[-1][2]
    time[0] += timedelta(days=1)
    assert service.send_daily() == (1, 0)
    unsubscribe = {"token": token(mailer.messages[-1][2], "unsubscribe")}
    assert client.get(f"{endpoint}/unsubscribe").status_code == 405
    assert client.post(f"{endpoint}/unsubscribe", json=unsubscribe).status_code == 200
    time[0] += timedelta(days=1)
    assert service.send_daily() == (0, 0)
    assert client.post(f"{endpoint}/confirm", json=confirm).status_code == 400


def test_expired_confirmation_and_budget():
    client, service, mailer, time = setup()
    assert client.post("/api/daily-email/subscribe", json={"email": "invalid"}).status_code == 422
    for name in ["one", "two"]:
        assert client.post("/api/daily-email/subscribe", json={"email": f"{name}@example.test"}).status_code == 202
    assert client.post("/api/daily-email/subscribe", json={"email": "three@example.test"}).status_code == 429
    expired = {"token": token(mailer.messages[0][2], "confirm")}
    time[0] += timedelta(hours=24)
    assert client.post("/api/daily-email/confirm", json=expired).status_code == 400
    assert service.send_daily() == (0, 0)
    assert not service.store.records


def test_failed_confirmation_allows_retry_and_summer_schedule():
    client, service, mailer, time = setup()
    time[0] = datetime(2026, 7, 1, 5, 59, tzinfo=timezone.utc)
    payload = {"email": "observer@example.test"}
    mailer.fail = True
    assert client.post("/api/daily-email/subscribe", json=payload).status_code == 503
    mailer.fail = False
    assert client.post("/api/daily-email/subscribe", json=payload).status_code == 202
    proof = {"token": token(mailer.messages[0][2], "confirm")}
    assert client.post("/api/daily-email/confirm", json=proof).status_code == 200
    assert service.send_daily() == (0, 0)
    time[0] += timedelta(minutes=1)
    assert service.send_daily() == (1, 0)


def test_unconfigured_service_does_not_accept_registration():
    app = FastAPI()
    app.include_router(daily_email_router(None))
    response = TestClient(app).post("/api/daily-email/subscribe", json={"email": "observer@example.test"})
    assert response.status_code == 503
