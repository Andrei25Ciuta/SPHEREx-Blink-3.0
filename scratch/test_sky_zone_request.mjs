// P3 offline integration: real URL parser, API client and request lifecycle;
// HTTP/status/cutout/decoding results are local fixtures, never live traffic.
import assert from "node:assert/strict";
import { createSkyZoneRequestFlow } from "../frontend/js/data/skyZoneRequest.js";
import { loadFieldRequestCutouts } from "../frontend/js/data/fieldRequests.js";
import { readSkyZoneRequest, readWorkspaceStartup, writeUrlState } from "../frontend/js/urlState.js";

const base = "http://127.0.0.1:8765";
const idA = `fr-${"a".repeat(32)}`;
const idB = `fr-${"b".repeat(32)}`;
const qa = { ra: 120.12345678, dec: -7.25, fov: 7.25 };
const qb = { ra: 1e-8, dec: 90, fov: 10 };
const pilotUrl = (query, id) => new URL(`/index.html?${new URLSearchParams({
  data: "api", sky_browse: 1, api: base, ...query, request_id: id, mode: "diff", embed: 1,
})}#workspace`, base);
const workspaceUrl = (query, id, embedded = false) => {
  const url = pilotUrl(query, id);
  url.searchParams.delete("sky_browse");
  if (!embedded) url.searchParams.delete("embed");
  if (id === undefined) url.searchParams.delete("request_id");
  return url;
};
globalThis.location = pilotUrl(qa, idA);
const { getCutouts } = await import("../frontend/js/data/getCutouts.js");
const { requestFieldApi, getFieldRequestApi, retryFieldRequestApi } = await import("../frontend/js/data/apiSource.js");

const fromUrl = (url) => readSkyZoneRequest(url.searchParams);
assert.deepEqual(fromUrl(pilotUrl(qa, idA)), { query: qa, requestId: idA });
assert.deepEqual(fromUrl(pilotUrl(qb, idB)), { query: qb, requestId: idB });
for (const change of [
  (p) => p.delete("request_id"), (p) => p.append("request_id", idA), (p) => p.set("request_id", `${idA}\n`),
  (p) => p.set("request_id", idA.toUpperCase()), (p) => p.set("request_id", "fixture-id"),
  (p) => p.set("data", "mock"), (p) => p.delete("ra"), (p) => p.delete("dec"), (p) => p.delete("fov"),
  (p) => p.append("ra", qa.ra), (p) => p.set("fov", ""), (p) => p.set("fov", " 7.25"),
  (p) => p.set("ra", "08:00:00"), (p) => p.set("ra", "360"), (p) => p.set("ra", "120.123456781"),
  (p) => p.set("dec", "-90.00000001"), (p) => p.set("fov", "7.25001"), (p) => p.set("fov", "0x7"), (p) => p.set("fov", "11"),
]) {
  const url = pilotUrl(qa, idA);
  change(url.searchParams);
  assert.equal(fromUrl(url), null, url.href);
}

const statusRoute = (id) => `/api/field-requests/${id}`;
const submitRoute = "/api/field-requests";
const retryRoute = (id) => `${statusRoute(id)}/retry`;
const readRoute = "/api/cutouts";
const detectorStates = (otherwise, overrides = {}) => Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => {
  const id = `D${n}`;
  return [id, { status: overrides[id] ?? otherwise }];
}));
const status = (requestId, query, overall, otherwise, overrides) =>
  ({ requestId, query, status: overall, detectors: detectorStates(otherwise, overrides), progress: 0.42 });
const queueA = status(idA, qa, "queued", "queued");
const noCoverageB = status(idB, qb, "unavailable", "unavailable");
const failedA = status(idA, qa, "failed", "failed");
const readyA = status(idA, qa, "partial", "unavailable", { D1: "ready" });
const partialA = status(idA, qa, "partial", "unavailable", { D1: "ready", D2: "failed" });
const pendingA = status(idA, qa, "partial", "queued", { D1: "ready" });
const frame = (detector) => ({ detector, mjd: 60000, dateISO: "2023-02-25T00:00:00Z",
  wavelengthMinUm: 0.75, wavelengthMaxUm: 1.09, imageUrl: `mock-${detector}.png`, flags: null, dataKind: "synthetic" });
