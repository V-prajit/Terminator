// game.js - Fixed version
// Core game engine with proper bullet targeting and telegraph timing

const API_URL = 'http://localhost:8787';
const TICK_MS = 700;
const GRACE_MS = 1200;
const INVULN_MS = 500;
const BASE_BULLET_VY = 240;
const BASE_BULLET_VX = 80; // Reduced for better control
const POOL_SIZE = 40;
const TAUNT_DEBOUNCE_MS = 2000;
const SYNC_ENABLED = false;

// Entity registry for extensibility
class EntityRegistry {
  constructor() {
    this.types = new Map();
    this.spawners = new Map();
  }
  
  register(type, config) {
    this.types.set(type, config);
    this.spawners.set(type, config.spawn);
  }
  
  spawn(type, params) {
    const spawner = this.spawners.get(type);
    return spawner ? spawner(params) : null;
  }
}

// Render abstraction with shape rendering
class RenderLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.sprites = new Map();
  }
  
  drawShape(x, y, shape, color, size, options = {}) {
    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.strokeStyle = options.strokeColor || color;
    this.ctx.lineWidth = options.lineWidth || 2;
    
    if (shape === 'circle') {
      this.ctx.beginPath();
      this.ctx.arc(x, y, size, 0, Math.PI * 2);
      this.ctx.fill();
      if (options.stroke) this.ctx.stroke();
    } else if (shape === 'rect') {
      this.ctx.fillRect(x - size/2, y - size/2, size, size);
      if (options.stroke) {
        this.ctx.strokeRect(x - size/2, y - size/2, size, size);
      }
    } else if (shape === 'triangle') {
      this.ctx.beginPath();
      this.ctx.moveTo(x, y - size);
      this.ctx.lineTo(x - size * 0.866, y + size * 0.5);
      this.ctx.lineTo(x + size * 0.866, y + size * 0.5);
      this.ctx.closePath();
      this.ctx.fill();
      if (options.stroke) this.ctx.stroke();
    } else if (shape === 'diamond') {
      this.ctx.beginPath();
      this.ctx.moveTo(x, y - size);
      this.ctx.lineTo(x + size, y);
      this.ctx.lineTo(x, y + size);
      this.ctx.lineTo(x - size, y);
      this.ctx.closePath();
      this.ctx.fill();
      if (options.stroke) this.ctx.stroke();
    }
    
    // Add glow effect if specified
    if (options.glow) {
      this.ctx.shadowBlur = options.glowSize || 10;
      this.ctx.shadowColor = options.glowColor || color;
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
    }
    
    this.ctx.restore();
  }
  
  drawTelegraph(x, y, width, height, alpha = 0.3) {
    this.ctx.save();
    this.ctx.fillStyle = `rgba(0, 255, 255, ${alpha})`;
    this.ctx.fillRect(x - width/2, y, width, height);
    this.ctx.restore();
  }
  
  drawExplosion(x, y, radius, frame) {
    this.ctx.save();
    const alpha = Math.max(0, 1 - frame / 10);
    this.ctx.fillStyle = `rgba(255, 100, 0, ${alpha})`;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * (1 + frame / 5), 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }
}

// Animation system
class Animator {
  constructor() {
    this.states = new Map();
    this.current = 'idle';
    this.frame = 0;
  }
  
  setState(state) {
    if (this.states.has(state)) {
      this.current = state;
      this.frame = 0;
    }
  }
  
  register(state, frames) {
    this.states.set(state, frames);
  }
  
  tick() {
    this.frame++;
  }
  
  getCurrentFrame() {
    return this.frame;
  }
}

