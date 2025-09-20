// packages/game/src/game.js
import Phaser from "phaser";

// ---------- Config & ENV ----------
const AI_URL = import.meta.env.VITE_AI_SERVER_URL || "http://localhost:8787";
const MOCK_MODE = `${import.meta.env.VITE_MOCK_MODE}`.toLowerCase() === "true";
const CLIENT_TIMEOUT_MS = 450; // per contract
const TICK_INTERVAL_MS = 700;  // start at 500–800ms once stable

// ---------- Lightweight state shared with DOM ----------
const $time = document.getElementById("survival-time");
const $latency = document.getElementById("latency");
const $taunt = document.getElementById("overlord-taunt");
const $spark = document.getElementById("sparkline");
const $death = document.getElementById("death-modal");
const $final = document.getElementById("final-time");
const $best = document.getElementById("best-time");
const $mode = document.getElementById("mode-selector");

// Tiny latency sparkline buffer
const latencyHistory = [];
const drawSpark = () => {
  const c = $spark;
  if (!c) return;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  if (latencyHistory.length < 2) return;
  const data = latencyHistory.slice(-40); // last 40 samples
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(1, max - min);
  const w = c.width, h = c.height;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * (w - 2) + 1;
    const y = h - 1 - ((v - min) / range) * (h - 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#00ffff";
  ctx.lineWidth = 1;
  ctx.stroke();
};

// ---------- Helpers ----------
const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() :
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

const loadBest = () => parseFloat(localStorage.getItem("best_time") || "0") || 0;
const saveBest = (v) => localStorage.setItem("best_time", String(v.toFixed(1)));

const playerId = (() => {
  const k = "player_id";
  let p = localStorage.getItem(k);
  if (!p) { p = uuid(); localStorage.setItem(k, p); }
  return p;
})();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Phaser Scene ----------
class MainScene extends Phaser.Scene {
  constructor() {
    super("main");
    this.resetRun();
  }

  init(){
    this.resetRun();
  }
  
  resetRun() {
    this.runId = uuid();
    this.tick = 0;
    this.survivalStart = 0;
    this.currentTime = 0;
    this.bestTime = loadBest();
    this.lastMove = "none";
    this.recentMoves = [];
    this.dead = false;
    this.pendingTimers = [];
    this.obstacles = null;
    this.blocks = null;
  }

  preload() {
    // Use simple shapes; no assets needed
  }

  create() {
    // World sizing
    const w = this.scale.gameSize.width;
    const h = this.scale.gameSize.height;

    // Physics groups
    this.obstacles = this.physics.add.group();
    this.blocks = this.physics.add.staticGroup();

    // Center + lane anchors
    this.center = new Phaser.Math.Vector2(w / 2, h / 2);

    // Four lane target positions (player snaps here)
    this.lanes = {
      up:    new Phaser.Math.Vector2(w / 2, h * 0.20),
      down:  new Phaser.Math.Vector2(w / 2, h * 0.80),
      left:  new Phaser.Math.Vector2(w * 0.20, h / 2),
      right: new Phaser.Math.Vector2(w * 0.80, h / 2),
    };
    this.currentLane = "down"; // default start

    // Player
    this.player = this.add.circle(this.lanes[this.currentLane].x, this.lanes[this.currentLane].y, 14, 0xffffff);
    this.physics.add.existing(this.player);
    this.player.body.setCircle(14);
    this.player.body.setCollideWorldBounds(true);
    this.player.body.setImmovable(true);

    // Collisions with moving obstacles
    this.physics.add.overlap(this.player, this.obstacles, () => this.onDeath(), null, this);
    // Collisions with blocks (static)
    this.physics.add.overlap(this.player, this.blocks, () => this.onDeath(), null, this);

    // Controls (keyboard)
    this.cursors = this.input.keyboard.createCursorKeys();
    this.W = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.A = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.S = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.D = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // Controls (touch): tap region decides lane
    this.input.on("pointerdown", (p) => {
      const x = p.x, y = p.y;
      const w = this.scale.gameSize.width;
      const h = this.scale.gameSize.height;
      const top = y < h * 0.33;
      const bottom = y > h * 0.66;
      const left = x < w * 0.33;
      const right = x > w * 0.66;
      if (top) this.setLane("up");
      else if (bottom) this.setLane("down");
      else if (left) this.setLane("left");
      else if (right) this.setLane("right");
    });

    // Start timing
    this.survivalStart = this.time.now;
    $taunt.textContent = "Overlord is watching...";
    $latency.textContent = "---";
    drawSpark();

    // Regular decision tick (can switch to on-death only if needed)
    this.decisionTimer = this.time.addEvent({
      delay: TICK_INTERVAL_MS,
      loop: true,
      callback: () => this.makeDecisionTick()
    });
  }

  update(t, dt) {
    if (this.dead) return;

    // Keyboard movement (snap to lane)
    if (Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.W))   this.setLane("up");
    if (Phaser.Input.Keyboard.JustDown(this.cursors.down) || Phaser.Input.Keyboard.JustDown(this.S)) this.setLane("down");
    if (Phaser.Input.Keyboard.JustDown(this.cursors.left) || Phaser.Input.Keyboard.JustDown(this.A)) this.setLane("left");
    if (Phaser.Input.Keyboard.JustDown(this.cursors.right) || Phaser.Input.Keyboard.JustDown(this.D)) this.setLane("right");

    // Lerp player toward lane anchor (smooth snap)
    const target = this.lanes[this.currentLane];
    this.player.x += (target.x - this.player.x) * 0.35;
    this.player.y += (target.y - this.player.y) * 0.35;

    // Update survival timer
    this.currentTime = (this.time.now - this.survivalStart) / 1000;
    $time.textContent = `${this.currentTime.toFixed(1)}s`;

    // Cleanup offscreen/expired obstacles
    this.obstacles.getChildren().forEach(o => {
      if (o.getData("ttl") && this.time.now > o.getData("ttl")) {
        o.destroy();
      }
      if (o.x < -50 || o.x > this.scale.gameSize.width + 50 ||
          o.y < -50 || o.y > this.scale.gameSize.height + 50) {
        o.destroy();
      }
    });

    // Remove expired static blocks
    this.blocks.getChildren().forEach(b => {
      if (b.getData("ttl") && this.time.now > b.getData("ttl")) {
        b.destroy();
      }
    });
  }

  setLane(lane) {
    if (!this.lanes[lane]) return;
    this.currentLane = lane;
    this.lastMove = lane;
    this.recentMoves.push(lane);
    if (this.recentMoves.length > 8) this.recentMoves.shift();
  }

  // ---------- Decision Tick ----------
  async makeDecisionTick() {
    if (this.dead) return;
    this.tick++;

    const stats = {
      best_time: this.bestTime,
      current_time: this.currentTime
    };

    const payload = {
      player_id: playerId,
      run_id: this.runId,
      tick: this.tick,
      last_move: this.lastMove || "none",
      recent_moves: this.recentMoves,
      session_stats: stats,
      overlord_mode: ($mode?.value || "aggressive")
    };

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    let usedMock = MOCK_MODE;
    let decision = null;
    const started = performance.now();

    try {
      if (!usedMock) {
        const res = await fetch(`${AI_URL}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        decision = json;
      }
    } catch {
      usedMock = true;
    } finally {
      clearTimeout(t);
    }

    if (usedMock) {
      // Deterministic mock pattern cycles through all actions
      const actions = [
        "block_left","block_right","block_up","block_down",
        "spawn_fast_right","spawn_fast_left","spawn_slow_right","spawn_slow_left",
        "feint_then_block_up","delay_trap"
      ];
      const choice = actions[(this.tick - 1) % actions.length];
      decision = this.mockDecision(choice);
    }

    const ended = performance.now();
    const latency = Math.round(ended - started);
    $latency.textContent = usedMock ? `${latency}ms (mock)` : `${latency}ms`;
    latencyHistory.push(latency);
    if (latencyHistory.length > 200) latencyHistory.shift();
    drawSpark();

    // Apply action
    if (decision && decision.decision) {
      this.applyDecision(decision);
      if (decision.explain) $taunt.textContent = decision.explain;
    }
  }

  mockDecision(choice) {
    // simple param bands from contract
    const between = (a,b) => a + Math.floor(Math.random()*(b-a+1));
    const speeds = {
      fast: (12 + Math.random()*6) / 10, // 1.2-1.8
      slow: (6 + Math.random()*4) / 10   // 0.6-1.0
    };
    const params = {};
    switch (choice) {
      case "block_left":
      case "block_right":
      case "block_up":
      case "block_down":
      case "feint_then_block_up":
      case "delay_trap":
        params.duration_ms = between(800, 1200);
        break;
      case "spawn_fast_right":
      case "spawn_fast_left":
        params.speed = clamp(speeds.fast, 1.2, 1.6);
        break;
      case "spawn_slow_right":
      case "spawn_slow_left":
        params.speed = clamp(speeds.slow, 0.6, 0.9);
        break;
    }
    return {
      decision: choice,
      params,
      explain: `Mock: ${choice} with ${Object.keys(params).length ? JSON.stringify(params) : "default params"}.`,
      latency_ms: 0
    };
  }

  // ---------- Apply all 10 actions ----------
  applyDecision({ decision, params = {} }) {
    switch (decision) {
      case "block_left":  this.spawnBlock("left", params.duration_ms); break;
      case "block_right": this.spawnBlock("right", params.duration_ms); break;
      case "block_up":    this.spawnBlock("up", params.duration_ms); break;
      case "block_down":  this.spawnBlock("down", params.duration_ms); break;
      case "spawn_fast_right": this.spawnMover("right", params.speed ?? 1.3); break;
      case "spawn_fast_left":  this.spawnMover("left",  params.speed ?? 1.3); break;
      case "spawn_slow_right": this.spawnMover("right", params.speed ?? 0.8); break;
      case "spawn_slow_left":  this.spawnMover("left",  params.speed ?? 0.8); break;
      case "feint_then_block_up": this.feintThenBlockUp(params.duration_ms ?? 1000); break;
      case "delay_trap": this.delayTrap(params.duration_ms ?? 300); break;
      default: break;
    }
  }

  // Blocks: immovable hazards on lane for duration_ms
  spawnBlock(lane, duration_ms = 1000) {
    const pos = this.lanes[lane];
    if (!pos) return;
    const size = lane === "left" || lane === "right" ? { w: 24, h: 120 } : { w: 120, h: 24 };
    const rect = this.add.rectangle(pos.x, pos.y, size.w, size.h, 0xff0040, 0.9);
    this.physics.add.existing(rect, true); // static body
    rect.setData("ttl", this.time.now + duration_ms);
    this.blocks.add(rect);
  }

  // Movers: spawn from left/right edges toward the opposite side
  spawnMover(from, speed = 1.0) {
    const h = this.scale.gameSize.height;
    // Choose a horizontal lane (up or down) randomly for incoming mover path
    const lane = Math.random() < 0.5 ? "up" : "down";
    const y = this.lanes[lane].y;

    const fromLeft = from === "left";
    const xStart = fromLeft ? -30 : this.scale.gameSize.width + 30;
    const xVel = (fromLeft ? 1 : -1) * (120 + 180 * speed); // px/s

    const ob = this.add.rectangle(xStart, y, 30, 18, 0xffff00, 0.9);
    this.physics.add.existing(ob);
    ob.body.setVelocityX(xVel);
    ob.setData("ttl", this.time.now + 5000);
    this.obstacles.add(ob);
  }

  feintThenBlockUp(duration_ms) {
    // Decoy flash on top lane, then real block
    const pos = this.lanes["up"];
    const decoy = this.add.circle(pos.x, pos.y, 10, 0x00ffff, 0.9);
    this.tweens.add({
      targets: decoy,
      alpha: 0.2,
      duration: 200,
      yoyo: true,
      repeat: 2,
      onComplete: () => decoy.destroy()
    });
    this.time.delayedCall(250, () => this.spawnBlock("up", duration_ms));
  }

  delayTrap(duration_ms) {
    // Pause, then briefly block all lanes
    this.time.delayedCall(500, () => {
      ["up","down","left","right"].forEach(l => this.spawnBlock(l, duration_ms));
    });
  }

  // ---------- Death & Restart ----------
  onDeath() {
    if (this.dead) return;
    this.dead = true;

    // Stop future decision ticks
    if (this.decisionTimer) this.decisionTimer.remove(false);

    // Freeze movement
    this.obstacles.getChildren().forEach(o => { o.body?.setVelocity(0); });
    $taunt.textContent = "The Overlord cackles…";

    // Finalize time
    const final = Number(this.currentTime.toFixed(1));
    const best = Math.max(final, this.bestTime);
    this.bestTime = best;
    saveBest(best);

    $final.textContent = final.toFixed(1);
    $best.textContent = best.toFixed(1);

    // Show modal quickly for "fast death" UX
    $death.classList.add("show");

    // Optional: on-death explain call (safer integration path)
    this.onDeathExplain(final).catch(() => {});
  }

  async onDeathExplain(finalTime) {
    if (MOCK_MODE) {
      $taunt.textContent = `Mock: you lasted ${finalTime.toFixed(1)}s. I will toy with you again.`;
      return;
    }
    const payload = {
      player_id: playerId,
      run_id: this.runId,
      tick: this.tick,
      last_move: this.lastMove || "none",
      recent_moves: this.recentMoves,
      session_stats: { best_time: this.bestTime, current_time: finalTime },
      overlord_mode: ($mode?.value || "aggressive")
    };
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch(`${AI_URL}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const json = await res.json();
      if (json?.explain) $taunt.textContent = json.explain;
    } catch {
      $taunt.textContent = "Cerebras: timeout (fallback)";
    } finally {
      clearTimeout(t);
    }
  }
}

// ---------- Boot the game ----------
const parent = document.getElementById("game-canvas");
const WIDTH = parent?.clientWidth || 800;
const HEIGHT = parent?.clientHeight || 600;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-canvas",
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: "#101010",
  physics: { default: "arcade", arcade: { debug: false } },
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [MainScene],
});

// ---- Fix: robust restart handler for the Try Again button ----
window.restartGame = () => {
  // hide death modal
  document.getElementById("death-modal")?.classList.remove("show");

  // if the scene exists, use built-in restart (destroys timers/sprites cleanly)
  const s = game.scene.getScene?.("main") || game.scene.keys?.main;
  if (s && s.scene) {
    s.scene.restart();               // clean reset of create()/update()
  } else {
    // fallback: stop/remove/add
    game.scene.stop("main");
    game.scene.remove("main");
    game.scene.add("main", MainScene, true);
  }

  // refocus canvas so keys work immediately
  game.canvas?.setAttribute("tabindex", "0");
  game.canvas?.focus();
};