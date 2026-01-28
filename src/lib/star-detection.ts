/**
 * Stats-Based Star Detection Service
 * 
 * Dynamically identifies elite/star/quality players based on STATS ONLY
 * No hardcoded player names - the model adapts as players improve or decline
 * 
 * Tier Detection Criteria:
 * - ELITE: Top performers in goals, points share, TOI, PP1, and advanced stats
 * - STAR: High performers meeting 3+ criteria
 * - QUALITY: Above-average meeting 2+ criteria  
 * - AVERAGE: Everyone else
 */

export type PlayerTier = 'elite' | 'star' | 'quality' | 'average';

export interface PlayerTierInfo {
  tier: PlayerTier;
  score: number; // 0-100 composite score
  criteria: {
    goalsPerGame: { value: number; met: boolean };
    pointsShareOfTeam: { value: number; met: boolean };
    toiRank: { value: number; met: boolean };
    isPP1: { value: boolean; met: boolean };
    gamesPlayed: { value: number; met: boolean };
    shotsPerGame: { value: number; met: boolean };
  };
  criteriaMetCount: number;
}

export interface PlayerStats {
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
  avgToi: number; // in seconds
  powerPlayGoals: number;
  powerPlayPoints: number;
  teamTotalPoints?: number; // For calculating points share
}

// Thresholds based on research
const THRESHOLDS = {
  elite: {
    goalsPerGame: 0.45,      // ~37 goals in 82 games
    pointsShare: 0.15,       // 15%+ of team points
    toiRank: 2,              // Top 2 on team
    shotsPerGame: 3.5,       // High volume shooter
    minGames: 20,            // Sample size
  },
  star: {
    goalsPerGame: 0.30,      // ~25 goals in 82 games  
    pointsShare: 0.10,       // 10%+ of team points
    toiRank: 4,              // Top 4 on team
    shotsPerGame: 2.5,       // Above average
    minGames: 15,
  },
  quality: {
    goalsPerGame: 0.20,      // ~16 goals in 82 games
    pointsShare: 0.05,       // 5%+ of team points
    toiRank: 8,              // Top 8 on team
    shotsPerGame: 2.0,       // Average
    minGames: 10,
  },
};

// Cache for team stats (to calculate points share and TOI rank)
let teamStatsCache: Map<string, {
  totalPoints: number;
  players: PlayerStats[];
  lastUpdated: number;
}> = new Map();

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch team stats from NHL API
 */
