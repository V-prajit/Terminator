// multiplayer-client.js - Mobile client multiplayer support
export class MultiplayerClient {
  constructor() {
    this.websocket = null;
    this.isConnected = false;
    this.playerId = this.generatePlayerId();
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

      // Show multiplayer UI indicators
      this.showMultiplayerUI();

      // Auto-connect when room is specified
      setTimeout(() => {
        this.connect();
      }, 1000);
    }
  }

  showMultiplayerUI() {
    // Add multiplayer indicator to the UI
    const indicator = document.createElement('div');
    indicator.id = 'multiplayer-indicator';
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
        🔗 MULTIPLAYER • Room: ${this.roomId}
      </div>
    `;

    document.body.appendChild(indicator);

    // Update taunt overlay with multiplayer info
    const tauntOverlay = document.getElementById('taunt-overlay');
    if (tauntOverlay) {
      tauntOverlay.textContent = `Connecting to multiplayer room ${this.roomId}...`;
      tauntOverlay.style.background = 'rgba(0, 255, 255, 0.2)';
      tauntOverlay.style.borderColor = '#00ffff';
      tauntOverlay.style.color = '#00ffff';
    }
  }

  generatePlayerId() {
    // Generate a simple player ID
    return 'player_' + Math.random().toString(36).substr(2, 8);
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
          roomId: this.roomId,
          metadata: {
            userAgent: navigator.userAgent,
            timestamp: Date.now(),
            platform: 'mobile'
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
          this.updateConnectionStatus(`Connected • Player ${data.playerPosition}`);

          const tauntOverlay = document.getElementById('taunt-overlay');
          if (tauntOverlay) {
            tauntOverlay.textContent = `Connected as Player ${data.playerPosition} in room ${data.roomId}`;
          }
          break;

        case 'game_started':
          console.log('Multiplayer game started:', data);
          this.callbacks.onGameStart(data);

          const tauntOverlay2 = document.getElementById('taunt-overlay');
          if (tauntOverlay2) {
            tauntOverlay2.textContent = 'Multiplayer game active!';
          }
          break;

        case 'player_joined':
          console.log('Another player joined:', data);
          if (data.playerCount === 2) {
            const tauntOverlay3 = document.getElementById('taunt-overlay');
            if (tauntOverlay3) {
              tauntOverlay3.textContent = 'Both players connected! Game starting...';
            }
          }
          break;

        case 'player_left':
          console.log('A player left:', data);
          const tauntOverlay4 = document.getElementById('taunt-overlay');
          if (tauntOverlay4) {
            tauntOverlay4.textContent = 'Waiting for other player to reconnect...';
          }
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

  getRoomId() {
    return this.roomId;
  }

  getConnectionInfo() {
    return {
      isConnected: this.isConnected,
      isMultiplayer: this.isMultiplayer,
      playerId: this.playerId,
      roomId: this.roomId
    };
  }
}

export default MultiplayerClient;