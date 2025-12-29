import { NextResponse } from 'next/server';
import { getWeekSchedule } from '@/lib/nhl-api';
import { getInjuryAdjustmentsAsync } from '@/lib/injury-service';
import { getTeamGoalies, getStartingGoalie, getGoalieMultiplier, GoalieStats } from '@/lib/goalie-stats';
import { 
  getEnhancedPlayerStats, 
  EnhancedPlayerStats,
  getTOIMultiplier,
  getShotVolumeMultiplier,
  getShootingPctAdjustment
} from '@/lib/enhanced-player-stats';

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
  edge?: number;
  impliedProbability?: number;
  bookmakerOdds?: number;
  bookmaker?: string;
  opposingGoalie?: string;
  opposingGoalieSvPct?: number;
  playerTOI?: number;
  playerShotsPerGame?: number;
  recentGoals?: number[];
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

// Cache for player stats
const playerStatsCache = new Map<string, EnhancedPlayerStats[]>();
const goalieCache = new Map<string, GoalieStats[]>();
let cacheTimestamp = 0;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Adjustments
const ADJUSTMENTS = {
  HOME_BOOST: 1.05,
  AWAY_PENALTY: 0.95,
  BACK_TO_BACK_PENALTY: 0.85,
};

/**
 * Calculate Poisson probability P(X >= 1)
 */
function poissonAtLeastOne(lambda: number): number {
  return 1 - Math.exp(-lambda);
}

/**
 * Check if team played yesterday (back-to-back)
 */
async function isBackToBack(teamAbbrev: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api-web.nhle.com/v1/club-schedule/${teamAbbrev}/week/now`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!response.ok) return false;
    
    const data = await response.json();
    const games = data.games || [];
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    return games.some((g: any) => g.gameDate === yesterdayStr);
  } catch {
    return false;
  }
}

/**
 * Get team goals against average
 */
async function getTeamGAA(teamAbbrev: string): Promise<number> {
  try {
    const response = await fetch(
      `https://api-web.nhle.com/v1/standings/now`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!response.ok) return 3.0;
    
    const data = await response.json();
    const team = (data.standings || []).find((t: any) => t.teamAbbrev?.default === teamAbbrev);
    
    if (team && team.gamesPlayed > 0) {
      return team.goalAgainst / team.gamesPlayed;
    }
    return 3.0;
  } catch {
    return 3.0;
  }
}

/**
 * Generate prediction for a player
 */
function generatePrediction(
  player: EnhancedPlayerStats,
  teamInfo: { abbrev: string; name: string },
  opponentInfo: { abbrev: string; name: string },
  gameTime: string,
  isHome: boolean,
  isB2B: boolean,
  opponentGoalie: GoalieStats | null,
  opponentGAA: number,
  injuryData: any
): PropPrediction {
  
  // Check if player is injured
  if (injuryData.isPlayerOut(player.name, teamInfo.abbrev)) {
    // Return null probability for injured players (they'll be filtered out)
    return null as any;
  }
  
  // Base prediction
  let baseLambda = player.goalsPerGame || 0.1;
  
  // Adjustment 1: Home/Away
  const homeAwayAdj = isHome ? ADJUSTMENTS.HOME_BOOST : ADJUSTMENTS.AWAY_PENALTY;
  
  // Adjustment 2: Back-to-back
  const b2bAdj = isB2B ? ADJUSTMENTS.BACK_TO_BACK_PENALTY : 1.0;
  
  // Adjustment 3: Opponent defense (GAA)
  let opponentAdj = 1.0;
  if (opponentGAA >= 3.5) opponentAdj = 1.15;
  else if (opponentGAA >= 3.2) opponentAdj = 1.08;
  else if (opponentGAA <= 2.5) opponentAdj = 0.88;
  else if (opponentGAA <= 2.8) opponentAdj = 0.94;
  
  // Adjustment 4: Recent form (simplified - would need game log API)
  const recentFormAdj = 1.0;
  
  // Adjustment 5: Goalie quality (NEW)
  const goalieAdj = getGoalieMultiplier(opponentGoalie);
  
  // Adjustment 6: Time on ice (NEW)
  const toiAdj = getTOIMultiplier(player.toiPerGame || 15, player.position);
  
  // Adjustment 7: Shot volume (NEW)
  const shotVolumeAdj = getShotVolumeMultiplier(player.shotsPerGame || 2);
  
  // Adjustment 8: Shooting % regression
  const shootingAdj = getShootingPctAdjustment(player.shootingPercentage || 0.10, player.gamesPlayed);
  
  // Teammate adjustment for injuries
  const teammateAdj = injuryData.getPlayerAdjustment(player.name, teamInfo.abbrev, isHome, isB2B);
  
  // Calculate final lambda
  const finalLambda = baseLambda 
    * homeAwayAdj 
    * b2bAdj 
    * opponentAdj 
    * recentFormAdj 
    * goalieAdj 
    * toiAdj 
    * shotVolumeAdj 
    * shootingAdj
    * teammateAdj;
  
  // Calculate probability
  const probability = poissonAtLeastOne(Math.max(0.01, finalLambda));
  
  // Calculate confidence
  const confidence = calculateConfidence(player, goalieAdj, toiAdj, isHome, isB2B);
  
  return {
    playerId: player.playerId,
    playerName: player.name,
    team: teamInfo.name,
    teamAbbrev: teamInfo.abbrev,
    opponent: opponentInfo.name,
    opponentAbbrev: opponentInfo.abbrev,
    gameTime,
    isHome,
    propType: 'goalscorer',
    expectedValue: finalLambda,
    probability,
    line: 0.5,
    confidence,
    isValueBet: false,
    opposingGoalie: opponentGoalie?.name,
    opposingGoalieSvPct: opponentGoalie?.savePercentage,
    playerTOI: player.toiPerGame,
    playerShotsPerGame: player.shotsPerGame,
    breakdown: {
      basePrediction: baseLambda,
      homeAwayAdj,
      backToBackAdj: b2bAdj,
      opponentAdj,
      recentFormAdj,
      goalieAdj,
      toiAdj,
      shotVolumeAdj,
      finalPrediction: finalLambda,
    },
  };
}

