import { API_BASE, CAN_USE_BACKEND } from "./config.js?v=1";

const $ = (id) => document.getElementById(id);

async function requestEmailAction(action, payload) {
  if (!CAN_USE_BACKEND) throw new Error("Daily email reminders are not available here.");
  const response = await fetch(`${API_BASE}/api/daily-email/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.detail === "string" ? body.detail
      : "The email service is unavailable. Please try again later.");
  }
  return body.message;
}

const form = $("daily-email-form");
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  const address = $("daily-email-address");
  const status = $("daily-email-status");
  button.disabled = true;
  status.textContent = "Submitting…";
  try {
    status.textContent = await requestEmailAction("subscribe", { email: address.value });
    address.value = "";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

const actionButton = $("daily-email-action");
if (actionButton) {
  const params = new URLSearchParams(location.hash.slice(1));
  const action = ["confirm", "unsubscribe"].find((key) => params.has(key));
  const token = action && params.get(action);
  const status = $("daily-email-message");
  if (action && /^[a-f0-9]{64}\.[A-Za-z0-9_-]{32,64}$/.test(token)) {
    actionButton.hidden = false;
    actionButton.textContent = action === "confirm" ? "Confirm subscription" : "Unsubscribe";
    status.textContent = action === "confirm" ? "Confirm to receive the daily challenge by email."
      : "Stop receiving the daily challenge email.";
    actionButton.addEventListener("click", async () => {
      actionButton.disabled = true;
      try {
        status.textContent = await requestEmailAction(action, { token });
        history.replaceState(null, "", location.pathname + location.search);
        actionButton.hidden = true;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        actionButton.disabled = false;
      }
    });
  } else {
    status.textContent = "Open a confirmation or unsubscribe link from a reminder email.";
  }
}
