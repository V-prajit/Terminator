// desktop.js
import { OverlordGame } from './game.js';

const canvas = document.getElementById('game-canvas');
canvas.width = 480;
canvas.height = 720;

const game = new OverlordGame(canvas, {
  onDeath: (data) => {
    document.getElementById('final-time').textContent = data.time.toFixed(1);
    document.getElementById('final-best').textContent = data.best.toFixed(1);
    document.getElementById('death-modal').classList.add('show');
  },
  onWin: (data) => {
    document.getElementById('final-time').textContent = data.time.toFixed(1);
    document.getElementById('final-best').textContent = data.best.toFixed(1);
    document.getElementById('death-modal').classList.add('show');
    document.querySelector('.death-title').textContent = 'VICTORY!';
    document.querySelector('.death-title').style.color = '#00ff00';
  },
  onTaunt: (message) => {
    document.getElementById('taunt-footer').textContent = message;
  },
  onDebug: (data) => {
    document.getElementById('dbg-predicted').textContent = data.predicted;
    document.getElementById('dbg-lanes').textContent = JSON.stringify(data.lanes);
    document.getElementById('dbg-dirs').textContent = JSON.stringify(data.dirs);
    document.getElementById('dbg-decision').textContent = data.decision;
    document.getElementById('dbg-explain').textContent = data.explain;
    document.getElementById('dbg-challenge').textContent = data.challengeRate + '%';
  },
  onUpdate: (data) => {
    document.getElementById('survival-time').textContent = data.time.toFixed(1) + 's';
    document.getElementById('best-time').textContent = data.best.toFixed(1) + 's';

    // Update boss health if available
    if (data.bossHealth !== undefined && data.bossMaxHealth !== undefined) {
      const healthPercent = (data.bossHealth / data.bossMaxHealth * 100).toFixed(0);
      document.getElementById('boss-health').textContent = `Boss: ${healthPercent}%`;
    }

    // Update ammo with color coding
    if (data.ammo !== undefined) {
      const ammoCount = document.getElementById('ammo-count');
      const ammoDisplay = document.getElementById('ammo-display');

      ammoCount.textContent = data.ammo;

      // Color code based on ammo remaining
      if (data.ammo >= 7) {
        ammoDisplay.style.color = '#00ff00'; // Green (safe)
      } else if (data.ammo >= 3) {
        ammoDisplay.style.color = '#ffff00'; // Yellow (warning)
      } else if (data.ammo > 0) {
        ammoDisplay.style.color = '#ff8800'; // Orange (critical)
      } else {
        ammoDisplay.style.color = '#ff0000'; // Red (empty)
      }
    }
  }
});

// Keyboard controls
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') game.moveLeft();
  if (e.key === 'ArrowRight') game.moveRight();
  if (e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault(); // Prevent page scrolling
    game.shoot();
  }
});

// Mode selector
document.getElementById('mode-selector').addEventListener('change', (e) => {
  game.setMode(e.target.value);
});

// Retry button
document.getElementById('retry-button').addEventListener('click', () => {
  document.getElementById('death-modal').classList.remove('show');
  // Reset modal text
  document.querySelector('.death-title').textContent = 'GAME OVER';
  document.querySelector('.death-title').style.color = '#ff0040';
  game.restart();
});

// Start game
game.start();