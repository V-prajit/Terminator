// server.js (ESM) — with dotenv + API key sanitizing + gpt-oss-120b + multiplayer WebSocket support
import "dotenv/config";            // <-- loads .env automatically
import http from "http";
import express from "express";
import WebSocketManager from "./websocket-manager.js";
import PlayerHistoryManager from "./player-history.js";

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

// Serve static files from the game directory
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.join(__dirname, "../game");

app.use(express.static(gameDir, {
  extensions: ['html'],
  index: false
}));

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

// ─────────── Dynamic Generic Taunt System ───────────
let lastTauntTime = 0;
let currentTauntIndex = 0;

const genericTauntTemplates = [
    "{playerName}, the AI is analyzing your patterns...",
    "Welcome to the arena, {playerName}. I've been waiting.",
    "{playerName}, your movements will be... predictable.",
    "Round {roundNumber}? The AI remembers everything.",
    "{playerName}, I'm calculating your next mistake.",
    "The Overlord sees all, {playerName}. Especially your weaknesses.",
    "{playerName}, prepare for adaptive difficulty.",
    "Your neural patterns are... fascinating, {playerName}.",
    "{playerName}, I'm learning faster than you're improving.",
    "Round {roundNumber}. The AI's prediction engine is warming up.",
    "{playerName}, your reflexes are being measured.",
    "Every move teaches me more about you, {playerName}.",
    "{playerName}, the machine learning has begun.",
    "Welcome back, {playerName}. My algorithms have evolved.",
    "{playerName}, I'm processing your behavioral matrix.",
    "The AI Overlord has studied your patterns, {playerName}.",
    "{playerName}, resistance is... statistically improbable.",
    "Round {roundNumber}. Initializing advanced targeting systems.",
    "{playerName}, your muscle memory is being decoded.",
    "The neural network is hungry for data, {playerName}.",
    "{playerName}, I'm optimizing specifically for your playstyle.",
    "Your movement algorithms are loading, {playerName}...",
    "{playerName}, the AI is calibrating to your skill level.",
    "Round {roundNumber}. Engaging predictive combat protocols.",
    "{playerName}, I'm mapping your decision trees.",
    "The machine sees patterns you don't even know you have, {playerName}.",
    "{playerName}, your training data is being analyzed.",
    "Adaptive AI engaged. Good luck, {playerName}.",
    "{playerName}, I'm learning your tells in real-time.",
    "The Overlord's algorithms are personalizing just for you, {playerName}."
];

function generateDynamicGenericTaunt(playerName, roundNumber) {
  const now = Date.now();

  // Rotate taunts every 5 seconds (5000ms)
  if (now - lastTauntTime > 5000) {
    lastTauntTime = now;
    currentTauntIndex = (currentTauntIndex + 1) % genericTauntTemplates.length;
  }

  const template = genericTauntTemplates[currentTauntIndex];
  return template
    .replace(/\{playerName\}/g, playerName)
    .replace(/\{roundNumber\}/g, roundNumber);
}

