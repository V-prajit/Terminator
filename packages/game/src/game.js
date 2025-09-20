import Phaser from "phaser";

// ---------- Config & ENV ----------
const AI_URL = import.meta.env.VITE_AI_SERVER_URL || "http://localhost:8787";
const MOCK_MODE = `${import.meta.env.VITE_MOCK_MODE}`.toLowerCase() === "true";
const CLIENT_TIMEOUT_MS = 450;
const TICK_INTERVAL_MS = 700;

const GRACE_MS = 1200;   // no AI actions for first 1.2s
const INVULN_MS = 500;   // ignore collisions right after start/restart
const SHOT_COOLDOWN_MS = 2000;

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
  const data = latencyHistory.slice(-40);
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(1, max - min);
  const w = c.width, h = c.height;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * (w - 2) + 1;
    const y = h - 1 - ((v - min) / range) * (h - 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
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

// ======================================================
//                    PHASER SCENE
// ======================================================
class MainScene extends Phaser.Scene {
  constructor() {
    super("main");
    this.resetRun();
  }

  init() { this.resetRun(); }

  resetRun() {
    this.runId = uuid();
    this.tick = 0;
    this.survivalStart = 0;
    this.currentTime = 0;
    this.bestTime = loadBest();
    this.lastMove = "none";
    this.recentMoves = [];
    this.dead = false;
    this.nextFireAt = 0;
    this.bullets = null;     // ONLY projectiles
    this.overlord = null;

    this.graceUntil = 0;
    this.invulnUntil = 0;
    this.firstPostGrace = true;
  }

  preload() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });

    // bullet (yellow circle, 16x16)
    g.clear(); g.fillStyle(0xffff00, 1); g.fillCircle(8, 8, 8);
    g.generateTexture("bulletTex", 16, 16);

    // player (white circle, 26x26)
    g.clear(); g.fillStyle(0xffffff, 1); g.fillCircle(13, 13, 13);
    g.generateTexture("playerTex", 26, 26);

    // overlord (green circle, 28x28)
    g.clear(); g.fillStyle(0x00ff66, 1); g.fillCircle(14, 14, 14);
    g.generateTexture("overlordTex", 28, 28);

    // telegraph (cyan, 80x18)
    g.clear(); g.fillStyle(0x00ffff, 0.9); g.fillRect(0, 0, 80, 18);
    g.generateTexture("telegraphTex", 80, 18);

    g.destroy();
  }

  // set lane by index 0..4
  setLane(laneIndex) {
    const idx = Phaser.Math.Clamp(typeof laneIndex === "number" ? laneIndex : this.currentLane, 0, this.lanes.length - 1);
    this.currentLane = idx;
    this.lastMove = String(idx);
    this.recentMoves.push(idx);
    if (this.recentMoves.length > 8) this.recentMoves.shift();

    const pos = this.lanes[idx];
    const dot = this.add.circle(pos.x, pos.y, 5, 0x00ff00, 0.9);
    this.tweens.add({ targets: dot, alpha: 0, duration: 120, onComplete: () => dot.destroy() });
  }

  create() {
    const w = this.scale.gameSize.width;
    const h = this.scale.gameSize.height;

    // Physics group (bullets)
    this.bullets = this.physics.add.group();

    // Arena edges FIRST
    this.arenaLeft  = w * 0.26;
    this.arenaRight = w * 0.74;
    const playerY = h * 0.78;

    // Five lanes 0..4 within arena
    const makeLaneX = (i) => Phaser.Math.Linear(this.arenaLeft, this.arenaRight, (i + 1) / 6);
    this.lanes = Array.from({ length: 5 }, (_, i) => new Phaser.Math.Vector2(makeLaneX(i), playerY));
    this.currentLane = 2; // center

    // Overlord (top center, green)
    this.overlord = this.add.image(w / 2, h * 0.12, "overlordTex");

    // Visual guides
    this.drawGuides(w, h, playerY);

    // Player (white)
    this.player = this.physics.add.image(this.lanes[this.currentLane].x, playerY, "playerTex");
    this.player.setImmovable(true);
    this.player.body.setAllowGravity(false);
    this.player.body.setCircle(13);

    // Collision: bullets kill
    this.physics.add.overlap(this.player, this.bullets, () => {
      if (this.time.now < this.invulnUntil) return;
      this.onDeath();
    }, null, this);

    // Keyboard: ONLY arrow keys
    this.cursors = this.input.keyboard.createCursorKeys();

    // Focus keys
    this.input.keyboard.preventDefault = true;
    this.game.canvas.setAttribute("tabindex", "0");
    this.game.canvas.focus();

    // Start timing/UI
    this.survivalStart = this.time.now;
    this.graceUntil = this.survivalStart + GRACE_MS;
    this.invulnUntil = this.survivalStart + INVULN_MS;
    $time.textContent = "0.0s";
    $taunt.textContent = "Overlord is watching...";
    $latency.textContent = "---";
    $death.classList.remove("show");
    drawSpark();

    // Decision tick
    this.decisionTimer = this.time.addEvent({
      delay: TICK_INTERVAL_MS,
      loop: true,
      callback: () => this.makeDecisionTick()
    });

    // Handle resize: recompute lane anchors & positions
    this.scale.on("resize", (size) => {
      const W = size.width, H = size.height;
      this.arenaLeft  = W * 0.26;
      this.arenaRight = W * 0.74;
      const PY = H * 0.78;
      const makeLaneX = (i) => Phaser.Math.Linear(this.arenaLeft, this.arenaRight, (i + 1) / 6);
      this.lanes.forEach((v, i) => v.set(makeLaneX(i), PY));
      this.overlord.setPosition(W / 2, H * 0.12);
    });
  }

  drawGuides(w, h, playerY) {
    const g = this.add.graphics();

    // Arena box
    g.lineStyle(1, 0x4aa3ff, 0.35);
    g.strokeRect(this.arenaLeft, h * 0.12, this.arenaRight - this.arenaLeft, h * 0.70);

    // Lane separators (5 lanes)
    g.lineStyle(1, 0xff0040, 0.25);
    g.beginPath();
    this.lanes.forEach(v => {
      g.moveTo(v.x, h * 0.12);
      g.lineTo(v.x, h * 0.82);
    });
    g.closePath(); g.strokePath();

    // Player row line
    g.lineStyle(1, 0x999999, 0.2);
    g.beginPath(); g.moveTo(this.arenaLeft, playerY); g.lineTo(this.arenaRight, playerY); g.strokePath();
  }

  update() {
    if (this.dead) return;

    // Arrow keys to move between lane indices
    if (Phaser.Input.Keyboard.JustDown(this.cursors.left)) {
      this.setLane(this.currentLane - 1);
    }
    if (Phaser.Input.Keyboard.JustDown(this.cursors.right)) {
      this.setLane(this.currentLane + 1);
    }

    // Smooth snap along X; Y fixed
    const target = this.lanes[this.currentLane];
    this.player.x += (target.x - this.player.x) * 0.35;

    // Timer
    this.currentTime = (this.time.now - this.survivalStart) / 1000;
    $time.textContent = `${this.currentTime.toFixed(1)}s`;

    // Cleanup
    this.bullets.getChildren().forEach(b => {
      if (b.getData("ttl") && this.time.now > b.getData("ttl")) b.destroy();
      if (b.y > this.scale.gameSize.height + 40) b.destroy();
    });
  }

  fireWithCooldown(fireFn) {
    const now = this.time.now;
    if (now < this.nextFireAt) return false;   // still cooling down
    fireFn();
    this.nextFireAt = now + SHOT_COOLDOWN_MS;
    return true;
  }

  // ---------- Decision Tick ----------
  async makeDecisionTick() {
    if (this.dead) return;
    if (this.time.now < this.graceUntil) return;
    this.tick++;

    const stats = { best_time: this.bestTime, current_time: this.currentTime };
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
    const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

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
        decision = await res.json();
      }
    } catch {
      usedMock = true;
    } finally {
      clearTimeout(timeout);
    }

    if (usedMock) {
      const actions = [
        "block_left","block_right",
        "spawn_fast_left","spawn_fast_right",
        "spawn_slow_left","spawn_slow_right",
        "feint_then_block_up","delay_trap",
        "block_left","block_right"
      ];
      const choice = actions[(this.tick - 1) % actions.length];
      decision = this.mockDecision(choice);
    }

    const latency = Math.round(performance.now() - started);
    $latency.textContent = usedMock ? `${latency}ms (mock)` : `${latency}ms`;
    latencyHistory.push(latency); if (latencyHistory.length > 200) latencyHistory.shift();
    drawSpark();

    if (decision && decision.decision) {
      this.applyDecision(decision);
      if (decision.explain) $taunt.textContent = decision.explain;
    }
  }

  mockDecision(choice) {
    const between = (a,b) => a + Math.floor(Math.random()*(b-a+1));
    const speeds = {
      fast: (12 + Math.random()*6) / 10, // 1.2-1.8
      slow: (6 + Math.random()*4) / 10   // 0.6-1.0
    };
    const params = {};
    switch (choice) {
      case "spawn_fast_left":
      case "spawn_fast_right":
        params.speed = clamp(speeds.fast, 1.2, 1.6); break;
      case "spawn_slow_left":
      case "spawn_slow_right":
        params.speed = clamp(speeds.slow, 0.6, 0.9); break;
      case "feint_then_block_up":
        params.duration_ms = between(800, 1200); break; // unused, but kept for contract parity
      case "delay_trap":
        params.duration_ms = between(300, 400); break;  // unused
      case "block_left":
      case "block_right":
      default:
        params.speed = 1.0; break;
    }
    return {
      decision: choice,
      params,
      explain: `Mock: ${choice} ${Object.keys(params).length ? JSON.stringify(params) : ""}`.trim(),
      latency_ms: 0
    };
  }

  // ---------- Apply actions (bullets only) ----------
  applyDecision({ decision, params = {} }) {
    const speed = params.speed ?? 1.0;
    const L = 0, R = this.lanes.length - 1;

    switch (decision) {
      case "spawn_fast_left":   this.fireWithCooldown(() => this.fireShot(L,  speed)); break;
      case "spawn_fast_right":  this.fireWithCooldown(() => this.fireShot(R,  speed)); break;
      case "spawn_slow_left":   this.fireWithCooldown(() => this.fireShot(L,  speed)); break;
      case "spawn_slow_right":  this.fireWithCooldown(() => this.fireShot(R,  speed)); break;

      case "block_left":        this.fireWithCooldown(() => this.fireShot(L,  1.0));   break;
      case "block_right":       this.fireWithCooldown(() => this.fireShot(R,  1.0));   break;
      case "block_up":          this.fireWithCooldown(() => this.fireShot(this.currentLane, 1.0)); break;
      case "block_down":        this.fireWithCooldown(() => this.fireShot(this.oppositeLaneIndex(), 1.0)); break;

      case "feint_then_block_up": {
        const lane = this.currentLane;
        this.telegraph(lane);
        this.time.delayedCall(250, () => {
          this.fireWithCooldown(() => this.fireShot(lane, 1.1));
        });
        break;
      }

      case "delay_trap":
        this.time.delayedCall(500, () => {
          if (this.fireWithCooldown(() => this.fireShot(L, 0.9))) {
            this.time.delayedCall(60, () => this.fireWithCooldown(() => this.fireShot(R, 0.9)));
          }
        });
        break;
    }
  }

  oppositeLaneIndex() {
    return (this.lanes.length - 1) - this.currentLane; // mirror around center
  }

  // Telegraph flash (cyan) as a warning cue on a lane
  telegraph(laneIndex) {
    const pos = this.lanes[laneIndex];
    const flash = this.add.image(pos.x, pos.y, "telegraphTex").setAlpha(0.9);
    this.tweens.add({
      targets: flash, alpha: 0.15, duration: 200, yoyo: true, repeat: 1,
      onComplete: () => flash.destroy()
    });
  }

  // Fire a shot (yellow bullet) from Overlord to a lane index 0..4
  fireShot(laneIndex, speed = 1.0) {
    const target = this.lanes[laneIndex];
    const startX = this.overlord.x;
    const startY = this.overlord.y + 10;

    const bullet = this.physics.add.image(startX, startY, "bulletTex")
      .setActive(true).setVisible(true);
    bullet.body.setAllowGravity(false);
    bullet.body.setCircle(8);
    bullet.body.moves = true;
    bullet.setData("ttl", this.time.now + 4000);
    this.bullets.add(bullet);

    const vy = 220 + 240 * speed;   // Vertical speed (px/s)
    const dy = (target.y - startY);
    const t  = Math.max(0.001, dy / vy); // seconds to impact
    const dx = (target.x - startX);
    const vx = dx / t;

    bullet.body.setVelocity(vx, vy);

    const puff = this.add.image(startX, startY, "bulletTex").setAlpha(0.9).setScale(0.6);
    this.tweens.add({ targets: puff, alpha: 0, scale: 2, duration: 120, onComplete: () => puff.destroy() });
  }

  // ---------- Death & Restart ----------
  onDeath() {
    if (this.dead) return;
    this.dead = true;

    if (this.decisionTimer) this.decisionTimer.remove(false);
    this.bullets.getChildren().forEach(o => { o.body?.setVelocity(0); });
    $taunt.textContent = "The Overlord cackles…";

    const final = Number(this.currentTime.toFixed(1));
    const best = Math.max(final, this.bestTime);
    this.bestTime = best; saveBest(best);
    $final.textContent = final.toFixed(1);
    $best.textContent = best.toFixed(1);
    $death.classList.add("show");

    this.onDeathExplain(final).catch(() => {});
  }

  async onDeathExplain(finalTime) {
    if (MOCK_MODE) { $taunt.textContent = `Mock: you lasted ${finalTime.toFixed(1)}s. I will toy with you again.`; return; }
    const payload = {
      player_id: playerId, run_id: this.runId, tick: this.tick,
      last_move: this.lastMove || "none", recent_moves: this.recentMoves,
      session_stats: { best_time: this.bestTime, current_time: finalTime },
      overlord_mode: ($mode?.value || "aggressive")
    };
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch(`${AI_URL}/decide`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: controller.signal
      });
      const json = await res.json();
      if (json?.explain) $taunt.textContent = json.explain;
    } catch { $taunt.textContent = "Cerebras: timeout (fallback)"; }
    finally { clearTimeout(t); }
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

// ---- Restart handler for the Try Again button ----
window.restartGame = () => {
  document.getElementById("death-modal")?.classList.remove("show");
  const s = game.scene.getScene?.("main") || game.scene.keys?.main;
  if (s && s.scene) s.scene.restart();
  else {
    game.scene.stop("main");
    game.scene.remove("main");
    game.scene.add("main", MainScene, true);
  }
  game.canvas?.setAttribute("tabindex", "0");
  game.canvas?.focus();
};
