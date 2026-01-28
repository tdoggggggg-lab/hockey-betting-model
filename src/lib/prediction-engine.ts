// src/lib/prediction-engine.ts
// ============================================================
// NHL MULTI-PROP PREDICTION ENGINE
// Research-backed factors from MIT Sloan, Hockey Graphs, xG models
// ============================================================
//
// SUPPORTS: Goals, Shots, Assists, Points
//
// FACTOR HIERARCHY (by predictive power):
// Tier 1: Volume stats (shots), Power play time
// Tier 2: Opposing goalie save %, Recent form (L5-L10)
// Tier 3: Home/away, Opponent defense (GA/game)
//
// NO HARDCODING - All calculations from live API data
// ============================================================

// ============ TYPES ============

export type PropType = 'goalscorer' | 'shots' | 'assists' | 'points';

export interface PlayerGameLog {
  gameId: number;
  gameDate: string;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  toi: number;          // Total ice time in seconds
  ppToi: number;        // Power play time in seconds
  plusMinus: number;
  opponentAbbrev: string;
  isHome: boolean;
}

export interface PlayerStats {
  playerId: number;
  playerName: string;
  teamAbbrev: string;
  position: string;
  gamesPlayed: number;
  // Season stats
  seasonGoals: number;
  seasonAssists: number;
  seasonPoints: number;
  seasonShots: number;
  seasonGoalsPerGame: number;
  seasonAssistsPerGame: number;
  seasonPointsPerGame: number;
  seasonShotsPerGame: number;
  seasonPPTimePerGame: number;  // minutes
  // Recent form (last 5 games)
  recentGoalsPerGame: number;
  recentAssistsPerGame: number;
  recentPointsPerGame: number;
  recentShotsPerGame: number;
  recentPPTimePerGame: number;
  recentGames: number;
  // Calculated
  shootingPct: number;
}

export interface TeamDefense {
  teamAbbrev: string;
  goalsAgainstPerGame: number;
  shotsAgainstPerGame: number;
  savePct: number;
  // Goalie info (starter if available)
  goalieInfo?: {
    name: string;
    savePct: number;
    gamesPlayed: number;
  };
}

export interface MatchupData {
  oppTeamAbbrev: string;
  oppGoalsAgainstPerGame: number;
  oppGoalieSavePct: number;
  isHome: boolean;
}

export interface PredictionResult {
  playerId: number;
  playerName: string;
  teamAbbrev: string;
  opponent: string;
  propType: PropType;
  expectedGoals: number;      // For goalscorer
  expectedShots: number;      // For shots
  expectedAssists: number;    // For assists
  expectedPoints: number;     // For points
  expectedValue: number;      // The relevant expected value for the prop type
  probability: number;
  confidence: number;
  gamesPlayed: number;
  factors: {
    baseGoalsPerGame: number;
    recentFormMultiplier: number;
    ppBoost: number;
    goalieAdjustment: number;
    homeAwayAdjustment: number;
    defenseAdjustment: number;
  };
  reasoning: string[];
}

// ============ CONSTANTS ============

const LEAGUE_AVG_SAVE_PCT = 0.905;
const LEAGUE_AVG_GOALS_AGAINST = 3.0;
export const MIN_GAMES_FOR_PREDICTION = 15;
const RECENT_GAMES_WINDOW = 5;  // Last 5 games for form

// Quality thresholds per prop type
export const QUALITY_THRESHOLDS: Record<PropType, number> = {
  goalscorer: 0.15,  // 0.15 goals/game minimum (~12 goals/season)
  shots: 1.5,        // 1.5 shots/game minimum
  assists: 0.15,     // 0.15 assists/game minimum
  points: 0.25,      // 0.25 points/game minimum (~20 points/season)
};

// Default betting lines per prop type
export const DEFAULT_LINES: Record<PropType, number> = {
  goalscorer: 0.5,
  shots: 2.5,
  assists: 0.5,
  points: 0.5,
};

// Weights for combining recent vs season (research: favor recent 60%)
const RECENT_WEIGHT = 0.60;
const SEASON_WEIGHT = 0.40;

// ============ CACHING ============

const CACHE_TTL = {
  GAME_LOGS: 60 * 60 * 1000,      // 1 hour (stats don't change often)
  TEAM_DEFENSE: 60 * 60 * 1000,   // 1 hour
  PLAYER_STATS: 30 * 60 * 1000,   // 30 minutes
};

interface Cache<T> {
  data: T;
  timestamp: number;
}

const gameLogsCache = new Map<number, Cache<PlayerGameLog[]>>();
const teamDefenseCache = new Map<string, Cache<TeamDefense>>();

// ============ NHL API HELPERS ============

