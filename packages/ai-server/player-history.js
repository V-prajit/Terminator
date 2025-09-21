// player-history.js - Manages player gameplay history for personalized AI taunts
import fs from 'fs/promises';
import path from 'path';

class PlayerHistoryManager {
  constructor(historyDir = './player-history') {
    this.historyDir = historyDir;
    this.ensureHistoryDirectory();
  }

  async ensureHistoryDirectory() {
    try {
      await fs.mkdir(this.historyDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create history directory:', error);
    }
  }

  // Generate safe filename from player ID
  getPlayerFilename(playerId) {
    // Sanitize player ID for filename
    const safeId = playerId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.historyDir, `${safeId}.json`);
  }

  // Load player history from file
  async loadPlayerHistory(playerId) {
    try {
      const filename = this.getPlayerFilename(playerId);
      const data = await fs.readFile(filename, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, return default structure
        return this.createDefaultPlayerHistory(playerId);
      }
      console.error('Failed to load player history:', error);
      return this.createDefaultPlayerHistory(playerId);
    }
  }

  // Create default player history structure
  createDefaultPlayerHistory(playerId) {
    return {
      playerId: playerId,
      playerName: '',
      createdAt: Date.now(),
      lastPlayed: Date.now(),
      totalGames: 0,
      totalDeaths: 0,
      stats: {
        bestTime: 0,
        averageSurvivalTime: 0,
        totalSurvivalTime: 0,
        improvementTrend: 'new', // 'improving', 'declining', 'stable', 'new'
        favoriteStartingLane: 2,
        mostDangerousLane: 2
      },
      patterns: {
        commonDeathCauses: {},  // e.g., {'lane_2_bullet': 5, 'multi_bullet': 3}
        movementHabits: {},     // e.g., {'always_left_first': 0.8, 'lane_preference': {0: 0.1, 1: 0.2, ...}}
        timeBasedFailures: {},  // e.g., {'under_5s': 10, '5_to_15s': 5, 'over_15s': 2}
        repeatedMistakes: [],   // Array of patterns like 'died_same_way_3_times'
        sessionPatterns: {}     // Patterns within recent gaming sessions
      },
      recentGames: [],          // Last 10 games with detailed data
      personalityProfile: {     // For taunt customization
        skillLevel: 'beginner', // 'beginner', 'intermediate', 'advanced'
        frustrationLevel: 'low', // 'low', 'medium', 'high'
        competitiveness: 'medium', // 'low', 'medium', 'high'
        preferredTauntStyle: 'playful' // 'playful', 'competitive', 'encouraging'
      }
    };
  }

  // Save player history to file
  async savePlayerHistory(playerId, history) {
    try {
      const filename = this.getPlayerFilename(playerId);
      const data = JSON.stringify(history, null, 2);
      await fs.writeFile(filename, data, 'utf8');
      return true;
    } catch (error) {
      console.error('Failed to save player history:', error);
      return false;
    }
  }

  // Record a new game session
  async recordGameSession(playerId, gameData) {
    const history = await this.loadPlayerHistory(playerId);

    // Update basic stats
    history.totalGames += 1;
    history.lastPlayed = Date.now();

    if (gameData.playerName && !history.playerName) {
      history.playerName = gameData.playerName;
    }

    // Create game record
    const gameRecord = {
      gameId: Date.now(),
      timestamp: Date.now(),
      survivalTime: gameData.survivalTime || 0,
      deathCause: gameData.deathCause || 'unknown',
      deathLane: gameData.deathLane || -1,
      movementPattern: gameData.movementPattern || [],
      aiDecisions: gameData.aiDecisions || [],
      bulletCount: gameData.bulletCount || 1,
      gamePhase: gameData.gamePhase || 'beginner', // beginner, intermediate, expert
      finalScore: gameData.finalScore || gameData.survivalTime || 0
    };

    // Add to recent games (keep last 10)
    history.recentGames.unshift(gameRecord);
    if (history.recentGames.length > 10) {
      history.recentGames = history.recentGames.slice(0, 10);
    }

    // Update stats
    this.updatePlayerStats(history, gameRecord);

    // Analyze patterns
    this.analyzePlayerPatterns(history, gameRecord);

    // Update personality profile
    this.updatePersonalityProfile(history, gameRecord);

    // Save updated history
    await this.savePlayerHistory(playerId, history);

    return history;
  }

