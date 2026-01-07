// src/lib/injury-service.ts
// Comprehensive NHL Injury System with Auto Player Importance Detection
// Incorporates: position value, rust factor, B2B compounding, replacement quality, cascading effects

// ============ TYPES ============

export interface PlayerInjury {
  playerId: string;
  playerName: string;
  team: string;
  teamAbbrev: string;
  position: string;  // C, LW, RW, D, G
  status: 'OUT' | 'DAY_TO_DAY' | 'IR' | 'LTIR' | 'SUSPENDED' | 'QUESTIONABLE';
  injuryType: string;
  description: string;
  expectedReturn?: string;
  gamesOut?: number;  // Track how long they've been out (for rust calculation when returning)
  source: string;
  updatedAt: string;
}

export interface PlayerImportance {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  tier: 1 | 2 | 3 | 4 | 5;  // Auto-calculated tier
  importanceScore: number;  // 0-1 scale
  // Components that make up the score
  pointsShare: number;      // % of team points
  toiRank: number;          // 1 = most ice time on team
  ppTimeShare: number;      // % of team PP time
  pkTimeShare: number;      // % of team PK time
  goalsAboveExpected: number;
  // Calculated impact
  winProbImpact: number;    // How much losing this player hurts team
  ppImpact: number;         // How much PP% drops
  pkImpact: number;         // How much PK% drops
}

export interface TeamInjuryImpact {
  teamAbbrev: string;
  injuries: PlayerInjury[];
  // Calculated impacts
  totalWinProbAdjustment: number;
  powerPlayAdjustment: number;
  penaltyKillAdjustment: number;
  expectedGoalsForAdjustment: number;
  expectedGoalsAgainstAdjustment: number;
  // Situational
  goalieSituation: 'starter' | 'backup' | 'emergency' | 'unknown';
  isBackupGoalieElite: boolean;  // Elite backups minimize impact
  // Cascading effects
  affectedLinemates: Map<string, number>;  // player -> production multiplier
  linePromotions: number;  // Count of players promoted
  defenseDisruption: number;  // 0-1 scale
  // Multiple injury compounding
  manGamesLost: number;
  injuryCount: number;
  compoundingMultiplier: number;  // >1 when multiple injuries compound
  // Summary
  starPlayersOut: string[];
  summary: string;
}

export interface ReturningPlayer {
  playerName: string;
  team: string;
  gamesSinceReturn: number;
  rustPenalty: number;  // 0-0.10 (0-10% penalty)
}

// ============ POSITION VALUE MULTIPLIERS ============
// Research: Goalie > Defenseman > Center > Winger

const POSITION_VALUE: Record<string, number> = {
  'G': 1.50,   // Goalies are most valuable - backup costs 10+ standings points/season
  'D': 1.20,   // Top D controls 40%+ of team's D scoring, runs PP
  'C': 1.10,   // Centers handle faceoffs, 200-foot game
  'LW': 1.00,  // Baseline
  'RW': 1.00,  // Baseline
  'F': 1.05,   // Generic forward
};

// Max impact caps by position (research: no skater worth more than ~5%)
const MAX_WIN_PROB_IMPACT: Record<string, number> = {
  'G': 0.10,   // Elite goalie loss = 8-10%
  'D': 0.07,   // Elite D loss = 5-7%
  'C': 0.06,   // Elite C loss = 4-6%
  'LW': 0.05,  // Elite winger loss = 3-5%
  'RW': 0.05,
  'F': 0.05,
};

// ============ TIER THRESHOLDS ============
// Auto-calculated based on importance score

const TIER_THRESHOLDS = {
  1: 0.70,  // Superstar (top ~5% of league)
  2: 0.50,  // Star (top 5-15%)
  3: 0.35,  // Quality starter (top 15-35%)
  4: 0.20,  // Solid depth
  5: 0.00,  // Replacement level
};

// ============ RUST FACTOR ============
// Research: U-shaped recovery, -5% to -10% games 1-2, normalizes by game 6

