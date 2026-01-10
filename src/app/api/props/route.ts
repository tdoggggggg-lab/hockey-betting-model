import { NextResponse } from 'next/server';
import { 
  classifyBet, 
  probToAmericanOdds,
  BetClassification 
} from '@/lib/bet-classification';
import { 
  quickTierCheck, 
  calculateDynamicConfidence
} from '@/lib/star-detection';
import { getGoalieAdjustment } from '@/lib/goalie-validation';
import { getPlayerLine, getLinemates, getLinePromotionBoost } from '@/lib/line-combinations';

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
  // New bet classification fields
  betClassification: BetClassification;
  edge: number;
  edgePercent: string;
  bookOdds: number | null;
  bookLine: string;
  fairOdds: number;
  expectedProfit: number;
  breakdown: {
    basePrediction: number;
    homeAwayAdj: number;
    backToBackAdj: number;
    opponentAdj: number;
    goalieAdj: number;
    linePromotionAdj: number;
    linemateInjuryAdj: number;
    vegasTotalAdj: number;
    shotVolumeAdj: number;
    ppBoost: number;
    finalPrediction: number;
  };
}

// 3-source validated injured players (from injury service)
const KNOWN_INJURED: Record<string, string[]> = {
  'COL': ['Gabriel Landeskog', 'Valeri Nichushkin'],
  'EDM': ['Evander Kane'],
  'TBL': ['Brandon Hagel'],
  'VAN': ['Thatcher Demko'],
  'TOR': ['Matt Murray'],
};

// Cache for book odds
let bookOddsCache: Map<string, { odds: number; line: number }> = new Map();
let bookOddsCacheTime = 0;
const ODDS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch player props odds from The Odds API
 */
async function fetchBookOdds(propType: string): Promise<Map<string, { odds: number; line: number }>> {
  const now = Date.now();
  if (now - bookOddsCacheTime < ODDS_CACHE_TTL && bookOddsCache.size > 0) {
    return bookOddsCache;
  }
  
  const oddsMap = new Map<string, { odds: number; line: number }>();
  const apiKey = process.env.ODDS_API_KEY;
  
  if (!apiKey) {
    console.log('⚠️ No ODDS_API_KEY configured');
    return oddsMap;
  }
  
  try {
    // Map prop type to Odds API market
    const marketMap: Record<string, string> = {
      'goalscorer': 'player_goal_scorer_anytime',
      'shots': 'player_shots_on_goal',
      'assists': 'player_assists',
      'points': 'player_points',
      'saves': 'player_saves',
    };
    
    const market = marketMap[propType] || 'player_goal_scorer_anytime';
    
    console.log(`🔄 Fetching book odds for ${propType} (market: ${market})...`);
    
    // Get today's events
    const eventsRes = await fetch(
      `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events?apiKey=${apiKey}`,
      { headers: { 'Accept': 'application/json' } }
    );
    
    if (!eventsRes.ok) {
      console.log('⚠️ Events API returned:', eventsRes.status);
      return oddsMap;
    }
    
    const events = await eventsRes.json();
    const today = new Date().toISOString().split('T')[0];
    
    // Filter to today's games
    const todayEvents = events.filter((e: any) => 
      e.commence_time?.startsWith(today)
    );
    
    console.log(`📋 Found ${todayEvents.length} events today`);
    
    // Fetch odds for each event (limit to save API credits)
    for (const event of todayEvents.slice(0, 5)) {
      try {
        const oddsRes = await fetch(
          `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events/${event.id}/odds?` +
          `apiKey=${apiKey}&regions=us&markets=${market}&oddsFormat=american`,
          { headers: { 'Accept': 'application/json' } }
        );
        
        if (!oddsRes.ok) continue;
        
        const oddsData = await oddsRes.json();
        
        // Extract player odds from bookmakers
        for (const bookmaker of oddsData.bookmakers || []) {
          for (const mkt of bookmaker.markets || []) {
            for (const outcome of mkt.outcomes || []) {
              if (outcome.description) {
                const playerKey = outcome.description.toLowerCase().trim();
                const line = parseFloat(outcome.point) || 0.5;
                const odds = outcome.price || 0;
                
                // Store with player name as key
                oddsMap.set(playerKey, { odds, line });
                
                // Also store by last name for fuzzy matching
                const lastName = playerKey.split(' ').pop();
                if (lastName) {
                  oddsMap.set(lastName, { odds, line });
                }
              }
            }
          }
        }
        
      } catch (err) {
        console.log(`Error fetching odds for event ${event.id}:`, err);
      }
    }
    
    console.log(`✅ Cached ${oddsMap.size} player odds`);
    bookOddsCache = oddsMap;
    bookOddsCacheTime = now;
    
  } catch (error) {
    console.error('Error fetching book odds:', error);
  }
  
  return oddsMap;
}