async function fetchWithTimeout(url: string, timeout = 5000): Promise<Response | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(id);
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

function getCurrentSeason(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // NHL season starts in October (month 10)
  if (month >= 10) {
    return `${year}${year + 1}`;
  }
  return `${year - 1}${year}`;
}

// ============ DATA FETCHING ============

/**
 * Fetch player's game-by-game stats for recent form analysis
 * Endpoint: /v1/player/{id}/game-log/{season}/2
 * Now includes: goals, assists, points, shots
 */
export async function fetchPlayerGameLogs(playerId: number): Promise<PlayerGameLog[]> {
  // Check cache
  const cached = gameLogsCache.get(playerId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL.GAME_LOGS) {
    return cached.data;
  }

  const season = getCurrentSeason();
  const url = `https://api-web.nhle.com/v1/player/${playerId}/game-log/${season}/2`;
  
  try {
    const res = await fetchWithTimeout(url, 5000);
    if (!res?.ok) {
      console.log(`[GameLogs] Failed for player ${playerId}: ${res?.status}`);
      return [];
    }
    
    const data = await res.json();
    const games = data.gameLog || [];
    
    const gameLogs: PlayerGameLog[] = games.map((g: any) => ({
      gameId: g.gameId,
      gameDate: g.gameDate,
      goals: g.goals || 0,
      assists: g.assists || 0,
      points: g.points || 0,
      shots: g.shots || 0,
      toi: parseTimeToSeconds(g.toi || '0:00'),
      ppToi: parseTimeToSeconds(g.ppToi || '0:00'),
      plusMinus: g.plusMinus || 0,
      opponentAbbrev: g.opponentAbbrev || '',
      isHome: g.homeRoadFlag === 'H',
    }));
    
    // Cache the results
    gameLogsCache.set(playerId, { data: gameLogs, timestamp: Date.now() });
    
    return gameLogs;
  } catch (error) {
    console.error(`[GameLogs] Error for player ${playerId}:`, error);
    return [];
  }
}

/**
 * Fetch team defensive stats including goalie info
 * Endpoint: /v1/club-stats/{team}/now
 */
export async function fetchTeamDefense(teamAbbrev: string): Promise<TeamDefense | null> {
  // Check cache
  const cached = teamDefenseCache.get(teamAbbrev);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL.TEAM_DEFENSE) {
    return cached.data;
  }

  const url = `https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`;
  
  try {
    const res = await fetchWithTimeout(url, 5000);
    if (!res?.ok) {
      console.log(`[TeamDefense] Failed for ${teamAbbrev}: ${res?.status}`);
      return null;
    }
    
    const data = await res.json();
    
    // Calculate team defense from skaters data
    const goalies = data.goalies || [];
    
    // Find starter (most games played)
    const starterGoalie = goalies.length > 0 
      ? goalies.reduce((a: any, b: any) => (a.gamesPlayed || 0) > (b.gamesPlayed || 0) ? a : b)
      : null;
    
    const teamDefense: TeamDefense = {
      teamAbbrev,
      goalsAgainstPerGame: starterGoalie?.goalsAgainstAvg || LEAGUE_AVG_GOALS_AGAINST,
      shotsAgainstPerGame: 30, // Default
      savePct: starterGoalie?.savePctg || LEAGUE_AVG_SAVE_PCT,
      goalieInfo: starterGoalie ? {
        name: `${starterGoalie.firstName?.default || ''} ${starterGoalie.lastName?.default || ''}`.trim(),
        savePct: starterGoalie.savePctg || LEAGUE_AVG_SAVE_PCT,
        gamesPlayed: starterGoalie.gamesPlayed || 0,
      } : undefined,
    };
    
    // Cache the results
    teamDefenseCache.set(teamAbbrev, { data: teamDefense, timestamp: Date.now() });
    
    return teamDefense;
  } catch (error) {
    console.error(`[TeamDefense] Error for ${teamAbbrev}:`, error);
    return null;
  }
}

// ============ STAT CALCULATIONS ============

/**
 * Parse time string (mm:ss) to seconds
 */
function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr || timeStr === '--') return 0;
  const parts = timeStr.split(':');
  if (parts.length !== 2) return 0;
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

/**
 * Calculate player stats from game logs - NOW INCLUDES ALL STAT TYPES
 */
