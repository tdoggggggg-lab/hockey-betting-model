/**
 * Bet Classification Service
 * 
 * Based on Wharton research, professional betting standards, and prop-specific analysis:
 * 
 * PROP-SPECIFIC EDGE THRESHOLDS (from research):
 * - Shots/Saves: 3-5% (low variance, volume-driven)
 * - Goals: 5%+ (high variance, binary outcome)
 * - Assists: 3-5% (highest variance, depends on linemates)
 * - Points: 2-3% (medium variance, dual paths to success)
 * 
 * CLASSIFICATION TIERS:
 * - STANDARD VALUE: Edge meets prop-specific minimum
 * - STRONG VALUE: 5-8% edge with good confidence
 * - BEST BET: 8%+ edge with high confidence + sufficient sample size
 * 
 * Conservative thresholds targeting 2-4 high-quality bets per day
 */

export type BetClassification = 'best_bet' | 'strong_value' | 'value' | 'lean' | 'none';

export interface BetAnalysis {
  classification: BetClassification;
  edge: number;              // Model prob - Book prob (can be negative)
  edgePercent: string;       // Formatted edge percentage
  modelProbability: number;
  bookProbability: number;
  bookOdds: number;          // American odds from sportsbook
  bookLine: string;          // e.g., "0.5 Goals", "3.5 Shots"
  fairOdds: number;          // What odds SHOULD be based on model
  expectedValue: number;     // Expected profit per $100 bet
  confidence: number;        // Model confidence (0-1)
  gamesPlayed: number;       // Sample size for reliability
  reasons: string[];         // Why this classification
  kellyFraction: number;     // Recommended bet size (% of bankroll)
}

// ============================================================
// PROP-SPECIFIC THRESHOLDS (from research PDFs)
// ============================================================
// Volume-driven props (shots, saves) tolerate thinner edges
// Binary outcome props (goals) need larger edges due to variance
// ============================================================

type PropType = 'goalscorer' | 'shots' | 'assists' | 'points' | 'saves';

const PROP_THRESHOLDS: Record<PropType, {
  minEdgeValue: number;      // Minimum edge for "Value" classification
  minEdgeStrong: number;     // Minimum edge for "Strong Value"
  minEdgeBest: number;       // Minimum edge for "Best Bet"
  minGamesPlayed: number;    // Sample size requirement
  varianceLevel: 'low' | 'medium' | 'high';
}> = {
  shots: {
    minEdgeValue: 0.03,      // 3% - low variance, volume-driven
    minEdgeStrong: 0.05,     // 5%
    minEdgeBest: 0.07,       // 7%
    minGamesPlayed: 15,      // 15-30 games per research
    varianceLevel: 'low',
  },
  saves: {
    minEdgeValue: 0.03,      // 3% - low variance, opponent-dependent
    minEdgeStrong: 0.05,     // 5%
    minEdgeBest: 0.07,       // 7%
    minGamesPlayed: 20,      // 20+ starts per research
    varianceLevel: 'low',
  },
  points: {
    minEdgeValue: 0.03,      // 3% - medium variance, dual paths (G+A)
    minEdgeStrong: 0.05,     // 5%
    minEdgeBest: 0.08,       // 8%
    minGamesPlayed: 20,      // 20-30 games per research
    varianceLevel: 'medium',
  },
  goalscorer: {
    minEdgeValue: 0.05,      // 5% - HIGH variance, binary outcome
    minEdgeStrong: 0.07,     // 7%
    minEdgeBest: 0.10,       // 10% for best bet on goals
    minGamesPlayed: 30,      // 30+ games per research (high variance)
    varianceLevel: 'high',
  },
  assists: {
    minEdgeValue: 0.04,      // 4% - HIGHEST variance (depends on linemates)
    minEdgeStrong: 0.06,     // 6%
    minEdgeBest: 0.08,       // 8%
    minGamesPlayed: 20,      // 15-20 games per research
    varianceLevel: 'high',
  },
};

// General thresholds
const THRESHOLDS = {
  MIN_PROB_FOR_LEAN: 0.50,       // 50% probability for "lean" (likely to hit)
  MIN_PROB_FOR_BEST: 0.55,       // 55% probability boost for best bets
  MIN_CONFIDENCE_VALUE: 0.50,    // 50% confidence for value bets
  MIN_CONFIDENCE_STRONG: 0.65,   // 65% confidence for strong value
  MIN_CONFIDENCE_BEST: 0.75,     // 75% confidence for best bets
  MAX_EDGE_SUSPICIOUS: 0.25,     // >25% edge = verify for errors
};

