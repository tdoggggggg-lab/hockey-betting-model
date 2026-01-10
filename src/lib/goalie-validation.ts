/**
 * 3-Source Goalie Validation Service
 * 
 * Sources:
 * 1. Daily Faceoff - Projected/Confirmed starters (scrape)
 * 2. LeftWingLock - Confirmed starters with 99.9% accuracy (scrape)
 * 3. NHL API - Historical data validation
 * 
 * Rule: 2 of 3 sources must agree to confirm a starter
 */

export interface GoalieInfo {
  name: string;
  team: string;
  teamAbbrev: string;
  savePercentage: number;
  goalsAgainstAvg: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
}

export interface StartingGoalie {
  goalie: GoalieInfo;
  confidence: 'confirmed' | 'likely' | 'projected';
  sources: {
    dailyFaceoff: boolean;
    leftWingLock: boolean;
    nhlApi: boolean;
  };
  agreement: number; // 0-3 sources agree
}

export interface GoalieValidationResult {
  homeStarter: StartingGoalie | null;
  awayStarter: StartingGoalie | null;
  lastUpdated: string;
  validationDetails: {
    homeTeam: string;
    awayTeam: string;
    sourcesChecked: string[];
  };
}

// Team name mappings for scraping
const TEAM_SLUG_MAP: Record<string, string> = {
  'ANA': 'anaheim-ducks',
  'ARI': 'arizona-coyotes',
  'BOS': 'boston-bruins',
  'BUF': 'buffalo-sabres',
  'CGY': 'calgary-flames',
  'CAR': 'carolina-hurricanes',
  'CHI': 'chicago-blackhawks',
  'COL': 'colorado-avalanche',
  'CBJ': 'columbus-blue-jackets',
  'DAL': 'dallas-stars',
  'DET': 'detroit-red-wings',
  'EDM': 'edmonton-oilers',
  'FLA': 'florida-panthers',
  'LAK': 'los-angeles-kings',
  'MIN': 'minnesota-wild',
  'MTL': 'montreal-canadiens',
  'NSH': 'nashville-predators',
  'NJD': 'new-jersey-devils',
  'NYI': 'new-york-islanders',
  'NYR': 'new-york-rangers',
  'OTT': 'ottawa-senators',
  'PHI': 'philadelphia-flyers',
  'PIT': 'pittsburgh-penguins',
  'SJS': 'san-jose-sharks',
  'SEA': 'seattle-kraken',
  'STL': 'st-louis-blues',
  'TBL': 'tampa-bay-lightning',
  'TOR': 'toronto-maple-leafs',
  'UTA': 'utah-hockey-club',
  'VAN': 'vancouver-canucks',
  'VGK': 'vegas-golden-knights',
  'WSH': 'washington-capitals',
  'WPG': 'winnipeg-jets',
};

// Cache for goalie data
let goalieCache: {
  dailyFaceoff: Map<string, string>; // teamAbbrev -> goalie name
  leftWingLock: Map<string, string>;
  nhlApiStarters: Map<string, GoalieInfo>;
  lastFetched: number;
} = {
  dailyFaceoff: new Map(),
  leftWingLock: new Map(),
  nhlApiStarters: new Map(),
  lastFetched: 0,
};

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch starting goalies from Daily Faceoff
 * URL: https://www.dailyfaceoff.com/starting-goalies/
 */
