// comparison.js - Speed Comparison Demo
import { OverlordGame } from './game.js';

// Game instances
let cerebrasGame;
let openrouterGame;

// Metrics tracking
let cerebrasMetrics = { bullets: 0, latency: 0, source: '---' };
let openrouterMetrics = { bullets: 0, latency: 0, source: '---' };

// Initialize Cerebras game
const cerebrasCanvas = document.getElementById('cerebras-canvas');
cerebrasGame = new OverlordGame(cerebrasCanvas, {
  apiEndpoint: '/decide', // Default Cerebras endpoint
  onUpdate: (data) => {
    document.getElementById('cerebras-time').textContent = data.time.toFixed(1) + 's';
  },
  onDeath: (data) => {
    console.log('Cerebras game ended:', data.time.toFixed(1) + 's');
    // Auto-restart for demo
    setTimeout(() => cerebrasGame.restart(), 2000);
  },
  onWin: (data) => {
    console.log('Cerebras victory:', data.time.toFixed(1) + 's');
    setTimeout(() => cerebrasGame.restart(), 2000);
  },
  onTaunt: (message) => {
    console.log('Cerebras taunt:', message);
  },
  onDebug: (data) => {
    cerebrasMetrics.latency = data.rtt || 0;
    cerebrasMetrics.bullets++;
    document.getElementById('cerebras-latency').textContent = cerebrasMetrics.latency + 'ms';
    document.getElementById('cerebras-bullets').textContent = cerebrasMetrics.bullets;
  },
  onAIStart: () => {
    document.getElementById('cerebras-status').textContent = 'THINKING';
    document.getElementById('cerebras-status').className = 'status-indicator status-thinking';
  },
  onAIComplete: (source) => {
    document.getElementById('cerebras-status').textContent = 'READY';
    document.getElementById('cerebras-status').className = 'status-indicator status-ready';
    document.getElementById('cerebras-source').textContent = source || 'cerebras';
  }
});

// Initialize OpenRouter game
const openrouterCanvas = document.getElementById('openrouter-canvas');
openrouterGame = new OverlordGame(openrouterCanvas, {
  apiEndpoint: '/decide-openrouter', // OpenRouter endpoint
  onUpdate: (data) => {
    document.getElementById('openrouter-time').textContent = data.time.toFixed(1) + 's';
  },
  onDeath: (data) => {
    console.log('OpenRouter game ended:', data.time.toFixed(1) + 's');
    // Auto-restart for demo
    setTimeout(() => openrouterGame.restart(), 2000);
  },
  onWin: (data) => {
    console.log('OpenRouter victory:', data.time.toFixed(1) + 's');
    setTimeout(() => openrouterGame.restart(), 2000);
  },
  onTaunt: (message) => {
    console.log('OpenRouter taunt:', message);
  },
  onDebug: (data) => {
    openrouterMetrics.latency = data.rtt || 0;
    openrouterMetrics.bullets++;
    document.getElementById('openrouter-latency').textContent = openrouterMetrics.latency + 'ms';
    document.getElementById('openrouter-bullets').textContent = openrouterMetrics.bullets;
  },
  onAIStart: () => {
    document.getElementById('openrouter-status').textContent = 'THINKING';
    document.getElementById('openrouter-status').className = 'status-indicator status-thinking';
  },
  onAIComplete: (source) => {
    document.getElementById('openrouter-status').textContent = 'READY';
    document.getElementById('openrouter-status').className = 'status-indicator status-ready';
    document.getElementById('openrouter-source').textContent = source || 'openrouter';
  }
});

// Shared keyboard controls
document.addEventListener('keydown', (e) => {
  switch(e.key) {
    case 'ArrowLeft':
      cerebrasGame.moveLeft();
      openrouterGame.moveLeft();
      break;
    case 'ArrowRight':
      cerebrasGame.moveRight();
      openrouterGame.moveRight();
      break;
    case ' ':
    case 'Spacebar':
      e.preventDefault();
      cerebrasGame.shoot();
      openrouterGame.shoot();
      break;
    case 'r':
    case 'R':
      // Restart both games
      cerebrasGame.restart();
      openrouterGame.restart();
      cerebrasMetrics = { bullets: 0, latency: 0, source: '---' };
      openrouterMetrics = { bullets: 0, latency: 0, source: '---' };
      break;
  }
});

// Initialize both games
async function initGames() {
  try {
    await cerebrasGame.init();
    await openrouterGame.init();

    console.log('🎮 Speed comparison demo ready!');
    console.log('Left: Cerebras (ultra-fast inference)');
    console.log('Right: OpenRouter (traditional speed)');

    // Start both games simultaneously
    cerebrasGame.start();
    openrouterGame.start();

  } catch (error) {
    console.error('Failed to initialize games:', error);
  }
}

initGames();