const frames = (id) => Response.json({ frames: [frame(id)] });
const json = (value) => () => Response.json(value);
const deferred = () => Promise.withResolvers();
const settle = () => new Promise(setImmediate);

function harness({ url = pilotUrl(qa, idA), render = async () => {} } = {}) {
  const routes = [], calls = [], events = [];
  let token = 0;
  globalThis.window = {
    location: url,
    history: { replaceState(_state, _title, parts) { window.location = new URL(parts, base); } },
  };
  globalThis.fetch = async (href, options) => {
    const method = options.method ?? "GET";
    const request = new URL(href);
    assert.equal(request.origin, base);
    calls.push({ method, request, options });
    const next = routes.shift();
    // Record unexpected calls even if a production error handler catches them.
    if (next?.method !== method || next?.path !== request.pathname) {
      events.push(["unexpected HTTP", method, request.pathname]);
      throw new Error(`Unexpected ${method} ${request.pathname}`);
    }
    return next.reply(request, options);
  };
  const flow = createSkyZoneRequestFlow({
    requestField: requestFieldApi, getStatus: getFieldRequestApi, retryField: retryFieldRequestApi,
    writeUrl(updates) {
      writeUrlState(updates);
      events.push(["write", window.location.searchParams.get("request_id")]);
    },
    reset: (query) => { events.push(["reset", query]); return ++token; },
    checking: ({ requestId }) => events.push(["checking", requestId]),
    attached: ({ requestId }) => events.push(["attached", requestId]),
    async update(next, scope) {
      events.push(["status", next.requestId, next.status, Boolean(next.pollError)]);
      if (next.pollError || !Object.values(next.detectors).some(item => item.status === "ready")) return;
      const result = await loadFieldRequestCutouts({
        ...scope, getCutouts,
        isCurrent: () => !scope.signal.aborted && token === scope.token,
        applyFrames: async (cutouts) => {
          events.push(["decode", cutouts.map(item => item.detector)]);
          await render(cutouts);
        },
      });
      if (result) events.push([result.stage ?? "frames", result.frames?.map(item => item.detector)]);
    },
    complete: ({ requestId, status: state }) => events.push(["terminal", requestId, state]),
    failed: (message, { origin }) => events.push(["failed", message, origin]),
    accepted: ({ requestId }) => events.push(["accepted", requestId]),
    unsupported: (query, dates, origin) => events.push(["unsupported", query, dates, origin]),
    retryStarted: () => events.push(["retrying"]),
    retryFailed: (message) => events.push(["retry failed", message]),
    retrySettled: () => events.push(["retry settled"]),
    sleep: async () => {},
  });
  return {
    ...flow, events, calls,
    route(method, path, reply) { routes.push({ method, path, reply }); },
    restoreLink() { return flow.restore(readSkyZoneRequest()); },
    finish() {
      assert.deepEqual(routes, [], "all expected mock responses consumed");
      assert.equal(events.some(([event]) => event === "unexpected HTTP"), false);
    },
  };
}

// An incomplete ordinary link cannot restore even a syntactically valid ID.
{
  const h = harness({ url: new URL(`${base}/index.html?data=api&embed=1&mode=diff#workspace`) });
  writeUrlState({ request_id: idA, det: "D2" });
  assert.equal(window.location.searchParams.get("request_id"), idA);
  assert.equal(window.location.searchParams.get("det"), "D2");
  await h.restoreLink();
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.calls, []);
}
{
  const h = harness({ url: pilotUrl({ ...qa, fov: "7.2500001" }, idA) });
  await h.restoreLink();
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.calls, []);
}

