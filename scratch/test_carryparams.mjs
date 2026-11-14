// Tests for features/carryParams.js: the choices of a visit (?data, ?api, ?embed, ?theme) survive a move between the pages.   Run: node scratch/test_carryparams.mjs
import { readFileSync } from "node:fs";
import { carryLink, isSitePage } from "../frontend/js/features/carryParams.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const REAL = "http://localhost:8765/overview.html?data=api&api=http%3A%2F%2Flocalhost%3A8003";
const DEMO = "http://localhost:8765/overview.html";

check("the bug: Overview (real data) -> Workspace keeps ?data=api and the address of the backend", carryLink("index.html#workspace", REAL) === "index.html?data=api&api=http%3A%2F%2Flocalhost%3A8003#workspace");
check("a preset link keeps its field and gets the data choice before the #hash", carryLink("index.html?ra=269.45&dec=4.69&fov=5&det=D2#workspace", REAL) === "index.html?ra=269.45&dec=4.69&fov=5&det=D2&data=api&api=http%3A%2F%2Flocalhost%3A8003#workspace");
check("the other pages carry it too (Sky Explorer, Simulator, Results, the brand link)", ["sky.html", "simulator.html", "results.html", "overview.html"].every((p) => carryLink(p, REAL).startsWith(p + "?data=api&api=")));
check("on the synthetic demo nothing is added (the links stay as written)", carryLink("index.html#workspace", DEMO) === "index.html#workspace" && carryLink("sky.html", DEMO) === "sky.html");
check("a link that makes its own choice keeps it (data=api written by the Sky Explorer is not overwritten, an address already there stays)", carryLink("index.html?ra=1&data=api&api=http%3A%2F%2Flocalhost%3A9000", REAL) === "index.html?ra=1&data=api&api=http%3A%2F%2Flocalhost%3A9000");
check("an explicit ?data=mock on a link stays, and no backend address is added to it", carryLink("index.html?data=mock", REAL) === "index.html?data=mock");
check("?embed=1 and ?theme= of the visit are carried; a field of the page is NOT (ra, dec, fov, det belong to the page)", carryLink("results.html", "http://localhost:8765/index.html?embed=1&theme=midnight&ra=1&dec=2&fov=5&det=D2") === "results.html?embed=1&theme=midnight");
check("a backend address without ?data=api is not carried to a link that does not use the backend", carryLink("sky.html", "http://localhost:8765/index.html?api=http%3A%2F%2Flocalhost%3A8003") === "sky.html");
check("links that are not pages of the site are untouched: #hash, another site, a data file", ["#workspace", "https://example.org/index.html", "data/real_results.json", "css/styles.css", "mailto:a@b.c"].every((h) => carryLink(h, REAL) === h));
check("an absolute link to the same site (the pages build some) is carried; another port is another site", carryLink("http://localhost:8765/index.html?ra=1&data=api#workspace", REAL).includes("api=http%3A%2F%2Flocalhost%3A8003") && carryLink("http://localhost:9999/index.html", REAL) === "http://localhost:9999/index.html");
check("carrying twice gives the same link (the observer can run again on its own change)", (() => { const once = carryLink("index.html#workspace", REAL); return carryLink(once, REAL) === once; })());
check("isSitePage: the five pages and the folder root, nothing else", ["index.html", "overview.html", "sky.html", "simulator.html", "results.html", "./"].every((p) => isSitePage(p, DEMO)) && !isSitePage("planet-x.html", DEMO) && !isSitePage("data/real_results.json", DEMO) && !isSitePage("", DEMO));

// every page that has links to the others loads the module that applies this (js/siteHeader.js), and the module calls patchLinks
const header = readFileSync(new URL("../frontend/js/siteHeader.js", import.meta.url), "utf8");
check("js/siteHeader.js imports and calls patchLinks", /import \{ patchLinks \} from "\.\/features\/carryParams\.js"/.test(header) && /patchLinks\(document\)/.test(header));
const pages = ["index", "overview", "sky", "simulator", "results"];
const missing = pages.filter((p) => !/src="js\/siteHeader\.js"/.test(readFileSync(new URL(`../frontend/${p}.html`, import.meta.url), "utf8")));
check("all five pages load js/siteHeader.js", missing.length === 0, missing.join(", "));

console.log(failed ? `\n${failed} FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
