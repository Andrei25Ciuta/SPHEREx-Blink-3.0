// lib_cdp.mjs – the pieces of a Node-only browser test: a static server for frontend/, finding Chrome or Edge, the DevTools Protocol over one WebSocket, launching headless.
// Shared by scratch/e2e_smoke.mjs and scratch/a11y_audit.mjs (no Playwright, no npm). Needs Node 22+ (the built-in WebSocket).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

// ---------------------------------------------------------------- a static server for frontend/
export const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
export function startServer(ROOT) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.resolve(ROOT, "." + rel);
      if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end("no"); return; }
      if (rel === "/favicon.ico" && !existsSync(file)) { res.writeHead(204).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" }).end(body);
    } catch { res.writeHead(404).end("not found"); }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

// ---------------------------------------------------------------- find a browser
export function findBrowser() {
  const candidates = [process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

// ---------------------------------------------------------------- the DevTools Protocol, over one WebSocket (flat sessions)
export class Cdp {
  constructor(ws) {
    this.ws = ws; this.nextId = 1; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener("message", (event) => {
      const m = JSON.parse(event.data);
      if (m.id !== undefined) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (p) { if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`)); else p.resolve(m.result); }
      } else (this.handlers.get(m.method) ?? []).forEach((fn) => fn(m.params, m.sessionId));
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, method }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  }
  on(method, fn) { this.handlers.set(method, [...(this.handlers.get(method) ?? []), fn]); }
}

export function launch(browserPath, userDir, { keep = false } = {}) {
  const args = ["--remote-debugging-port=0", `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking",
    "--disable-sync", "--mute-audio", "--window-size=1400,900", ...(keep ? [] : ["--headless=new"]), ...(process.platform === "linux" ? ["--no-sandbox"] : []), "about:blank"];
  const child = spawn(browserPath, args, { stdio: ["ignore", "ignore", "pipe"] });
  return new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`the browser did not report a DevTools address in 20 s. Its output: ${log.slice(-400)}`)), 20000);
    child.stderr.on("data", (d) => {
      log += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (m) { clearTimeout(timer); resolve({ child, wsUrl: m[1] }); }
    });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`the browser exited with code ${code} before it was ready`)); });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

