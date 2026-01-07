// src/lib/injury-service.ts
// ============================================================
// COMPREHENSIVE NHL INJURY SYSTEM - FULLY AUTOMATIC
// ============================================================
// 
// ALL player importance is calculated from STATS, not hardcoded names!
// This means in 10 years when there's a new superstar, the model
// will automatically detect them based on:
// - Points share of team
// - Time on ice rank
// - Power play time
// - Penalty kill time
// - Goals above expected
//
// FEATURES:
// 1. Auto player importance from stats
// 2. Position value (G > D > C > W)
// 3. Star concentration risk (single-star teams hurt more)
// 4. Rust factor for returning players
// 5. B2B + injury compounding (multiplicative)
// 6. Multiple injury non-linear effects
// 7. Linemate production drops
// 8. Line promotion penalties
// 9. DAY_TO_DAY filtering (Tom Wilson fix)
// ============================================================

// ============ TYPES ============

export interface PlayerInjury {
  playerId: string;
  playerName: string;
  team: string;
  teamAbbrev: string;
  position: string;
  status: 'OUT' | 'DAY_TO_DAY' | 'IR' | 'LTIR' | 'SUSPENDED' | 'QUESTIONABLE';
  injuryType: string;
  description: string;
  expectedReturn?: string;
  gamesOut?: number;
  source: string;
  updatedAt: string;
}

export interface PlayerImportance {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  tier: 1 | 2 | 3 | 4 | 5;
  importanceScore: number;
  pointsShare: number;
  toiRank: number;
  ppTimeShare: number;
  pkTimeShare: number;
  goalsAboveExpected: number;
  winProbImpact: number;
  ppImpact: number;
  pkImpact: number;
}

export interface StarConcentration {
  tier1Count: number;
  tier2Count: number;
  topPlayerShare: number;
  secondPlayerShare: number;
  hasSecondaryStar: boolean;
  concentrationMultiplier: number;
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  description: string;
}

export interface TeamInjuryImpact {
  teamAbbrev: string;
  injuries: PlayerInjury[];
  totalWinProbAdjustment: number;
  powerPlayAdjustment: number;
  penaltyKillAdjustment: number;
  expectedGoalsForAdjustment: number;
  expectedGoalsAgainstAdjustment: number;
  goalieSituation: 'starter' | 'backup' | 'emergency' | 'unknown';
  isBackupGoalieElite: boolean;
  affectedLinemates: Map<string, number>;
  linePromotions: number;
  defenseDisruption: number;
  manGamesLost: number;
  injuryCount: number;
  compoundingMultiplier: number;
  starConcentration: StarConcentration;
  starPlayersOut: string[];
  summary: string;
}

export interface ReturningPlayer {
  playerName: string;
  team: string;
  gamesSinceReturn: number;
  rustPenalty: number;
}

// ============ POSITION VALUE MULTIPLIERS ============

const POSITION_VALUE: Record<string, number> = {
  'G': 1.50,
  'D': 1.20,
  'C': 1.10,
  'LW': 1.00,
  'RW': 1.00,
  'F': 1.05,
};

const MAX_WIN_PROB_IMPACT: Record<string, number> = {
  'G': 0.10,
  'D': 0.07,
  'C': 0.06,
  'LW': 0.05,
  'RW': 0.05,
  'F': 0.05,
};

// ============ TIER THRESHOLDS ============

const TIER_THRESHOLDS = {
  1: 0.70,
  2: 0.50,
  3: 0.35,
  4: 0.20,
  5: 0.00,
};

// ============ STAR CONCENTRATION MULTIPLIERS ============
// Research: Buffalo .517→.143 without Dahlin (72% drop)
// Pittsburgh .632 without Crosby (Malkin stepped up)
// Colorado .833 without MacKinnon (Makar/Rantanen)

const STAR_CONCENTRATION_MULTIPLIERS = {
  extreme: 1.40,  // Single star, no backup (Buffalo)
  high: 1.25,     // Single star with decent #2
  medium: 1.00,   // Two stars (Pittsburgh)
  low: 0.80,      // Three+ stars (Colorado)
};

// ============ RUST FACTOR ============

const RUST_PENALTY: Record<number, number> = {
  1: 0.08,
  2: 0.06,
  3: 0.04,
  4: 0.02,
  5: 0.01,
};

