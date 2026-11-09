# Benchmarks

What the benchmarks are for: to show that a change to a search makes it faster **without changing what it finds**. They do not show that the search is
right (that is [VALIDATION.md](VALIDATION.md)); they show that it still gives *exactly* what it gave. Every number below comes from a command that
can be run again; the machine is named, because a time means nothing without it.

## 1. The three scenarios and their golden outputs

```bash
node scratch/benchmark.mjs --check --repeats 5      # the table below; exit 1 if an output differs from scratch/benchmark_baseline.json
node scratch/test_benchmark.mjs                     # the same digests as a test (part of the Node test set)
node scratch/benchmark.mjs --write                  # a new baseline: only when a scientific change was MEANT, and say so in the commit
```

Three deterministic scenarios (a seeded generator, **synthetic** images with a pixel-integrated Gaussian PSF on white noise; no real data). For each: the
median time and a **digest** of the scientific output: the candidates and their numbers, to 5 significant digits, keys sorted, hashed (sha1, 16 hex digits).
A search that is faster but finds something different gives another digest, and `test_benchmark.mjs` fails.

Run on 9 Nov 2026 (Node v24.15.0, AMD Ryzen 7 7445HS, Windows; median of 5), against the baseline written on that machine:

| scenario | median time (ms) | digest of the output | time in the baseline (ms) | same output as the baseline |
|---|---|---|---|---|
| detect: the dots of 30 images of 293 x 293 px | 168 | `637733ad2ffc4fcf` | 218 | yes |
| movers: 18 images of 49 x 49 px, one mover among 14 stars | 9 | `b7c1407f4f494c3e` | 12 | yes |
| distant: a body at 800 AU in 12 images of a 30 arcmin field (inject, detect, search) | 85 | `25881588be76572f` | 113 | yes |

**How to read the times.** Nothing in the code of these searches was changed between the baseline and this run (Phase 10 moved *where* the searches run,
not how). The two columns are therefore the **same code measured twice** on one machine: their difference (about 20-25 %) is the noise of the
measurement, not a speed-up. Only two runs exist; a proper noise estimate would need more. Timings are not tested, only written down, so that a future
"before" and "after" can be compared with the same command and the same scenarios.

**What the digest does not cover.** Synthetic images only; the real-data searches have their own repeatable commands in VALIDATION.md (sections 10-17).
The digest rounds to 5 significant digits, so a change in the 6th digit is not seen (on purpose: it is below the precision of the measurements).

**Other machines.** The baseline was written with Node 24 on Windows. The CI job `node` runs Node 20.20.2 on Linux (GitHub's runner). In its run
[42711017130](https://github.com/mateibut/SPHEREx/actions/runs/42711017130) (10 Nov 2026, commit `cdc96c5`) `test_benchmark.mjs` passed with the same three
digests (`637733ad2ffc4fcf`, `b7c1407f4f494c3e`, `25881588be76572f`), so the golden outputs hold on a second version of Node and a second system. Only
these two environments have been tried. If a job ever reports a different digest, find out why before touching the baseline; do not rewrite it to make a
test pass.

## 2. The long searches in a worker

`Find movers` and the Planet X search used to run on the page's own thread. They now go through `js/features/searchTasks.js`: a module worker
(`js/searchWorker.js`) runs the task, and if no worker can be had (blocked script, old browser, data that cannot be copied) the **same task** runs on the
page, so the answer is the same either way (`scratch/test_workers.mjs`: 14 checks, including a worker that fails to start). The lab's injection test
had its own worker since Phase 5.

Measured in headless Chrome on the synthetic Planet X field (24 images), by `scratch/e2e_smoke.mjs`, which draws every frame and records the **longest
time between two frames** while a search runs (3 runs each, same machine as above). "On the page" means the same run with `js/searchWorker.js` renamed,
so that the fallback runs (the test then fails on purpose, and prints the gap in its message):

| search | longest gap between two frames, in a worker | longest gap, on the page |
|---|---|---|
| Find movers | 24, 15, 28 ms | 396, 499, 433 ms |
| Planet X search | 242, 278, 319 ms | 325, 416, 288 ms |

A second machine, once: in the CI run above (headless Chrome on GitHub's runner, one run) the gap was 174 ms for Find movers and 248 ms for the Planet X search,
both in a worker. That runner gave larger gaps than the machine of the table, and its CPU is not known here, so these two numbers show the order of
magnitude, not a comparison. The run without the worker was not made there.

Reading: **Find movers** is now off the page thread (the page keeps drawing). The **Planet X search** gains little: the dots of every image are still
found on the page (`detectSources`), and only the linking of the dots into paths is in the worker, so the page still stops for about 0.25-0.3 s. Moving
the detection into the worker too would change that; it was not done. "Find everything" (the all-source search) was not moved either. The run is on
synthetic images; with real cutouts the times differ and were not measured.

No search became faster in Phase 10, and the document does not claim one.

## 3. The end-to-end test

```bash
node scratch/e2e_smoke.mjs        # Node 22+ (built-in WebSocket) and Chrome or Edge; CHROME_PATH names one; --keep leaves the window open
```

13 checks on the synthetic demo in a real browser: the page loads and says its data are synthetic; the simulated Planet X field loads; Find movers and
the Planet X search finish **in a worker** (the page records where each search ran: `data-last-search` on the movers section) and the second finds the
simulated body at 500-700 AU (the body is at 600 AU; the run gave 601); a candidate opens in the inspector; the lab compares the motions; the injection
test refuses synthetic pixels and says why; the explainer answers and its own check passes; the Solar System is drawn; the results page loads its numbers
and sections 1-12; no console error or exception; no request to any host but the test server (the web-font requests are answered with an empty file).
It was checked to be able to fail: with the worker file removed, exactly the two worker checks fail. A first version only noted that a worker had been
*created*, and passed even then: that is why the page now says where the search ran.

Not covered: real data, the backend, a touch screen, other browsers than Chrome, a screen reader. Not part of the `test_*.mjs` set (it needs a browser);
it has its own job in `.github/workflows/tests.yml`, which passed 12 of 12 in the run [42711017130](https://github.com/mateibut/SPHEREx/actions/runs/42711017130)
(Node 22.23.4 on GitHub's `ubuntu-latest`; the runner's Chrome was found with no extra step).