// Kelly Criterion fractions (from research: use fractional Kelly)
const KELLY_FRACTIONS: Record<BetClassification, number> = {
  'best_bet': 0.50,      // Half Kelly for best bets (8%+ edge)
  'strong_value': 0.25,  // Quarter Kelly for strong value (5-8%)
  'value': 0.15,         // 15% Kelly for standard value (3-5%)
  'lean': 0.10,          // 10% Kelly for leans
  'none': 0,
};

/**
 * Convert American odds to implied probability
 */
export function americanToImpliedProb(odds: number): number {
  if (odds === 0) return 0;
  
  if (odds > 0) {
    // Underdog: +150 = 100 / (150 + 100) = 40%
    return 100 / (odds + 100);
  } else {
    // Favorite: -150 = 150 / (150 + 100) = 60%
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

/**
 * Convert probability to fair American odds (no vig)
 */
export function probToAmericanOdds(prob: number): number {
  if (prob <= 0 || prob >= 1) return 0;
  
  if (prob >= 0.5) {
    // Favorite: 60% = -150
    return Math.round((-100 * prob) / (1 - prob));
  } else {
    // Underdog: 40% = +150
    return Math.round((100 * (1 - prob)) / prob);
  }
}

/**
 * Format American odds for display
 */
export function formatAmericanOdds(odds: number): string {
  if (odds === 0) return '-';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

/**
 * Calculate expected value of a bet
 * EV = (Win Prob × Payout) - (Loss Prob × Stake)
 * Returns EV per $100 wagered
 */
export function calculateExpectedValue(
  modelProbability: number,
  bookOdds: number
): number {
  if (bookOdds === 0) return 0;
  
  const stake = 100;
  let payout: number;
  
  if (bookOdds > 0) {
    // Underdog: +150 on $100 wins $150
    payout = bookOdds;
  } else {
    // Favorite: -150 on $100 wins $66.67
    payout = (100 / Math.abs(bookOdds)) * 100;
  }
  
  const winProb = modelProbability;
  const loseProb = 1 - modelProbability;
  
  // EV = (P(win) × profit) - (P(lose) × stake)
  const ev = (winProb * payout) - (loseProb * stake);
  
  return Math.round(ev * 100) / 100;
}

/**
 * Classify a bet based on model vs book comparison with prop-specific thresholds
 */
export function classifyBet(
  modelProbability: number,
  bookOdds: number | null,
  propLine: number,
  propType: PropType,
  confidence: number,
  gamesPlayed: number = 30  // Default to meeting threshold if not provided
): BetAnalysis {
  // Get prop-specific thresholds
  const propThresholds = PROP_THRESHOLDS[propType] || PROP_THRESHOLDS.goalscorer;
  
  const result: BetAnalysis = {
    classification: 'none',
    edge: 0,
    edgePercent: '0%',
    modelProbability,
    bookProbability: 0,
    bookOdds: bookOdds || 0,
    bookLine: formatBookLine(propLine, propType),
    fairOdds: probToAmericanOdds(modelProbability),
    expectedValue: 0,
    confidence,
    gamesPlayed,
    reasons: [],
    kellyFraction: 0,
  };
  
  // Check sample size requirement
  const hasSufficientSample = gamesPlayed >= propThresholds.minGamesPlayed;
  if (!hasSufficientSample) {
    result.reasons.push(`⚠️ Low sample: ${gamesPlayed}/${propThresholds.minGamesPlayed} games`);
  }
  
  // If no book odds, can only check for "Lean" (high probability)
  if (!bookOdds) {
    if (modelProbability >= THRESHOLDS.MIN_PROB_FOR_LEAN && 
        confidence >= THRESHOLDS.MIN_CONFIDENCE_VALUE &&
        hasSufficientSample) {
      result.classification = 'lean';
      result.kellyFraction = KELLY_FRACTIONS.lean;
      result.reasons.push(`High probability: ${(modelProbability * 100).toFixed(1)}%`);
      result.reasons.push(`No book odds available`);
    }
    return result;
  }
  
  // Calculate book implied probability
  result.bookProbability = americanToImpliedProb(bookOdds);
  
  // Calculate edge
  result.edge = modelProbability - result.bookProbability;
  result.edgePercent = `${result.edge >= 0 ? '+' : ''}${(result.edge * 100).toFixed(1)}%`;
  
  // Calculate expected value
  result.expectedValue = calculateExpectedValue(modelProbability, bookOdds);
  
  // Check for suspicious edge (possible model error)
  if (result.edge > THRESHOLDS.MAX_EDGE_SUSPICIOUS) {
    result.reasons.push(`⚠️ Edge unusually high (${result.edgePercent}) - verify model`);
  }
  
  // ============================================================
  // CLASSIFICATION LOGIC (prop-specific thresholds)
  // ============================================================
  
  const edge = result.edge;
  const hasMinEdgeBest = edge >= propThresholds.minEdgeBest;
  const hasMinEdgeStrong = edge >= propThresholds.minEdgeStrong;
  const hasMinEdgeValue = edge >= propThresholds.minEdgeValue;
  
  const hasHighConfidence = confidence >= THRESHOLDS.MIN_CONFIDENCE_BEST;
  const hasMedConfidence = confidence >= THRESHOLDS.MIN_CONFIDENCE_STRONG;
  const hasMinConfidence = confidence >= THRESHOLDS.MIN_CONFIDENCE_VALUE;
  
  const isHighProb = modelProbability >= THRESHOLDS.MIN_PROB_FOR_BEST;
  
  // BEST BET: 8%+ edge (prop-specific) + high confidence + sufficient sample
  if (hasMinEdgeBest && hasHighConfidence && hasSufficientSample) {
    result.classification = 'best_bet';
    result.kellyFraction = KELLY_FRACTIONS.best_bet;
    result.reasons.push(`⭐ Best Bet: ${result.edgePercent} edge (min ${(propThresholds.minEdgeBest * 100).toFixed(0)}% for ${propType})`);
    result.reasons.push(`High confidence: ${(confidence * 100).toFixed(0)}%`);
    result.reasons.push(`EV: ${result.expectedValue >= 0 ? '+' : ''}$${result.expectedValue.toFixed(2)}/100`);
    if (isHighProb) result.reasons.push(`Strong probability: ${(modelProbability * 100).toFixed(1)}%`);
  }
  // STRONG VALUE: 5-8% edge (prop-specific) + medium confidence
  else if (hasMinEdgeStrong && hasMedConfidence && hasSufficientSample) {
    result.classification = 'strong_value';
    result.kellyFraction = KELLY_FRACTIONS.strong_value;
    result.reasons.push(`Strong Value: ${result.edgePercent} edge`);
    result.reasons.push(`Confidence: ${(confidence * 100).toFixed(0)}%`);
    result.reasons.push(`EV: ${result.expectedValue >= 0 ? '+' : ''}$${result.expectedValue.toFixed(2)}/100`);
  }
  // VALUE: Meets prop-specific minimum edge + minimum confidence
  else if (hasMinEdgeValue && hasMinConfidence && hasSufficientSample) {
    result.classification = 'value';
    result.kellyFraction = KELLY_FRACTIONS.value;
    result.reasons.push(`Value: ${result.edgePercent} edge (min ${(propThresholds.minEdgeValue * 100).toFixed(0)}% for ${propType})`);
    result.reasons.push(`EV: ${result.expectedValue >= 0 ? '+' : ''}$${result.expectedValue.toFixed(2)}/100`);
  }
  // LEAN: High probability but edge below threshold
  else if (isHighProb && hasMinConfidence && edge > 0) {
    result.classification = 'lean';
    result.kellyFraction = KELLY_FRACTIONS.lean;
    result.reasons.push(`Lean: ${(modelProbability * 100).toFixed(1)}% probability`);
    result.reasons.push(`Small edge: ${result.edgePercent}`);
  }
  
  // Add variance warning for high-variance props
  if (propThresholds.varianceLevel === 'high' && result.classification !== 'none') {
    result.reasons.push(`📊 ${propType}: high variance prop`);
  }
  
  return result;
}

/**
 * Format book line for display
 */
export function formatBookLine(line: number, propType: string): string {
  switch (propType) {
    case 'goalscorer':
      return `${line} Goals`;
    case 'shots':
      return `${line} Shots`;
    case 'assists':
      return `${line} Assists`;
    case 'points':
      return `${line} Points`;
    case 'saves':
      return `${line} Saves`;
    default:
      return `${line}`;
  }
}

/**
 * Get display badge for bet classification
 */
export function getBetBadge(classification: BetClassification): {
  text: string;
  emoji: string;
  color: string;
  bgColor: string;
} {
  switch (classification) {
    case 'best_bet':
      return {
        text: 'Best Bet',
        emoji: '⭐',
        color: 'text-yellow-300',
        bgColor: 'bg-gradient-to-r from-yellow-600/30 to-amber-600/30 border border-yellow-500/50',
      };
    case 'strong_value':
      return {
        text: 'Strong Value',
        emoji: '💰',
        color: 'text-emerald-400',
        bgColor: 'bg-emerald-500/20 border border-emerald-500/50',
      };
    case 'value':
      return {
        text: 'Value',
        emoji: '✓',
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/20 border border-blue-500/50',
      };
    case 'lean':
      return {
        text: 'Lean',
        emoji: '→',
        color: 'text-slate-400',
        bgColor: 'bg-slate-500/20 border border-slate-500/50',
      };
    default:
      return {
        text: '-',
        emoji: '',
        color: 'text-slate-600',
        bgColor: '',
      };
  }
}

/**
 * Get expected daily bet count summary
 */
export function summarizeBets(bets: BetAnalysis[]): {
  bestBet: number;
  strongValue: number;
  value: number;
  lean: number;
  total: number;
  averageEdge: number;
  averageEV: number;
  totalKellyExposure: number;
} {
  const bestBet = bets.filter(b => b.classification === 'best_bet').length;
  const strongValue = bets.filter(b => b.classification === 'strong_value').length;
  const value = bets.filter(b => b.classification === 'value').length;
  const lean = bets.filter(b => b.classification === 'lean').length;
  
  const betsWithEdge = bets.filter(b => b.edge > 0);
  const averageEdge = betsWithEdge.length > 0
    ? betsWithEdge.reduce((sum, b) => sum + b.edge, 0) / betsWithEdge.length
    : 0;
  
  const betsWithEV = bets.filter(b => b.expectedValue !== 0);
  const averageEV = betsWithEV.length > 0
    ? betsWithEV.reduce((sum, b) => sum + b.expectedValue, 0) / betsWithEV.length
    : 0;
  
  // Total recommended Kelly exposure
  const totalKellyExposure = bets.reduce((sum, b) => sum + (b.kellyFraction || 0), 0);
  
  return {
    bestBet,
    strongValue,
    value,
    lean,
    total: bestBet + strongValue + value + lean,
    averageEdge,
    averageEV,
    totalKellyExposure,
  };
}

/**
 * Sort bets by quality (Best Bet > Strong Value > Value > Lean > None)
 */
export function sortBetsByQuality(bets: BetAnalysis[]): BetAnalysis[] {
  const priority: Record<BetClassification, number> = {
    'best_bet': 0,
    'strong_value': 1,
    'value': 2,
    'lean': 3,
    'none': 4,
  };
  
  return [...bets].sort((a, b) => {
    // First by classification priority
    const priorityDiff = priority[a.classification] - priority[b.classification];
    if (priorityDiff !== 0) return priorityDiff;
    
    // Then by edge (descending)
    if (a.edge !== b.edge) return b.edge - a.edge;
    
    // Then by probability (descending)
    return b.modelProbability - a.modelProbability;
  });
}

/**
 * Filter to only actionable bets (excludes 'none' and 'lean')
 */
export function filterActionableBets(bets: BetAnalysis[]): BetAnalysis[] {
  return bets.filter(b => 
    b.classification !== 'none' && 
    b.classification !== 'lean' &&
    b.confidence >= THRESHOLDS.MIN_CONFIDENCE_VALUE
  );
}

/**
 * Get prop-specific threshold info for display
 */
export function getPropThresholds(propType: PropType): {
  minEdgeValue: string;
  minEdgeStrong: string;
  minEdgeBest: string;
  minGamesPlayed: number;
  varianceLevel: string;
} {
  const thresholds = PROP_THRESHOLDS[propType] || PROP_THRESHOLDS.goalscorer;
  return {
    minEdgeValue: `${(thresholds.minEdgeValue * 100).toFixed(0)}%`,
    minEdgeStrong: `${(thresholds.minEdgeStrong * 100).toFixed(0)}%`,
    minEdgeBest: `${(thresholds.minEdgeBest * 100).toFixed(0)}%`,
    minGamesPlayed: thresholds.minGamesPlayed,
    varianceLevel: thresholds.varianceLevel,
  };
}
