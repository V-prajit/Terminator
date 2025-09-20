import Phaser from 'phaser';

// Configuration
const AI_SERVER_URL = import.meta.env.VITE_AI_SERVER_URL || 'http://localhost:8787';
const TICK_RATE = 500; // ms between AI decisions (start with on-death only)

// Game state
let gameState = {
  playerId: `player_${Math.random().toString(36).substr(2, 9)}`,
  runId: null,
  tick: 0,
  survivalTime: 0,
  bestTime: parseFloat(localStorage.getItem('bestTime') || '0'),
  recentMoves: [],
  lastMove: 'none',
  latencies: [], // For sparkline
  overlordMode: 'aggressive',
  useReactiveMode: false // Start with on-death only
};

// Main Game Scene
class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
    this.player = null;
    this.obstacles = [];
    this.lanes = {};
    this.startTime = null;
    this.lastDecisionTime = 0;
  }

  preload() {
    // We'll use simple shapes, no assets to load
  }

  create() {
    // Reset for new run
    gameState.runId = crypto.randomUUID();
    gameState.tick = 0;
    gameState.recentMoves = [];
    gameState.lastMove = 'none';
    this.startTime = Date.now();
    
    // Create arena
    this.createArena();
    
    // Create player
    this.createPlayer();
    
    // Setup controls
    this.setupControls();
    
    // Start survival timer
    this.startSurvivalTimer();
    
    // Initial AI decision (after slight delay)
    this.time.delayedCall(1000, () => {
      this.requestAIDecision();
    });
  }

  createArena() {
    const { width, height } = this.scale;
    
    // Create 4 lanes (visual guides)
    const laneWidth = width / 4;
    
    this.lanes = {
      left: { x: laneWidth * 0.5, y: height / 2, width: laneWidth - 10, height: height - 100 },
      down: { x: laneWidth * 1.5, y: height / 2, width: laneWidth - 10, height: height - 100 },
      up: { x: laneWidth * 2.5, y: height / 2, width: laneWidth - 10, height: height - 100 },
      right: { x: laneWidth * 3.5, y: height / 2, width: laneWidth - 10, height: height - 100 }
    };
    
    // Draw lane boundaries
    Object.entries(this.lanes).forEach(([name, lane]) => {
      const rect = this.add.rectangle(lane.x, lane.y, lane.width, lane.height);
      rect.setStrokeStyle(2, 0x333333);
      
      // Lane labels
      this.add.text(lane.x, 30, name.toUpperCase(), {
        fontSize: '16px',
        color: '#666',
        align: 'center'
      }).setOrigin(0.5);
    });
  }

  createPlayer() {
    const { width, height } = this.scale;
    this.player = this.add.circle(width / 2, height - 100, 15, 0x00ff00);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.player.currentLane = 'down'; // Start in down lane
  }

  setupControls() {
    // Keyboard controls
    this.cursors = this.input.keyboard.createCursorKeys();
    
    // Touch/mouse controls
    this.input.on('pointerdown', (pointer) => {
      const { width } = this.scale;
      const laneWidth = width / 4;
      const lane = Math.floor(pointer.x / laneWidth);
      
      this.moveToLane(['left', 'down', 'up', 'right'][lane]);
    });
  }

  moveToLane(lane) {
    if (!this.lanes[lane] || !this.player.active) return;
    
    // Record move
    gameState.lastMove = lane;
    gameState.recentMoves.push(lane);
    if (gameState.recentMoves.length > 10) {
      gameState.recentMoves.shift();
    }
    
    // Animate movement
    this.tweens.add({
      targets: this.player,
      x: this.lanes[lane].x,
      duration: 200,
      ease: 'Power2'
    });
    
    this.player.currentLane = lane;
  }

  update() {
    if (!this.player.active) return;
    
    // Handle keyboard input
    if (Phaser.Input.Keyboard.JustDown(this.cursors.left)) {
      this.moveToLane('left');
    } else if (Phaser.Input.Keyboard.JustDown(this.cursors.right)) {
      this.moveToLane('right');
    } else if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
      this.moveToLane('up');
    } else if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
      this.moveToLane('down');
    }
    
    // Check collisions
    this.checkCollisions();
    
    // Request AI decision if in reactive mode
    if (gameState.useReactiveMode) {
      const now = Date.now();
      if (now - this.lastDecisionTime > TICK_RATE) {
        this.requestAIDecision();
        this.lastDecisionTime = now;
      }
    }
  }

  checkCollisions() {
    this.obstacles.forEach(obstacle => {
      if (obstacle.active && Phaser.Geom.Intersects.RectangleToRectangle(
        this.player.getBounds(),
        obstacle.getBounds()
      )) {
        this.playerDeath();
      }
    });
  }

  async requestAIDecision() {
    if (!this.player.active) return;
    
    gameState.tick++;
    
    const requestData = {
      player_id: gameState.playerId,
      run_id: gameState.runId,
      tick: gameState.tick,
      last_move: gameState.lastMove,
      recent_moves: gameState.recentMoves.slice(-5),
      session_stats: {
        best_time: gameState.bestTime,
        current_time: gameState.survivalTime
      },
      overlord_mode: gameState.overlordMode
    };
    
    try {
      const response = await fetch(`${AI_SERVER_URL}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
        signal: AbortSignal.timeout(450)
      });
      
      const decision = await response.json();
      
      // Update UI with latency
      this.updateLatencyDisplay(decision.latency_ms);
      
      // Update taunt
      document.getElementById('overlord-taunt').textContent = decision.explain || 'Processing...';
      
      // Execute decision
      this.executeAIDecision(decision);
      
    } catch (error) {
      console.error('AI decision failed:', error);
      // Use fallback
      this.executeAIDecision(this.getFallbackDecision());
      document.getElementById('latency').textContent = 'timeout';
    }
  }

  executeAIDecision(decision) {
    const action = decision.decision;
    const params = decision.params || {};
    
    // Map actions to game effects
    switch(action) {
      case 'block_left':
      case 'block_right':
      case 'block_up':
      case 'block_down':
        const lane = action.replace('block_', '');
        this.spawnBlock(lane, params.duration_ms || 1000);
        break;
        
      case 'spawn_fast_right':
      case 'spawn_fast_left':
        const side = action.includes('right') ? 'right' : 'left';
        this.spawnMovingObstacle(side, params.speed || 1.5);
        break;
        
      case 'spawn_slow_right':
      case 'spawn_slow_left':
        const slowSide = action.includes('right') ? 'right' : 'left';
        this.spawnMovingObstacle(slowSide, params.speed || 0.7);
        break;
        
      case 'feint_then_block_up':
        this.spawnFeint('up', params.duration_ms || 1000);
        break;
        
      case 'delay_trap':
        this.time.delayedCall(500, () => {
          ['left', 'right', 'up', 'down'].forEach(lane => {
            this.spawnBlock(lane, 300);
          });
        });
        break;
        
      default:
        console.warn('Unknown action:', action);
    }
  }

  spawnBlock(lane, duration) {
    if (!this.lanes[lane]) return;
    
    const block = this.add.rectangle(
      this.lanes[lane].x,
      this.lanes[lane].y,
      this.lanes[lane].width - 20,
      50,
      0xff0040
    );
    
    this.physics.add.existing(block, true);
    this.obstacles.push(block);
    
    // Remove after duration
    this.time.delayedCall(duration, () => {
      block.destroy();
      const index = this.obstacles.indexOf(block);
      if (index > -1) this.obstacles.splice(index, 1);
    });
  }

  spawnMovingObstacle(fromSide, speed) {
    const { width, height } = this.scale;
    const startX = fromSide === 'left' ? -50 : width + 50;
    const targetX = fromSide === 'left' ? width + 50 : -50;
    
    const obstacle = this.add.circle(startX, height / 2, 20, 0xff8800);
    this.physics.add.existing(obstacle);
    this.obstacles.push(obstacle);
    
    this.tweens.add({
      targets: obstacle,
      x: targetX,
      duration: 3000 / speed,
      onComplete: () => {
        obstacle.destroy();
        const index = this.obstacles.indexOf(obstacle);
        if (index > -1) this.obstacles.splice(index, 1);
      }
    });
  }

  spawnFeint(lane, duration) {
    // Create a fake threat
    const feint = this.add.rectangle(
      this.lanes[lane].x,
      this.lanes[lane].y,
      this.lanes[lane].width - 20,
      30,
      0x880088,
      0.5
    );
    
    // After 250ms, spawn real block
    this.time.delayedCall(250, () => {
      feint.destroy();
      this.spawnBlock(lane, duration - 250);
    });
  }

  getFallbackDecision() {
    const actions = ['block_left', 'block_right', 'spawn_fast_right', 'spawn_fast_left'];
    return {
      decision: actions[Math.floor(Math.random() * actions.length)],
      params: { duration_ms: 800, speed: 1.2 },
      explain: 'Fallback pattern engaged'
    };
  }

  startSurvivalTimer() {
    this.survivalTimer = this.time.addEvent({
      delay: 100,
      callback: () => {
        gameState.survivalTime = (Date.now() - this.startTime) / 1000;
        document.getElementById('survival-time').textContent = 
          `${gameState.survivalTime.toFixed(1)}s`;
      },
      loop: true
    });
  }

  updateLatencyDisplay(latency) {
    // Update text
    document.getElementById('latency').textContent = latency;
    
    // Add to sparkline data
    gameState.latencies.push(latency);
    if (gameState.latencies.length > 20) {
      gameState.latencies.shift();
    }
    
    // Draw sparkline
    this.drawSparkline();
  }

  drawSparkline() {
    const canvas = document.getElementById('sparkline');
    const ctx = canvas.getContext('2d');
    const width = canvas.width = 60;
    const height = canvas.height = 20;
    
    ctx.clearRect(0, 0, width, height);
    
    if (gameState.latencies.length < 2) return;
    
    const max = Math.max(...gameState.latencies);
    const min = Math.min(...gameState.latencies);
    const range = max - min || 1;
    
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    
    gameState.latencies.forEach((latency, i) => {
      const x = (i / (gameState.latencies.length - 1)) * width;
      const y = height - ((latency - min) / range) * height;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    ctx.stroke();
  }

  playerDeath() {
    if (!this.player.active) return;
    
    this.player.active = false;
    this.player.setVisible(false);
    
    // Update best time
    if (gameState.survivalTime > gameState.bestTime) {
      gameState.bestTime = gameState.survivalTime;
      localStorage.setItem('bestTime', gameState.bestTime.toString());
    }
    
    // Show death modal
    document.getElementById('final-time').textContent = gameState.survivalTime.toFixed(1);
    document.getElementById('best-time').textContent = gameState.bestTime.toFixed(1);
    document.getElementById('death-modal').classList.add('show');
    
    // Request final AI decision for learning
    this.requestAIDecision();
  }
}

// Phaser configuration
const config = {
  type: Phaser.AUTO,
  parent: 'game-canvas',
  width: 800,
  height: 600,
  backgroundColor: '#0a0a0a',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 }
    }
  },
  scene: GameScene,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
};

// Create game
const game = new Phaser.Game(config);

// Global restart function
window.restartGame = () => {
  document.getElementById('death-modal').classList.remove('show');
  game.scene.getScene('GameScene').scene.restart();
};

// Mode selector
document.getElementById('mode-selector').addEventListener('change', (e) => {
  gameState.overlordMode = e.target.value;
});

// Display initial best time
document.getElementById('best-time').textContent = gameState.bestTime.toFixed(1);