const RUST_PENALTY: Record<number, number> = {
  1: 0.08,   // First game back: -8%
  2: 0.06,   // Second game: -6%
  3: 0.04,   // Third game: -4%
  4: 0.02,   // Fourth game: -2%
  5: 0.01,   // Fifth game: -1%
  // After 5 games: 0 (normalized)
};

// ============ MULTIPLE INJURY COMPOUNDING ============
// Research: Non-linear - 3 injuries worse than 3x 1 injury

function calculateCompoundingMultiplier(injuryCount: number, manGamesLost: number): number {
  // Base multiplier from injury count (diminishing roster depth)
  let multiplier = 1.0;
  
  if (injuryCount >= 2) multiplier = 1.15;  // 2 injuries = 15% worse than sum
  if (injuryCount >= 3) multiplier = 1.30;  // 3 injuries = 30% worse
  if (injuryCount >= 4) multiplier = 1.50;  // 4+ injuries = 50% worse
  if (injuryCount >= 5) multiplier = 1.75;  // Severe roster damage
  
  // Additional penalty if approaching the "cliff" (>400 man-games lost)
  // This is season-long but we estimate per-game impact
  if (manGamesLost > 30) multiplier *= 1.10;  // Roughly >400/82 per game
  
  return Math.min(multiplier, 2.0);  // Cap at 2x
}

// ============ LINEMATE PRODUCTION DROP ============
// Research: 25-50% drop when star linemate is out

const LINEMATE_DROP_BY_TIER: Record<number, number> = {
  1: 0.65,  // Tier 1 star out = linemates at 65% (35% drop)
  2: 0.75,  // Tier 2 star out = 25% drop
  3: 0.85,  // Tier 3 out = 15% drop
  4: 0.95,  // Tier 4 out = 5% drop
  5: 1.00,  // No impact
};

// Line promotion penalty (players moved up face tougher matchups)
const LINE_PROMOTION_PENALTY = 0.85;  // 15% worse when promoted

// ============ ESPN API INTEGRATION ============

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
  playerImportance: Map<string, PlayerImportance>;  // playerId -> importance
  teamImpacts: Map<string, TeamInjuryImpact>;
  allInjuredNames: Set<string>;
  returningPlayers: Map<string, ReturningPlayer>;  // Track rust
  timestamp: number;
}

let injuryCache: InjuryCache = {
  injuries: new Map(),
  playerImportance: new Map(),
  teamImpacts: new Map(),
  allInjuredNames: new Set(),
  returningPlayers: new Map(),
  timestamp: 0,
};

const CACHE_TTL = 7200000; // 2 hours

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
  if (status.includes('question') || status === 'q' || status.includes('probable')) return 'QUESTIONABLE';
  return 'OUT';
}

// ============ AUTO PLAYER IMPORTANCE CALCULATION ============
// This replaces the hardcoded STAR_PLAYERS list!