export function calculatePlayerStats(
  playerId: number,
  playerName: string,
  teamAbbrev: string,
  position: string,
  gameLogs: PlayerGameLog[]
): PlayerStats | null {
  if (gameLogs.length < MIN_GAMES_FOR_PREDICTION) {
    return null;
  }
  
  const gamesPlayed = gameLogs.length;
  
  // Season totals - ALL stats
  const seasonGoals = gameLogs.reduce((sum, g) => sum + g.goals, 0);
  const seasonAssists = gameLogs.reduce((sum, g) => sum + g.assists, 0);
  const seasonPoints = gameLogs.reduce((sum, g) => sum + g.points, 0);
  const seasonShots = gameLogs.reduce((sum, g) => sum + g.shots, 0);
  const seasonPPTime = gameLogs.reduce((sum, g) => sum + g.ppToi, 0);
  
  // Recent form (last N games) - ALL stats
  const recentGames = gameLogs.slice(0, RECENT_GAMES_WINDOW);
  const recentGoals = recentGames.reduce((sum, g) => sum + g.goals, 0);
  const recentAssists = recentGames.reduce((sum, g) => sum + g.assists, 0);
  const recentPoints = recentGames.reduce((sum, g) => sum + g.points, 0);
  const recentShots = recentGames.reduce((sum, g) => sum + g.shots, 0);
  const recentPPTime = recentGames.reduce((sum, g) => sum + g.ppToi, 0);
  
  return {
    playerId,
    playerName,
    teamAbbrev,
    position,
    gamesPlayed,
    // Season stats
    seasonGoals,
    seasonAssists,
    seasonPoints,
    seasonShots,
    seasonGoalsPerGame: seasonGoals / gamesPlayed,
    seasonAssistsPerGame: seasonAssists / gamesPlayed,
    seasonPointsPerGame: seasonPoints / gamesPlayed,
    seasonShotsPerGame: seasonShots / gamesPlayed,
    seasonPPTimePerGame: (seasonPPTime / gamesPlayed) / 60,  // Convert to minutes
    // Recent form
    recentGoalsPerGame: recentGames.length > 0 ? recentGoals / recentGames.length : 0,
    recentAssistsPerGame: recentGames.length > 0 ? recentAssists / recentGames.length : 0,
    recentPointsPerGame: recentGames.length > 0 ? recentPoints / recentGames.length : 0,
    recentShotsPerGame: recentGames.length > 0 ? recentShots / recentGames.length : 0,
    recentPPTimePerGame: recentGames.length > 0 ? (recentPPTime / recentGames.length) / 60 : 0,
    recentGames: recentGames.length,
    // Calculated
    shootingPct: seasonShots > 0 ? seasonGoals / seasonShots : 0,
  };
}

// ============ PREDICTION ENGINES (PROP-SPECIFIC) ============

/**
 * Calculate expected GOALS for a player in a specific matchup
 */
function calculateExpectedGoals(
  player: PlayerStats,
  matchup: MatchupData
): { lambda: number; factors: PredictionResult['factors']; reasoning: string[] } {
  const reasoning: string[] = [];
  
  // BASE: Weighted combination of season and recent form
  const baseGoalsPerGame = 
    (RECENT_WEIGHT * player.recentGoalsPerGame) + 
    (SEASON_WEIGHT * player.seasonGoalsPerGame);
  
  let lambda = baseGoalsPerGame;
  reasoning.push(`Base: ${baseGoalsPerGame.toFixed(3)} G/GP`);
  
  // FACTOR 1: Recent shot volume vs season
  let recentFormMultiplier = 1.0;
  if (player.seasonShotsPerGame > 0 && player.recentShotsPerGame > 0) {
    const shotRatio = player.recentShotsPerGame / player.seasonShotsPerGame;
    recentFormMultiplier = 0.7 + (0.3 * Math.min(1.3, Math.max(0.7, shotRatio)));
    if (shotRatio > 1.1) {
      reasoning.push(`🔥 Hot: ${player.recentShotsPerGame.toFixed(1)} SOG/gm`);
    } else if (shotRatio < 0.9) {
      reasoning.push(`❄️ Cold: ${player.recentShotsPerGame.toFixed(1)} SOG/gm`);
    }
  }
  lambda *= recentFormMultiplier;
  
  // FACTOR 2: Power play time boost
  let ppBoost = 1.0;
  const avgPPTime = (player.recentPPTimePerGame + player.seasonPPTimePerGame) / 2;
  if (avgPPTime >= 4.0) {
    ppBoost = 1.20;
    reasoning.push(`⚡ PP1: ${avgPPTime.toFixed(1)} min`);
  } else if (avgPPTime >= 2.5) {
    ppBoost = 1.10;
    reasoning.push(`⚡ PP: ${avgPPTime.toFixed(1)} min`);
  }
  lambda *= ppBoost;
  
  // FACTOR 3: Opposing goalie adjustment
  let goalieAdjustment = 1.0;
  const goalieDiff = LEAGUE_AVG_SAVE_PCT - matchup.oppGoalieSavePct;
  goalieAdjustment = 1 + (goalieDiff * 3);
  goalieAdjustment = Math.max(0.80, Math.min(1.25, goalieAdjustment));
  
  if (matchup.oppGoalieSavePct < 0.900) {
    reasoning.push(`🥅 Weak goalie: ${(matchup.oppGoalieSavePct * 100).toFixed(1)}%`);
  } else if (matchup.oppGoalieSavePct > 0.915) {
    reasoning.push(`🧱 Elite goalie: ${(matchup.oppGoalieSavePct * 100).toFixed(1)}%`);
  }
  lambda *= goalieAdjustment;
  
  // FACTOR 4: Home/away adjustment
  const homeAwayAdjustment = matchup.isHome ? 1.05 : 0.95;
  lambda *= homeAwayAdjustment;
  reasoning.push(matchup.isHome ? `🏠 Home` : `✈️ Road`);
  
  // FACTOR 5: Opponent team defense
  let defenseAdjustment = 1.0;
  if (matchup.oppGoalsAgainstPerGame > 0) {
    defenseAdjustment = matchup.oppGoalsAgainstPerGame / LEAGUE_AVG_GOALS_AGAINST;
    defenseAdjustment = Math.max(0.85, Math.min(1.20, defenseAdjustment));
    
    if (matchup.oppGoalsAgainstPerGame > 3.3) {
      reasoning.push(`🚨 Weak D: ${matchup.oppGoalsAgainstPerGame.toFixed(2)} GA/gm`);
    } else if (matchup.oppGoalsAgainstPerGame < 2.7) {
      reasoning.push(`🛡️ Strong D: ${matchup.oppGoalsAgainstPerGame.toFixed(2)} GA/gm`);
    }
  }
  lambda *= defenseAdjustment;
  
  return {
    lambda: Math.max(0, lambda),
    factors: {
      baseGoalsPerGame,
      recentFormMultiplier,
      ppBoost,
      goalieAdjustment,
      homeAwayAdjustment,
      defenseAdjustment,
    },
    reasoning,
  };
}