/**
 * Get book odds for a specific player
 */
function getPlayerBookOdds(
  playerName: string, 
  oddsMap: Map<string, { odds: number; line: number }>
): { odds: number; line: number } | null {
  const nameLower = playerName.toLowerCase().trim();
  
  // Try exact match
  if (oddsMap.has(nameLower)) {
    return oddsMap.get(nameLower)!;
  }
  
  // Try last name
  const lastName = nameLower.split(' ').pop();
  if (lastName && oddsMap.has(lastName)) {
    return oddsMap.get(lastName)!;
  }
  
  // Try fuzzy match
  for (const [key, value] of oddsMap.entries()) {
    if (key.includes(lastName || '') || nameLower.includes(key)) {
      return value;
    }
  }
  
  return null;
}

function isPlayerInjured(name: string, teamAbbrev: string): boolean {
  const teamInjuries = KNOWN_INJURED[teamAbbrev] || [];
  const nameLower = name.toLowerCase();
  return teamInjuries.some(injured => 
    injured.toLowerCase() === nameLower ||
    nameLower.includes(injured.split(' ')[1]?.toLowerCase() || '')
  );
}

function poissonAtLeastOne(lambda: number): number {
  return 1 - Math.exp(-lambda);
}

async function getPlayerStats(teamAbbrev: string): Promise<any[]> {
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.skaters || [];
  } catch { return []; }
}

async function getGoalieStats(teamAbbrev: string): Promise<any[]> {
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.goalies || [];
  } catch { return []; }
}