async function fetchTeamStats(teamAbbrev: string): Promise<PlayerStats[]> {
  const cached = teamStatsCache.get(teamAbbrev);
  if (cached && Date.now() - cached.lastUpdated < CACHE_TTL) {
    return cached.players;
  }
  
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`);
    if (!response.ok) return [];
    
    const data = await response.json();
    const skaters = data.skaters || [];
    
    const players: PlayerStats[] = skaters.map((s: any) => {
      const name = `${s.firstName?.default || ''} ${s.lastName?.default || ''}`.trim();
      
      // Parse avgToi (can be string like "20:35" or number)
      let avgToiSeconds = 0;
      if (typeof s.avgToi === 'string') {
        const parts = s.avgToi.split(':');
        avgToiSeconds = (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
      } else if (typeof s.avgToi === 'number') {
        avgToiSeconds = s.avgToi;
      }
      
      return {
        playerId: s.playerId,
        name,
        team: teamAbbrev,
        teamAbbrev,
        position: s.positionCode || 'F',
        gamesPlayed: s.gamesPlayed || 0,
        goals: s.goals || 0,
        assists: s.assists || 0,
        points: s.points || 0,
        shots: s.shots || 0,
        avgToi: avgToiSeconds,
        powerPlayGoals: s.powerPlayGoals || 0,
        powerPlayPoints: s.powerPlayPoints || 0,
      };
    });
    
    // Calculate team total points
    const totalPoints = players.reduce((sum, p) => sum + p.points, 0);
    
    // Add points share to each player
    players.forEach(p => {
      p.teamTotalPoints = totalPoints;
    });
    
    // Sort by TOI for ranking
    players.sort((a, b) => b.avgToi - a.avgToi);
    
    // Cache
    teamStatsCache.set(teamAbbrev, {
      totalPoints,
      players,
      lastUpdated: Date.now(),
    });
    
    return players;
    
  } catch (error) {
    console.error(`Error fetching team stats for ${teamAbbrev}:`, error);
    return [];
  }
}

/**
 * Get player's TOI rank on their team
 */
async function getPlayerToiRank(playerName: string, teamAbbrev: string): Promise<number> {
  const players = await fetchTeamStats(teamAbbrev);
  const normalizedName = playerName.toLowerCase();
  
  // Sort by TOI descending
  const sortedByToi = [...players].sort((a, b) => b.avgToi - a.avgToi);
  
  const index = sortedByToi.findIndex(p => 
    p.name.toLowerCase() === normalizedName ||
    p.name.toLowerCase().includes(normalizedName.split(' ').pop() || '')
  );
  
  return index >= 0 ? index + 1 : 99;
}

/**
 * Determine player tier based on stats
 */
export async function getPlayerTier(player: PlayerStats, isPP1: boolean = false): Promise<PlayerTierInfo> {
  const gamesPlayed = player.gamesPlayed || 1;
  const goalsPerGame = player.goals / gamesPlayed;
  const shotsPerGame = player.shots / gamesPlayed;
  const teamTotalPoints = player.teamTotalPoints || 1;
  const pointsShare = player.points / teamTotalPoints;
  
  // Get TOI rank
  const toiRank = await getPlayerToiRank(player.name, player.teamAbbrev);
  
  // Check criteria for each tier
  const criteria = {
    goalsPerGame: { 
      value: goalsPerGame, 
      met: false 
    },
    pointsShareOfTeam: { 
      value: pointsShare, 
      met: false 
    },
    toiRank: { 
      value: toiRank, 
      met: false 
    },
    isPP1: { 
      value: isPP1, 
      met: isPP1 
    },
    gamesPlayed: { 
      value: gamesPlayed, 
      met: false 
    },
    shotsPerGame: { 
      value: shotsPerGame, 
      met: false 
    },
  };
  
  // Check ELITE criteria
  let eliteCriteria = 0;
  if (goalsPerGame >= THRESHOLDS.elite.goalsPerGame) {
    criteria.goalsPerGame.met = true;
    eliteCriteria++;
  }
  if (pointsShare >= THRESHOLDS.elite.pointsShare) {
    criteria.pointsShareOfTeam.met = true;
    eliteCriteria++;
  }
  if (toiRank <= THRESHOLDS.elite.toiRank) {
    criteria.toiRank.met = true;
    eliteCriteria++;
  }
  if (isPP1) {
    eliteCriteria++;
  }
  if (gamesPlayed >= THRESHOLDS.elite.minGames) {
    criteria.gamesPlayed.met = true;
    eliteCriteria++;
  }
  if (shotsPerGame >= THRESHOLDS.elite.shotsPerGame) {
    criteria.shotsPerGame.met = true;
    eliteCriteria++;
  }
  
  // Determine tier
  let tier: PlayerTier;
  let criteriaMetCount = 0;
  
  // ELITE: 4+ of 6 criteria met at elite level
  if (eliteCriteria >= 4) {
    tier = 'elite';
    criteriaMetCount = eliteCriteria;
  } else {
    // Check STAR criteria
    let starCriteria = 0;
    if (goalsPerGame >= THRESHOLDS.star.goalsPerGame) starCriteria++;
    if (pointsShare >= THRESHOLDS.star.pointsShare) starCriteria++;
    if (toiRank <= THRESHOLDS.star.toiRank) starCriteria++;
    if (isPP1) starCriteria++;
    if (gamesPlayed >= THRESHOLDS.star.minGames) starCriteria++;
    if (shotsPerGame >= THRESHOLDS.star.shotsPerGame) starCriteria++;
    
    if (starCriteria >= 3) {
      tier = 'star';
      criteriaMetCount = starCriteria;
    } else {
      // Check QUALITY criteria
      let qualityCriteria = 0;
      if (goalsPerGame >= THRESHOLDS.quality.goalsPerGame) qualityCriteria++;
      if (pointsShare >= THRESHOLDS.quality.pointsShare) qualityCriteria++;
      if (toiRank <= THRESHOLDS.quality.toiRank) qualityCriteria++;
      if (gamesPlayed >= THRESHOLDS.quality.minGames) qualityCriteria++;
      if (shotsPerGame >= THRESHOLDS.quality.shotsPerGame) qualityCriteria++;
      
      if (qualityCriteria >= 2) {
        tier = 'quality';
        criteriaMetCount = qualityCriteria;
      } else {
        tier = 'average';
        criteriaMetCount = qualityCriteria;
      }
    }
  }
  
  // Calculate composite score (0-100)
  const score = calculateTierScore(goalsPerGame, pointsShare, toiRank, isPP1, gamesPlayed, shotsPerGame);
  
  return {
    tier,
    score,
    criteria,
    criteriaMetCount,
  };
}

/**
 * Calculate a composite score for ranking
 */
function calculateTierScore(
  goalsPerGame: number,
  pointsShare: number,
  toiRank: number,
  isPP1: boolean,
  gamesPlayed: number,
  shotsPerGame: number
): number {
  let score = 0;
  
  // Goals per game (0-30 points)
  score += Math.min(30, goalsPerGame * 50);
  
  // Points share (0-25 points)
  score += Math.min(25, pointsShare * 150);
  
  // TOI rank (0-15 points) - lower is better
  score += Math.max(0, 15 - toiRank);
  
  // PP1 status (0-10 points)
  if (isPP1) score += 10;
  
  // Games played (0-10 points)
  score += Math.min(10, gamesPlayed / 8);
  
  // Shots per game (0-10 points)
  score += Math.min(10, shotsPerGame * 2.5);
  
  return Math.round(score);
}

/**
 * Get tier-based confidence boost for predictions
 */
export function getTierConfidenceBoost(tier: PlayerTier): number {
  switch (tier) {
    case 'elite': return 0.35;
    case 'star': return 0.25;
    case 'quality': return 0.15;
    case 'average': return 0.08;
    default: return 0;
  }
}

/**
 * Get tier-based injury impact on team
 */
export function getTierInjuryImpact(tier: PlayerTier): number {
  switch (tier) {
    case 'elite': return -0.10;  // -10% win probability
    case 'star': return -0.07;   // -7%
    case 'quality': return -0.04; // -4%
    case 'average': return -0.01; // -1%
    default: return 0;
  }
}

/**
 * Quick tier check from basic stats (for API route use)
 */
export function quickTierCheck(
  goalsPerGame: number,
  gamesPlayed: number,
  isPP1: boolean = false
): PlayerTier {
  // Simplified check without API calls
  if (goalsPerGame >= 0.45 && gamesPlayed >= 20) return 'elite';
  if (goalsPerGame >= 0.30 && gamesPlayed >= 15) return 'star';
  if (goalsPerGame >= 0.20 && gamesPlayed >= 10) return 'quality';
  if (goalsPerGame >= 0.10 && gamesPlayed >= 10) return 'average';
  return 'average';
}

/**
 * Calculate confidence score based on player stats (no hardcoded names)
 */
export function calculateDynamicConfidence(
  goalsPerGame: number,
  gamesPlayed: number,
  shotsPerGame: number,
  isPP1: boolean,
  hasLinemateInjury: boolean,
  facingEliteGoalie: boolean,
  isBackToBack: boolean
): number {
  let confidence = 0.30; // Base confidence
  
  // Tier-based boost (from stats, not names)
  if (goalsPerGame >= 0.45) confidence += 0.35;      // Elite scorer
  else if (goalsPerGame >= 0.30) confidence += 0.25; // Star scorer
  else if (goalsPerGame >= 0.20) confidence += 0.15; // Quality scorer
  else if (goalsPerGame >= 0.10) confidence += 0.08; // Average scorer
  
  // Sample size boost
  if (gamesPlayed >= 50) confidence += 0.15;
  else if (gamesPlayed >= 30) confidence += 0.10;
  else if (gamesPlayed >= 20) confidence += 0.05;
  
  // High-volume shooter boost
  if (shotsPerGame >= 3.5) confidence += 0.05;
  
  // PP1 boost (elite opportunity)
  if (isPP1) confidence += 0.05;
  
  // Penalties
  if (hasLinemateInjury) confidence -= 0.10;
  if (facingEliteGoalie) confidence -= 0.05;
  if (isBackToBack) confidence -= 0.05;
  
  // Cap between 0.15 and 0.95
  return Math.max(0.15, Math.min(0.95, confidence));
}

/**
 * Get all elite players on a team (for injury impact)
 */
export async function getTeamElitePlayers(teamAbbrev: string): Promise<PlayerStats[]> {
  const players = await fetchTeamStats(teamAbbrev);
  const elitePlayers: PlayerStats[] = [];
  
  for (const player of players) {
    const tierInfo = await getPlayerTier(player, false);
    if (tierInfo.tier === 'elite' || tierInfo.tier === 'star') {
      elitePlayers.push(player);
    }
  }
  
  return elitePlayers;
}

/**
 * Clear cache (for testing)
 */
export function clearTierCache(): void {
  teamStatsCache.clear();
}
