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
  }
});

// Keyboard controls
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') game.moveLeft();
  if (e.key === 'ArrowRight') game.moveRight();
});

// Mode selector
document.getElementById('mode-selector').addEventListener('change', (e) => {
  game.setMode(e.target.value);
});

// Retry button
document.getElementById('retry-button').addEventListener('click', () => {
  document.getElementById('death-modal').classList.remove('show');
  game.restart();
});

// Start game
game.start();