// Sound effects stub
class Sfx {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.initialized = false;
  }
  
  init() {
    if (!this.initialized && typeof AudioContext !== 'undefined') {
      try {
        this.context = new (window.AudioContext || window.webkitAudioContext)();
        this.initialized = true;
      } catch (e) {
        console.warn('Audio context not available');
      }
    }
  }
  
  playTone(frequency, duration, type = 'sine') {
    if (!this.context || !this.enabled) return;
    
    try {
      const oscillator = this.context.createOscillator();
      const gainNode = this.context.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(this.context.destination);
      
      oscillator.frequency.value = frequency;
      oscillator.type = type;
      
      gainNode.gain.setValueAtTime(0.1, this.context.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + duration);
      
      oscillator.start(this.context.currentTime);
      oscillator.stop(this.context.currentTime + duration);
    } catch (e) {
      // Silently fail audio
    }
  }
  
  move() { this.playTone(200, 0.1, 'square'); }
  shoot() { this.playTone(400, 0.2, 'sawtooth'); }
  hit() { this.playTone(100, 0.3, 'square'); }
  death() { this.playTone(50, 0.5, 'sawtooth'); }
  taunt() { this.playTone(300, 0.15, 'sine'); }
}

// Visual effects manager
class EffectsManager {
  constructor() {
    this.effects = [];
  }
  
  add(effect) {
    this.effects.push(effect);
  }
  
  update(dt) {
    this.effects = this.effects.filter(effect => {
      effect.time += dt;
      return effect.time < effect.duration;
    });
  }
  
  render(renderer) {
    this.effects.forEach(effect => {
      if (effect.type === 'explosion') {
        renderer.drawExplosion(effect.x, effect.y, effect.size, effect.time * 10);
      } else if (effect.type === 'telegraph') {
        const alpha = 0.3 * (1 - effect.time / effect.duration);
        renderer.drawTelegraph(effect.x, effect.y, effect.width, effect.height, alpha);
      }
    });
  }
}

// Game state management
class GameState {
  constructor() {
    this.reset();
    this.bestTime = this.loadBest();
    this.playerId = this.getPlayerId();
  }
  
  reset() {
    this.runId = crypto.randomUUID();
    this.tick = 0;
    this.startTime = Date.now();
    this.survivalTime = 0;
    this.dead = false;
    this.playerLane = 2;
    this.recentMoves = [];
    this.recentLanes = [2]; // Start with center lane
    this.mode = 'aggressive';
    this.bullets = [];
    this.challenges = 0;
    this.predictions = 0;
  }
  
  getPlayerId() {
    let id = localStorage.getItem('player_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('player_id', id);
    }
    return id;
  }
  
  loadBest() {
    return parseFloat(localStorage.getItem('best_time') || '0');
  }
  
  saveBest(time) {
    if (time > this.bestTime) {
      this.bestTime = time;
      localStorage.setItem('best_time', time.toString());
    }
  }
  
  updateLane(newLane) {
    const oldLane = this.playerLane;
    this.playerLane = Math.max(0, Math.min(4, newLane));
    
    if (oldLane !== this.playerLane) {
      const move = this.playerLane > oldLane ? 'right' : 'left';
      this.recentMoves.push(move);
      if (this.recentMoves.length > 10) this.recentMoves.shift();
      
      this.recentLanes.push(this.playerLane);
      if (this.recentLanes.length > 10) this.recentLanes.shift();
    }
  }
  
  getRequestPayload() {
    return {
      player_id: this.playerId,
      last_move: this.recentMoves[this.recentMoves.length - 1] || 'none',
      recent_moves: this.recentMoves.slice(),
      recent_lanes: this.recentLanes.slice(),
      session_stats: {
        best_time: this.bestTime,
        current_time: this.survivalTime
      },
      overlord_mode: this.mode,
      tick: this.tick,
      player_lane: this.playerLane,
      lanes: 5
    };
  }
}

// Main game class
export class OverlordGame {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = canvas.width;
    this.height = canvas.height;
    
    this.state = new GameState();
    this.renderer = new RenderLayer(this.ctx);
    this.animator = new Animator();
    this.sfx = new Sfx();
    this.entities = new EntityRegistry();
    this.effects = new EffectsManager();
    
    this.graceEndTime = 0;
    this.invulnEndTime = 0;
    this.lastTickTime = 0;
    this.lastTauntTime = 0;
    this.lastDecision = null;
    this.playerAnimOffset = 0;
    
    this.callbacks = {
      onDeath: options.onDeath || (() => {}),
      onTaunt: options.onTaunt || (() => {}),
      onDebug: options.onDebug || (() => {}),
      onUpdate: options.onUpdate || (() => {})
    };
    