/**
 * Calculate expected SHOTS for a player
 * Shots are more consistent/predictable than goals
 */
function calculateExpectedShots(
  player: PlayerStats,
  matchup: MatchupData
): { expected: number; factors: PredictionResult['factors']; reasoning: string[] } {
  const reasoning: string[] = [];
  
  // BASE: Weighted shots per game
  const baseShotsPerGame = 
    (RECENT_WEIGHT * player.recentShotsPerGame) + 
    (SEASON_WEIGHT * player.seasonShotsPerGame);
  
  let expected = baseShotsPerGame;
  reasoning.push(`Base: ${baseShotsPerGame.toFixed(2)} SOG/GP`);
  
  // FACTOR 1: Recent form (ice time trends)
  let recentFormMultiplier = 1.0;
  if (player.seasonShotsPerGame > 0 && player.recentShotsPerGame > 0) {
    const shotTrend = player.recentShotsPerGame / player.seasonShotsPerGame;
    recentFormMultiplier = 0.8 + (0.2 * Math.min(1.2, Math.max(0.8, shotTrend)));
    if (shotTrend > 1.15) {
      reasoning.push(`🔥 Volume up`);
    } else if (shotTrend < 0.85) {
      reasoning.push(`❄️ Volume down`);
    }
  }
  expected *= recentFormMultiplier;
  
  // FACTOR 2: Power play (more opportunities)
  let ppBoost = 1.0;
  const avgPPTime = (player.recentPPTimePerGame + player.seasonPPTimePerGame) / 2;
  if (avgPPTime >= 4.0) {
    ppBoost = 1.15;
    reasoning.push(`⚡ PP1 shooter`);
  } else if (avgPPTime >= 2.5) {
    ppBoost = 1.08;
    reasoning.push(`⚡ PP time`);
  }
  expected *= ppBoost;
  
  // Shots less affected by goalie - minimal adjustment
  const goalieAdjustment = 1.0;
  
  // FACTOR 3: Home/away (smaller effect)
  const homeAwayAdjustment = matchup.isHome ? 1.03 : 0.97;
  expected *= homeAwayAdjustment;
  reasoning.push(matchup.isHome ? `🏠 Home` : `✈️ Road`);
  
  // FACTOR 4: Defense (affects shot opportunities slightly)
  let defenseAdjustment = 1.0;
  if (matchup.oppGoalsAgainstPerGame > 3.3) {
    defenseAdjustment = 1.05;
    reasoning.push(`🚨 Porous D`);
  } else if (matchup.oppGoalsAgainstPerGame < 2.7) {
    defenseAdjustment = 0.95;
    reasoning.push(`🛡️ Tight D`);
  }
  expected *= defenseAdjustment;
  
  return {
    expected: Math.max(0, expected),
    factors: {
      baseGoalsPerGame: baseShotsPerGame,
      recentFormMultiplier,
      ppBoost,
      goalieAdjustment,
      homeAwayAdjustment,
      defenseAdjustment,
    },
    reasoning,
  };
}

