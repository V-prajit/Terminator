// game.js - Fixed version
// Core game engine with proper bullet targeting and telegraph timing

const DEFAULT_API_URL = new URLSearchParams(location.search).get('ai') || 'http://localhost:8787';
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

// Render abstraction with shape rendering and sprite support
class RenderLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.sprites = new Map();
    this.loadedImages = new Map();
  }

  async loadSprite(name, imagePath) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.loadedImages.set(name, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = imagePath;
    });
  }

  drawSprite(name, x, y, width = null, height = null, options = {}) {
    const img = this.loadedImages.get(name);
    if (!img) return;

    this.ctx.save();

    if (options.alpha !== undefined) {
      this.ctx.globalAlpha = options.alpha;
    }

    const drawWidth = width || img.width;
    const drawHeight = height || img.height;

    // Draw from center by default
    const drawX = x - drawWidth / 2;
    const drawY = y - drawHeight / 2;

    if (options.rotation) {
      this.ctx.translate(x, y);
      this.ctx.rotate(options.rotation);
      this.ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    } else {
      this.ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
    }

    this.ctx.restore();
  }

  drawSpriteFrame(name, x, y, frameX, frameY, frameWidth, frameHeight, drawWidth = null, drawHeight = null, options = {}) {
    const img = this.loadedImages.get(name);
    if (!img) return;

    this.ctx.save();

    if (options.alpha !== undefined) {
      this.ctx.globalAlpha = options.alpha;
    }

    const dWidth = drawWidth || frameWidth;
    const dHeight = drawHeight || frameHeight;

    const drawX = x - dWidth / 2;
    const drawY = y - dHeight / 2;

    if (options.rotation) {
      this.ctx.translate(x, y);
      this.ctx.rotate(options.rotation);
      this.ctx.drawImage(img, frameX, frameY, frameWidth, frameHeight, -dWidth / 2, -dHeight / 2, dWidth, dHeight);
    } else {
      this.ctx.drawImage(img, frameX, frameY, frameWidth, frameHeight, drawX, drawY, dWidth, dHeight);
    }

    this.ctx.restore();
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
    this.frameTimer = 0;
    this.frameDelay = 6; // Medium speed animation - frames to wait before advancing
  }

  setState(state) {
    if (this.states.has(state) && this.current !== state) {
      this.current = state;
      this.frame = 0;
      this.frameTimer = 0;
    }
  }

  register(state, frames) {
    this.states.set(state, frames);
  }

  tick() {
    this.frameTimer++;
    if (this.frameTimer >= this.frameDelay) {
      this.frameTimer = 0;
      const frames = this.states.get(this.current);
      if (frames && frames.length > 0) {
        this.frame = (this.frame + 1) % frames.length;
      }
    }
  }

  getCurrentFrame() {
    const frames = this.states.get(this.current);
    if (frames && frames.length > 0) {
      return frames[this.frame];
    }
    return 0;
  }

  getCurrentSpriteFrame(frameWidth, frameHeight, framesPerRow) {
    const frameIndex = this.getCurrentFrame();
    const row = Math.floor(frameIndex / framesPerRow);
    const col = frameIndex % framesPerRow;
    return {
      x: col * frameWidth,
      y: row * frameHeight,
      width: frameWidth,
      height: frameHeight
    };
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

// Enhanced Visual effects manager with particles and screen shake
class EffectsManager {
  constructor() {
    this.effects = [];
    this.particles = [];
    this.screenShake = { x: 0, y: 0, intensity: 0, duration: 0 };
    this.aiThinking = { active: false, pulse: 0, confidence: 0 };
  }

  add(effect) {
    this.effects.push(effect);
  }

  addParticles(x, y, count, type = 'bullet') {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 200,
        vy: (Math.random() - 0.5) * 200,
        life: 1.0,
        maxLife: 0.5 + Math.random() * 0.5,
        size: 2 + Math.random() * 4,
        color: type === 'bullet' ? [255, 0, 64] : type === 'explosion' ? [255, 100, 0] : [0, 255, 255],
        type: type
      });
    }
  }

  addScreenShake(intensity = 5, duration = 200) {
    this.screenShake.intensity = Math.max(this.screenShake.intensity, intensity);
    this.screenShake.duration = Math.max(this.screenShake.duration, duration);
  }

  setAIThinking(active, confidence = 0.5) {
    this.aiThinking.active = active;
    this.aiThinking.confidence = confidence;
  }

  update(dt) {
    // Update effects
    this.effects = this.effects.filter(effect => {
      effect.time += dt;
      return effect.time < effect.duration;
    });

    // Update particles
    this.particles = this.particles.filter(particle => {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life -= dt / particle.maxLife;
      particle.vy += 100 * dt; // gravity
      return particle.life > 0;
    });

    // Update screen shake
    if (this.screenShake.duration > 0) {
      this.screenShake.duration -= dt * 1000;
      const t = this.screenShake.duration / 200;
      this.screenShake.x = (Math.random() - 0.5) * this.screenShake.intensity * t;
      this.screenShake.y = (Math.random() - 0.5) * this.screenShake.intensity * t;
    } else {
      this.screenShake.x = 0;
      this.screenShake.y = 0;
      this.screenShake.intensity = 0;
    }

    // Update AI thinking pulse
    this.aiThinking.pulse += dt * 4;
  }

  render(renderer) {
    // Render particles first (behind other effects)
    this.particles.forEach(particle => {
      const alpha = particle.life;
      const size = particle.size * (0.5 + particle.life * 0.5);
      const [r, g, b] = particle.color;

      renderer.ctx.save();
      renderer.ctx.globalAlpha = alpha * 0.8;
      renderer.ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      renderer.ctx.shadowBlur = 8;
      renderer.ctx.shadowColor = `rgb(${r}, ${g}, ${b})`;
      renderer.ctx.beginPath();
      renderer.ctx.arc(particle.x, particle.y, size, 0, Math.PI * 2);
      renderer.ctx.fill();
      renderer.ctx.restore();
    });

    // Render effects
    this.effects.forEach(effect => {
      if (effect.type === 'explosion') {
        this.renderEnhancedExplosion(renderer, effect);
      }
    });
  }

  renderEnhancedExplosion(renderer, effect) {
    const progress = effect.time / effect.duration;
    const alpha = Math.max(0, 1 - progress);
    const outerRadius = effect.size * (1 + progress * 2);
    const innerRadius = effect.size * progress;

    renderer.ctx.save();

    // Outer explosion ring
    const gradient = renderer.ctx.createRadialGradient(
      effect.x, effect.y, innerRadius,
      effect.x, effect.y, outerRadius
    );
    gradient.addColorStop(0, `rgba(255, 100, 0, ${alpha * 0.8})`);
    gradient.addColorStop(0.5, `rgba(255, 150, 0, ${alpha * 0.4})`);
    gradient.addColorStop(1, `rgba(255, 200, 100, 0)`);

    renderer.ctx.fillStyle = gradient;
    renderer.ctx.beginPath();
    renderer.ctx.arc(effect.x, effect.y, outerRadius, 0, Math.PI * 2);
    renderer.ctx.fill();

    // Inner bright core
    renderer.ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
    renderer.ctx.beginPath();
    renderer.ctx.arc(effect.x, effect.y, innerRadius * 0.3, 0, Math.PI * 2);
    renderer.ctx.fill();

    renderer.ctx.restore();
  }

  getScreenShake() {
    return this.screenShake;
  }

  getAIThinking() {
    return this.aiThinking;
  }
}

