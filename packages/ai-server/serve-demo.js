// serve-demo.js (ESM) — single-origin static server + AI reverse proxy + WS scaffold
// deps: express, http-proxy-middleware, ws
import os from "os";
import path from "path";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";

// IMPORTANT: http-proxy-middleware must be a default import in ESM
import { createProxyMiddleware } from "http-proxy-middleware";

// ─────────────── Config ───────────────
const PORT = Number(process.env.PORT || 3000);
const AI_TARGET = process.env.AI_TARGET || "http://127.0.0.1:8787"; // your local AI
// Serve files from this folder (defaults to CWD). Set STATIC_ROOT to your game/dist or game.
const STATIC_ROOT = process.env.STATIC_ROOT
  ? path.resolve(process.env.STATIC_ROOT)
  : process.cwd();

// ─────────────── App ───────────────
const app = express();
app.disable("x-powered-by");

// 1) AI reverse proxy (placed FIRST so nothing shadows it)
const aiProxy = createProxyMiddleware({
  target: AI_TARGET,
  changeOrigin: true,
  ws: false,
  xfwd: true,
  proxyTimeout: 2000,
  onError(err, req, res) {
    console.error("AI proxy error:", err?.code || err?.message);
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: "AI upstream unavailable" });
    }
  },
});

// Explicit routes (cover common methods)
app.get("/health", aiProxy);
app.get("/ratelimit", aiProxy);
app.post("/decide", aiProxy);
app.post("/taunt", aiProxy);

// Also catch any other method variants under these paths
app.use(["/decide", "/health", "/ratelimit", "/taunt"], aiProxy);

// 2) Tiny health for THIS server
app.get("/_demohealth", (_req, res) => {
  res.json({ ok: true, server: "serve-demo", port: PORT, root: STATIC_ROOT, proxy: AI_TARGET });
});

// 3) Static AFTER proxy
app.use(
  express.static(STATIC_ROOT, {
    index: false,          // we’ll choose explicit pages
    extensions: ["html"],  // /mobile resolves to mobile.html
    maxAge: 0,
  })
);

// 4) Convenience redirect for "/"
app.get("/", (_req, res) => res.redirect(302, "/mobile.html"));

// 5) Helpful 404
app.use((req, res) => {
  res
    .status(404)
    .send(`Not found: ${req.method} ${req.url}\nTry /mobile.html or /desktop.html`);
});

// ─────────────── HTTP + WS (spectator scaffold) ───────────────
const server = createServer(app);

// Minimal WS on /ws (unused for mobile-only; ready for spectator later)
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  try { ws.send(JSON.stringify({ type: "hello", ver: 1, t: Date.now() })); } catch {}
  ws.on("error", (e) => console.warn("ws error:", e.message));
});

// ─────────────── Start ───────────────
server.listen(PORT, "0.0.0.0", () => {
  const addrs = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);

  console.log("✅ serve-demo up");
  console.log(`  http://localhost:${PORT}`);
  addrs.forEach((a) => console.log(`  http://${a}:${PORT}`));
  console.log("Static root:", STATIC_ROOT);
  console.log("Proxying →", AI_TARGET, "for /decide,/health,/ratelimit,/taunt");
});
