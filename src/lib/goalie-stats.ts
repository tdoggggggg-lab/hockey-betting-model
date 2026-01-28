/**
 * Goalie Stats Service
 * Fetches goalie data to adjust goalscorer probabilities
 */

export interface GoalieStats {
  playerId: number;
  name: string;
  team: string;
  teamAbbrev: string;
  gamesPlayed: number;
  gamesStarted: number;
  wins: number;
  losses: number;
  otLosses: number;
  savePercentage: number;
  goalsAgainstAverage: number;
  shotsAgainst: number;
  saves: number;
  goalsAgainst: number;
  shutouts: number;
}

const LEAGUE_AVG = {
  savePercentage: 0.900,
  goalsAgainstAverage: 3.00,
};

/**
 * Calculate goalie quality multiplier
 */
export function getGoalieMultiplier(goalie: GoalieStats | null): number {
  if (!goalie || goalie.gamesPlayed < 5) {
    return 1.0;
  }
  
  const svPctDiff = LEAGUE_AVG.savePercentage - goalie.savePercentage;
  const svPctMultiplier = 1 + (svPctDiff * 5);
  
  const gaaDiff = goalie.goalsAgainstAverage - LEAGUE_AVG.goalsAgainstAverage;
  const gaaMultiplier = 1 + (gaaDiff * 0.05);
  
  const combined = (svPctMultiplier * 0.7) + (gaaMultiplier * 0.3);
  
  return Math.max(0.80, Math.min(1.25, combined));
}

/**
 * Fetch goalie stats for a team
 */
export async function getTeamGoalies(teamAbbrev: string): Promise<GoalieStats[]> {
  try {
    const response = await fetch(
      `https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`,
      { headers: { 'Accept': 'application/json' } }
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const goalies: GoalieStats[] = [];
    
    (data.goalies || []).forEach((g: any) => {
      goalies.push({
        playerId: g.playerId,
        name: `${g.firstName?.default || ''} ${g.lastName?.default || ''}`.trim(),
        team: teamAbbrev,
        teamAbbrev: teamAbbrev,
        gamesPlayed: g.gamesPlayed || 0,
        gamesStarted: g.gamesStarted || 0,
        wins: g.wins || 0,
        losses: g.losses || 0,
        otLosses: g.otLosses || 0,
        savePercentage: g.savePctg || 0,
        goalsAgainstAverage: g.goalsAgainstAverage || 0,
        shotsAgainst: g.shotsAgainst || 0,
        saves: g.saves || 0,
        goalsAgainst: g.goalsAgainst || 0,
        shutouts: g.shutouts || 0,
      });
    });
    
    return goalies;
  } catch (error) {
    console.error(`Error fetching goalies for ${teamAbbrev}:`, error);
    return [];
  }
}

/**
 * Get the likely starting goalie
 */
export function getStartingGoalie(goalies: GoalieStats[]): GoalieStats | null {
  if (goalies.length === 0) return null;
  return [...goalies].sort((a, b) => b.gamesStarted - a.gamesStarted)[0];
}

/**
 * Get goalie tier for display
 */
export function getGoalieTier(goalie: GoalieStats): { tier: string; color: string } {
  if (!goalie || goalie.gamesPlayed < 5) {
    return { tier: 'Unknown', color: 'text-slate-400' };
  }
  
  const svPct = goalie.savePercentage;
  if (svPct >= 0.920) return { tier: 'Elite', color: 'text-emerald-400' };
  if (svPct >= 0.910) return { tier: 'Good', color: 'text-blue-400' };
  if (svPct >= 0.900) return { tier: 'Average', color: 'text-yellow-400' };
  if (svPct >= 0.890) return { tier: 'Below Avg', color: 'text-orange-400' };
  return { tier: 'Weak', color: 'text-red-400' };
}