// ============ COMPOUNDING ============

function calculateCompoundingMultiplier(injuryCount: number, manGamesLost: number): number {
  let multiplier = 1.0;
  if (injuryCount >= 2) multiplier = 1.15;
  if (injuryCount >= 3) multiplier = 1.30;
  if (injuryCount >= 4) multiplier = 1.50;
  if (injuryCount >= 5) multiplier = 1.75;
  if (manGamesLost > 30) multiplier *= 1.10;
  return Math.min(multiplier, 2.0);
}

// ============ LINEMATE DROP ============

const LINEMATE_DROP_BY_TIER: Record<number, number> = {
  1: 0.65,
  2: 0.75,
  3: 0.85,
  4: 0.95,
  5: 1.00,
};

const LINE_PROMOTION_PENALTY = 0.85;

// ============ ESPN TEAM MAP ============

const ESPN_TEAM_MAP: Record<string, string> = {
  '1': 'BOS', '2': 'BUF', '3': 'CGY', '4': 'CAR', '5': 'CHI',
  '6': 'COL', '7': 'CBJ', '8': 'DAL', '9': 'DET', '10': 'EDM',
  '11': 'FLA', '12': 'LAK', '13': 'MIN', '14': 'MTL', '15': 'NSH',
  '16': 'NJD', '17': 'NYI', '18': 'NYR', '19': 'OTT', '20': 'PHI',
  '21': 'PIT', '22': 'SJS', '23': 'SEA', '24': 'STL', '25': 'ANA',
  '26': 'TBL', '27': 'TOR', '28': 'UTA', '29': 'VAN', '30': 'VGK',
  '31': 'WSH', '32': 'WPG',
};

// ============ CACHE ============

interface InjuryCache {
  injuries: Map<string, PlayerInjury[]>;
  playerImportance: Map<string, PlayerImportance>;
  teamStarConcentration: Map<string, StarConcentration>;
  teamImpacts: Map<string, TeamInjuryImpact>;
  allInjuredNames: Set<string>;
  returningPlayers: Map<string, ReturningPlayer>;
  timestamp: number;
}

let injuryCache: InjuryCache = {
  injuries: new Map(),
  playerImportance: new Map(),
  teamStarConcentration: new Map(),
  teamImpacts: new Map(),
  allInjuredNames: new Set(),
  returningPlayers: new Map(),
  timestamp: 0,
};

const CACHE_TTL = 7200000;

// ============ HELPERS ============

function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, '')
    .replace(/[^a-z\s-]/g, '')
    .trim();
}

function mapStatus(espnStatus: string): PlayerInjury['status'] {
  const status = espnStatus.toLowerCase();
  if (status.includes('out') || status === 'o') return 'OUT';
  if (status.includes('day-to-day') || status.includes('dtd') || status === 'd') return 'DAY_TO_DAY';
  if (status.includes('injured reserve') || (status.includes('ir') && !status.includes('lt'))) return 'IR';
  if (status.includes('ltir') || status.includes('long term')) return 'LTIR';
  if (status.includes('suspend')) return 'SUSPENDED';
  if (status.includes('question') || status === 'q') return 'QUESTIONABLE';
  return 'OUT';
}

// ============ STAR CONCENTRATION CALCULATOR ============

