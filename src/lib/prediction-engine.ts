/**
 * NHL Player Prop Prediction Engine
 * Uses Poisson distribution and situational adjustments to predict player props
 */

import { PlayerStats, GoalieStats, TeamStats } from './player-stats';

export interface PropPrediction {
  playerId: number;
  playerName: string;
  team: string;
  teamAbbrev: string;
  opponent: string;
  opponentAbbrev: string;
  gameTime: string;
  isHome: boolean;
  
  // Predictions
  propType: 'goalscorer' | 'shots' | 'points' | 'assists' | 'saves';
  expectedValue: number; // Lambda for Poisson
  probability: number; // P(over the line)
  line: number; // The betting line (0.5 for anytime goalscorer)
  
  // Confidence factors
  confidence: number; // 0-1 based on sample size and model certainty
  
  // Value bet info
  impliedProbability?: number; // From sportsbook odds
  edge?: number; // Our prob - implied prob
  isValueBet: boolean;
  bookmakerOdds?: number;
  bookmaker?: string;
  
  // Breakdown for transparency
  breakdown: {
    basePrediction: number;
    homeAwayAdj: number;
    backToBackAdj: number;
    opponentAdj: number;
    recentFormAdj: number;
    finalPrediction: number;
  };
}

// Situational adjustment factors (based on research)
const ADJUSTMENTS = {
  HOME_BOOST: 1.05, // 5% boost for home games
  AWAY_PENALTY: 0.95, // 5% penalty for away games
  BACK_TO_BACK_PENALTY: 0.85, // 15% penalty for B2B
  
  // Opponent strength adjustments (based on goals against per game)
  WEAK_DEFENSE_BOOST: 1.10, // vs teams allowing 3.5+ goals/game
  STRONG_DEFENSE_PENALTY: 0.90, // vs teams allowing <2.5 goals/game
  
  // Goalie adjustments (based on save %)
  WEAK_GOALIE_BOOST: 1.08, // vs goalies with <.900 sv%
  ELITE_GOALIE_PENALTY: 0.92, // vs goalies with >.920 sv%
  
  // Recent form weight (blend season avg with recent)
  RECENT_FORM_WEIGHT: 0.3, // 30% weight to last 10 games
  SEASON_WEIGHT: 0.7, // 70% weight to season average
};

/**
 * Calculate Poisson probability P(X >= k)
 * Used for "over" bets and anytime scorer
 */
export function poissonProbabilityOver(lambda: number, k: number): number {
  if (lambda <= 0) return 0;
  
  // P(X >= k) = 1 - P(X < k) = 1 - sum(P(X = i) for i in 0 to k-1)
  let cumulativeProb = 0;
  for (let i = 0; i < k; i++) {
    cumulativeProb += poissonPMF(lambda, i);
  }
  return 1 - cumulativeProb;
}

/**
 * Poisson probability mass function P(X = k)
 */
