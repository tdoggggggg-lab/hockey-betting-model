/**
 * Enhanced Player Stats
 * Adds TOI (Time on Ice) and Shot data for better predictions
 */

export interface EnhancedPlayerStats {
  playerId: number;
  name: string;
  team: string;
  teamAbbrev: string;
  position: string;
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  shotsPerGame: number;
  shootingPercentage: number; // goals / shots
  timeOnIce: number; // total minutes
  toiPerGame: number; // avg minutes per game
  powerPlayGoals: number;
  powerPlayPoints: number;
  powerPlayTOI: number; // PP minutes per game
  gameWinningGoals: number;
  plusMinus: number;
  // Calculated fields
  goalsPerGame: number;
  expectedGoalsPerGame: number; // shots * shooting %
}

/**
 * Calculate TOI multiplier
 * More ice time = more opportunities to score
 * League avg forward TOI ~15 min, top liners ~20 min
 */
export function getTOIMultiplier(toiPerGame: number, position: string): number {
  const avgTOI = position === 'D' ? 20 : 15; // Defensemen avg more
  const diff = toiPerGame - avgTOI;
  
  // Each minute above avg = ~3% more scoring chance
  const multiplier = 1 + (diff * 0.03);
  
  // Cap between 0.85 and 1.20
  return Math.max(0.85, Math.min(1.20, multiplier));
}

/**
 * Calculate shot volume multiplier
 * High shot volume = more goal opportunities (even with avg shooting %)
 */
export function getShotVolumeMultiplier(shotsPerGame: number): number {
  const avgShots = 2.5; // League average for forwards
  const diff = shotsPerGame - avgShots;
  
  // Each shot above avg = ~4% boost
  const multiplier = 1 + (diff * 0.04);
  
  // Cap between 0.85 and 1.25
  return Math.max(0.85, Math.min(1.25, multiplier));
}

/**
 * Calculate shooting percentage adjustment
 * Unsustainably high % = regression expected
 * Very low % = potential positive regression
 */
export function getShootingPctAdjustment(shootingPct: number, gamesPlayed: number): number {
  // Need minimum sample size
  if (gamesPlayed < 10) return 1.0;
  
  const avgShootingPct = 0.11; // ~11% league average
  
  if (shootingPct > 0.18) {
    // Unsustainably high, expect regression down
    return 0.92;
  } else if (shootingPct > 0.14) {
    // Above average but sustainable for good shooters
    return 0.97;
  } else if (shootingPct < 0.06) {
    // Very low, likely to regress up
    return 1.05;
  } else if (shootingPct < 0.09) {
    // Below average, slight upward regression
    return 1.02;
  }
  
  return 1.0; // Normal range
}

/**
 * Fetch enhanced player stats from NHL API
 */
export async function getEnhancedPlayerStats(teamAbbrev: string): Promise<EnhancedPlayerStats[]> {
  try {
    const response = await fetch(
      `https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'HockeyEdge/1.0',
        },
      }
    );
    
    if (!response.ok) {
      console.error(`Failed to fetch enhanced stats for ${teamAbbrev}`);
      return [];
    }
    
    const data = await response.json();
    const players: EnhancedPlayerStats[] = [];
    
    (data.skaters || []).forEach((p: any) => {
      const gamesPlayed = p.gamesPlayed || 1;
      const goals = p.goals || 0;
      const shots = p.shots || 0;
      const toi = p.timeOnIce || 0;
      
      const goalsPerGame = goals / gamesPlayed;
      const shotsPerGame = shots / gamesPlayed;
      const shootingPct = shots > 0 ? goals / shots : 0;
      const toiPerGame = toi / gamesPlayed / 60; // Convert to minutes
      
      players.push({
        playerId: p.playerId,
        name: `${p.firstName?.default || ''} ${p.lastName?.default || ''}`.trim(),
        team: teamAbbrev,
        teamAbbrev,
        position: p.positionCode || 'F',
        gamesPlayed,
        goals,
        assists: p.assists || 0,
        points: p.points || 0,
        shots,
        shotsPerGame,
        shootingPercentage: shootingPct,
        timeOnIce: toi,
        toiPerGame,
        powerPlayGoals: p.powerPlayGoals || 0,
        powerPlayPoints: p.powerPlayPoints || 0,
        powerPlayTOI: (p.powerPlayTimeOnIce || 0) / gamesPlayed / 60,
        gameWinningGoals: p.gameWinningGoals || 0,
        plusMinus: p.plusMinus || 0,
        goalsPerGame,
        expectedGoalsPerGame: shotsPerGame * shootingPct,
      });
    });
    
    return players;
    
  } catch (error) {
    console.error(`Error fetching enhanced stats for ${teamAbbrev}:`, error);
    return [];
  }
}

/**
 * Get player trends (goals in last N games)
 * Returns array of recent game goal counts
 */
export async function getPlayerRecentGoals(playerId: number, numGames: number = 5): Promise<number[]> {
  try {
    const response = await fetch(
      `https://api-web.nhle.com/v1/player/${playerId}/game-log/now`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'HockeyEdge/1.0',
        },
      }
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const gameLog = data.gameLog || [];
    
    // Get last N games
    return gameLog
      .slice(0, numGames)
      .map((g: any) => g.goals || 0);
      
  } catch (error) {
    console.error(`Error fetching game log for player ${playerId}:`, error);
    return [];
  }
}

/**
 * Calculate hot/cold streak multiplier based on recent performance
 */
export function getStreakMultiplier(recentGoals: number[], seasonGoalsPerGame: number): number {
  if (recentGoals.length < 3) return 1.0;
  
  const recentAvg = recentGoals.reduce((a, b) => a + b, 0) / recentGoals.length;
  const ratio = seasonGoalsPerGame > 0 ? recentAvg / seasonGoalsPerGame : 1;
  
  if (ratio > 1.5) {
    // Hot streak - but factor in regression
    return 1.08; // Modest boost, don't overweight
  } else if (ratio > 1.2) {
    return 1.04;
  } else if (ratio < 0.5) {
    // Cold streak
    return 0.94;
  } else if (ratio < 0.8) {
    return 0.97;
  }
  
  return 1.0;
}
