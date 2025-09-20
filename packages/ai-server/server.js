// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Cerebras } from '@cerebras/cerebras_cloud_sdk';
import crypto from 'crypto';
import { getRateLimitStatus } from './rate-limit.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// -------- ENV --------
const PORT = Number(process.env.PORT || 8787);
const MOCK_MODE = String(process.env.MOCK_MODE || 'true').toLowerCase() === 'true';
const CLIENT_TIMEOUT_MS = Number(process.env.CLIENT_TIMEOUT_MS || 450);
const LATENCY_INJECTION_MS = Number(process.env.LATENCY_INJECTION_MS || 0);

// -------- Cerebras client (only when LIVE) --------
let cerebrasClient = null;
if (!MOCK_MODE && process.env.CEREBRAS_API_KEY) {
  cerebrasClient = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY });
}

// -------- Game action space (keep aligned with frontend) --------
const ACTIONS = [
  'spawn_fast_left',
  'spawn_fast_right',
  'spawn_slow_left',
  'spawn_slow_right',
  'dash',
  'shoot',
  'shield',
  'slow_time',
  'speed_up',
  'spawn_coin',
];

// -------- Light server stats --------
const recentLatencies = [];
const MAX_SAMPLES = 512;
let totalRequests = 0;
let totalErrors = 0;

function recordLatency(ms) {
  recentLatencies.push(ms);
  if (recentLatencies.length > MAX_SAMPLES) recentLatencies.shift();
}
function p95(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const idx = Math.min(a.length - 1, Math.floor(a.length * 0.95));
  return a[idx];
}

// -------- Helpers --------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function mockDecision(payload) {
  const { last_move = 'left', recent_moves = [], overlord_mode = 'balanced', tick = 0 } = payload || {};
  const repetitive = recent_moves.slice(-3).every((m) => m === last_move) && recent_moves.length >= 3;

  // Choose a decision with mild “intelligence” and mode bias
  let decision = 'spawn_fast_left';
  if (repetitive) {
    decision = last_move === 'left' ? 'spawn_fast_left' : 'spawn_fast_right';
  } else {
    const pools = {
      aggressive: ['spawn_fast_left', 'spawn_fast_right', 'speed_up', 'shoot', 'dash', 'spawn_coin', 'shield', 'slow_time', 'spawn_slow_left', 'spawn_slow_right'],
      defensive: ['shield', 'slow_time', 'spawn_coin', 'spawn_slow_left', 'spawn_slow_right', 'dash', 'shoot', 'speed_up', 'spawn_fast_left', 'spawn_fast_right'],
      balanced: ACTIONS,
    };
    const pool = pools[overlord_mode] || ACTIONS;
    decision = pool[tick % pool.length];
  }

  // Params within safe bounds for gameplay feel
  const duration_ms = clamp(600 + ((tick * 37) % 700), 200, 1500);
  const speed = clamp(0.9 + ((tick % 7) * 0.08), 0.8, 1.6);

  const explain = repetitive
    ? `Countering your ${last_move} pattern`
    : `Mode=${overlord_mode}. Balanced pressure based on recent context`;

  return {
    decision,
    params: { duration_ms, speed: Number(speed.toFixed(3)) },
    explain,
    source: 'mock',
  };
}