/**
 * Calculate confidence score
 */
function calculateConfidence(
  player: EnhancedPlayerStats,
  goalieAdj: number,
  toiAdj: number,
  isHome: boolean,
  isB2B: boolean
): number {
  let confidence = 0;
  
  // Factor 1: Player Quality (25%)
  const gpg = player.goalsPerGame || 0;
  if (gpg >= 0.45) confidence += 0.25;
  else if (gpg >= 0.30) confidence += 0.22;
  else if (gpg >= 0.20) confidence += 0.17;
  else if (gpg >= 0.12) confidence += 0.10;
  else confidence += 0.03;
  
  // Factor 2: Sample size (20%)
  if (player.gamesPlayed >= 40) confidence += 0.20;
  else if (player.gamesPlayed >= 25) confidence += 0.15;
  else if (player.gamesPlayed >= 15) confidence += 0.10;
  else confidence += 0.05;
  
  // Factor 3: Power Play (15%)
  const ppTOI = player.powerPlayTOI || 0;
  if (ppTOI >= 3.5) confidence += 0.15;
  else if (ppTOI >= 2.0) confidence += 0.12;
  else if (ppTOI >= 1.0) confidence += 0.07;
  else confidence += 0.02;
  
  // Factor 4: Matchup - Goalie (15%)
  if (goalieAdj >= 1.15) confidence += 0.15;
  else if (goalieAdj >= 1.05) confidence += 0.12;
  else if (goalieAdj <= 0.90) confidence += 0.03;
  else confidence += 0.08;
  
  // Factor 5: TOI (15%)
  if (toiAdj >= 1.15) confidence += 0.15;
  else if (toiAdj >= 1.05) confidence += 0.12;
  else if (toiAdj <= 0.90) confidence += 0.05;
  else confidence += 0.08;
  
  // Factor 6: Situational (10%)
  let sit = 0.05;
  if (isHome) sit += 0.03;
  if (isB2B) sit -= 0.04;
  confidence += Math.max(0, sit);
  
  return Math.min(1.0, confidence);
}

/**
 * Identify top picks
 */
