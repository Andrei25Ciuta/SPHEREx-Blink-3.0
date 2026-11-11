// Structural regression checks for the Sky Explorer orientation atlas.
// It deliberately checks that the atlas is a coordinate shortcut only: archive
// searches still use the existing RA, Dec and diameter form.
import { readFileSync } from "node:fs";

let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failed++; };
const html = readFileSync(new URL("../frontend/sky.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../frontend/js/skyExplorer.js", import.meta.url), "utf8");

check("Sky Explorer exposes an explicitly labelled orientation atlas", /id="sky-atlas-map"/.test(html) && /orientation aid, not a survey-coverage map/i.test(html));
check("atlas markers reuse the documented challenge target list and propagated positions", /TARGETS, positionAtEpoch/.test(js) && /positionAtEpoch\(target\)/.test(js));
check("choosing an atlas target fills the existing archive-search RA and Dec fields", /\$\("ra"\)\.value = ra\.toFixed\(7\)/.test(js) && /\$\("dec"\)\.value = dec\.toFixed\(7\)/.test(js));
check("every visual map marker has an equivalent named button for keyboard and assistive technology", /id="atlas-target-list"/.test(html) && /aria-pressed/.test(js));
check("the atlas does not invoke an archive request or change the existing search function", /function setupAtlas\(\)/.test(js) && !/setupAtlas\(\)[\s\S]{0,1700}fetch\(/.test(js));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
