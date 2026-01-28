/**
 * NHL Game Prediction Model
 * 
 * Based on research findings:
 * - xG is best predictor (R² = 0.45-0.55)
 * - Home ice: ~54-56% win rate (+3.5-7% probability)
 * - Back-to-back: 57.3% win for rested team
 * - Goalie stats are nearly random (r=0.12 year-to-year)
 * - Max achievable accuracy: ~60-64%
 * 
 * Model weights (inspired by MoneyPuck):
 * - Scoring/xG metrics: 54%
 * - Team ability (win%, goals): 17%
 * - Goaltending: 29% (but regressed heavily)
 */

export interface TeamStats {
  teamAbbrev: string;
  teamName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  otLosses: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  powerPlayPct: number;
  penaltyKillPct: number;
  shotsForPerGame: number;
  shotsAgainstPerGame: number;
  faceoffWinPct: number;
  // Calculated
  goalDifferential: number;
  winPct: number;
  pointsPct: number;
  // xG approximation (using shot quality proxy)
  xGF: number; // Expected goals for
  xGA: number; // Expected goals against
  xGDiff: number;
  pdo: number; // Shooting% + Save% (luck indicator)
}

export interface GamePrediction {
  gameId: string;
  homeTeam: TeamStats;
  awayTeam: TeamStats;
  homeWinProb: number;
  awayWinProb: number;
  predictedTotal: number;
  confidence: number;
  edge?: number; // vs betting line
  factors: {
    baseProb: number;
    homeIceAdj: number;
    restAdj: number;
    goalieAdj: number;
    formAdj: number;
    specialTeamsAdj: number;
  };
  recommendation: 'HOME' | 'AWAY' | 'PASS';
  reasoning: string[];
}

// League averages for 2024-25 season
const LEAGUE_AVG = {
  goalsPerGame: 3.05,
  shotsPerGame: 29.5,
  savePercentage: 0.897,
  powerPlayPct: 21.5,
  penaltyKillPct: 78.5,
  homeWinPct: 0.545,
  shootingPct: 10.3,
};

// Home ice advantage: +3.5-7% probability (research shows ~54-56% home win rate)
const HOME_ICE_BOOST = 0.045; // 4.5% boost to home team

// Back-to-back penalty (research: 57.3% win for rested team)
const B2B_PENALTY = 0.073; // 7.3% swing

/**
 * Fetch team standings/stats from NHL API
 */
export async function getTeamStats(teamAbbrev: string): Promise<TeamStats | null> {
  try {
    // Get standings for basic stats
    const standingsRes = await fetch('https://api-web.nhle.com/v1/standings/now');
    if (!standingsRes.ok) return null;
    
    const standingsData = await standingsRes.json();
    const team = (standingsData.standings || []).find(
      (t: any) => t.teamAbbrev?.default === teamAbbrev
    );
    
    if (!team) return null;
    
    const gp = team.gamesPlayed || 1;
    const gf = team.goalFor || 0;
    const ga = team.goalAgainst || 0;
    const wins = team.wins || 0;
    const losses = team.losses || 0;
    const otLosses = team.otLosses || 0;
    
    // Get detailed team stats
    const statsRes = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`);
    let shotsFor = LEAGUE_AVG.shotsPerGame;
    let shotsAgainst = LEAGUE_AVG.shotsPerGame;
    let ppPct = LEAGUE_AVG.powerPlayPct;
    let pkPct = LEAGUE_AVG.penaltyKillPct;
    let foPct = 50;
    
    if (statsRes.ok) {
      const statsData = await statsRes.json();
      // Extract from skaters aggregate if available
      const skaters = statsData.skaters || [];
      if (skaters.length > 0) {
        const totalShots = skaters.reduce((sum: number, p: any) => sum + (p.shots || 0), 0);
        shotsFor = totalShots / gp;
      }
    }
    
    // Calculate xG approximation using Fenwick-style approach
    // xG ≈ shots * league_avg_shooting% * shot_quality_factor
    const shootingPct = gf / (shotsFor * gp) * 100 || LEAGUE_AVG.shootingPct;
    const savePct = 1 - (ga / (shotsAgainst * gp)) || LEAGUE_AVG.savePercentage;
    const pdo = shootingPct + (savePct * 100);
    
    // xG calculation (simplified - using shots and league average)
    const xGF = (shotsFor * gp * LEAGUE_AVG.shootingPct / 100) / gp;
    const xGA = (shotsAgainst * gp * (1 - LEAGUE_AVG.savePercentage)) / gp;
    
    return {
      teamAbbrev,
      teamName: team.teamName?.default || teamAbbrev,
      gamesPlayed: gp,
      wins,
      losses,
      otLosses,
      points: team.points || 0,
      goalsFor: gf,
      goalsAgainst: ga,
      goalsForPerGame: gf / gp,
      goalsAgainstPerGame: ga / gp,
      powerPlayPct: ppPct,
      penaltyKillPct: pkPct,
      shotsForPerGame: shotsFor,
      shotsAgainstPerGame: shotsAgainst,
      faceoffWinPct: foPct,
      goalDifferential: gf - ga,
      winPct: wins / gp,
      pointsPct: team.points / (gp * 2),
      xGF,
      xGA,
      xGDiff: xGF - xGA,
      pdo,
    };
  } catch (error) {
    console.error(`Error fetching stats for ${teamAbbrev}:`, error);
    return null;
  }
}

/**
 * Check if team played yesterday (back-to-back)
 */
export async function isBackToBack(teamAbbrev: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/club-schedule/${teamAbbrev}/week/now`);
    if (!response.ok) return false;
    
    const data = await response.json();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    return (data.games || []).some((g: any) => g.gameDate === yesterdayStr);
  } catch {
    return false;
  }
}

