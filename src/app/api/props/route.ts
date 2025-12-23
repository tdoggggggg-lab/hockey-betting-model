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
import {
  getInjuryAdjustmentsAsync,
  InjuryAdjustments,
} from '@/lib/injury-service';

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
    
    // Collect all team abbreviations for injury lookup
    const teamAbbrevs: string[] = [];
    todaySchedule.games.forEach(game => {
      if (game.homeTeam?.abbrev) teamAbbrevs.push(game.homeTeam.abbrev);
      if (game.awayTeam?.abbrev) teamAbbrevs.push(game.awayTeam.abbrev);
    });
    
    // Get injury adjustments (auto-fetches from multiple sources)
    const injuryData = await getInjuryAdjustmentsAsync(teamAbbrevs);
    console.log(`Loaded injury data for ${injuryData.injuries.size} teams`);
    
    // Check if cache is still valid
    const now = Date.now();
    const useCache = (now - cacheTimestamp) < CACHE_DURATION && playerStatsCache.size > 0;
    
    // Process all games in parallel for speed
    const gamePromises = todaySchedule.games.map(async (game, i) => {
      try {
        const homeAbbrev = game.homeTeam?.abbrev;
        const awayAbbrev = game.awayTeam?.abbrev;
        
        if (!homeAbbrev || !awayAbbrev) return { predictions: [], players: 0 };
        
        // Apply team filter if specified
        if (teamFilter && teamFilter !== homeAbbrev && teamFilter !== awayAbbrev) {
          return { predictions: [], players: 0 };
        }
        
        console.log(`Processing game ${i + 1}/${todaySchedule.games.length}: ${awayAbbrev} @ ${homeAbbrev}`);
        
        // Get player stats (from cache or fresh) - now in parallel
        let homePlayers = useCache ? playerStatsCache.get(homeAbbrev) : null;
        let awayPlayers = useCache ? playerStatsCache.get(awayAbbrev) : null;
        
        // Fetch both teams in parallel if not cached
        const [homeResult, awayResult] = await Promise.all([
          homePlayers ? Promise.resolve(homePlayers) : getPlayersForTeam(homeAbbrev),
          awayPlayers ? Promise.resolve(awayPlayers) : getPlayersForTeam(awayAbbrev),
        ]);
        
        homePlayers = homeResult;
        awayPlayers = awayResult;
        
        // FILTER OUT INJURED PLAYERS
        const healthyHomePlayers = homePlayers?.filter(player => 
          !injuryData.isPlayerOut(player.name, homeAbbrev)
        ) || [];
        
        const healthyAwayPlayers = awayPlayers?.filter(player =>
          !injuryData.isPlayerOut(player.name, awayAbbrev)
        ) || [];
        
        const injuredHomeCount = (homePlayers?.length || 0) - healthyHomePlayers.length;
        const injuredAwayCount = (awayPlayers?.length || 0) - healthyAwayPlayers.length;
        
        if (injuredHomeCount > 0 || injuredAwayCount > 0) {
          console.log(`Filtered out ${injuredHomeCount} injured ${homeAbbrev} players, ${injuredAwayCount} injured ${awayAbbrev} players`);
        }
        
        // Update cache
        if (!useCache) {
          playerStatsCache.set(homeAbbrev, homePlayers);
          playerStatsCache.set(awayAbbrev, awayPlayers);
        }
        
        const playerCount = healthyHomePlayers.length + healthyAwayPlayers.length;
        
        // Get team stats and situational factors in parallel
        const [homeTeamStats, awayTeamStats, homeB2B, awayB2B] = await Promise.all([
          getTeamStats(homeAbbrev),
          getTeamStats(awayAbbrev),
          isBackToBack(homeAbbrev),
          isBackToBack(awayAbbrev),
        ]);
        
        // Format game time - Convert UTC to Eastern Time properly
        let gameTime = 'TBD';
        if (game.startTimeUTC) {
          const utcDate = new Date(game.startTimeUTC);
          // Convert to Eastern Time
          gameTime = utcDate.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true,
            timeZone: 'America/New_York'
          });
        }
        
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
        
        // Generate predictions for this game (using healthy players only)
        const gamePredictions = generateGamePredictions(
          healthyHomePlayers,
          healthyAwayPlayers,
          { abbrev: homeAbbrev, name: getTeamName(game.homeTeam) },
          { abbrev: awayAbbrev, name: getTeamName(game.awayTeam) },
          gameTime,
          homeB2B,
          awayB2B,
          homeTeamStats || undefined,
          awayTeamStats || undefined
        );
        
        // Apply injury adjustments to predictions
        const adjustedPredictions = gamePredictions.map(pred => {
          const adjustment = injuryData.getPlayerAdjustment(
            pred.playerName,
            pred.teamAbbrev,
            pred.isHome,
            pred.isHome ? homeB2B : awayB2B
          );
          
          // Apply adjustment to probability
          const adjustedProbability = Math.min(pred.probability * adjustment, 0.95);
          
          return {
            ...pred,
            probability: adjustedProbability,
            // Recalculate confidence based on injury situation
            confidence: pred.confidence * (adjustment >= 1 ? 1 : 0.9), // Lower confidence if team weakened
          };
        });
        
        return { predictions: adjustedPredictions, players: playerCount };
        
      } catch (gameError) {
        console.error(`Error processing game:`, gameError);
        return { predictions: [], players: 0 };
      }
    });
    
    // Wait for all games to complete
    const results = await Promise.all(gamePromises);
    
    // Combine results
    results.forEach(result => {
      allPredictions.push(...result.predictions);
      totalPlayers += result.players;
    });
    
    // Update cache timestamp
    if (!useCache) {
      cacheTimestamp = now;
    }
    
    // Filter by prop type
    let filteredPredictions = allPredictions.filter(p => p.propType === propType);
    
    // Sort by probability (highest first for goalscorer/points, relevant for finding value)
    filteredPredictions.sort((a, b) => b.probability - a.probability);
    
    // Identify value bets (compare against sample odds for now)
    const valueBets = identifyValueBetsFromPredictions(filteredPredictions);
    
    console.log(`Generated ${filteredPredictions.length} predictions, ${valueBets.length} value bets`);
    
    return NextResponse.json({
      predictions: filteredPredictions, // Return ALL predictions (UI will filter by game)
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