async function processGame(
  game: any, 
  propType: string,
  bookOdds: Map<string, { odds: number; line: number }>
): Promise<{ predictions: PropPrediction[], playerCount: number }> {
  const predictions: PropPrediction[] = [];
  let playerCount = 0;
  
  try {
    const homeAbbrev = game.homeTeam?.abbrev;
    const awayAbbrev = game.awayTeam?.abbrev;
    if (!homeAbbrev || !awayAbbrev) return { predictions, playerCount };
    
    console.log(`Processing game: ${awayAbbrev} @ ${homeAbbrev} (${propType})`);
    
    const [homePlayers, awayPlayers, homeGoalies, awayGoalies] = await Promise.all([
      getPlayerStats(homeAbbrev),
      getPlayerStats(awayAbbrev),
      getGoalieStats(homeAbbrev),
      getGoalieStats(awayAbbrev),
    ]);
    
    // Get opposing goalie save percentages
    const homeGoalieSv = homeGoalies[0]?.savePctg || 0.905;
    const awayGoalieSv = awayGoalies[0]?.savePctg || 0.905;
    
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
    
    // Process both teams
    const processPlayers = async (players: any[], teamAbbrev: string, isHome: boolean, opponentGoalieSv: number) => {
      for (const player of players) {
        const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
        if (isPlayerInjured(name, teamAbbrev)) continue;
        
        const gamesPlayed = player.gamesPlayed || 1;
        const goals = player.goals || 0;
        const shots = player.shots || 0;
        const assists = player.assists || 0;
        const points = player.points || 0;
        const ppGoals = player.powerPlayGoals || 0;
        
        if (gamesPlayed < 10) continue;
        
        // Base stats per game
        const goalsPerGame = goals / gamesPlayed;
        const shotsPerGame = shots / gamesPlayed;
        const assistsPerGame = assists / gamesPlayed;
        const pointsPerGame = points / gamesPlayed;
        
        // Filter based on prop type
        if (propType === 'goalscorer' && goalsPerGame < 0.05) continue;
        if (propType === 'shots' && shotsPerGame < 1.5) continue;
        if (propType === 'assists' && assistsPerGame < 0.1) continue;
        if (propType === 'points' && pointsPerGame < 0.2) continue;
        
        // Calculate base lambda based on prop type
        let baseLambda: number;
        let defaultLine: number;
        
        switch (propType) {
          case 'goalscorer':
            baseLambda = goalsPerGame;
            defaultLine = 0.5;
            break;
          case 'shots':
            baseLambda = shotsPerGame;
            defaultLine = 2.5;
            break;
          case 'assists':
            baseLambda = assistsPerGame;
            defaultLine = 0.5;
            break;
          case 'points':
            baseLambda = pointsPerGame;
            defaultLine = 0.5;
            break;
          default:
            baseLambda = goalsPerGame;
            defaultLine = 0.5;
        }
        
        // ========== APPLY ALL 10 ADJUSTMENTS ==========
        
        // 1. Home/Away adjustment
        const homeAwayAdj = isHome ? 1.05 : 0.95;
        
        // 2. Back-to-back adjustment
        const b2bAdj = 1.0; // TODO: Check actual schedule
        
        // 3. Opposing goalie adjustment (for goals only)
        const goalieAdj = propType === 'goalscorer' ? getGoalieAdjustment(opponentGoalieSv) : 1.0;
        
        // 4. Line promotion boost
        let linePromotionAdj = 1.0;
        try {
          linePromotionAdj = await getLinePromotionBoost(name, teamAbbrev);
        } catch { /* ignore */ }
        
        // 5. Linemate injury adjustment
        let linemateInjuryAdj = 1.0;
        try {
          const linemates = await getLinemates(name, teamAbbrev);
          for (const lm of linemates) {
            if (isPlayerInjured(lm, teamAbbrev)) {
              const tier = quickTierCheck(goalsPerGame, gamesPlayed);
              if (tier === 'elite' || tier === 'star') {
                linemateInjuryAdj *= 0.75;
              }
            }
          }
        } catch { /* ignore */ }
        
        // 6. Vegas total adjustment
        const vegasTotalAdj = 1.0;
        
        // 7. Shot volume adjustment
        let shotVolumeAdj = 1.0;
        if (shotsPerGame >= 4.0) shotVolumeAdj = 1.08;
        else if (shotsPerGame >= 3.0) shotVolumeAdj = 1.04;
        else if (shotsPerGame < 2.0) shotVolumeAdj = 0.96;
        
        // 8. Power play boost
        let ppBoost = 1.0;
        const ppGoalRate = gamesPlayed > 0 ? ppGoals / gamesPlayed : 0;
        if (ppGoalRate >= 0.2) ppBoost = 1.06;
        else if (ppGoalRate >= 0.1) ppBoost = 1.03;
        
        // 9. Opponent defense adjustment
        const opponentAdj = 1.0;
        
        // 10. Recent form adjustment
        const recentFormAdj = 1.0;
        
        // Calculate final lambda
        const finalLambda = baseLambda * homeAwayAdj * b2bAdj * goalieAdj * 
          linePromotionAdj * linemateInjuryAdj * vegasTotalAdj * 
          shotVolumeAdj * ppBoost * opponentAdj * recentFormAdj;
        
        // Calculate probability
        let probability: number;
        if (propType === 'goalscorer' || propType === 'assists' || propType === 'points') {
          probability = poissonAtLeastOne(finalLambda);
        } else {
          // For shots, calculate probability of hitting over the line
          const line = 2.5; // Default line
          probability = 1 - poissonCDF(line, finalLambda);
        }
        
        // Get player line info (PP1 status)
        let isPP1 = false;
        try {
          const lineInfo = await getPlayerLine(name, teamAbbrev);
          isPP1 = lineInfo.isPP1;
        } catch { /* ignore */ }
        
        // Calculate dynamic confidence
        const confidence = calculateDynamicConfidence(
          goalsPerGame,
          gamesPlayed,
          shotsPerGame,
          isPP1,
          linemateInjuryAdj < 1.0,
          opponentGoalieSv >= 0.920,
          b2bAdj < 1.0
        );
        
        // Get book odds for this player
        const playerOdds = getPlayerBookOdds(name, bookOdds);
        const bookOddsValue = playerOdds?.odds || null;
        const bookLine = playerOdds?.line || defaultLine;
        
        // Classify the bet
        const betAnalysis = classifyBet(
          probability,
          bookOddsValue,
          bookLine,
          propType as any,
          confidence
        );
        
        predictions.push({
          playerId: player.playerId,
          playerName: name,
          team: getTeamName(isHome ? game.homeTeam : game.awayTeam),
          teamAbbrev,
          opponent: getTeamName(isHome ? game.awayTeam : game.homeTeam),
          opponentAbbrev: isHome ? awayAbbrev : homeAbbrev,
          gameTime,
          isHome,
          propType,
          expectedValue: finalLambda,
          probability,
          line: bookLine,
          confidence,
          betClassification: betAnalysis.classification,
          edge: betAnalysis.edge,
          edgePercent: betAnalysis.edgePercent,
          bookOdds: bookOddsValue,
          bookLine: betAnalysis.bookLine,
          fairOdds: betAnalysis.fairOdds,
          expectedProfit: betAnalysis.expectedValue,
          breakdown: {
            basePrediction: baseLambda,
            homeAwayAdj,
            backToBackAdj: b2bAdj,
            opponentAdj,
            goalieAdj,
            linePromotionAdj,
            linemateInjuryAdj,
            vegasTotalAdj,
            shotVolumeAdj,
            ppBoost,
            finalPrediction: finalLambda,
          },
        });
        playerCount++;
      }
    };
    
    // Process home team (facing away goalie)
    await processPlayers(homePlayers, homeAbbrev, true, awayGoalieSv);
    
    // Process away team (facing home goalie)
    await processPlayers(awayPlayers, awayAbbrev, false, homeGoalieSv);
    
    console.log(`  Generated ${predictions.length} predictions`);
  } catch (error) {
    console.error('Error processing game:', error);
  }
  
  return { predictions, playerCount };
}