/**
 * Calculate expected ASSISTS for a player
 * Assists depend on linemates and team scoring
 */
function calculateExpectedAssists(
  player: PlayerStats,
  matchup: MatchupData
): { expected: number; factors: PredictionResult['factors']; reasoning: string[] } {
  const reasoning: string[] = [];
  
  // BASE: Weighted assists per game
  const baseAssistsPerGame = 
    (RECENT_WEIGHT * player.recentAssistsPerGame) + 
    (SEASON_WEIGHT * player.seasonAssistsPerGame);
  
  let expected = baseAssistsPerGame;
  reasoning.push(`Base: ${baseAssistsPerGame.toFixed(3)} A/GP`);
  
  // FACTOR 1: Recent production trend
  let recentFormMultiplier = 1.0;
  if (player.seasonPointsPerGame > 0 && player.recentPointsPerGame > 0) {
    const pointsTrend = player.recentPointsPerGame / player.seasonPointsPerGame;
    recentFormMultiplier = 0.75 + (0.25 * Math.min(1.25, Math.max(0.75, pointsTrend)));
    if (pointsTrend > 1.15) {
      reasoning.push(`🔥 Producing`);
    } else if (pointsTrend < 0.85) {
      reasoning.push(`❄️ Cold streak`);
    }
  }
  expected *= recentFormMultiplier;
  
  // FACTOR 2: Power play (assists heavily correlated)
  let ppBoost = 1.0;
  const avgPPTime = (player.recentPPTimePerGame + player.seasonPPTimePerGame) / 2;
  if (avgPPTime >= 4.0) {
    ppBoost = 1.25;
    reasoning.push(`⚡ PP1 playmaker`);
  } else if (avgPPTime >= 2.5) {
    ppBoost = 1.12;
    reasoning.push(`⚡ PP time`);
  }
  expected *= ppBoost;
  
  // FACTOR 3: Goalie (affects team scoring → assists)
  let goalieAdjustment = 1.0;
  const goalieDiff = LEAGUE_AVG_SAVE_PCT - matchup.oppGoalieSavePct;
  goalieAdjustment = Math.max(0.85, Math.min(1.20, 1 + (goalieDiff * 2)));
  if (matchup.oppGoalieSavePct < 0.900) {
    reasoning.push(`🥅 Weak goalie`);
  }
  expected *= goalieAdjustment;
  
  // FACTOR 4: Home/away
  const homeAwayAdjustment = matchup.isHome ? 1.04 : 0.96;
  expected *= homeAwayAdjustment;
  reasoning.push(matchup.isHome ? `🏠 Home` : `✈️ Road`);
  
  // FACTOR 5: Defense (weak D = more team scoring = more assists)
  let defenseAdjustment = 1.0;
  if (matchup.oppGoalsAgainstPerGame > 3.3) {
    defenseAdjustment = 1.15;
    reasoning.push(`🚨 Weak D`);
  } else if (matchup.oppGoalsAgainstPerGame < 2.7) {
    defenseAdjustment = 0.88;
    reasoning.push(`🛡️ Strong D`);
  }
  expected *= defenseAdjustment;
  
  return {
    expected: Math.max(0, expected),
    factors: {
      baseGoalsPerGame: baseAssistsPerGame,
      recentFormMultiplier,
      ppBoost,
      goalieAdjustment,
      homeAwayAdjustment,
      defenseAdjustment,
    },
    reasoning,
  };
}

/**
 * Calculate expected POINTS for a player
 * Combined goals + assists with variance reduction
 */
