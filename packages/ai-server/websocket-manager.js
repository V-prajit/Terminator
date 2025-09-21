// websocket-manager.js - WebSocket connection management for multiplayer dashboard
import { WebSocketServer } from 'ws';
import { RoomManager } from './room-manager.js';

export class WebSocketManager {
  constructor(server) {
    this.server = server;
    this.wss = new WebSocketServer({
      server: server,
      path: '/ws'
    });

    this.roomManager = new RoomManager();
    this.connections = new Map(); // websocket -> connection metadata

    this.setupWebSocketServer();
    this.setupRoomManagerEvents();

    console.log('WebSocket server initialized on /ws');
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws, request) => {
      this.handleConnection(ws, request);
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
  }

  setupRoomManagerEvents() {
    this.roomManager.on('playerJoined', ({ room, playerId }) => {
      console.log(`Room event: Player ${playerId} joined room ${room.id}`);
    });

    this.roomManager.on('playerLeft', ({ room, playerId }) => {
      console.log(`Room event: Player ${playerId} left room ${room.id}`);
    });

    this.roomManager.on('roomCreated', ({ room }) => {
      console.log(`Room event: Room ${room.id} created`);
    });

    this.roomManager.on('roomDeleted', ({ roomId }) => {
      console.log(`Room event: Room ${roomId} deleted`);
    });
  }

