// room-manager.js - Manages multiplayer game rooms and sessions
import { EventEmitter } from 'events';

export class Room extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.players = new Map();
    this.maxPlayers = 2;
    this.status = 'waiting'; // waiting, active, full
    this.createdAt = Date.now();
    this.lastActivity = Date.now();

    // Game state tracking
    this.gameState = {
      started: false,
      tick: 0,
      playerMoves: new Map(),
      aiDecisions: [],
      agentDebates: []
    };

    // AI analysis data
    this.aiAnalysis = {
      crossPlayerPatterns: new Map(),
      coordinatedDecisions: [],
      predictionAccuracy: new Map()
    };
  }

  addPlayer(playerId, websocket, metadata = {}) {
    if (this.players.size >= this.maxPlayers) {
      throw new Error('Room is full');
    }

    if (this.players.has(playerId)) {
      throw new Error('Player already in room');
    }

    const player = {
      id: playerId,
      websocket,
      metadata,
      joinedAt: Date.now(),
      connected: true,
      stats: {
        currentTime: 0,
        bestTime: 0,
        lane: 2,
        recentMoves: [],
        recentLanes: [2]
      }
    };

    this.players.set(playerId, player);
    this.lastActivity = Date.now();

    // Update room status
    if (this.players.size === this.maxPlayers) {
      this.status = 'full';
      this.startGame();
    } else if (this.players.size === 1) {
      this.status = 'waiting';
    }

    // Notify all players and spectators about the new join
    this.broadcastToAll('player_joined', {
      playerId,
      playerCount: this.players.size,
      roomStatus: this.status,
      metadata
    });

    this.emit('playerJoined', { room: this, playerId, player });
    console.log(`Player ${playerId} joined room ${this.id} (${this.players.size}/${this.maxPlayers})`);

    return player;
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return false;

    this.players.delete(playerId);
    this.lastActivity = Date.now();

    // Update room status
    if (this.players.size === 0) {
      this.status = 'empty';
    } else {
      this.status = 'waiting';
      this.gameState.started = false;
    }

    // Notify remaining players and spectators
    this.broadcastToAll('player_left', {
      playerId,
      playerCount: this.players.size,
      roomStatus: this.status
    });

    this.emit('playerLeft', { room: this, playerId, player });
    console.log(`Player ${playerId} left room ${this.id} (${this.players.size}/${this.maxPlayers})`);

    return true;
  }

  startGame() {
    if (this.gameState.started) return;

    this.gameState.started = true;
    this.status = 'active';
    this.lastActivity = Date.now();

    this.broadcastToPlayers('game_started', {
      roomId: this.id,
      players: Array.from(this.players.keys()),
      timestamp: Date.now()
    });

    this.emit('gameStarted', { room: this });
    console.log(`Game started in room ${this.id} with ${this.players.size} players`);
  }

  updatePlayerMove(playerId, moveData) {
    const player = this.players.get(playerId);
    if (!player) return false;

    // Update player stats
    player.stats = { ...player.stats, ...moveData };

    // Track move history
    if (moveData.lane !== undefined) {
      player.stats.recentLanes.push(moveData.lane);
      if (player.stats.recentLanes.length > 10) {
        player.stats.recentLanes.shift();
      }
    }

    if (moveData.move) {
      player.stats.recentMoves.push(moveData.move);
      if (player.stats.recentMoves.length > 10) {
        player.stats.recentMoves.shift();
      }
    }

    this.lastActivity = Date.now();

    // Store in game state for AI analysis
    this.gameState.playerMoves.set(playerId, {
      ...moveData,
      timestamp: Date.now()
    });

    // Broadcast move to other players and spectators
    this.broadcastToPlayers('player_move', {
      playerId,
      ...moveData
    }, playerId); // Exclude the player who made the move

    this.emit('playerMove', { room: this, playerId, moveData });

    // Analyze cross-player patterns
    this.analyzeCrossPlayerPatterns();

    return true;
  }

  addAIDecision(decision, playerId = null) {
    const decisionWithMeta = {
      ...decision,
      playerId,
      timestamp: Date.now(),
      tick: this.gameState.tick++
    };

    this.gameState.aiDecisions.push(decisionWithMeta);

    // Keep only last 50 decisions
    if (this.gameState.aiDecisions.length > 50) {
      this.gameState.aiDecisions.shift();
    }

    // Broadcast to all players and spectators
    this.broadcastToAll('ai_decision', decisionWithMeta);

    this.emit('aiDecision', { room: this, decision: decisionWithMeta });

    return decisionWithMeta;
  }

  addAgentDebate(strategistMessage, aggressiveMessage) {
    const debate = {
      strategist: strategistMessage,
      aggressive: aggressiveMessage,
      timestamp: Date.now(),
      players: Array.from(this.players.keys())
    };

    this.gameState.agentDebates.push(debate);

    // Keep only last 30 debates
    if (this.gameState.agentDebates.length > 30) {
      this.gameState.agentDebates.shift();
    }

    // Broadcast to all connections
    this.broadcastToAll('agent_debate', debate);

    this.emit('agentDebate', { room: this, debate });

    return debate;
  }

  analyzeCrossPlayerPatterns() {
    if (this.players.size < 2) return;

    const playerIds = Array.from(this.players.keys());
    const [p1Id, p2Id] = playerIds;

    const p1 = this.players.get(p1Id);
    const p2 = this.players.get(p2Id);

    if (!p1 || !p2) return;

    // Analyze movement correlation
    const p1Lanes = p1.stats.recentLanes.slice(-5);
    const p2Lanes = p2.stats.recentLanes.slice(-5);

    if (p1Lanes.length >= 3 && p2Lanes.length >= 3) {
      // Check for inverse movement patterns
      let inverseCount = 0;
      let mirrorCount = 0;

      for (let i = 1; i < Math.min(p1Lanes.length, p2Lanes.length); i++) {
        const p1Move = p1Lanes[i] - p1Lanes[i-1];
        const p2Move = p2Lanes[i] - p2Lanes[i-1];

        if (p1Move !== 0 && p2Move !== 0) {
          if ((p1Move > 0 && p2Move < 0) || (p1Move < 0 && p2Move > 0)) {
            inverseCount++;
          }
          if (p1Move === p2Move) {
            mirrorCount++;
          }
        }
      }

      // Store pattern analysis
      this.aiAnalysis.crossPlayerPatterns.set('inverse_movement', {
        correlation: inverseCount / Math.max(1, inverseCount + mirrorCount),
        confidence: Math.min(1, (inverseCount + mirrorCount) / 3),
        lastUpdated: Date.now()
      });

      this.aiAnalysis.crossPlayerPatterns.set('mirror_movement', {
        correlation: mirrorCount / Math.max(1, inverseCount + mirrorCount),
        confidence: Math.min(1, (inverseCount + mirrorCount) / 3),
        lastUpdated: Date.now()
      });
    }
  }

  getDualPlayerPayload() {
    if (this.players.size < 2) return null;

    const playerIds = Array.from(this.players.keys());
    const [p1Id, p2Id] = playerIds;

    const p1 = this.players.get(p1Id);
    const p2 = this.players.get(p2Id);

    return {
      room_id: this.id,
      player1: {
        id: p1Id,
        stats: p1.stats,
        current_lane: p1.stats.lane,
        recent_lanes: p1.stats.recentLanes,
        recent_moves: p1.stats.recentMoves
      },
      player2: {
        id: p2Id,
        stats: p2.stats,
        current_lane: p2.stats.lane,
        recent_lanes: p2.stats.recentLanes,
        recent_moves: p2.stats.recentMoves
      },
      cross_patterns: Object.fromEntries(this.aiAnalysis.crossPlayerPatterns),
      game_state: {
        tick: this.gameState.tick,
        started: this.gameState.started,
        duration: this.gameState.started ? Date.now() - this.createdAt : 0
      }
    };
  }

  broadcastToPlayers(type, data, excludePlayerId = null) {
    this.players.forEach((player, playerId) => {
      if (playerId === excludePlayerId) return;
      if (!player.websocket || player.websocket.readyState !== 1) return;

      try {
        player.websocket.send(JSON.stringify({ type, data }));
      } catch (error) {
        console.error(`Failed to send to player ${playerId}:`, error);
        player.connected = false;
      }
    });
  }

  broadcastToAll(type, data) {
    // Broadcast to players
    this.broadcastToPlayers(type, data);

    // Broadcast to spectators (dashboard connections)
    this.emit('broadcast', { type, data });
  }

  isExpired(maxIdleTime = 60 * 60 * 1000) { // 1 hour default - much longer for demo stability
    return Date.now() - this.lastActivity > maxIdleTime;
  }

  getInfo() {
    return {
      id: this.id,
      status: this.status,
      playerCount: this.players.size,
      maxPlayers: this.maxPlayers,
      players: Array.from(this.players.keys()),
      gameStarted: this.gameState.started,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity
    };
  }
}