function calculateStarConcentration(players: any[], teamStats: any): StarConcentration {
  if (!players.length || !teamStats.points) {
    return {
      tier1Count: 0, tier2Count: 0, topPlayerShare: 0, secondPlayerShare: 0,
      hasSecondaryStar: false, concentrationMultiplier: 1.0,
      riskLevel: 'medium', description: 'Unknown - no data',
    };
  }
  
  const sortedByPoints = [...players].sort((a, b) => (b.points || 0) - (a.points || 0));
  const teamTotalPoints = teamStats.points || 1;
  
  const topPlayer = sortedByPoints[0];
  const secondPlayer = sortedByPoints[1];
  const topPlayerPoints = topPlayer?.points || 0;
  const secondPlayerPoints = secondPlayer?.points || 0;
  
  const topPlayerShare = topPlayerPoints / teamTotalPoints;
  const secondPlayerShare = secondPlayerPoints / teamTotalPoints;
  
  // Does #2 have at least 70% of #1's production?
  const hasSecondaryStar = topPlayerPoints > 0 && (secondPlayerPoints / topPlayerPoints) >= 0.70;
  
  let tier1Count = 0;
  let tier2Count = 0;
  
  for (const player of sortedByPoints.slice(0, 10)) {
    const pointsShare = (player.points || 0) / teamTotalPoints;
    if (pointsShare >= 0.15) tier1Count++;
    else if (pointsShare >= 0.10) tier2Count++;
  }
  
  let concentrationMultiplier: number;
  let riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  let description: string;
  
  if (tier1Count === 1 && !hasSecondaryStar && tier2Count === 0) {
    concentrationMultiplier = STAR_CONCENTRATION_MULTIPLIERS.extreme;
    riskLevel = 'extreme';
    description = 'Single superstar, no backup - EXTREME injury risk';
  } else if (tier1Count === 1 && (hasSecondaryStar || tier2Count >= 1)) {
    concentrationMultiplier = STAR_CONCENTRATION_MULTIPLIERS.high;
    riskLevel = 'high';
    description = 'Single superstar with secondary option';
  } else if (tier1Count >= 2 || (tier1Count === 1 && tier2Count >= 2)) {
    concentrationMultiplier = STAR_CONCENTRATION_MULTIPLIERS.medium;
    riskLevel = 'medium';
    description = 'Multiple stars - balanced risk';
  } else if (tier1Count >= 2 && tier2Count >= 1) {
    concentrationMultiplier = STAR_CONCENTRATION_MULTIPLIERS.low;
    riskLevel = 'low';
    description = 'Deep star power - injury resilient';
  } else {
    concentrationMultiplier = 1.0;
    riskLevel = 'medium';
    description = 'Average roster construction';
  }
  
  return {
    tier1Count, tier2Count, topPlayerShare, secondPlayerShare,
    hasSecondaryStar, concentrationMultiplier, riskLevel, description,
  };
}

// ============ AUTO PLAYER IMPORTANCE ============

async function calculatePlayerImportance(
  player: any, teamStats: any, allTeamPlayers: any[]
): Promise<PlayerImportance> {
  const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
  const position = player.positionCode || 'F';
  const gp = player.gamesPlayed || 1;
  
  const teamPoints = teamStats?.points || 1;
  const playerPoints = player.points || 0;
  const pointsShare = Math.min(playerPoints / Math.max(teamPoints * 0.15, 1), 1);
  
  const playerTOI = player.avgToi || player.timeOnIcePerGame || 0;
  const sortedByTOI = allTeamPlayers
    .filter(p => p.positionCode !== 'G')
    .sort((a, b) => (b.avgToi || b.timeOnIcePerGame || 0) - (a.avgToi || a.timeOnIcePerGame || 0));
  const toiRank = sortedByTOI.findIndex(p => p.playerId === player.playerId) + 1;
  const toiRankNormalized = toiRank > 0 ? 1 - ((toiRank - 1) / Math.max(sortedByTOI.length - 1, 1)) : 0.5;
  
  const ppTOI = player.powerPlayTimeOnIce || player.ppToi || 0;
  const teamPPTOI = allTeamPlayers.reduce((sum, p) => sum + (p.powerPlayTimeOnIce || p.ppToi || 0), 0) || 1;
  const ppTimeShare = Math.min(ppTOI / teamPPTOI, 0.4);
  
  const pkTOI = player.shorthandedTimeOnIce || player.shToi || 0;
  const teamPKTOI = allTeamPlayers.reduce((sum, p) => sum + (p.shorthandedTimeOnIce || p.shToi || 0), 0) || 1;
  const pkTimeShare = Math.min(pkTOI / teamPKTOI, 0.4);
  
  const goals = player.goals || 0;
  const xG = player.expectedGoals || (goals * 0.9);
  const goalsAboveExpected = (goals - xG) / Math.max(gp, 1);
  const gaxNormalized = Math.max(0, Math.min(1, (goalsAboveExpected + 0.2) / 0.4));
  
  const positionMultiplier = POSITION_VALUE[position] || 1.0;
  
  let importanceScore = (
    0.30 * pointsShare +
    0.25 * toiRankNormalized +
    0.20 * (ppTimeShare / 0.4) +
    0.10 * (pkTimeShare / 0.4) +
    0.10 * gaxNormalized +
    0.05 * (positionMultiplier - 1) * 2
  );
  
  importanceScore *= positionMultiplier;
  importanceScore = Math.min(importanceScore, 1.0);
  
  let tier: 1 | 2 | 3 | 4 | 5 = 5;
  if (importanceScore >= TIER_THRESHOLDS[1]) tier = 1;
  else if (importanceScore >= TIER_THRESHOLDS[2]) tier = 2;
  else if (importanceScore >= TIER_THRESHOLDS[3]) tier = 3;
  else if (importanceScore >= TIER_THRESHOLDS[4]) tier = 4;
  
  const maxImpact = MAX_WIN_PROB_IMPACT[position] || 0.05;
  const winProbImpact = importanceScore * maxImpact;
  const ppImpact = ppTimeShare > 0.25 ? -0.06 : ppTimeShare > 0.15 ? -0.04 : ppTimeShare > 0.05 ? -0.02 : 0;
  const pkImpact = pkTimeShare > 0.25 ? -0.04 : pkTimeShare > 0.15 ? -0.02 : 0;
  
  return {
    playerId: player.playerId?.toString() || '', playerName: name, team: player.teamAbbrev || '',
    position, tier, importanceScore, pointsShare, toiRank, ppTimeShare, pkTimeShare,
    goalsAboveExpected, winProbImpact, ppImpact, pkImpact,
  };
}