  handleConnection(ws, request) {
    const connectionId = this.generateConnectionId();

    // Parse URL parameters
    const url = new URL(request.url, `http://${request.headers.host}`);
    const params = Object.fromEntries(url.searchParams.entries());

    const connection = {
      id: connectionId,
      ws,
      type: 'unknown', // 'player', 'dashboard', 'spectator'
      playerId: null,
      roomId: null,
      metadata: params,
      connectedAt: Date.now(),
      lastActivity: Date.now()
    };

    this.connections.set(ws, connection);

    console.log(`WebSocket connection ${connectionId} established`);

    // Send welcome message
    this.sendMessage(ws, 'welcome', {
      connectionId,
      timestamp: Date.now(),
      roomManagerStats: this.roomManager.getRoomStats()
    });

    // Set up message handlers
    ws.on('message', (data) => {
      this.handleMessage(ws, data);
    });

    ws.on('close', (code, reason) => {
      this.handleDisconnection(ws, code, reason);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for connection ${connectionId}:`, error);
      this.handleDisconnection(ws, null, 'error');
    });

    // Set up ping/pong for connection health
    ws.on('pong', () => {
      connection.lastActivity = Date.now();
    });
  }

  handleMessage(ws, data) {
    const connection = this.connections.get(ws);
    if (!connection) return;

    connection.lastActivity = Date.now();

    try {
      const message = JSON.parse(data.toString());
      const { type, payload } = message;

      switch (type) {
        case 'join_as_player':
          this.handlePlayerJoin(ws, payload);
          break;

        case 'join_as_dashboard':
          this.handleDashboardJoin(ws, payload);
          break;

        case 'player_move':
          this.handlePlayerMove(ws, payload);
          break;

        case 'player_update':
          this.handlePlayerUpdate(ws, payload);
          break;

        case 'game_state':
          this.handleGameState(ws, payload);
          break;

        case 'ai_decision_relay':
          this.handleAIDecisionRelay(ws, payload);
          break;

        case 'create_room':
          this.handleCreateRoom(ws, payload);
          break;

        case 'join_room':
          this.handleJoinRoom(ws, payload);
          break;

        case 'leave_room':
          this.handleLeaveRoom(ws, payload);
          break;

        case 'get_room_info':
          this.handleGetRoomInfo(ws, payload);
          break;

        case 'ping':
          this.sendMessage(ws, 'pong', { timestamp: Date.now() });
          break;

        default:
          console.warn(`Unknown message type: ${type}`);
          this.sendError(ws, 'unknown_message_type', `Unknown message type: ${type}`);
      }

    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
      this.sendError(ws, 'parse_error', 'Invalid JSON message');
    }
  }

  handlePlayerJoin(ws, payload) {
    const connection = this.connections.get(ws);
    if (!connection) return;

    const { playerId, roomId, metadata = {} } = payload;

    if (!playerId) {
      this.sendError(ws, 'missing_player_id', 'Player ID is required');
      return;
    }

    try {
      const player = this.roomManager.addPlayerToRoom(playerId, ws, roomId, metadata);
      const room = this.roomManager.getRoomByPlayer(playerId);

      connection.type = 'player';
      connection.playerId = playerId;
      connection.roomId = room.id;

      this.sendMessage(ws, 'joined_room', {
        playerId,
        roomId: room.id,
        roomInfo: room.getInfo(),
        playerPosition: Array.from(room.players.keys()).indexOf(playerId) + 1
      });

      console.log(`Player ${playerId} joined room ${room.id} via WebSocket`);

    } catch (error) {
      console.error('Error adding player to room:', error);
      this.sendError(ws, 'join_failed', error.message);
    }
  }

  handleDashboardJoin(ws, payload) {
    const connection = this.connections.get(ws);
    if (!connection) return;

    const { roomId } = payload;

    try {
      let room;

      if (roomId) {
        // Join as spectator for specific room
        room = this.roomManager.addSpectator(ws, roomId);
        connection.type = 'spectator';
        connection.roomId = roomId;
      } else {
        // Create new room for dashboard
        room = this.roomManager.createRoom();
        connection.type = 'dashboard';
        connection.roomId = room.id;
      }

      this.sendMessage(ws, 'dashboard_ready', {
        roomId: room.id,
        roomInfo: room.getInfo(),
        gameState: room.getDualPlayerPayload()
      });

      console.log(`Dashboard connected to room ${room.id}`);

    } catch (error) {
      console.error('Error setting up dashboard:', error);
      this.sendError(ws, 'dashboard_setup_failed', error.message);
    }
  }

  handlePlayerMove(ws, payload) {
    const connection = this.connections.get(ws);
    if (!connection || connection.type !== 'player') return;

    const room = this.roomManager.getRoom(connection.roomId);
    if (!room) {
      this.sendError(ws, 'room_not_found', 'Room not found');
      return;
    }

    const success = room.updatePlayerMove(connection.playerId, payload);
    if (!success) {
      this.sendError(ws, 'move_failed', 'Failed to update player move');
    }
  }

  handlePlayerUpdate(ws, payload) {
    const connection = this.connections.get(ws);
    if (!connection || connection.type !== 'player') return;

    const room = this.roomManager.getRoom(connection.roomId);
    if (!room) return;

    // Update player stats
    room.updatePlayerMove(connection.playerId, payload);
  }

  handleGameState(ws, payload) {
    const connection = this.connections.get(ws);
    if (!connection || connection.type !== 'player') return;

    const room = this.roomManager.getRoom(connection.roomId);
    if (!room) return;

    // Broadcast full game state to all spectators (dashboards)
    room.broadcastToAll('game_state_update', {
      playerId: connection.playerId,
      gameState: payload,
      timestamp: Date.now()
    });
  }

  handleAIDecisionRelay(ws, payload) {
    const connection = this.connections.get(ws);
    if (!connection || connection.type !== 'player') return;

    const room = this.roomManager.getRoom(connection.roomId);
    if (!room) return;

    // Broadcast AI decision to all spectators (dashboards)
    room.broadcastToAll('ai_decision', {
      playerId: connection.playerId,
      decision: payload.decision,
      explain: payload.explain,
      params: { lanes: payload.lanes },
      latency_ms: payload.rtt,
      timestamp: payload.timestamp
    });
  }

  handleCreateRoom(ws, payload) {
    const connection = this.connections.get(ws);
    if (!connection) return;

    try {
      const room = this.roomManager.createRoom(payload.roomId);

      this.sendMessage(ws, 'room_created', {
        roomId: room.id,
        roomInfo: room.getInfo()
      });

    } catch (error) {
      this.sendError(ws, 'create_room_failed', error.message);
    }
  }

  handleJoinRoom(ws, payload) {
    const connection = this.connections.get(ws);
    if (!connection) return;

    const { roomId, playerId, asSpectator = false } = payload;

    try {
      if (asSpectator) {
        const room = this.roomManager.addSpectator(ws, roomId);
        connection.type = 'spectator';
        connection.roomId = roomId;

        this.sendMessage(ws, 'joined_as_spectator', {
          roomId,
          roomInfo: room.getInfo()
        });
      } else {
        if (!playerId) {
          this.sendError(ws, 'missing_player_id', 'Player ID required to join as player');
          return;
        }

        const player = this.roomManager.addPlayerToRoom(playerId, ws, roomId);
        const room = this.roomManager.getRoomByPlayer(playerId);

        connection.type = 'player';
        connection.playerId = playerId;
        connection.roomId = room.id;

        this.sendMessage(ws, 'joined_room', {
          playerId,
          roomId: room.id,
          roomInfo: room.getInfo()
        });
      }

    } catch (error) {
      this.sendError(ws, 'join_room_failed', error.message);
    }
  }

  handleLeaveRoom(ws, payload) {
    const connection = this.connections.get(ws);
    if (!connection) return;

    if (connection.type === 'player' && connection.playerId) {
      const room = this.roomManager.getRoomByPlayer(connection.playerId);
      if (room) {
        room.removePlayer(connection.playerId);
      }
    } else if (connection.type === 'spectator') {
      this.roomManager.removeSpectator(ws);
    }

    connection.type = 'unknown';
    connection.playerId = null;
    connection.roomId = null;

    this.sendMessage(ws, 'left_room', { success: true });
  }

  handleGetRoomInfo(ws, payload) {
    const { roomId } = payload;

    if (roomId) {
      const room = this.roomManager.getRoom(roomId);
      if (room) {
        this.sendMessage(ws, 'room_info', {
          roomInfo: room.getInfo(),
          gameState: room.getDualPlayerPayload()
        });
      } else {
        this.sendError(ws, 'room_not_found', `Room ${roomId} not found`);
      }
    } else {
      // Send all rooms info
      this.sendMessage(ws, 'rooms_list', {
        rooms: this.roomManager.getAllRooms(),
        stats: this.roomManager.getRoomStats()
      });
    }
  }

  handleDisconnection(ws, code, reason) {
    const connection = this.connections.get(ws);
    if (!connection) return;

    console.log(`WebSocket connection ${connection.id} disconnected: ${code} ${reason}`);

    // Clean up based on connection type
    if (connection.type === 'player' && connection.playerId) {
      const room = this.roomManager.getRoomByPlayer(connection.playerId);
      if (room) {
        room.removePlayer(connection.playerId);
      }
    } else if (connection.type === 'spectator') {
      this.roomManager.removeSpectator(ws);
    }

    this.connections.delete(ws);
  }

  sendMessage(ws, type, data) {
    if (ws.readyState !== 1) return false; // Not open

    try {
      ws.send(JSON.stringify({ type, data, timestamp: Date.now() }));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  }

  sendError(ws, errorType, message) {
    this.sendMessage(ws, 'error', {
      errorType,
      message,
      timestamp: Date.now()
    });
  }

  broadcast(type, data, filter = null) {
    let sent = 0;

    this.connections.forEach((connection, ws) => {
      if (filter && !filter(connection)) return;

      if (this.sendMessage(ws, type, data)) {
        sent++;
      }
    });

    return sent;
  }

  broadcastToRoom(roomId, type, data) {
    return this.broadcast(type, data, (connection) => {
      return connection.roomId === roomId;
    });
  }

  // Health check and cleanup
  startHealthCheck() {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000); // Every 30 seconds
  }

  performHealthCheck() {
    const now = Date.now();
    const timeout = 60000; // 60 seconds timeout

    this.connections.forEach((connection, ws) => {
      if (now - connection.lastActivity > timeout) {
        console.log(`Connection ${connection.id} timed out, closing`);
        ws.terminate();
        this.connections.delete(ws);
      } else {
        // Send ping
        try {
          ws.ping();
        } catch (error) {
          console.error(`Failed to ping connection ${connection.id}:`, error);
        }
      }
    });
  }

  generateConnectionId() {
    return Math.random().toString(36).substr(2, 9);
  }

  getStats() {
    const connectionTypes = {};
    this.connections.forEach((connection) => {
      connectionTypes[connection.type] = (connectionTypes[connection.type] || 0) + 1;
    });

    return {
      totalConnections: this.connections.size,
      connectionTypes,
      roomStats: this.roomManager.getRoomStats()
    };
  }

  destroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Close all connections
    this.connections.forEach((connection, ws) => {
      try {
        ws.close(1001, 'Server shutting down');
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
    });

    this.connections.clear();

    // Close WebSocket server
    this.wss.close();

    // Destroy room manager
    this.roomManager.destroy();

    console.log('WebSocket manager destroyed');
  }
}

export default WebSocketManager;