async function calculatePlayerImportance(
  player: any,
  teamStats: any,
  allTeamPlayers: any[]
): Promise<PlayerImportance> {
  const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
  const position = player.positionCode || 'F';
  const gp = player.gamesPlayed || 1;
  
  // 1. Points share of team (0-1)
  const teamPoints = teamStats?.points || 1;
  const playerPoints = player.points || 0;
  const pointsShare = Math.min(playerPoints / Math.max(teamPoints * 0.15, 1), 1);  // Cap at ~15% share = 1.0
  
  // 2. TOI rank on team (normalized 0-1, where 1 = most ice time)
  const playerTOI = player.avgToi || player.timeOnIcePerGame || 0;
  const sortedByTOI = allTeamPlayers
    .filter(p => p.positionCode !== 'G')
    .sort((a, b) => (b.avgToi || b.timeOnIcePerGame || 0) - (a.avgToi || a.timeOnIcePerGame || 0));
  const toiRank = sortedByTOI.findIndex(p => p.playerId === player.playerId) + 1;
  const toiRankNormalized = toiRank > 0 ? 1 - ((toiRank - 1) / Math.max(sortedByTOI.length - 1, 1)) : 0.5;
  
  // 3. PP time share (indicates offensive value)
  const ppTOI = player.powerPlayTimeOnIce || player.ppToi || 0;
  const teamPPTOI = allTeamPlayers.reduce((sum, p) => sum + (p.powerPlayTimeOnIce || p.ppToi || 0), 0) || 1;
  const ppTimeShare = Math.min(ppTOI / teamPPTOI, 0.4);  // Cap at 40%
  
  // 4. PK time share (indicates defensive value/trust)
  const pkTOI = player.shorthandedTimeOnIce || player.shToi || 0;
  const teamPKTOI = allTeamPlayers.reduce((sum, p) => sum + (p.shorthandedTimeOnIce || p.shToi || 0), 0) || 1;
  const pkTimeShare = Math.min(pkTOI / teamPKTOI, 0.4);
  
  // 5. Goals above expected (finishing ability)
  const goals = player.goals || 0;
  const xG = player.expectedGoals || (goals * 0.9);  // Estimate if not available
  const goalsAboveExpected = (goals - xG) / Math.max(gp, 1);
  const gaxNormalized = Math.max(0, Math.min(1, (goalsAboveExpected + 0.2) / 0.4));
  
  // 6. Position multiplier
  const positionMultiplier = POSITION_VALUE[position] || 1.0;
  
  // Calculate composite importance score
  // Weights based on research: production > ice time > PP > PK > finishing
  let importanceScore = (
    0.30 * pointsShare +
    0.25 * toiRankNormalized +
    0.20 * (ppTimeShare / 0.4) +  // Normalize PP share
    0.10 * (pkTimeShare / 0.4) +  // Normalize PK share
    0.10 * gaxNormalized +
    0.05 * (positionMultiplier - 1) * 2  // Position bonus
  );
  
  // Apply position multiplier to final score
  importanceScore *= positionMultiplier;
  importanceScore = Math.min(importanceScore, 1.0);
  
  // Determine tier
  let tier: 1 | 2 | 3 | 4 | 5 = 5;
  if (importanceScore >= TIER_THRESHOLDS[1]) tier = 1;
  else if (importanceScore >= TIER_THRESHOLDS[2]) tier = 2;
  else if (importanceScore >= TIER_THRESHOLDS[3]) tier = 3;
  else if (importanceScore >= TIER_THRESHOLDS[4]) tier = 4;
  
  // Calculate impact values
  const maxImpact = MAX_WIN_PROB_IMPACT[position] || 0.05;
  const winProbImpact = importanceScore * maxImpact;
  
  // PP impact based on PP time share
  const ppImpact = ppTimeShare > 0.25 ? -0.06 : ppTimeShare > 0.15 ? -0.04 : ppTimeShare > 0.05 ? -0.02 : 0;
  
  // PK impact based on PK time share  
  const pkImpact = pkTimeShare > 0.25 ? -0.04 : pkTimeShare > 0.15 ? -0.02 : 0;
  
  return {
    playerId: player.playerId?.toString() || '',
    playerName: name,
    team: player.teamAbbrev || '',
    position,
    tier,
    importanceScore,
    pointsShare,
    toiRank,
    ppTimeShare,
    pkTimeShare,
    goalsAboveExpected,
    winProbImpact,
    ppImpact,
    pkImpact,
  };
}

// ============ GOALIE IMPORTANCE (SPECIAL HANDLING) ============