// ============ GOALIE IMPORTANCE ============

async function calculateGoalieImportance(goalie: any, allGoalies: any[]): Promise<PlayerImportance> {
  const name = `${goalie.firstName?.default || ''} ${goalie.lastName?.default || ''}`.trim();
  const gp = goalie.gamesPlayed || 0;
  
  const sortedGoalies = allGoalies.sort((a, b) => (b.gamesPlayed || 0) - (a.gamesPlayed || 0));
  const isStarter = sortedGoalies[0]?.playerId === goalie.playerId;
  
  const savePct = goalie.savePctg || goalie.savePercentage || 0.900;
  const savePctScore = Math.max(0, Math.min(1, (savePct - 0.880) / 0.040));
  
  const gsaa = goalie.goalsAgainstAverage ? (2.80 - goalie.goalsAgainstAverage) / 1.0 : 0;
  const gsaaScore = Math.max(0, Math.min(1, (gsaa + 0.5) / 1.0));
  
  const teamGames = allGoalies.reduce((sum, g) => sum + (g.gamesPlayed || 0), 0) || 1;
  const workloadShare = gp / teamGames;
  
  let importanceScore = (0.35 * savePctScore + 0.30 * gsaaScore + 0.25 * workloadShare + 0.10 * (isStarter ? 1 : 0));
  importanceScore *= POSITION_VALUE['G'];
  importanceScore = Math.min(importanceScore, 1.0);
  
  let tier: 1 | 2 | 3 | 4 | 5 = 5;
  if (importanceScore >= 0.65) tier = 1;
  else if (importanceScore >= 0.50) tier = 2;
  else if (importanceScore >= 0.35) tier = 3;
  else if (importanceScore >= 0.20) tier = 4;
  
  const winProbImpact = isStarter ? (importanceScore * 0.10) : (importanceScore * 0.04);
  
  return {
    playerId: goalie.playerId?.toString() || '', playerName: name, team: goalie.teamAbbrev || '',
    position: 'G', tier, importanceScore, pointsShare: 0, toiRank: isStarter ? 1 : 2,
    ppTimeShare: 0, pkTimeShare: 0, goalsAboveExpected: gsaaScore, winProbImpact, ppImpact: 0, pkImpact: 0,
  };
}

// ============ FETCH ESPN INJURIES ============