export class RoomManager extends EventEmitter {
  constructor() {
    super();
    this.rooms = new Map();
    this.playerRooms = new Map(); // playerId -> roomId mapping
    this.spectators = new Map(); // websocket -> room mapping for dashboard connections

    // Cleanup timer
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRooms();
    }, 60000); // Clean up every minute
  }

  createRoom(roomId = null) {
    if (!roomId) {
      roomId = this.generateRoomId();
    }

    if (this.rooms.has(roomId)) {
      throw new Error(`Room ${roomId} already exists`);
    }

    const room = new Room(roomId);
    this.rooms.set(roomId, room);

    // Set up room event handlers
    room.on('playerJoined', ({ room, playerId }) => {
      this.playerRooms.set(playerId, room.id);
      this.emit('playerJoined', { room, playerId });
    });

    room.on('playerLeft', ({ room, playerId }) => {
      this.playerRooms.delete(playerId);
      // Don't auto-delete rooms - let them persist for dashboard reconnections
      // They will be cleaned up later by the cleanup process if truly inactive
      this.emit('playerLeft', { room, playerId });
    });

    room.on('broadcast', ({ type, data }) => {
      // Enhanced logging for broadcast debugging
      const spectatorList = [];

      // Forward to spectators watching this room
      this.spectators.forEach((spectatorRoom, websocket) => {
        spectatorList.push({
          room: spectatorRoom,
          readyState: websocket.readyState,
          matches: spectatorRoom === room.id,
          willSend: spectatorRoom === room.id && websocket.readyState === 1
        });

        if (spectatorRoom === room.id && websocket.readyState === 1) {
          try {
            websocket.send(JSON.stringify({ type, data, roomId: room.id }));
          } catch (error) {
            console.error('Failed to send to spectator:', error);
            this.spectators.delete(websocket);
          }
        }
      });

      console.log(`📡 Broadcast '${type}' to room ${room.id}:`);
      console.log(`   Spectators: ${spectatorList.length} total, ${spectatorList.filter(s => s.willSend).length} receiving`);
      if (spectatorList.length > 0) {
        console.log(`   Details:`, spectatorList);
      }
    });

    console.log(`Created room ${roomId}`);
    this.emit('roomCreated', { room });

    return room;
  }

  deleteRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    console.log(`🗑️ [DEBUG] deleteRoom called for ${roomId} - Stack trace:`);
    console.trace();

    // Remove all players
    room.players.forEach((player, playerId) => {
      this.playerRooms.delete(playerId);
    });

    // Remove spectators
    this.spectators.forEach((spectatorRoom, websocket) => {
      if (spectatorRoom === roomId) {
        this.spectators.delete(websocket);
      }
    });

    // Clean up room
    room.removeAllListeners();
    this.rooms.delete(roomId);

    console.log(`Deleted room ${roomId}`);
    this.emit('roomDeleted', { roomId, room });

    return true;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomByPlayer(playerId) {
    const roomId = this.playerRooms.get(playerId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  findAvailableRoom() {
    for (const room of this.rooms.values()) {
      if (room.status === 'waiting' && room.players.size < room.maxPlayers) {
        return room;
      }
    }
    return null;
  }

  addPlayerToRoom(playerId, websocket, roomId = null, metadata = {}) {
    // Check if player is already in a room
    if (this.playerRooms.has(playerId)) {
      const existingRoomId = this.playerRooms.get(playerId);
      const existingRoom = this.rooms.get(existingRoomId);
      if (existingRoom) {
        existingRoom.removePlayer(playerId);
      }
    }

    let room;

    if (roomId) {
      // Join specific room
      room = this.rooms.get(roomId);
      if (!room) {
        throw new Error(`Room ${roomId} not found`);
      }
    } else {
      // Find available room or create new one
      room = this.findAvailableRoom();
      if (!room) {
        room = this.createRoom();
      }
    }

    return room.addPlayer(playerId, websocket, metadata);
  }

  addSpectator(websocket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    this.spectators.set(websocket, roomId);

    // Send current room state to spectator
    const roomInfo = room.getInfo();
    const gameState = room.getDualPlayerPayload();

    websocket.send(JSON.stringify({
      type: 'room_state',
      data: { roomInfo, gameState }
    }));

    console.log(`Spectator added to room ${roomId}`);
    return room;
  }

  removeSpectator(websocket) {
    this.spectators.delete(websocket);
  }

  generateRoomId() {
    let roomId;
    do {
      roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    } while (this.rooms.has(roomId));
    return roomId;
  }

  cleanupExpiredRooms() {
    const expiredRooms = [];

    this.rooms.forEach((room, roomId) => {
      if (room.isExpired()) {
        expiredRooms.push(roomId);
      }
    });

    expiredRooms.forEach(roomId => {
      console.log(`Cleaning up expired room ${roomId}`);
      this.deleteRoom(roomId);
    });

    if (expiredRooms.length > 0) {
      console.log(`Cleaned up ${expiredRooms.length} expired rooms`);
    }
  }

  getRoomStats() {
    const stats = {
      totalRooms: this.rooms.size,
      activeRooms: 0,
      waitingRooms: 0,
      totalPlayers: 0,
      totalSpectators: this.spectators.size
    };

    this.rooms.forEach(room => {
      if (room.status === 'active') stats.activeRooms++;
      if (room.status === 'waiting') stats.waitingRooms++;
      stats.totalPlayers += room.players.size;
    });

    return stats;
  }

  getAllRooms() {
    return Array.from(this.rooms.values()).map(room => room.getInfo());
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.rooms.clear();
    this.playerRooms.clear();
    this.spectators.clear();
    this.removeAllListeners();
  }
}

export default RoomManager;