async function calculateGoalieImportance(
  goalie: any,
  allGoalies: any[]
): Promise<PlayerImportance> {
  const name = `${goalie.firstName?.default || ''} ${goalie.lastName?.default || ''}`.trim();
  const gp = goalie.gamesPlayed || 0;
  
  // Determine if starter (most games played)
  const sortedGoalies = allGoalies.sort((a, b) => (b.gamesPlayed || 0) - (a.gamesPlayed || 0));
  const isStarter = sortedGoalies[0]?.playerId === goalie.playerId;
  
  // Save percentage quality
  const savePct = goalie.savePctg || goalie.savePercentage || 0.900;
  const savePctScore = Math.max(0, Math.min(1, (savePct - 0.880) / 0.040));  // .880 = 0, .920 = 1
  
  // Goals saved above average
  const gsaa = goalie.goalsAgainstAverage ? (2.80 - goalie.goalsAgainstAverage) / 1.0 : 0;
  const gsaaScore = Math.max(0, Math.min(1, (gsaa + 0.5) / 1.0));
  
  // Workload (games played share)
  const teamGames = allGoalies.reduce((sum, g) => sum + (g.gamesPlayed || 0), 0) || 1;
  const workloadShare = gp / teamGames;
  
  // Calculate importance
  let importanceScore = (
    0.35 * savePctScore +
    0.30 * gsaaScore +
    0.25 * workloadShare +
    0.10 * (isStarter ? 1 : 0)
  );
  
  // Goalies are inherently more valuable
  importanceScore *= POSITION_VALUE['G'];
  importanceScore = Math.min(importanceScore, 1.0);
  
  // Tier
  let tier: 1 | 2 | 3 | 4 | 5 = 5;
  if (importanceScore >= 0.65) tier = 1;  // Elite goalie
  else if (importanceScore >= 0.50) tier = 2;  // Quality starter
  else if (importanceScore >= 0.35) tier = 3;  // Average starter
  else if (importanceScore >= 0.20) tier = 4;  // Backup
  
  // Win probability impact (goalies have biggest impact)
  const winProbImpact = isStarter ? (importanceScore * 0.10) : (importanceScore * 0.04);
  
  return {
    playerId: goalie.playerId?.toString() || '',
    playerName: name,
    team: goalie.teamAbbrev || '',
    position: 'G',
    tier,
    importanceScore,
    pointsShare: 0,
    toiRank: isStarter ? 1 : 2,
    ppTimeShare: 0,
    pkTimeShare: 0,
    goalsAboveExpected: gsaaScore,
    winProbImpact,
    ppImpact: 0,
    pkImpact: 0,
  };
}

// ============ FETCH INJURIES FROM ESPN ============

async function fetchESPNInjuries(): Promise<Map<string, PlayerInjury[]>> {
  const injuries = new Map<string, PlayerInjury[]>();
  
  try {
    const teamsRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams', {
      headers: { 'Accept': 'application/json' },
    });
    
    if (!teamsRes.ok) {
      console.log('❌ Failed to fetch ESPN teams');
      return injuries;
    }
    
    const teamsData = await teamsRes.json();
    const teams = teamsData.sports?.[0]?.leagues?.[0]?.teams || [];
    
    console.log(`📊 Fetching injuries for ${teams.length} teams...`);
    
    // Batch fetch
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
            
            if (injury.playerName) {
              teamInjuries.push(injury);
            }
          }
          
          if (teamInjuries.length > 0) {
            injuries.set(abbrev, teamInjuries);
          }
        } catch (e) {
          // Skip failed teams
        }
      }));
      
      if (i + batchSize < teams.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    
  } catch (error) {
    console.error('❌ ESPN injuries fetch error:', error);
  }
  
  return injuries;
}

// ============ FETCH TEAM STATS FOR IMPORTANCE CALC ============

async function fetchTeamPlayerStats(teamAbbrev: string): Promise<{ players: any[], goalies: any[], teamStats: any }> {
  try {
    // Fetch skater stats
    const skatersRes = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`);
    const goaliesRes = await fetch(`https://api-web.nhle.com/v1/club-stats-season/${teamAbbrev}`);
    
    let players: any[] = [];
    let goalies: any[] = [];
    let teamStats: any = {};
    
    if (skatersRes.ok) {
      const data = await skatersRes.json();
      players = [...(data.skaters || [])];
      goalies = [...(data.goalies || [])];
      
      // Calculate team totals
      teamStats.points = players.reduce((sum, p) => sum + (p.points || 0), 0);
      teamStats.goals = players.reduce((sum, p) => sum + (p.goals || 0), 0);
    }
    
    return { players, goalies, teamStats };
  } catch (error) {
    console.log(`⚠️ Could not fetch stats for ${teamAbbrev}`);
    return { players: [], goalies: [], teamStats: {} };
  }
}

