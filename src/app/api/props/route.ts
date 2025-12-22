import { NextResponse } from 'next/server';
import { 
  getPlayersForTeam, 
  getTeamStats, 
  isBackToBack,
} from '@/lib/player-stats';
import {
  generateGamePredictions,
  identifyValueBet,
  probToAmericanOdds,
  PropPrediction,
} from '@/lib/prediction-engine';
import { getWeekSchedule } from '@/lib/nhl-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds for this endpoint

interface PropsResponse {
  predictions: PropPrediction[];
  valueBets: PropPrediction[];
  lastUpdated: string;
  gamesAnalyzed: number;
  playersAnalyzed: number;
}

// Cache for player stats (refreshes every 30 minutes)
let playerStatsCache: Map<string, any[]> = new Map();
let cacheTimestamp: number = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const propType = searchParams.get('type') || 'goalscorer';
  const teamFilter = searchParams.get('team') || null;
  
  console.log(`Props API called - type: ${propType}, team: ${teamFilter}`);
  
  try {
    // Get today's games
    const schedule = await getWeekSchedule();
    const today = new Date().toISOString().split('T')[0];
    const todaySchedule = schedule.find(day => day.date === today);
    
    if (!todaySchedule || todaySchedule.games.length === 0) {
      return NextResponse.json({
        predictions: [],
        valueBets: [],
        lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0,
        playersAnalyzed: 0,
        message: 'No games scheduled for today',
      });
    }
    
    console.log(`Found ${todaySchedule.games.length} games today`);
    
    const allPredictions: PropPrediction[] = [];
    let totalPlayers = 0;
    
    // Check if cache is still valid
    const now = Date.now();
    const useCache = (now - cacheTimestamp) < CACHE_DURATION && playerStatsCache.size > 0;
    
    // Helper function to add delay
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    // Process each game with rate limiting
    for (let i = 0; i < todaySchedule.games.length; i++) {
      const game = todaySchedule.games[i];
      try {
        const homeAbbrev = game.homeTeam?.abbrev;
        const awayAbbrev = game.awayTeam?.abbrev;
        
        if (!homeAbbrev || !awayAbbrev) continue;
        
        // Apply team filter if specified
        if (teamFilter && teamFilter !== homeAbbrev && teamFilter !== awayAbbrev) {
          continue;
        }
        
        console.log(`Processing game ${i + 1}/${todaySchedule.games.length}: ${awayAbbrev} @ ${homeAbbrev}`);
        
        // Get player stats (from cache or fresh)
        let homePlayers = useCache ? playerStatsCache.get(homeAbbrev) : null;
        let awayPlayers = useCache ? playerStatsCache.get(awayAbbrev) : null;
        
        if (!homePlayers) {
          try {
            homePlayers = await getPlayersForTeam(homeAbbrev);
            playerStatsCache.set(homeAbbrev, homePlayers);
            // Add delay to avoid rate limiting
            await delay(500);
          } catch (err) {
            console.error(`Failed to fetch ${homeAbbrev} roster:`, err);
            homePlayers = [];
          }
        }
        
        if (!awayPlayers) {
          try {
            awayPlayers = await getPlayersForTeam(awayAbbrev);
            playerStatsCache.set(awayAbbrev, awayPlayers);
            // Add delay to avoid rate limiting
            await delay(500);
          } catch (err) {
            console.error(`Failed to fetch ${awayAbbrev} roster:`, err);
            awayPlayers = [];
          }
        }
        
        if (!useCache) {
          cacheTimestamp = now;
        }
        
        totalPlayers += (homePlayers?.length || 0) + (awayPlayers?.length || 0);
        
        // Get team stats and situational factors
        const [homeTeamStats, awayTeamStats, homeB2B, awayB2B] = await Promise.all([
          getTeamStats(homeAbbrev),
          getTeamStats(awayAbbrev),
          isBackToBack(homeAbbrev),
          isBackToBack(awayAbbrev),
        ]);
        
        // Format game time
        const gameTime = game.startTimeUTC 
          ? new Date(game.startTimeUTC).toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit',
              hour12: true 
            })
          : 'TBD';
        
        // Get team names
        const getTeamName = (team: any) => {
          if (!team) return 'Unknown';
          if (typeof team.name === 'string') return team.name;
          if (team.placeName?.default && team.commonName?.default) {
            return `${team.placeName.default} ${team.commonName.default}`;
          }
          if (team.name?.default) return team.name.default;
          return team.abbrev || 'Unknown';
        };
        
        // Generate predictions for this game
        const gamePredictions = generateGamePredictions(
          homePlayers || [],
          awayPlayers || [],
          { abbrev: homeAbbrev, name: getTeamName(game.homeTeam) },
          { abbrev: awayAbbrev, name: getTeamName(game.awayTeam) },
          gameTime,
          homeB2B,
          awayB2B,
          homeTeamStats || undefined,
          awayTeamStats || undefined
        );
        
        allPredictions.push(...gamePredictions);
        
      } catch (gameError) {
        console.error(`Error processing game:`, gameError);
      }
    }
    
    // Filter by prop type
    let filteredPredictions = allPredictions.filter(p => p.propType === propType);
    
    // Sort by probability (highest first for goalscorer/points, relevant for finding value)
    filteredPredictions.sort((a, b) => b.probability - a.probability);
    
    // Identify value bets (compare against sample odds for now)
    const valueBets = identifyValueBetsFromPredictions(filteredPredictions);
    
    console.log(`Generated ${filteredPredictions.length} predictions, ${valueBets.length} value bets`);
    
    return NextResponse.json({
      predictions: filteredPredictions.slice(0, 50), // Top 50 predictions
      valueBets: valueBets.slice(0, 10), // Top 10 value bets
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: todaySchedule.games.length,
      playersAnalyzed: totalPlayers,
    });
    
  } catch (error) {
    console.error('Error in props API:', error);
    
    // Return fallback data if real data fails
    return NextResponse.json({
      predictions: getFallbackPredictions(propType),
      valueBets: [],
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: 0,
      playersAnalyzed: 0,
      error: 'Using fallback data - real predictions temporarily unavailable',
    });
  }
}

