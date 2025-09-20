// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { createRateLimiter } from './rate-limit.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const PORT = Number(process.env.PORT || 8787);
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const CEREBRAS_TAUNT_API_KEY = process.env.CEREBRAS_TAUNT_API_KEY;
const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || 'gpt-oss-120b';
const CEREBRAS_TAUNT_MODEL = process.env.CEREBRAS_TAUNT_MODEL || 'gpt-oss-120b';
const CLIENT_TIMEOUT_MS = Number(process.env.CLIENT_TIMEOUT_MS || 2000);
const TOKENS_PER_MINUTE = Number(process.env.TOKENS_PER_MINUTE || 60000);

// Rate limiter
const rateLimiter = createRateLimiter(TOKENS_PER_MINUTE);

// Stats tracking
let totalRequests = 0;
let totalErrors = 0;
const recentLatencies = [];
const MAX_LATENCY_SAMPLES = 100;

// Helper functions
const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

function maskKey(key) {
  if (!key) return 'not-configured';
  return key.slice(0, 3) + '...' + key.slice(-4);
}

function extractJSON(text) {
  const match = text.match(/\{[^{}]*\}/);
  return match ? match[0] : text;
}

async function callCerebras(apiKey, model, systemPrompt, userPrompt, timeout = CLIENT_TIMEOUT_MS) {
  if (!apiKey) throw new Error('API key not configured');
  
  await rateLimiter.waitForCapacity(500); // Estimate tokens
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 200
      }),
      signal: controller.signal
    });
    
    if (!response.ok) {
      if (response.status === 429) {
        await rateLimiter.handleRateLimit();
      }
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    return JSON.parse(extractJSON(content));
  } finally {
    clearTimeout(timeoutId);
  }
}

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
    if (predicted < 0) predicted = 1;
    if (predicted > 4) predicted = 3;
    
    return predicted;
  }
  
  return current;
}

// Endpoints
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    model: CEREBRAS_MODEL,
    apiKey: maskKey(CEREBRAS_API_KEY),
    tauntKey: maskKey(CEREBRAS_TAUNT_API_KEY),
    timestamp: new Date().toISOString()
  });
});

app.get('/stats', (req, res) => {
  const avgLatency = recentLatencies.length > 0
    ? recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length
    : 0;
  
  res.json({
    totalRequests,
    totalErrors,
    averageLatency: Math.round(avgLatency),
    tokensRemaining: rateLimiter.getRemaining()
  });
});

app.get('/ratelimit', (req, res) => {
  res.json({
    remaining: rateLimiter.getRemaining(),
    resetIn: rateLimiter.getResetTime()
  });
});

app.post('/decide', async (req, res) => {
  const start = Date.now();
  totalRequests++;
  
  try {
    const {
      player_id = 'unknown',
      last_move = 'none',
      recent_moves = [],
      recent_lanes = [],
      session_stats = {},
      overlord_mode = 'aggressive',
      tick = 0,
      player_lane = 2,
      lanes = 5
    } = req.body;
    
    // Better prediction
    const predictedLane = predictNextLane(recent_lanes, last_move);
    
    // Always shoot at the predicted lane
    let targetLanes = [predictedLane];
    let dirs = [0];
    
    if (overlord_mode === 'aggressive' && tick % 2 === 0) {
      // Add flanking shots every other tick
      if (predictedLane > 0) targetLanes.push(predictedLane - 1);
      if (predictedLane < 4) targetLanes.push(predictedLane + 1);
      dirs = targetLanes.map(() => 0); // All straight down
    }
    
    const response = {
      decision: 'spawn_bullets',
      params: {
        count: targetLanes.length,
        lanes: targetLanes,
        dirs: dirs, // All 0 for straight shots
        speed: overlord_mode === 'aggressive' ? 1.2 : 1.0
      },
      explain: `Targeting lane ${predictedLane}` + 
               (player_lane === predictedLane ? ' (direct hit!)' : '')
    };
    
    const latency = Date.now() - start;
    recentLatencies.push(latency);
    if (recentLatencies.length > MAX_LATENCY_SAMPLES) {
      recentLatencies.shift();
    }
    
    res.json(response);
  } catch (error) {
    totalErrors++;
    res.status(500).json({
      decision: 'spawn_bullets',
      params: {
        count: 1,
        lanes: [2],
        dirs: [0],
        speed: 1.0
      },
      explain: 'Fallback shot',
      source: 'error'
    });
  }
});

app.post('/taunt', async (req, res) => {
  try {
    const {
      player_lane = 2,
      recent_lanes = [],
      overlord_mode = 'aggressive',
      tick = 0
    } = req.body;
    
    if (!CEREBRAS_TAUNT_API_KEY) {
      return res.json({ message: 'Pathetic human!' });
    }
    
    const systemPrompt = `Write a short, witty, PG-13 taunt for an arcade 'overlord'. Return ONLY { "message": "..." } (≤120 chars).`;
    const userPrompt = `Mode: ${overlord_mode}, player in lane ${player_lane}`;
    
    const response = await callCerebras(
      CEREBRAS_TAUNT_API_KEY,
      CEREBRAS_TAUNT_MODEL,
      systemPrompt,
      userPrompt
    );
    
    res.json({ message: response.message || 'You cannot escape!' });
  } catch (error) {
    res.json({ message: 'Your doom approaches!' });
  }
});

app.listen(PORT, () => {
  console.log(`
🎮 Overlord AI Server
━━━━━━━━━━━━━━━━━━━━━━
Port: ${PORT}
Model: ${CEREBRAS_MODEL}
API Key: ${maskKey(CEREBRAS_API_KEY)}
Taunt Key: ${maskKey(CEREBRAS_TAUNT_API_KEY)}
━━━━━━━━━━━━━━━━━━━━━━
Ready for ultra-fast inference!
  `);
});