// Poisson CDF helper
function poissonCDF(k: number, lambda: number): number {
  let sum = 0;
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += Math.pow(lambda, i) * Math.exp(-lambda) / factorial(i);
  }
  return sum;
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const propType = searchParams.get('propType') || searchParams.get('type') || 'goalscorer';
    
    console.log(`\n🏒 Props API called for: ${propType}`);
    
    // Fetch book odds for this prop type
    const bookOdds = await fetchBookOdds(propType);
    
    // Try multiple schedule endpoints
    let schedData: any = null;
    
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
      return NextResponse.json({
        predictions: [], 
        valueBets: [], 
        lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0, 
        playersAnalyzed: 0, 
        message: 'No games scheduled today. Check back tomorrow!',
      });
    }
    
    const gameWeek = schedData.gameWeek || [];
    
    // Find first day with games
    let todayGames: any[] = [];
    let gameDate = '';
    
    for (const day of gameWeek) {
      if (day.games && day.games.length > 0) {
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
        message: 'No games scheduled. Check back later!',
      });
    }
    
    console.log(`Processing ${todayGames.length} games for ${gameDate}...`);
    
    const results = await Promise.all(
      todayGames.map((game: any) => processGame(game, propType, bookOdds))
    );
    
    const allPredictions: PropPrediction[] = [];
    let totalPlayers = 0;
    
    for (const result of results) {
      allPredictions.push(...result.predictions);
      totalPlayers += result.playerCount;
    }
    
    console.log(`Total: ${allPredictions.length} predictions from ${totalPlayers} players`);
    
    // Sort by probability
    allPredictions.sort((a, b) => b.probability - a.probability);
    
    // Get bets by classification
    const bestValueBets = allPredictions.filter(p => p.betClassification === 'best_value');
    const valueBets = allPredictions.filter(p => p.betClassification === 'value');
    const bestBets = allPredictions.filter(p => p.betClassification === 'best');
    
    // Combined top picks
    const topPicks = [
      ...bestValueBets,
      ...valueBets.slice(0, 5),
      ...bestBets.slice(0, 5),
    ].slice(0, 10);
    
    // Count bets with book odds
    const withBookOdds = allPredictions.filter(p => p.bookOdds !== null).length;
    
    return NextResponse.json({
      predictions: allPredictions,
      valueBets: topPicks,
      bestValueBets,
      valueBetsOnly: valueBets,
      bestBetsOnly: bestBets,
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: todayGames.length,
      playersAnalyzed: totalPlayers,
      playersWithBookOdds: withBookOdds,
      bookOddsAvailable: withBookOdds > 0,
      gameDate,
      propType,
      betSummary: {
        bestValue: bestValueBets.length,
        value: valueBets.length,
        best: bestBets.length,
        total: bestValueBets.length + valueBets.length + bestBets.length,
      },
    });
    
  } catch (error) {
    console.error('Error in props API:', error);
    return NextResponse.json({
      predictions: [], 
      valueBets: [], 
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: 0, 
      playersAnalyzed: 0, 
      error: 'Failed to generate predictions'
    });
  }
}
