// server.js (ESM) — with dotenv + API key sanitizing + gpt-oss-120b
import "dotenv/config";            // <-- loads .env automatically
import http from "http";
import express from "express";

// ─────────── Config ───────────
const PORT = process.env.PORT || 8787;
const CEREBRAS_BASE = (process.env.CEREBRAS_BASE || "https://api.cerebras.ai").trim();
const MODEL = (process.env.CEREBRAS_MODEL || "gpt-oss-120b").trim();
const CLIENT_TIMEOUT_MS = Number(process.env.CLIENT_TIMEOUT_MS || 2000);
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 256);
const TOKENS_PER_MINUTE = Number(process.env.TOKENS_PER_MINUTE || 60000);
const LIMIT_REQUESTS_DAY = Number(process.env.LIMIT_REQUESTS_DAY || 14400);

// Read + sanitize API key
const RAW_KEY = (process.env.CEREBRAS_API_KEY || process.env.CB_API_KEY || "").trim();
if (!RAW_KEY) {
  console.error(
    "❌ Missing CEREBRAS_API_KEY (or CB_API_KEY). " +
    "Create a .env file next to server.js with CEREBRAS_API_KEY=your_key"
  );
  process.exit(1);
}
const CEREBRAS_API_KEY = RAW_KEY.replace(/\s+/g, ""); // strip accidental spaces/newlines

// ─────────── Logging ───────────
const log = (...a) => console.log(new Date().toISOString(), "-", ...a);

// ─────────── App ───────────
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ─────────── Local token bucket ───────────
let bucket = { capacity: TOKENS_PER_MINUTE, tokens: TOKENS_PER_MINUTE, lastRefill: Date.now() };
function refillBucket() {
  const now = Date.now();
  const elapsedMs = now - bucket.lastRefill;
  if (elapsedMs <= 0) return;
  const refill = (TOKENS_PER_MINUTE * elapsedMs) / 60000;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + refill);
  bucket.lastRefill = now;
}
async function paceToTokens(needTokens) {
  for (;;) {
    refillBucket();
    if (bucket.tokens >= needTokens) { bucket.tokens -= needTokens; return; }
    const deficit = needTokens - bucket.tokens;
    const waitMs = Math.ceil((deficit / TOKENS_PER_MINUTE) * 60000);
    await new Promise(r => setTimeout(r, Math.min(waitMs, 1500)));
  }
}
const estTokens = s => (s ? Math.max(1, Math.ceil(String(s).length / 4)) : 0);

// ─────────── Local Prediction Logic ───────────
function predictNextLane(recentLanes, lastMove) {
  if (!recentLanes || recentLanes.length === 0) return 2;

  const current = recentLanes[recentLanes.length - 1];

  // If we have enough history, look for patterns
  if (recentLanes.length >= 3) {
    // Check if player is staying still
    const last3 = recentLanes.slice(-3);
    if (last3.every(l => l === current)) {
      return current; // They're camping, hit them directly
    }

    // Check for movement patterns
    const movements = [];
    for (let i = 1; i < recentLanes.length; i++) {
      movements.push(recentLanes[i] - recentLanes[i-1]);
    }

    // Get last movement trend
    const recentMovement = movements[movements.length - 1] || 0;

    // Predict continuation of movement
    let predicted = current + recentMovement;

    // If prediction goes out of bounds, assume they'll reverse
    if (predicted < 0) predicted = 0;
    if (predicted > 4) predicted = 4;

    return predicted;
  }

  return current;
}

