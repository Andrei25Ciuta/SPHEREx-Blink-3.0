// Every file or picture the page saves says what the data are and how it was made (item 6 of the ten improvements). The list of save points is audited in the source: a new save point
// that is not in this list, or one that loses its label, fails here.   Run: node scratch/test_exportlabels.mjs
import { readFileSync, readdirSync } from "node:fs";
import { pictureCaption, TOOL } from "../frontend/js/features/provenance.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const root = new URL("../frontend/js/", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

// ---------------------------------------------------------------- the caption printed into pictures
{
  const frame = { dateISO: "2025-11-05T12:00:00Z", detector: "D2", wavelengthMinUm: 1.1, wavelengthMaxUm: 1.14 };
  const query = { ra: 269.4462, dec: 4.769, fov: 5 };
  const when = new Date("2026-11-10T09:00:00Z");
  const real = pictureCaption({ isReal: true, query, frame, mode: "blink", when }), fake = pictureCaption({ isReal: false, query, frame, mode: "difference", when });
  check("caption: real data say so, and that the pixels are derived", /^Real SPHEREx data/.test(real[0]) && /derived/.test(real[0]) && !/SYNTHETIC/.test(real[0]));
  check("caption: synthetic data say so in capitals, first line, and that it is not an observation", /^SYNTHETIC DEMO IMAGE/.test(fake[0]) && /NOT a SPHEREx observation/.test(fake[0]));
  check("caption: the second line has the tool, the field, the detector, the date, the wavelength, the mode and the day it was saved", [TOOL, "RA 269.4462", "Dec 4.7690", "5′", "D2", "2025-11-05", "1.10–1.14 µm", "difference", "saved 2026-11-10"].every((s) => fake[1].includes(s)), fake[1]);
  const bare = pictureCaption({ isReal: false, query: null, frame: null, mode: undefined, when });
  check("caption: missing information is said to be unknown, never invented, and the first line is still there", /SYNTHETIC/.test(bare[0]) && /field unknown/.test(bare[1]) && /date unknown/.test(bare[1]));
}

// ---------------------------------------------------------------- the save points
const main = read("main.js"), exporters = read("features/exporters.js"), player = read("player.js");
{
  check("picture: the PNG and the video get the caption from main.js, and the caption is removed afterwards", /savePng\(player, fileBase\(\), exportCaption\(\)\)/.test(main) && /caption: exportCaption\(\)/.test(main)
    && /finally \{ player\.setCaption\(null\); \}/.test(exporters) && (exporters.match(/setCaption\(/g) || []).length === 4);
  check("picture: the player draws the caption last, over the layers, only when one is set", /if \(this\.caption\) this\._drawCaption\(\)/.test(player) && player.indexOf("_drawLayer(id)") < player.indexOf("this._drawCaption()"));
}
const sites = [
  ["candidate list CSV/JSON (main.js)", main, /candidatesToCsv\(movers, ctx\)/, /candidatesToJson\(movers, ctx\)/],
  ["Find everything list and dossier (discoverPanel.js)", read("features/discoverPanel.js"), /dossierMarkdown\(d\)/, /candidatesToCsv\(run\.result\.candidates, run\.ctx\)/, /candidatesToJson\(run\.result\.candidates, run\.ctx\)/],
  ["Planet X Lab CSV (planetLabView.js)", read("features/planetLabView.js"), /completenessCsv\(lastRun\.result\.cells, provenanceFields\(/],
  ["text analysis CSV (textAnalysisView.js)", read("features/textAnalysisView.js"), /toCsv\(rows\(\), columns, built\.provenance\)/],
  ["reproducibility bundle (bundleView.js)", read("features/bundleView.js"), /JSON\.stringify\(bundle/],
];
for (const [name, src, ...needles] of sites) check(`save point: ${name} writes its provenance with the file`, needles.every((r) => r.test(src)));
{
  const exp = read("features/export.js"), dos = read("features/dossier.js"), tx = read("features/textAnalysis.js");
  check("producers: candidate CSV/JSON and the dossier carry the data label and the run record", /dataLabel\(/.test(exp) && /provenanceColumns\(ctx\.provenance\)/.test(exp) && /provenance: ctx\.provenance/.test(exp) && /dataLabel\(/.test(dos) && /provenanceText\(d\.provenance\.run\)/.test(dos));
  check("producers: the text-analysis CSV puts the provenance lines first, and they say real or SYNTHETIC", /provenance\.map\(\(l\) => `# \$\{l\}`\)/.test(tx) && /SYNTHETIC demo images/.test(tx));
}
{
  // a new save point must be added here on purpose: count the places that start a download
  const files = ["main.js", ...readdirSync(new URL("features/", root)).filter((f) => f.endsWith(".js")).map((f) => `features/${f}`)];
  const found = [];
  for (const f of files) for (const line of read(f).split("\n")) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line) || /function (download|downloadText)\b/.test(line)) continue;
    if (/\b(download|downloadText|deps\.download)\(|\bsavePng\(|\brecordBlink\(/.test(line) && !/^export /.test(line.trim())) found.push(f);
  }
  const counts = Object.fromEntries([...new Set(found)].sort().map((f) => [f, found.filter((x) => x === f).length]));
  const expected = { "features/bundleView.js": 1, "features/discoverPanel.js": 4, "features/exporters.js": 2, "features/planetLabView.js": 1, "features/textAnalysisView.js": 1, "main.js": 4 };
  check("audit: the places that save a file are exactly the ones listed above (a new one must be labelled and added here)", JSON.stringify(counts) === JSON.stringify(expected), JSON.stringify(counts));
}

console.log(failed ? `\n${failed} FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
