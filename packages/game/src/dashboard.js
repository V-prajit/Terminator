// dashboard.js - Dynamic multiplayer dashboard with smooth animations
import { OverlordGame } from './game.js';
import QRGenerator from './qr-generator.js';

class DashboardAnimator {
  constructor() {
    this.isTransitioning = false;
    this.transitionDuration = 2500; // 2.5 seconds for full transition
  }

  async transitionToDualPlayer() {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    const dashboard = document.getElementById('dashboard');
    const player2Container = document.getElementById('player2-container');
    const agentDebate = document.querySelector('.agent-debate');
    const sidebar = document.querySelector('.sidebar');

    try {
      // Step 1: Show "Player 2 Connecting..." notification (0.0s - 0.3s)
      this.showConnectionNotification();
      await this.delay(300);

      // Step 2: Start player 1 scale down and player 2 slide in (0.3s - 1.1s)
      dashboard.classList.add('dual-player');

      // Step 3: Wait for CSS transitions to complete (1.1s - 1.7s)
      await this.delay(800);

      // Step 4: Expand agent debate and update sidebar (1.7s - 2.2s)
      this.expandDebateArea();
      await this.delay(500);

      // Step 5: Show success notification (2.2s - 2.5s)
      this.showSuccessNotification();
      await this.delay(300);

      // Animation complete
      this.isTransitioning = false;
      this.onTransitionComplete();

    } catch (error) {
      console.error('Transition error:', error);
      this.isTransitioning = false;
    }
  }

  showConnectionNotification() {
    const notification = this.createNotification('🔗 Player 2 Connecting...', 'info');
    this.showNotification(notification);
  }

  showSuccessNotification() {
    const notification = this.createNotification('✅ Dual Player Mode Active!', 'success');
    this.showNotification(notification);
  }

  createNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-message">${message}</span>
      </div>
    `;

    // Add notification styles
    Object.assign(notification.style, {
      position: 'fixed',
      top: '100px',
      right: '30px',
      padding: '15px 25px',
      background: type === 'success' ? 'rgba(0, 255, 0, 0.2)' : 'rgba(0, 255, 255, 0.2)',
      border: `1px solid ${type === 'success' ? '#00ff00' : '#00ffff'}`,
      borderRadius: '10px',
      color: '#ffffff',
      fontFamily: 'monospace',
      fontSize: '14px',
      zIndex: '1000',
      transform: 'translateX(100%)',
      transition: 'transform 0.5s ease-out',
      backdropFilter: 'blur(10px)'
    });

    return notification;
  }

  showNotification(notification) {
    document.body.appendChild(notification);

    // Trigger slide in
    setTimeout(() => {
      notification.style.transform = 'translateX(0)';
    }, 50);

    // Auto remove after 3 seconds
    setTimeout(() => {
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 500);
    }, 3000);
  }

  expandDebateArea() {
    const debateContent = document.querySelector('.debate-content');
    const joinInstructions = document.querySelector('.join-instructions');

    // Update join instructions
    if (joinInstructions) {
      joinInstructions.innerHTML = `
        <strong style="color: #00ff00;">Both Players Connected!</strong><br>
        Watching live AI coordination between players
      `;
    }

    // Add expansion effect
    debateContent.style.background = 'linear-gradient(135deg, rgba(255, 0, 64, 0.05), rgba(0, 255, 255, 0.05))';
  }

  onTransitionComplete() {
    // Fire events or callbacks when transition is done
    console.log('Dashboard transition to dual-player mode complete');

    // Show success indicator
    this.showSuccessIndicator('🎮 DUAL PLAYER MODE ACTIVATED!');

    // Add demo mode visual enhancements
    document.body.classList.add('demo-mode');

    // Update any UI elements that need to know about the transition
    const event = new CustomEvent('dashboardTransitionComplete', {
      detail: { mode: 'dual-player' }
    });
    document.dispatchEvent(event);
  }

  showSuccessIndicator(message) {
    const indicator = document.createElement('div');
    indicator.className = 'success-indicator';
    indicator.textContent = message;

    document.body.appendChild(indicator);

    // Auto remove after animation
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    }, 2000);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class DashboardController {
  constructor() {
    this.animator = new DashboardAnimator();
    this.players = new Map();
    this.roomId = this.generateRoomId();
    this.websocket = null;
    this.isConnected = false;
    this.qrGenerator = new QRGenerator();

    this.agentDebateMessages = [];
    this.aiDecisions = [];

    this.init();
  }

  generateRoomId() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
  }

  init() {
    this.setupBackgroundParticles();
    this.setupWebSocket();
    this.setupUI();
    this.setupGameCanvases();
    this.startDebateSimulation();

    // Update room ID in UI
    document.getElementById('room-id').textContent = `ROOM: ${this.roomId}`;

    // Update join instructions for zero-player state
    this.updateJoinInstructions();

    console.log('Dashboard initialized for room:', this.roomId);
  }

  setupBackgroundParticles() {
    const particlesContainer = document.getElementById('particles');
    const particleCount = 20;

    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';

      // Random positioning and sizing
      const size = Math.random() * 4 + 2;
      particle.style.width = size + 'px';
      particle.style.height = size + 'px';
      particle.style.left = Math.random() * 100 + '%';
      particle.style.top = Math.random() * 100 + '%';
      particle.style.animationDelay = Math.random() * 6 + 's';
      particle.style.animationDuration = (Math.random() * 4 + 4) + 's';

      particlesContainer.appendChild(particle);
    }
  }

  setupWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    console.log('Connecting to WebSocket:', wsUrl);

    try {
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('WebSocket connected');
        this.isConnected = true;
        this.updateConnectionStatus('Connected', true);

        // Join as dashboard
        this.sendMessage('join_as_dashboard', {});
      };

      this.websocket.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };

      this.websocket.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        this.isConnected = false;
        this.updateConnectionStatus('Disconnected', false);

        // Attempt to reconnect after 3 seconds
        setTimeout(() => {
          this.setupWebSocket();
        }, 3000);
      };

      this.websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.updateConnectionStatus('Error', false);
      };

    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.simulateConnection(); // Fallback to simulation
    }
  }

  sendMessage(type, payload) {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }

  handleWebSocketMessage(event) {
    try {
      const message = JSON.parse(event.data);
      const { type, data } = message;

      switch (type) {
        case 'welcome':
          console.log('Welcome message received:', data);
          break;

        case 'dashboard_ready':
          console.log('Dashboard ready:', data);
          this.roomId = data.roomId;
          this.updateRoomId(data.roomId);
          this.updateQRCode();
          break;

        case 'player_joined':
          console.log('Player joined:', data);
          this.onPlayerJoin(data.playerId);
          break;

        case 'player_left':
          console.log('Player left:', data);
          this.onPlayerLeave(data.playerId);
          break;

        case 'player_move':
          console.log('Player move:', data);
          this.onPlayerMove(data.playerId, data);
          break;

        case 'ai_decision':
          console.log('AI decision:', data);
          this.onAIDecision(data);
          break;

        case 'agent_debate':
          console.log('Agent debate:', data);
          this.onAgentDebate(data);
          break;

        case 'game_state_update':
          console.log('Game state update:', data);
          this.onGameStateUpdate(data);
          break;

        case 'room_state':
          console.log('Room state update:', data);
          this.updateRoomState(data);
          break;

        case 'error':
          console.error('WebSocket error:', data);
          break;

        default:
          console.log('Unknown message type:', type, data);
      }

    } catch (error) {
      console.error('Failed to parse WebSocket message:', error, event.data);
    }
  }

  simulateConnection() {
    // Simulate connection for demo purposes when WebSocket is not available
    setTimeout(() => {
      this.isConnected = true;
      this.updateConnectionStatus('Connected (Simulated)', true);
    }, 1000);

    // Don't auto-simulate players joining - wait for actual QR code connections
    // Players will only appear when they actually connect through QR codes
  }

  setupUI() {
    // Generate QR code placeholder
    this.updateQRCode();

    // Setup debug controls for testing
    this.setupDebugControls();

    // Setup demo mode enhancements
    this.setupDemoMode();
  }

  setupDebugControls() {
    // Add hidden debug controls for testing
    const debugPanel = document.createElement('div');
    debugPanel.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      padding: 10px;
      background: rgba(0, 0, 0, 0.8);
      border: 1px solid #333;
      border-radius: 5px;
      z-index: 1000;
      font-family: monospace;
      font-size: 12px;
      display: none;
    `;