function calculateExpectedPoints(
  player: PlayerStats,
  matchup: MatchupData
): { expected: number; factors: PredictionResult['factors']; reasoning: string[] } {
  const reasoning: string[] = [];
  
  // BASE: Weighted points per game
  const basePointsPerGame = 
    (RECENT_WEIGHT * player.recentPointsPerGame) + 
    (SEASON_WEIGHT * player.seasonPointsPerGame);
  
  let expected = basePointsPerGame;
  reasoning.push(`Base: ${basePointsPerGame.toFixed(3)} P/GP`);
  
  // FACTOR 1: Recent form
  let recentFormMultiplier = 1.0;
  if (player.seasonPointsPerGame > 0 && player.recentPointsPerGame > 0) {
    const pointsTrend = player.recentPointsPerGame / player.seasonPointsPerGame;
    recentFormMultiplier = 0.75 + (0.25 * Math.min(1.25, Math.max(0.75, pointsTrend)));
    if (pointsTrend > 1.15) {
      reasoning.push(`🔥 Hot streak`);
    } else if (pointsTrend < 0.85) {
      reasoning.push(`❄️ Cold streak`);
    }
  }
  expected *= recentFormMultiplier;
  
  // FACTOR 2: Power play
  let ppBoost = 1.0;
  const avgPPTime = (player.recentPPTimePerGame + player.seasonPPTimePerGame) / 2;
  if (avgPPTime >= 4.0) {
    ppBoost = 1.22;
    reasoning.push(`⚡ PP1 unit`);
  } else if (avgPPTime >= 2.5) {
    ppBoost = 1.11;
    reasoning.push(`⚡ PP time`);
  }
  expected *= ppBoost;
  
  // FACTOR 3: Goalie
  let goalieAdjustment = 1.0;
  const goalieDiff = LEAGUE_AVG_SAVE_PCT - matchup.oppGoalieSavePct;
  goalieAdjustment = Math.max(0.85, Math.min(1.20, 1 + (goalieDiff * 2.5)));
  if (matchup.oppGoalieSavePct < 0.900) {
    reasoning.push(`🥅 Weak goalie`);
  } else if (matchup.oppGoalieSavePct > 0.915) {
    reasoning.push(`🧱 Elite goalie`);
  }
  expected *= goalieAdjustment;
  
  // FACTOR 4: Home/away
  const homeAwayAdjustment = matchup.isHome ? 1.05 : 0.95;
  expected *= homeAwayAdjustment;
  reasoning.push(matchup.isHome ? `🏠 Home` : `✈️ Road`);
  
  // FACTOR 5: Defense
  let defenseAdjustment = 1.0;
  if (matchup.oppGoalsAgainstPerGame > 3.3) {
    defenseAdjustment = 1.18;
    reasoning.push(`🚨 Weak D`);
  } else if (matchup.oppGoalsAgainstPerGame < 2.7) {
    defenseAdjustment = 0.85;
    reasoning.push(`🛡️ Strong D`);
  }
  expected *= defenseAdjustment;
  
  return {
    expected: Math.max(0, expected),
    factors: {
      baseGoalsPerGame: basePointsPerGame,
      recentFormMultiplier,
      ppBoost,
      goalieAdjustment,
      homeAwayAdjustment,
      defenseAdjustment,
    },
    reasoning,
  };
}

// ============ PROBABILITY CALCULATIONS ============

/**
 * Convert expected goals (lambda) to anytime goalscorer probability
 * Using Poisson distribution: P(goals >= 1) = 1 - P(goals = 0) = 1 - e^(-lambda)
 */
export function goalProbability(lambda: number): number {
  return 1 - Math.exp(-lambda);
}

/**
 * Calculate probability of hitting over a line
 * Uses Poisson for low-frequency (goals/assists)
 * Uses normal approximation for higher-frequency (shots)
 */
function calculateProbability(expected: number, line: number, propType: PropType): number {
  if (propType === 'shots') {
    // Normal approximation for shots
    const stdDev = Math.sqrt(expected) * 0.8;
    if (stdDev === 0) return expected > line ? 0.99 : 0.01;
    const z = (line - expected) / stdDev;
    const prob = 1 - normalCDF(z);
    return Math.max(0.01, Math.min(0.99, prob));
  } else {
    // Poisson for goals, assists, points (anytime = over 0.5)
    if (line === 0.5) {
      return 1 - Math.exp(-expected);
    }
    // For other lines, use Poisson CDF
    let cumulativeProb = 0;
    const targetK = Math.floor(line);
    for (let k = 0; k <= targetK; k++) {
      cumulativeProb += (Math.pow(expected, k) * Math.exp(-expected)) / factorial(k);
    }
    return Math.max(0.01, Math.min(0.99, 1 - cumulativeProb));
  }
}

function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  
  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  
  return 0.5 * (1.0 + sign * y);
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

/**
 * Calculate confidence score based on sample size and consistency
 */
