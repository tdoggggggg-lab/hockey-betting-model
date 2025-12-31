import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HOME_ICE_BOOST = 0.045;
const B2B_PENALTY = 0.073;

// ============ INJURY DATA ============
// Elite players - their absence significantly impacts team performance
const ELITE_PLAYERS: Record<string, string[]> = {
  'EDM': ['Connor McDavid', 'Leon Draisaitl'],
  'COL': ['Nathan MacKinnon', 'Cale Makar', 'Mikko Rantanen'],
  'TOR': ['Auston Matthews', 'Mitch Marner', 'William Nylander'],
  'TBL': ['Nikita Kucherov', 'Brayden Point'],
  'BOS': ['David Pastrnak'],
  'FLA': ['Sam Reinhart', 'Aleksander Barkov', 'Matthew Tkachuk'],
  'DAL': ['Jason Robertson'],
  'VGK': ['Jack Eichel', 'Mark Stone'],
  'NYR': ['Artemi Panarin', 'Adam Fox'],
  'NJD': ['Jack Hughes', 'Jesper Bratt'],
  'CAR': ['Sebastian Aho', 'Andrei Svechnikov'],
  'WPG': ['Kyle Connor', 'Mark Scheifele'],
  'MIN': ['Kirill Kaprizov'],
  'VAN': ['Elias Pettersson', 'J.T. Miller'],
  'LAK': ['Adrian Kempe'],
  'CGY': ['Nazem Kadri'],
  'OTT': ['Brady Tkachuk', 'Tim Stutzle'],
  'DET': ['Dylan Larkin', 'Lucas Raymond'],
  'BUF': ['Tage Thompson', 'Rasmus Dahlin'],
  'PIT': ['Sidney Crosby', 'Evgeni Malkin'],
  'WSH': ['Alex Ovechkin', 'Dylan Strome'],
  'PHI': ['Travis Konecny'],
  'NYI': ['Mathew Barzal', 'Bo Horvat'],
  'CBJ': ['Zach Werenski'],
  'MTL': ['Cole Caufield', 'Nick Suzuki'],
  'CHI': ['Connor Bedard'],
  'NSH': ['Filip Forsberg'],
  'STL': ['Robert Thomas'],
  'ANA': ['Troy Terry'],
  'SJS': ['Macklin Celebrini'],
  'SEA': ['Jared McCann'],
  'UTA': ['Clayton Keller'],
};

// Tier classifications for impact calculation
const TIER1_SUPERSTARS = ['Connor McDavid', 'Nathan MacKinnon', 'Auston Matthews', 'Nikita Kucherov'];
const TIER2_STARS = ['Leon Draisaitl', 'Cale Makar', 'David Pastrnak', 'Kirill Kaprizov', 
                    'Sidney Crosby', 'Alex Ovechkin', 'Jack Eichel', 'Mitch Marner',
                    'Sam Reinhart', 'Matthew Tkachuk', 'Aleksander Barkov'];

interface TeamStats {
  teamAbbrev: string;
  teamName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  pointsPct: number;
}

interface InjuryInfo {
  name: string;
  status: string;
  detail: string;
}

// In-memory injury cache
let injuryCache: Record<string, InjuryInfo[]> = {};
let lastInjuryFetch = 0;