// The first failed GET stops without attaching, polling, loading, or posting.
for (const [reply, message] of [
  [() => Response.json({ detail: "missing" }, { status: 404 }), /not found/],
  [() => new Response("{"), /verify/],
  [json({ requestId: idA, query: qa }), /invalid detector status/],
  [json({ ...readyA, detectors: { D1: { status: "ready" } } }), /invalid detector status/],
  [json({ ...readyA, query: null }), /invalid zone status/],
  [json({ ...readyA, requestId: idB }), /does not match/],
  [json({ ...readyA, query: { ...qa, ra: String(qa.ra) } }), /does not match/],
  [json({ ...readyA, query: { ...qa, ra: qa.ra + 0.000000001 } }), /does not match/],
  [json({ ...readyA, query: { ...qa, dec: qa.dec - 0.000000001 } }), /does not match/],
  [json({ ...readyA, query: { ...qa, fov: qa.fov + 0.00001 } }), /does not match/],
]) {
  const h = harness();
  h.route("GET", statusRoute(idA), reply);
  await h.restoreLink();
  assert.deepEqual(h.events.map(([event]) => event), ["reset", "checking", "failed"]);
  assert.match(h.events.at(-1)[1], message);
  assert.equal(h.events.at(-1)[2], "restore");
  assert.equal(window.location.searchParams.get("request_id"), idA, "failed restore does not rewrite the link");
  h.finish();
}

// Never accept stale/corrupt identity on subsequent status reads either.
{
  const h = harness();
  h.route("GET", statusRoute(idA), json(queueA));
  h.route("GET", statusRoute(idA), json({ ...readyA, requestId: idB }));
  await h.restoreLink();
  assert.deepEqual(h.events.map(([event]) => event), ["reset", "checking", "attached", "status", "failed"]);
  h.finish();
}

{
  const h = harness();
  h.route("GET", statusRoute(idA), json(pendingA));
  h.route("GET", readRoute, (request) => {
    assert.deepEqual(Object.fromEntries(request.searchParams),
      { ra: String(qa.ra), dec: String(qa.dec), fov: String(qa.fov), det: "all", request_id: idA });
    return frames("D1");
  });
  h.route("GET", statusRoute(idA), () => Response.json({}, { status: 503 }));
  h.route("GET", statusRoute(idA), json(partialA));
  h.route("GET", readRoute, () => frames("D1"));
  await h.restoreLink();
  assert.ok(h.events.some(e => e[0] === "frames" && e[1][0] === "D1"));
  assert.ok(h.events.some(e => e[0] === "status" && e[1] === idA && e[2] === "partial" && e[3]),
    "a transient status outage retains the verified status");
  assert.deepEqual(h.events.at(-1), ["terminal", idA, "partial"]);
  assert.ok(h.calls.every(c => c.method === "GET"));
  assert.ok(!h.events.some(([event]) => event === "accepted"), "restoration does not notify acceptance");
  const reply = deferred();
  h.route("POST", retryRoute(idA), () => reply.promise);
  h.route("GET", statusRoute(idA), json(readyA));
  h.route("GET", readRoute, () => frames("D1"));
  const retrying = h.retry();
  await h.retry(); // rapid repeat while the explicit retry endpoint is still pending
  reply.resolve(Response.json({ status: "queued", requestId: idB, query: qb }));
  await retrying;
  assert.equal(h.calls.filter(c => c.method === "POST").length, 1);
  assert.ok(!h.events.some(([event]) => event === "accepted"), "retry of a restored request does not notify acceptance");
  assert.deepEqual(h.calls.slice(-3).map(c => [c.method, c.request.pathname]),
    [["POST", retryRoute(idA)], ["GET", statusRoute(idA)], ["GET", readRoute]]);
  assert.equal(window.location.searchParams.get("request_id"), idA);
  assert.equal(window.location.hash, "#workspace");
  assert.equal(window.location.searchParams.get("mode"), "diff");
  assert.equal(window.location.searchParams.get("embed"), "1");
  h.finish();
}