// Boss class
class Boss {
  constructor(game) {
    this.game = game;
    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.position = 1; // Starting position (0 = lanes 0-2, 1 = lanes 1-3, 2 = lanes 2-4)
    this.width = 3; // Spans 3 lanes
    this.active = true;
    this.lastMoveTime = 0;
    this.damageFlash = 0;
    this.shootCooldown = 0;
    this.defeated = false;

    // Animation system for overlord
    this.animator = new Animator();
    this.setupAnimations();

    // Overlord sprite properties (ULTRATHINK sprite sheet)
    // Try smaller frame dimensions - the sprite sheet might be arranged differently
    // Let's try a more typical sprite sheet layout
    this.spriteConfig = {
      frameWidth: 128,  // Smaller frame width
      frameHeight: 72,  // Smaller frame height
      framesPerRow: 10  // 10 frames per row
    };

  }

  setupAnimations() {
    // Exact frame mapping from user: frames 1-96 = idle, frames 97-147 = death
    // Converting to 0-based indexing: frames 0-95 = idle, frames 96-146 = death

    // Generate idle frame sequence (use every 2nd frame for smoother but still active animation)
    const idleFrames = [];
    for (let i = 0; i < 96; i += 2) {
      idleFrames.push(i);
    }

    // Generate death frame sequence (frames 96-146)
    const deathFrames = [];
    for (let i = 96; i < 147; i++) {
      deathFrames.push(i);
    }

    this.animator.register('idle', idleFrames); // Every 2nd idle frame for animation
    this.animator.register('attack', idleFrames.slice(0, 10)); // First 10 frames for attack
    this.animator.register('damage', idleFrames.slice(10, 15)); // Frames for damage
    this.animator.register('death', deathFrames); // Frames 96-146 (all death frames)
    this.animator.setState('idle');

  }