async function fetchInjuries(): Promise<Record<string, InjuryInfo[]>> {
  const now = Date.now();
  // Cache for 1 hour
  if (now - lastInjuryFetch < 3600000 && Object.keys(injuryCache).length > 0) {
    return injuryCache;
  }
  
  const injuries: Record<string, InjuryInfo[]> = {};
  
  try {
    // Fetch from all team rosters to check injury status
    const teams = Object.keys(ELITE_PLAYERS);
    
    await Promise.all(teams.map(async (teamAbbrev) => {
      try {
        const res = await fetch(`https://api-web.nhle.com/v1/roster/${teamAbbrev}/current`);
        if (!res.ok) return;
        
        const data = await res.json();
        const teamInjuries: InjuryInfo[] = [];
        
        const allPlayers = [
          ...(data.forwards || []),
          ...(data.defensemen || []),
          ...(data.goalies || []),
        ];
        
        for (const player of allPlayers) {
          // Check if player has injury indicators
          // NHL API uses various fields for this
          if (player.injuryStatus || player.injuries) {
            const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
            teamInjuries.push({
              name,
              status: player.injuryStatus || 'OUT',
              detail: player.injuryDescription || 'Unknown',
            });
          }
        }
        
        if (teamInjuries.length > 0) {
          injuries[teamAbbrev] = teamInjuries;
        }
      } catch {
        // Skip team
      }
    }));
    
    // Always include known long-term injuries (manual backup)
    const manualInjuries: Record<string, InjuryInfo[]> = {
      'COL': [{ name: 'Gabriel Landeskog', status: 'LTIR', detail: 'Knee' }],
      'EDM': [{ name: 'Evander Kane', status: 'LTIR', detail: 'Hernia' }],
      'TBL': [{ name: 'Brandon Hagel', status: 'IR', detail: 'Lower Body' }],
      'CAR': [{ name: 'Seth Jarvis', status: 'IR', detail: 'Upper Body' }],
      'VAN': [{ name: 'Thatcher Demko', status: 'IR', detail: 'Lower Body' }],
    };
    
    // Merge manual with fetched
    for (const [team, players] of Object.entries(manualInjuries)) {
      if (!injuries[team]) injuries[team] = [];
      for (const player of players) {
        if (!injuries[team].some(p => p.name === player.name)) {
          injuries[team].push(player);
        }
      }
    }
    
    injuryCache = injuries;
    lastInjuryFetch = now;
    
  } catch (error) {
    console.error('Error fetching injuries:', error);
  }
  
  return injuries;
}

function getInjuredElitePlayers(teamAbbrev: string, injuries: Record<string, InjuryInfo[]>): string[] {
  const teamInjuries = injuries[teamAbbrev] || [];
  const elitePlayers = ELITE_PLAYERS[teamAbbrev] || [];
  const injuredElites: string[] = [];
  
  for (const elite of elitePlayers) {
    const eliteLower = elite.toLowerCase();
    const lastName = elite.split(' ').pop()?.toLowerCase() || '';
    
    const isInjured = teamInjuries.some(injured => {
      const injuredLower = injured.name.toLowerCase();
      return injuredLower === eliteLower || injuredLower.includes(lastName);
    });
    
    if (isInjured) {
      injuredElites.push(elite);
    }
  }
  
  return injuredElites;
}

function getTeamInjuryAdjustment(teamAbbrev: string, injuries: Record<string, InjuryInfo[]>): {
  adjustment: number;
  injuredStars: string[];
} {
  const injuredElites = getInjuredElitePlayers(teamAbbrev, injuries);
  
  if (injuredElites.length === 0) {
    return { adjustment: 0, injuredStars: [] };
  }
  
  let totalAdjustment = 0;
  
  for (const player of injuredElites) {
    if (TIER1_SUPERSTARS.includes(player)) {
      totalAdjustment -= 0.10; // -10%
    } else if (TIER2_STARS.includes(player)) {
      totalAdjustment -= 0.07; // -7%
    } else {
      totalAdjustment -= 0.04; // -4%
    }
  }
  
  // Cap at -20%
  totalAdjustment = Math.max(totalAdjustment, -0.20);
  
  return { adjustment: totalAdjustment, injuredStars: injuredElites };
}

async function getTeamStats(teamAbbrev: string): Promise<TeamStats | null> {
  try {
    const res = await fetch('https://api-web.nhle.com/v1/standings/now');
    if (!res.ok) return null;
    const data = await res.json();
    const team = (data.standings || []).find(
      (t: any) => t.teamAbbrev?.default === teamAbbrev
    );
    if (!team) return null;
    const gp = team.gamesPlayed || 1;
    return {
      teamAbbrev,
      teamName: team.teamName?.default || teamAbbrev,
      gamesPlayed: gp,
      wins: team.wins || 0,
      losses: team.losses || 0,
      goalsFor: team.goalFor || 0,
      goalsAgainst: team.goalAgainst || 0,
      goalsForPerGame: (team.goalFor || 0) / gp,
      goalsAgainstPerGame: (team.goalAgainst || 0) / gp,
      pointsPct: (team.points || 0) / (gp * 2),
    };
  } catch {
    return null;
  }
}

