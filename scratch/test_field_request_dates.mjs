import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const location = new URL("https://iooonut.github.io/SPHEREx-Blink-3.0/index.html?data=api&dateFrom=2024-02-01&dateTo=2024-03-31#workspace");
let replacedUrl = "";
globalThis.window = {
  location,
  history: { replaceState(_state, _title, url) { replacedUrl = url; } },
};

const { readUrlState, writeUrlState } = await import("../frontend/js/urlState.js");
assert.deepEqual(readUrlState(), { dateFrom: "2024-02-01", dateTo: "2024-03-31" });
writeUrlState({ dateFrom: "2023-07-01", dateTo: null });
assert.equal(replacedUrl, "/SPHEREx-Blink-3.0/index.html?data=api&dateFrom=2023-07-01#workspace");

const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
const main = await readFile(new URL("../frontend/js/main.js", import.meta.url), "utf8");
assert.match(html, /id="date-from-input" name="dateFrom" type="date"/);
assert.match(html, /id="date-to-input" name="dateTo" type="date"/);
assert.match(main, /archiveDateRange\.hidden = DATA_SOURCE !== "api" \|\| LEGACY_API_READ_ONLY/);
assert.match(main, /requestFieldApi\(\{ ra: query\.ra, dec: query\.dec, fov: query\.fov, dateFrom, dateTo \}\)/);

let submitted = null;
globalThis.fetch = async (_url, options) => {
  submitted = JSON.parse(options.body);
  return { ok: true, status: 200, json: async () => ({ requestId: "fr-test", status: "queued" }) };
};
const { requestFieldApi } = await import("../frontend/js/data/apiSource.js");
await requestFieldApi({ ra: 10, dec: -10, fov: 5, dateFrom: "2023-07-01", dateTo: null });
assert.equal(submitted.dateFrom, "2023-07-01");
assert.equal(submitted.dateTo, null);
assert.deepEqual(submitted.detectors, ["D1", "D2", "D3", "D4", "D5", "D6"]);

console.log("All checks passed: historical dates survive shared URLs and reach the field-request API");