function identifyTopPicks(predictions: PropPrediction[]): PropPrediction[] {
  const scored = predictions.map(p => ({
    ...p,
    score: (p.probability * 0.6) + (p.confidence * 0.4)
  }));
  
  return scored
    .filter(p => p.probability >= 0.20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(p => ({ ...p, isValueBet: true }));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const propType = searchParams.get('type') || 'goalscorer';
    const teamFilter = searchParams.get('team');
    
    // Get today's schedule
    const weekSchedule = await getWeekSchedule();
    
    // Get today's games from the week schedule
    const today = new Date().toISOString().split('T')[0];
    const todaySchedule = weekSchedule.find(d => d.date === today);
    const todayGames = todaySchedule?.games || weekSchedule[0]?.games || [];
    
    if (!todayGames.length) {
      return NextResponse.json({
        predictions: [],
        valueBets: [],
        lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0,
        playersAnalyzed: 0,
      });
    }
    
    console.log(`Found ${todayGames.length} games today`);
    
    // Collect team abbreviations
    const teamAbbrevs: string[] = [];
    todayGames.forEach((game: any) => {
      if (game.homeTeam?.abbrev) teamAbbrevs.push(game.homeTeam.abbrev);
      if (game.awayTeam?.abbrev) teamAbbrevs.push(game.awayTeam.abbrev);
    });
    
    // Fetch injury data
    const injuryData = await getInjuryAdjustmentsAsync(teamAbbrevs);
    
    // Check cache
    const now = Date.now();
    const useCache = (now - cacheTimestamp) < CACHE_DURATION && playerStatsCache.size > 0;
    
    const allPredictions: PropPrediction[] = [];
    let totalPlayers = 0;
    
    // Process games in parallel
    const gamePromises = todayGames.map(async (game: any) => {
      try {
        const homeAbbrev = game.homeTeam?.abbrev;
        const awayAbbrev = game.awayTeam?.abbrev;
        
        if (!homeAbbrev || !awayAbbrev) return { predictions: [], players: 0 };
        
        if (teamFilter && teamFilter !== homeAbbrev && teamFilter !== awayAbbrev) {
          return { predictions: [], players: 0 };
        }
        
        // Fetch data in parallel
        const [
          homePlayers,
          awayPlayers,
          homeGoalies,
          awayGoalies,
          homeB2B,
          awayB2B,
          homeGAA,
          awayGAA
        ] = await Promise.all([
          useCache ? (playerStatsCache.get(homeAbbrev) || getEnhancedPlayerStats(homeAbbrev)) : getEnhancedPlayerStats(homeAbbrev),
          useCache ? (playerStatsCache.get(awayAbbrev) || getEnhancedPlayerStats(awayAbbrev)) : getEnhancedPlayerStats(awayAbbrev),
          useCache ? (goalieCache.get(homeAbbrev) || getTeamGoalies(homeAbbrev)) : getTeamGoalies(homeAbbrev),
          useCache ? (goalieCache.get(awayAbbrev) || getTeamGoalies(awayAbbrev)) : getTeamGoalies(awayAbbrev),
          isBackToBack(homeAbbrev),
          isBackToBack(awayAbbrev),
          getTeamGAA(homeAbbrev),
          getTeamGAA(awayAbbrev),
        ]);
        
        // Update cache
        if (!useCache) {
          playerStatsCache.set(homeAbbrev, homePlayers);
          playerStatsCache.set(awayAbbrev, awayPlayers);
          goalieCache.set(homeAbbrev, homeGoalies);
          goalieCache.set(awayAbbrev, awayGoalies);
        }
        
        // Get starting goalies
        const homeStartingGoalie = getStartingGoalie(homeGoalies);
        const awayStartingGoalie = getStartingGoalie(awayGoalies);
        
        // Format game time (Eastern)
        let gameTime = 'TBD';
        if (game.startTimeUTC) {
          const utcDate = new Date(game.startTimeUTC);
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
          return team.abbrev || 'Unknown';
        };
        
        const homeInfo = { abbrev: homeAbbrev, name: getTeamName(game.homeTeam) };
        const awayInfo = { abbrev: awayAbbrev, name: getTeamName(game.awayTeam) };
        
        const predictions: PropPrediction[] = [];
        
        // Generate predictions for home team (facing away goalie)
        homePlayers.forEach(player => {
          const pred = generatePrediction(
            player, homeInfo, awayInfo, gameTime, true, homeB2B,
            awayStartingGoalie, awayGAA, injuryData
          );
          if (pred) predictions.push(pred);
        });
        
        // Generate predictions for away team (facing home goalie)
        awayPlayers.forEach(player => {
          const pred = generatePrediction(
            player, awayInfo, homeInfo, gameTime, false, awayB2B,
            homeStartingGoalie, homeGAA, injuryData
          );
          if (pred) predictions.push(pred);
        });
        
        return { 
          predictions, 
          players: homePlayers.length + awayPlayers.length 
        };
        
      } catch (error) {
        console.error('Error processing game:', error);
        return { predictions: [], players: 0 };
      }
    });
    
    const results = await Promise.all(gamePromises);
    
    results.forEach(result => {
      allPredictions.push(...result.predictions);
      totalPlayers += result.players;
    });
    
    // Update cache timestamp
    if (!useCache) {
      cacheTimestamp = now;
    }
    
    // Filter by prop type and sort
    let filteredPredictions = allPredictions.filter(p => p.propType === propType);
    filteredPredictions.sort((a, b) => b.probability - a.probability);
    
    // Identify top picks
    const topPicks = identifyTopPicks(filteredPredictions);
    const topPickIds = new Set(topPicks.map(p => p.playerId));
    
    // Mark top picks in main list
    filteredPredictions = filteredPredictions.map(p => ({
      ...p,
      isValueBet: topPickIds.has(p.playerId)
    }));
    
    console.log(`Generated ${filteredPredictions.length} predictions, ${topPicks.length} top picks`);
    
    return NextResponse.json({
      predictions: filteredPredictions,
      valueBets: topPicks,
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: todayGames.length,
      playersAnalyzed: totalPlayers,
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
