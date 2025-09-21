// ======================= src/mobile.js =======================
// Backend base (Tailscale IP). You can override with ?ai=<base> in the URL.
// ===== Single-origin fetch rewriter (default) =====
(function resolveAIBase(){
  const p = new URLSearchParams(location.search);
  // Default to SAME ORIGIN (empty base). If ?ai=<url> is provided (e.g. tunnel), use it.
  const param = p.get('ai');
  const AI_BASE = param || '';
  window.__AI_BASE__ = AI_BASE;

  // Rewrite any hardcoded localhost:8787 → AI_BASE, and prefix relative paths with AI_BASE.
  const reLocal = /^http:\/\/(localhost|127\.0\.0\.1):8787\b/;
  const origFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    if (typeof input === 'string') {
      if (input.startsWith('/')) input = AI_BASE + input;
      else if (reLocal.test(input)) input = input.replace(reLocal, AI_BASE);
    } else if (input && input.url) {
      const u = input.url.startsWith('/') ? (AI_BASE + input.url)
              : reLocal.test(input.url)    ? input.url.replace(reLocal, AI_BASE)
              : input.url;
      input = new Request(u, input);
    }
    return origFetch(input, init);
  };

  // Optional quick ping for debugging
  origFetch((AI_BASE || '') + '/health')
    .then(r => r.text()).then(t => console.log('[mobile] /health:', t.slice(0,120)+'...'))
    .catch(e => console.warn('[mobile] backend unreachable:', e));
})();

// ===== UUID polyfill (safe; doesn't reassign window.crypto) =====
(function installUUIDPolyfill(){
  const g = typeof globalThis !== 'undefined' ? globalThis : window;
  if (g.crypto && typeof g.crypto.randomUUID === 'function') return;

  const getRandomValues = (g.crypto && g.crypto.getRandomValues)
    ? g.crypto.getRandomValues.bind(g.crypto)
    : (buf) => { for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() * 256) | 0; return buf; };

  const randomUUID = () => {
    const b = new Uint8Array(16);
    getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; // v4
    b[8] = (b[8] & 0x3f) | 0x80; // variant
    const h = (n)=>n.toString(16).padStart(2,'0');
    const s=[...b].map(h).join('');
    return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
  };

  if (g.crypto && !g.crypto.randomUUID) {
    try { Object.defineProperty(g.crypto, 'randomUUID', { value: randomUUID, configurable: true }); } catch {}
  }
  if (!g.randomUUID) g.randomUUID = randomUUID;
})();

// ===== Lazy-load the game AFTER polyfills are in place =====
let OverlordGameCtor; // filled by dynamic import
let MultiplayerClientCtor; // filled by dynamic import

// ===== Mobile constants =====
const DPR = Math.min(window.devicePixelRatio || 1, 2); // cap for perf
const SWIPE_MIN_PX = 40;
const TAP_MAX_PX   = 28;
const TAP_MAX_MS   = 300;

let canvas;
let game;
let touchStart = null;
let multiplayerClient = null;