async function cerebrasDecisionSameSchema(payload) {
  if (!cerebrasClient) throw new Error('cerebras_not_configured');

  const model = process.env.CEREBRAS_MODEL || "llama3.1-8b";
  const temperature = Number(process.env.CEREBRAS_TEMPERATURE || 0.6);
  const maxTokens = Number(process.env.CEREBRAS_MAX_TOKENS || 128);

  const system = [
    'You control hazards in a 4-lane survival game.',
    'Return ONLY compact JSON with fields: decision, params, explain.',
    `decision must be one of: ${ACTIONS.join(', ')}.`,
    'params = {"duration_ms": int between 200..1500, "speed": float between 0.8..1.6}.',
    'Keep "explain" very short.',
  ].join(' ');

  const user = `Game state:
${JSON.stringify(payload, null, 2)}

Return JSON exactly like:
{"decision":"spawn_fast_left","params":{"duration_ms":820,"speed":1.2},"explain":"short reason"}`;

  const rsp = await cerebrasClient.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  });

  let out = {};
  try {
    const content = rsp?.choices?.[0]?.message?.content?.trim() || '{}';
    out = JSON.parse(content);
  } catch {
    out = {};
  }

  // Sanitize to schema + bounds
  let decision = out.decision;
  if (!ACTIONS.includes(decision)) decision = 'spawn_fast_left';

  const p = out.params || {};
  const duration_ms = clamp(parseInt(p.duration_ms ?? 800, 10) || 800, 200, 1500);
  const speed = clamp(Number(p.speed ?? 1.2) || 1.2, 0.8, 1.6);

  const explain = typeof out.explain === 'string' ? out.explain : 'balanced move';

  return {
    decision,
    params: { duration_ms, speed: Number(speed.toFixed(3)) },
    explain,
    source: 'cerebras',
  };
}

// -------- Routes --------
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    mode: MOCK_MODE ? 'MOCK' : 'LIVE',
    cerebrasConfigured: Boolean(cerebrasClient),
    time: new Date().toISOString(),
  });
});

app.get('/modes', (_req, res) => {
  res.json({ modes: ['balanced', 'aggressive', 'defensive'] });
});

app.get('/stats', (_req, res) => {
  res.json({
    requests: totalRequests,
    errors: totalErrors,
    recentSamples: recentLatencies.length,
    p95_ms: p95(recentLatencies),
    avg_ms: recentLatencies.length
      ? Math.round(recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length)
      : 0,
    lastSample_ms: recentLatencies.at(-1) ?? 0,
  });
});

app.post('/decide', async (req, res) => {
  const t0 = Date.now();
  totalRequests++;

  try {
    const {
      player_id = 'anon',
      last_move = null,
      recent_moves = [],
      session_stats = {},
      overlord_mode = 'balanced',
      run_id = crypto.randomUUID(),
      tick = 0,
    } = req.body || {};

    const payload = { player_id, last_move, recent_moves, session_stats, overlord_mode, run_id, tick };

    if (LATENCY_INJECTION_MS > 0) await sleep(LATENCY_INJECTION_MS);

    let result;
    if (MOCK_MODE || !cerebrasClient) {
      // MOCK path (fast)
      result = mockDecision(payload);
    } else {
      // LIVE path with fast fallback
      try {
        result = await Promise.race([
          cerebrasDecisionSameSchema(payload),
          new Promise((_, rej) => setTimeout(() => rej(new Error('llm_timeout')), CLIENT_TIMEOUT_MS)),
        ]);
      } catch (e) {
        result = mockDecision(payload);
        result.source = 'mock-fallback';
        result.explain = `${result.explain} (fallback: ${e.message})`;
      }
    }

    const latency_ms = Date.now() - t0;
    recordLatency(latency_ms);
    res.json({ ...result, latency_ms });
  } catch (err) {
    totalErrors++;
    const latency_ms = Date.now() - t0;
    recordLatency(latency_ms);
    res.status(500).json({ ok: false, error: String(err?.message || err), latency_ms });
  }
});

app.get('/ratelimit', async (_req, res) => {
  try {
    const info = await getRateLimitStatus({});
    res.status(info.ok ? 200 : 503).json(info);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// -------- Start --------
app.listen(PORT, () => {
  console.log(`
🤖 AI Overlord Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Mode: ${MOCK_MODE ? 'MOCK' : 'LIVE'}
Port: ${PORT}
Cerebras: ${cerebrasClient ? 'Connected' : 'Not configured'}
Timeout: ${CLIENT_TIMEOUT_MS}ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Examples:
curl http://localhost:${PORT}/health
curl -X POST http://localhost:${PORT}/decide -H "Content-Type: application/json" -d '{"player_id":"p","last_move":"left","recent_moves":["left","up"],"session_stats":{"best_time":5,"current_time":3},"overlord_mode":"aggressive","tick":7}'
curl http://localhost:${PORT}/stats
`);
});