// ============ CALCULATE TEAM INJURY IMPACT ============

async function calculateTeamImpact(
  teamAbbrev: string,
  injuries: PlayerInjury[]
): Promise<TeamInjuryImpact> {
  const impact: TeamInjuryImpact = {
    teamAbbrev,
    injuries,
    totalWinProbAdjustment: 0,
    powerPlayAdjustment: 0,
    penaltyKillAdjustment: 0,
    expectedGoalsForAdjustment: 0,
    expectedGoalsAgainstAdjustment: 0,
    goalieSituation: 'starter',
    isBackupGoalieElite: false,
    affectedLinemates: new Map(),
    linePromotions: 0,
    defenseDisruption: 0,
    manGamesLost: 0,
    injuryCount: 0,
    compoundingMultiplier: 1.0,
    starPlayersOut: [],
    summary: '',
  };
  
  // Filter to active injuries only
  const activeInjuries = injuries.filter(i => 
    i.status === 'OUT' || i.status === 'IR' || i.status === 'LTIR' || i.status === 'SUSPENDED'
  );
  
  if (activeInjuries.length === 0) {
    impact.summary = 'No significant injuries';
    return impact;
  }
  
  impact.injuryCount = activeInjuries.length;
  
  // Fetch team stats to calculate importance
  const { players, goalies, teamStats } = await fetchTeamPlayerStats(teamAbbrev);
  
  // Calculate importance for each injured player
  let centersOut = 0;
  let defensemenOut = 0;
  let goaliePrimaryOut = false;
  
  for (const injury of activeInjuries) {
    // Find player stats
    const playerStats = [...players, ...goalies].find(p => 
      normalizePlayerName(`${p.firstName?.default || ''} ${p.lastName?.default || ''}`) === 
      normalizePlayerName(injury.playerName)
    );
    
    let importance: PlayerImportance;
    
    if (injury.position === 'G') {
      // Goalie importance
      importance = await calculateGoalieImportance(playerStats || { 
        playerId: injury.playerId,
        firstName: { default: injury.playerName.split(' ')[0] },
        lastName: { default: injury.playerName.split(' ').slice(1).join(' ') },
        gamesPlayed: 30,  // Assume starter if injured
        savePctg: 0.910,
      }, goalies);
      
      if (importance.toiRank === 1) {
        goaliePrimaryOut = true;
        impact.goalieSituation = 'backup';
        
        // Check if backup is elite (.913+ save%)
        const backup = goalies.find(g => g.playerId !== playerStats?.playerId);
        if (backup && (backup.savePctg || backup.savePercentage || 0) >= 0.913) {
          impact.isBackupGoalieElite = true;
          importance.winProbImpact *= 0.5;  // Elite backup halves impact
        }
      }
    } else {
      // Skater importance
      importance = await calculatePlayerImportance(
        playerStats || {
          playerId: injury.playerId,
          firstName: { default: injury.playerName.split(' ')[0] },
          lastName: { default: injury.playerName.split(' ').slice(1).join(' ') },
          positionCode: injury.position,
          gamesPlayed: 40,
          points: 20,  // Default assumptions for unknown players
          avgToi: 900,
        },
        teamStats,
        players
      );
      
      if (injury.position === 'C') centersOut++;
      if (injury.position === 'D') defensemenOut++;
    }
    
    // Store importance
    injuryCache.playerImportance.set(importance.playerId, importance);
    
    // Add to totals (will apply compounding later)
    impact.totalWinProbAdjustment += importance.winProbImpact;
    impact.powerPlayAdjustment += importance.ppImpact;
    impact.penaltyKillAdjustment += importance.pkImpact;
    
    // Track star players
    if (importance.tier <= 2) {
      impact.starPlayersOut.push(`${injury.playerName} (T${importance.tier})`);
    }
    
    // Linemate effects
    if (importance.tier <= 3) {
      // Find potential linemates (same team, similar TOI)
      const linemateDropRate = LINEMATE_DROP_BY_TIER[importance.tier];
      players
        .filter(p => Math.abs((p.avgToi || 0) - (playerStats?.avgToi || 0)) < 120)  // Within 2 min TOI
        .slice(0, 4)  // Top 4 similar players
        .forEach(p => {
          const name = `${p.firstName?.default || ''} ${p.lastName?.default || ''}`.trim();
          const currentMult = impact.affectedLinemates.get(name) || 1.0;
          impact.affectedLinemates.set(name, currentMult * linemateDropRate);
        });
    }
    
    // Estimate man-games lost (assume average 10 days out)
    impact.manGamesLost += 5;  // ~5 games per injury on average
  }
  
  // Line shuffling effects
  if (centersOut >= 1) {
    impact.linePromotions += centersOut * 3;  // Each center out affects 3 lines
    impact.expectedGoalsForAdjustment -= 0.15 * centersOut;
  }
  
  // Defense disruption
  if (defensemenOut >= 1) {
    impact.defenseDisruption = Math.min(defensemenOut * 0.3, 1.0);
    impact.expectedGoalsAgainstAdjustment += 0.20 * defensemenOut;
  }
  
  // Apply compounding multiplier for multiple injuries
  impact.compoundingMultiplier = calculateCompoundingMultiplier(
    impact.injuryCount,
    impact.manGamesLost
  );
  
  // Apply compounding (multiplicative, not additive)
  impact.totalWinProbAdjustment *= impact.compoundingMultiplier;
  impact.powerPlayAdjustment *= impact.compoundingMultiplier;
  impact.penaltyKillAdjustment *= impact.compoundingMultiplier;
  
  // Cap at reasonable maximums
  impact.totalWinProbAdjustment = Math.max(-0.25, impact.totalWinProbAdjustment);  // Max -25%
  impact.powerPlayAdjustment = Math.max(-0.15, impact.powerPlayAdjustment);  // Max -15%
  impact.penaltyKillAdjustment = Math.max(-0.10, impact.penaltyKillAdjustment);  // Max -10%
  
  // Build summary
  const parts: string[] = [];
  if (impact.starPlayersOut.length > 0) {
    parts.push(`Out: ${impact.starPlayersOut.join(', ')}`);
  }
  if (impact.goalieSituation === 'backup') {
    parts.push(impact.isBackupGoalieElite ? 'Elite backup in net' : 'Backup goalie');
  }
  if (impact.compoundingMultiplier > 1.1) {
    parts.push(`${impact.injuryCount} injuries compounding`);
  }
  impact.summary = parts.join(' | ') || 'Minor injuries only';
  
  return impact;
}