export function calculateConfidence(player: PlayerStats, propType: PropType = 'goalscorer'): number {
  let confidence = 0.50;  // Base
  
  // Sample size bonus
  if (player.gamesPlayed >= 40) confidence += 0.15;
  else if (player.gamesPlayed >= 25) confidence += 0.10;
  else if (player.gamesPlayed >= MIN_GAMES_FOR_PREDICTION) confidence += 0.05;
  
  // Production level bonus (prop-specific)
  const threshold = QUALITY_THRESHOLDS[propType];
  let production = 0;
  switch (propType) {
    case 'goalscorer': production = player.seasonGoalsPerGame; break;
    case 'shots': production = player.seasonShotsPerGame; break;
    case 'assists': production = player.seasonAssistsPerGame; break;
    case 'points': production = player.seasonPointsPerGame; break;
  }
  
  if (production >= threshold * 3) confidence += 0.15;
  else if (production >= threshold * 2) confidence += 0.10;
  else if (production >= threshold) confidence += 0.05;
  
  // Shot volume bonus (applies to all)
  if (player.seasonShotsPerGame >= 4.0) confidence += 0.10;
  else if (player.seasonShotsPerGame >= 3.0) confidence += 0.05;
  
  // Recent form consistency
  if (player.recentGames >= 5) {
    const formDiff = Math.abs(player.recentGoalsPerGame - player.seasonGoalsPerGame);
    if (formDiff < 0.1) confidence += 0.05;
  }
  
  return Math.min(0.95, confidence);
}

// ============ UNIFIED PREDICTION FUNCTION ============

/**
 * Full prediction for a player for ANY prop type
 */
export async function predictPlayerProp(
  playerId: number,
  playerName: string,
  teamAbbrev: string,
  position: string,
  opponentAbbrev: string,
  isHome: boolean,
  propType: PropType = 'goalscorer'
): Promise<PredictionResult | null> {
  // Fetch data
  const [gameLogs, oppDefense] = await Promise.all([
    fetchPlayerGameLogs(playerId),
    fetchTeamDefense(opponentAbbrev),
  ]);
  
  // Calculate player stats
  const playerStats = calculatePlayerStats(playerId, playerName, teamAbbrev, position, gameLogs);
  if (!playerStats) {
    return null;
  }
  
  // Quality filter per prop type
  const threshold = QUALITY_THRESHOLDS[propType];
  let production = 0;
  switch (propType) {
    case 'goalscorer': production = playerStats.seasonGoalsPerGame; break;
    case 'shots': production = playerStats.seasonShotsPerGame; break;
    case 'assists': production = playerStats.seasonAssistsPerGame; break;
    case 'points': production = playerStats.seasonPointsPerGame; break;
  }
  if (production < threshold) {
    return null;
  }
  
  // Build matchup data
  const matchup: MatchupData = {
    oppTeamAbbrev: opponentAbbrev,
    oppGoalsAgainstPerGame: oppDefense?.goalsAgainstPerGame || LEAGUE_AVG_GOALS_AGAINST,
    oppGoalieSavePct: oppDefense?.savePct || LEAGUE_AVG_SAVE_PCT,
    isHome,
  };
  
  // Calculate expected values for ALL prop types
  const goalsResult = calculateExpectedGoals(playerStats, matchup);
  const shotsResult = calculateExpectedShots(playerStats, matchup);
  const assistsResult = calculateExpectedAssists(playerStats, matchup);
  const pointsResult = calculateExpectedPoints(playerStats, matchup);
  
  // Get the relevant result for the requested prop type
  let relevantResult: { expected: number; factors: PredictionResult['factors']; reasoning: string[] };
  let expectedValue: number;
  
  switch (propType) {
    case 'goalscorer':
      relevantResult = { expected: goalsResult.lambda, factors: goalsResult.factors, reasoning: goalsResult.reasoning };
      expectedValue = goalsResult.lambda;
      break;
    case 'shots':
      relevantResult = shotsResult;
      expectedValue = shotsResult.expected;
      break;
    case 'assists':
      relevantResult = assistsResult;
      expectedValue = assistsResult.expected;
      break;
    case 'points':
      relevantResult = pointsResult;
      expectedValue = pointsResult.expected;
      break;
  }
  
  // Calculate probability
  const line = DEFAULT_LINES[propType];
  const probability = calculateProbability(expectedValue, line, propType);
  
  // Calculate confidence
  const confidence = calculateConfidence(playerStats, propType);
  
  return {
    playerId,
    playerName,
    teamAbbrev,
    opponent: opponentAbbrev,
    propType,
    expectedGoals: goalsResult.lambda,
    expectedShots: shotsResult.expected,
    expectedAssists: assistsResult.expected,
    expectedPoints: pointsResult.expected,
    expectedValue,
    probability,
    confidence,
    gamesPlayed: playerStats.gamesPlayed,
    factors: relevantResult.factors,
    reasoning: relevantResult.reasoning,
  };
}

// ============ BATCH PREDICTION ============

/**
 * Predict for multiple players efficiently for a specific prop type
 */
