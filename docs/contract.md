# API Integration Contract

## ⚠️ CRITICAL: Both teammates MUST follow this contract exactly

## Base Configuration

- **AI Server URL**: `http://localhost:8787`
- **Request Timeout**: 450ms (client-side)
- **Tick Rate**: Start with on-death only, upgrade to 500-800ms if stable

## POST /decide Endpoint

### Request Schema

```json
{
  "player_id": "string",
  "run_id": "uuid",
  "tick": 42,
  "last_move": "left|right|up|down|none",
  "recent_moves": ["left", "up", "right"],
  "session_stats": {
    "best_time": 8.2,
    "current_time": 5.7
  },
  "overlord_mode": "aggressive|defensive|trickster"
}
```

### Response Schema

```json
{
  "decision": "block_left|block_right|block_up|block_down|spawn_fast_right|spawn_fast_left|spawn_slow_right|spawn_slow_left|feint_then_block_up|delay_trap|
  shoot_lane",
  "params": {
    "duration_ms": 1200,
    "speed": 1.3,
    "lane_index": 2
  },
  "explain": "You dodged left twice; blocking left first, feinting up.",
  "latency_ms": 238
}
```

## Action Definitions

| Action                | Game Implementation                 | Params                  |
| --------------------- | ----------------------------------- | ----------------------- |
| `block_left`          | Spawn immovable block in left lane  | `duration_ms`: 600-1500 |
| `block_right`         | Spawn immovable block in right lane | `duration_ms`: 600-1500 |
| `block_up`            | Spawn immovable block in up lane    | `duration_ms`: 600-1500 |
| `block_down`          | Spawn immovable block in down lane  | `duration_ms`: 600-1500 |
| `spawn_fast_right`    | Moving obstacle from right edge     | `speed`: 1.2-1.6        |
| `spawn_fast_left`     | Moving obstacle from left edge      | `speed`: 1.2-1.6        |
| `spawn_slow_right`    | Slow obstacle from right edge       | `speed`: 0.6-0.9        |
| `spawn_slow_left`     | Slow obstacle from left edge        | `speed`: 0.6-0.9        |
| `feint_then_block_up` | Decoy, then block up after 250ms    | `duration_ms`: 800-1200 |
| `delay_trap`          | Nothing for 500ms, then all lanes   | `duration_ms`: 300      |

## Additional Endpoints

### GET /health

```json
{
  "ok": true,
  "mode": "MOCK|LIVE",
  "cerebras_connected": false
}
```

### GET /stats

```json
{
  "latency_p50_ms": 187,
  "latency_p95_ms": 342,
  "timeouts_count": 3,
  "memory_entries": 24,
  "uptime_seconds": 3600
}
```

## Error Handling

### Timeout Response (>450ms)

Game client should use local fallback and display "Cerebras: timeout (fallback)"

### Invalid JSON Response

Log to console, skip action for current tick, continue gameplay

### Server Down

Use MOCK_MODE responses with deterministic patterns

## Environment Variables

### AI Server (.env)

```
CEREBRAS_API_KEY=your_key_here
MOCK_MODE=true|false
LATENCY_INJECTION_MS=0
PORT=8787
```

### Game Client (.env)

```
VITE_AI_SERVER_URL=http://localhost:8787
VITE_MOCK_MODE=true|false
```

## Testing Checklist

- [ ] MOCK_MODE returns valid JSON in <50ms
- [ ] Live mode returns in <400ms p95
- [ ] Fallback triggers correctly on timeout
- [ ] Invalid responses don't crash game
- [ ] Memory persists between calls
- [ ] Overlord modes affect behavior
- [ ] All 10 actions render correctly in game
