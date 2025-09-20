# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
AI Overlord is a browser-based 5-lane dodge game demonstrating ultra-fast AI inference using Cerebras. The game showcases real-time player movement prediction where an AI "Overlord" systematically makes the game harder by analyzing player patterns and spawning obstacles to intercept predicted movements.

## Development Commands

```bash
# Start both services in development mode
npm run dev

# Start services individually
npm run dev:ai     # AI server on port 8787
npm run dev:game   # Game client on port 3000

# Run tests and builds
npm run test       # Test all workspaces
npm run build      # Build all packages
```

### Workspace-specific commands:
```bash
# AI Server (packages/ai-server)
cd packages/ai-server
npm run dev    # Start with --watch flag
npm run test   # Run test suite

# Game Client (packages/game)
cd packages/game
npm run dev      # Vite dev server
npm run build    # Production build
```

## Core Architecture

### AI Server (packages/ai-server)
- **server.js**: Express server with `/decide`, `/health`, `/stats` endpoints
- **sync.js**: Cerebras API integration with fallback logic
- **rate-limit.js**: Request rate limiting middleware
- Decision latency target: < 400ms (P95)

### Game Client (packages/game)
- **Vite + Canvas** rendering at 60 FPS
- **game.js**: Core game engine with entity system and render abstraction
- **desktop.html/desktop.js**: Full desktop experience with debug telemetry
- **mobile.html/mobile.js**: Touch-optimized mobile version
- **src/**: Game logic, scenes, and components

### API Integration Contract
Strict contract defined in `docs/contract.md` - **DO NOT CHANGE** without team discussion:
- POST `/decide` endpoint with 450ms client timeout
- 10 different AI actions: blocks, spawns, feints, traps
- Request includes `recent_moves`, `session_stats`, `overlord_mode`
- Response includes `decision`, `params`, `explain`, `latency_ms`

## Key Game Mechanics

### Movement Prediction System
- 5 lanes (0-4) with player movement via arrows/swipe
- AI tracks `recent_lanes` array to predict next position
- Target predicted position, not current position
- Grace period (1.2s) and invulnerability (0.5s) on start
- Challenge rate tracking (AI prediction accuracy)

### Entity System
- Canvas-based rendering with shape primitives (sprite-ready)
- Entity registry for extensible hazards
- Bullet pool management (40 max)
- Animation/SFX hooks in place

## Environment Setup

### AI Server (.env in packages/ai-server)
```
CEREBRAS_API_KEY=your_key_here
MOCK_MODE=true|false
LATENCY_INJECTION_MS=0
PORT=8787
```

### Game Client (.env in packages/game)
```
VITE_AI_SERVER_URL=http://localhost:8787
VITE_MOCK_MODE=true|false
```

## Current Issues to Address
1. Bullets sometimes miss stationary targets
2. Prediction not using full lane range (0-4)
3. Telegraph warnings need better timing
4. Cerebras JSON parsing occasionally fails

## Code Patterns

### Adding New Entity Types
```javascript
entities.register('laser', {
  spawn: (params) => spawnLaser(params)
})
```

### Development Principles
- **Prediction-First AI**: Analyze movement patterns, target predicted positions
- **Performance**: 60 FPS rendering, <400ms AI decisions, graceful API degradation
- **Extensibility**: Entity registry, render abstraction, feature flags (SYNC_ENABLED)

## Key Files
- `docs/contract.md`: API contract - critical integration spec
- `packages/ai-server/server.js`: Main AI decision endpoint
- `packages/game/src/`: Game logic and Phaser.js implementation
- `packages/game/game.js`: Core game engine with entity system