/**
 * NHL Player Stats Service
 * Fetches real player statistics from NHL API for prop predictions
 */

const NHL_API_BASE = 'https://api-web.nhle.com/v1';
const NHL_STATS_API = 'https://api.nhle.com/stats/rest/en';

// Player info cache to avoid repeated lookups
const playerCache: Map<string, any> = new Map();

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
  timeOnIce: number; // in seconds per game
  powerPlayGoals: number;
  powerPlayPoints: number;
  powerPlayTimeOnIce: number;
  // Per game averages
  goalsPerGame: number;
  assistsPerGame: number;
  pointsPerGame: number;
  shotsPerGame: number;
  // Recent form (last 10 games)
  recentGoalsPerGame: number;
  recentShotsPerGame: number;
  recentPointsPerGame: number;
}

export interface GoalieStats {
  playerId: number;
  name: string;
  team: string;
  teamAbbrev: string;
  gamesPlayed: number;
  gamesStarted: number;
  wins: number;
  losses: number;
  savePct: number;
  goalsAgainstAvg: number;
  saves: number;
  shotsAgainst: number;
  savesPerGame: number;
}

export interface TeamStats {
  teamId: number;
  teamAbbrev: string;
  teamName: string;
  goalsFor: number;
  goalsAgainst: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  powerPlayPct: number;
  penaltyKillPct: number;
  shotsForPerGame: number;
  shotsAgainstPerGame: number;
}

/**
 * Fetch roster for a team to get player IDs
 */
export async function getTeamRoster(teamAbbrev: string): Promise<any[]> {
  try {
    const response = await fetch(`${NHL_API_BASE}/roster/${teamAbbrev}/current`);
    if (!response.ok) throw new Error(`Failed to fetch roster: ${response.status}`);
    
    const data = await response.json();
    const players: any[] = [];
    
    // Combine forwards, defensemen, goalies
    if (data.forwards) players.push(...data.forwards);
    if (data.defensemen) players.push(...data.defensemen);
    if (data.goalies) players.push(...data.goalies);
    
    return players;
  } catch (error) {
    console.error(`Error fetching roster for ${teamAbbrev}:`, error);
    return [];
  }
}

/**
 * Fetch player's game log for current season
 */
export async function getPlayerGameLog(playerId: number): Promise<any[]> {
  try {
    const response = await fetch(`${NHL_API_BASE}/player/${playerId}/game-log/now`);
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.gameLog || [];
  } catch (error) {
    console.error(`Error fetching game log for player ${playerId}:`, error);
    return [];
  }
}

/**
 * Calculate player stats from game log
 */
export function calculatePlayerStats(
  playerId: number,
  playerInfo: any,
  gameLog: any[],
  teamAbbrev: string
): PlayerStats | null {
  if (!gameLog || gameLog.length === 0) return null;
  
  const gamesPlayed = gameLog.length;
  
  // Sum up totals
  let totalGoals = 0;
  let totalAssists = 0;
  let totalShots = 0;
  let totalTOI = 0;
  let totalPPGoals = 0;
  let totalPPPoints = 0;
  let totalPPTOI = 0;
  
  gameLog.forEach(game => {
    totalGoals += game.goals || 0;
    totalAssists += game.assists || 0;
    totalShots += game.shots || 0;
    totalPPGoals += game.powerPlayGoals || 0;
    totalPPPoints += game.powerPlayPoints || 0;
    
    // Parse TOI string (e.g., "21:35" -> seconds)
    if (game.toi) {
      const [min, sec] = game.toi.split(':').map(Number);
      totalTOI += (min * 60) + (sec || 0);
    }
    if (game.ppToi) {
      const [min, sec] = game.ppToi.split(':').map(Number);
      totalPPTOI += (min * 60) + (sec || 0);
    }
  });
  
  // Calculate recent form (last 10 games)
  const recentGames = gameLog.slice(0, 10);
  const recentGP = recentGames.length;
  let recentGoals = 0;
  let recentShots = 0;
  let recentPoints = 0;
  
  recentGames.forEach(game => {
    recentGoals += game.goals || 0;
    recentShots += game.shots || 0;
    recentPoints += (game.goals || 0) + (game.assists || 0);
  });
  
  const firstName = playerInfo.firstName?.default || playerInfo.firstName || '';
  const lastName = playerInfo.lastName?.default || playerInfo.lastName || '';
  
  return {
    playerId,
    name: `${firstName} ${lastName}`.trim(),
    team: teamAbbrev,
    teamAbbrev,
    position: playerInfo.positionCode || 'F',
    gamesPlayed,
    goals: totalGoals,
    assists: totalAssists,
    points: totalGoals + totalAssists,
    shots: totalShots,
    timeOnIce: gamesPlayed > 0 ? totalTOI / gamesPlayed : 0,
    powerPlayGoals: totalPPGoals,
    powerPlayPoints: totalPPPoints,
    powerPlayTimeOnIce: gamesPlayed > 0 ? totalPPTOI / gamesPlayed : 0,
    // Per game averages
    goalsPerGame: gamesPlayed > 0 ? totalGoals / gamesPlayed : 0,
    assistsPerGame: gamesPlayed > 0 ? totalAssists / gamesPlayed : 0,
    pointsPerGame: gamesPlayed > 0 ? (totalGoals + totalAssists) / gamesPlayed : 0,
    shotsPerGame: gamesPlayed > 0 ? totalShots / gamesPlayed : 0,
    // Recent form
    recentGoalsPerGame: recentGP > 0 ? recentGoals / recentGP : 0,
    recentShotsPerGame: recentGP > 0 ? recentShots / recentGP : 0,
    recentPointsPerGame: recentGP > 0 ? recentPoints / recentGP : 0,
  };
}