    debugPanel.innerHTML = `
      <div style="color: #fff; margin-bottom: 10px;">Debug Controls</div>
      <button id="debug-join-p2" style="margin: 2px; padding: 5px 10px;">Simulate P2 Join</button>
      <button id="debug-add-debate" style="margin: 2px; padding: 5px 10px;">Add Debate</button>
      <button id="debug-add-decision" style="margin: 2px; padding: 5px 10px;">Add Decision</button>
    `;

    document.body.appendChild(debugPanel);

    // Show debug panel on key press (D key)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'D' && e.shiftKey) {
        debugPanel.style.display = debugPanel.style.display === 'none' ? 'block' : 'none';
      }
    });

    // Debug button handlers
    document.getElementById('debug-join-p2').onclick = () => this.onPlayerJoin('player2');
    document.getElementById('debug-add-debate').onclick = () => this.simulateDebateMessage();
    document.getElementById('debug-add-decision').onclick = () => this.simulateAIDecision();
  }

  setupGameCanvases() {
    // Show waiting state in both player containers initially
    this.showPlayerWaitingState('player1');
    this.showPlayerWaitingState('player2');
  }

  setupPlayerGame(playerId, canvas) {
    try {
      // For dashboard, we don't run an independent game - we create a spectator renderer
      const spectatorRenderer = {
        canvas: canvas,
        ctx: canvas.getContext('2d'),
        lastGameState: null,

        render: function(gameState) {
          if (!this.ctx || !gameState) return;

          // Clear canvas
          this.ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Render background
          this.ctx.fillStyle = '#0a0a0a';
          this.ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Render lanes
          this.renderLanes();

          // Render player
          if (gameState.playerPosition) {
            this.renderPlayer(gameState.playerPosition);
          }

          // Render bullets
          if (gameState.bullets && gameState.bullets.length > 0) {
            this.renderBullets(gameState.bullets);
          }

          // Render enemies
          if (gameState.enemies && gameState.enemies.length > 0) {
            this.renderEnemies(gameState.enemies);
          }
        },

        renderLanes: function() {
          const laneWidth = canvas.width / 5;
          this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
          this.ctx.lineWidth = 1;

          for (let i = 1; i < 5; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo(i * laneWidth, 0);
            this.ctx.lineTo(i * laneWidth, canvas.height);
            this.ctx.stroke();
          }
        },

        renderPlayer: function(playerPos) {
          const laneWidth = canvas.width / 5;
          const x = (playerPos.lane * laneWidth) + (laneWidth / 2);
          const y = canvas.height - 60;

          this.ctx.fillStyle = '#00ffff';
          this.ctx.fillRect(x - 15, y - 15, 30, 30);
        },

        renderBullets: function(bullets) {
          this.ctx.fillStyle = '#ff0040';
          bullets.forEach(bullet => {
            if (bullet.x !== undefined && bullet.y !== undefined) {
              this.ctx.fillRect(bullet.x - 3, bullet.y - 3, 6, 6);
            }
          });
        },

        renderEnemies: function(enemies) {
          this.ctx.fillStyle = '#ffaa00';
          enemies.forEach(enemy => {
            if (enemy.x !== undefined && enemy.y !== undefined) {
              this.ctx.fillRect(enemy.x - 10, enemy.y - 10, 20, 20);
            }
          });
        }
      };

      this.players.set(playerId, {
        spectatorRenderer,
        canvas,
        stats: { time: 0, best: 0, lane: 2 },
        connected: true,
        actualPlayerId: null,
        isSpectator: true
      });

    } catch (error) {
      console.error(`Failed to setup spectator for ${playerId}:`, error);
    }
  }

  updateConnectionStatus(text, connected) {
    const statusText = document.getElementById('connection-text');
    const statusDot = document.querySelector('.status-dot');

    if (statusText) statusText.textContent = text;
    if (statusDot) {
      statusDot.style.background = connected ? '#00ff00' : '#ff0000';
    }
  }

  updateQRCode() {
    const qrCodeContainer = document.getElementById('qr-code');
    if (!qrCodeContainer) return;

    const { element } = this.qrGenerator.generateDashboardQR(this.roomId);
    qrCodeContainer.innerHTML = '';
    qrCodeContainer.appendChild(element);
  }

  updateRoomId(newRoomId) {
    this.roomId = newRoomId;
    const roomIdElement = document.getElementById('room-id');
    if (roomIdElement) {
      roomIdElement.textContent = `ROOM: ${newRoomId}`;
    }
  }

  onPlayerLeave(playerId) {
    console.log(`Player ${playerId} left the room`);

    // Find which player slot this actual player ID was using
    let playerSlot = null;
    this.players.forEach((player, slot) => {
      if (player.actualPlayerId === playerId) {
        playerSlot = slot;
      }
    });

    if (playerSlot) {
      const player = this.players.get(playerSlot);
      if (player) {
        player.connected = false;
        player.actualPlayerId = null;
        this.updatePlayerConnection(playerSlot, false);

        // Stop the spectator renderer
        if (player.spectatorRenderer) {
          player.spectatorRenderer.lastGameState = null;
        }

        // Show waiting state for this slot
        this.showPlayerWaitingState(playerSlot);

        // Remove from players map
        this.players.delete(playerSlot);
      }

      // Check remaining connected players
      const connectedCount = this.getConnectedPlayerCount();
      if (connectedCount <= 1) {
        // Exit dual player mode
        const dashboard = document.getElementById('dashboard');
        dashboard.classList.remove('dual-player');
      }

      // Update join instructions
      this.updateJoinInstructions();
    }
  }

  onPlayerMove(playerId, moveData) {
    const player = this.players.get(playerId);
    if (!player) return;

    // Update player stats
    player.stats = { ...player.stats, ...moveData };

    // Update UI
    this.onPlayerUpdate(playerId, moveData);
  }

  onAIDecision(decisionData) {
    // Add to AI decisions panel
    this.addAIDecision({
      playerId: decisionData.playerId || 'system',
      decision: decisionData.decision,
      explain: decisionData.explain,
      lanes: decisionData.params?.lanes,
      rtt: decisionData.latency_ms
    });
  }

  onAgentDebate(debateData) {
    // Add strategist message
    if (debateData.strategist) {
      this.addDebateMessage('strategist', debateData.strategist);
    }

    // Add aggressive message
    if (debateData.aggressive) {
      this.addDebateMessage('aggressive', debateData.aggressive);
    }
  }

  onGameStateUpdate(data) {
    // Find which player slot this game state belongs to
    let playerSlot = null;
    this.players.forEach((player, slot) => {
      if (player.actualPlayerId === data.playerId) {
        playerSlot = slot;
      }
    });

    if (playerSlot) {
      const player = this.players.get(playerSlot);
      if (player && player.spectatorRenderer) {
        // Update the spectator renderer with the new game state
        player.spectatorRenderer.render(data.gameState);

        // Update stats display
        this.onPlayerUpdate(playerSlot, {
          time: data.gameState.gameTime || 0,
          best: data.gameState.score || 0,
          lane: data.gameState.playerPosition?.lane || 2,
          ammo: data.gameState.ammo || 0
        });
      }
    }
  }

  updateRoomState(stateData) {
    const { roomInfo, gameState } = stateData;

    if (roomInfo) {
      console.log('Room info updated:', roomInfo);

      // Update player connections based on room info
      roomInfo.players.forEach((playerId, index) => {
        const playerKey = index === 0 ? 'player1' : 'player2';

        if (!this.players.has(playerKey)) {
          this.setupPlayerGame(playerKey, document.getElementById(`${playerKey}-canvas`));
        }

        this.updatePlayerConnection(playerKey, true);
      });
    }

    if (gameState) {
      console.log('Game state updated:', gameState);

      // Update player stats if available
      if (gameState.player1) {
        this.onPlayerUpdate('player1', gameState.player1.stats);
      }

      if (gameState.player2) {
        this.onPlayerUpdate('player2', gameState.player2.stats);
      }
    }
  }

  onPlayerJoin(playerId) {
    console.log(`Player ${playerId} joining...`);

    // Check if this player is already connected (reconnection case)
    let existingSlot = null;
    this.players.forEach((player, slot) => {
      if (player.actualPlayerId === playerId) {
        existingSlot = slot;
      }
    });

    let playerSlot;
    if (existingSlot) {
      // Player is reconnecting to their existing slot
      playerSlot = existingSlot;
      console.log(`Player ${playerId} reconnecting to slot ${playerSlot}`);
    } else {
      // New player - find available slot
      playerSlot = this.getAvailablePlayerSlot();
      if (!playerSlot) {
        console.warn('No available player slots');
        return;
      }
    }

    // Show game state for this player (this creates the canvas)
    this.showPlayerGameState(playerSlot);

    // Now setup the game with the newly created canvas
    const canvas = document.getElementById(`${playerSlot}-canvas`);
    if (canvas) {
      this.setupPlayerGame(playerSlot, canvas);

      // Mark player as connected
      const player = this.players.get(playerSlot);
      if (player) {
        player.connected = true;
        player.actualPlayerId = playerId; // Store the actual player ID

        // For spectator mode, we don't need to init/start a game
        // The spectator renderer will display received game states
        console.log(`Spectator renderer ready for ${playerSlot}`);

        this.updatePlayerConnection(playerSlot, true);

        // Check if we need to transition to dual player mode
        const connectedCount = this.getConnectedPlayerCount();
        if (connectedCount === 2) {
          this.animator.transitionToDualPlayer();
        }

        // Update join instructions
        this.updateJoinInstructions();
      }
    }
  }

  updatePlayerConnection(playerId, connected) {
    const player = this.players.get(playerId);
    if (player) {
      player.connected = connected;
    }

    // Update UI indicators
    const playerContainer = document.getElementById(`${playerId}-container`);
    if (playerContainer) {
      if (connected) {
        playerContainer.style.opacity = '1';
        playerContainer.style.filter = 'none';
      } else {
        playerContainer.style.opacity = '0.5';
        playerContainer.style.filter = 'grayscale(1)';
      }
    }
  }

  onPlayerUpdate(playerId, data) {
    // Update player stats in UI
    const prefix = playerId === 'player1' ? 'p1' : 'p2';

    const timeEl = document.getElementById(`${prefix}-time`);
    const bestEl = document.getElementById(`${prefix}-best`);
    const laneEl = document.getElementById(`${prefix}-lane`);

    if (timeEl) timeEl.textContent = data.time.toFixed(1) + 's';
    if (bestEl) bestEl.textContent = data.best.toFixed(1) + 's';
    if (laneEl) laneEl.textContent = data.lane || '2';

    // Store stats
    const player = this.players.get(playerId);
    if (player) {
      player.stats = { ...data };
    }
  }

  onPlayerDebug(playerId, data) {
    // Add AI decision to the decisions panel
    this.addAIDecision({
      playerId,
      decision: data.decision,
      explain: data.explain,
      lanes: data.lanes,
      rtt: data.rtt
    });
  }

  addAIDecision(decision) {
    const decisionsContainer = document.getElementById('ai-decisions');
    const time = new Date().toLocaleTimeString();

    const decisionEl = document.createElement('div');
    decisionEl.className = 'decision-item';
    decisionEl.innerHTML = `
      <div class="decision-time">${time} - ${decision.playerId}</div>
      <div class="decision-action">${decision.decision}</div>
      <div class="decision-explanation">${decision.explain}</div>
      ${decision.rtt ? `<div style="font-size: 10px; color: #666;">RTT: ${decision.rtt}ms</div>` : ''}
    `;

    decisionsContainer.insertBefore(decisionEl, decisionsContainer.firstChild);

    // Keep only last 10 decisions
    while (decisionsContainer.children.length > 10) {
      decisionsContainer.removeChild(decisionsContainer.lastChild);
    }
  }

  startDebateSimulation() {
    // Start with some initial debate messages
    setTimeout(() => this.simulateDebateMessage(), 2000);
    setTimeout(() => this.simulateDebateMessage(), 4000);

    // Continue simulating periodically
    setInterval(() => {
      if (Math.random() < 0.3) { // 30% chance every 3 seconds
        this.simulateDebateMessage();
      }
    }, 3000);
  }

  simulateDebateMessage() {
    const strategistMessages = [
      "Analyzing Player 1's leftward movement pattern. Recommend flanking strategy.",
      "Player movement correlation detected. P1 dodges right when P2 moves left.",
      "Optimal targeting window identified. Coordinating dual-lane attack.",
      "Player adaptation rate: 73%. Increasing complexity of attack patterns.",
      "Cross-player prediction accuracy improved to 84%. Adjusting strategy."
    ];

    const aggressiveMessages = [
      "Engage maximum pressure! Both players showing defensive patterns.",
      "Overwhelming force recommended. Deploy multi-lane simultaneous strikes.",
      "Player 2 vulnerability detected in lane transitions. Exploit immediately!",
      "Aggressive pursuit mode activated. No mercy for pattern-based players.",
      "Coordinated assault ready. Strategist's analysis confirms dual-target opportunity."
    ];

    const isStrategist = Math.random() < 0.5;
    const messages = isStrategist ? strategistMessages : aggressiveMessages;
    const message = messages[Math.floor(Math.random() * messages.length)];

    this.addDebateMessage(isStrategist ? 'strategist' : 'aggressive', message);
  }

  addDebateMessage(agent, message) {
    const debateContent = document.getElementById('debate-content');

    const messageEl = document.createElement('div');
    messageEl.className = `debate-message ${agent}-message`;
    messageEl.innerHTML = `
      <div class="agent-name">${agent === 'strategist' ? '🎯 STRATEGIST:' : '⚡ AGGRESSIVE:'}</div>
      <div>${message}</div>
    `;

    debateContent.appendChild(messageEl);

    // Auto scroll to bottom
    debateContent.scrollTop = debateContent.scrollHeight;

    // Keep only last 20 messages
    while (debateContent.children.length > 20) {
      debateContent.removeChild(debateContent.firstChild);
    }
  }

  simulateAIDecision() {
    const decisions = ['spawn_bullets', 'slow_time', 'change_speed', 'feint_then_block'];
    const explanations = [
      'Predicting rightward movement to lane 3',
      'Player camping detected, direct hit strategy',
      'Cross-pattern identified, flanking approach',
      'Coordinated dual-player strike'
    ];

    this.addAIDecision({
      playerId: Math.random() < 0.5 ? 'player1' : 'player2',
      decision: decisions[Math.floor(Math.random() * decisions.length)],
      explain: explanations[Math.floor(Math.random() * explanations.length)],
      lanes: [Math.floor(Math.random() * 5)],
      rtt: Math.floor(Math.random() * 300) + 50
    });
  }

  onPlayerDeath(playerId, data) {
    console.log(`Player ${playerId} died:`, data);
  }

  onPlayerWin(playerId, data) {
    console.log(`Player ${playerId} won:`, data);
  }

  onPlayerTaunt(playerId, message) {
    console.log(`Player ${playerId} taunt:`, message);
  }

  setupDemoMode() {
    // Add performance monitoring
    this.performanceStats = {
      frameCount: 0,
      lastTime: performance.now(),
      fps: 60
    };

    // Monitor performance
    const updatePerformance = () => {
      const now = performance.now();
      this.performanceStats.frameCount++;

      if (now - this.performanceStats.lastTime >= 1000) {
        this.performanceStats.fps = this.performanceStats.frameCount;
        this.performanceStats.frameCount = 0;
        this.performanceStats.lastTime = now;

        // Enable performance mode if FPS drops below 45
        if (this.performanceStats.fps < 45) {
          document.body.classList.add('performance-mode');
        } else {
          document.body.classList.remove('performance-mode');
        }
      }

      requestAnimationFrame(updatePerformance);
    };

    requestAnimationFrame(updatePerformance);

    // Add keyboard shortcuts for demo
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        this.toggleDemoMode();
      }

      if (e.key === 'F2') {
        e.preventDefault();
        this.triggerDemoTransition();
      }

      if (e.key === 'F3') {
        e.preventDefault();
        this.resetDashboard();
      }
    });

    console.log('Demo mode controls: F1=Toggle demo effects, F2=Trigger transition, F3=Reset');
  }

  toggleDemoMode() {
    document.body.classList.toggle('demo-mode');
    const isDemo = document.body.classList.contains('demo-mode');

    this.showSuccessIndicator(isDemo ? 'DEMO MODE ON' : 'DEMO MODE OFF');
  }

  triggerDemoTransition() {
    // Force trigger the dual player transition for demo purposes
    this.onPlayerJoin('demo_player_2');
  }

  resetDashboard() {
    // Reset to zero players mode
    const dashboard = document.getElementById('dashboard');
    dashboard.classList.remove('dual-player');
    document.body.classList.remove('demo-mode');

    // Reset all player connections
    this.players.forEach((player, playerId) => {
      player.connected = false;
      player.actualPlayerId = null;
      this.updatePlayerConnection(playerId, false);
      if (player.spectatorRenderer) {
        player.spectatorRenderer.lastGameState = null;
      }
    });
    this.players.clear();

    // Show waiting state for both players
    this.showPlayerWaitingState('player1');
    this.showPlayerWaitingState('player2');
    this.updateJoinInstructions();

    this.showSuccessIndicator('DASHBOARD RESET');
  }

  // Helper methods for player container management
  showPlayerWaitingState(playerId) {
    const container = document.getElementById(`${playerId}-container`);
    if (!container) return;

    // Ensure container is visible
    container.style.display = 'block';
    container.style.opacity = '1';
    container.style.filter = 'none';

    // Replace canvas container with waiting state
    const canvasContainer = container.querySelector('.game-canvas-container');
    if (canvasContainer) {
      canvasContainer.innerHTML = `
        <div class="waiting-indicator">
          <div class="waiting-text">Waiting for player to join...</div>
          <div class="loading-dots">
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
          </div>
          <div style="margin-top: 20px; font-size: 14px; color: rgba(255, 255, 255, 0.6);">
            Player will appear when they scan the QR code
          </div>
        </div>
      `;
    }
  }

  showPlayerGameState(playerId) {
    const container = document.getElementById(`${playerId}-container`);
    if (!container) return;

    // Ensure container is visible
    container.style.display = 'block';
    container.style.opacity = '1';
    container.style.filter = 'none';

    // Replace waiting state with game canvas
    const canvasContainer = container.querySelector('.game-canvas-container');
    if (canvasContainer) {
      canvasContainer.innerHTML = `
        <canvas class="game-canvas" id="${playerId}-canvas" width="400" height="600"></canvas>
      `;
    }
  }

  updatePlayerWaitingState(playerId, message) {
    const container = document.getElementById(`${playerId}-container`);
    if (!container) return;

    const waitingIndicator = container.querySelector('.waiting-indicator');
    if (waitingIndicator) {
      const waitingText = waitingIndicator.querySelector('.waiting-text');
      if (waitingText) {
        waitingText.textContent = message;
      }
    }
  }

  getAvailablePlayerSlot() {
    // Check player1 first, then player2
    if (!this.players.has('player1')) {
      return 'player1';
    }
    if (!this.players.has('player2')) {
      return 'player2';
    }
    return null; // No slots available
  }

  getConnectedPlayerCount() {
    let count = 0;
    this.players.forEach((player) => {
      if (player.connected) {
        count++;
      }
    });
    return count;
  }

  updateJoinInstructions() {
    const joinInstructions = document.querySelector('.join-instructions');
    if (!joinInstructions) return;

    const connectedCount = this.getConnectedPlayerCount();

    if (connectedCount === 0) {
      joinInstructions.innerHTML = `
        <strong>Waiting for players...</strong><br>
        Scan QR code with mobile device to join the game
      `;
    } else if (connectedCount === 1) {
      joinInstructions.innerHTML = `
        <strong>Player 1 Connected!</strong><br>
        Waiting for Player 2 to scan QR code
      `;
    } else {
      joinInstructions.innerHTML = `
        <strong style="color: #00ff00;">Both Players Connected!</strong><br>
        Watching live AI coordination between players
      `;
    }
  }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.dashboard = new DashboardController();
});