async function fetchESPNInjuries(): Promise<Map<string, PlayerInjury[]>> {
  const injuries = new Map<string, PlayerInjury[]>();
  
  try {
    const teamsRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams', {
      headers: { 'Accept': 'application/json' },
    });
    
    if (!teamsRes.ok) return injuries;
    
    const teamsData = await teamsRes.json();
    const teams = teamsData.sports?.[0]?.leagues?.[0]?.teams || [];
    
    const batchSize = 8;
    for (let i = 0; i < teams.length; i += batchSize) {
      const batch = teams.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (teamData: any) => {
        try {
          const espnId = teamData.team?.id;
          const abbrev = ESPN_TEAM_MAP[espnId];
          if (!abbrev) return;
          
          const injuryRes = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${espnId}/injuries`,
            { headers: { 'Accept': 'application/json' } }
          );
          
          if (!injuryRes.ok) return;
          
          const injuryData = await injuryRes.json();
          const teamInjuries: PlayerInjury[] = [];
          
          for (const item of injuryData.items || []) {
            const athlete = item.athlete || {};
            const injury: PlayerInjury = {
              playerId: athlete.id || '',
              playerName: athlete.displayName || athlete.fullName || '',
              team: teamData.team?.displayName || '',
              teamAbbrev: abbrev,
              position: athlete.position?.abbreviation || 'F',
              status: mapStatus(item.status || 'out'),
              injuryType: item.type?.description || item.details?.type || 'Undisclosed',
              description: item.longComment || item.shortComment || '',
              expectedReturn: item.details?.returnDate || undefined,
              source: 'ESPN',
              updatedAt: new Date().toISOString(),
            };
            
            if (injury.playerName) teamInjuries.push(injury);
          }
          
          if (teamInjuries.length > 0) injuries.set(abbrev, teamInjuries);
        } catch (e) {}
      }));
      
      if (i + batchSize < teams.length) await new Promise(r => setTimeout(r, 200));
    }
  } catch (error) {
    console.error('❌ ESPN injuries fetch error:', error);
  }
  
  return injuries;
}

// ============ FETCH TEAM STATS ============

async function fetchTeamPlayerStats(teamAbbrev: string): Promise<{ players: any[], goalies: any[], teamStats: any }> {
  try {
    const skatersRes = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`);
    
    let players: any[] = [];
    let goalies: any[] = [];
    let teamStats: any = {};
    
    if (skatersRes.ok) {
      const data = await skatersRes.json();
      players = [...(data.skaters || [])];
      goalies = [...(data.goalies || [])];
      teamStats.points = players.reduce((sum, p) => sum + (p.points || 0), 0);
      teamStats.goals = players.reduce((sum, p) => sum + (p.goals || 0), 0);
    }
    
    return { players, goalies, teamStats };
  } catch (error) {
    return { players: [], goalies: [], teamStats: {} };
  }
}

// ============ CALCULATE TEAM INJURY IMPACT ============

