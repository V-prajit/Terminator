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

// ===== Mobile constants =====
const DPR = Math.min(window.devicePixelRatio || 1, 2); // cap for perf
const SWIPE_MIN_PX = 40;
const TAP_MAX_PX   = 28;
const TAP_MAX_MS   = 300;

let canvas;
let game;
let touchStart = null;

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
    } else if (ax > SWIPE_MIN_PX && ax > ay && dt < 500) {
      dx < 0 ? game.moveLeft?.() : game.moveRight?.();
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

  sizeCanvasToContainer();
  console.log('[mobile] init OverlordGame', { backing: [canvas.width, canvas.height], DPR });

  game = new OverlordGameCtor(canvas, {
    onDeath: (data) => {
      document.getElementById('final-time').textContent = data.time.toFixed(1);
      document.getElementById('final-best').textContent = data.best.toFixed(1);
      document.getElementById('death-modal').classList.add('show');
    },
    onTaunt: (message) => {
      document.getElementById('taunt-overlay').textContent = message;
    },
    onUpdate: (data) => {
      document.getElementById('survival-time').textContent = data.time.toFixed(1) + 's';
      document.getElementById('best-time').textContent     = data.best.toFixed(1) + 's';
    }
  });

  if (game.ctx && game.ctx.setTransform) {
    game.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  window.game = game;

  setupTouchControls();
  unlockAudioOnce();

  game.start?.();
  game.__started = true;
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

  setTimeout(() => { initGame().catch(console.error); }, 80);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
// ===================== end src/mobile.js =====================