// ============ PUBLIC API ============

export async function refreshInjuryCache(): Promise<void> {
  console.log('🔄 Refreshing comprehensive injury cache...');
  const startTime = Date.now();
  
  const injuries = await fetchESPNInjuries();
  
  const teamImpacts = new Map<string, TeamInjuryImpact>();
  const allInjuredNames = new Set<string>();
  
  for (const [teamAbbrev, teamInjuries] of injuries) {
    const impact = await calculateTeamImpact(teamAbbrev, teamInjuries);
    teamImpacts.set(teamAbbrev, impact);
    
    for (const injury of teamInjuries) {
      if (injury.status === 'OUT' || injury.status === 'IR' || injury.status === 'LTIR') {
        allInjuredNames.add(normalizePlayerName(injury.playerName));
      }
    }
  }
  
  injuryCache = {
    ...injuryCache,
    injuries,
    teamImpacts,
    allInjuredNames,
    timestamp: Date.now(),
  };
  
  const totalInjuries = Array.from(injuries.values()).reduce((sum, arr) => sum + arr.length, 0);
  const starCount = Array.from(teamImpacts.values())
    .reduce((sum, t) => sum + t.starPlayersOut.length, 0);
  
  console.log(`✅ Injury cache: ${totalInjuries} injuries, ${starCount} stars out (${Date.now() - startTime}ms)`);
}

export async function getTeamInjuryImpact(teamAbbrev: string): Promise<TeamInjuryImpact | null> {
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) {
    await refreshInjuryCache();
  }
  return injuryCache.teamImpacts.get(teamAbbrev) || null;
}