async function calculateTeamImpact(teamAbbrev: string, injuries: PlayerInjury[]): Promise<TeamInjuryImpact> {
  const { players, goalies, teamStats } = await fetchTeamPlayerStats(teamAbbrev);
  const starConcentration = calculateStarConcentration(players, teamStats);
  injuryCache.teamStarConcentration.set(teamAbbrev, starConcentration);
  
  const impact: TeamInjuryImpact = {
    teamAbbrev, injuries, totalWinProbAdjustment: 0, powerPlayAdjustment: 0,
    penaltyKillAdjustment: 0, expectedGoalsForAdjustment: 0, expectedGoalsAgainstAdjustment: 0,
    goalieSituation: 'starter', isBackupGoalieElite: false, affectedLinemates: new Map(),
    linePromotions: 0, defenseDisruption: 0, manGamesLost: 0, injuryCount: 0,
    compoundingMultiplier: 1.0, starConcentration, starPlayersOut: [], summary: '',
  };
  
  // Filter active injuries (includes DAY_TO_DAY!)
  const activeInjuries = injuries.filter(i => 
    i.status === 'OUT' || i.status === 'IR' || i.status === 'LTIR' || 
    i.status === 'SUSPENDED' || i.status === 'DAY_TO_DAY'
  );
  
  if (activeInjuries.length === 0) {
    impact.summary = 'No significant injuries';
    return impact;
  }
  
  impact.injuryCount = activeInjuries.length;
  
  let centersOut = 0, defensemenOut = 0, topPlayerInjured = false;
  
  for (const injury of activeInjuries) {
    const playerStats = [...players, ...goalies].find(p => 
      normalizePlayerName(`${p.firstName?.default || ''} ${p.lastName?.default || ''}`) === 
      normalizePlayerName(injury.playerName)
    );
    
    let importance: PlayerImportance;
    
    if (injury.position === 'G') {
      importance = await calculateGoalieImportance(playerStats || { 
        playerId: injury.playerId, firstName: { default: injury.playerName.split(' ')[0] },
        lastName: { default: injury.playerName.split(' ').slice(1).join(' ') },
        gamesPlayed: 30, savePctg: 0.910,
      }, goalies);
      
      if (importance.toiRank === 1) {
        impact.goalieSituation = 'backup';
        const backup = goalies.find(g => g.playerId !== playerStats?.playerId);
        if (backup && (backup.savePctg || backup.savePercentage || 0) >= 0.913) {
          impact.isBackupGoalieElite = true;
          importance.winProbImpact *= 0.5;
        }
      }
    } else {
      importance = await calculatePlayerImportance(
        playerStats || {
          playerId: injury.playerId, firstName: { default: injury.playerName.split(' ')[0] },
          lastName: { default: injury.playerName.split(' ').slice(1).join(' ') },
          positionCode: injury.position, gamesPlayed: 40, points: 20, avgToi: 900,
        }, teamStats, players
      );
      
      if (injury.position === 'C') centersOut++;
      if (injury.position === 'D') defensemenOut++;
      if (importance.toiRank === 1 || importance.tier === 1) topPlayerInjured = true;
    }
    
    injuryCache.playerImportance.set(importance.playerId, importance);
    
    impact.totalWinProbAdjustment += importance.winProbImpact;
    impact.powerPlayAdjustment += importance.ppImpact;
    impact.penaltyKillAdjustment += importance.pkImpact;
    
    if (importance.tier <= 2) impact.starPlayersOut.push(`${injury.playerName} (T${importance.tier})`);
    
    if (importance.tier <= 3) {
      const linemateDropRate = LINEMATE_DROP_BY_TIER[importance.tier];
      players.filter(p => Math.abs((p.avgToi || 0) - (playerStats?.avgToi || 0)) < 120).slice(0, 4)
        .forEach(p => {
          const name = `${p.firstName?.default || ''} ${p.lastName?.default || ''}`.trim();
          impact.affectedLinemates.set(name, (impact.affectedLinemates.get(name) || 1.0) * linemateDropRate);
        });
    }
    
    impact.manGamesLost += 5;
  }
  
  if (centersOut >= 1) { impact.linePromotions += centersOut * 3; impact.expectedGoalsForAdjustment -= 0.15 * centersOut; }
  if (defensemenOut >= 1) { impact.defenseDisruption = Math.min(defensemenOut * 0.3, 1.0); impact.expectedGoalsAgainstAdjustment += 0.20 * defensemenOut; }
  
  impact.compoundingMultiplier = calculateCompoundingMultiplier(impact.injuryCount, impact.manGamesLost);
  
  // APPLY STAR CONCENTRATION MULTIPLIER!
  let concentrationMultiplier = 1.0;
  if (impact.starPlayersOut.length > 0 || topPlayerInjured) {
    concentrationMultiplier = starConcentration.concentrationMultiplier;
  }
  
  impact.totalWinProbAdjustment *= impact.compoundingMultiplier * concentrationMultiplier;
  impact.powerPlayAdjustment *= impact.compoundingMultiplier;
  impact.penaltyKillAdjustment *= impact.compoundingMultiplier;
  
  impact.totalWinProbAdjustment = Math.max(-0.30, impact.totalWinProbAdjustment);
  impact.powerPlayAdjustment = Math.max(-0.15, impact.powerPlayAdjustment);
  impact.penaltyKillAdjustment = Math.max(-0.10, impact.penaltyKillAdjustment);
  
  const parts: string[] = [];
  if (impact.starPlayersOut.length > 0) parts.push(`Out: ${impact.starPlayersOut.join(', ')}`);
  if (impact.goalieSituation === 'backup') parts.push(impact.isBackupGoalieElite ? 'Elite backup' : 'Backup goalie');
  if (starConcentration.riskLevel === 'extreme' || starConcentration.riskLevel === 'high') {
    parts.push(`⚠️ ${starConcentration.riskLevel.toUpperCase()} star dependency`);
  }
  if (impact.compoundingMultiplier > 1.1) parts.push(`${impact.injuryCount} injuries compounding`);
  impact.summary = parts.join(' | ') || 'Minor injuries only';
  
  return impact;
}

// ============ PUBLIC API ============