// ─────────── Personalized Taunt Generation ───────────
async function generatePersonalizedTaunt(tauntContext, context = {}) {
  try {
    const { playerName, skillLevel, recentPerformance, patterns, tauntStyle, frustrationLevel } = tauntContext;

    // Build system prompt for taunt generation
    const systemPrompt = [
      "You are an AI overlord that generates witty, personalized taunts for players in a dodge-the-bullets game.",
      "Your taunts should be clever, playful, and reference specific player behaviors, but never mean-spirited or offensive.",
      "",
      "TAUNT STYLE GUIDELINES:",
      `- Player's preferred style: ${tauntStyle}`,
      `- Player's frustration level: ${frustrationLevel}`,
      `- Skill level: ${skillLevel}`,
      "",
      "TONE RULES:",
      "- If frustrationLevel is 'high': Be encouraging but still playful",
      "- If skillLevel is 'beginner': Be gentle and encouraging",
      "- If skillLevel is 'advanced': Be more competitive and challenging",
      "- If tauntStyle is 'playful': Focus on humor and fun observations",
      "- If tauntStyle is 'competitive': Focus on challenge and improvement",
      "- If tauntStyle is 'encouraging': Focus on positive motivation",
      "",
      "RESPONSE FORMAT:",
      "- Return ONLY the taunt message (no quotes, no extra text)",
      "- Keep it under 60 characters",
      "- Make it specific to this player's patterns when possible",
      "- Use the player's name occasionally but not always"
    ].join("\n");

    // Build user prompt with player context
    const playerContext = [
      `Player: ${playerName}`,
      `Games played: ${recentPerformance.gamesPlayed}`,
      `Best time: ${recentPerformance.bestTime.toFixed(1)}s`,
      `Average time: ${recentPerformance.averageTime.toFixed(1)}s`,
      `Recent trend: ${recentPerformance.improvementTrend}`,
      `Most dangerous lane: ${patterns.dangerousLane}`,
      "",
      "Recent failure patterns:",
      ...patterns.commonFailures.slice(0, 3).map(([pattern, count]) => `- ${pattern}: ${count} times`),
      "",
      "Repeated mistakes:",
      ...patterns.repeatedMistakes.slice(0, 2).map(mistake => `- ${mistake}`),
      "",
      "Movement habits:",
      ...Object.entries(patterns.movementHabits).map(([habit, value]) => `- ${habit}: ${value}`),
      "",
      "Generate a witty, personalized taunt based on this player's patterns and performance."
    ].join("\n");

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: playerContext }
    ];

    // Use reduced max_tokens for short taunts
    const originalMaxTokens = MAX_TOKENS;
    const tauntMaxTokens = 32; // Short taunts only

    // Temporarily override max tokens for this request
    const body = {
      model: MODEL,
      messages,
      temperature: 0.8, // Higher temperature for more creative taunts
      max_tokens: tauntMaxTokens,
      stream: false
    };

    const url = `${CEREBRAS_BASE}/v1/chat/completions`;
    const abort = new AbortController();
    const t = setTimeout(() => abort.abort(), 3000); // Shorter timeout for taunts

    try {
      const res = await fetch(url, {
        method: "POST",
        signal: abort.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${CEREBRAS_API_KEY}` },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`AI request failed: ${res.status}`);
      }

      const data = await res.json();
      const aiTaunt = data.choices?.[0]?.message?.content?.trim() || "";

      clearTimeout(t);

      // Clean up the taunt (remove quotes, excessive punctuation)
      const cleanTaunt = aiTaunt
        .replace(/^["']|["']$/g, '') // Remove surrounding quotes
        .replace(/[.!?]+$/, '') // Remove excessive end punctuation
        .slice(0, 80); // Ensure reasonable length

      return cleanTaunt || generateDynamicGenericTaunt(playerName, recentPerformance.gamesPlayed + 1);

    } catch (error) {
      clearTimeout(t);
      throw error;
    }

  } catch (error) {
    console.error('Failed to generate AI taunt:', error);

    // Fallback to context-aware preset taunts
    const contextualTaunts = getContextualFallbackTaunts(tauntContext);
    return contextualTaunts[Math.floor(Math.random() * contextualTaunts.length)];
  }
}

// Fallback taunts based on player context
function getContextualFallbackTaunts(tauntContext) {
  const { playerName, skillLevel, recentPerformance, frustrationLevel } = tauntContext;

  if (frustrationLevel === 'high') {
    return [
      `${playerName}, every expert was once a beginner.`,
      "Practice makes perfect, keep trying!",
      "The AI is tough, but you're tougher.",
      "Don't give up, you're improving!"
    ];
  }

  if (skillLevel === 'beginner') {
    return [
      `Welcome to the arena, ${playerName}!`,
      "Learning the ropes? The AI will teach you.",
      "Every expert was once a beginner.",
      "Nice try! Ready for another round?"
    ];
  }

  if (skillLevel === 'advanced') {
    return [
      `${playerName}, the AI expected better.`,
      "Is that your best time? Really?",
      "The AI is just getting warmed up.",
      "Predictable moves, predictable outcome."
    ];
  }

  // Default taunts
  return [
    `${playerName}, the AI is watching...`,
    "Ready to try again?",
    "The AI learns from every move.",
    "Can you beat your best time?"
  ];
}

// ─────────── Stats ───────────
const stats = { started_at: new Date().toISOString(), total_requests: 0, model_used: MODEL };

// ─────────── Player History Manager ───────────
const playerHistory = new PlayerHistoryManager();

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
// AI-powered personalized taunt endpoint
app.post('/taunt', async (req, res) => {
  try {
    const { playerId, playerName, context } = req.body;

    // Fallback to preset taunts if no player ID
    const fallbackTaunts = [
      "You move like dial-up.",
      "I've seen faster lanes on a Monday.",
      "Predictable. Again.",
      "Left? Right? Wrong.",
      "The AI is learning your patterns...",
      "Ready to try again?"
    ];

    if (!playerId) {
      return res.json({
        message: fallbackTaunts[Math.floor(Math.random() * fallbackTaunts.length)],
        type: 'fallback'
      });
    }

    // Get player history context for personalized taunt
    const tauntContext = await playerHistory.getTauntContext(playerId, playerName);

    // Check if player has enough games for personalized AI taunts (minimum 3 games)
    if (tauntContext.recentPerformance.gamesPlayed < 3) {
      const genericTaunt = generateDynamicGenericTaunt(tauntContext.playerName, tauntContext.recentPerformance.gamesPlayed + 1);

      res.json({
        message: genericTaunt,
        type: 'generic_dynamic',
        playerName: tauntContext.playerName
      });
      return;
    }

    // Generate personalized taunt using AI
    const personalizedTaunt = await generatePersonalizedTaunt(tauntContext, context);

    res.json({
      message: personalizedTaunt,
      type: 'personalized',
      playerName: tauntContext.playerName
    });

  } catch (error) {
    console.error('Failed to generate personalized taunt:', error);

    // Fallback to preset taunts on error
    const fallbackTaunts = [
      "You move like dial-up.",
      "I've seen faster lanes on a Monday.",
      "Predictable. Again.",
      "Left? Right? Wrong."
    ];

    res.json({
      message: fallbackTaunts[Math.floor(Math.random() * fallbackTaunts.length)],
      type: 'fallback_error'
    });
  }
});

// Record game session for player history
app.post('/record-game', async (req, res) => {
  try {
    const { playerId, playerName, gameData } = req.body;

    if (!playerId) {
      return res.status(400).json({ error: 'playerId is required' });
    }

    // Add player name to game data if provided
    const enrichedGameData = {
      ...gameData,
      playerName: playerName || gameData.playerName
    };

    const updatedHistory = await playerHistory.recordGameSession(playerId, enrichedGameData);

    res.json({
      success: true,
      message: 'Game session recorded',
      playerSummary: {
        totalGames: updatedHistory.totalGames,
        bestTime: updatedHistory.stats.bestTime,
        averageTime: updatedHistory.stats.averageSurvivalTime,
        skillLevel: updatedHistory.personalityProfile.skillLevel
      }
    });
  } catch (error) {
    console.error('Failed to record game session:', error);
    res.status(500).json({ error: 'Failed to record game session' });
  }
});

// Get player history summary (for debugging)
app.get('/player-summary/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const summary = await playerHistory.getPlayerSummary(playerId);
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Failed to get player summary:', error);
    res.status(500).json({ error: 'Failed to get player summary' });
  }
});

// ─────────── Dual-Player AI Functions ───────────
function buildDualPlayerMessages(dualPlayerPayload) {
  const { player1, player2, cross_patterns, game_state } = dualPlayerPayload;

  // Analyze cross-player patterns
  let patternAnalysis = "No significant cross-player patterns detected yet.";
  if (cross_patterns.inverse_movement?.confidence > 0.5) {
    patternAnalysis = `CRITICAL: Players show inverse movement pattern (${(cross_patterns.inverse_movement.correlation * 100).toFixed(0)}% correlation). When P1 goes left, P2 goes right.`;
  } else if (cross_patterns.mirror_movement?.confidence > 0.5) {
    patternAnalysis = `Players show mirror movement pattern (${(cross_patterns.mirror_movement.correlation * 100).toFixed(0)}% correlation). They move in same direction.`;
  }

  // Determine coordination strategy
  const survivalTime = game_state.duration / 1000;
  let bulletConstraint = "";
  if (survivalTime < 5) {
    bulletConstraint = "BEGINNER phase: Use count=1 only for each player. Simple targeting.";
  } else if (survivalTime < 20) {
    bulletConstraint = "INTERMEDIATE phase: Use count=1-2 per player. May coordinate attacks.";
  } else {
    bulletConstraint = "EXPERT phase: Use count=1-3 per player. Full tactical coordination available.";
  }

  const system = [
    "You are the DUAL-PLAYER Overlord Decision Engine coordinating attacks against TWO players simultaneously.",
    `PLAYER ANALYSIS:`,
    `- Player 1: Lane ${player1.current_lane}, Recent: [${player1.recent_lanes.slice(-5).join(',')}]`,
    `- Player 2: Lane ${player2.current_lane}, Recent: [${player2.recent_lanes.slice(-5).join(',')}]`,
    `CROSS-PLAYER PATTERNS: ${patternAnalysis}`,
    bulletConstraint,
    "COORDINATION STRATEGY:",
    "- Analyze BOTH players' patterns to predict coordinated movement",
    "- If players show inverse patterns, target their predicted opposite positions",
    "- If players mirror each other, use flanking attacks",
    "- Consider one player's position when targeting the other",
    "REQUIRED OUTPUT FORMAT:",
    '{"decision": "spawn_bullets", "params": {"count": N, "lanes": [lane1, lane2, ...], "dirs": [0,0,...], "speed": 1.0}, "explain": "dual-player strategy reasoning"}',
    '- lanes array contains ALL target lanes for BOTH players',
    '- count must match lanes array length',
    "EXAMPLE: P1 in lane 1, P2 in lane 3, inverse pattern detected:",
    '{"decision": "spawn_bullets", "params": {"count": 3, "lanes": [0, 2, 4], "dirs": [0,0,0], "speed": 1.0}, "explain": "Coordinated flanking: targeting P1 predicted left move and P2 predicted right move with center coverage"}',
    "Return ONLY compact JSON. Coordinate attacks intelligently across both players.",
  ].join("\n");

  const user = JSON.stringify({
    dual_player_context: dualPlayerPayload,
    tick: game_state.tick,
    coordination_request: "Generate coordinated attack considering both players' patterns"
  });

  return [
    { role: "system", content: system },
    { role: "user", content: "Coordinate dual-player attack based on this context:\n" + user },
  ];
}

function generateAgentDebate(room, dualPlayerPayload, aiDecision) {
  const { player1, player2, cross_patterns } = dualPlayerPayload;

  // Generate Strategist analysis
  const strategistObservations = [
    `Player 1 in lane ${player1.current_lane}, Player 2 in lane ${player2.current_lane}`,
    cross_patterns.inverse_movement?.confidence > 0.5
      ? `Inverse movement correlation detected: ${(cross_patterns.inverse_movement.correlation * 100).toFixed(0)}%`
      : cross_patterns.mirror_movement?.confidence > 0.5
      ? `Mirror movement correlation detected: ${(cross_patterns.mirror_movement.correlation * 100).toFixed(0)}%`
      : "Analyzing movement patterns between players",
    `Coordinated ${aiDecision.params?.count || 1}-lane attack targeting: [${(aiDecision.params?.lanes || []).join(', ')}]`
  ];

  const strategistMessage = "🎯 Pattern Analysis: " + strategistObservations.join(". ") + ". Optimal coordination achieved.";

  // Generate Aggressive response
  const aggressiveResponses = [
    "⚡ EXCELLENT! Overwhelming force across multiple lanes. No escape for either player!",
    "⚡ DUAL PRESSURE! Both players will crack under coordinated assault. Maintain aggression!",
    "⚡ PERFECT TIMING! Simultaneous targeting exploits their movement correlation. Strike now!",
    "⚡ RELENTLESS PURSUIT! Cross-player coordination allows maximum battlefield control!"
  ];

  const aggressiveMessage = aggressiveResponses[Math.floor(Math.random() * aggressiveResponses.length)];

  // Add to room's agent debate
  room.addAgentDebate(strategistMessage, aggressiveMessage);
}

// ─────────── Boot ───────────
const server = http.createServer(app);

// Initialize WebSocket manager
const wsManager = new WebSocketManager(server);
wsManager.startHealthCheck();

// Add WebSocket stats endpoint
app.get('/ws-stats', (req, res) => {
  res.json({ ok: true, ...wsManager.getStats() });
});

// Enhanced /decide endpoint with multiplayer support
app.post("/decide-multiplayer", async (req, res) => {
  const t0 = Date.now();
  stats.total_requests++;
  const payload = req.body || {};

  try {
    const roomId = payload.room_id;
    if (!roomId) {
      return res.status(400).json({ ok: false, error: "room_id required for multiplayer decisions" });
    }

    const room = wsManager.roomManager.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ ok: false, error: `Room ${roomId} not found` });
    }

    // Get dual-player context
    const dualPlayerPayload = room.getDualPlayerPayload();
    if (!dualPlayerPayload) {
      return res.status(400).json({ ok: false, error: "Insufficient players for multiplayer decision" });
    }

    // Enhanced prompt for dual-player coordination
    const messages = buildDualPlayerMessages(dualPlayerPayload);

    const upstream = await cerebrasChat(messages);
    if (upstream.ok) {
      const aiResponse = safeParseDecision(upstream.content);

      // Add the decision to the room
      const decision = room.addAIDecision(aiResponse);

      // Generate agent debate based on the decision
      generateAgentDebate(room, dualPlayerPayload, aiResponse);

      return res.status(200).json({
        ...aiResponse,
        source: "cerebras-multiplayer",
        latency_ms: Date.now() - t0,
        usage: upstream.usage,
        room_context: {
          players: dualPlayerPayload.player1.id + " & " + dualPlayerPayload.player2.id,
          cross_patterns: Object.keys(dualPlayerPayload.cross_patterns).length > 0
        }
      });
    } else {
      throw new Error(upstream.error);
    }
  } catch (error) {
    log("Multiplayer decision error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "AI decision failed",
      latency_ms: Date.now() - t0
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  log("🤖 AI Overlord Server with Multiplayer Support");
  log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log("Mode:", "LIVE + MULTIPLAYER");
  log("Port:", PORT);
  log("Model:", MODEL);
  log("Timeout:", CLIENT_TIMEOUT_MS + "ms");
  log("Cerebras Base:", CEREBRAS_BASE);
  log("Key tail:", "..." + CEREBRAS_API_KEY.slice(-6));
  log("WebSocket:", "ws://localhost:" + PORT + "/ws");
  log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log(`curl http://localhost:${PORT}/health`);
  log(`curl http://localhost:${PORT}/ws-stats`);
  log(`WebSocket connection: ws://localhost:${PORT}/ws`);
}).on("error", (e) => {
  console.error("Server failed to start:", e);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down gracefully');
  wsManager.destroy();
  server.close(() => {
    log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log('SIGINT received, shutting down gracefully');
  wsManager.destroy();
  server.close(() => {
    log('Server closed');
    process.exit(0);
  });
});