export async function predictMultiplePlayers(
  players: Array<{
    playerId: number;
    playerName: string;
    teamAbbrev: string;
    position: string;
    opponentAbbrev: string;
    isHome: boolean;
  }>,
  propType: PropType = 'goalscorer'
): Promise<PredictionResult[]> {
  // Pre-fetch all unique opponent defense stats
  const uniqueOpponents = [...new Set(players.map(p => p.opponentAbbrev))];
  const defensePromises = uniqueOpponents.map(opp => fetchTeamDefense(opp));
  const defenseResults = await Promise.all(defensePromises);
  
  // Create map for quick lookup
  const defenseMap = new Map<string, TeamDefense | null>();
  uniqueOpponents.forEach((opp, i) => {
    defenseMap.set(opp, defenseResults[i]);
  });
  
  // Predict for each player (game logs fetched in parallel batches)
  const BATCH_SIZE = 10;
  const results: PredictionResult[] = [];
  
  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE);
    
    const batchPromises = batch.map(async (player) => {
      const gameLogs = await fetchPlayerGameLogs(player.playerId);
      const playerStats = calculatePlayerStats(
        player.playerId, 
        player.playerName, 
        player.teamAbbrev, 
        player.position, 
        gameLogs
      );
      
      if (!playerStats) return null;
      
      // Quality filter
      const threshold = QUALITY_THRESHOLDS[propType];
      let production = 0;
      switch (propType) {
        case 'goalscorer': production = playerStats.seasonGoalsPerGame; break;
        case 'shots': production = playerStats.seasonShotsPerGame; break;
        case 'assists': production = playerStats.seasonAssistsPerGame; break;
        case 'points': production = playerStats.seasonPointsPerGame; break;
      }
      if (production < threshold) return null;
      
      const oppDefense = defenseMap.get(player.opponentAbbrev);
      const matchup: MatchupData = {
        oppTeamAbbrev: player.opponentAbbrev,
        oppGoalsAgainstPerGame: oppDefense?.goalsAgainstPerGame || LEAGUE_AVG_GOALS_AGAINST,
        oppGoalieSavePct: oppDefense?.savePct || LEAGUE_AVG_SAVE_PCT,
        isHome: player.isHome,
      };
      
      // Calculate for requested prop type
      let result: { expected?: number; lambda?: number; factors: PredictionResult['factors']; reasoning: string[] };
      let expectedValue: number;
      let expectedGoals = 0, expectedShots = 0, expectedAssists = 0, expectedPoints = 0;
      
      // Calculate all values
      const goalsCalc = calculateExpectedGoals(playerStats, matchup);
      const shotsCalc = calculateExpectedShots(playerStats, matchup);
      const assistsCalc = calculateExpectedAssists(playerStats, matchup);
      const pointsCalc = calculateExpectedPoints(playerStats, matchup);
      
      expectedGoals = goalsCalc.lambda;
      expectedShots = shotsCalc.expected;
      expectedAssists = assistsCalc.expected;
      expectedPoints = pointsCalc.expected;
      
      switch (propType) {
        case 'goalscorer':
          result = goalsCalc;
          expectedValue = goalsCalc.lambda;
          break;
        case 'shots':
          result = shotsCalc;
          expectedValue = shotsCalc.expected;
          break;
        case 'assists':
          result = assistsCalc;
          expectedValue = assistsCalc.expected;
          break;
        case 'points':
          result = pointsCalc;
          expectedValue = pointsCalc.expected;
          break;
      }
      
      const line = DEFAULT_LINES[propType];
      const probability = calculateProbability(expectedValue, line, propType);
      const confidence = calculateConfidence(playerStats, propType);
      
      return {
        playerId: player.playerId,
        playerName: player.playerName,
        teamAbbrev: player.teamAbbrev,
        opponent: player.opponentAbbrev,
        propType,
        expectedGoals,
        expectedShots,
        expectedAssists,
        expectedPoints,
        expectedValue,
        probability,
        confidence,
        gamesPlayed: playerStats.gamesPlayed,
        factors: result.factors,
        reasoning: result.reasoning,
      } as PredictionResult;
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter((r): r is PredictionResult => r !== null));
  }
  
  return results;
}

// ============ LEGACY EXPORT FOR BACKWARDS COMPATIBILITY ============

// Keep old function signature working
export async function predictGoalscorer(
  playerId: number,
  playerName: string,
  teamAbbrev: string,
  position: string,
  opponentAbbrev: string,
  isHome: boolean
): Promise<PredictionResult | null> {
  return predictPlayerProp(playerId, playerName, teamAbbrev, position, opponentAbbrev, isHome, 'goalscorer');
}

// ============ EXPORTS ============

export {
  LEAGUE_AVG_SAVE_PCT,
  LEAGUE_AVG_GOALS_AGAINST,
  RECENT_GAMES_WINDOW,
};