export async function refreshInjuryCache(): Promise<void> {
  console.log('🔄 Refreshing injury cache...');
  const startTime = Date.now();
  
  const injuries = await fetchESPNInjuries();
  const teamImpacts = new Map<string, TeamInjuryImpact>();
  const allInjuredNames = new Set<string>();
  
  for (const [teamAbbrev, teamInjuries] of injuries) {
    const impact = await calculateTeamImpact(teamAbbrev, teamInjuries);
    teamImpacts.set(teamAbbrev, impact);
    
    for (const injury of teamInjuries) {
      if (injury.status === 'OUT' || injury.status === 'IR' || injury.status === 'LTIR' ||
          injury.status === 'DAY_TO_DAY' || injury.status === 'SUSPENDED') {
        allInjuredNames.add(normalizePlayerName(injury.playerName));
      }
    }
  }
  
  injuryCache = { ...injuryCache, injuries, teamImpacts, allInjuredNames, timestamp: Date.now() };
  
  const totalInjuries = Array.from(injuries.values()).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`✅ Injury cache: ${totalInjuries} injuries (${Date.now() - startTime}ms)`);
}

export async function getTeamInjuryImpact(teamAbbrev: string): Promise<TeamInjuryImpact | null> {
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) await refreshInjuryCache();
  return injuryCache.teamImpacts.get(teamAbbrev) || null;
}

export async function getAllInjuries(): Promise<Map<string, PlayerInjury[]>> {
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) await refreshInjuryCache();
  return injuryCache.injuries;
}

export async function isPlayerInjured(playerName: string): Promise<boolean> {
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) await refreshInjuryCache();
  return injuryCache.allInjuredNames.has(normalizePlayerName(playerName));
}

export function getInjuredPlayerNames(): Set<string> { return injuryCache.allInjuredNames; }

export function getTeamStarConcentration(teamAbbrev: string): StarConcentration | null {
  return injuryCache.teamStarConcentration.get(teamAbbrev) || null;
}

// ============ GAME PREDICTION ADJUSTMENTS ============

export interface GamePredictionAdjustments {
  homeWinProbAdjustment: number; awayWinProbAdjustment: number;
  homePPAdjustment: number; awayPPAdjustment: number;
  homePKAdjustment: number; awayPKAdjustment: number;
  expectedTotalAdjustment: number;
  homeInjurySummary: string; awayInjurySummary: string;
  homeStarsOut: string[]; awayStarsOut: string[];
  homeGoalieSituation: string; awayGoalieSituation: string;
  homeStarConcentration: StarConcentration | null; awayStarConcentration: StarConcentration | null;
  compoundingWarning: string;
}

export async function getGamePredictionAdjustments(
  homeTeam: string, awayTeam: string, isHomeB2B: boolean = false, isAwayB2B: boolean = false
): Promise<GamePredictionAdjustments> {
  const homeImpact = await getTeamInjuryImpact(homeTeam);
  const awayImpact = await getTeamInjuryImpact(awayTeam);
  
  let homeAdj = homeImpact?.totalWinProbAdjustment || 0;
  let awayAdj = awayImpact?.totalWinProbAdjustment || 0;
  
  // B2B + Injuries compound MULTIPLICATIVELY
  if (isHomeB2B && homeImpact && homeImpact.injuryCount > 0) {
    const b2bPenalty = 0.05;
    homeAdj = -((1 - (1 - b2bPenalty) * (1 - Math.abs(homeAdj))) - Math.abs(homeAdj));
  }
  if (isAwayB2B && awayImpact && awayImpact.injuryCount > 0) {
    const b2bPenalty = 0.05;
    awayAdj = -((1 - (1 - b2bPenalty) * (1 - Math.abs(awayAdj))) - Math.abs(awayAdj));
  }
  
  const warnings: string[] = [];
  if (homeImpact?.starConcentration?.riskLevel === 'extreme') warnings.push(`${homeTeam}: EXTREME star dependency`);
  if (awayImpact?.starConcentration?.riskLevel === 'extreme') warnings.push(`${awayTeam}: EXTREME star dependency`);
  
  return {
    homeWinProbAdjustment: homeAdj, awayWinProbAdjustment: awayAdj,
    homePPAdjustment: homeImpact?.powerPlayAdjustment || 0, awayPPAdjustment: awayImpact?.powerPlayAdjustment || 0,
    homePKAdjustment: homeImpact?.penaltyKillAdjustment || 0, awayPKAdjustment: awayImpact?.penaltyKillAdjustment || 0,
    expectedTotalAdjustment: (homeImpact?.expectedGoalsForAdjustment || 0) + (awayImpact?.expectedGoalsForAdjustment || 0) +
      (homeImpact?.expectedGoalsAgainstAdjustment || 0) + (awayImpact?.expectedGoalsAgainstAdjustment || 0),
    homeInjurySummary: homeImpact?.summary || 'Healthy', awayInjurySummary: awayImpact?.summary || 'Healthy',
    homeStarsOut: homeImpact?.starPlayersOut || [], awayStarsOut: awayImpact?.starPlayersOut || [],
    homeGoalieSituation: homeImpact?.goalieSituation || 'unknown', awayGoalieSituation: awayImpact?.goalieSituation || 'unknown',
    homeStarConcentration: homeImpact?.starConcentration || null, awayStarConcentration: awayImpact?.starConcentration || null,
    compoundingWarning: warnings.join(' | '),
  };
}

