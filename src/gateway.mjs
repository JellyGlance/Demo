// Public front door for the demo. Proxies to JellyGlance, signs visitors in automatically,
// adds a small "live demo" badge, and refuses anything that would change data.
import http from "node:http";
import net from "node:net";

const env = (name, fallback) => process.env[name] ?? fallback;
const PORT = Number(env("PORT", 8080));
const UPSTREAM = new URL(env("UPSTREAM", "http://jellyglance:3000"));
const SITE_URL = env("DEMO_SITE_URL", "https://jellyglance.com");
const DEMO_USER = env("DEMO_USER", "demo");
const DEMO_PASSWORD = env("DEMO_PASSWORD", "");
// TMDB's terms ask apps using its data to credit it.
const TMDB_CREDIT = env("TMDB_API_KEY", "") ? `<span class="jg-demo-credit">Film &amp; TV data from TMDB</span>` : "";
// Set when the demo sits behind another proxy (Caddy, Cloudflare…) that sends X-Forwarded-For.
const BEHIND_PROXY = /^(1|true|yes)$/i.test(env("GATEWAY_BEHIND_PROXY", "false"));

// Reads that happen to use POST.
const POST_READS = [/^\/auth\/login$/, /^\/auth\/logout$/, /^\/(api|stats)\/get[a-z]/i, /^\/socket\.io\//];
// GETs that start work or expose files.
const GET_BLOCKED = [
  /^\/sync(\/|$)/i,
  /^\/backup(\/|$)/i,
  /^\/api\/(starttask|stoptask|checkforupdates)/i,
  /^\/api\/jellyfin\/refresh/i,
  /^\/utils(\/|$)/i,
  /^\/server-tasks(\/|$)/i,
  /^\/logs\/download/i,
];

export function isAllowed(method, pathname) {
  const m = String(method || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return !GET_BLOCKED.some((re) => re.test(pathname));
  if (m === "POST") return POST_READS.some((re) => re.test(pathname));
  return false;
}

let cachedToken = null;
async function demoToken() {
  if (cachedToken) return cachedToken;
  const response = await fetch(new URL("/auth/login", UPSTREAM), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: DEMO_USER, password: DEMO_PASSWORD }),
  });
  if (!response.ok) throw new Error(`demo login failed (${response.status})`);
  cachedToken = (await response.json()).token;
  return cachedToken;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

const INJECT = `
<style id="jg-demo-style">
  #jg-demo-badge{position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:2147483000;display:flex;align-items:center;gap:8px;
    padding:8px 12px;border-radius:999px;background:rgba(18,14,30,.92);color:#ece8f6;font:600 12px/1.2 system-ui,sans-serif;
    border:1px solid rgba(169,139,245,.45);box-shadow:0 8px 24px rgba(0,0,0,.35)}
  #jg-demo-badge b{color:#c4b5fd} #jg-demo-badge a{color:#ece8f6;text-decoration:underline}
  #jg-demo-badge button{all:unset;cursor:pointer;opacity:.7;padding:0 2px} #jg-demo-badge button:focus-visible{outline:2px solid #a98bf5}
  #jg-demo-badge .jg-demo-credit{opacity:.65;font-weight:500}
  @media (max-width:640px){#jg-demo-badge .jg-demo-credit{display:none}}
</style>
<div id="jg-demo-badge" role="note"><b>Live demo</b><span>Read-only · resets every few hours</span>${TMDB_CREDIT}<a href="${escapeHtml(SITE_URL)}" target="_blank" rel="noopener">Get JellyGlance</a><button type="button" aria-label="Hide demo notice" onclick="this.parentNode.remove()">×</button></div>
<script>
(function () {
  try {
    var token = localStorage.getItem("token");
    if (token && token !== "null") return;
    // First visit: sign in as the demo user and skip the "What's new" popup.
    Promise.all([
      fetch("/demo-session").then(function (r) { return r.json(); }),
      fetch("/auth/isConfigured").then(function (r) { return r.json(); }).catch(function () { return {}; }),
    ]).then(function (results) {
      var d = results[0];
      if (!d || !d.token) return;
      localStorage.setItem("token", d.token);
      if (results[1] && results[1].version) localStorage.setItem("jellyglance_whats_new_seen_version", results[1].version);
      localStorage.removeItem("config");
      localStorage.removeItem("jellyglance_logged_out");
      location.replace("/");
    });
  } catch (e) {}
})();
</script>`;

// JellyGlance trusts one proxy hop, so pass each visitor's own address for per-visitor rate limits.
function clientAddress(req) {
  if (BEHIND_PROXY) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || "";
}

function blocked(res) {
  const body = JSON.stringify({
    message: "This is a read-only demo, so changes are switched off. Install JellyGlance to try this on your own server.",
    errorMessage: "This is a read-only demo, so changes are switched off.",
  });
  res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://gateway");

  if (url.pathname === "/demo-session") {
    try {
      const body = JSON.stringify({ token: await demoToken() });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
      return res.end(body);
    } catch (error) {
      cachedToken = null;
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "The demo is starting up. Try again in a minute." }));
    }
  }
  if (url.pathname === "/demo-health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }

  if (!isAllowed(req.method, url.pathname)) {
    req.resume();
    return blocked(res);
  }

  const headers = { ...req.headers, host: UPSTREAM.host, "x-forwarded-for": clientAddress(req) };
  delete headers["accept-encoding"]; // keep HTML uncompressed so the badge can be added
  const upstream = http.request(
    { hostname: UPSTREAM.hostname, port: UPSTREAM.port || 80, method: req.method, path: req.url, headers },
    (up) => {
      const type = String(up.headers["content-type"] || "");
      if (!type.includes("text/html")) {
        res.writeHead(up.statusCode || 502, up.headers);
        return up.pipe(res);
      }
      const chunks = [];
      up.on("data", (chunk) => chunks.push(chunk));
      up.on("end", () => {
        let html = Buffer.concat(chunks).toString("utf8");
        html = html.includes("</body>") ? html.replace("</body>", `${INJECT}</body>`) : html + INJECT;
        const outHeaders = { ...up.headers };
        delete outHeaders["content-length"];
        delete outHeaders["content-security-policy"];
        res.writeHead(up.statusCode || 200, outHeaders);
        res.end(html);
      });
    }
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("The demo is starting up. Try again in a minute.");
  });
  req.pipe(upstream);
});

// socket.io live updates
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://gateway");
  if (!url.pathname.startsWith("/socket.io/")) return socket.destroy();
  const upstream = net.connect(Number(UPSTREAM.port || 80), UPSTREAM.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      if (name.toLowerCase() === "x-forwarded-for") continue;
      lines.push(`${name}: ${name.toLowerCase() === "host" ? UPSTREAM.host : req.rawHeaders[i + 1]}`);
    }
    lines.push(`X-Forwarded-For: ${clientAddress(req)}`);
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, "0.0.0.0", () => console.log(`[gateway] demo on :${PORT} → ${UPSTREAM.origin}`));
}
