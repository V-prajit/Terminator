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

// WebSocket proxy for multiplayer
const wsProxy = createProxyMiddleware({
  target: AI_TARGET,
  changeOrigin: true,
  ws: true,
  logLevel: 'debug'
});

// Explicit routes (cover common methods)
app.get("/health", aiProxy);
app.get("/ratelimit", aiProxy);
app.get("/ws-stats", aiProxy);
app.post("/decide", aiProxy);
app.post("/decide-multiplayer", aiProxy);
app.post("/taunt", aiProxy);

// Also catch any other method variants under these paths
app.use(["/decide", "/health", "/ratelimit", "/taunt", "/ws-stats"], aiProxy);

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

// 4) Convenience redirects
app.get("/", (_req, res) => res.redirect(302, "/dashboard.html"));
app.get("/mobile", (_req, res) => res.redirect(302, "/mobile.html"));
app.get("/dashboard", (_req, res) => res.redirect(302, "/dashboard.html"));

// 5) Helpful 404
app.use((req, res) => {
  res
    .status(404)
    .send(`Not found: ${req.method} ${req.url}\nTry /mobile.html or /desktop.html`);
});

// ─────────────── HTTP + WS (multiplayer support) ───────────────
const server = createServer(app);

// Proxy WebSocket connections to AI server
server.on('upgrade', (request, socket, head) => {
  if (request.url.startsWith('/ws')) {
    wsProxy.upgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});

// ─────────────── Start ───────────────
server.listen(PORT, "0.0.0.0", () => {
  const addrs = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);

  console.log("🎮 AI Overlord Demo Server with Multiplayer");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📱 Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`📱 Mobile:    http://localhost:${PORT}/mobile.html`);
  addrs.forEach((a) => console.log(`📱 Network:   http://${a}:${PORT}/dashboard.html`));
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔧 Static root:", STATIC_ROOT);
  console.log("🔧 Proxying →", AI_TARGET, "for API + WebSocket");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎯 DEMO READY:");
  console.log("   1. Open dashboard on laptop");
  console.log("   2. Scan QR or use mobile URL");
  console.log("   3. Watch smooth transition!");
});