async function fetchDailyFaceoffStarters(): Promise<Map<string, string>> {
  const starters = new Map<string, string>();
  
  try {
    console.log('🔍 Fetching Daily Faceoff starting goalies...');
    
    const response = await fetch('https://www.dailyfaceoff.com/starting-goalies/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    
    if (!response.ok) {
      console.log('⚠️ Daily Faceoff returned non-OK status:', response.status);
      return starters;
    }
    
    const html = await response.text();
    
    // Parse goalie names from the HTML
    // Daily Faceoff uses specific class names for starter info
    // Pattern: team abbrev followed by goalie name
    
    // Look for patterns like: <span class="team-name">BOS</span>...<span class="goalie-name">Jeremy Swayman</span>
    const teamPattern = /<div[^>]*class="[^"]*goalie[^"]*"[^>]*>[\s\S]*?<span[^>]*>([A-Z]{3})<\/span>[\s\S]*?<a[^>]*>([^<]+)<\/a>/gi;
    
    let match;
    while ((match = teamPattern.exec(html)) !== null) {
      const teamAbbrev = match[1].toUpperCase();
      const goalieName = match[2].trim();
      if (teamAbbrev && goalieName && goalieName.length > 2) {
        starters.set(teamAbbrev, goalieName);
        console.log(`  DF: ${teamAbbrev} -> ${goalieName}`);
      }
    }
    
    // Alternative pattern for different HTML structure
    if (starters.size === 0) {
      const altPattern = /data-team="([A-Z]{3})"[^>]*>[\s\S]*?<span[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/gi;
      while ((match = altPattern.exec(html)) !== null) {
        const teamAbbrev = match[1].toUpperCase();
        const goalieName = match[2].trim();
        if (teamAbbrev && goalieName) {
          starters.set(teamAbbrev, goalieName);
        }
      }
    }
    
    console.log(`✅ Daily Faceoff: Found ${starters.size} starting goalies`);
    
  } catch (error) {
    console.error('❌ Error fetching Daily Faceoff:', error);
  }
  
  return starters;
}

/**
 * Fetch starting goalies from LeftWingLock
 * URL: https://leftwinglock.com/starting-goalies/
 */
async function fetchLeftWingLockStarters(): Promise<Map<string, string>> {
  const starters = new Map<string, string>();
  
  try {
    console.log('🔍 Fetching LeftWingLock starting goalies...');
    
    const response = await fetch('https://leftwinglock.com/starting-goalies/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    
    if (!response.ok) {
      console.log('⚠️ LeftWingLock returned non-OK status:', response.status);
      return starters;
    }
    
    const html = await response.text();
    
    // LeftWingLock has confirmed (green), likely (yellow), projected (red) indicators
    // We want confirmed or likely starters
    
    // Pattern: team row with goalie name
    const rowPattern = /<tr[^>]*>[\s\S]*?<td[^>]*>([A-Z]{3})<\/td>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?<td[^>]*class="[^"]*(?:confirmed|likely)[^"]*"[^>]*>/gi;
    
    let match;
    while ((match = rowPattern.exec(html)) !== null) {
      const teamAbbrev = match[1].toUpperCase();
      const goalieName = match[2].trim();
      if (teamAbbrev && goalieName && goalieName.length > 2) {
        starters.set(teamAbbrev, goalieName);
        console.log(`  LWL: ${teamAbbrev} -> ${goalieName}`);
      }
    }
    
    // Alternative simpler pattern
    if (starters.size === 0) {
      const simplePattern = /([A-Z]{3})[\s\S]*?<a[^>]*href="[^"]*goalie[^"]*"[^>]*>([^<]+)<\/a>/gi;
      while ((match = simplePattern.exec(html)) !== null) {
        const teamAbbrev = match[1].toUpperCase();
        const goalieName = match[2].trim();
        if (teamAbbrev && goalieName) {
          starters.set(teamAbbrev, goalieName);
        }
      }
    }
    
    console.log(`✅ LeftWingLock: Found ${starters.size} starting goalies`);
    
  } catch (error) {
    console.error('❌ Error fetching LeftWingLock:', error);
  }
  
  return starters;
}

/**
 * Get goalie stats from NHL API for a team
 */
async function fetchNHLGoalieStats(teamAbbrev: string): Promise<GoalieInfo[]> {
  const goalies: GoalieInfo[] = [];
  
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`);
    if (!response.ok) return goalies;
    
    const data = await response.json();
    const goalieStats = data.goalies || [];
    
    for (const g of goalieStats) {
      const name = `${g.firstName?.default || ''} ${g.lastName?.default || ''}`.trim();
      if (!name) continue;
      
      goalies.push({
        name,
        team: teamAbbrev,
        teamAbbrev,
        savePercentage: g.savePctg || 0,
        goalsAgainstAvg: g.goalsAgainstAverage || 0,
        gamesPlayed: g.gamesPlayed || 0,
        wins: g.wins || 0,
        losses: g.losses || 0,
      });
    }
    
    // Sort by games played (most games = likely starter)
    goalies.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
    
  } catch (error) {
    console.error(`Error fetching NHL goalie stats for ${teamAbbrev}:`, error);
  }
  
  return goalies;
}

/**
 * Determine probable starter based on NHL API data (games played, recent starts)
 */
function getProbableStarterFromNHL(goalies: GoalieInfo[], isBackToBack: boolean): GoalieInfo | null {
  if (goalies.length === 0) return null;
  if (goalies.length === 1) return goalies[0];
  
  const [starter, backup] = goalies;
  
  // On back-to-back, 85-95% chance backup starts
  if (isBackToBack && backup) {
    // If backup has played at least 10 games, they're likely to start
    if (backup.gamesPlayed >= 10) {
      return backup;
    }
  }
  
  // Otherwise return the starter (most games played)
  return starter;
}

/**
 * Normalize goalie names for comparison
 */
function normalizeGoalieName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z\s]/g, '')
    .trim();
}

/**
 * Check if two goalie names match
 */
function goalieNamesMatch(name1: string, name2: string): boolean {
  const n1 = normalizeGoalieName(name1);
  const n2 = normalizeGoalieName(name2);
  
  // Exact match
  if (n1 === n2) return true;
  
  // Last name match
  const lastName1 = n1.split(' ').pop() || '';
  const lastName2 = n2.split(' ').pop() || '';
  if (lastName1 && lastName2 && lastName1 === lastName2) return true;
  
  // Contains check
  if (n1.includes(n2) || n2.includes(n1)) return true;
  
  return false;
}

/**
 * Validate starting goalie using 3-source agreement
 */
async function validateStartingGoalie(
  teamAbbrev: string,
  isBackToBack: boolean = false
): Promise<StartingGoalie | null> {
  // Ensure cache is fresh
  await refreshCacheIfNeeded();
  
  const dfGoalie = goalieCache.dailyFaceoff.get(teamAbbrev);
  const lwlGoalie = goalieCache.leftWingLock.get(teamAbbrev);
  
  // Get NHL API goalies
  const nhlGoalies = await fetchNHLGoalieStats(teamAbbrev);
  const nhlProbableStarter = getProbableStarterFromNHL(nhlGoalies, isBackToBack);
  
  if (!dfGoalie && !lwlGoalie && !nhlProbableStarter) {
    console.log(`⚠️ No goalie data found for ${teamAbbrev}`);
    return null;
  }
  
  // Count agreements
  let agreementCount = 0;
  let agreedGoalieName = '';
  
  const sources = {
    dailyFaceoff: false,
    leftWingLock: false,
    nhlApi: false,
  };
  
  // Check Daily Faceoff vs LeftWingLock
  if (dfGoalie && lwlGoalie && goalieNamesMatch(dfGoalie, lwlGoalie)) {
    agreementCount = 2;
    agreedGoalieName = dfGoalie;
    sources.dailyFaceoff = true;
    sources.leftWingLock = true;
  }
  
  // Check NHL API agreement
  if (nhlProbableStarter) {
    if (dfGoalie && goalieNamesMatch(dfGoalie, nhlProbableStarter.name)) {
      if (!agreedGoalieName) agreedGoalieName = dfGoalie;
      sources.dailyFaceoff = true;
      sources.nhlApi = true;
      agreementCount = Math.max(agreementCount, sources.dailyFaceoff && sources.leftWingLock ? 3 : 2);
    }
    if (lwlGoalie && goalieNamesMatch(lwlGoalie, nhlProbableStarter.name)) {
      if (!agreedGoalieName) agreedGoalieName = lwlGoalie;
      sources.leftWingLock = true;
      sources.nhlApi = true;
      agreementCount = Math.max(agreementCount, sources.dailyFaceoff && sources.leftWingLock ? 3 : 2);
    }
    
    // If only NHL API has data
    if (agreementCount === 0 && nhlProbableStarter) {
      agreedGoalieName = nhlProbableStarter.name;
      sources.nhlApi = true;
      agreementCount = 1;
    }
  }
  
  // Use first available if no agreement
  if (!agreedGoalieName) {
    agreedGoalieName = dfGoalie || lwlGoalie || nhlProbableStarter?.name || '';
    if (dfGoalie) sources.dailyFaceoff = true;
    else if (lwlGoalie) sources.leftWingLock = true;
    else if (nhlProbableStarter) sources.nhlApi = true;
    agreementCount = 1;
  }
  
  // Find goalie info from NHL API
  let goalieInfo: GoalieInfo | undefined;
  if (nhlProbableStarter && goalieNamesMatch(agreedGoalieName, nhlProbableStarter.name)) {
    goalieInfo = nhlProbableStarter;
  } else {
    goalieInfo = nhlGoalies.find(g => goalieNamesMatch(agreedGoalieName, g.name));
  }
  
  if (!goalieInfo) {
    // Create minimal info if not found in API
    goalieInfo = {
      name: agreedGoalieName,
      team: teamAbbrev,
      teamAbbrev,
      savePercentage: 0.905, // League average
      goalsAgainstAvg: 3.0,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
    };
  }
  
  // Determine confidence level
  let confidence: 'confirmed' | 'likely' | 'projected';
  if (agreementCount >= 2) {
    confidence = 'confirmed';
  } else if (agreementCount === 1 && (sources.dailyFaceoff || sources.leftWingLock)) {
    confidence = 'likely';
  } else {
    confidence = 'projected';
  }
  
  console.log(`✅ ${teamAbbrev}: ${agreedGoalieName} (${confidence}, ${agreementCount}/3 sources)`);
  
  return {
    goalie: goalieInfo,
    confidence,
    sources,
    agreement: agreementCount,
  };
}

/**
 * Refresh cache if stale
 */
async function refreshCacheIfNeeded(): Promise<void> {
  const now = Date.now();
  if (now - goalieCache.lastFetched < CACHE_TTL) {
    return;
  }
  
  console.log('🔄 Refreshing goalie cache...');
  
  const [dfStarters, lwlStarters] = await Promise.all([
    fetchDailyFaceoffStarters(),
    fetchLeftWingLockStarters(),
  ]);
  
  goalieCache.dailyFaceoff = dfStarters;
  goalieCache.leftWingLock = lwlStarters;
  goalieCache.lastFetched = now;
  
  console.log(`✅ Goalie cache refreshed: DF=${dfStarters.size}, LWL=${lwlStarters.size}`);
}

/**
 * Get validated starting goalies for a game
 */
export async function getValidatedStartingGoalies(
  homeTeamAbbrev: string,
  awayTeamAbbrev: string,
  homeIsBackToBack: boolean = false,
  awayIsBackToBack: boolean = false
): Promise<GoalieValidationResult> {
  console.log(`\n🥅 Validating goalies for ${awayTeamAbbrev} @ ${homeTeamAbbrev}...`);
  
  const [homeStarter, awayStarter] = await Promise.all([
    validateStartingGoalie(homeTeamAbbrev, homeIsBackToBack),
    validateStartingGoalie(awayTeamAbbrev, awayIsBackToBack),
  ]);
  
  return {
    homeStarter,
    awayStarter,
    lastUpdated: new Date().toISOString(),
    validationDetails: {
      homeTeam: homeTeamAbbrev,
      awayTeam: awayTeamAbbrev,
      sourcesChecked: ['Daily Faceoff', 'LeftWingLock', 'NHL API'],
    },
  };
}

/**
 * Get goalie tier for prediction adjustments
 */
export function getGoalieTier(savePercentage: number): 'elite' | 'above_average' | 'average' | 'below_average' | 'poor' {
  if (savePercentage >= 0.920) return 'elite';
  if (savePercentage >= 0.915) return 'above_average';
  if (savePercentage >= 0.905) return 'average';
  if (savePercentage >= 0.900) return 'below_average';
  return 'poor';
}

/**
 * Get goal probability adjustment based on opposing goalie
 */
export function getGoalieAdjustment(savePercentage: number): number {
  const leagueAvgSv = 0.905;
  const tier = getGoalieTier(savePercentage);
  
  switch (tier) {
    case 'elite': return 0.85; // 15% reduction
    case 'above_average': return 0.92; // 8% reduction
    case 'average': return 1.0; // No adjustment
    case 'below_average': return 1.08; // 8% increase
    case 'poor': return 1.15; // 15% increase
    default: return 1.0;
  }
}

/**
 * Clear cache (for testing/refresh)
 */
export function clearGoalieCache(): void {
  goalieCache = {
    dailyFaceoff: new Map(),
    leftWingLock: new Map(),
    nhlApiStarters: new Map(),
    lastFetched: 0,
  };
}
