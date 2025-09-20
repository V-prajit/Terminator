# AI Overlord - Cerebras-Powered Survival Game

## Team Division

### Teammate A - AI/Backend Lead
**Owns:** LLM integration, Cerebras API, decision service, adaptation memory
**Deliverables:** 
- HTTP API server (POST /decide)
- Cerebras integration with <400ms latency
- Fallback heuristics
- Memory/adaptation system

### Teammate B - Game/Frontend Lead  
**Owns:** Game loop, UI, canvas rendering, input handling, integration
**Deliverables:**
- Phaser.js game with 4-lane survival
- Mobile-responsive with QR code access
- Latency display & AI explanation UI
- Death/retry flow

## Quick Start

```bash
# Clone and install
git clone <your-repo>
cd ai-overlord
npm install

# Start both services
npm run dev

# Or individually:
npm run dev:ai     # Teammate A - runs on :8787
npm run dev:game   # Teammate B - runs on :3000
```

## Project Structure

```
ai-overlord/
├── packages/
│   ├── ai-server/       # Teammate A workspace
│   └── game/            # Teammate B workspace
├── docs/
│   └── contract.md      # API contract (CRITICAL)
├── scripts/
│   └── setup.sh
└── package.json         # Monorepo root
```

## Integration Contract
See `/docs/contract.md` for the agreed API schema. DO NOT CHANGE without team discussion.

## Timeline Checkpoints

- **Hour 1**: Contract agreed, repos set up
- **Hour 6**: Mock mode working E2E
- **Hour 10**: Cerebras integrated
- **Hour 14**: Polish & reliability
- **Hour 18**: Demo prep
- **Hour 20**: Ship it! 🚀
