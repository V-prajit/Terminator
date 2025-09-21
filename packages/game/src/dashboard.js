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
    this.roomId = this.getRoomIdFromURL() || this.generateRoomId();
    this.websocket = null;
    this.isConnected = false;
    this.qrGenerator = new QRGenerator();

    this.agentDebateMessages = [];
    this.aiDecisions = [];

    this.init();
  }

  getRoomIdFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      console.log('Using room ID from URL:', roomParam);
      return roomParam.toUpperCase();
    }
    return null;
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
    this.setupResizeHandler();

    // Update room ID in UI
    document.getElementById('room-id').textContent = `ROOM: ${this.roomId}`;

    // Update join instructions for zero-player state
    this.updateJoinInstructions();

    console.log('Dashboard initialized for room:', this.roomId);
  }

  setupResizeHandler() {
    // Handle window resize to keep canvases properly sized
    window.addEventListener('resize', () => {
      // Resize all active player canvases
      this.players.forEach((player, playerId) => {
        if (player.canvas) {
          this.sizeCanvasToContainer(player.canvas);
        }
      });
    });
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

        // Join as dashboard with our generated room ID
        this.sendMessage('join_as_dashboard', { roomId: this.roomId });
      };

      this.websocket.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };

      this.websocket.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        this.isConnected = false;
        this.updateConnectionStatus('Reconnecting...', false);

        // Attempt to reconnect immediately for ngrok issues, then with backoff
        const reconnectDelay = event.code === 1006 ? 1000 : 3000;
        setTimeout(() => {
          console.log(`Attempting to reconnect WebSocket after ${reconnectDelay}ms...`);
          this.setupWebSocket();
        }, reconnectDelay);
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

      console.log('[Dashboard] 📨 WebSocket message received:', type, data);

      switch (type) {
        case 'welcome':
          console.log('Welcome message received:', data);
          break;

        case 'dashboard_ready':
          console.log('Dashboard ready:', data);
          // Server should now use our room ID, but verify it matches
          if (data.roomId !== this.roomId) {
            console.warn(`Room ID mismatch! Expected: ${this.roomId}, Got: ${data.roomId}`);
            this.roomId = data.roomId;
            this.updateRoomId(data.roomId);
          }
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

  sizeCanvasToContainer(canvas) {
    const container = canvas.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));

    // Set CSS size to fill container
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    // Set canvas backing store size
    canvas.width = cssW;
    canvas.height = cssH;

    console.log(`[Dashboard] Canvas sized: ${cssW}x${cssH} for container`);
  }

  setupPlayerGame(playerId, canvas) {
    try {
      // Size canvas to fill its container
      this.sizeCanvasToContainer(canvas);

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

          // Render overlord/boss
          this.renderOverlord(gameState);

          // Render player
          if (gameState.playerPosition) {
            this.renderPlayer(gameState.playerPosition);
          }

          // Render bullets
          if (gameState.bullets && gameState.bullets.length > 0) {
            this.renderBullets(gameState.bullets);
          }

          // Show game stats
          this.ctx.fillStyle = '#ffffff';
          this.ctx.font = '12px monospace';
          this.ctx.fillText(`Time: ${gameState.gameTime?.toFixed(1) || 0}s`, 10, 20);
          this.ctx.fillText(`Lane: ${gameState.playerPosition?.lane || 'N/A'}`, 10, 35);
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
          const y = canvas.height - 80; // Adjust positioning for new canvas size

          // Draw player exactly like in mobile game - green circle with glow
          this.ctx.save();
          this.ctx.fillStyle = '#00ff00';
          this.ctx.strokeStyle = '#00ff00';
          this.ctx.lineWidth = 2;

          // Add strong glow effect like mobile game
          this.ctx.shadowBlur = 8;
          this.ctx.shadowColor = '#00ff00';

          // Draw filled circle
          this.ctx.beginPath();
          this.ctx.arc(x, y, 15, 0, Math.PI * 2);
          this.ctx.fill();

          // Draw stroke with glow
          this.ctx.stroke();

          // Add extra glow layer
          this.ctx.shadowBlur = 12;
          this.ctx.stroke();

          this.ctx.restore();
        },

        renderBullets: function(bullets) {
          bullets.forEach(bullet => {
            if (bullet.x !== undefined && bullet.y !== undefined) {
              // Use the actual coordinates from the mobile game
              // Scale them proportionally to the dashboard canvas
              const scaleX = canvas.width / 400;   // Mobile game canvas width
              const scaleY = canvas.height / 600;  // Mobile game canvas height

              const x = bullet.x * scaleX;
              const y = bullet.y * scaleY;

              this.ctx.save();
              this.ctx.translate(x, y);

              // Apply rotation if bullet has it
              if (bullet.rotation !== undefined) {
                this.ctx.rotate(bullet.rotation);
              }

              // Create gradient trail effect exactly like mobile game
              const gradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 15);
              gradient.addColorStop(0, 'rgba(255, 0, 64, 0.8)');
              gradient.addColorStop(1, 'rgba(255, 0, 64, 0)');
              this.ctx.fillStyle = gradient;
              this.ctx.fillRect(-15, -15, 30, 30);

              // Draw bright core bullet circle with glow
              this.ctx.fillStyle = '#ff0040';
              this.ctx.shadowColor = '#ff0040';
              this.ctx.shadowBlur = 8;
              this.ctx.beginPath();
              this.ctx.arc(0, 0, 6, 0, Math.PI * 2);
              this.ctx.fill();

              // Add extra glow for enemy bullets
              if (bullet.type === 'enemy') {
                this.ctx.shadowBlur = 12;
                this.ctx.fill();
              }

              this.ctx.restore();
            }
          });
        },

        renderOverlord: function(gameState) {
          // Always render the overlord - either boss or basic overlord
          const overlordX = canvas.width / 2;
          const overlordY = 50;

          // Check if boss is active
          if (gameState.boss && (gameState.boss.active || gameState.boss.defeated)) {
            // Render professional ULTRATHINK boss
            const bossX = gameState.boss.x || overlordX;
            const bossY = gameState.boss.y || overlordY;
            this.renderProfessionalULTRATHINK(bossX, bossY, gameState.boss);

            // Render health bar if boss is active
            if (gameState.boss.active && gameState.boss.health !== undefined) {
              this.renderBossHealthBar(bossX, bossY - 80, gameState.boss);
            }
          } else {
            // Render small overlord (original design) - matches mobile game exactly
            this.ctx.save();

            // Draw triangle with proper fill and stroke like mobile game
            this.ctx.fillStyle = '#ff00ff';
            this.ctx.strokeStyle = '#ff00ff';
            this.ctx.lineWidth = 2;

            // Add glow effect first
            this.ctx.shadowColor = '#ff00ff';
            this.ctx.shadowBlur = 15;

            // Draw triangle
            this.ctx.beginPath();
            this.ctx.moveTo(overlordX, overlordY - 25);
            this.ctx.lineTo(overlordX - 25, overlordY + 25);
            this.ctx.lineTo(overlordX + 25, overlordY + 25);
            this.ctx.closePath();
            this.ctx.stroke();

            // Clear shadow for eyes
            this.ctx.shadowBlur = 0;

            // Draw overlord eyes
            this.ctx.fillStyle = '#ff0000';
            this.ctx.beginPath();
            this.ctx.arc(overlordX - 8, overlordY - 5, 3, 0, 2 * Math.PI);
            this.ctx.fill();

            this.ctx.beginPath();
            this.ctx.arc(overlordX + 8, overlordY - 5, 3, 0, 2 * Math.PI);
            this.ctx.fill();

            this.ctx.restore();
          }
        },

        renderProfessionalULTRATHINK: function(x, y, boss) {
          const time = Date.now() * 0.003;
          const flashAlpha = boss.damageFlash > 0 ? 0.8 : 1.0;
          const isAttacking = boss.animatorState === 'attack';
          const isDamaged = boss.damageFlash > 0;

          this.ctx.save();
          this.ctx.globalAlpha = flashAlpha;

          const size = 50;
          const bodyColor = isDamaged ? '#ff4444' : (isAttacking ? '#ff00ff' : '#00ffff');

          // Professional body
          this.ctx.fillStyle = bodyColor;
          this.ctx.fillRect(x - size/2, y - size/2, size, size);

          // Professional details
          this.ctx.fillStyle = '#ffffff';
          this.ctx.font = '8px monospace';
          this.ctx.textAlign = 'center';
          this.ctx.fillText('AI', x, y);

          this.ctx.restore();
        },

        renderBossHealthBar: function(x, y, boss) {
          const healthPercent = boss.health / (boss.maxHealth || 100);
          const barWidth = 160;
          const barHeight = 6;

          this.ctx.save();

          // Health bar background
          this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          this.ctx.fillRect(x - barWidth/2, y, barWidth, barHeight);

          // Health bar fill
          const healthColor = healthPercent > 0.6 ? '#00ff00' :
                             healthPercent > 0.3 ? '#ffff00' : '#ff0000';
          this.ctx.fillStyle = healthColor;
          this.ctx.fillRect(x - barWidth/2, y, barWidth * healthPercent, barHeight);

          // Health bar border
          this.ctx.strokeStyle = '#ffffff';
          this.ctx.lineWidth = 1;
          this.ctx.strokeRect(x - barWidth/2, y, barWidth, barHeight);

          this.ctx.restore();
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
    // QR code functionality removed - no longer needed
  }

  updateRoomId(newRoomId) {
    this.roomId = newRoomId;
    const roomIdElement = document.getElementById('room-id');
    if (roomIdElement) {
      roomIdElement.textContent = `ROOM: ${newRoomId}`;
    }

    // Update QR code with new room ID
    this.updateQRCode();
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
    console.log('[Dashboard] 🎮 Game state update received:', data);

    // Find which player slot this game state belongs to
    let playerSlot = null;
    this.players.forEach((player, slot) => {
      if (player.actualPlayerId === data.playerId) {
        playerSlot = slot;
      }
    });

    console.log('[Dashboard] 🎯 Found player slot:', playerSlot, 'for player:', data.playerId);

    if (playerSlot) {
      const player = this.players.get(playerSlot);
      console.log('[Dashboard] 🎬 Player object:', player);

      if (player && player.spectatorRenderer) {
        console.log('[Dashboard] 🚀 Rendering game state to canvas:', data.gameState);

        // Update the spectator renderer with the new game state
        player.spectatorRenderer.render(data.gameState);

        // Update stats display
        this.onPlayerUpdate(playerSlot, {
          time: data.gameState.gameTime || 0,
          best: data.gameState.score || 0,
          lane: data.gameState.playerPosition?.lane || 2,
          ammo: data.gameState.ammo || 0
        });
      } else {
        console.warn('[Dashboard] ❌ No spectator renderer found for player:', playerSlot);
      }
    } else {
      console.warn('[Dashboard] ❌ No player slot found for player ID:', data.playerId);
      console.log('[Dashboard] 📊 Current players:', Array.from(this.players.entries()));

      // Fallback: Auto-create player slot for this player ID
      console.log('[Dashboard] 🔧 Auto-creating player slot for:', data.playerId);
      this.onPlayerJoin(data.playerId);

      // Try rendering again after creating the slot
      setTimeout(() => {
        this.onGameStateUpdate(data);
      }, 100);
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
    console.log(`Player ${playerId} joining room ${this.roomId}`);

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
        <canvas class="game-canvas" id="${playerId}-canvas"></canvas>
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
    // Update input orchestration panel
    const inputOrchText = document.getElementById('input-orch-text');
    if (inputOrchText) {
      const connectedCount = this.getConnectedPlayerCount();
      if (connectedCount === 0) {
        inputOrchText.textContent = 'Recent moves will appear here…';
      } else if (connectedCount === 1) {
        inputOrchText.textContent = 'Player 1 connected. Analyzing movement patterns…';
      } else {
        inputOrchText.textContent = 'Both players connected. Multi-agent coordination active.';
      }
    }

    // Update strategy agent
    const strategyText = document.getElementById('strategy-agent-text');
    if (strategyText) {
      const connectedCount = this.getConnectedPlayerCount();
      if (connectedCount === 0) {
        strategyText.textContent = 'Calculating optimal approach…';
      } else if (connectedCount === 1) {
        strategyText.textContent = 'Analyzing Player 1 behavior patterns. Preparing predictive models.';
      } else {
        strategyText.textContent = 'Dual-player strategy active. Cross-referencing movement patterns.';
      }
    }

    // Update shooting agent
    const shootingText = document.getElementById('shooting-agent-text');
    if (shootingText) {
      const connectedCount = this.getConnectedPlayerCount();
      if (connectedCount === 0) {
        shootingText.textContent = 'TARGET ACQUISITION IN PROGRESS…';
      } else if (connectedCount === 1) {
        shootingText.textContent = 'SINGLE TARGET LOCKED. PREPARING ENGAGEMENT PROTOCOLS.';
      } else {
        shootingText.textContent = 'DUAL TARGETS ACQUIRED. COORDINATED STRIKE PATTERNS ACTIVE.';
      }
    }
  }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.dashboard = new DashboardController();
});