function poissonPMF(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Factorial helper (with memoization for performance)
 */
const factorialCache: Map<number, number> = new Map();
function factorial(n: number): number {
  if (n <= 1) return 1;
  if (factorialCache.has(n)) return factorialCache.get(n)!;
  
  const result = n * factorial(n - 1);
  factorialCache.set(n, result);
  return result;
}

/**
 * Convert American odds to implied probability
 */
export function americanToImpliedProb(odds: number): number {
  if (odds === 0) return 0.5;
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

/**
 * Convert probability to American odds
 */
export function probToAmericanOdds(prob: number): number {
  if (prob <= 0) return 10000;
  if (prob >= 1) return -10000;
  if (prob >= 0.5) {
    return Math.round(-100 * prob / (1 - prob));
  } else {
    return Math.round(100 * (1 - prob) / prob);
  }
}

/**
 * Predict goalscorer probability for a player
 */
export function predictGoalscorer(
  player: PlayerStats,
  isHome: boolean,
  isBackToBack: boolean,
  opponentStats?: TeamStats,
  opponentGoalie?: GoalieStats
): { expectedGoals: number; probability: number; breakdown: any } {
  
  // Base prediction: weighted average of season and recent form
  const basePrediction = 
    (player.goalsPerGame * ADJUSTMENTS.SEASON_WEIGHT) +
    (player.recentGoalsPerGame * ADJUSTMENTS.RECENT_FORM_WEIGHT);
  
  let adjusted = basePrediction;
  const breakdown = {
    basePrediction,
    homeAwayAdj: 1,
    backToBackAdj: 1,
    opponentAdj: 1,
    recentFormAdj: 1,
    finalPrediction: 0,
  };
  
  // Home/Away adjustment
  if (isHome) {
    adjusted *= ADJUSTMENTS.HOME_BOOST;
    breakdown.homeAwayAdj = ADJUSTMENTS.HOME_BOOST;
  } else {
    adjusted *= ADJUSTMENTS.AWAY_PENALTY;
    breakdown.homeAwayAdj = ADJUSTMENTS.AWAY_PENALTY;
  }
  
  // Back-to-back adjustment
  if (isBackToBack) {
    adjusted *= ADJUSTMENTS.BACK_TO_BACK_PENALTY;
    breakdown.backToBackAdj = ADJUSTMENTS.BACK_TO_BACK_PENALTY;
  }
  
  // Opponent defense adjustment
  if (opponentStats) {
    if (opponentStats.goalsAgainstPerGame >= 3.5) {
      adjusted *= ADJUSTMENTS.WEAK_DEFENSE_BOOST;
      breakdown.opponentAdj = ADJUSTMENTS.WEAK_DEFENSE_BOOST;
    } else if (opponentStats.goalsAgainstPerGame <= 2.5) {
      adjusted *= ADJUSTMENTS.STRONG_DEFENSE_PENALTY;
      breakdown.opponentAdj = ADJUSTMENTS.STRONG_DEFENSE_PENALTY;
    }
  }
  
  // Goalie adjustment
  if (opponentGoalie && opponentGoalie.gamesPlayed >= 5) {
    if (opponentGoalie.savePct < 0.900) {
      adjusted *= ADJUSTMENTS.WEAK_GOALIE_BOOST;
    } else if (opponentGoalie.savePct > 0.920) {
      adjusted *= ADJUSTMENTS.ELITE_GOALIE_PENALTY;
    }
  }
  
  breakdown.finalPrediction = adjusted;
  
  // Calculate probability of scoring at least 1 goal (anytime goalscorer)
  const probability = poissonProbabilityOver(adjusted, 1);
  
  return {
    expectedGoals: adjusted,
    probability,
    breakdown,
  };
}

/**
 * Predict shots on goal for a player
 */
export function predictShots(
  player: PlayerStats,
  isHome: boolean,
  isBackToBack: boolean,
  line: number = 2.5
): { expectedShots: number; probability: number; breakdown: any } {
  
  const basePrediction = 
    (player.shotsPerGame * ADJUSTMENTS.SEASON_WEIGHT) +
    (player.recentShotsPerGame * ADJUSTMENTS.RECENT_FORM_WEIGHT);
  
  let adjusted = basePrediction;
  const breakdown = {
    basePrediction,
    homeAwayAdj: 1,
    backToBackAdj: 1,
    opponentAdj: 1,
    recentFormAdj: 1,
    finalPrediction: 0,
  };
  
  // Home/Away (smaller effect for shots)
  if (isHome) {
    adjusted *= 1.03;
    breakdown.homeAwayAdj = 1.03;
  } else {
    adjusted *= 0.97;
    breakdown.homeAwayAdj = 0.97;
  }
  
  // Back-to-back
  if (isBackToBack) {
    adjusted *= 0.90;
    breakdown.backToBackAdj = 0.90;
  }
  
  breakdown.finalPrediction = adjusted;
  
  // Probability of going over the line
  const probability = poissonProbabilityOver(adjusted, Math.ceil(line));
  
  return {
    expectedShots: adjusted,
    probability,
    breakdown,
  };
}

/**
 * Predict points for a player
 */
export function predictPoints(
  player: PlayerStats,
  isHome: boolean,
  isBackToBack: boolean,
  line: number = 0.5
): { expectedPoints: number; probability: number; breakdown: any } {
  
  const basePrediction = 
    (player.pointsPerGame * ADJUSTMENTS.SEASON_WEIGHT) +
    (player.recentPointsPerGame * ADJUSTMENTS.RECENT_FORM_WEIGHT);
  
  let adjusted = basePrediction;
  const breakdown = {
    basePrediction,
    homeAwayAdj: 1,
    backToBackAdj: 1,
    opponentAdj: 1,
    recentFormAdj: 1,
    finalPrediction: 0,
  };
  
  if (isHome) {
    adjusted *= ADJUSTMENTS.HOME_BOOST;
    breakdown.homeAwayAdj = ADJUSTMENTS.HOME_BOOST;
  } else {
    adjusted *= ADJUSTMENTS.AWAY_PENALTY;
    breakdown.homeAwayAdj = ADJUSTMENTS.AWAY_PENALTY;
  }
  
  if (isBackToBack) {
    adjusted *= ADJUSTMENTS.BACK_TO_BACK_PENALTY;
    breakdown.backToBackAdj = ADJUSTMENTS.BACK_TO_BACK_PENALTY;
  }
  
  breakdown.finalPrediction = adjusted;
  
  const probability = poissonProbabilityOver(adjusted, Math.ceil(line));
  
  return {
    expectedPoints: adjusted,
    probability,
    breakdown,
  };
}

/**
 * Predict assists for a player
 */
export function predictAssists(
  player: PlayerStats,
  isHome: boolean,
  isBackToBack: boolean,
  line: number = 0.5
): { expectedAssists: number; probability: number; breakdown: any } {
  
  const basePrediction = player.assistsPerGame;
  
  let adjusted = basePrediction;
  const breakdown = {
    basePrediction,
    homeAwayAdj: 1,
    backToBackAdj: 1,
    opponentAdj: 1,
    recentFormAdj: 1,
    finalPrediction: 0,
  };
  
  if (isHome) {
    adjusted *= 1.04;
    breakdown.homeAwayAdj = 1.04;
  } else {
    adjusted *= 0.96;
    breakdown.homeAwayAdj = 0.96;
  }
  
  if (isBackToBack) {
    adjusted *= 0.88;
    breakdown.backToBackAdj = 0.88;
  }
  
  breakdown.finalPrediction = adjusted;
  
  const probability = poissonProbabilityOver(adjusted, Math.ceil(line));
  
  return {
    expectedAssists: adjusted,
    probability,
    breakdown,
  };
}

/**
 * Predict goalie saves
 */
export function predictSaves(
  goalie: GoalieStats,
  isHome: boolean,
  opponentStats?: TeamStats,
  line: number = 25.5
): { expectedSaves: number; probability: number; breakdown: any } {
  
  const basePrediction = goalie.savesPerGame;
  
  let adjusted = basePrediction;
  const breakdown = {
    basePrediction,
    homeAwayAdj: 1,
    backToBackAdj: 1,
    opponentAdj: 1,
    recentFormAdj: 1,
    finalPrediction: 0,
  };
  
  // Opponent shooting volume adjustment
  if (opponentStats) {
    const avgShots = 30; // League average
    const opponentShots = opponentStats.shotsForPerGame || avgShots;
    const shotRatio = opponentShots / avgShots;
    adjusted *= shotRatio;
    breakdown.opponentAdj = shotRatio;
  }
  
  if (isHome) {
    adjusted *= 0.97; // Home goalies face fewer shots
    breakdown.homeAwayAdj = 0.97;
  } else {
    adjusted *= 1.03;
    breakdown.homeAwayAdj = 1.03;
  }
  
  breakdown.finalPrediction = adjusted;
  
  // For saves, use normal approximation since numbers are larger
  // P(X > line) where X ~ Poisson(lambda)
  const probability = poissonProbabilityOver(adjusted, Math.ceil(line));
  
  return {
    expectedSaves: adjusted,
    probability,
    breakdown,
  };
}

/**
 * Calculate confidence score - "Is this a good bet to make?"
 * 
 * Factors:
 * - Player quality (elite players are more predictable)
 * - Recent form (hot/cold streak, but 4th liners regress)
 * - Consistency (season-long reliability)
 * - Power play time (PP1 = more chances)
 * - Matchup factors passed in
 * - Situational (home/away, B2B)
 */
export function calculateConfidence(
  gamesPlayed: number,
  goalsPerGame: number,
  recentGoalsPerGame: number,
  probability: number,
  ppTimePerGame: number = 0, // Power play seconds per game
  isHome: boolean = true,
  isBackToBack: boolean = false,
  opponentGoalsAgainstPerGame: number = 3.0 // League average ~3.0
): number {
  let confidence = 0;
  
  // ============================================
  // FACTOR 1: Player Quality / Role (25%)
  // Elite players are more reliable bets
  // ============================================
  const seasonGoalRate = goalsPerGame;
  
  if (seasonGoalRate >= 0.45) {
    confidence += 0.25; // Elite scorer (McDavid, Matthews tier)
  } else if (seasonGoalRate >= 0.30) {
    confidence += 0.22; // Star player (1st line)
  } else if (seasonGoalRate >= 0.20) {
    confidence += 0.17; // Good scorer (2nd line)
  } else if (seasonGoalRate >= 0.12) {
    confidence += 0.10; // Depth scorer (3rd line)
  } else {
    confidence += 0.03; // 4th liner / defenseman - hard to predict
  }
  
  // ============================================
  // FACTOR 2: Recent Form (20%)
  // Hot streaks matter, but penalize 4th liners (regression)
  // ============================================
  const formRatio = seasonGoalRate > 0 ? recentGoalsPerGame / seasonGoalRate : 0;
  const isDepthPlayer = seasonGoalRate < 0.15;
  
  if (formRatio >= 1.3) {
    // Player is HOT (30%+ above season average)
    if (isDepthPlayer) {
      // 4th liner on hot streak = likely to regress
      confidence += 0.08;
    } else {
      // Star player on hot streak = ride the wave
      confidence += 0.20;
    }
  } else if (formRatio >= 0.9) {
    // Consistent with season average
    confidence += 0.15;
  } else if (formRatio >= 0.5) {
    // Slightly cold
    confidence += 0.08;
  } else {
    // Very cold or not scoring
    confidence += 0.02;
  }
  
  // ============================================
  // FACTOR 3: Season Consistency (15%)
  // Players who score regularly vs randomly
  // ============================================
  // Use sample size as proxy for consistency data
  if (gamesPlayed >= 40 && seasonGoalRate >= 0.20) {
    confidence += 0.15; // Large sample + decent scorer = consistent
  } else if (gamesPlayed >= 25 && seasonGoalRate >= 0.15) {
    confidence += 0.12;
  } else if (gamesPlayed >= 15) {
    confidence += 0.08;
  } else {
    confidence += 0.03; // Small sample = less reliable
  }
  
  // ============================================
  // FACTOR 4: Power Play Time (15%)
  // PP1 players get way more scoring chances
  // ============================================
  const ppMinutesPerGame = ppTimePerGame / 60;
  
  if (ppMinutesPerGame >= 3.5) {
    confidence += 0.15; // PP1 quarterback - lots of chances
  } else if (ppMinutesPerGame >= 2.0) {
    confidence += 0.12; // PP1 player
  } else if (ppMinutesPerGame >= 1.0) {
    confidence += 0.07; // PP2 or limited PP time
  } else {
    confidence += 0.02; // No PP time - fewer chances
  }
  
  // ============================================
  // FACTOR 5: Matchup (15%)
  // Facing weak defense/goalie = better chance
  // ============================================
  if (opponentGoalsAgainstPerGame >= 3.5) {
    confidence += 0.15; // Weak defense - great matchup
  } else if (opponentGoalsAgainstPerGame >= 3.2) {
    confidence += 0.12; // Below average defense
  } else if (opponentGoalsAgainstPerGame >= 2.8) {
    confidence += 0.08; // Average defense
  } else {
    confidence += 0.03; // Strong defense - tough matchup
  }
  
  // ============================================
  // FACTOR 6: Situational (10%)
  // Home ice advantage, back-to-back penalty
  // ============================================
  let situational = 0.05; // Base
  
  if (isHome) {
    situational += 0.03; // Home boost
  }
  
  if (isBackToBack) {
    situational -= 0.04; // B2B penalty (tired legs)
  }
  
  confidence += Math.max(situational, 0.01);
  
  // ============================================
  // FINAL SCORE
  // ============================================
  return Math.min(Math.max(confidence, 0.05), 1.0);
}

/**
 * Identify if a bet has value (edge > threshold)
 */
export function identifyValueBet(
  modelProbability: number,
  bookOdds: number,
  minEdge: number = 0.03 // 3% minimum edge
): { isValue: boolean; edge: number; impliedProb: number } {
  const impliedProb = americanToImpliedProb(bookOdds);
  
  // Remove vig (assume 10% hold, so true probability is ~5% less than implied)
  const noVigProb = impliedProb * 0.95;
  
  const edge = modelProbability - noVigProb;
  
  return {
    isValue: edge >= minEdge,
    edge,
    impliedProb: noVigProb,
  };
}

/**
 * Generate all prop predictions for a game
 */
export function generateGamePredictions(
  homePlayers: PlayerStats[],
  awayPlayers: PlayerStats[],
  homeTeam: { abbrev: string; name: string },
  awayTeam: { abbrev: string; name: string },
  gameTime: string,
  homeBackToBack: boolean,
  awayBackToBack: boolean,
  homeTeamStats?: TeamStats,
  awayTeamStats?: TeamStats
): PropPrediction[] {
  const predictions: PropPrediction[] = [];
  
  // Generate predictions for home team players
  homePlayers.forEach(player => {
    // Get opponent goals against for matchup factor
    const opponentGA = awayTeamStats?.goalsAgainstPerGame || 3.0;
    
    // Goalscorer prediction
    const goalPred = predictGoalscorer(
      player, 
      true, 
      homeBackToBack,
      awayTeamStats
    );
    
    predictions.push({
      playerId: player.playerId,
      playerName: player.name,
      team: homeTeam.name,
      teamAbbrev: homeTeam.abbrev,
      opponent: awayTeam.name,
      opponentAbbrev: awayTeam.abbrev,
      gameTime,
      isHome: true,
      propType: 'goalscorer',
      expectedValue: goalPred.expectedGoals,
      probability: goalPred.probability,
      line: 0.5,
      confidence: calculateConfidence(
        player.gamesPlayed, 
        player.goalsPerGame, 
        player.recentGoalsPerGame, 
        goalPred.probability,
        player.powerPlayTimeOnIce, // PP time
        true, // isHome
        homeBackToBack, // B2B
        opponentGA // opponent defense quality
      ),
      isValueBet: false,
      breakdown: goalPred.breakdown,
    });
    
    // Shots prediction
    const shotPred = predictShots(player, true, homeBackToBack, 2.5);
    predictions.push({
      playerId: player.playerId,
      playerName: player.name,
      team: homeTeam.name,
      teamAbbrev: homeTeam.abbrev,
      opponent: awayTeam.name,
      opponentAbbrev: awayTeam.abbrev,
      gameTime,
      isHome: true,
      propType: 'shots',
      expectedValue: shotPred.expectedShots,
      probability: shotPred.probability,
      line: 2.5,
      confidence: calculateConfidence(
        player.gamesPlayed, 
        player.shotsPerGame, 
        player.recentShotsPerGame, 
        shotPred.probability,
        player.powerPlayTimeOnIce,
        true,
        homeBackToBack,
        opponentGA
      ),
      isValueBet: false,
      breakdown: shotPred.breakdown,
    });
    
    // Points prediction
    const pointPred = predictPoints(player, true, homeBackToBack, 0.5);
    predictions.push({
      playerId: player.playerId,
      playerName: player.name,
      team: homeTeam.name,
      teamAbbrev: homeTeam.abbrev,
      opponent: awayTeam.name,
      opponentAbbrev: awayTeam.abbrev,
      gameTime,
      isHome: true,
      propType: 'points',
      expectedValue: pointPred.expectedPoints,
      probability: pointPred.probability,
      line: 0.5,
      confidence: calculateConfidence(
        player.gamesPlayed, 
        player.pointsPerGame, 
        player.recentPointsPerGame, 
        pointPred.probability,
        player.powerPlayTimeOnIce,
        true,
        homeBackToBack,
        opponentGA
      ),
      isValueBet: false,
      breakdown: pointPred.breakdown,
    });
  });
  
  // Generate predictions for away team players
  awayPlayers.forEach(player => {
    // Get opponent goals against for matchup factor
    const opponentGA = homeTeamStats?.goalsAgainstPerGame || 3.0;
    
    const goalPred = predictGoalscorer(
      player, 
      false, 
      awayBackToBack,
      homeTeamStats
    );
    
    predictions.push({
      playerId: player.playerId,
      playerName: player.name,
      team: awayTeam.name,
      teamAbbrev: awayTeam.abbrev,
      opponent: homeTeam.name,
      opponentAbbrev: homeTeam.abbrev,
      gameTime,
      isHome: false,
      propType: 'goalscorer',
      expectedValue: goalPred.expectedGoals,
      probability: goalPred.probability,
      line: 0.5,
      confidence: calculateConfidence(
        player.gamesPlayed, 
        player.goalsPerGame, 
        player.recentGoalsPerGame, 
        goalPred.probability,
        player.powerPlayTimeOnIce,
        false, // away
        awayBackToBack,
        opponentGA
      ),
      isValueBet: false,
      breakdown: goalPred.breakdown,
    });
    
    const shotPred = predictShots(player, false, awayBackToBack, 2.5);
    predictions.push({
      playerId: player.playerId,
      playerName: player.name,
      team: awayTeam.name,
      teamAbbrev: awayTeam.abbrev,
      opponent: homeTeam.name,
      opponentAbbrev: homeTeam.abbrev,
      gameTime,
      isHome: false,
      propType: 'shots',
      expectedValue: shotPred.expectedShots,
      probability: shotPred.probability,
      line: 2.5,
      confidence: calculateConfidence(
        player.gamesPlayed, 
        player.shotsPerGame, 
        player.recentShotsPerGame, 
        shotPred.probability,
        player.powerPlayTimeOnIce,
        false,
        awayBackToBack,
        opponentGA
      ),
      isValueBet: false,
      breakdown: shotPred.breakdown,
    });
    
    const pointPred = predictPoints(player, false, awayBackToBack, 0.5);
    predictions.push({
      playerId: player.playerId,
      playerName: player.name,
      team: awayTeam.name,
      teamAbbrev: awayTeam.abbrev,
      opponent: homeTeam.name,
      opponentAbbrev: homeTeam.abbrev,
      gameTime,
      isHome: false,
      propType: 'points',
      expectedValue: pointPred.expectedPoints,
      probability: pointPred.probability,
      line: 0.5,
      confidence: calculateConfidence(
        player.gamesPlayed, 
        player.pointsPerGame, 
        player.recentPointsPerGame, 
        pointPred.probability,
        player.powerPlayTimeOnIce,
        false,
        awayBackToBack,
        opponentGA
      ),
      isValueBet: false,
      breakdown: pointPred.breakdown,
    });
  });
  
  return predictions;
}