// ---- Canvas sizing (CSS vs backing store with DPR) ----
function sizeCanvasToContainer() {
  const container = canvas.parentElement || document.body;
  const rect = container.getBoundingClientRect();

  // Simple approach - use window dimensions on iOS Safari
  const isIOSSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const cssW = isIOSSafari ? window.innerWidth : Math.max(1, Math.floor(rect.width));
  const cssH = isIOSSafari ? window.innerHeight : Math.max(1, Math.floor(rect.height));

  // CSS size (logical points)
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';

  // Backing store size (physical pixels)
  canvas.width  = Math.floor(cssW * DPR);
  canvas.height = Math.floor(cssH * DPR);

  if (game) {
    game.width = cssW;
    game.height = cssH;
    if (game.canvas) {
      game.canvas.width  = canvas.width;
      game.canvas.height = canvas.height;
    }
    if (game.ctx && game.ctx.setTransform) {
      game.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    game.onResize?.(cssW, cssH, DPR);
  }
  console.log('[mobile] canvas sized:', cssW, 'x', cssH, '(css)  DPR=', DPR);
}

// ---- Debug helper (draws a small red square) ----
function debugCanvas() {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(10 * DPR, 10 * DPR, 50 * DPR, 50 * DPR);
  console.log('[mobile] drew debug rect @ DPR=', DPR);
}

// ---- Touch controls (non-passive so preventDefault works on iOS) ----
function setupTouchControls() {
  ['touchstart','touchmove','touchend','touchcancel','pointerdown','pointermove','pointerup']
    .forEach(evt => window.addEventListener(evt, () => {}, { passive: false }));

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (!touchStart || !game) return;
    const t   = e.changedTouches[0];
    const dx  = t.clientX - touchStart.x;
    const dy  = t.clientY - touchStart.y;
    const dt  = performance.now() - touchStart.t;
    const ax  = Math.abs(dx), ay = Math.abs(dy);

    if (ax < TAP_MAX_PX && ay < TAP_MAX_PX && dt < TAP_MAX_MS) {
      game.shoot?.();

      // Send shoot action to multiplayer
      if (multiplayerClient?.isInMultiplayerMode()) {
        multiplayerClient.sendPlayerMove({
          action: 'shoot',
          lane: game.state?.playerLane || 2
        });
      }
    } else if (ax > SWIPE_MIN_PX && ax > ay && dt < 500) {
      const direction = dx < 0 ? 'left' : 'right';
      const oldLane = game.state?.playerLane || 2;

      if (direction === 'left') {
        game.moveLeft?.();
      } else {
        game.moveRight?.();
      }

      // Send movement to multiplayer
      if (multiplayerClient?.isInMultiplayerMode()) {
        const newLane = game.state?.playerLane || 2;
        multiplayerClient.sendPlayerMove({
          action: 'move',
          direction: direction,
          fromLane: oldLane,
          toLane: newLane,
          lane: newLane
        });
      }
    }
    touchStart = null;
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  canvas.addEventListener('touchstart', () => { canvas.style.filter = 'brightness(1.06)'; }, { passive: true });
  canvas.addEventListener('touchend',   () => { canvas.style.filter = 'brightness(1)';    }, { passive: true });
}

// ---- iOS audio unlock ----
function unlockAudioOnce() {
  const tryResume = () => {
    const ctx = window.__audioCtx || (game && game.audioCtx);
    if (ctx && ctx.state !== 'running') ctx.resume?.().catch(()=>{});
    ['touchstart','pointerdown','mousedown','keydown'].forEach(evt =>
      window.removeEventListener(evt, tryResume, true)
    );
  };
  ['touchstart','pointerdown','mousedown','keydown'].forEach(evt =>
    window.addEventListener(evt, tryResume, true)
  );
}

// ---- Robust start hooks ----
function startGameIfNeeded() {
  if (!game) return;
  if (!game.__started) {
    game.__started = true;
    console.log('[mobile] starting game due to user gesture');
    game.start?.();
  }
}

// Start the game after name entry is complete
function startGameAfterNameEntry() {
  if (!game) {
    console.warn('[mobile] Cannot start game - game not initialized');
    return;
  }
  if (!game.__started) {
    game.__started = true;
    console.log('[mobile] Starting game after name entry completion');
    game.start?.();
  } else {
    console.log('[mobile] Game already started');
  }
}

// Make the function globally available
window.startGameAfterNameEntry = startGameAfterNameEntry;

function hookReadyBar() {
  const candidates = Array.from(document.querySelectorAll('button, .btn, [role="button"], .bar, .banner, .status, .cta, div, span'));
  const readyEl = candidates.find(el => (el.textContent || '').trim().toLowerCase().includes('ready to play'));
  if (!readyEl) return;
  ['touchend','click'].forEach(evt => {
    readyEl.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      startGameIfNeeded();
    }, { passive: false });
  });
}

// ---- On-screen error overlay ----
function installErrorOverlay() {
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', left: '8px', bottom: '8px',
    maxWidth: '90vw', padding: '8px 10px', fontFamily: 'monospace',
    fontSize: '12px', color: '#ffb3b3', background: 'rgba(60,0,0,0.7)',
    border: '1px solid #ff5a5a', borderRadius: '6px', zIndex: 99999,
    display: 'none', whiteSpace: 'pre-wrap', pointerEvents: 'none'
  });
  box.id = 'error-overlay';
  document.body.appendChild(box);
  const show = (msg) => { box.textContent = msg; box.style.display = 'block'; };
  window.addEventListener('error', (e) => show('[error] ' + (e.message || e.error)));
  window.addEventListener('unhandledrejection', (e) =>
    show('[promise] ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)))
  );
}

