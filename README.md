# Terminator - An Agentic AI Overlord game

A space shooter inspired browser-based dodge game demonstrating ultra-fast AI inference using Cerebras. The game features real-time AI decision making where an AI "Overlord" analyzes player patterns and strategically spawns obstacles to intercept predicted movements.

## Demo Videos

## Architecture Overview

### High-Level System Architecture
[System Architecture Diagram - To be added]

### AI Agent Flow
[AI Agent Decision Flow Diagram - To be added]

## Tech Stack

- **Frontend:** Vanilla JavaScript, HTML5 Canvas, Vite
- **Backend:** Node.js, Express.js
- **AI Engine:** Cerebras gpt-oss-120b model
- **Real-time:** WebSockets for multiplayer

## Project Structure

```
Terminator/
├── packages/
│   ├── ai-server/          # AI decision engine
│   │   ├── server.js       # Main server with Cerebras integration
│   │   ├── websocket-manager.js
│   │   └── .env            # API keys and configuration
│   └── game/               # Game client
│       ├── src/
│       │   ├── game.js     # Core game engine
│       │   ├── terminator.js # UI controller
│       │   └── qr-generator.js
│       ├── terminator.html # Main game interface
│       └── package.json
├── package.json            # Root workspace configuration
└── README.md
```

## Features

### Core Gameplay
- 5-lane dodge game with real-time AI opponents
- Progressive difficulty scaling (1→2→3 bullets)
- Player shooting mechanics with limited ammo
- Boss battles with health systems

### AI System
- **Hybrid AI Architecture:** Immediate local fallback + async AI enhancement
- **Multi-Agent Orchestration:** Strategy, Shooting, and Decision agents
- **Pattern Recognition:** Analyzes player movement for predictive targeting
- **Real-time Thinking Display:** Live AI reasoning shown to players

### Technical Capabilities
- Sub-400ms AI decision latency with zero-lag fallback
- WebSocket multiplayer with QR code joining
- Canvas-based 60fps rendering
- Rate limiting and API resilience

## Setup Instructions

### Prerequisites
- Node.js 18+
- npm or yarn
- Cerebras API key

### Installation

1. Clone the repository
```bash
git clone <repository-url>
cd Terminator
```

2. Install dependencies
```bash
npm install
```

3. Configure environment variables

Create `.env` file in `packages/ai-server/`:

```env
CEREBRAS_API_KEY=your_cerebras_api_key_here
CEREBRAS_TAUNT_API_KEY=your_taunt_api_key_here
CEREBRAS_MODEL=gpt-oss-120b
CEREBRAS_TAUNT_MODEL=gpt-oss-120b
MOCK_MODE=false
LATENCY_INJECTION_MS=0
PORT=8787
CLIENT_TIMEOUT_MS=2000
```

4. Start the development servers
```bash
npm run dev
```

This starts both:
- AI server on http://localhost:8787
- Game client on http://localhost:3000

### Alternative: Start services individually

```bash
# AI Server
npm run dev:ai

# Game Client
npm run dev:game
```

## Running the Game

### Single Player Mode
1. Navigate to http://localhost:3000/terminator.html
2. Click "START GAME"
3. Use arrow keys to move, spacebar to shoot
4. Survive as long as possible against the AI Overlord

### Multiplayer Mode
1. Start the main interface (shows QR codes)
2. Players scan QR codes with mobile devices to join
3. Dashboard shows live gameplay from multiple players
4. AI adapts to each player's patterns independently

## Game Controls
- **Arrow Keys:** Move left/right between lanes
- **Spacebar:** Shoot at the AI Overlord
- **Mouse:** Navigate menus

## Development Commands

```bash
# Development
npm run dev              # Start both services
npm run dev:ai          # AI server only
npm run dev:game        # Game client only

# Production
npm run build           # Build all packages
npm run test            # Run test suite
```

## AI Configuration

### Model Settings
The system uses Cerebras gpt-oss-120b by default. Configure in .env:

- **CEREBRAS_MODEL:** Main decision model
- **CEREBRAS_TAUNT_MODEL:** Commentary generation model

### Performance Tuning
- **CLIENT_TIMEOUT_MS:** Maximum wait time for AI decisions
- **LATENCY_INJECTION_MS:** Artificial delay for testing
- **MOCK_MODE:** Use local fallbacks instead of AI

## Multi-Agent System

### Agent Types
- **Strategy Agent:** Analyzes movement patterns and plans approaches
- **Shooting Agent:** Handles aggressive targeting and engagement
- **Decision Agent:** Makes final executive decisions and coordinates actions

### Real-time Features
- Live thinking displays show AI reasoning process
- Input tracking feeds player data to agent system
- Decision history with latency metrics
- Performance sparklines and statistics

## API Endpoints

### Core Game API
- `POST /decide` - Main AI decision endpoint
- `POST /think` - Agent thinking generation
- `POST /taunt` - Overlord commentary
- `GET /health` - Server status
- `GET /stats` - Performance metrics

### WebSocket Events
- `join_as_dashboard` - Connect as game dashboard
- `player_joined` - New player connected
- `game_state` - Real-time game updates
- `room_full` - Room capacity reached

## Performance Metrics

The system tracks key performance indicators:
- AI decision latency (target: <400ms)
- Prediction accuracy rates
- Token consumption per second
- Player engagement statistics

## Troubleshooting

### Common Issues

**AI Server Connection Failed:**
- Verify Cerebras API key in .env
- Check network connectivity
- Ensure port 8787 is available

**Game Not Loading:**
- Confirm both servers are running
- Check browser console for errors
- Verify WebSocket connection

**High Latency:**
- Check Cerebras API status
- Reduce CLIENT_TIMEOUT_MS for faster fallbacks
- Enable MOCK_MODE for testing

### Debug Mode
Enable detailed logging by setting browser localStorage:
```javascript
localStorage.setItem('debug', 'true')
```

Results compared with Cerebras API and OpenAI API:

## License
If you are reading this far, feel free to use it, No license required, Apache or MIT or whatever is the most open source!

## Contact
- Prajit Viswanadha: [https://www.linkedin.com/in/prajit-viswanadha/](https://www.linkedin.com/in/prajit-viswanadha/)
- Shashank Yaji: [https://www.linkedin.com/in/shashankyaji/](https://www.linkedin.com/in/shashankyaji/)
