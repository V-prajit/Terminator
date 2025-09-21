// multiplayer-client.js - Mobile client multiplayer support
import PlayerAuth from './player-auth.js';

export class MultiplayerClient {
  constructor() {
    this.websocket = null;
    this.isConnected = false;
    this.playerAuth = new PlayerAuth();
    this.playerData = null;
    this.playerId = null;
    this.playerName = null;
    this.roomId = null;
    this.isMultiplayer = false;

    this.callbacks = {
      onConnected: () => {},
      onDisconnected: () => {},
      onRoomJoined: () => {},
      onGameStart: () => {},
      onError: () => {}
    };

    this.checkForRoomParameter();
  }

  checkForRoomParameter() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');

    if (roomId) {
      this.roomId = roomId;
      this.isMultiplayer = true;
      console.log('Multiplayer mode detected, room:', roomId);

      // Check if player already exists
      const existingPlayer = this.playerAuth.getExistingPlayer();
      if (existingPlayer) {
        // Use existing player data
        this.playerData = existingPlayer;
        this.playerId = existingPlayer.id;
        this.playerName = existingPlayer.name;
        this.playerAuth.updateLastPlayed();
        console.log('Returning player:', this.playerName);

        // Show multiplayer UI and connect
        this.showMultiplayerUI();
        setTimeout(() => {
          this.connect();
        }, 1000);
      } else {
        // Show name entry modal for new players
        this.showNameEntryModal();
      }
    }
  }

  showNameEntryModal() {
    const modal = document.getElementById('name-entry-modal');
    const input = document.getElementById('player-name-input');
    const joinBtn = document.getElementById('join-arena-btn');

    if (!modal || !input || !joinBtn) {
      console.error('Name entry modal elements not found');
      return;
    }

    // Show the modal
    modal.classList.add('show');

    // Focus the input
    input.focus();

    // Handle input validation
    const validateInput = () => {
      const name = input.value.trim();
      const isValid = this.playerAuth.isValidPlayerName(name);
      joinBtn.disabled = !isValid;
      return isValid;
    };

    // Real-time validation
    input.addEventListener('input', validateInput);

    // Handle Enter key
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && validateInput()) {
        this.handleNameSubmission();
      }
    });

    // Handle join button click
    joinBtn.addEventListener('click', () => {
      if (validateInput()) {
        this.handleNameSubmission();
      }
    });

    // Initial validation
    validateInput();
  }

  handleNameSubmission() {
    const input = document.getElementById('player-name-input');
    const modal = document.getElementById('name-entry-modal');
    const playerName = input.value.trim();

    try {
      // Create player data
      this.playerData = this.playerAuth.createPlayer(playerName);
      this.playerId = this.playerData.id;
      this.playerName = this.playerData.name;

      console.log('New player created:', this.playerName, this.playerId);

      // Hide modal
      modal.classList.remove('show');

      // Show multiplayer UI and connect
      this.showMultiplayerUI();
      setTimeout(() => {
        this.connect();
      }, 500);

    } catch (error) {
      console.error('Failed to create player:', error);
      alert('Invalid name. Please use 2-20 characters (letters, numbers, spaces, hyphens, underscores only).');
    }
  }

  showMultiplayerUI() {
    // Add multiplayer indicator to the UI
    const indicator = document.createElement('div');
    indicator.id = 'multiplayer-indicator';
    const displayName = this.playerName || 'Player';
    indicator.innerHTML = `
      <div style="
        position: fixed;
        top: 10px;
        left: 10px;
        padding: 8px 15px;
        background: rgba(0, 255, 255, 0.2);
        border: 1px solid #00ffff;
        border-radius: 20px;
        color: #00ffff;
        font-family: monospace;
        font-size: 12px;
        z-index: 1000;
        backdrop-filter: blur(5px);
      ">
        🔗 ${displayName} • Room: ${this.roomId}
      </div>
    `;

    document.body.appendChild(indicator);

  }


  connect() {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      return;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl;

    // Check if we're running through ngrok tunnel or local development
    if (window.location.host.includes('ngrok') || !window.location.host.includes(':')) {
      // Production/ngrok mode - use same host with /ws path (demo server proxies to AI server)
      wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    } else if (window.location.host.includes(':')) {
      // Local development mode - connect directly to AI server
      const [hostname] = window.location.host.split(':');
      wsUrl = `${wsProtocol}//${hostname}:8787/ws`;
    } else {
      // Fallback - use same host
      wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    }

    console.log('Connecting to multiplayer WebSocket:', wsUrl);

    try {
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('Multiplayer WebSocket connected');
        this.isConnected = true;
        this.callbacks.onConnected();
        this.updateConnectionStatus('Connected');

        // Join room as player
        this.sendMessage('join_as_player', {
          playerId: this.playerId,
          playerName: this.playerName,
          roomId: this.roomId,
          metadata: {
            userAgent: navigator.userAgent,
            timestamp: Date.now(),
            platform: 'mobile',
            isReturningPlayer: this.playerData ? true : false
          }
        });
      };

      this.websocket.onmessage = (event) => {
        this.handleMessage(event);
      };

      this.websocket.onclose = (event) => {
        console.log('Multiplayer WebSocket disconnected:', event.code, event.reason);
        this.isConnected = false;
        this.callbacks.onDisconnected();
        this.updateConnectionStatus('Disconnected');

        // Attempt to reconnect after 3 seconds
        setTimeout(() => {
          this.connect();
        }, 3000);
      };

      this.websocket.onerror = (error) => {
        console.error('Multiplayer WebSocket error:', error);
        this.callbacks.onError(error);
        this.updateConnectionStatus('Error');
      };

    } catch (error) {
      console.error('Failed to create multiplayer WebSocket:', error);
      this.callbacks.onError(error);
    }
  }

  sendMessage(type, payload) {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }

  handleMessage(event) {
    try {
      const message = JSON.parse(event.data);
      const { type, data } = message;

      switch (type) {
        case 'welcome':
          console.log('Welcome to multiplayer:', data);
          break;

        case 'joined_room':
          console.log('Successfully joined room:', data);
          this.callbacks.onRoomJoined(data);
          this.updateConnectionStatus(`Connected • ${this.playerName}`);

          break;

        case 'game_started':
          console.log('Multiplayer game started:', data);
          this.callbacks.onGameStart(data);

          break;

        case 'player_joined':
          console.log('Another player joined:', data);
          if (data.playerCount === 2) {
          }
          break;

        case 'player_left':
          console.log('A player left:', data);
          break;

        case 'error':
          console.error('Multiplayer error:', data);
          this.callbacks.onError(data);
          break;

        default:
          console.log('Unknown multiplayer message:', type, data);
      }

    } catch (error) {
      console.error('Failed to parse multiplayer message:', error);
    }
  }

  updateConnectionStatus(status) {
    const indicator = document.getElementById('multiplayer-indicator');
    if (indicator) {
      const statusColors = {
        'Connected': '#00ff00',
        'Disconnected': '#ff0000',
        'Error': '#ff8800',
        'Connecting': '#ffff00'
      };

      const color = statusColors[status.split(' ')[0]] || '#00ffff';

      indicator.innerHTML = `
        <div style="
          position: fixed;
          top: 10px;
          left: 10px;
          padding: 8px 15px;
          background: rgba(0, 255, 255, 0.2);
          border: 1px solid ${color};
          border-radius: 20px;
          color: ${color};
          font-family: monospace;
          font-size: 12px;
          z-index: 1000;
          backdrop-filter: blur(5px);
        ">
          🔗 ${status} • Room: ${this.roomId}
        </div>
      `;
    }
  }

  sendPlayerMove(moveData) {
    if (!this.isConnected || !this.isMultiplayer) return;

    this.sendMessage('player_move', {
      ...moveData,
      playerId: this.playerId,
      timestamp: Date.now()
    });
  }

  sendPlayerUpdate(updateData) {
    if (!this.isConnected || !this.isMultiplayer) return;

    this.sendMessage('player_update', {
      ...updateData,
      playerId: this.playerId,
      timestamp: Date.now()
    });
  }

  sendGameState(gameStateData) {
    if (!this.isConnected || !this.isMultiplayer) {
      console.log('[MultiplayerClient] ❌ Cannot send game state - not connected or not in multiplayer');
      return;
    }

    const payload = {
      ...gameStateData,
      playerId: this.playerId,
      timestamp: Date.now()
    };

    console.log('[MultiplayerClient] 📤 Sending game state:', payload);
    const success = this.sendMessage('game_state', payload);
    console.log('[MultiplayerClient] 📤 Send result:', success);
  }

  disconnect() {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    this.isConnected = false;
  }

  setCallbacks(callbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  // Utility methods for game integration
  isInMultiplayerMode() {
    return this.isMultiplayer;
  }

  getPlayerId() {
    return this.playerId;
  }

  getPlayerName() {
    return this.playerName;
  }

  getPlayerData() {
    return this.playerData;
  }

  getRoomId() {
    return this.roomId;
  }

  getConnectionInfo() {
    return {
      isConnected: this.isConnected,
      isMultiplayer: this.isMultiplayer,
      playerId: this.playerId,
      playerName: this.playerName,
      roomId: this.roomId,
      isReturningPlayer: this.playerData ? true : false
    };
  }
}

export default MultiplayerClient;