/**
 * Identify top picks - best predictions based on probability AND confidence
 * (Until we have real sportsbook odds for true value bet detection)
 */
function identifyValueBetsFromPredictions(predictions: PropPrediction[]): PropPrediction[] {
  // Score each prediction based on probability AND confidence
  const scoredPredictions = predictions
    .filter(pred => pred.probability >= 0.20) // Only consider players with 20%+ chance
    .map(pred => ({
      ...pred,
      // Combined score: 60% probability weight, 40% confidence weight
      pickScore: (pred.probability * 0.6) + (pred.confidence * 0.4)
    }))
    .sort((a, b) => b.pickScore - a.pickScore);
  
  // Take top picks and mark them as "value bets" for display
  const topPicks = scoredPredictions.slice(0, 10).map(pred => ({
    ...pred,
    isValueBet: true,
    edge: pred.pickScore, // Use the combined score as "edge" for display
    impliedProbability: pred.probability * 0.95, // Slight discount for display
    bookmakerOdds: probToAmericanOdds(pred.probability),
    bookmaker: 'Model Pick',
  }));
  
  return topPicks;
}

/**
 * Fallback predictions if real data is unavailable
 */
function getFallbackPredictions(propType: string): PropPrediction[] {
  const gameTime = '7:00 PM';
  
  const fallbackPlayers = [
    { name: 'Connor McDavid', team: 'Edmonton Oilers', abbrev: 'EDM', goals: 0.55, shots: 4.2, points: 1.5 },
    { name: 'Leon Draisaitl', team: 'Edmonton Oilers', abbrev: 'EDM', goals: 0.48, shots: 3.8, points: 1.3 },
    { name: 'David Pastrnak', team: 'Boston Bruins', abbrev: 'BOS', goals: 0.45, shots: 4.0, points: 1.2 },
    { name: 'Auston Matthews', team: 'Toronto Maple Leafs', abbrev: 'TOR', goals: 0.52, shots: 4.5, points: 1.1 },
    { name: 'Nathan MacKinnon', team: 'Colorado Avalanche', abbrev: 'COL', goals: 0.42, shots: 3.5, points: 1.4 },
    { name: 'Nikita Kucherov', team: 'Tampa Bay Lightning', abbrev: 'TBL', goals: 0.38, shots: 3.2, points: 1.3 },
    { name: 'Cole Caufield', team: 'Montreal Canadiens', abbrev: 'MTL', goals: 0.35, shots: 3.8, points: 0.9 },
    { name: 'Connor Bedard', team: 'Chicago Blackhawks', abbrev: 'CHI', goals: 0.30, shots: 3.0, points: 0.8 },
  ];
  
  return fallbackPlayers.map((player, idx) => {
    let expectedValue = 0;
    let probability = 0;
    let line = 0.5;
    
    if (propType === 'goalscorer') {
      expectedValue = player.goals;
      probability = 1 - Math.exp(-player.goals);
      line = 0.5;
    } else if (propType === 'shots') {
      expectedValue = player.shots;
      probability = 1 - (Math.exp(-player.shots) * (1 + player.shots + Math.pow(player.shots, 2) / 2));
      line = 2.5;
    } else if (propType === 'points') {
      expectedValue = player.points;
      probability = 1 - Math.exp(-player.points);
      line = 0.5;
    }
    
    return {
      playerId: 1000 + idx,
      playerName: player.name,
      team: player.team,
      teamAbbrev: player.abbrev,
      opponent: 'Opponent',
      opponentAbbrev: 'OPP',
      gameTime,
      isHome: idx % 2 === 0,
      propType: propType as any,
      expectedValue,
      probability,
      line,
      confidence: 0.75,
      isValueBet: probability > 0.35,
      edge: probability > 0.35 ? probability - 0.35 : 0,
      breakdown: {
        basePrediction: expectedValue,
        homeAwayAdj: 1,
        backToBackAdj: 1,
        opponentAdj: 1,
        recentFormAdj: 1,
        finalPrediction: expectedValue,
      },
    };
  });
}