function createLocalResponse(payload) {
  const { recent_lanes, player_lane, session_stats, overlord_mode } = payload;
  const survivalTime = session_stats?.current_time || 0;

  // Progressive difficulty
  let maxBullets = 1;
  if (survivalTime >= 20) {
    maxBullets = 3;
  } else if (survivalTime >= 5) {
    maxBullets = 2;
  }

  const predictedLane = predictNextLane(recent_lanes, payload.last_move);
  let targetLanes = [predictedLane];

  // Generate LLM-style explanation based on prediction logic
  let explain = '';
  const current = recent_lanes?.[recent_lanes.length - 1] ?? player_lane;

  if (predictedLane === current) {
    if (recent_lanes && recent_lanes.length >= 3 && recent_lanes.slice(-3).every(l => l === current)) {
      explain = `Detecting stationary pattern in lane ${current}`;
    } else {
      explain = `Targeting current position in lane ${predictedLane}`;
    }
  } else {
    const movement = predictedLane - current;
    const direction = movement > 0 ? 'rightward' : 'leftward';
    explain = `Predicting ${direction} movement to lane ${predictedLane}`;
  }

  // Add flanking shots for advanced phases
  if (maxBullets > 1 && overlord_mode === 'aggressive') {
    if (predictedLane > 0 && targetLanes.length < maxBullets) {
      targetLanes.push(predictedLane - 1);
    }
    if (predictedLane < 4 && targetLanes.length < maxBullets) {
      targetLanes.push(predictedLane + 1);
    }

    if (targetLanes.length > 1) {
      explain += ` with flanking shots`;
    }
  }

  return {
    decision: 'spawn_bullets',
    params: {
      count: targetLanes.length,
      lanes: targetLanes,
      dirs: targetLanes.map(() => 0),
      speed: overlord_mode === 'aggressive' ? 1.2 : 1.0
    },
    explain: explain,
    source: 'local-logic'
  };
}

// ─────────── Prompt (strict JSON) ───────────
function buildMessages(p) {
  const { player_id, last_move, recent_moves, recent_lanes, player_lane, lanes, session_stats, overlord_mode, tick } = p || {};

  // Progressive difficulty based on survival time
  const survivalTime = session_stats?.current_time || 0;
  let bulletConstraint = "";

  if (survivalTime < 5) {
    bulletConstraint = "CRITICAL: Player in BEGINNER phase (0-5s survival). For spawn_bullets decision, you MUST use count=1 only. Target predicted movement.";
  } else if (survivalTime < 20) {
    bulletConstraint = "Player in INTERMEDIATE phase (5-20s survival). For spawn_bullets decision, use count=1 or count=2 maximum. May add flanking shots.";
  } else {
    bulletConstraint = "Player in EXPERT phase (20s+ survival). For spawn_bullets decision, you may use count=1,2,3 based on difficulty. Full tactical options available.";
  }

  const system = [
    "You are the Overlord Decision Engine for a 5-lane dodge game.",
    `LANE SYSTEM: ${lanes || 5} lanes numbered 0,1,2,3,4 (left to right). Player currently in lane ${player_lane || 2}.`,
    "PREDICTION TASK: Analyze recent_lanes pattern to predict where player will move next. Target predicted position, not current position.",
    bulletConstraint,
    "REQUIRED OUTPUT FORMAT:",
    '- For spawn_bullets: {"decision": "spawn_bullets", "params": {"count": N, "lanes": [predicted_lane_numbers], "dirs": [0,0,...], "speed": 1.0}, "explain": "reason"}',
    '- lanes array contains target lane numbers (0-4)',
    '- count must match lanes array length',
    '- dirs array: 0=straight down, same length as lanes',
    "EXAMPLE: If player in lane 2 with recent pattern [1,2,3], predict lane 4:",
    '{"decision": "spawn_bullets", "params": {"count": 1, "lanes": [4], "dirs": [0], "speed": 1.0}, "explain": "Predicting rightward movement to lane 4"}',
    "Return ONLY compact JSON. No code fences. No prose outside JSON.",
    'Other allowed decisions: "slow_time", "change_speed", "taunt", "no_op".',
    "Rules:",
    "- Keep explain under 120 chars.",
    "- Always include required params for spawn_bullets",
    "- If unsure about prediction, target current player_lane",
  ].join("\n");

  const user = JSON.stringify({
    player_id, last_move, recent_moves, recent_lanes,
    player_lane, lanes, session_stats, overlord_mode, tick
  });

  return [
    { role: "system", content: system },
    { role: "user", content: "Based on this state, choose one decision. Analyze recent_lanes pattern for prediction. Respond with JSON ONLY:\n" + user },
  ];
}

