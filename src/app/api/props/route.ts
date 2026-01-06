import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Reduced to 30s for faster failures

interface PropPrediction {
  playerId: number;
  playerName: string;
  team: string;
  teamAbbrev: string;
  opponent: string;
  opponentAbbrev: string;
  gameTime: string;
  isHome: boolean;
  propType: string;
  expectedValue: number;
  probability: number;
  line: number;
  confidence: number;
  isValueBet: boolean;
  breakdown: {
    basePrediction: number;
    homeAwayAdj: number;
    backToBackAdj: number;
    opponentAdj: number;
    recentFormAdj: number;
    goalieAdj: number;
    toiAdj: number;
    shotVolumeAdj: number;
    finalPrediction: number;
  };
}

// Global in-memory cache (persists within same instance)
const cache: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 300000; // 5 minutes

const ELITE_SCORERS = new Set([
  'Connor McDavid', 'Nathan MacKinnon', 'Auston Matthews', 'Leon Draisaitl',
  'Nikita Kucherov', 'David Pastrnak', 'Cale Makar', 'Kirill Kaprizov',
  'Mikko Rantanen', 'Sam Reinhart', 'Jake Guentzel', 'Matthew Tkachuk',
  'Jack Eichel', 'Mitch Marner', 'Sidney Crosby', 'Aleksander Barkov',
  'Sebastian Aho', 'Brayden Point', 'Brady Tkachuk', 'Tim Stutzle',
  'Kyle Connor', 'Mark Scheifele', 'Artemi Panarin', 'Adam Fox',
  'Quinn Hughes', 'Zach Hyman', 'William Nylander', 'Jason Robertson',
  'Tage Thompson', 'Dylan Larkin', 'Trevor Zegras', 'Clayton Keller',
]);

function poissonAtLeastOne(lambda: number): number {
  return 1 - Math.exp(-lambda);
}