export async function getAllInjuries(): Promise<Map<string, PlayerInjury[]>> {
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) {
    await refreshInjuryCache();
  }
  return injuryCache.injuries;
}

export async function isPlayerInjured(playerName: string): Promise<boolean> {
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) {
    await refreshInjuryCache();
  }
  return injuryCache.allInjuredNames.has(normalizePlayerName(playerName));
}

export function getInjuredPlayerNames(): Set<string> {
  return injuryCache.allInjuredNames;
}

// ============ GAME PREDICTION ADJUSTMENTS ============

export interface GamePredictionAdjustments {
  homeWinProbAdjustment: number;
  awayWinProbAdjustment: number;
  homePPAdjustment: number;
  awayPPAdjustment: number;
  homePKAdjustment: number;
  awayPKAdjustment: number;
  expectedTotalAdjustment: number;
  homeInjurySummary: string;
  awayInjurySummary: string;
  homeStarsOut: string[];
  awayStarsOut: string[];
  homeGoalieSituation: string;
  awayGoalieSituation: string;
  compoundingWarning: string;  // Warning if multiple injuries compounding
}

export async function getGamePredictionAdjustments(
  homeTeam: string,
  awayTeam: string,
  isHomeB2B: boolean = false,
  isAwayB2B: boolean = false
): Promise<GamePredictionAdjustments> {
  const homeImpact = await getTeamInjuryImpact(homeTeam);
  const awayImpact = await getTeamInjuryImpact(awayTeam);
  
  let homeAdj = homeImpact?.totalWinProbAdjustment || 0;
  let awayAdj = awayImpact?.totalWinProbAdjustment || 0;
  
  // B2B + Injuries compound MULTIPLICATIVELY (research finding)
  // B2B alone = ~5% penalty, with injuries it compounds
  if (isHomeB2B && homeImpact && homeImpact.injuryCount > 0) {
    const b2bPenalty = 0.05;
    const injuryPenalty = Math.abs(homeAdj);
    // Multiplicative: (1 - b2b) * (1 - injury) instead of additive
    homeAdj = -((1 - (1 - b2bPenalty) * (1 - injuryPenalty)) - injuryPenalty);
  }
  
  if (isAwayB2B && awayImpact && awayImpact.injuryCount > 0) {
    const b2bPenalty = 0.05;
    const injuryPenalty = Math.abs(awayAdj);
    awayAdj = -((1 - (1 - b2bPenalty) * (1 - injuryPenalty)) - injuryPenalty);
  }
  
  const adjustments: GamePredictionAdjustments = {
    homeWinProbAdjustment: homeAdj,
    awayWinProbAdjustment: awayAdj,
    homePPAdjustment: homeImpact?.powerPlayAdjustment || 0,
    awayPPAdjustment: awayImpact?.powerPlayAdjustment || 0,
    homePKAdjustment: homeImpact?.penaltyKillAdjustment || 0,
    awayPKAdjustment: awayImpact?.penaltyKillAdjustment || 0,
    expectedTotalAdjustment: 
      (homeImpact?.expectedGoalsForAdjustment || 0) +
      (awayImpact?.expectedGoalsForAdjustment || 0) +
      (homeImpact?.expectedGoalsAgainstAdjustment || 0) +
      (awayImpact?.expectedGoalsAgainstAdjustment || 0),
    homeInjurySummary: homeImpact?.summary || 'Healthy',
    awayInjurySummary: awayImpact?.summary || 'Healthy',
    homeStarsOut: homeImpact?.starPlayersOut || [],
    awayStarsOut: awayImpact?.starPlayersOut || [],
    homeGoalieSituation: homeImpact?.goalieSituation || 'unknown',
    awayGoalieSituation: awayImpact?.goalieSituation || 'unknown',
    compoundingWarning: '',
  };
  
  // Add compounding warning
  const warnings: string[] = [];
  if (homeImpact && homeImpact.compoundingMultiplier > 1.2) {
    warnings.push(`${homeTeam}: ${homeImpact.injuryCount} injuries compounding (${Math.round((homeImpact.compoundingMultiplier - 1) * 100)}% worse)`);
  }
  if (awayImpact && awayImpact.compoundingMultiplier > 1.2) {
    warnings.push(`${awayTeam}: ${awayImpact.injuryCount} injuries compounding`);
  }
  adjustments.compoundingWarning = warnings.join(' | ');
  
  return adjustments;
}