// ─────────── Parsing ───────────
function safeParseDecision(text) {
  const fallback = { decision: "no_op", params: {}, explain: "fallback: unparsable model output", _raw: text };
  if (!text || typeof text !== "string") return fallback;
  try { return sanitizeDecision(JSON.parse(text.trim()), text); } catch {}
  const i = text.indexOf("{"), j = text.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return sanitizeDecision(JSON.parse(text.slice(i, j + 1)), text); } catch {} }
  return fallback;
}
function sanitizeDecision(j, raw) {
  const out = { decision: "no_op", params: {}, explain: "ok", _raw: raw };
  if (j && typeof j === "object") {
    if (typeof j.decision === "string") out.decision = j.decision;
    if (j.params && typeof j.params === "object") out.params = j.params;
    if (typeof j.explain === "string") out.explain = j.explain.slice(0, 240);
  }
  if (out.decision === "slow_time") {
    const d = Number(out.params?.duration_ms), s = Number(out.params?.speed);
    out.params.duration_ms = Number.isFinite(d) ? Math.max(100, Math.min(d, 5000)) : 800;
    out.params.speed = Number.isFinite(s) ? Math.max(0.2, Math.min(s, 1.0)) : 0.9;
  }
  return out;
}

// ─────────── Cerebras call ───────────
async function cerebrasChat(messages) {
  const body = { model: MODEL, messages, temperature: 0.2, max_tokens: Math.max(32, Math.min(MAX_TOKENS, 2048)), stream: false };
  await paceToTokens(estTokens(JSON.stringify(messages)) + body.max_tokens);

  const url = `${CEREBRAS_BASE}/v1/chat/completions`;
  const abort = new AbortController();
  const t = setTimeout(() => abort.abort(), CLIENT_TIMEOUT_MS);

  let tries = 0, lastErr = null;
  while (tries < 2) {
    tries++;
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: abort.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${CEREBRAS_API_KEY}` },
        body: JSON.stringify(body),
      });

      if (res.status === 401) {
        const bodyTxt = await res.text();
        clearTimeout(t);
        return { ok: false, error: `401 Unauthorized from Cerebras. Check API key/workspace. Body: ${bodyTxt.slice(0, 400)}` };
      }
      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after") || 0);
        await new Promise(r => setTimeout(r, (ra ? ra * 1000 : 1200)));
        continue;
      }

      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { lastErr = new Error("Bad JSON from provider"); break; }
      if (!res.ok) { lastErr = new Error(`Upstream error ${res.status}: ${JSON.stringify(data).slice(0, 400)}`); break; }

      clearTimeout(t);
      return { ok: true, usage: data.usage || {}, content: data.choices?.[0]?.message?.content ?? "", http_status: res.status };
    } catch (e) {
      lastErr = e.name === "AbortError" ? new Error("Upstream timeout") : e;
    }
  }
  clearTimeout(t);
  return { ok: false, error: String(lastErr || "Unknown error") };
}

// ─────────── Stats ───────────
const stats = { started_at: new Date().toISOString(), total_requests: 0, model_used: MODEL };
function localRateLimitView() {
  refillBucket();
  const resetSecs = Math.max(0, 60000 - (Date.now() - bucket.lastRefill)) / 1000;
  return {
    limit_tokens_minute: TOKENS_PER_MINUTE,
    remaining_tokens_minute: Math.max(0, Math.floor(bucket.tokens)),
    reset_tokens_minute_secs: Math.max(0, Math.floor(resetSecs)),
    limit_requests_day: LIMIT_REQUESTS_DAY,
    note: "Local token-bucket view (approx). Real billing limits are on Cerebras.",
  };
}

// ─────────── Routes ───────────
app.get("/health", (req, res) => {
  // mask the key when logging
  const tail = CEREBRAS_API_KEY.slice(-6);
  res.json({ ok: true, mode: "LIVE", model_used: MODEL, started_at: stats.started_at, cerebras_base: CEREBRAS_BASE, key_tail: `...${tail}` });
});
app.get("/stats", (req, res) => res.json({ ok: true, ...stats }));
app.get("/ratelimit", (req, res) => res.json({ ok: true, source: "local-bucket", headers: localRateLimitView() }));

app.post("/decide", async (req, res) => {
  const t0 = Date.now();
  stats.total_requests++;
  const payload = req.body || {};
  const survivalTime = payload.session_stats?.current_time || 0;

  // Phase-based routing: Beginner vs Advanced
  if (survivalTime < 5) {
    // BEGINNER PHASE: Use fast local logic only
    const localResponse = createLocalResponse(payload);
    localResponse.latency_ms = Date.now() - t0;
    return res.status(200).json(localResponse);
  }

  // ADVANCED PHASE: Hybrid approach - immediate local + async AI
  const localResponse = createLocalResponse(payload);
  localResponse.latency_ms = Date.now() - t0;

  // Try AI enhancement with timeout
  const AI_TIMEOUT = 400; // Reduced timeout for better responsiveness

  try {
    const aiPromise = cerebrasChat(buildMessages(payload));
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("AI timeout")), AI_TIMEOUT)
    );

    const upstream = await Promise.race([aiPromise, timeoutPromise]);

    if (upstream.ok) {
      const aiResponse = safeParseDecision(upstream.content);

      // Validate AI response has proper format
      if (aiResponse.decision === "spawn_bullets" &&
          aiResponse.params?.lanes &&
          Array.isArray(aiResponse.params.lanes)) {

        // Return AI response with enhanced intelligence
        return res.status(200).json({
          decision: aiResponse.decision,
          params: aiResponse.params,
          explain: aiResponse.explain,
          source: "cerebras-hybrid",
          latency_ms: Date.now() - t0,
          usage: upstream.usage,
          fallback_available: true
        });
      }
    }
  } catch (error) {
    // AI failed or timed out - local response is already prepared
    log("AI enhancement failed:", error.message);
  }

  // Return immediate local response (AI failed or timed out)
  return res.status(200).json(localResponse);
});

// add near other routes
app.post('/taunt', (req, res) => {
  const lines = [
    "You move like dial-up.",
    "I've seen faster lanes on a Monday.",
    "Predictable. Again.",
    "Left? Right? Wrong."
  ];
  res.json({ message: lines[Math.floor(Math.random()*lines.length)] });
});

// ─────────── Boot ───────────
http.createServer(app).listen(PORT, '0.0.0.0', () => {
  log("🤖 AI Overlord Server");
  log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log("Mode:", "LIVE");
  log("Port:", PORT);
  log("Model:", MODEL);
  log("Timeout:", CLIENT_TIMEOUT_MS + "ms");
  log("Cerebras Base:", CEREBRAS_BASE);
  log("Key tail:", "..." + CEREBRAS_API_KEY.slice(-6));
  log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log(`curl http://localhost:${PORT}/health`);
  log(`curl -X POST http://localhost:${PORT}/decide -H "Content-Type: application/json" -d '{"player_id":"p","last_move":"left","recent_moves":["left","up"],"session_stats":{"best_time":5,"current_time":3},"overlord_mode":"aggressive","tick":7}'`);
  log(`curl http://localhost:${PORT}/stats`);
}).on("error", (e) => {
  console.error("Server failed to start:", e);
  process.exit(1);
});