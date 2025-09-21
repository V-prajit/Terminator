// player-auth.js - Cookie-based player authentication for multiplayer
export class PlayerAuth {
  constructor() {
    this.cookieName = 'ai_overlord_player';
    this.cookieExpireDays = 365; // 1 year
  }

  // Set a cookie value
  setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
  }

  // Get a cookie value
  getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  }

  // Delete a cookie
  deleteCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  }

  // Save player data to cookie
  savePlayerData(playerName, playerData = {}) {
    const data = {
      name: playerName,
      id: this.generatePlayerId(playerName),
      lastPlayed: Date.now(),
      ...playerData
    };
    this.setCookie(this.cookieName, JSON.stringify(data), this.cookieExpireDays);
    return data;
  }

  // Load player data from cookie
  loadPlayerData() {
    const cookieData = this.getCookie(this.cookieName);
    if (cookieData) {
      try {
        return JSON.parse(cookieData);
      } catch (error) {
        console.error('Failed to parse player cookie data:', error);
        this.deleteCookie(this.cookieName);
        return null;
      }
    }
    return null;
  }

  // Generate consistent player ID from name (for history tracking)
  generatePlayerId(playerName) {
    // Create a simple hash of the player name for consistent ID generation
    let hash = 0;
    const str = playerName.toLowerCase().trim();
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Convert to positive number and add prefix
    return 'player_' + Math.abs(hash).toString(36);
  }

  // Check if player name is valid
  isValidPlayerName(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 20) return false;
    // Allow letters, numbers, spaces, hyphens, underscores
    return /^[a-zA-Z0-9\s\-_]+$/.test(trimmed);
  }

  // Sanitize player name
  sanitizePlayerName(name) {
    if (!name) return '';
    return name.trim().replace(/[^a-zA-Z0-9\s\-_]/g, '').substring(0, 20);
  }

  // Get existing player or null
  getExistingPlayer() {
    return this.loadPlayerData();
  }

  // Create new player
  createPlayer(playerName) {
    const sanitizedName = this.sanitizePlayerName(playerName);
    if (!this.isValidPlayerName(sanitizedName)) {
      throw new Error('Invalid player name');
    }
    return this.savePlayerData(sanitizedName);
  }

  // Update last played timestamp
  updateLastPlayed() {
    const playerData = this.loadPlayerData();
    if (playerData) {
      playerData.lastPlayed = Date.now();
      this.savePlayerData(playerData.name, playerData);
    }
  }

  // Clear player data (logout)
  clearPlayerData() {
    this.deleteCookie(this.cookieName);
  }

  // Get player display info
  getPlayerDisplayInfo() {
    const playerData = this.loadPlayerData();
    if (playerData) {
      return {
        name: playerData.name,
        id: playerData.id,
        isReturningPlayer: true,
        lastPlayed: new Date(playerData.lastPlayed)
      };
    }
    return {
      name: null,
      id: null,
      isReturningPlayer: false,
      lastPlayed: null
    };
  }
}

export default PlayerAuth;