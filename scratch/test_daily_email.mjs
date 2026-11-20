import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const home = await readFile(new URL("../frontend/overview.html", import.meta.url), "utf8");
assert.match(home, /Remind me daily/);
assert.match(home, /id="daily-email-address" type="email"/);

const nodes = new Map();
globalThis.document = { getElementById: (id) => nodes.get(id) ?? null };
const listener = {
  addEventListener(event, callback) { this[event] = callback; },
};
const submitButton = {};
const form = { ...listener, querySelector: () => submitButton };
nodes.set("daily-email-form", form);
nodes.set("daily-email-address", { value: "observer@example.test" });
nodes.set("daily-email-status", {});

globalThis.location = { hostname: "localhost", search: "", hash: "", pathname: "/daily-email.html" };
const actions = [];
globalThis.fetch = async (url, options) => {
  actions.push({ url, method: options.method, body: JSON.parse(options.body) });
  return Response.json({ message: "Success" });
};

await import("../frontend/js/dailyEmail.js");
assert.equal(actions.length, 0);
await form.submit({ preventDefault() {} });
assert.deepEqual(actions[0], {
  url: "http://localhost:8001/api/daily-email/subscribe", method: "POST",
  body: { email: "observer@example.test" },
});
assert.equal(nodes.get("daily-email-address").value, "");

nodes.delete("daily-email-form");
const button = { ...listener, hidden: true };
nodes.set("daily-email-action", button);
nodes.set("daily-email-message", {});
const token = "a".repeat(64) + "." + "b".repeat(43);
location.hash = "#unsubscribe=" + token;
globalThis.history = { replaceState() { location.hash = ""; } };
await import("../frontend/js/dailyEmail.js?manage");
assert.equal(actions.length, 1);
assert.equal(button.textContent, "Unsubscribe");
await button.click();
assert.deepEqual(actions[1], {
  url: "http://localhost:8001/api/daily-email/unsubscribe", method: "POST",
  body: { token },
});
assert.equal(button.hidden, true);
assert.equal(location.hash, "");
console.log("PASS email form and explicit confirmation-page action");
