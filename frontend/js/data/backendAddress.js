// Public pages may use the project's HTTPS service, never a visitor's loopback server.
export const PROJECT_CLOUD_API = "https://blink3-api-w3bm7ii4fq-ew.a.run.app";
const PROJECT_PAGES_HOSTS = new Set(["iooonut.github.io", "mateibut.github.io", "andrei25ciuta.github.io"]);

export function backendAddress(value, hostname = "localhost") {
  const localPage = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  if (!value) {
    if (localPage) return { base: "http://localhost:8001", allowed: true, remote: false, error: null };
    if (PROJECT_PAGES_HOSTS.has(hostname)) return { base: PROJECT_CLOUD_API, allowed: true, remote: true, error: null };
    return { base: "", allowed: false, remote: false, error: null };
  }
  try {
    const u = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (u.username || u.password || u.search || u.hash || !["", "/"].includes(u.pathname) ||
        !(u.protocol === "https:" || u.protocol === "http:" && loopback)) throw new Error();
    return { base: u.origin, allowed: !loopback || localPage, remote: !loopback, error: null };
  } catch {
    return { base: "", allowed: false, remote: false, error: "The backend address must be an HTTPS origin, or HTTP localhost for local use." };
  }
}
