/**
 * NHL Injury Service
 * Fetches injury data and calculates impact on predictions
 * 
 * Research-backed adjustments:
 * - Elite players worth 5-7% win probability per game max
 * - Starting goalies have highest variance (15-20 GAR)
 * - PP1 players have outsized impact when injured
 * - Linemates typically see DECREASED production when star is out
 * - Depth players may see opportunity boost
 * - Back-to-back games compound injury impact
 * - Road games amplify injury impact by ~1.3x
 */

// Player value tiers based on GAR research
export type PlayerTier = 'elite' | 'star' | 'quality' | 'depth' | 'replacement';

export interface InjuredPlayer {
  playerId?: number;
  name: string;
  team: string;
  teamAbbrev: string;
  position: string;
  injuryType: string; // "Upper Body", "Lower Body", etc.
  status: string; // "IR", "Day-to-Day", "Out", "LTIR"
  expectedReturn?: string;
  lastUpdated: string;
}

export interface PlayerValue {
  tier: PlayerTier;
  estimatedGAR: number;
  winProbabilityImpact: number; // Per game impact on win %
  isPP1: boolean;
  isTopLine: boolean;
  isStartingGoalie: boolean;
}

export interface TeamInjuryImpact {
  teamAbbrev: string;
  totalWinProbabilityLoss: number;
  injuredPlayers: InjuredPlayer[];
  hasClusterInjury: boolean; // Multiple key players out
  ppImpact: number; // Power play degradation
  depthRating: number; // 0-1, how well team handles injuries
}

// Known elite players and their approximate GAR values
// This would ideally come from an API but we'll use known data
const ELITE_PLAYERS: Record<string, { gar: number; pp1: boolean; line: number }> = {
  // Forwards - Elite Tier (25+ GAR)
  'Connor McDavid': { gar: 33, pp1: true, line: 1 },
  'Nathan MacKinnon': { gar: 30, pp1: true, line: 1 },
  'Auston Matthews': { gar: 28, pp1: true, line: 1 },
  'Leon Draisaitl': { gar: 27, pp1: true, line: 1 },
  'Nikita Kucherov': { gar: 26, pp1: true, line: 1 },
  'David Pastrnak': { gar: 25, pp1: true, line: 1 },
  'Mikko Rantanen': { gar: 24, pp1: true, line: 1 },
  'Kirill Kaprizov': { gar: 24, pp1: true, line: 1 },
  
  // Forwards - Star Tier (15-24 GAR)
  'Matthew Tkachuk': { gar: 22, pp1: true, line: 1 },
  'Jack Eichel': { gar: 21, pp1: true, line: 1 },
  'Mitch Marner': { gar: 21, pp1: true, line: 1 },
  'Sidney Crosby': { gar: 20, pp1: true, line: 1 },
  'Aleksander Barkov': { gar: 20, pp1: true, line: 1 },
  'Sam Reinhart': { gar: 19, pp1: true, line: 1 },
  'Jake Guentzel': { gar: 18, pp1: true, line: 1 },
  'Brady Tkachuk': { gar: 18, pp1: true, line: 1 },
  'Brayden Point': { gar: 18, pp1: true, line: 1 },
  'Tage Thompson': { gar: 17, pp1: true, line: 1 },
  'Elias Pettersson': { gar: 17, pp1: true, line: 1 },
  'Sebastian Aho': { gar: 17, pp1: true, line: 1 },
  'Roope Hintz': { gar: 16, pp1: true, line: 1 },
  'Jack Hughes': { gar: 16, pp1: true, line: 1 },
  'Tim Stutzle': { gar: 16, pp1: true, line: 1 },
  'Jason Robertson': { gar: 16, pp1: true, line: 1 },
  'J.T. Miller': { gar: 15, pp1: true, line: 1 },
  'Zach Hyman': { gar: 15, pp1: true, line: 1 },
  'William Nylander': { gar: 15, pp1: true, line: 1 },
  'Brandon Hagel': { gar: 14, pp1: true, line: 1 },
  'Tyson Foerster': { gar: 10, pp1: false, line: 2 },
  
  // Defensemen - Elite Tier
  'Cale Makar': { gar: 28, pp1: true, line: 1 },
  'Quinn Hughes': { gar: 22, pp1: true, line: 1 },
  'Adam Fox': { gar: 20, pp1: true, line: 1 },
  'Roman Josi': { gar: 18, pp1: true, line: 1 },
  'Rasmus Dahlin': { gar: 17, pp1: true, line: 1 },
  'Evan Bouchard': { gar: 16, pp1: true, line: 1 },
  'Zach Werenski': { gar: 16, pp1: true, line: 1 },
  'Miro Heiskanen': { gar: 15, pp1: true, line: 1 },
  'Victor Hedman': { gar: 15, pp1: true, line: 1 },
  'Devon Toews': { gar: 14, pp1: true, line: 1 },
  
  // Goalies - Elite Tier (using GSAx equivalent)
  'Connor Hellebuyck': { gar: 25, pp1: false, line: 0 },
  'Igor Shesterkin': { gar: 24, pp1: false, line: 0 },
  'Andrei Vasilevskiy': { gar: 20, pp1: false, line: 0 },
  'Jeremy Swayman': { gar: 18, pp1: false, line: 0 },
  'Jake Oettinger': { gar: 17, pp1: false, line: 0 },
  'Ilya Sorokin': { gar: 17, pp1: false, line: 0 },
  'Juuse Saros': { gar: 16, pp1: false, line: 0 },
  'Sergei Bobrovsky': { gar: 15, pp1: false, line: 0 },
  'Thatcher Demko': { gar: 15, pp1: false, line: 0 },
  'Stuart Skinner': { gar: 12, pp1: false, line: 0 },
};