  // Update player statistics
  updatePlayerStats(history, gameRecord) {
    const stats = history.stats;

    // Update best time
    if (gameRecord.survivalTime > stats.bestTime) {
      stats.bestTime = gameRecord.survivalTime;
    }

    // Update total survival time and average
    stats.totalSurvivalTime += gameRecord.survivalTime;
    stats.averageSurvivalTime = stats.totalSurvivalTime / history.totalGames;

    // Update improvement trend (based on recent 5 games)
    if (history.recentGames.length >= 5) {
      const recentTimes = history.recentGames.slice(0, 5).map(g => g.survivalTime);
      const firstHalf = recentTimes.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
      const secondHalf = recentTimes.slice(3, 5).reduce((a, b) => a + b, 0) / 2;

      if (secondHalf > firstHalf * 1.2) {
        stats.improvementTrend = 'improving';
      } else if (secondHalf < firstHalf * 0.8) {
        stats.improvementTrend = 'declining';
      } else {
        stats.improvementTrend = 'stable';
      }
    }

    // Track lane preferences and dangers
    if (gameRecord.deathLane >= 0) {
      // Update most dangerous lane (where they die most often)
      const dangerousLanes = {};
      history.recentGames.forEach(game => {
        if (game.deathLane >= 0) {
          dangerousLanes[game.deathLane] = (dangerousLanes[game.deathLane] || 0) + 1;
        }
      });

      const mostDangerous = Object.entries(dangerousLanes)
        .sort(([,a], [,b]) => b - a)[0];
      if (mostDangerous) {
        stats.mostDangerousLane = parseInt(mostDangerous[0]);
      }
    }
  }

  // Analyze player behavior patterns
  analyzePlayerPatterns(history, gameRecord) {
    const patterns = history.patterns;

    // Track death causes
    const deathKey = `${gameRecord.deathCause}_lane_${gameRecord.deathLane}`;
    patterns.commonDeathCauses[deathKey] = (patterns.commonDeathCauses[deathKey] || 0) + 1;

    // Track time-based failures
    const timeKey = gameRecord.survivalTime < 5 ? 'under_5s' :
                   gameRecord.survivalTime < 15 ? '5_to_15s' : 'over_15s';
    patterns.timeBasedFailures[timeKey] = (patterns.timeBasedFailures[timeKey] || 0) + 1;

    // Detect repeated mistakes (same death cause 3+ times in recent games)
    const recentDeaths = history.recentGames.slice(0, 5).map(g => g.deathCause);
    const deathCounts = {};
    recentDeaths.forEach(cause => {
      deathCounts[cause] = (deathCounts[cause] || 0) + 1;
    });

    patterns.repeatedMistakes = Object.entries(deathCounts)
      .filter(([cause, count]) => count >= 3)
      .map(([cause, count]) => `repeated_${cause}_${count}_times`);

    // Analyze movement patterns
    if (gameRecord.movementPattern && gameRecord.movementPattern.length > 0) {
      const firstMove = gameRecord.movementPattern[0];
      if (firstMove === 'left') {
        patterns.movementHabits.leftFirstTendency =
          (patterns.movementHabits.leftFirstTendency || 0) + 0.1;
      } else if (firstMove === 'right') {
        patterns.movementHabits.rightFirstTendency =
          (patterns.movementHabits.rightFirstTendency || 0) + 0.1;
      }
    }
  }

  // Update personality profile for taunt customization
  updatePersonalityProfile(history, gameRecord) {
    const profile = history.personalityProfile;

    // Determine skill level based on recent performance
    const avgTime = history.stats.averageSurvivalTime;
    if (avgTime < 5) {
      profile.skillLevel = 'beginner';
    } else if (avgTime < 15) {
      profile.skillLevel = 'intermediate';
    } else {
      profile.skillLevel = 'advanced';
    }

    // Estimate frustration level based on recent trend
    if (history.stats.improvementTrend === 'declining') {
      profile.frustrationLevel = 'high';
    } else if (history.stats.improvementTrend === 'stable' && avgTime < 3) {
      profile.frustrationLevel = 'medium';
    } else {
      profile.frustrationLevel = 'low';
    }

    // Set taunt style based on personality
    if (profile.frustrationLevel === 'high') {
      profile.preferredTauntStyle = 'encouraging';
    } else if (profile.skillLevel === 'advanced') {
      profile.preferredTauntStyle = 'competitive';
    } else {
      profile.preferredTauntStyle = 'playful';
    }
  }

  // Get taunt context for AI
  async getTauntContext(playerId, playerName = 'Player') {
    const history = await this.loadPlayerHistory(playerId);

    return {
      playerName: history.playerName || playerName,
      skillLevel: history.personalityProfile.skillLevel,
      recentPerformance: {
        lastGame: history.recentGames[0] || null,
        averageTime: history.stats.averageSurvivalTime,
        bestTime: history.stats.bestTime,
        improvementTrend: history.stats.improvementTrend,
        gamesPlayed: history.totalGames
      },
      patterns: {
        commonFailures: Object.entries(history.patterns.commonDeathCauses)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 3),
        repeatedMistakes: history.patterns.repeatedMistakes,
        dangerousLane: history.stats.mostDangerousLane,
        movementHabits: history.patterns.movementHabits
      },
      tauntStyle: history.personalityProfile.preferredTauntStyle,
      frustrationLevel: history.personalityProfile.frustrationLevel
    };
  }

  // Get summary for debugging
  async getPlayerSummary(playerId) {
    const history = await this.loadPlayerHistory(playerId);
    return {
      name: history.playerName,
      totalGames: history.totalGames,
      bestTime: history.stats.bestTime,
      averageTime: history.stats.averageSurvivalTime,
      skillLevel: history.personalityProfile.skillLevel,
      recentGames: history.recentGames.length
    };
  }
}

export default PlayerHistoryManager;