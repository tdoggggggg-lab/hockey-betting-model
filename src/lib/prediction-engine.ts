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
 * Calculate confidence score based on prediction certainty
 * 
 * HIGH confidence = Player is scoring AND consistent (or on a hot streak)
 * MEDIUM confidence = Decent scorer with some variance
 * LOW confidence = Rarely scores OR very inconsistent
 */
export function calculateConfidence(
  gamesPlayed: number,
  goalsPerGame: number,
  recentGoalsPerGame: number,
  probability: number
): number {
  let confidence = 0;
  
  // Factor 1: Sample size (max 0.25)
  if (gamesPlayed >= 30) {
    confidence += 0.25;
  } else if (gamesPlayed >= 20) {
    confidence += 0.20;
  } else if (gamesPlayed >= 10) {
    confidence += 0.12;
  } else {
    confidence += 0.05;
  }
  
  // Factor 2: Recent form vs season average (max 0.35)
  // HOT STREAK: recent > season = BOOST confidence
  // COLD STREAK: recent < season = LOWER confidence
  // CONSISTENT: recent ≈ season = GOOD confidence
  const formRatio = goalsPerGame > 0 ? recentGoalsPerGame / goalsPerGame : 0;
  
  if (formRatio >= 1.2) {
    // Hot streak! Recent scoring is 20%+ above season average
    confidence += 0.35;
  } else if (formRatio >= 0.9) {
    // Consistent - recent form matches season
    confidence += 0.28;
  } else if (formRatio >= 0.6) {
    // Slightly cold
    confidence += 0.15;
  } else {
    // Cold streak or barely scoring recently
    confidence += 0.05;
  }
  
  // Factor 3: Actual scoring rate (max 0.40)
  // Players who score more are more predictable
  // But this is based on RECENT form, not just season average
  const recentRate = recentGoalsPerGame;
  
  if (recentRate >= 0.40) {
    confidence += 0.40; // Scoring almost every other game recently
  } else if (recentRate >= 0.25) {
    confidence += 0.32; // Solid recent scoring
  } else if (recentRate >= 0.15) {
    confidence += 0.22; // Decent recent scoring
  } else if (recentRate >= 0.08) {
    confidence += 0.12; // Occasional scorer
  } else {
    confidence += 0.05; // Rarely scoring
  }
  
  return Math.min(confidence, 1.0); // Cap at 100%
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
      confidence: calculateConfidence(player.gamesPlayed, player.goalsPerGame, player.recentGoalsPerGame, goalPred.probability),
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
      confidence: calculateConfidence(player.gamesPlayed, player.shotsPerGame, player.recentShotsPerGame, shotPred.probability),
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
      confidence: calculateConfidence(player.gamesPlayed, player.pointsPerGame, player.recentPointsPerGame, pointPred.probability),
      isValueBet: false,
      breakdown: pointPred.breakdown,
    });
  });
  
  // Generate predictions for away team players
  awayPlayers.forEach(player => {
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
      confidence: calculateConfidence(player.gamesPlayed, player.goalsPerGame, player.recentGoalsPerGame, goalPred.probability),
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
      confidence: calculateConfidence(player.gamesPlayed, player.shotsPerGame, player.recentShotsPerGame, shotPred.probability),
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
      confidence: calculateConfidence(player.gamesPlayed, player.pointsPerGame, player.recentPointsPerGame, pointPred.probability),
      isValueBet: false,
      breakdown: pointPred.breakdown,
    });
  });
  
  return predictions;
}