// ============ PLAYER PROPS ADJUSTMENTS ============

export interface PlayerPropsAdjustment {
  productionMultiplier: number;
  rustPenalty: number;
  isInjured: boolean;
  reason: string;
}

export async function getPlayerPropsAdjustment(
  playerName: string,
  teamAbbrev: string
): Promise<PlayerPropsAdjustment> {
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) {
    await refreshInjuryCache();
  }
  
  const normalizedName = normalizePlayerName(playerName);
  
  // Check if player is injured
  if (injuryCache.allInjuredNames.has(normalizedName)) {
    return {
      productionMultiplier: 0,
      rustPenalty: 0,
      isInjured: true,
      reason: 'Player is OUT',
    };
  }
  
  let multiplier = 1.0;
  let rustPenalty = 0;
  const reasons: string[] = [];
  
  // Check for rust (returning from injury)
  const returning = injuryCache.returningPlayers.get(normalizedName);
  if (returning && returning.gamesSinceReturn <= 5) {
    rustPenalty = RUST_PENALTY[returning.gamesSinceReturn] || 0;
    reasons.push(`Rust factor game ${returning.gamesSinceReturn} (-${Math.round(rustPenalty * 100)}%)`);
  }
  
  // Check for linemate effects
  const impact = injuryCache.teamImpacts.get(teamAbbrev);
  if (impact) {
    const linemateMultiplier = impact.affectedLinemates.get(playerName);
    if (linemateMultiplier && linemateMultiplier < 1.0) {
      multiplier *= linemateMultiplier;
      const dropPct = Math.round((1 - linemateMultiplier) * 100);
      reasons.push(`Linemate injured (-${dropPct}%)`);
    }
    
    // Line promotion penalty
    if (impact.linePromotions > 0) {
      multiplier *= LINE_PROMOTION_PENALTY;
      reasons.push('Line shuffling (-15%)');
    }
  }
  
  // Apply rust penalty to multiplier
  multiplier *= (1 - rustPenalty);
  
  return {
    productionMultiplier: multiplier,
    rustPenalty,
    isInjured: false,
    reason: reasons.join(', ') || '',
  };
}

// ============ TRACK RETURNING PLAYERS ============

export function trackReturningPlayer(playerName: string, team: string): void {
  const normalized = normalizePlayerName(playerName);
  
  const existing = injuryCache.returningPlayers.get(normalized);
  if (existing) {
    existing.gamesSinceReturn++;
    if (existing.gamesSinceReturn > 5) {
      // No more rust, remove tracking
      injuryCache.returningPlayers.delete(normalized);
    }
  } else {
    // New return
    injuryCache.returningPlayers.set(normalized, {
      playerName,
      team,
      gamesSinceReturn: 1,
      rustPenalty: RUST_PENALTY[1],
    });
  }
}

// ============ CACHE STATUS ============

export function getCacheStatus(): {
  lastUpdate: string;
  teamsWithInjuries: number;
  totalInjuries: number;
  starPlayersOut: string[];
  playersReturning: string[];
} {
  const totalInjuries = Array.from(injuryCache.injuries.values())
    .reduce((sum, arr) => sum + arr.length, 0);
  
  const starPlayersOut: string[] = [];
  for (const impact of injuryCache.teamImpacts.values()) {
    starPlayersOut.push(...impact.starPlayersOut);
  }
  
  const playersReturning = Array.from(injuryCache.returningPlayers.values())
    .map(p => `${p.playerName} (game ${p.gamesSinceReturn})`);
  
  return {
    lastUpdate: new Date(injuryCache.timestamp).toISOString(),
    teamsWithInjuries: injuryCache.injuries.size,
    totalInjuries,
    starPlayersOut,
    playersReturning,
  };
}
