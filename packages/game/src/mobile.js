// mobile.js
import { OverlordGame } from './game.js';

const canvas = document.getElementById('game-canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight - 120; // Account for UI

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

// Touch controls
let touchStart = null;

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
  if (!touchStart) return;
  
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dt = Date.now() - touchStart.time;
  
  if (Math.abs(dx) > 40 && dt < 300) {
    if (dx < 0) game.moveLeft();
    else game.moveRight();
  }
  
  touchStart = null;
}, { passive: false });

// Button controls
document.querySelectorAll('.swipe-zone').forEach(zone => {
  zone.addEventListener('click', () => {
    const dir = zone.dataset.dir;
    if (dir === 'left') game.moveLeft();
    else if (dir === 'right') game.moveRight();
  });
});

// Retry button
document.getElementById('retry-button').addEventListener('click', () => {
  document.getElementById('death-modal').classList.remove('show');
  game.restart();
});

// Start game
game.start();