  takeDamage(amount = 20) {
    if (!this.active) return false;

    this.health = Math.max(0, this.health - amount);
    this.damageFlash = 300; // Flash duration in ms

    // Trigger damage animation
    this.animator.setState('damage');

    if (this.health <= 0) {
      this.defeated = true;
      this.animator.setState('death');
      // Boss will become inactive after death animation completes
      setTimeout(() => {
        this.active = false;
      }, 1000); // Allow death animation to play
      return true; // Boss defeated
    }
    return false;
  }

  update(dt) {
    if (!this.active && !this.defeated) return;

    // Update animations
    this.animator.tick();

    // Reduce damage flash
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1000);

    // Return to idle after damage animation
    if (this.animator.current === 'damage' && this.damageFlash <= 0 && !this.defeated) {
      this.animator.setState('idle');
    }

    // Reduce shoot cooldown
    this.shootCooldown = Math.max(0, this.shootCooldown - dt * 1000);

    // Boss movement (change position occasionally) - only if not defeated
    if (!this.defeated) {
      const now = Date.now();
      if (now - this.lastMoveTime > 3000 && Math.random() < 0.3) {
        this.position = Math.floor(Math.random() * 3); // 0, 1, or 2
        this.lastMoveTime = now;
      }
    }
  }

  getLanes() {
    return [this.position, this.position + 1, this.position + 2];
  }

  getX() {
    return this.game.getLaneX(this.position + 1); // Center of the 3 lanes
  }

  getY() {
    return 120; // Fixed Y position
  }

  getWidth() {
    return this.game.width / 5 * 3; // 3 lane widths
  }

  getHeight() {
    return 60;
  }

  canShoot() {
    return this.active && this.shootCooldown <= 0;
  }

  shoot() {
    if (!this.canShoot()) return;

    this.shootCooldown = 1500; // 1.5 second cooldown

    // Trigger attack animation
    this.animator.setState('attack');

    // Boss shoots from multiple lanes more aggressively
    const targetLanes = this.getLanes();
    const playerLane = this.game.state.playerLane;

    // Prioritize shooting at player's lane if it's within boss coverage
    let shootLanes = [];
    if (targetLanes.includes(playerLane)) {
      shootLanes.push(playerLane);
      // Add flanking shots
      if (shootLanes.length < 2 && playerLane > 0 && targetLanes.includes(playerLane - 1)) {
        shootLanes.push(playerLane - 1);
      }
      if (shootLanes.length < 2 && playerLane < 4 && targetLanes.includes(playerLane + 1)) {
        shootLanes.push(playerLane + 1);
      }
    } else {
      // Shoot from center of boss if player is outside range
      shootLanes.push(this.position + 1);
    }

    // Spawn enemy bullets
    shootLanes.forEach(lane => {
      this.game.spawnBullet({
        lane: lane,
        dir: 0,
        speed: 1.0,
        type: 'enemy'
      });
    });

    // Return to idle after a short delay
    setTimeout(() => {
      if (!this.defeated && this.animator.current === 'attack') {
        this.animator.setState('idle');
      }
    }, 500);
  }

  checkCollision(x, y, radius = 10) {
    if (!this.active) return false;

    const bossLeft = this.getX() - this.getWidth() / 2;
    const bossRight = this.getX() + this.getWidth() / 2;
    const bossTop = this.getY() - this.getHeight() / 2;
    const bossBottom = this.getY() + this.getHeight() / 2;

    return (x + radius > bossLeft &&
            x - radius < bossRight &&
            y + radius > bossTop &&
            y - radius < bossBottom);
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
    this.won = false;
    this.playerLane = 2;
    this.recentMoves = [];
    this.recentLanes = [2]; // Start with center lane
    this.mode = 'aggressive';
    this.bullets = [];
    this.playerBullets = [];
    this.challenges = 0;
    this.predictions = 0;
    this.lastPlayerShot = 0;
    this.ammo = 10; // Limited ammo for increased difficulty
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
    this.boss = new Boss(this);

    this.graceEndTime = 0;
    this.invulnEndTime = 0;
    this.lastTickTime = 0;
    this.lastTauntTime = 0;
    this.lastDecision = null;
    this.playerAnimOffset = 0;

    this.callbacks = {
      onDeath: options.onDeath || (() => {}),
      onWin: options.onWin || (() => {}),
      onTaunt: options.onTaunt || (() => {}),
      onDebug: options.onDebug || (() => {}),
      onUpdate: options.onUpdate || (() => {}),
      onAIStart: options.onAIStart || (() => {}),
      onAIComplete: options.onAIComplete || (() => {}),
      getPlayerInfo: options.getPlayerInfo || (() => null)
    };

    // API endpoint (configurable for comparison demo)
    this.apiUrl = options.apiEndpoint ? `${DEFAULT_API_URL}${options.apiEndpoint}` : `${DEFAULT_API_URL}/decide`;

    // Initialization will be called manually from external script
  }
  
  async init() {
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

    // Load sprites
    try {
      await this.loadSprites();
    } catch (error) {
      console.warn('Could not load sprites:', error);
    }

    // Register entity types
    this.entities.register('bullet', {
      spawn: (params) => this.spawnBullet(params)
    });

    // Animation states for player (simple animations)
    this.animator.register('idle', [0]);
    this.animator.register('moveLeft', [1]);
    this.animator.register('moveRight', [2]);
    this.animator.register('hit', [3]);
    this.animator.register('death', [4]);
  }

  async loadSprites() {
    // No sprites needed for clean professional look
  }
  
  start() {
    this.state.reset();
    this.boss = new Boss(this); // Reset boss
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

  shoot() {
    if (this.state.dead || this.state.won) return;

    // Check if player has ammo
    if (this.state.ammo <= 0) return;

    const now = Date.now();
    const SHOOT_COOLDOWN = 500; // Increased from 250ms to 500ms for more difficulty

    if (now - this.state.lastPlayerShot < SHOOT_COOLDOWN) return;

    this.state.lastPlayerShot = now;

    // Consume ammo
    this.state.ammo--;

    // Create player bullet
    const playerBullet = {
      x: this.getLaneX(this.state.playerLane),
      y: this.getLaneY() - 20,
      vx: 0,
      vy: -400, // Negative velocity = upward movement
      lane: this.state.playerLane,
      active: true,
      type: 'player',
      rotation: 0
    };

    this.state.playerBullets.push(playerBullet);
    this.sfx.playTone(600, 0.1, 'square'); // Different sound for player shooting
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
      // Start AI thinking visual indicator
      this.effects.setAIThinking(true, 0.5);
      this.callbacks.onAIStart(); // Indicate AI is thinking

      const startTime = Date.now();
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.state.getRequestPayload())
      });

      const rtt = Date.now() - startTime;
      const decision = await response.json();
      this.lastDecision = decision;

      // Calculate AI confidence based on decision quality and response time
      const aiConfidence = this.calculateAIConfidence(decision, rtt);
      this.effects.setAIThinking(false, aiConfidence);

      this.applyDecision(decision, aiConfidence);

      this.callbacks.onAIComplete(decision.source); // Indicate AI completed
      
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
      this.callbacks.onAIComplete('error'); // Indicate AI error
    }
    
    // Taunt occasionally
    if (Date.now() - this.lastTauntTime > TAUNT_DEBOUNCE_MS && Math.random() < 0.3) {
      this.requestTaunt();
    }
  }
  
  async requestTaunt() {
    try {
      // Get player information if available
      const playerInfo = this.callbacks.getPlayerInfo();

      // Prepare taunt request with player context
      const tauntRequest = {
        // Game context
        player_lane: this.state.playerLane,
        recent_lanes: this.state.recentLanes,
        overlord_mode: this.state.mode,
        tick: this.state.tick,
        survival_time: this.state.survivalTime,
        game_phase: this.state.survivalTime < 5 ? 'beginner' :
                   this.state.survivalTime < 20 ? 'intermediate' : 'expert',

        // Player information (if available)
        playerId: playerInfo?.playerId || null,
        playerName: playerInfo?.playerName || null,

        // Additional context for taunt generation
        context: {
          currentPerformance: {
            survivalTime: this.state.survivalTime,
            bestTime: this.state.bestTime
          },
          gameState: {
            activeBullets: this.state.bullets.filter(b => b.type === 'enemy').length,
            recentMoves: this.state.recentMoves?.slice(-5) || [],
            lastAiDecision: this.lastDecision
          }
        }
      };

      const response = await fetch(`${DEFAULT_API_URL}/taunt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tauntRequest)
      });

      const result = await response.json();
      const message = result.message || "Ready to try again?";

      this.callbacks.onTaunt(message);
      this.sfx.taunt();
      this.lastTauntTime = Date.now();

      // Log taunt type for debugging
      if (result.type === 'personalized') {
        console.log(`[Game] Personalized taunt for ${result.playerName}: "${message}"`);
      } else {
        console.log(`[Game] Fallback taunt (${result.type}): "${message}"`);
      }

    } catch (err) {
      console.error('Taunt error:', err);
      // Fallback taunt on error
      this.callbacks.onTaunt("The AI is watching...");
    }
  }

  calculateAIConfidence(decision, rtt) {
    let confidence = 0.5; // Base confidence

    // Confidence based on response time (faster = more confident)
    if (rtt < 200) confidence += 0.3;
    else if (rtt < 400) confidence += 0.1;
    else confidence -= 0.1;

    // Confidence based on decision quality
    if (decision.source === 'cerebras-hybrid') confidence += 0.2;
    if (decision.params?.lanes && decision.params.lanes.length > 0) confidence += 0.1;
    if (decision.explain && decision.explain.length > 20) confidence += 0.1;

    // Confidence based on prediction specificity
    if (decision.params?.lanes && decision.params.lanes.length === 1) confidence += 0.1;

    return Math.max(0, Math.min(1, confidence));
  }

  applyDecision(decision, aiConfidence = 0.5) {
    if (!decision || !decision.decision) return;
    
    switch (decision.decision) {
      case 'spawn_bullets':
        this.spawnBullets(decision.params, aiConfidence);
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
  
  spawnBullets(params, aiConfidence = 0.5) {
    const count = params.count || 1;
    const lanes = params.lanes || [2];
    const dirs = params.dirs || [0];
    const speed = params.speed || 1.0;

    for (let i = 0; i < Math.min(count, lanes.length); i++) {
      const lane = Math.max(0, Math.min(4, lanes[i] ?? 2));

      // Spawn bullet immediately without telegraph warning
      this.spawnBullet({
        lane: lane,
        dir: dirs[i] || 0,
        speed: Math.max(0.5, Math.min(2.0, speed)),
        confidence: aiConfidence
      });
    }

    this.sfx.shoot();
  }
  
  spawnBullet(params) {
    if (this.state.bullets.length >= POOL_SIZE) {
      this.state.bullets.shift();
    }

    const laneX = this.getLaneX(params.lane);
    const overlordY = params.type === 'player' ? this.getLaneY() - 20 : 50;

    const bullet = {
      x: laneX,
      y: overlordY,
      vx: 0,
      vy: params.type === 'player' ? -400 : BASE_BULLET_VY * params.speed,
      lane: params.lane,
      dir: params.dir || 0,
      speed: params.speed || 1.0,
      type: params.type || 'enemy',
      active: true,
      rotation: 0,
      confidence: params.confidence || 0.5
    };

    this.state.bullets.push(bullet);
    return bullet;
  }
  
  getLaneX(lane) {
    // Ensure lane is within bounds
    lane = Math.max(0, Math.min(4, lane));
    const laneWidth = this.width / 5;
    return laneWidth * (lane + 0.5);
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
    if (this.state.dead || this.state.won) return;

    // Debug: Log every 60 frames (about 1 second)
    if (!this._frameCount) this._frameCount = 0;
    this._frameCount++;
    if (this._frameCount % 60 === 0) {
      console.log('[Game] Update loop running - frame:', this._frameCount, 'dead:', this.state.dead, 'won:', this.state.won);
    }

    const now = Date.now();
    const dt = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;

    this.state.survivalTime = (now - this.state.startTime) / 1000;

    // Update animation
    this.animator.tick();
    this.playerAnimOffset *= 0.9; // Smooth return to center

    // Update effects
    this.effects.update(dt);

    // Update boss (including animations)
    this.boss.update(dt);

    // Boss shooting (disabled for comparison demo)
    // if (this.boss.canShoot() && Math.random() < 0.02) { // 2% chance per frame
    //   this.boss.shoot();
    // }

    // Update enemy bullets
    this.state.bullets = this.state.bullets.filter(bullet => {
      if (!bullet.active) return false;

      // Update position
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.rotation += dt * 2;

      // Check collision with player (only enemy bullets)
      if (bullet.type === 'enemy' && now > this.invulnEndTime) {
        const playerX = this.getLaneX(this.state.playerLane);
        const playerY = this.getLaneY();
        const dist = Math.hypot(bullet.x - playerX, bullet.y - playerY);

        if (dist < 25) {
          // Enhanced collision data
          const collisionData = {
            bulletType: bullet.type,
            bulletSpeed: bullet.speed || 1.0,
            collisionLane: this.state.playerLane,
            bulletLane: bullet.lane || -1,
            gamePhase: this.state.survivalTime < 5 ? 'beginner' :
                      this.state.survivalTime < 20 ? 'intermediate' : 'expert',
            bulletCount: this.state.bullets.filter(b => b.type === 'enemy').length,
            playerPosition: { x: playerX, y: playerY },
            bulletPosition: { x: bullet.x, y: bullet.y },
            aiDecisionCaused: this.lastDecision
          };

          // Add dramatic visual effects for mobile
          this.effects.addScreenShake(8, 300);
          this.effects.addParticles(bullet.x, bullet.y, 15, 'explosion');
          this.effects.add({
            type: 'explosion',
            x: playerX,
            y: playerY,
            size: 30,
            time: 0,
            duration: 0.5
          });

          this.onHit(collisionData);
          return false;
        }
      }

      // Remove off-screen bullets
      return bullet.y < this.height + 50 && bullet.y > -50 &&
             bullet.x > -50 && bullet.x < this.width + 50;
    });

    // Update player bullets
    this.state.playerBullets = this.state.playerBullets.filter(bullet => {
      if (!bullet.active) return false;

      // Update position
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.rotation += dt * 2;

      // Check collision with boss
      if (this.boss.checkCollision(bullet.x, bullet.y, 8)) {
        const defeated = this.boss.takeDamage(20);

        // Add hit effect
        this.effects.add({
          type: 'explosion',
          x: bullet.x,
          y: bullet.y,
          size: 20,
          time: 0,
          duration: 0.3
        });

        this.sfx.hit();

        if (defeated) {
          this.onWin();
        }

        return false; // Remove bullet
      }

      // Remove off-screen bullets
      return bullet.y > -50;
    });

    // Debug: Log onUpdate callback every 60 frames
    if (this._frameCount % 60 === 0) {
      console.log('[Game] Calling onUpdate callback - time:', this.state.survivalTime, 'bullets:', this.state.bullets.length);
    }

    this.callbacks.onUpdate({
      time: this.state.survivalTime,
      best: this.state.bestTime,
      bossHealth: this.boss.health,
      bossMaxHealth: this.boss.maxHealth,
      ammo: this.state.ammo
    });
  }
  
  render() {
    // Apply screen shake effect
    const shake = this.effects.getScreenShake();
    this.ctx.save();
    this.ctx.translate(shake.x, shake.y);

    // Clean dark background
    this.ctx.fillStyle = '#0f0f0f';
    this.ctx.fillRect(-shake.x, -shake.y, this.width + Math.abs(shake.x) * 2, this.height + Math.abs(shake.y) * 2);
    
    // Draw lanes
    this.ctx.strokeStyle = 'rgba(255, 0, 64, 0.2)';
    this.ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      const x = (this.width / 5) * i;
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

    // Draw boss/overlord
    if (this.boss.active || this.boss.defeated) {
      const bossX = this.boss.getX();
      const bossY = this.boss.getY();

      // Draw professional ULTRATHINK AI overlord
      this.drawProfessionalULTRATHINK(bossX, bossY);

      // Professional AI health display
      if (this.boss.active) {
        this.drawProfessionalHealthBar(bossX, bossY - 130);
      }
    } else {
      // Draw small overlord (original design) when no boss
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
    }
    
    // Draw enemy bullets with enhanced particle trails
    this.state.bullets.forEach(bullet => {
      this.ctx.save();
      this.ctx.translate(bullet.x, bullet.y);
      this.ctx.rotate(bullet.rotation);

      // Dynamic confidence-based glow
      const confidence = bullet.confidence || 0.5;
      const baseIntensity = 0.6 + confidence * 0.4;
      const glowSize = 15 + confidence * 10;

      // Enhanced particle trail system
      const trailGradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, glowSize);
      trailGradient.addColorStop(0, `rgba(255, 0, 64, ${baseIntensity})`);
      trailGradient.addColorStop(0.3, `rgba(255, 64, 128, ${baseIntensity * 0.6})`);
      trailGradient.addColorStop(0.7, `rgba(255, 128, 192, ${baseIntensity * 0.3})`);
      trailGradient.addColorStop(1, 'rgba(255, 200, 255, 0)');

      this.ctx.fillStyle = trailGradient;
      this.ctx.fillRect(-glowSize, -glowSize, glowSize * 2, glowSize * 2);

      // Prediction confidence indicator (brighter = more confident)
      const coreSize = 8 + confidence * 4;
      const coreColor = `rgba(255, ${64 - confidence * 64}, ${64 - confidence * 64}, ${0.8 + confidence * 0.2})`;

      this.renderer.drawShape(0, 0, 'diamond', coreColor, coreSize, {
        glow: true,
        glowColor: '#ff0040',
        glowSize: 10 + confidence * 5
      });

      // Add targeting precision indicators for high-confidence shots
      if (confidence > 0.7) {
        const time = Date.now() * 0.01;
        for (let i = 0; i < 3; i++) {
          const angle = (i * Math.PI * 2 / 3) + time;
          const radius = 12 + Math.sin(time + i) * 3;
          const px = Math.cos(angle) * radius;
          const py = Math.sin(angle) * radius;

          this.ctx.fillStyle = `rgba(255, 255, 255, ${confidence * 0.5})`;
          this.ctx.beginPath();
          this.ctx.arc(px, py, 1, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }

      this.ctx.restore();

      // Spawn trailing particles for visual effect
      if (Math.random() < 0.3) {
        this.effects.addParticles(bullet.x, bullet.y, 1, 'bullet');
      }
    });

    // Draw player bullets
    this.state.playerBullets.forEach(bullet => {
      this.ctx.save();
      this.ctx.translate(bullet.x, bullet.y);
      this.ctx.rotate(bullet.rotation);

      // Blue bullet trail
      const gradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
      gradient.addColorStop(0, 'rgba(0, 100, 255, 0.8)');
      gradient.addColorStop(1, 'rgba(0, 100, 255, 0)');
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(-12, -12, 24, 24);

      // Blue bullet core
      this.renderer.drawShape(0, 0, 'circle', '#0064ff', 6, {
        glow: true,
        glowColor: '#0064ff',
        glowSize: 8
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

    // Draw player (simple shape)
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

    // Draw AI thinking indicators
    const aiThinking = this.effects.getAIThinking();
    if (aiThinking.active) {
      const pulseAlpha = 0.3 + Math.sin(aiThinking.pulse) * 0.2;
      const confidenceSize = 20 + aiThinking.confidence * 15;

      // AI thinking pulse around the overlord
      this.ctx.strokeStyle = `rgba(0, 255, 255, ${pulseAlpha})`;
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.arc(this.width / 2, 50, confidenceSize, 0, Math.PI * 2);
      this.ctx.stroke();

      // Confidence visualization
      this.ctx.fillStyle = `rgba(0, 255, 255, ${pulseAlpha * 0.5})`;
      this.ctx.font = '12px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(`AI: ${Math.round(aiThinking.confidence * 100)}%`, this.width / 2, 90);
    }

    // Restore screen shake transform
    this.ctx.restore();
  }
  
  drawProfessionalULTRATHINK(x, y) {
    const time = Date.now() * 0.003;
    const flashAlpha = this.boss.damageFlash > 0 ? 0.8 : 1.0;
    const isAttacking = this.boss.animator.current === 'attack';
    const isDamaged = this.boss.damageFlash > 0;

    this.ctx.save();
    this.ctx.globalAlpha = flashAlpha;

    const size = 50;
    const bodyColor = isDamaged ? '#ff4444' : (isAttacking ? '#ff00ff' : '#00ffff');

    // Subtle glow ring
    const ringSize = size + 15 + Math.sin(time) * 3;
    this.ctx.strokeStyle = `rgba(0, 255, 255, 0.4)`;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(x, y, ringSize, 0, Math.PI * 2);
    this.ctx.stroke();

    // Main hexagon body
    this.ctx.fillStyle = bodyColor;
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();

    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 + time * 0.5;
      const px = x + Math.cos(angle) * size;
      const py = y + Math.sin(angle) * size;
      if (i === 0) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    }
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();

    // Core
    const coreSize = 15 + Math.sin(time * 3) * 3;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.beginPath();
    this.ctx.arc(x, y, coreSize, 0, Math.PI * 2);
    this.ctx.fill();

    // Attack indicators
    if (isAttacking) {
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI * 2) / 6 + time * 2;
        const radius = size + 15;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;

        this.ctx.fillStyle = '#ff00ff';
        this.ctx.beginPath();
        this.ctx.arc(px, py, 2, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    this.ctx.restore();
  }

  drawProfessionalHealthBar(x, y) {
    const healthPercent = this.boss.health / this.boss.maxHealth;
    const barWidth = 160;
    const barHeight = 6;

    this.ctx.save();

    // Health bar background
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    this.ctx.fillRect(x - barWidth/2, y, barWidth, barHeight);

    // Health bar fill
    this.ctx.fillStyle = healthPercent > 0.5 ? '#00ff00' : healthPercent > 0.25 ? '#ffff00' : '#ff0000';
    this.ctx.fillRect(x - barWidth/2, y, barWidth * healthPercent, barHeight);

    this.ctx.restore();
  }

  drawHUD() {
    // Clean minimal HUD
    if (Date.now() < this.graceEndTime) {
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      this.ctx.font = '18px monospace';
      this.ctx.textAlign = 'center';
      const remaining = Math.ceil((this.graceEndTime - Date.now()) / 1000);
      this.ctx.fillText(`${remaining}`, this.width / 2, 100);
    }

    // Prediction accuracy (key metric for demo)
    if (this.state.predictions > 0) {
      const challengeRate = Math.round((this.state.challenges / this.state.predictions) * 100);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = '14px monospace';
      this.ctx.textAlign = 'left';
      this.ctx.fillText(`Accuracy: ${challengeRate}%`, 10, 25);
    }
  }
  
  onHit(collisionData = null) {
    if (this.state.dead) return;

    // Store collision data for death analysis
    this.lastCollisionData = collisionData;

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

    // Enhanced death data with collision details and game context
    const deathData = {
      // Basic stats (existing)
      time: this.state.survivalTime,
      best: this.state.bestTime,

      // Collision details
      deathCause: this.lastCollisionData ? 'bullet_collision' : 'unknown',
      deathLane: this.lastCollisionData ? this.lastCollisionData.collisionLane : this.state.playerLane,
      collisionData: this.lastCollisionData,

      // Game state context
      gamePhase: this.state.survivalTime < 5 ? 'beginner' :
                this.state.survivalTime < 20 ? 'intermediate' : 'expert',
      activeBullets: this.state.bullets.filter(b => b.type === 'enemy').length,

      // Movement pattern (recent moves)
      movementPattern: this.state.recentMoves ? this.state.recentMoves.slice() : [],
      recentLanes: this.state.recentLanes ? this.state.recentLanes.slice() : [],

      // AI context
      lastAiDecision: this.lastDecision,
      currentMode: this.state.mode,

      // Session context
      finalScore: this.state.survivalTime,
      bulletCount: this.lastCollisionData ? this.lastCollisionData.bulletCount : 1,

      // Timestamp
      timestamp: Date.now()
    };

    this.callbacks.onDeath(deathData);
  }

  onWin() {
    if (this.state.won || this.state.dead) return;

    this.state.won = true;
    this.stop();

    this.state.saveBest(this.state.survivalTime);

    // Victory sound effect
    this.sfx.playTone(800, 0.5, 'sine');
    setTimeout(() => this.sfx.playTone(1000, 0.5, 'sine'), 150);
    setTimeout(() => this.sfx.playTone(1200, 0.8, 'sine'), 300);

    this.callbacks.onWin({
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