// Team depth ratings (0-1, how well they handle injuries)
const TEAM_DEPTH_RATINGS: Record<string, number> = {
  'VGK': 0.85, // Vegas has excellent depth
  'FLA': 0.80,
  'COL': 0.75,
  'DAL': 0.75,
  'NYR': 0.70,
  'TBL': 0.70,
  'BOS': 0.70,
  'TOR': 0.65,
  'EDM': 0.50, // Very top-heavy
  'CAR': 0.75,
  'NJD': 0.65,
  'WPG': 0.70,
  'VAN': 0.65,
  'LAK': 0.70,
  'MIN': 0.70,
  'NSH': 0.65,
  'STL': 0.65,
  'DET': 0.60,
  'OTT': 0.60,
  'PHI': 0.55,
  'BUF': 0.55,
  'SEA': 0.65,
  'CGY': 0.60,
  'NYI': 0.60,
  'PIT': 0.55,
  'WSH': 0.60,
  'ANA': 0.50,
  'CBJ': 0.50,
  'MTL': 0.50,
  'CHI': 0.45,
  'SJS': 0.40,
  'UTA': 0.55,
};

/**
 * Calculate player value/tier based on available data
 */
export function calculatePlayerValue(
  playerName: string,
  goalsPerGame: number,
  pointsPerGame: number,
  ppTimePerGame: number,
  position: string
): PlayerValue {
  // Check if player is in our elite database
  const knownPlayer = ELITE_PLAYERS[playerName];
  
  if (knownPlayer) {
    const winImpact = (knownPlayer.gar / 82) / 5.4; // GAR per game / goals per win
    return {
      tier: knownPlayer.gar >= 25 ? 'elite' : knownPlayer.gar >= 15 ? 'star' : 'quality',
      estimatedGAR: knownPlayer.gar,
      winProbabilityImpact: Math.min(winImpact, 0.07), // Cap at 7%
      isPP1: knownPlayer.pp1,
      isTopLine: knownPlayer.line === 1,
      isStartingGoalie: position === 'G' && knownPlayer.gar >= 15,
    };
  }
  
  // Estimate GAR based on stats for unknown players
  let estimatedGAR = 0;
  
  if (position === 'G') {
    // Goalies - estimate based on typical starter GAR
    estimatedGAR = 10; // Assume average starter
  } else if (position === 'D') {
    // Defensemen
    if (pointsPerGame >= 0.8) estimatedGAR = 18;
    else if (pointsPerGame >= 0.5) estimatedGAR = 12;
    else if (pointsPerGame >= 0.3) estimatedGAR = 6;
    else estimatedGAR = 2;
  } else {
    // Forwards
    if (goalsPerGame >= 0.5) estimatedGAR = 22;
    else if (goalsPerGame >= 0.35) estimatedGAR = 16;
    else if (goalsPerGame >= 0.25) estimatedGAR = 10;
    else if (goalsPerGame >= 0.15) estimatedGAR = 5;
    else estimatedGAR = 1;
  }
  
  const winImpact = (estimatedGAR / 82) / 5.4;
  const isPP1 = ppTimePerGame >= 180; // 3+ minutes PP time = PP1
  
  let tier: PlayerTier;
  if (estimatedGAR >= 25) tier = 'elite';
  else if (estimatedGAR >= 15) tier = 'star';
  else if (estimatedGAR >= 5) tier = 'quality';
  else if (estimatedGAR >= 1) tier = 'depth';
  else tier = 'replacement';
  
  return {
    tier,
    estimatedGAR,
    winProbabilityImpact: Math.min(winImpact, 0.07),
    isPP1,
    isTopLine: goalsPerGame >= 0.25 || pointsPerGame >= 0.6,
    isStartingGoalie: position === 'G' && estimatedGAR >= 12,
  };
}