// Fetch with timeout
async function fetchWithTimeout(url: string, timeoutMs: number = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

// Get player stats with timeout and error handling
async function getPlayerStats(teamAbbrev: string): Promise<any[]> {
  try {
    const response = await fetchWithTimeout(
      `https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`,
      5000 // 5 second timeout per team
    );
    
    if (!response.ok) {
      console.log(`⚠️ ${teamAbbrev}: HTTP ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    return data.skaters || [];
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log(`⏱️ ${teamAbbrev}: Timeout`);
    } else {
      console.log(`❌ ${teamAbbrev}: ${error.message}`);
    }
    return [];
  }
}

function processPlayers(
  players: any[], 
  teamAbbrev: string, 
  teamName: string,
  opponentAbbrev: string,
  opponentName: string,
  gameTime: string,
  isHome: boolean
): PropPrediction[] {
  const predictions: PropPrediction[] = [];
  
  for (const player of players) {
    try {
      const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
      if (!name) continue;
      
      const gamesPlayed = player.gamesPlayed || 0;
      const goals = player.goals || 0;
      if (gamesPlayed < 10) continue;
      
      const baseLambda = goals / gamesPlayed;
      if (baseLambda < 0.05) continue;
      
      const homeAwayAdj = isHome ? 1.05 : 0.95;
      const finalLambda = baseLambda * homeAwayAdj;
      const probability = poissonAtLeastOne(finalLambda);
      
      let confidence = 0.3;
      if (ELITE_SCORERS.has(name)) confidence += 0.35;
      else if (baseLambda >= 0.35) confidence += 0.25;
      else if (baseLambda >= 0.20) confidence += 0.15;
      if (gamesPlayed >= 30) confidence += 0.15;
      confidence = Math.min(0.95, confidence);
      
      predictions.push({
        playerId: player.playerId || Math.random(),
        playerName: name,
        team: teamName,
        teamAbbrev,
        opponent: opponentName,
        opponentAbbrev,
        gameTime,
        isHome,
        propType: 'goalscorer',
        expectedValue: finalLambda,
        probability,
        line: 0.5,
        confidence,
        isValueBet: false,
        breakdown: {
          basePrediction: baseLambda,
          homeAwayAdj,
          backToBackAdj: 1.0,
          opponentAdj: 1.0,
          recentFormAdj: 1.0,
          goalieAdj: 1.0,
          toiAdj: 1.0,
          shotVolumeAdj: 1.0,
          finalPrediction: finalLambda,
        },
      });
    } catch (e) {
      // Skip problematic players
    }
  }
  
  return predictions;
}

export async function GET() {
  const startTime = Date.now();
  
  try {
    console.log('🏒 Props API started');
    
    // Get schedule with timeout
    let schedData: any = null;
    try {
      const schedRes = await fetchWithTimeout('https://api-web.nhle.com/v1/schedule/now', 8000);
      if (schedRes.ok) {
        schedData = await schedRes.json();
      }
    } catch (e) {
      console.log('⚠️ Schedule fetch failed');
    }
    
    if (!schedData?.gameWeek) {
      return NextResponse.json({
        predictions: [],
        valueBets: [],
        lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0,
        playersAnalyzed: 0,
        message: 'Unable to fetch schedule. Please refresh.',
      });
    }
    
    // Get today's date in ET
    const now = new Date();
    const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayStr = etDate.toISOString().split('T')[0];
    
    // Find first day with games (today or later)
    let todayGames: any[] = [];
    let gameDate = '';
    
    for (const day of schedData.gameWeek || []) {
      if (day.date < todayStr) continue;
      if (day.games?.length > 0) {
        todayGames = day.games;
        gameDate = day.date;
        break;
      }
    }
    
    if (!todayGames.length) {
      return NextResponse.json({
        predictions: [],
        valueBets: [],
        lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0,
        playersAnalyzed: 0,
        message: 'No games scheduled today.',
      });
    }
    
    console.log(`📅 Found ${todayGames.length} games for ${gameDate}`);
    
    // Collect all unique teams
    const teamsToFetch: Set<string> = new Set();
    for (const game of todayGames) {
      if (game.homeTeam?.abbrev) teamsToFetch.add(game.homeTeam.abbrev);
      if (game.awayTeam?.abbrev) teamsToFetch.add(game.awayTeam.abbrev);
    }
    
    console.log(`🏒 Fetching ${teamsToFetch.size} teams in parallel...`);
    
    // Fetch ALL teams in parallel (much faster!)
    const teamStatsMap: Map<string, any[]> = new Map();
    const fetchPromises = Array.from(teamsToFetch).map(async (abbrev) => {
      const players = await getPlayerStats(abbrev);
      teamStatsMap.set(abbrev, players);
    });
    
    await Promise.all(fetchPromises);
    
    console.log(`✅ Fetched ${teamStatsMap.size} teams in ${Date.now() - startTime}ms`);
    
    // Process all games
    const allPredictions: PropPrediction[] = [];
    
    for (const game of todayGames) {
      const homeAbbrev = game.homeTeam?.abbrev;
      const awayAbbrev = game.awayTeam?.abbrev;
      if (!homeAbbrev || !awayAbbrev) continue;
      
      const getTeamName = (team: any) => {
        if (team?.placeName?.default && team?.commonName?.default) {
          return `${team.placeName.default} ${team.commonName.default}`;
        }
        return team?.abbrev || 'Unknown';
      };
      
      let gameTime = 'TBD';
      if (game.startTimeUTC) {
        gameTime = new Date(game.startTimeUTC).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'America/New_York',
        });
      }
      
      const homePlayers = teamStatsMap.get(homeAbbrev) || [];
      const awayPlayers = teamStatsMap.get(awayAbbrev) || [];
      
      const homePreds = processPlayers(
        homePlayers,
        homeAbbrev,
        getTeamName(game.homeTeam),
        awayAbbrev,
        getTeamName(game.awayTeam),
        gameTime,
        true
      );
      
      const awayPreds = processPlayers(
        awayPlayers,
        awayAbbrev,
        getTeamName(game.awayTeam),
        homeAbbrev,
        getTeamName(game.homeTeam),
        gameTime,
        false
      );
      
      allPredictions.push(...homePreds, ...awayPreds);
    }
    
    console.log(`📊 Generated ${allPredictions.length} predictions`);
    
    // Sort by probability
    allPredictions.sort((a, b) => b.probability - a.probability);
    
    // Mark top picks
    const topPicks = allPredictions
      .filter(p => p.probability >= 0.25 && p.confidence >= 0.50)
      .slice(0, 10)
      .map(p => ({ ...p, isValueBet: true }));
    
    const topPickIds = new Set(topPicks.map(p => p.playerId));
    const markedPredictions = allPredictions.map(p => ({
      ...p,
      isValueBet: topPickIds.has(p.playerId),
    }));
    
    const response = {
      predictions: markedPredictions,
      valueBets: topPicks,
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: todayGames.length,
      playersAnalyzed: allPredictions.length,
      gameDate,
      fetchTimeMs: Date.now() - startTime,
    };
    
    console.log(`✅ Props API complete in ${Date.now() - startTime}ms`);
    
    return NextResponse.json(response);
    
  } catch (error: any) {
    console.error('❌ Props API error:', error);
    return NextResponse.json({
      predictions: [],
      valueBets: [],
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: 0,
      playersAnalyzed: 0,
      error: 'Failed to generate predictions. Please refresh.',
    });
  }
}
