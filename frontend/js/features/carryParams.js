// carryParams.js – keep the choices of THIS visit when the person moves between the pages of the site.
//
// The page address holds three choices that are not a field: which data (?data=api is the local backend, nothing is the synthetic demo), where that backend is (?api=http://localhost:8003),
// and the visit-only options (?embed=1, ?theme=...). A link such as "Workspace" or "Back to the Workspace" used to be written without them, so going Workspace -> Overview -> Workspace
// silently dropped a person on the OTHER data source (the synthetic demo) while they were working on real data. carryLink() adds them back to a link that points at another page of the
// site; it never overwrites a choice the link already makes (a link that says data=api keeps it), and it never adds an `api` address to a link that does not use the backend.
// Pure (no DOM): scratch/test_carryparams.mjs. patchLinks() is the DOM part, used by js/siteHeader.js on every page.

export const CARRIED = ["data", "api", "embed", "theme"];
export const PAGES = ["index.html", "overview.html", "sky.html", "simulator.html", "results.html"];

/** Is `href` a link to another page of this site (not "#hash", not another site, not a file)? */
export function isSitePage(href, baseHref) {
  if (!href || href.startsWith("#")) return false;
  let url, base;
  try { base = new URL(baseHref); url = new URL(href, base); } catch { return false; }
  if (url.origin !== base.origin) return false;
  const last = url.pathname.split("/").pop();
  return PAGES.includes(last) || last === "";
}

/**
 * The same link with the choices of this visit added.
 *   href         the link as written (relative or absolute)
 *   currentHref  the address of the page the link is on (its ?query holds the choices)
 * Returns the link as written when there is nothing to add; otherwise the same text with the missing parameters appended before the #hash.
 */
export function carryLink(href, currentHref) {
  if (!isSitePage(href, currentHref)) return href;
  const here = new URL(currentHref).searchParams;
  const hashAt = href.indexOf("#"), hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const noHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const queryAt = noHash.indexOf("?"), path = queryAt >= 0 ? noHash.slice(0, queryAt) : noHash;
  const own = new URLSearchParams(queryAt >= 0 ? noHash.slice(queryAt + 1) : "");
  let changed = false;
  for (const key of CARRIED) {
    if (key === "api") continue;                                  // handled after `data` is settled
    if (here.has(key) && !own.has(key)) { own.set(key, here.get(key)); changed = true; }
  }
  if (own.get("data") === "api" && here.has("api") && !own.has("api")) { own.set("api", here.get("api")); changed = true; }
  if (!changed) return href;
  const query = own.toString();
  return path + (query ? "?" + query : "") + hash;
}

/** Patch every link of `root` now, and every link added later (the pages build some links when their data arrives). */
export function patchLinks(root = document) {
  const fix = (a) => {
    const href = a.getAttribute("href");
    const next = carryLink(href, location.href);
    if (next !== href) a.setAttribute("href", next);
  };
  const all = (node) => (node.matches?.("a[href]") ? [node] : []).concat([...(node.querySelectorAll?.("a[href]") ?? [])]);
  all(root).forEach(fix);
  if (typeof MutationObserver === "undefined") return null;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") { if (record.target.matches?.("a[href]")) fix(record.target); continue; }
      for (const node of record.addedNodes) if (node.nodeType === 1) all(node).forEach(fix);
    }
  });
  observer.observe(root.documentElement ?? root, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
  return observer;
}