async function isBackToBack(teamAbbrev: string, gameDate: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/club-schedule/${teamAbbrev}/week/now`);
    if (!res.ok) return false;
    const data = await res.json();
    const yesterday = new Date(gameDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    return (data.games || []).some((g: any) => g.gameDate === yesterdayStr);
  } catch {
    return false;
  }
}

function predictGame(
  homeStats: TeamStats, 
  awayStats: TeamStats, 
  homeB2B: boolean, 
  awayB2B: boolean,
  homeInjuryAdj: { adjustment: number; injuredStars: string[] },
  awayInjuryAdj: { adjustment: number; injuredStars: string[] }
) {
  const reasoning: string[] = [];
  
  // Base probability from goal differential
  const homeGD = homeStats.goalsForPerGame - homeStats.goalsAgainstPerGame;
  const awayGD = awayStats.goalsForPerGame - awayStats.goalsAgainstPerGame;
  const gdAdvantage = homeGD - awayGD;
  
  let baseProb = 1 / (1 + Math.exp(-0.18 * gdAdvantage * 10));
  baseProb = 0.5 + (baseProb - 0.5) * 0.75;
  
  // Home ice
  reasoning.push(`Home ice: +${(HOME_ICE_BOOST * 100).toFixed(1)}%`);
  
  // Rest advantage
  let restAdj = 0;
  if (homeB2B && !awayB2B) {
    restAdj = -B2B_PENALTY;
    reasoning.push(`⚠️ ${homeStats.teamAbbrev} on back-to-back`);
  } else if (!homeB2B && awayB2B) {
    restAdj = B2B_PENALTY;
    reasoning.push(`⚠️ ${awayStats.teamAbbrev} on back-to-back`);
  }
  
  // Points percentage
  const ptsPctDiff = homeStats.pointsPct - awayStats.pointsPct;
  const ptsPctAdj = ptsPctDiff * 0.15;
  
  // INJURY ADJUSTMENTS
  let injuryAdj = 0;
  if (homeInjuryAdj.injuredStars.length > 0) {
    injuryAdj += homeInjuryAdj.adjustment; // Negative for home team
    reasoning.push(`🏥 ${homeStats.teamAbbrev}: ${homeInjuryAdj.injuredStars.join(', ')} OUT`);
  }
  if (awayInjuryAdj.injuredStars.length > 0) {
    injuryAdj -= awayInjuryAdj.adjustment; // Positive for home when away injured
    reasoning.push(`🏥 ${awayStats.teamAbbrev}: ${awayInjuryAdj.injuredStars.join(', ')} OUT`);
  }
  
  // Combine all factors
  let homeWinProb = baseProb + HOME_ICE_BOOST + restAdj + ptsPctAdj + injuryAdj;
  homeWinProb = Math.max(0.25, Math.min(0.75, homeWinProb));
  
  // Predicted total
  const predictedTotal = homeStats.goalsForPerGame + awayStats.goalsForPerGame;
  
  // Confidence
  let confidence = 0.45;
  if (homeStats.gamesPlayed >= 20 && awayStats.gamesPlayed >= 20) confidence += 0.15;
  if (Math.abs(homeWinProb - 0.5) > 0.12) confidence += 0.1;
  if (Math.abs(restAdj) > 0) confidence += 0.1;
  if (homeInjuryAdj.injuredStars.length > 0 || awayInjuryAdj.injuredStars.length > 0) {
    confidence += 0.05; // Injuries are reliable predictors
  }
  confidence = Math.min(0.80, confidence);
  
  return { homeWinProb, awayWinProb: 1 - homeWinProb, predictedTotal, confidence, reasoning };
}

export async function GET() {
  try {
    // Fetch injuries first
    const injuries = await fetchInjuries();
    console.log(`Loaded injuries for ${Object.keys(injuries).length} teams`);
    
    // Fetch schedule
    const schedRes = await fetch('https://api-web.nhle.com/v1/schedule/now');
    if (!schedRes.ok) {
      return NextResponse.json({ gamesByDate: {}, dates: [], error: 'Schedule API error' });
    }
    
    const schedData = await schedRes.json();
    const gameWeek = schedData.gameWeek || [];
    
    console.log('NHL schedule data received, gameWeek length:', gameWeek.length);
    
    const gamesByDate: Record<string, any[]> = {};
    const dates: string[] = [];
    
    // Cache standings to avoid repeated calls
    let standingsCache: any = null;
    
    for (const day of gameWeek) {
      const dateStr = day.date;
      if (!dateStr) continue;
      
      dates.push(dateStr);
      gamesByDate[dateStr] = [];
      
      const games = day.games || [];
      
      // Process games in parallel for speed
      const gamePromises = games.map(async (game: any) => {
        const homeAbbrev = game.homeTeam?.abbrev;
        const awayAbbrev = game.awayTeam?.abbrev;
        if (!homeAbbrev || !awayAbbrev) return null;
        
        const [homeStats, awayStats, homeB2B, awayB2B] = await Promise.all([
          getTeamStats(homeAbbrev),
          getTeamStats(awayAbbrev),
          isBackToBack(homeAbbrev, dateStr),
          isBackToBack(awayAbbrev, dateStr),
        ]);
        
        // Get injury adjustments
        const homeInjuryAdj = getTeamInjuryAdjustment(homeAbbrev, injuries);
        const awayInjuryAdj = getTeamInjuryAdjustment(awayAbbrev, injuries);
        
        let prediction = {
          homeWinProbability: 0.5,
          awayWinProbability: 0.5,
          predictedTotal: 5.5,
          confidence: 0.5,
          reasoning: [] as string[],
        };
        
        if (homeStats && awayStats) {
          const pred = predictGame(homeStats, awayStats, homeB2B, awayB2B, homeInjuryAdj, awayInjuryAdj);
          prediction = {
            homeWinProbability: pred.homeWinProb,
            awayWinProbability: pred.awayWinProb,
            predictedTotal: pred.predictedTotal,
            confidence: pred.confidence,
            reasoning: pred.reasoning,
          };
        }
        
        const getTeamName = (team: any) => {
          if (team?.placeName?.default && team?.commonName?.default) {
            return `${team.placeName.default} ${team.commonName.default}`;
          }
          return team?.abbrev || 'Unknown';
        };
        
        return {
          id: `${game.id}`,
          homeTeam: {
            id: game.homeTeam?.id || 0,
            name: getTeamName(game.homeTeam),
            abbreviation: homeAbbrev,
          },
          awayTeam: {
            id: game.awayTeam?.id || 0,
            name: getTeamName(game.awayTeam),
            abbreviation: awayAbbrev,
          },
          startTime: game.startTimeUTC || '',
          status: game.gameState === 'LIVE' ? 'live' : game.gameState === 'FINAL' ? 'final' : 'scheduled',
          prediction,
          injuries: {
            home: homeInjuryAdj.injuredStars,
            away: awayInjuryAdj.injuredStars,
          },
          odds: [],
        };
      });
      
      const results = await Promise.all(gamePromises);
      gamesByDate[dateStr] = results.filter(g => g !== null);
    }
    
    return NextResponse.json({
      gamesByDate,
      dates,
      lastUpdated: new Date().toISOString(),
      injuriesLoaded: Object.keys(injuries).length,
    });
    
  } catch (error) {
    console.error('Games API error:', error);
    return NextResponse.json({ gamesByDate: {}, dates: [], error: 'Failed to fetch games' });
  }
}