// ============ PLAYER PROPS ADJUSTMENTS ============

export interface PlayerPropsAdjustment {
  productionMultiplier: number; rustPenalty: number; isInjured: boolean; reason: string;
}

export async function getPlayerPropsAdjustment(playerName: string, teamAbbrev: string): Promise<PlayerPropsAdjustment> {
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) await refreshInjuryCache();
  
  const normalizedName = normalizePlayerName(playerName);
  
  if (injuryCache.allInjuredNames.has(normalizedName)) {
    return { productionMultiplier: 0, rustPenalty: 0, isInjured: true, reason: 'Player is OUT' };
  }
  
  let multiplier = 1.0;
  let rustPenalty = 0;
  const reasons: string[] = [];
  
  const returning = injuryCache.returningPlayers.get(normalizedName);
  if (returning && returning.gamesSinceReturn <= 5) {
    rustPenalty = RUST_PENALTY[returning.gamesSinceReturn] || 0;
    reasons.push(`Rust game ${returning.gamesSinceReturn} (-${Math.round(rustPenalty * 100)}%)`);
  }
  
  const impact = injuryCache.teamImpacts.get(teamAbbrev);
  if (impact) {
    const linemateMultiplier = impact.affectedLinemates.get(playerName);
    if (linemateMultiplier && linemateMultiplier < 1.0) {
      multiplier *= linemateMultiplier;
      reasons.push(`Linemate injured (-${Math.round((1 - linemateMultiplier) * 100)}%)`);
    }
    if (impact.linePromotions > 0) { multiplier *= LINE_PROMOTION_PENALTY; reasons.push('Line shuffling (-15%)'); }
  }
  
  multiplier *= (1 - rustPenalty);
  return { productionMultiplier: multiplier, rustPenalty, isInjured: false, reason: reasons.join(', ') || '' };
}

export function trackReturningPlayer(playerName: string, team: string): void {
  const normalized = normalizePlayerName(playerName);
  const existing = injuryCache.returningPlayers.get(normalized);
  if (existing) {
    existing.gamesSinceReturn++;
    if (existing.gamesSinceReturn > 5) injuryCache.returningPlayers.delete(normalized);
  } else {
    injuryCache.returningPlayers.set(normalized, { playerName, team, gamesSinceReturn: 1, rustPenalty: RUST_PENALTY[1] });
  }
}

export function getCacheStatus() {
  const totalInjuries = Array.from(injuryCache.injuries.values()).reduce((sum, arr) => sum + arr.length, 0);
  const starPlayersOut: string[] = [];
  for (const impact of injuryCache.teamImpacts.values()) starPlayersOut.push(...impact.starPlayersOut);
  const teamsWithHighConcentration: string[] = [];
  for (const [team, conc] of injuryCache.teamStarConcentration) {
    if (conc.riskLevel === 'extreme' || conc.riskLevel === 'high') teamsWithHighConcentration.push(`${team} (${conc.riskLevel})`);
  }
  return {
    lastUpdate: new Date(injuryCache.timestamp).toISOString(),
    teamsWithInjuries: injuryCache.injuries.size,
    totalInjuries, starPlayersOut,
    playersReturning: Array.from(injuryCache.returningPlayers.values()).map(p => `${p.playerName} (game ${p.gamesSinceReturn})`),
    teamsWithHighConcentration,
  };
}
