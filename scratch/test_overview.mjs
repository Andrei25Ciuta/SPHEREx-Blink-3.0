import { readFileSync } from "node:fs";

let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (ok === false) failed++; };
const html = readFileSync(new URL("../frontend/overview.html", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../frontend/css/overview.css", import.meta.url), "utf8");
const sharedHeader = readFileSync(new URL("../frontend/js/siteHeader.js", import.meta.url), "utf8");
check("overview keeps a skip link and labelled primary navigation", /href="#overview-main"/.test(html) && html.includes('src="js/siteHeader.js"') && sharedHeader.includes('setAttribute("aria-label", "Project pages")'));
check("overview links every main project destination", ["index.html#workspace", "sky.html", "planet-x.html", "simulator.html", "results.html"].every(href => sharedHeader.includes(href)));
check("overview labels its visual frame as an illustration, not an observation", /Illustration only — not SPHEREx observations/.test(html));
check("overview preset cards preserve existing workspace query links", /ra=331\.0441466/.test(html) && /ra=269\.452077/.test(html) && /#workspace/.test(html));
check("overview motion effects respect reduced-motion preference", /prefers-reduced-motion:reduce/.test(css));
check("a plain visit to index redirects to Overview while query and hash workspace links remain intact", /if\(!location\.search&&!location\.hash\)location\.replace\("overview\.html"\)/.test(workspace));
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
