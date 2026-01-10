/**
 * Bet Classification Service
 * 
 * Based on Wharton research and professional betting standards:
 * - VALUE BET: Model probability > Book implied probability (7%+ edge)
 * - BEST BET: 55%+ probability (most likely to hit)
 * - BEST VALUE: Both criteria met (rare, highest quality)
 * 
 * Conservative thresholds targeting 2-4 high-quality bets per day
 */

export type BetClassification = 'best_value' | 'value' | 'best' | 'none';

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
  reasons: string[];         // Why this classification
}

// Conservative thresholds from research
const THRESHOLDS = {
  MIN_EDGE_FOR_VALUE: 0.07,      // 7% minimum edge (Wharton: 5-10%)
  MIN_PROB_FOR_BEST: 0.55,       // 55% probability for "likely to hit"
  MIN_CONFIDENCE: 0.50,          // 50% model confidence required
  MAX_EDGE_SUSPICIOUS: 0.20,     // >20% edge = verify for errors
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
 * Classify a bet based on model vs book comparison
 */
export function classifyBet(
  modelProbability: number,
  bookOdds: number | null,
  propLine: number,
  propType: 'goalscorer' | 'shots' | 'assists' | 'points' | 'saves',
  confidence: number
): BetAnalysis {
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
    reasons: [],
  };
  
  // If no book odds, can only check for "Best" (high probability)
  if (!bookOdds) {
    if (modelProbability >= THRESHOLDS.MIN_PROB_FOR_BEST && confidence >= THRESHOLDS.MIN_CONFIDENCE) {
      result.classification = 'best';
      result.reasons.push(`High probability: ${(modelProbability * 100).toFixed(1)}%`);
      result.reasons.push(`Confidence: ${(confidence * 100).toFixed(0)}%`);
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
  
  // Classify the bet
  const hasEdge = result.edge >= THRESHOLDS.MIN_EDGE_FOR_VALUE;
  const isLikelyHit = modelProbability >= THRESHOLDS.MIN_PROB_FOR_BEST;
  const hasConfidence = confidence >= THRESHOLDS.MIN_CONFIDENCE;
  
  if (hasEdge && isLikelyHit && hasConfidence) {
    // BEST VALUE: Both edge AND high probability
    result.classification = 'best_value';
    result.reasons.push(`Edge: ${result.edgePercent} (model ${(modelProbability * 100).toFixed(1)}% vs book ${(result.bookProbability * 100).toFixed(1)}%)`);
    result.reasons.push(`High probability: ${(modelProbability * 100).toFixed(1)}%`);
    result.reasons.push(`EV: ${result.expectedValue >= 0 ? '+' : ''}$${result.expectedValue.toFixed(2)} per $100`);
  } else if (hasEdge && hasConfidence) {
    // VALUE: Has edge but not necessarily likely to hit
    result.classification = 'value';
    result.reasons.push(`Edge: ${result.edgePercent}`);
    result.reasons.push(`EV: ${result.expectedValue >= 0 ? '+' : ''}$${result.expectedValue.toFixed(2)} per $100`);
  } else if (isLikelyHit && hasConfidence) {
    // BEST: Likely to hit but no significant edge
    result.classification = 'best';
    result.reasons.push(`High probability: ${(modelProbability * 100).toFixed(1)}%`);
    if (result.edge > 0) {
      result.reasons.push(`Small edge: ${result.edgePercent}`);
    }
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
  color: string;
  bgColor: string;
} {
  switch (classification) {
    case 'best_value':
      return {
        text: 'Best Value',
        color: 'text-yellow-300',
        bgColor: 'bg-gradient-to-r from-yellow-600/30 to-emerald-600/30 border border-yellow-500/50',
      };
    case 'value':
      return {
        text: 'Value',
        color: 'text-emerald-400',
        bgColor: 'bg-emerald-500/20 border border-emerald-500/50',
      };
    case 'best':
      return {
        text: 'Best',
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/20 border border-blue-500/50',
      };
    default:
      return {
        text: '-',
        color: 'text-slate-600',
        bgColor: '',
      };
  }
}

/**
 * Get expected daily bet count summary
 */
export function summarizeBets(bets: BetAnalysis[]): {
  bestValue: number;
  value: number;
  best: number;
  total: number;
  averageEdge: number;
  averageEV: number;
} {
  const bestValue = bets.filter(b => b.classification === 'best_value').length;
  const value = bets.filter(b => b.classification === 'value').length;
  const best = bets.filter(b => b.classification === 'best').length;
  
  const betsWithEdge = bets.filter(b => b.edge > 0);
  const averageEdge = betsWithEdge.length > 0
    ? betsWithEdge.reduce((sum, b) => sum + b.edge, 0) / betsWithEdge.length
    : 0;
  
  const betsWithEV = bets.filter(b => b.expectedValue !== 0);
  const averageEV = betsWithEV.length > 0
    ? betsWithEV.reduce((sum, b) => sum + b.expectedValue, 0) / betsWithEV.length
    : 0;
  
  return {
    bestValue,
    value,
    best,
    total: bestValue + value + best,
    averageEdge,
    averageEV,
  };
}

/**
 * Sort bets by quality (Best Value > Value > Best > None)
 */
export function sortBetsByQuality(bets: BetAnalysis[]): BetAnalysis[] {
  const priority: Record<BetClassification, number> = {
    'best_value': 0,
    'value': 1,
    'best': 2,
    'none': 3,
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
 * Filter to only actionable bets
 */
export function filterActionableBets(bets: BetAnalysis[]): BetAnalysis[] {
  return bets.filter(b => 
    b.classification !== 'none' && 
    b.confidence >= THRESHOLDS.MIN_CONFIDENCE
  );
}