    this.init();
  }
  
  init() {
    // Initialize audio on first user interaction
    const initAudio = () => {
      this.sfx.init();
      document.removeEventListener('click', initAudio);
      document.removeEventListener('keydown', initAudio);
      document.removeEventListener('touchstart', initAudio);
    };
    document.addEventListener('click', initAudio);
    document.addEventListener('keydown', initAudio);
    document.addEventListener('touchstart', initAudio);
    
    // Register entity types
    this.entities.register('bullet', {
      spawn: (params) => this.spawnBullet(params)
    });
    
    // Animation states
    this.animator.register('idle', [0]);
    this.animator.register('moveLeft', [1]);
    this.animator.register('moveRight', [2]);
    this.animator.register('hit', [3]);
    this.animator.register('death', [4]);
  }
  
  start() {
    this.state.reset();
    this.graceEndTime = Date.now() + GRACE_MS;
    this.invulnEndTime = Date.now() + INVULN_MS;
    this.lastTickTime = Date.now();
    
    this.gameLoop();
    this.tickInterval = setInterval(() => this.tick(), TICK_MS);
  }
  
  stop() {
    this.state.dead = true;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }
  
  moveLeft() {
    if (this.state.dead) return;
    this.state.updateLane(this.state.playerLane - 1);
    this.sfx.move();
    this.animator.setState('moveLeft');
    this.playerAnimOffset = -10;
  }
  
  moveRight() {
    if (this.state.dead) return;
    this.state.updateLane(this.state.playerLane + 1);
    this.sfx.move();
    this.animator.setState('moveRight');
    this.playerAnimOffset = 10;
  }
  
  async tick() {
    if (this.state.dead) return;
    if (Date.now() < this.graceEndTime) return;
    
    this.state.tick++;
    
    try {
      const startTime = Date.now();
      const response = await fetch(`${API_URL}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.state.getRequestPayload())
      });
      
      const rtt = Date.now() - startTime;
      const decision = await response.json();
      this.lastDecision = decision;
      this.applyDecision(decision);
      
      // Track prediction accuracy
      if (decision.params?.lanes) {
        const predicted = decision.params.lanes[0];
        if (Math.abs(predicted - this.state.playerLane) <= 1) {
          this.state.challenges++;
        }
        this.state.predictions++;
      }
      
      // Debug telemetry
      this.callbacks.onDebug({
        predicted: decision.params?.lanes?.[0] !== undefined ? decision.params.lanes[0] : '-',
        lanes: decision.params?.lanes || [],
        dirs: decision.params?.dirs || [],
        decision: decision.decision,
        explain: decision.explain || '',
        challengeRate: this.state.predictions > 0 
          ? Math.round((this.state.challenges / this.state.predictions) * 100)
          : 0,
        rtt: rtt
      });
      
      // Update RTT display
      if (document.getElementById('rtt')) {
        document.getElementById('rtt').textContent = rtt;
      }
      if (document.getElementById('dbg-rtt')) {
        document.getElementById('dbg-rtt').textContent = rtt + 'ms';
      }
      
    } catch (err) {
      console.error('Decision error:', err);
    }
    
    // Taunt occasionally
    if (Date.now() - this.lastTauntTime > TAUNT_DEBOUNCE_MS && Math.random() < 0.3) {
      this.requestTaunt();
    }
  }
  
  async requestTaunt() {
    try {
      const response = await fetch(`${API_URL}/taunt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_lane: this.state.playerLane,
          recent_lanes: this.state.recentLanes,
          overlord_mode: this.state.mode,
          tick: this.state.tick
        })
      });
      
      const { message } = await response.json();
      this.callbacks.onTaunt(message);
      this.sfx.taunt();
      this.lastTauntTime = Date.now();
    } catch (err) {
      console.error('Taunt error:', err);
    }
  }
  
  applyDecision(decision) {
    if (!decision || !decision.decision) return;
    
    switch (decision.decision) {
      case 'spawn_bullets':
        this.spawnBullets(decision.params);
        break;
      case 'slow_time':
        // Visual effect for slow time
        this.effects.add({
          type: 'slowtime',
          time: 0,
          duration: (decision.params?.duration_ms || 800) / 1000
        });
        break;
      case 'taunt':
        if (decision.params?.message) {
          this.callbacks.onTaunt(decision.params.message);
        }
        break;
    }
  }
  
  spawnBullets(params) {
    const count = params.count || 1;
    const lanes = params.lanes || [2];
    const dirs = params.dirs || [0];
    const speed = params.speed || 1.0;
    
    for (let i = 0; i < Math.min(count, lanes.length); i++) {
      const lane = Math.max(0, Math.min(4, lanes[i] || 2));
      
      // Telegraph warning - much shorter duration
      const laneX = this.getLaneX(lane);
      this.effects.add({
        type: 'telegraph',
        x: laneX,
        y: 100,
        width: 40,
        height: this.height - 200,
        time: 0,
        duration: 0.2 // Reduced from 0.3
      });
      
      // Spawn bullet immediately
      this.spawnBullet({
        lane: lane,
        dir: dirs[i] || 0,
        speed: Math.max(0.5, Math.min(2.0, speed))
      });
    }
    
    this.sfx.shoot();
  }
  
  spawnBullet(params) {
    if (this.state.bullets.length >= POOL_SIZE) {
      this.state.bullets.shift();
    }
    
    const laneX = this.getLaneX(params.lane);
    const overlordY = 50;
    
    // SIMPLIFIED: Just shoot straight down to the lane
    // Diagonal movement was overcomplicating things
    const bullet = {
      x: laneX,
      y: overlordY,
      vx: 0, // No horizontal movement for now
      vy: BASE_BULLET_VY * params.speed,
      lane: params.lane,
      dir: params.dir,
      speed: params.speed,
      active: true,
      rotation: 0
    }

    this.state.bullets.push(bullet);
    return bullet;
  }
  
  getLaneX(lane) {
    // Ensure lane is within bounds
    lane = Math.max(0, Math.min(4, lane));
    const laneWidth = this.width / 6;
    return laneWidth * (lane + 1);
  }
  
  getLaneY() {
    return this.height * 0.8;
  }
  
  gameLoop() {
    if (this.state.dead) return;
    
    this.update();
    this.render();
    
    requestAnimationFrame(() => this.gameLoop());
  }
  
  update() {
    const now = Date.now();
    const dt = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;
    
    this.state.survivalTime = (now - this.state.startTime) / 1000;
    
    // Update animation
    this.animator.tick();
    this.playerAnimOffset *= 0.9; // Smooth return to center
    
    // Update effects
    this.effects.update(dt);
    
    // Update bullets
    this.state.bullets = this.state.bullets.filter(bullet => {
      if (!bullet.active) return false;
      
      // Update position
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.rotation += dt * 2;
      
      // Check collision with player
      if (now > this.invulnEndTime) {
        const playerX = this.getLaneX(this.state.playerLane);
        const playerY = this.getLaneY();
        const dist = Math.hypot(bullet.x - playerX, bullet.y - playerY);
        
        if (dist < 25) {
          this.onHit();
          this.effects.add({
            type: 'explosion',
            x: playerX,
            y: playerY,
            size: 30,
            time: 0,
            duration: 0.5
          });
          return false;
        }
      }
      
      // Remove off-screen bullets
      return bullet.y < this.height + 50 && bullet.x > -50 && bullet.x < this.width + 50;
    });
    
    this.callbacks.onUpdate({
      time: this.state.survivalTime,
      best: this.state.bestTime
    });
  }
  
  render() {
    // Clear canvas
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this.width, this.height);
    
    // Draw grid background
    this.ctx.strokeStyle = 'rgba(0, 255, 255, 0.05)';
    this.ctx.lineWidth = 1;
    for (let y = 0; y < this.height; y += 40) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.width, y);
      this.ctx.stroke();
    }
    
    // Draw lanes
    this.ctx.strokeStyle = 'rgba(255, 0, 64, 0.2)';
    this.ctx.lineWidth = 2;
    for (let i = 0; i <= 5; i++) {
      const x = (this.width / 6) * i;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.height);
      this.ctx.stroke();
    }
    
    // Draw lane markers at player level
    for (let i = 0; i < 5; i++) {
      const x = this.getLaneX(i);
      const y = this.getLaneY();
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      this.ctx.strokeRect(x - 25, y - 25, 50, 50);
    }
    
    // Draw effects (telegraphs, explosions)
    this.effects.render(this.renderer);
    
    // Draw overlord (top center)
    const overlordX = this.width / 2;
    const overlordY = 50;
    this.renderer.drawShape(overlordX, overlordY, 'triangle', '#ff00ff', 25, {
      stroke: true,
      strokeColor: '#ff00ff',
      glow: true,
      glowColor: '#ff00ff',
      glowSize: 15
    });
    
    // Draw overlord eyes
    this.renderer.drawShape(overlordX - 8, overlordY - 5, 'circle', '#ff0000', 3);
    this.renderer.drawShape(overlordX + 8, overlordY - 5, 'circle', '#ff0000', 3);
    
    // Draw bullets
    this.state.bullets.forEach(bullet => {
      this.ctx.save();
      this.ctx.translate(bullet.x, bullet.y);
      this.ctx.rotate(bullet.rotation);
      
      // Bullet trail
      const gradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 15);
      gradient.addColorStop(0, 'rgba(255, 0, 64, 0.8)');
      gradient.addColorStop(1, 'rgba(255, 0, 64, 0)');
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(-15, -15, 30, 30);
      
      // Bullet core
      this.renderer.drawShape(0, 0, 'diamond', '#ff0040', 8, {
        glow: true,
        glowColor: '#ff0040',
        glowSize: 10
      });
      
      this.ctx.restore();
    });
    
    // Draw player
    const playerX = this.getLaneX(this.state.playerLane) + this.playerAnimOffset;
    const playerY = this.getLaneY();
    
    // Player shield/aura when invulnerable
    if (Date.now() < this.invulnEndTime) {
      const pulseAlpha = 0.3 + Math.sin(Date.now() * 0.01) * 0.2;
      this.renderer.drawShape(playerX, playerY, 'circle', `rgba(0, 255, 255, ${pulseAlpha})`, 35);
    }
    
    // Player body
    this.renderer.drawShape(playerX, playerY, 'circle', '#00ff00', 15, {
      stroke: true,
      strokeColor: '#00ff00',
      glow: !this.state.dead,
      glowColor: '#00ff00',
      glowSize: 8
    });
    
    // Player direction indicator
    if (this.playerAnimOffset !== 0) {
      const arrowX = playerX + (this.playerAnimOffset > 0 ? 10 : -10);
      this.ctx.strokeStyle = '#00ff00';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(playerX, playerY);
      this.ctx.lineTo(arrowX, playerY);
      this.ctx.stroke();
    }
    
    // Draw HUD elements
    this.drawHUD();
  }
  
  drawHUD() {
    // Grace period indicator
    if (Date.now() < this.graceEndTime) {
      this.ctx.fillStyle = 'rgba(0, 255, 255, 0.5)';
      this.ctx.font = '20px monospace';
      this.ctx.textAlign = 'center';
      const remaining = Math.ceil((this.graceEndTime - Date.now()) / 1000);
      this.ctx.fillText(`GRACE: ${remaining}s`, this.width / 2, 100);
    }
    
    // Mode indicator
    this.ctx.fillStyle = this.state.mode === 'aggressive' ? '#ff0040' : '#00ff40';
    this.ctx.font = '14px monospace';
    this.ctx.textAlign = 'right';
    this.ctx.fillText(this.state.mode.toUpperCase(), this.width - 10, 20);
  }
  
  onHit() {
    if (this.state.dead) return;
    
    this.sfx.hit();
    this.animator.setState('hit');
    this.onDeath();
  }
  
  onDeath() {
    if (this.state.dead) return;
    
    this.state.dead = true;
    this.stop();
    
    this.state.saveBest(this.state.survivalTime);
    
    this.sfx.death();
    this.animator.setState('death');
    
    this.callbacks.onDeath({
      time: this.state.survivalTime,
      best: this.state.bestTime
    });
  }
  
  restart() {
    this.stop();
    this.start();
  }
  
  setMode(mode) {
    this.state.mode = mode;
  }
}