{
  const h = harness();
  h.route("GET", statusRoute(idA), json(failedA));
  h.route("POST", retryRoute(idA), () => Response.json({ detail: "Fixture unavailable" }, { status: 503 }));
  await h.restoreLink();
  await h.retry();
  assert.deepEqual(h.calls.map(c => c.method), ["GET", "POST"], "a failed retry never falls back to submission");
  assert.match(h.events.find(e => e[0] === "retry failed")[1], /Fixture unavailable/);
  assert.deepEqual(h.events.at(-1), ["retry settled"], "the previous status remains attached for another explicit action");
  h.finish();
}

// Normal and embedded request URLs fail closed, including a malformed or empty ID.
for (const embedded of [false, true]) {
  for (const [id, statusBody, calls] of [
    [idA, readyA, ["GET", "GET"]], [idA, { ...readyA, query: qb }, ["GET"]],
    [idA, null, ["GET"]], ["", null, []], ["invalid", null, []],
  ]) {
    const url = workspaceUrl(qa, id, embedded);
    const route = readWorkspaceStartup(url.searchParams);
    assert.equal(route.kind, "request", "no unscoped path from any request-ID URL");
    const h = harness({ url });
    if (calls.length) h.route("GET", statusRoute(idA), () =>
      statusBody ? Response.json(statusBody) : Response.json({}, { status: 404 }));
    if (calls.length === 2) h.route("GET", readRoute, (request) => {
      assert.equal(request.searchParams.get("request_id"), idA);
      return frames("D1");
    });
    await h.restore(route.target);
    assert.deepEqual(h.calls.map(call => call.method), calls);
    assert.ok(!h.events.some(([event]) => event === "accepted"), "ordinary restore must not jump to viewer");
    h.finish();
  }
  const link = workspaceUrl(qa, undefined, embedded);
  assert.deepEqual(readWorkspaceStartup(link.searchParams), { kind: "legacy" }, "no-ID legacy links stay on the prepared loader");
  link.searchParams.set("legacy_api", "1");
  assert.deepEqual(readWorkspaceStartup(link.searchParams), { kind: "legacy" });
  link.searchParams.set("data", "mock");
  assert.deepEqual(readWorkspaceStartup(link.searchParams), { kind: "legacy" }, "synthetic deep link keeps its own loader");
  link.searchParams.set("request_id", idA);
  assert.deepEqual(readWorkspaceStartup(link.searchParams), { kind: "request", target: null }, "synthetic cannot restore a real request");
}

// Acceptance is a one-shot after verifying the explicit zone acknowledgement,
// not on click, on acknowledging POST, during polling, or from retry.
for (const [firstStatus, accepts] of [[pendingA, true], [failedA, false], [{ ...readyA, query: qb }, false]]) {
  const h = harness({ url: workspaceUrl(qa) });
  const post = deferred(), first = deferred();
  h.route("POST", submitRoute, () => post.promise);
  h.route("GET", statusRoute(idA), () => first.promise);
  if (firstStatus === pendingA) {
    h.route("GET", readRoute, () => frames("D1"));
    h.route("GET", statusRoute(idA), json(partialA));
    h.route("GET", readRoute, () => frames("D1"));
  }
  const submitting = h.submit(qa);
  await h.submit(qa);
  assert.equal(h.calls.length, 1, "an ACK in flight suppresses duplicate submissions");
  post.resolve(Response.json({ requestId: idA }));
  await submitting;
  assert.equal(window.location.searchParams.get("request_id"), idA);
  assert.equal(h.events.some(([event]) => event === "accepted"), false, "POST acknowledgement is not verification");
  first.resolve(Response.json(firstStatus));
  await settle();
  if (firstStatus === pendingA || firstStatus === failedA) {
    h.route("POST", retryRoute(idA), json({ requestId: idA }));
    h.route("GET", statusRoute(idA), json(readyA));
    h.route("GET", readRoute, () => frames("D1"));
    await h.retry();
  }
  assert.deepEqual(h.events.filter(([event]) => event === "accepted"), accepts ? [["accepted", idA]] : []);
  h.finish();
}