/**
 * Calculate PDO regression factor
 * PDO regresses to 100 - extreme values indicate luck
 */
function getPDORegression(pdo: number): number {
  // PDO typically ranges 97-103
  // Teams with PDO > 102 are "lucky", < 98 are "unlucky"
  const deviation = pdo - 100;
  // Regress by ~50% (research suggests PDO is ~50% luck)
  return 1 - (deviation * 0.005); // Small adjustment per PDO point
}

/**
 * Calculate special teams edge
 * PP% correlates r=0.601, PK r=-0.462 with wins
 */
function getSpecialTeamsEdge(team: TeamStats, opponent: TeamStats): number {
  // PP advantage when opponent has weak PK
  const ppEdge = (team.powerPlayPct - LEAGUE_AVG.powerPlayPct) * 0.006;
  // PK advantage when opponent has strong PP
  const pkEdge = (team.penaltyKillPct - LEAGUE_AVG.penaltyKillPct) * 0.004;
  
  return ppEdge + pkEdge;
}

/**
 * Main prediction function
 * Uses weighted factors based on research
 */
export function predictGame(
  homeTeam: TeamStats,
  awayTeam: TeamStats,
  homeB2B: boolean,
  awayB2B: boolean
): GamePrediction {
  const reasoning: string[] = [];
  
  // 1. BASE PROBABILITY from goal differential (strongest predictor)
  // Convert goal differential to win probability using logistic function
  const goalDiffAdvantage = homeTeam.goalsForPerGame - homeTeam.goalsAgainstPerGame -
                           (awayTeam.goalsForPerGame - awayTeam.goalsAgainstPerGame);
  
  // Logistic conversion: P = 1 / (1 + e^(-k*x)) where k ≈ 0.15 for NHL
  let baseProb = 1 / (1 + Math.exp(-0.15 * goalDiffAdvantage * 10));
  
  // Normalize to account for typical home/away splits
  baseProb = 0.5 + (baseProb - 0.5) * 0.8; // Dampen extreme predictions
  
  // 2. xG ADJUSTMENT (54% weight in MoneyPuck model)
  const xGAdvantage = homeTeam.xGDiff - awayTeam.xGDiff;
  const xGAdj = xGAdvantage * 0.02; // 2% per xG differential
  
  // 3. HOME ICE (research: +3.5-7%)
  const homeIceAdj = HOME_ICE_BOOST;
  reasoning.push(`Home ice: +${(homeIceAdj * 100).toFixed(1)}%`);
  
  // 4. REST ADVANTAGE (research: 57.3% for rested vs tired)
  let restAdj = 0;
  if (homeB2B && !awayB2B) {
    restAdj = -B2B_PENALTY;
    reasoning.push(`Home on B2B: -${(B2B_PENALTY * 100).toFixed(1)}%`);
  } else if (!homeB2B && awayB2B) {
    restAdj = B2B_PENALTY;
    reasoning.push(`Away on B2B: +${(B2B_PENALTY * 100).toFixed(1)}%`);
  }
  
  // 5. PDO REGRESSION (luck factor)
  const homePDOFactor = getPDORegression(homeTeam.pdo);
  const awayPDOFactor = getPDORegression(awayTeam.pdo);
  const pdoAdj = (homePDOFactor - awayPDOFactor) * 0.03;
  
  if (homeTeam.pdo > 102) {
    reasoning.push(`${homeTeam.teamAbbrev} PDO ${homeTeam.pdo.toFixed(1)} (due for regression)`);
  }
  if (awayTeam.pdo > 102) {
    reasoning.push(`${awayTeam.teamAbbrev} PDO ${awayTeam.pdo.toFixed(1)} (due for regression)`);
  }
  
  // 6. SPECIAL TEAMS
  const homeSTEdge = getSpecialTeamsEdge(homeTeam, awayTeam);
  const awaySTEdge = getSpecialTeamsEdge(awayTeam, homeTeam);
  const specialTeamsAdj = (homeSTEdge - awaySTEdge);
  
  if (Math.abs(specialTeamsAdj) > 0.02) {
    const better = specialTeamsAdj > 0 ? homeTeam.teamAbbrev : awayTeam.teamAbbrev;
    reasoning.push(`${better} special teams edge`);
  }
  
  // 7. GOALIE ADJUSTMENT (29% weight but heavily regressed due to r=0.12 reliability)
  // We can't predict goalie performance well, so this is minimal
  const goalieAdj = 0; // Placeholder - would need confirmed starter data
  
  // COMBINE ALL FACTORS
  let homeWinProb = baseProb + xGAdj + homeIceAdj + restAdj + pdoAdj + specialTeamsAdj + goalieAdj;
  
  // Bound probability between 0.25 and 0.75 (research: NHL is unpredictable)
  homeWinProb = Math.max(0.25, Math.min(0.75, homeWinProb));
  const awayWinProb = 1 - homeWinProb;
  
  // PREDICTED TOTAL (goals)
  const predictedTotal = homeTeam.goalsForPerGame + awayTeam.goalsForPerGame;
  
  // CONFIDENCE (based on sample size and factor alignment)
  let confidence = 0.4; // Base
  
  // More games = more confidence
  if (homeTeam.gamesPlayed >= 20 && awayTeam.gamesPlayed >= 20) {
    confidence += 0.15;
    reasoning.push('Season sample size adequate (20+ games)');
  }
  
  // Clear favorite = more confidence
  if (Math.abs(homeWinProb - 0.5) > 0.15) {
    confidence += 0.1;
  }
  
  // Rest advantage is reliable
  if (Math.abs(restAdj) > 0) {
    confidence += 0.1;
  }
  
  // Goal differential alignment with xG = sustainable
  const gdAlignment = Math.sign(homeTeam.goalDifferential) === Math.sign(homeTeam.xGDiff);
  if (gdAlignment) {
    confidence += 0.05;
  }
  
  confidence = Math.min(0.85, confidence);
  
  // RECOMMENDATION
  let recommendation: 'HOME' | 'AWAY' | 'PASS' = 'PASS';
  if (homeWinProb >= 0.58 && confidence >= 0.55) {
    recommendation = 'HOME';
  } else if (awayWinProb >= 0.58 && confidence >= 0.55) {
    recommendation = 'AWAY';
  }
  
  return {
    gameId: `${awayTeam.teamAbbrev}-${homeTeam.teamAbbrev}`,
    homeTeam,
    awayTeam,
    homeWinProb,
    awayWinProb,
    predictedTotal,
    confidence,
    factors: {
      baseProb,
      homeIceAdj,
      restAdj,
      goalieAdj,
      formAdj: xGAdj,
      specialTeamsAdj,
    },
    recommendation,
    reasoning,
  };
}

/**
 * Convert probability to American odds
 */
export function probToOdds(prob: number): number {
  if (prob >= 0.5) {
    return Math.round(-100 * prob / (1 - prob));
  }
  return Math.round(100 * (1 - prob) / prob);
}

/**
 * Calculate edge vs sportsbook odds
 */
export function calculateEdge(modelProb: number, bookOdds: number): number {
  // Convert American odds to implied probability
  let impliedProb: number;
  if (bookOdds < 0) {
    impliedProb = Math.abs(bookOdds) / (Math.abs(bookOdds) + 100);
  } else {
    impliedProb = 100 / (bookOdds + 100);
  }
  
  return modelProb - impliedProb;
}
