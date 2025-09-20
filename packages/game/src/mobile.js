// mobile.js
import { OverlordGame } from './game.js';

const canvas = document.getElementById('game-canvas');

// Debug function to check canvas state
function debugCanvas() {
  console.log('Canvas element:', canvas);
  console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);
  console.log('Canvas style:', canvas.style.width, 'x', canvas.style.height);
  console.log('Canvas parent:', canvas.parentElement);
  console.log('Parent dimensions:', canvas.parentElement.getBoundingClientRect());

  const ctx = canvas.getContext('2d');
  console.log('Canvas context:', ctx);

  // Test basic rendering
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(10, 10, 50, 50);
  console.log('Test rectangle drawn');
}

// Fix mobile canvas sizing for Safari compatibility
function resizeCanvas() {
  const container = canvas.parentElement;
  const containerRect = container.getBoundingClientRect();

  // Force explicit dimensions for Safari
  const width = Math.floor(containerRect.width);
  const height = Math.floor(containerRect.height);

  // Set canvas display size
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  // Set canvas actual size (Safari prefers integer values)
  canvas.width = width;
  canvas.height = height;

  // Update game dimensions if game exists
  if (window.game) {
    window.game.width = width;
    window.game.height = height;
    window.game.canvas.width = width;
    window.game.canvas.height = height;
  }

  console.log('Canvas resized:', width, 'x', height);
}

// Initial resize
resizeCanvas();

// Resize on orientation change
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => {
  setTimeout(resizeCanvas, 100); // Delay to ensure orientation change is complete
});

// Wait for DOM to be ready and create game
function initGame() {
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();

  // Ensure canvas has proper dimensions before creating game
  canvas.width = Math.floor(rect.width) || 320;
  canvas.height = Math.floor(rect.height) || 480;

  console.log('Initializing game with canvas:', canvas.width, 'x', canvas.height);

  const game = new OverlordGame(canvas, {
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
    document.getElementById('best-time').textContent = data.best.toFixed(1) + 's';
  }
  });

  // Store game globally for resize function
  window.game = game;

  // Start the game
  game.start();

  return game;
}

// Initialize game after a short delay to ensure DOM is ready
let game;

// Run debug first
setTimeout(() => {
  debugCanvas();
}, 50);

setTimeout(() => {
  game = initGame();
}, 100);

// Enhanced touch controls with tap to shoot
let touchStart = null;

function setupTouchControls() {
  if (!canvas || !window.game) {
    setTimeout(setupTouchControls, 100);
    return;
  }

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    touchStart = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now()
    };
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (!touchStart || !window.game) return;

    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    const dt = Date.now() - touchStart.time;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Tap to shoot (short touch with minimal movement)
    if (distance < 30 && dt < 300) {
      window.game.shoot();
    }
    // Horizontal swipe to move
    else if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) && dt < 500) {
      if (dx < 0) window.game.moveLeft();
      else window.game.moveRight();
    }

    touchStart = null;
  }, { passive: false });
}

// Setup touch controls after game is ready
setupTouchControls();

// Prevent scrolling on canvas
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
}, { passive: false });

// Add visual feedback for touches
function addTouchFeedback() {
  canvas.addEventListener('touchstart', (e) => {
    canvas.style.filter = 'brightness(1.1)';
  }, { passive: true });

  canvas.addEventListener('touchend', () => {
    canvas.style.filter = 'brightness(1)';
  }, { passive: true });
}

addTouchFeedback();

// Retry button
document.getElementById('retry-button').addEventListener('click', () => {
  document.getElementById('death-modal').classList.remove('show');
  if (window.game) {
    window.game.restart();
  }
});

// Game is started in initGame function