{
  const h = harness({ url: workspaceUrl(qa) });
  const dates = { dateFrom: "2025-01-01", dateTo: "2025-06-30" };
  h.route("POST", submitRoute, (_request, options) => {
    assert.deepEqual(Object.fromEntries(Object.keys(dates).map(key => [key, JSON.parse(options.body)[key]])), dates);
    return Response.json({ requestId: idA });
  });
  h.route("GET", statusRoute(idA), json(failedA));
  await h.submit(qa, { origin: "legacy", ...dates });
  await settle();
  assert.deepEqual(readSkyZoneRequest(), { query: qa, requestId: idA });
  assert.ok(!h.events.some(([event]) => event === "accepted"), "legacy Load images never jumps to viewer");
  for (const [key, value] of Object.entries(dates)) assert.equal(window.location.searchParams.get(key), value);
  h.finish();
}

{
  const h = harness({ url: workspaceUrl(qa) });
  const statusReply = deferred();
  h.route("POST", submitRoute, json({ requestId: idA }));
  h.route("GET", statusRoute(idA), () => statusReply.promise);
  await h.submit(qa);
  const signal = h.calls.at(-1).options.signal;
  h.cancel(); // switching to the legacy prepared viewer
  statusReply.resolve(Response.json(readyA));
  await settle();
  assert.ok(signal.aborted);
  assert.ok(!h.events.some(([event]) => event === "attached" || event === "accepted"));
  h.finish();
}

function submitB(h) {
  h.route("POST", submitRoute, (_url, options) => {
    assert.equal(window.location.searchParams.get("request_id"), null);
    assert.deepEqual(h.events.at(-2), ["reset", qb], "old UI was cancelled before the new POST");
    const { ra, dec, fov, collection, detectors } = JSON.parse(options.body);
    assert.deepEqual({ ra, dec, fov }, qb);
    assert.equal(collection, "spherex_dr1");
    assert.deepEqual(detectors, Object.keys(detectorStates("queued")));
    return Response.json({ requestId: idB });
  });
  h.route("GET", statusRoute(idB), json(noCoverageB));
  return h.submit(qb);
}

// Deliberately ignore cancellation in the network/decoder fixtures. Both
// resolution paths must be harmless after a new explicit request supersedes A.
for (const stage of ["poll", "cutouts", "playback", "retry"]) {
  for (const failLate of [false, true]) {
    const late = deferred(), started = deferred();
    const h = harness({ render: async () => {
      assert.equal(stage, "playback");
      started.resolve();
      await late.promise;
    } });
    const hold = () => { started.resolve(); return late.promise; };
    const initial = stage === "poll" ? queueA : stage === "retry" ? failedA : readyA;
    h.route("GET", statusRoute(idA), json(initial));
    if (stage === "poll") h.route("GET", statusRoute(idA), hold);
    if (stage === "cutouts" || stage === "playback") h.route("GET", readRoute, stage === "cutouts" ? hold : () => frames("D1"));
    const restored = h.restoreLink();
    let action = restored;
    if (stage === "retry") {
      await restored;
      h.route("POST", retryRoute(idA), hold);
      action = h.retry();
    }
    await started.promise;
    const staleSignals = h.calls.map(c => c.options.signal);
    await submitB(h);
    await settle();
    assert.ok(staleSignals.every(signal => signal?.aborted), `${stage}: old signal aborted immediately`);
    assert.deepEqual(h.events.at(-1), ["terminal", idB, "unavailable"]);
    const eventCount = h.events.length, callCount = h.calls.length;
    if (failLate) late.reject(new Error(`late ${stage} failure`));
    else late.resolve(stage === "playback" ? undefined : stage === "cutouts" ? frames("D1") : Response.json(readyA));
    await action;
    await settle();
    assert.equal(h.events.length, eventCount, `${stage}: old ${failLate ? "error" : "response"} did not repaint the UI`);
    assert.equal(h.calls.length, callCount, `${stage}: old ${failLate ? "error" : "response"} triggered no traffic`);
    assert.deepEqual(readSkyZoneRequest(), { requestId: idB, query: qb });
    h.finish();
  }
}

console.log("PASS sky zone request lifecycle: canonical URLs, verified GET-only restore/status, scoped partial frames, retry, and stale success/error isolation");