/**
 * Get all skater stats for teams playing today
 */
export async function getPlayersForTeam(teamAbbrev: string): Promise<PlayerStats[]> {
  try {
    const roster = await getTeamRoster(teamAbbrev);
    const players: PlayerStats[] = [];
    
    // Filter to only skaters (not goalies) and fetch their stats
    const skaters = roster.filter(p => p.positionCode !== 'G');
    
    // Fetch game logs in parallel (limit to avoid rate limiting)
    const batchSize = 5;
    for (let i = 0; i < skaters.length; i += batchSize) {
      const batch = skaters.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (player) => {
          const gameLog = await getPlayerGameLog(player.id);
          return calculatePlayerStats(player.id, player, gameLog, teamAbbrev);
        })
      );
      
      results.forEach(stats => {
        if (stats && stats.gamesPlayed >= 5) { // Only include players with 5+ games
          players.push(stats);
        }
      });
    }
    
    return players;
  } catch (error) {
    console.error(`Error fetching players for ${teamAbbrev}:`, error);
    return [];
  }
}

/**
 * Get goalie stats for a team
 */
export async function getGoalieStats(teamAbbrev: string): Promise<GoalieStats[]> {
  try {
    const roster = await getTeamRoster(teamAbbrev);
    const goalies = roster.filter(p => p.positionCode === 'G');
    const goalieStats: GoalieStats[] = [];
    
    for (const goalie of goalies) {
      const gameLog = await getPlayerGameLog(goalie.id);
      if (gameLog.length === 0) continue;
      
      let totalSaves = 0;
      let totalShotsAgainst = 0;
      let totalGoalsAgainst = 0;
      let wins = 0;
      let losses = 0;
      
      gameLog.forEach((game: any) => {
        totalSaves += game.saves || 0;
        totalShotsAgainst += game.shotsAgainst || 0;
        totalGoalsAgainst += game.goalsAgainst || 0;
        if (game.decision === 'W') wins++;
        if (game.decision === 'L' || game.decision === 'O') losses++;
      });
      
      const firstName = goalie.firstName?.default || goalie.firstName || '';
      const lastName = goalie.lastName?.default || goalie.lastName || '';
      
      goalieStats.push({
        playerId: goalie.id,
        name: `${firstName} ${lastName}`.trim(),
        team: teamAbbrev,
        teamAbbrev,
        gamesPlayed: gameLog.length,
        gamesStarted: gameLog.length,
        wins,
        losses,
        savePct: totalShotsAgainst > 0 ? totalSaves / totalShotsAgainst : 0,
        goalsAgainstAvg: gameLog.length > 0 ? totalGoalsAgainst / gameLog.length : 0,
        saves: totalSaves,
        shotsAgainst: totalShotsAgainst,
        savesPerGame: gameLog.length > 0 ? totalSaves / gameLog.length : 0,
      });
    }
    
    return goalieStats;
  } catch (error) {
    console.error(`Error fetching goalie stats for ${teamAbbrev}:`, error);
    return [];
  }
}

/**
 * Check if a team is on a back-to-back
 */
export async function isBackToBack(teamAbbrev: string): Promise<boolean> {
  try {
    const response = await fetch(`${NHL_API_BASE}/club-schedule/${teamAbbrev}/week/now`);
    if (!response.ok) return false;
    
    const data = await response.json();
    const games = data.games || [];
    
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    
    const playedYesterday = games.some((g: any) => g.gameDate === yesterday);
    const playsToday = games.some((g: any) => g.gameDate === today);
    
    return playedYesterday && playsToday;
  } catch (error) {
    console.error(`Error checking B2B for ${teamAbbrev}:`, error);
    return false;
  }
}

/**
 * Get team standings/stats
 */
export async function getTeamStats(teamAbbrev: string): Promise<TeamStats | null> {
  try {
    const response = await fetch(`${NHL_API_BASE}/standings/now`);
    if (!response.ok) return null;
    
    const data = await response.json();
    const standings = data.standings || [];
    
    const team = standings.find((t: any) => t.teamAbbrev?.default === teamAbbrev);
    if (!team) return null;
    
    return {
      teamId: team.teamId || 0,
      teamAbbrev,
      teamName: team.teamName?.default || teamAbbrev,
      goalsFor: team.goalFor || 0,
      goalsAgainst: team.goalAgainst || 0,
      goalsForPerGame: team.gamesPlayed > 0 ? team.goalFor / team.gamesPlayed : 0,
      goalsAgainstPerGame: team.gamesPlayed > 0 ? team.goalAgainst / team.gamesPlayed : 0,
      powerPlayPct: team.powerPlayPct || 0,
      penaltyKillPct: team.penaltyKillPct || 0,
      shotsForPerGame: 30, // Default, would need separate API call
      shotsAgainstPerGame: 30,
    };
  } catch (error) {
    console.error(`Error fetching team stats for ${teamAbbrev}:`, error);
    return null;
  }
}