/**
 * Fetch current injuries from NHL API or scrape from Daily Faceoff
 * For now, we'll use the NHL API's roster endpoint to detect missing players
 */
export async function fetchTeamInjuries(teamAbbrev: string): Promise<InjuredPlayer[]> {
  try {
    // Try to fetch from NHL's injury report page
    const response = await fetch(
      `https://api-web.nhle.com/v1/roster/${teamAbbrev}/current`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'HockeyEdge/1.0',
        },
      }
    );
    
    if (!response.ok) {
      console.error(`Failed to fetch roster for ${teamAbbrev}`);
      return [];
    }
    
    const data = await response.json();
    
    // The NHL API doesn't have a direct injury endpoint
    // We'll need to cross-reference with game day rosters
    // For now, return empty and we'll use Daily Faceoff data
    return [];
    
  } catch (error) {
    console.error(`Error fetching injuries for ${teamAbbrev}:`, error);
    return [];
  }
}

/**
 * Scrape injuries from Daily Faceoff (most reliable free source)
 */
export async function fetchDailyFaceoffInjuries(): Promise<InjuredPlayer[]> {
  const injuries: InjuredPlayer[] = [];
  
  try {
    const response = await fetch('https://www.dailyfaceoff.com/teams/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    
    if (!response.ok) {
      console.warn('Could not fetch Daily Faceoff, status:', response.status);
      return injuries;
    }
    
    // For now, we'll use the NHL API as primary source
    // Daily Faceoff requires more complex HTML parsing
    return injuries;
    
  } catch (error) {
    console.error('Error fetching Daily Faceoff:', error);
    return injuries;
  }
}

/**
 * Fetch injuries from NHL API by checking roster status
 * Players on roster but with "injured" status or missing from recent games
 */
export async function fetchNHLInjuries(teamAbbrev: string): Promise<InjuredPlayer[]> {
  const injuries: InjuredPlayer[] = [];
  
  try {
    // Get team's roster with injury status
    const rosterResponse = await fetch(
      `https://api-web.nhle.com/v1/roster/${teamAbbrev}/current`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'HockeyEdge/1.0',
        },
      }
    );
    
    if (!rosterResponse.ok) return injuries;
    
    const roster = await rosterResponse.json();
    
    // Get club stats to see who's actually playing
    const statsResponse = await fetch(
      `https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'HockeyEdge/1.0',
        },
      }
    );
    
    if (!statsResponse.ok) return injuries;
    
    const stats = await statsResponse.json();
    
    // Get player IDs who have stats (are playing)
    const activePlayerIds = new Set<number>();
    (stats.skaters || []).forEach((s: any) => activePlayerIds.add(s.playerId));
    (stats.goalies || []).forEach((g: any) => activePlayerIds.add(g.playerId));
    
    // Check each roster player
    const allRosterPlayers = [
      ...(roster.forwards || []),
      ...(roster.defensemen || []),
      ...(roster.goalies || []),
    ];
    
    for (const player of allRosterPlayers) {
      const playerId = player.id;
      const firstName = player.firstName?.default || player.firstName || '';
      const lastName = player.lastName?.default || player.lastName || '';
      const name = `${firstName} ${lastName}`.trim();
      
      // Check if player is known elite but not in active stats
      const isKnownPlayer = ELITE_PLAYERS[name];
      const hasNoStats = !activePlayerIds.has(playerId);
      
      // If elite/star player has no stats, likely injured
      if (isKnownPlayer && hasNoStats && isKnownPlayer.gar >= 10) {
        injuries.push({
          playerId,
          name,
          team: teamAbbrev,
          teamAbbrev,
          position: player.positionCode || 'F',
          injuryType: 'Unknown',
          status: 'Out',
          lastUpdated: new Date().toISOString().split('T')[0],
        });
      }
    }
    
    return injuries;
    
  } catch (error) {
    console.error(`Error fetching NHL injuries for ${teamAbbrev}:`, error);
    return injuries;
  }
}

/**
 * Cross-reference multiple sources to build comprehensive injury list
 */
export async function fetchAllInjuriesAutomatic(teamAbbrevs: string[]): Promise<Map<string, InjuredPlayer[]>> {
  const injuriesByTeam = new Map<string, InjuredPlayer[]>();
  
  // Start with known injuries (manually curated, most reliable)
  const knownInjuries = getKnownInjuries();
  knownInjuries.forEach((injuries, team) => {
    injuriesByTeam.set(team, [...injuries]);
  });
  
  // Fetch from NHL API for each team
  const nhlPromises = teamAbbrevs.map(async (abbrev) => {
    const nhlInjuries = await fetchNHLInjuries(abbrev);
    return { abbrev, injuries: nhlInjuries };
  });
  
  const nhlResults = await Promise.all(nhlPromises);
  
  // Merge NHL API results with known injuries (avoid duplicates)
  nhlResults.forEach(({ abbrev, injuries }) => {
    const existing = injuriesByTeam.get(abbrev) || [];
    const existingNames = new Set(existing.map(i => i.name.toLowerCase()));
    
    injuries.forEach(injury => {
      if (!existingNames.has(injury.name.toLowerCase())) {
        existing.push(injury);
      }
    });
    
    injuriesByTeam.set(abbrev, existing);
  });
  
  return injuriesByTeam;
}

/**
 * Known current injuries (manually updated as backup)
 * This ensures we catch injuries even if APIs fail
 */
export function getKnownInjuries(): Map<string, InjuredPlayer[]> {
  const injuries = new Map<string, InjuredPlayer[]>();
  
  // Current injuries - UPDATE THIS LIST REGULARLY
  const currentInjuries: InjuredPlayer[] = [
    // Tampa Bay
    { name: 'Brandon Hagel', team: 'Tampa Bay Lightning', teamAbbrev: 'TBL', position: 'LW', injuryType: 'Lower Body', status: 'IR', lastUpdated: '2024-12-20' },
    
    // Philadelphia  
    { name: 'Tyson Foerster', team: 'Philadelphia Flyers', teamAbbrev: 'PHI', position: 'RW', injuryType: 'Upper Body', status: 'Day-to-Day', lastUpdated: '2024-12-20' },
    
    // Edmonton
    { name: 'Evander Kane', team: 'Edmonton Oilers', teamAbbrev: 'EDM', position: 'LW', injuryType: 'Hernia', status: 'LTIR', lastUpdated: '2024-12-01' },
    
    // Colorado
    { name: 'Gabriel Landeskog', team: 'Colorado Avalanche', teamAbbrev: 'COL', position: 'LW', injuryType: 'Knee', status: 'LTIR', lastUpdated: '2024-10-01' },
    
    // Vancouver
    { name: 'Thatcher Demko', team: 'Vancouver Canucks', teamAbbrev: 'VAN', position: 'G', injuryType: 'Lower Body', status: 'IR', lastUpdated: '2024-12-15' },
    
    // Toronto
    { name: 'Calle Jarnkrok', team: 'Toronto Maple Leafs', teamAbbrev: 'TOR', position: 'C', injuryType: 'Lower Body', status: 'LTIR', lastUpdated: '2024-10-01' },
    
    // NY Rangers
    { name: 'Adam Fox', team: 'New York Rangers', teamAbbrev: 'NYR', position: 'D', injuryType: 'Upper Body', status: 'Day-to-Day', lastUpdated: '2024-12-20' },
  ];
  
  // Group by team
  currentInjuries.forEach(injury => {
    const teamInjuries = injuries.get(injury.teamAbbrev) || [];
    teamInjuries.push(injury);
    injuries.set(injury.teamAbbrev, teamInjuries);
  });
  
  return injuries;
}

/**
 * Calculate total injury impact on a team
 */
export function calculateTeamInjuryImpact(
  teamAbbrev: string,
  injuredPlayers: InjuredPlayer[]
): TeamInjuryImpact {
  let totalWinProbabilityLoss = 0;
  let ppImpact = 0;
  let starCount = 0;
  
  injuredPlayers.forEach(player => {
    const knownPlayer = ELITE_PLAYERS[player.name];
    
    if (knownPlayer) {
      const winImpact = (knownPlayer.gar / 82) / 5.4;
      totalWinProbabilityLoss += Math.min(winImpact, 0.07);
      
      if (knownPlayer.pp1) {
        ppImpact += 0.15; // PP1 player out reduces PP efficiency by ~15%
      }
      
      if (knownPlayer.gar >= 15) {
        starCount++;
      }
    } else {
      // Unknown player - assume depth level impact
      totalWinProbabilityLoss += 0.005;
    }
  });
  
  // Cap total impact at 15% (even multiple injuries don't doom a team)
  totalWinProbabilityLoss = Math.min(totalWinProbabilityLoss, 0.15);
  
  // Cluster injury flag - multiple stars out
  const hasClusterInjury = starCount >= 2;
  if (hasClusterInjury) {
    // Cluster injuries have multiplicative effect
    totalWinProbabilityLoss *= 1.3;
  }
  
  // Apply team depth rating
  const depthRating = TEAM_DEPTH_RATINGS[teamAbbrev] || 0.60;
  // Good depth teams absorb injuries better
  totalWinProbabilityLoss *= (1.5 - depthRating);
  
  return {
    teamAbbrev,
    totalWinProbabilityLoss: Math.min(totalWinProbabilityLoss, 0.20),
    injuredPlayers,
    hasClusterInjury,
    ppImpact: Math.min(ppImpact, 0.30),
    depthRating,
  };
}

/**
 * Check if a player is currently injured
 */
export function isPlayerInjured(
  playerName: string,
  teamAbbrev: string,
  knownInjuries: Map<string, InjuredPlayer[]>
): boolean {
  const teamInjuries = knownInjuries.get(teamAbbrev) || [];
  return teamInjuries.some(injury => 
    injury.name.toLowerCase() === playerName.toLowerCase() ||
    playerName.toLowerCase().includes(injury.name.split(' ')[1]?.toLowerCase() || '')
  );
}

/**
 * Get adjustment factor for a player based on teammate injuries
 * Research shows linemates of injured stars see DECREASED production
 */
export function getTeammateAdjustment(
  playerName: string,
  teamAbbrev: string,
  knownInjuries: Map<string, InjuredPlayer[]>
): number {
  const teamInjuries = knownInjuries.get(teamAbbrev) || [];
  let adjustment = 1.0;
  
  teamInjuries.forEach(injury => {
    const injuredPlayer = ELITE_PLAYERS[injury.name];
    
    if (injuredPlayer && injuredPlayer.gar >= 20) {
      // Star is out - linemates typically see 5-15% decrease
      // But depth players may see opportunity boost
      const currentPlayer = ELITE_PLAYERS[playerName];
      
      if (currentPlayer) {
        // If current player is also a star, they take over duties
        if (currentPlayer.gar >= 15) {
          adjustment *= 1.05; // Slight boost from more ice time/PP time
        } else {
          adjustment *= 0.90; // 10% decrease without star linemate
        }
      } else {
        // Unknown player might get opportunity boost
        adjustment *= 1.10; // 10% boost from more minutes
      }
    } else if (injuredPlayer && injuredPlayer.pp1) {
      // PP1 player out - affects PP production for everyone
      adjustment *= 0.95;
    }
  });
  
  return adjustment;
}

/**
 * Apply situational modifiers based on research
 */
export function applySituationalModifiers(
  baseAdjustment: number,
  isHome: boolean,
  isBackToBack: boolean
): number {
  let modifier = baseAdjustment;
  
  // Road games amplify injury impact by ~30%
  if (!isHome) {
    // If team is weakened by injuries, road disadvantage compounds it
    if (baseAdjustment < 1.0) {
      modifier *= 0.95; // Additional 5% penalty on road
    }
  }
  
  // Back-to-back games compound injury impact
  if (isBackToBack) {
    // Already tired + missing players = bigger impact
    if (baseAdjustment < 1.0) {
      modifier *= 0.93; // Additional 7% penalty on B2B
    }
  }
  
  return modifier;
}

/**
 * Main function to get all injury adjustments for predictions
 * Now auto-fetches from multiple sources
 */
export interface InjuryAdjustments {
  injuries: Map<string, InjuredPlayer[]>;
  teamImpacts: Map<string, TeamInjuryImpact>;
  isPlayerOut: (name: string, team: string) => boolean;
  getPlayerAdjustment: (name: string, team: string, isHome: boolean, isB2B: boolean) => number;
}

export async function getInjuryAdjustmentsAsync(teamAbbrevs: string[]): Promise<InjuryAdjustments> {
  // Fetch injuries from all sources
  const injuries = await fetchAllInjuriesAutomatic(teamAbbrevs);
  const teamImpacts = new Map<string, TeamInjuryImpact>();
  
  // Calculate impact for each team with injuries
  injuries.forEach((teamInjuries, teamAbbrev) => {
    const impact = calculateTeamInjuryImpact(teamAbbrev, teamInjuries);
    teamImpacts.set(teamAbbrev, impact);
  });
  
  console.log(`Loaded injuries for ${injuries.size} teams:`, 
    Array.from(injuries.entries()).map(([team, inj]) => `${team}: ${inj.map(i => i.name).join(', ')}`).join(' | ')
  );
  
  return {
    injuries,
    teamImpacts,
    isPlayerOut: (name: string, team: string) => isPlayerInjured(name, team, injuries),
    getPlayerAdjustment: (name: string, team: string, isHome: boolean, isB2B: boolean) => {
      const baseAdjustment = getTeammateAdjustment(name, team, injuries);
      return applySituationalModifiers(baseAdjustment, isHome, isB2B);
    },
  };
}

// Synchronous version using only known injuries (for backward compatibility)
export function getInjuryAdjustments(): InjuryAdjustments {
  const injuries = getKnownInjuries();
  const teamImpacts = new Map<string, TeamInjuryImpact>();
  
  injuries.forEach((teamInjuries, teamAbbrev) => {
    const impact = calculateTeamInjuryImpact(teamAbbrev, teamInjuries);
    teamImpacts.set(teamAbbrev, impact);
  });
  
  return {
    injuries,
    teamImpacts,
    isPlayerOut: (name: string, team: string) => isPlayerInjured(name, team, injuries),
    getPlayerAdjustment: (name: string, team: string, isHome: boolean, isB2B: boolean) => {
      const baseAdjustment = getTeammateAdjustment(name, team, injuries);
      return applySituationalModifiers(baseAdjustment, isHome, isB2B);
    },
  };
}
