import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Cerebras } from '@cerebras/cerebras-cloud-sdk';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8787;
const MOCK_MODE = process.env.MOCK_MODE === 'true';
const LATENCY_INJECTION = parseInt(process.env.LATENCY_INJECTION_MS || '0');

// Initialize Cerebras client (only if not in mock mode)
let cerebrasClient = null;
if (!MOCK_MODE && process.env.CEREBRAS_API_KEY) {
  cerebrasClient = new Cerebras({
    apiKey: process.env.CEREBRAS_API_KEY,
  });
}

// In-memory adaptation storage
const playerMemory = new Map();

// Action definitions
const ACTIONS = [
  'block_left', 'block_right', 'block_up', 'block_down',
  'spawn_fast_right', 'spawn_fast_left', 
  'spawn_slow_right', 'spawn_slow_left',
  'feint_then_block_up', 'delay_trap'
];

// Stats tracking
const stats = {
  requests: [],
  timeouts: 0,
  startTime: Date.now()
};

/**
 * Get or create memory for a player
 */
function getPlayerMemory(playerId) {
  if (!playerMemory.has(playerId)) {
    playerMemory.set(playerId, {
      last_n_moves: [],
      bias: { left: 0, right: 0, up: 0, down: 0 },
      last_decisions: []
    });
  }
  return playerMemory.get(playerId);
}

/**
 * Update player memory with new move data
 */
function updatePlayerMemory(playerId, moveData) {
  const memory = getPlayerMemory(playerId);
  
  // Update move history (keep last 20)
  memory.last_n_moves.push(moveData.last_move);
  if (memory.last_n_moves.length > 20) {
    memory.last_n_moves.shift();
  }
  
  // Update bias (smoothed counts)
  if (moveData.last_move && moveData.last_move !== 'none') {
    memory.bias[moveData.last_move] = (memory.bias[moveData.last_move] || 0) * 0.9 + 1;
  }
  
  // Decay other biases
  Object.keys(memory.bias).forEach(dir => {
    if (dir !== moveData.last_move) {
      memory.bias[dir] *= 0.95;
    }
  });
}

/**
 * Fallback heuristic when Cerebras times out or in MOCK_MODE
 */
function fallbackHeuristic(context, memory) {
  const biases = memory.bias;
  const maxBias = Math.max(...Object.values(biases));
  const dominantDirection = Object.keys(biases).find(key => biases[key] === maxBias);
  
  let decision;
  if (dominantDirection && biases[dominantDirection] > 2) {
    // Counter the dominant direction
    decision = `block_${dominantDirection}`;
  } else {
    // Random action
    decision = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
  }
  
  // Avoid repeating same decision too much
  const recentDecisions = memory.last_decisions.slice(-2);
  if (recentDecisions.every(d => d === decision)) {
    decision = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
  }
  
  return {
    decision,
    params: {
      duration_ms: 600 + Math.floor(Math.random() * 900),
      speed: 0.8 + Math.random() * 0.8
    },
    explain: `Countering your ${dominantDirection || 'random'} movement pattern`
  };
}

/**
 * Query Cerebras for decision
 */
async function queryCerebras(context, memory) {
  if (!cerebrasClient) {
    throw new Error('Cerebras client not initialized');
  }
  
  const prompt = `You are Overlord, an adversarial controller for a four-lane dodge game. 
Output strict JSON only matching this schema:
{"decision":"<one_of:[${ACTIONS.join(',')}]>","params":{"duration_ms":int,"speed":float},"explain":"<short reason 8-14 words>"}

Player behavior analysis:
- Recent moves: ${context.recent_moves.join(', ')}
- Movement bias: ${JSON.stringify(memory.bias)}
- Current survival time: ${context.session_stats.current_time}s
- Mode: ${context.overlord_mode}

Constraints: Prefer counters to recent player bias. Avoid repeating the same decision more than twice. 
Keep duration_ms 600-1500, speed 0.8-1.6. No prose outside JSON.`;

  const completion = await cerebrasClient.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama3.1-8b',
    temperature: 0.1,
    max_tokens: 60,
    response_format: { type: 'json_object' }
  });
  
  return JSON.parse(completion.choices[0].message.content);
}

/**
 * Main decision endpoint
 */
app.post('/decide', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const context = req.body;
    const memory = getPlayerMemory(context.player_id);
    
    // Update memory with latest move
    updatePlayerMemory(context.player_id, context);
    
    let decision;
    let source = 'cerebras';
    
    // Add artificial latency if configured (for testing)
    if (LATENCY_INJECTION > 0) {
      await new Promise(resolve => setTimeout(resolve, LATENCY_INJECTION));
    }
    
    if (MOCK_MODE) {
      // Use fallback in mock mode
      decision = fallbackHeuristic(context, memory);
      source = 'mock';
    } else {
      // Try Cerebras with timeout
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 400)
      );
      
      try {
        decision = await Promise.race([
          queryCerebras(context, memory),
          timeout
        ]);
      } catch (error) {
        console.log('Cerebras timeout or error, using fallback:', error.message);
        decision = fallbackHeuristic(context, memory);
        source = 'fallback';
        stats.timeouts++;
      }
    }
    
    // Store decision in memory
    memory.last_decisions.push(decision.decision);
    if (memory.last_decisions.length > 5) {
      memory.last_decisions.shift();
    }
    
    // Calculate latency
    const latency = Date.now() - startTime;
    stats.requests.push(latency);
    
    // Send response
    res.json({
      ...decision,
      latency_ms: latency,
      source // Include source for debugging
    });
    
  } catch (error) {
    console.error('Error in /decide:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      fallback: fallbackHeuristic({}, { bias: {}, last_decisions: [] })
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    mode: MOCK_MODE ? 'MOCK' : 'LIVE',
    cerebras_connected: !!cerebrasClient
  });
});

/**
 * Stats endpoint
 */
app.get('/stats', (req, res) => {
  const sortedLatencies = [...stats.requests].sort((a, b) => a - b);
  const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] || 0;
  const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0;
  
  res.json({
    latency_p50_ms: p50,
    latency_p95_ms: p95,
    timeouts_count: stats.timeouts,
    memory_entries: playerMemory.size,
    uptime_seconds: Math.floor((Date.now() - stats.startTime) / 1000)
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
🤖 AI Overlord Server Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Mode: ${MOCK_MODE ? 'MOCK' : 'LIVE'}
Port: ${PORT}
Cerebras: ${cerebrasClient ? 'Connected' : 'Not configured'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Test with: 
curl -X POST http://localhost:${PORT}/decide \\
  -H "Content-Type: application/json" \\
  -d '{"player_id":"test","last_move":"left","recent_moves":["left","up"],"session_stats":{"best_time":5,"current_time":3},"overlord_mode":"aggressive"}'
  `);
});