// ---- Game init ----
async function initGame() {
  if (!OverlordGameCtor) {
    const mod = await import('./game.js'); // your class exports OverlordGame
    OverlordGameCtor = mod.OverlordGame;
  }

  if (!MultiplayerClientCtor) {
    const mod = await import('./multiplayer-client.js');
    MultiplayerClientCtor = mod.MultiplayerClient;
  }

  // Function to record game session to player history
  async function recordGameToHistory(deathData) {
    try {
      // Get player info from either multiplayer or single-player
      let playerId, playerName;

      const connectionInfo = multiplayerClient?.getConnectionInfo();
      console.log('[mobile] Connection info:', connectionInfo);

      if (connectionInfo && connectionInfo.playerId) {
        // Multiplayer mode
        playerId = connectionInfo.playerId;
        playerName = connectionInfo.playerName;
        console.log('[mobile] Recording multiplayer game for:', playerName, playerId);
      } else {
        // Single-player mode - use game state player ID and name from multiplayer client
        if (game && game.state && game.state.playerId) {
          playerId = game.state.playerId;
          // Use the name from multiplayer client if available, otherwise default
          playerName = connectionInfo?.playerName || multiplayerClient?.playerName || 'Player';
          console.log('[mobile] Recording single-player game for:', playerName, playerId);
        } else {
          console.log('[mobile] No player ID available, skipping history recording');
          return;
        }
      }

      // Prepare game data for history recording
      const gameData = {
        survivalTime: deathData.time,
        deathCause: deathData.deathCause || 'unknown',
        deathLane: deathData.deathLane || -1,
        movementPattern: deathData.movementPattern || [],
        gamePhase: deathData.gamePhase || 'unknown',
        bulletCount: deathData.bulletCount || 1,
        finalScore: deathData.finalScore || deathData.time,
        collisionData: deathData.collisionData,
        aiDecisions: deathData.lastAiDecision ? [deathData.lastAiDecision] : [],
        playerName: playerName
      };

      const payload = {
        playerId: playerId,
        playerName: playerName,
        gameData: gameData
      };

      console.log('[mobile] Recording game session:', payload);

      // Determine the correct AI server URL
      let serverUrl;
      if (window.location.host.includes('ngrok') || !window.location.host.includes(':')) {
        // Production/ngrok mode - use localhost AI server directly
        serverUrl = 'http://localhost:8787';
      } else if (window.location.host.includes(':')) {
        // Local development mode - use localhost AI server
        const [hostname] = window.location.host.split(':');
        serverUrl = `http://${hostname}:8787`;
      } else {
        // Fallback - use relative path
        serverUrl = '';
      }

      const recordUrl = serverUrl ? `${serverUrl}/record-game` : '/record-game';
      console.log('[mobile] Recording to URL:', recordUrl);

      const response = await fetch(recordUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const result = await response.json();
        console.log('[mobile] Game session recorded successfully:', result.playerSummary);
      } else {
        console.error('[mobile] Failed to record game session:', response.status);
      }
    } catch (error) {
      console.error('[mobile] Error recording game session:', error);
    }
  }

  // Initialize multiplayer client
  multiplayerClient = new MultiplayerClientCtor();

  // Throttling for WebSocket updates
  let lastMultiplayerUpdate = 0;
  const MULTIPLAYER_UPDATE_INTERVAL = 500; // 500ms = 2 updates per second max

  // Set up multiplayer callbacks
  multiplayerClient.setCallbacks({
    onConnected: () => {
      console.log('[mobile] Multiplayer connected');
    },
    onRoomJoined: (data) => {
      console.log('[mobile] Joined multiplayer room:', data);
    },
    onGameStart: (data) => {
      console.log('[mobile] Multiplayer game started:', data);
    },
    onError: (error) => {
      console.error('[mobile] Multiplayer error:', error);
    }
  });

  sizeCanvasToContainer();
  console.log('[mobile] init OverlordGame', { backing: [canvas.width, canvas.height], DPR });

  game = new OverlordGameCtor(canvas, {
    // Player info provider for personalized taunts
    getPlayerInfo: () => {
      const isMultiplayer = multiplayerClient?.isInMultiplayerMode();
      console.log('[mobile] getPlayerInfo called - isMultiplayer:', isMultiplayer);

      if (isMultiplayer) {
        const info = multiplayerClient.getConnectionInfo();
        console.log('[mobile] getPlayerInfo returning:', info);
        return info;
      }
      console.log('[mobile] getPlayerInfo returning null (not multiplayer)');
      return null;
    },

    onDeath: (data) => {
      document.getElementById('final-time').textContent = data.time.toFixed(1);
      document.getElementById('final-best').textContent = data.best.toFixed(1);
      document.getElementById('death-modal').classList.add('show');

      // Send death event to multiplayer
      if (multiplayerClient?.isInMultiplayerMode()) {
        multiplayerClient.sendPlayerUpdate({
          event: 'death',
          survivalTime: data.time,
          bestTime: data.best
        });
      }

      // Record game session to player history (for both single and multiplayer)
      recordGameToHistory(data);
    },
    onWin: (data) => {
      // Show win modal
      document.getElementById('win-time').textContent = data.time.toFixed(1);
      document.getElementById('win-best').textContent = data.best.toFixed(1);
      document.getElementById('win-modal').classList.add('show');

      // Send win event to multiplayer
      if (multiplayerClient?.isInMultiplayerMode()) {
        multiplayerClient.sendPlayerUpdate({
          event: 'win',
          survivalTime: data.time,
          bestTime: data.best
        });
      }
    },
    onTaunt: (message) => {
      document.getElementById('taunt-overlay').textContent = message;
    },
    onDebug: (data) => {
      // Relay AI decisions to multiplayer dashboard
      if (multiplayerClient?.isInMultiplayerMode()) {
        multiplayerClient.sendMessage('ai_decision_relay', {
          decision: data.decision,
          explain: data.explain,
          lanes: data.lanes,
          rtt: data.rtt,
          playerId: multiplayerClient.getPlayerId(),
          timestamp: Date.now()
        });
      }
    },
    onUpdate: (data) => {
      document.getElementById('survival-time').textContent = data.time.toFixed(1) + 's';
      document.getElementById('best-time').textContent     = data.best.toFixed(1) + 's';

      // Throttle multiplayer updates to prevent spam
      const now = Date.now();
      if (multiplayerClient?.isInMultiplayerMode() && (now - lastMultiplayerUpdate) >= MULTIPLAYER_UPDATE_INTERVAL) {
        lastMultiplayerUpdate = now;

        // Basic stats update (throttled)
        multiplayerClient.sendPlayerUpdate({
          time: data.time,
          best: data.best,
          lane: game.state?.playerLane || 2,
          ammo: data.ammo
        });

        // Full game state for real-time mirroring (throttled)
        if (game.state) {
          const gameStateData = {
            playerPosition: {
              x: game.getLaneX(game.state.playerLane),
              y: game.getLaneY(),
              lane: game.state.playerLane || 2
            },
            bullets: game.state.bullets || [],
            gameTime: data.time,
            score: data.best,
            ammo: data.ammo,
            phase: game.state.phase || 'beginner'
          };

          multiplayerClient.sendGameState(gameStateData);
        }
      }
    }
  });

  if (game.ctx && game.ctx.setTransform) {
    game.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  window.game = game;

  setupTouchControls();
  unlockAudioOnce();

  // Initialize game with sprites
  try {
    await game.init?.();
  } catch (error) {
    console.error('Failed to initialize game sprites:', error);
  }

  // Don't start game immediately - wait for name entry completion
  console.log('[mobile] Game initialized, waiting for name entry completion');
}

// ---- Boot ----
function boot() {
  canvas = document.getElementById('game-canvas');
  if (!canvas) {
    console.warn('[mobile] #game-canvas not found; retrying...');
    setTimeout(boot, 30);
    return;
  }

  sizeCanvasToContainer();
  setTimeout(debugCanvas, 50);

  // iOS Safari viewport fix - trigger resize on first meaningful interaction
  let hasResized = false;
  const triggerResize = () => {
    if (!hasResized) {
      hasResized = true;
      setTimeout(sizeCanvasToContainer, 50);
      setTimeout(sizeCanvasToContainer, 200);
    }
  };

  window.addEventListener('resize',           () => setTimeout(sizeCanvasToContainer, 50),  { passive: true });
  window.addEventListener('orientationchange',() => setTimeout(sizeCanvasToContainer, 100), { passive: true });

  // Trigger resize on user interaction (fixes Safari zoom issue)
  ['touchstart', 'touchend', 'scroll', 'focus'].forEach(evt => {
    window.addEventListener(evt, triggerResize, { once: true, passive: true });
  });

  installErrorOverlay();
  hookReadyBar();

  ['touchend','pointerup','mousedown','keydown'].forEach(evt => {
    window.addEventListener(evt, startGameIfNeeded, { once: true, passive: false, capture: true });
  });
  ['touchend','pointerup','mousedown'].forEach(evt => {
    canvas.addEventListener(evt, startGameIfNeeded, { passive: false });
  });

  const retryBtn = document.getElementById('retry-button');
  retryBtn?.addEventListener('click', () => {
    document.getElementById('death-modal')?.classList.remove('show');
    game?.restart?.();
    game.__started = true;
  });

  const playAgainBtn = document.getElementById('play-again-button');
  playAgainBtn?.addEventListener('click', () => {
    document.getElementById('win-modal')?.classList.remove('show');
    game?.restart?.();
    game.__started = true;
  });

  setTimeout(() => { initGame().catch(console.error); }, 80);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
// ===================== end src/mobile.js =====================
