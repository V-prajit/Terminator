// sync.js
// WebSocket sync stub for future multiplayer

const SYNC_ENABLED = false;

class SyncClient {
  constructor(url = ((location?.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws')) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.eventBus = new Map();
  }
  
  connect() {
    if (!SYNC_ENABLED) return;
    
    try {
      this.ws = new WebSocket(this.url);
      
      this.ws.onopen = () => {
        this.connected = true;
        this.emit('connected');
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.emit('message', data);
          
          if (data.type) {
            this.emit(data.type, data.payload);
          }
        } catch (err) {
          console.error('Sync parse error:', err);
        }
      };
      
      this.ws.onclose = () => {
        this.connected = false;
        this.emit('disconnected');
        
        // Auto-reconnect
        setTimeout(() => this.connect(), 5000);
      };
      
    } catch (err) {
      console.error('Sync connection error:', err);
    }
  }
  
  send(type, payload) {
    if (!this.connected || !this.ws) return;
    
    try {
      this.ws.send(JSON.stringify({ type, payload }));
    } catch (err) {
      console.error('Sync send error:', err);
    }
  }
  
  on(event, handler) {
    if (!this.eventBus.has(event)) {
      this.eventBus.set(event, []);
    }
    this.eventBus.get(event).push(handler);
  }
  
  emit(event, data) {
    const handlers = this.eventBus.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }
  
  // Game-specific sync methods
  syncMove(lane) {
    this.send('move', { lane });
  }
  
  syncState(state) {
    this.send('state', state);
  }
  
  syncTaunt(message) {
    this.send('taunt', { message });
  }
}

export const syncClient = new SyncClient();

// Auto-connect if enabled
if (SYNC_ENABLED) {
  syncClient.connect();
}