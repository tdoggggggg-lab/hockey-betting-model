import { NextResponse } from 'next/server';
import { apiCache, CACHE_TTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  bookmakerOdds?: number;
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

const INJURED_PLAYERS: Record<string, string[]> = {
  'COL': ['Gabriel Landeskog'],
  'EDM': ['Evander Kane'],
  'TBL': ['Brandon Hagel'],
  'CAR': ['Seth Jarvis'],
  'VAN': ['Thatcher Demko'],
  'PHI': ['Tyson Foerster'],
};

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

function isPlayerInjured(name: string, teamAbbrev: string): boolean {
  const teamInjuries = INJURED_PLAYERS[teamAbbrev] || [];
  const nameLower = name.toLowerCase();
  return teamInjuries.some(injured => 
    injured.toLowerCase() === nameLower ||
    nameLower.includes(injured.split(' ')[1]?.toLowerCase() || '')
  );
}

function poissonAtLeastOne(lambda: number): number {
  return 1 - Math.exp(-lambda);
}

// Simple delay function
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Cache for player stats by team
const playerStatsCache: Map<string, { data: any[]; timestamp: number }> = new Map();
const PLAYER_STATS_TTL = 600000; // 10 minutes

async function getPlayerStats(teamAbbrev: string, retries = 2): Promise<any[]> {
  // Check cache first
  const cached = playerStatsCache.get(teamAbbrev);
  if (cached && Date.now() - cached.timestamp < PLAYER_STATS_TTL) {
    console.log(`  ✅ Using cached stats for ${teamAbbrev}`);
    return cached.data;
  }
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`, {
        headers: { 'Accept': 'application/json' },
      });
      
      if (response.status === 429) {
        console.log(`  ⚠️ Rate limited for ${teamAbbrev}, attempt ${attempt}/${retries}`);
        await delay(1000 * attempt);
        continue;
      }
      
      if (!response.ok) {
        console.log(`  ❌ Failed to fetch ${teamAbbrev}: ${response.status}`);
        return cached?.data || [];
      }
      
      const data = await response.json();
      const skaters = data.skaters || [];
      
      // Cache the results
      playerStatsCache.set(teamAbbrev, { data: skaters, timestamp: Date.now() });
      console.log(`  💾 Cached ${skaters.length} players for ${teamAbbrev}`);
      
      return skaters;
    } catch (error) {
      console.log(`  ❌ Error fetching ${teamAbbrev} (attempt ${attempt}):`, error);
      if (attempt < retries) {
        await delay(500 * attempt);
      }
    }
  }
  return cached?.data || [];
}

async function processGame(game: any): Promise<{ predictions: PropPrediction[], playerCount: number }> {
  const predictions: PropPrediction[] = [];
  let playerCount = 0;
  
  try {
    const homeAbbrev = game.homeTeam?.abbrev;
    const awayAbbrev = game.awayTeam?.abbrev;
    if (!homeAbbrev || !awayAbbrev) return { predictions, playerCount };
    
    console.log(`🏒 Processing game: ${awayAbbrev} @ ${homeAbbrev}`);
    
    // Fetch with small delay between teams to avoid rate limiting
    const homePlayers = await getPlayerStats(homeAbbrev);
    await delay(100);
    const awayPlayers = await getPlayerStats(awayAbbrev);
    
    let gameTime = 'TBD';
    if (game.startTimeUTC) {
      gameTime = new Date(game.startTimeUTC).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York'
      });
    }
    
    const getTeamName = (team: any) => {
      if (!team) return 'Unknown';
      if (team.placeName?.default && team.commonName?.default) {
        return `${team.placeName.default} ${team.commonName.default}`;
      }
      return team.abbrev || 'Unknown';
    };
    
    // Process home team
    for (const player of homePlayers) {
      const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
      if (isPlayerInjured(name, homeAbbrev)) continue;
      
      const gamesPlayed = player.gamesPlayed || 1;
      const goals = player.goals || 0;
      if (gamesPlayed < 10) continue;
      
      const baseLambda = goals / gamesPlayed;
      if (baseLambda < 0.05) continue;
      
      const finalLambda = baseLambda * 1.05;
      const probability = poissonAtLeastOne(finalLambda);
      
      let confidence = 0.3;
      if (ELITE_SCORERS.has(name)) confidence += 0.35;
      else if (baseLambda >= 0.35) confidence += 0.25;
      else if (baseLambda >= 0.20) confidence += 0.15;
      if (gamesPlayed >= 30) confidence += 0.15;
      confidence = Math.min(0.95, confidence);
      
      predictions.push({
        playerId: player.playerId,
        playerName: name,
        team: getTeamName(game.homeTeam),
        teamAbbrev: homeAbbrev,
        opponent: getTeamName(game.awayTeam),
        opponentAbbrev: awayAbbrev,
        gameTime,
        isHome: true,
        propType: 'goalscorer',
        expectedValue: finalLambda,
        probability,
        line: 0.5,
        confidence,
        isValueBet: false,
        breakdown: { basePrediction: baseLambda, homeAwayAdj: 1.05, backToBackAdj: 1.0, opponentAdj: 1.0, recentFormAdj: 1.0, goalieAdj: 1.0, toiAdj: 1.0, shotVolumeAdj: 1.0, finalPrediction: finalLambda },
      });
      playerCount++;
    }
    
    // Process away team
    for (const player of awayPlayers) {
      const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
      if (isPlayerInjured(name, awayAbbrev)) continue;
      
      const gamesPlayed = player.gamesPlayed || 1;
      const goals = player.goals || 0;
      if (gamesPlayed < 10) continue;
      
      const baseLambda = goals / gamesPlayed;
      if (baseLambda < 0.05) continue;
      
      const finalLambda = baseLambda * 0.95;
      const probability = poissonAtLeastOne(finalLambda);
      
      let confidence = 0.3;
      if (ELITE_SCORERS.has(name)) confidence += 0.35;
      else if (baseLambda >= 0.35) confidence += 0.25;
      else if (baseLambda >= 0.20) confidence += 0.15;
      if (gamesPlayed >= 30) confidence += 0.15;
      confidence = Math.min(0.95, confidence);
      
      predictions.push({
        playerId: player.playerId,
        playerName: name,
        team: getTeamName(game.awayTeam),
        teamAbbrev: awayAbbrev,
        opponent: getTeamName(game.homeTeam),
        opponentAbbrev: homeAbbrev,
        gameTime,
        isHome: false,
        propType: 'goalscorer',
        expectedValue: finalLambda,
        probability,
        line: 0.5,
        confidence,
        isValueBet: false,
        breakdown: { basePrediction: baseLambda, homeAwayAdj: 0.95, backToBackAdj: 1.0, opponentAdj: 1.0, recentFormAdj: 1.0, goalieAdj: 1.0, toiAdj: 1.0, shotVolumeAdj: 1.0, finalPrediction: finalLambda },
      });
      playerCount++;
    }
    
    console.log(`  ✅ Generated ${predictions.length} predictions`);
  } catch (error) {
    console.error('  ❌ Error processing game:', error);
  }
  
  return { predictions, playerCount };
}

export async function GET() {
  const CACHE_KEY = 'props_predictions';
  
  // Check cache first
  const cached = apiCache.get<any>(CACHE_KEY);
  if (cached) {
    const age = apiCache.getAge(CACHE_KEY);
    console.log(`✅ Using cached props (${age}s old)`);
    return NextResponse.json(cached);
  }
  
  try {
    console.log('🔄 Generating fresh props predictions...');
    
    // Try multiple schedule endpoints for reliability
    let schedData: any = null;
    
    // Try /schedule/now first
    try {
      const res1 = await fetch('https://api-web.nhle.com/v1/schedule/now', {
        headers: { 'Accept': 'application/json' }
      });
      if (res1.ok) {
        schedData = await res1.json();
      }
    } catch (e) {
      console.log('Schedule/now failed, trying alternative...');
    }
    
    // Fallback to specific date if /now fails
    if (!schedData || !schedData.gameWeek) {
      const today = new Date().toISOString().split('T')[0];
      try {
        const res2 = await fetch(`https://api-web.nhle.com/v1/schedule/${today}`, {
          headers: { 'Accept': 'application/json' }
        });
        if (res2.ok) {
          schedData = await res2.json();
        }
      } catch (e) {
        console.log('Schedule by date also failed');
      }
    }
    
    if (!schedData || !schedData.gameWeek) {
      console.log('❌ All schedule endpoints failed');
      const emptyResponse = {
        predictions: [], valueBets: [], lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0, playersAnalyzed: 0, 
        message: 'No games scheduled today. Check back tomorrow!',
      };
      return NextResponse.json(emptyResponse);
    }
    
    const gameWeek = schedData.gameWeek || [];
    console.log(`📅 Schedule has ${gameWeek.length} days`);
    
    // Find FIRST day with games (might not be today)
    let todayGames: any[] = [];
    let gameDate = '';
    
    for (const day of gameWeek) {
      console.log(`  Day: ${day.date} has ${day.games?.length || 0} games`);
      if (day.games && day.games.length > 0) {
        todayGames = day.games;
        gameDate = day.date;
        console.log(`  Using ${day.date} with ${todayGames.length} games`);
        break;
      }
    }
    
    if (!todayGames.length) {
      const emptyResponse = {
        predictions: [], valueBets: [], lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0, playersAnalyzed: 0,
        message: 'No games scheduled. Check back later!',
      };
      return NextResponse.json(emptyResponse);
    }
    
    console.log(`🏒 Processing ${todayGames.length} games for ${gameDate}...`);
    
    // Process games sequentially with small delays to avoid rate limiting
    const results = [];
    for (const game of todayGames) {
      const result = await processGame(game);
      results.push(result);
      // Small delay between games to avoid rate limiting
      await delay(200);
    }
    
    const allPredictions: PropPrediction[] = [];
    let totalPlayers = 0;
    
    for (const result of results) {
      allPredictions.push(...result.predictions);
      totalPlayers += result.playerCount;
    }
    
    console.log(`📊 Total: ${allPredictions.length} predictions from ${totalPlayers} players`);
    
    allPredictions.sort((a, b) => b.probability - a.probability);
    
    const topPicks = [...allPredictions]
      .filter(p => p.probability >= 0.25 && p.confidence >= 0.50)
      .sort((a, b) => (b.probability * 0.5 + b.confidence * 0.5) - (a.probability * 0.5 + a.confidence * 0.5))
      .slice(0, 10)
      .map(p => ({ ...p, isValueBet: true }));
    
    const topPickIds = new Set(topPicks.map(p => p.playerId));
    const markedPredictions = allPredictions.map(p => ({ ...p, isValueBet: topPickIds.has(p.playerId) }));
    
    const response = {
      predictions: markedPredictions,
      valueBets: topPicks,
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: todayGames.length,
      playersAnalyzed: totalPlayers,
      gameDate,
    };
    
    // Cache the results for 5 minutes
    apiCache.set(CACHE_KEY, response, CACHE_TTL.PROPS);
    console.log(`💾 Cached props for ${CACHE_TTL.PROPS}s`);
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('❌ Error in props API:', error);
    return NextResponse.json({
      predictions: [], valueBets: [], lastUpdated: new Date().toISOString(),
      gamesAnalyzed: 0, playersAnalyzed: 0, error: 'Failed to generate predictions'
    });
  }
}
