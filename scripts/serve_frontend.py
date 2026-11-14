"""Static server for the frontend that tells the browser NOT to reuse old files.

`py -m http.server` sends no cache headers, so a browser keeps an old .js/.css for minutes
and keeps running outdated code after you edit it. This server adds `Cache-Control: no-cache`:
the browser re-checks with the server on every load, and unchanged files come back as a
cheap "304 Not Modified".

    py scripts/serve_frontend.py [port]       # default port 8765, serves ./frontend
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "8765"
    if arg in ("-h", "--help") or not arg.isdigit() or not 0 < int(arg) < 65536:
        print("usage: py scripts/serve_frontend.py [port]   (a number from 1 to 65535; default 8765)")
        sys.exit(0 if arg in ("-h", "--help") else 2)
    port = int(arg)
    handler = partial(NoCacheHandler, directory=str(FRONTEND))
    with ThreadingHTTPServer(("", port), handler) as server:
        print(f"Serving {FRONTEND} at http://localhost:{port}/  (Cache-Control: no-cache)", flush=True)
        server.serve_forever()
