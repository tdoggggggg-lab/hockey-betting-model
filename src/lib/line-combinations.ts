/**
 * 3-Source Line Combination Validation Service
 * 
 * Sources:
 * 1. Daily Faceoff - Projected line combinations from morning skate
 * 2. LeftWingLock - Historical and projected lines
 * 3. NHL API Shift Data - Actual in-game line combinations
 * 
 * Rule: 2 of 3 sources must agree on line placement
 */

export interface PlayerLineInfo {
  playerId: number;
  name: string;
  position: 'C' | 'LW' | 'RW' | 'D' | 'G';
  line: number; // 1-4 for forwards, 1-3 for defense
  powerPlayUnit: number; // 0 = none, 1 = PP1, 2 = PP2
  linemates: string[];
}

export interface TeamLines {
  teamAbbrev: string;
  forwardLines: {
    line1: { lw: string; c: string; rw: string };
    line2: { lw: string; c: string; rw: string };
    line3: { lw: string; c: string; rw: string };
    line4: { lw: string; c: string; rw: string };
  };
  defensePairs: {
    pair1: { ld: string; rd: string };
    pair2: { ld: string; rd: string };
    pair3: { ld: string; rd: string };
  };
  powerPlay: {
    unit1: string[];
    unit2: string[];
  };
  lastUpdated: string;
  confidence: 'confirmed' | 'likely' | 'projected';
}

export interface LineChangeDetection {
  playerName: string;
  previousLine: number;
  currentLine: number;
  changeType: 'promotion' | 'demotion' | 'lateral';
  productionImpact: number; // Multiplier (e.g., 1.25 for 25% boost)
}

// Cache for line data
let lineCache: {
  dailyFaceoff: Map<string, TeamLines>;
  leftWingLock: Map<string, TeamLines>;
  previousLines: Map<string, Map<string, number>>; // team -> player -> line
  lastFetched: number;
} = {
  dailyFaceoff: new Map(),
  leftWingLock: new Map(),
  previousLines: new Map(),
  lastFetched: 0,
};

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Team slugs for Daily Faceoff URLs
const TEAM_DF_SLUGS: Record<string, string> = {
  'ANA': 'anaheim-ducks',
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

/**
 * Fetch line combinations from Daily Faceoff
 */
async function fetchDailyFaceoffLines(teamAbbrev: string): Promise<TeamLines | null> {
  const slug = TEAM_DF_SLUGS[teamAbbrev];
  if (!slug) return null;
  
  try {
    console.log(`🔍 Fetching Daily Faceoff lines for ${teamAbbrev}...`);
    
    const url = `https://www.dailyfaceoff.com/teams/${slug}/line-combinations`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    
    if (!response.ok) {
      console.log(`⚠️ Daily Faceoff returned ${response.status} for ${teamAbbrev}`);
      return null;
    }
    
    const html = await response.text();
    
    // Parse line combinations from HTML
    // Daily Faceoff structure: tables with line info
    const lines: TeamLines = {
      teamAbbrev,
      forwardLines: {
        line1: { lw: '', c: '', rw: '' },
        line2: { lw: '', c: '', rw: '' },
        line3: { lw: '', c: '', rw: '' },
        line4: { lw: '', c: '', rw: '' },
      },
      defensePairs: {
        pair1: { ld: '', rd: '' },
        pair2: { ld: '', rd: '' },
        pair3: { ld: '', rd: '' },
      },
      powerPlay: { unit1: [], unit2: [] },
      lastUpdated: new Date().toISOString(),
      confidence: 'projected',
    };
    
    // Extract player names from line combination tables
    // Pattern varies but generally follows: Line 1/2/3/4 with LW-C-RW
    const linePattern = /line[_-]?(\d)[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]*>([^<]+)<\/a>/gi;
    
    let match;
    while ((match = linePattern.exec(html)) !== null) {
      const lineNum = parseInt(match[1]);
      const player1 = match[2].trim();
      const player2 = match[3].trim();
      const player3 = match[4].trim();
      
      if (lineNum >= 1 && lineNum <= 4) {
        const lineKey = `line${lineNum}` as keyof typeof lines.forwardLines;
        lines.forwardLines[lineKey] = { lw: player1, c: player2, rw: player3 };
      }
    }
    
    // Extract defense pairs
    const defPattern = /pair[_-]?(\d)[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]*>([^<]+)<\/a>/gi;
    
    while ((match = defPattern.exec(html)) !== null) {
      const pairNum = parseInt(match[1]);
      const ld = match[2].trim();
      const rd = match[3].trim();
      
      if (pairNum >= 1 && pairNum <= 3) {
        const pairKey = `pair${pairNum}` as keyof typeof lines.defensePairs;
        lines.defensePairs[pairKey] = { ld, rd };
      }
    }
    
    // Extract power play units
    const ppPattern = /pp[_-]?(\d)[^>]*>[\s\S]*?(<a[^>]*>[^<]+<\/a>[\s\S]*?){5}/gi;
    while ((match = ppPattern.exec(html)) !== null) {
      const unitNum = parseInt(match[1]);
      const playerMatches = match[0].match(/<a[^>]*>([^<]+)<\/a>/g) || [];
      const players = playerMatches.map(p => p.replace(/<[^>]*>/g, '').trim());
      
      if (unitNum === 1) {
        lines.powerPlay.unit1 = players;
      } else if (unitNum === 2) {
        lines.powerPlay.unit2 = players;
      }
    }
    
    console.log(`✅ Daily Faceoff: Found lines for ${teamAbbrev}`);
    return lines;
    
  } catch (error) {
    console.error(`❌ Error fetching Daily Faceoff for ${teamAbbrev}:`, error);
    return null;
  }
}

/**
 * Fetch line combinations from LeftWingLock
 */
async function fetchLeftWingLockLines(teamAbbrev: string): Promise<TeamLines | null> {
  try {
    console.log(`🔍 Fetching LeftWingLock lines for ${teamAbbrev}...`);
    
    const url = `https://leftwinglock.com/line-combinations/${teamAbbrev.toLowerCase()}/`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    
    if (!response.ok) {
      console.log(`⚠️ LeftWingLock returned ${response.status} for ${teamAbbrev}`);
      return null;
    }
    
    const html = await response.text();
    
    const lines: TeamLines = {
      teamAbbrev,
      forwardLines: {
        line1: { lw: '', c: '', rw: '' },
        line2: { lw: '', c: '', rw: '' },
        line3: { lw: '', c: '', rw: '' },
        line4: { lw: '', c: '', rw: '' },
      },
      defensePairs: {
        pair1: { ld: '', rd: '' },
        pair2: { ld: '', rd: '' },
        pair3: { ld: '', rd: '' },
      },
      powerPlay: { unit1: [], unit2: [] },
      lastUpdated: new Date().toISOString(),
      confidence: 'projected',
    };
    
    // LeftWingLock uses a table structure
    // Extract using similar patterns
    const linePattern = /<tr[^>]*class="[^"]*line(\d)[^"]*"[^>]*>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?<td[^>]*>([^<]+)<\/td>/gi;
    
    let match;
    while ((match = linePattern.exec(html)) !== null) {
      const lineNum = parseInt(match[1]);
      const lw = match[2].trim();
      const c = match[3].trim();
      const rw = match[4].trim();
      
      if (lineNum >= 1 && lineNum <= 4) {
        const lineKey = `line${lineNum}` as keyof typeof lines.forwardLines;
        lines.forwardLines[lineKey] = { lw, c, rw };
      }
    }
    
    console.log(`✅ LeftWingLock: Found lines for ${teamAbbrev}`);
    return lines;
    
  } catch (error) {
    console.error(`❌ Error fetching LeftWingLock for ${teamAbbrev}:`, error);
    return null;
  }
}

/**
 * Get player's line number from NHL API roster/stats
 */
async function getPlayerLineFromNHLAPI(teamAbbrev: string, playerName: string): Promise<number> {
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`);
    if (!response.ok) return 0;
    
    const data = await response.json();
    const skaters = data.skaters || [];
    
    // Find player and estimate line based on TOI
    const normalizedName = playerName.toLowerCase();
    const player = skaters.find((s: any) => {
      const name = `${s.firstName?.default || ''} ${s.lastName?.default || ''}`.toLowerCase().trim();
      return name === normalizedName || name.includes(normalizedName.split(' ').pop() || '');
    });
    
    if (!player) return 0;
    
    // Estimate line based on average TOI
    const avgToi = player.avgToi || 0;
    const toiSeconds = typeof avgToi === 'string' 
      ? parseInt(avgToi.split(':')[0]) * 60 + parseInt(avgToi.split(':')[1] || '0')
      : avgToi;
    
    if (toiSeconds >= 18 * 60) return 1; // 18+ min = Line 1
    if (toiSeconds >= 15 * 60) return 2; // 15-18 min = Line 2
    if (toiSeconds >= 12 * 60) return 3; // 12-15 min = Line 3
    return 4; // <12 min = Line 4
    
  } catch {
    return 0;
  }
}

/**
 * Normalize player name for comparison
 */
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim();
}

/**
 * Find a player's line number across sources
 */
export async function getPlayerLine(
  playerName: string,
  teamAbbrev: string
): Promise<{ line: number; confidence: 'confirmed' | 'likely' | 'projected'; isPP1: boolean }> {
  await refreshLineCacheIfNeeded(teamAbbrev);
  
  const normalizedName = normalizePlayerName(playerName);
  
  // Check Daily Faceoff
  let dfLine = 0;
  let dfIsPP1 = false;
  const dfLines = lineCache.dailyFaceoff.get(teamAbbrev);
  if (dfLines) {
    // Search through forward lines
    for (let i = 1; i <= 4; i++) {
      const lineKey = `line${i}` as keyof typeof dfLines.forwardLines;
      const line = dfLines.forwardLines[lineKey];
      if (normalizePlayerName(line.lw).includes(normalizedName.split(' ').pop() || '') ||
          normalizePlayerName(line.c).includes(normalizedName.split(' ').pop() || '') ||
          normalizePlayerName(line.rw).includes(normalizedName.split(' ').pop() || '')) {
        dfLine = i;
        break;
      }
    }
    // Check PP1
    dfIsPP1 = dfLines.powerPlay.unit1.some(p => normalizePlayerName(p).includes(normalizedName.split(' ').pop() || ''));
  }
  
  // Check LeftWingLock
  let lwlLine = 0;
  let lwlIsPP1 = false;
  const lwlLines = lineCache.leftWingLock.get(teamAbbrev);
  if (lwlLines) {
    for (let i = 1; i <= 4; i++) {
      const lineKey = `line${i}` as keyof typeof lwlLines.forwardLines;
      const line = lwlLines.forwardLines[lineKey];
      if (normalizePlayerName(line.lw).includes(normalizedName.split(' ').pop() || '') ||
          normalizePlayerName(line.c).includes(normalizedName.split(' ').pop() || '') ||
          normalizePlayerName(line.rw).includes(normalizedName.split(' ').pop() || '')) {
        lwlLine = i;
        break;
      }
    }
    lwlIsPP1 = lwlLines.powerPlay.unit1.some(p => normalizePlayerName(p).includes(normalizedName.split(' ').pop() || ''));
  }
  
  // Check NHL API (by TOI)
  const nhlLine = await getPlayerLineFromNHLAPI(teamAbbrev, playerName);
  
  // 2-of-3 agreement
  let agreedLine = 0;
  let confidence: 'confirmed' | 'likely' | 'projected' = 'projected';
  let isPP1 = false;
  
  if (dfLine && lwlLine && dfLine === lwlLine) {
    agreedLine = dfLine;
    confidence = 'confirmed';
    isPP1 = dfIsPP1 || lwlIsPP1;
  } else if (dfLine && nhlLine && dfLine === nhlLine) {
    agreedLine = dfLine;
    confidence = 'confirmed';
    isPP1 = dfIsPP1;
  } else if (lwlLine && nhlLine && lwlLine === nhlLine) {
    agreedLine = lwlLine;
    confidence = 'confirmed';
    isPP1 = lwlIsPP1;
  } else if (dfLine || lwlLine || nhlLine) {
    // No agreement - use first available
    agreedLine = dfLine || lwlLine || nhlLine;
    confidence = dfLine || lwlLine ? 'likely' : 'projected';
    isPP1 = dfIsPP1 || lwlIsPP1;
  }
  
  return { line: agreedLine, confidence, isPP1 };
}

/**
 * Detect line changes from previous data
 */
export async function detectLineChanges(
  teamAbbrev: string
): Promise<LineChangeDetection[]> {
  const changes: LineChangeDetection[] = [];
  
  await refreshLineCacheIfNeeded(teamAbbrev);
  
  const currentLines = lineCache.dailyFaceoff.get(teamAbbrev) || lineCache.leftWingLock.get(teamAbbrev);
  const previousPlayerLines = lineCache.previousLines.get(teamAbbrev);
  
  if (!currentLines || !previousPlayerLines) return changes;
  
  // Check all players in current lines
  for (let lineNum = 1; lineNum <= 4; lineNum++) {
    const lineKey = `line${lineNum}` as keyof typeof currentLines.forwardLines;
    const line = currentLines.forwardLines[lineKey];
    
    for (const playerName of [line.lw, line.c, line.rw]) {
      if (!playerName) continue;
      
      const normalizedName = normalizePlayerName(playerName);
      const previousLine = previousPlayerLines.get(normalizedName);
      
      if (previousLine && previousLine !== lineNum) {
        const isPromotion = lineNum < previousLine;
        let productionImpact = 1.0;
        
        // Calculate production impact based on line change
        if (isPromotion) {
          if (previousLine === 4 && lineNum === 3) productionImpact = 1.12;
          else if (previousLine === 3 && lineNum === 2) productionImpact = 1.20;
          else if (previousLine === 2 && lineNum === 1) productionImpact = 1.30;
          else if (previousLine === 4 && lineNum === 2) productionImpact = 1.35;
          else if (previousLine === 3 && lineNum === 1) productionImpact = 1.40;
          else if (previousLine === 4 && lineNum === 1) productionImpact = 1.50;
        } else {
          // Demotion
          if (previousLine === 1 && lineNum === 2) productionImpact = 0.85;
          else if (previousLine === 2 && lineNum === 3) productionImpact = 0.80;
          else if (previousLine === 3 && lineNum === 4) productionImpact = 0.75;
        }
        
        changes.push({
          playerName,
          previousLine,
          currentLine: lineNum,
          changeType: isPromotion ? 'promotion' : 'demotion',
          productionImpact,
        });
      }
    }
  }
  
  return changes;
}

/**
 * Get linemates for a player
 */
export async function getLinemates(
  playerName: string,
  teamAbbrev: string
): Promise<string[]> {
  await refreshLineCacheIfNeeded(teamAbbrev);
  
  const normalizedName = normalizePlayerName(playerName);
  const lines = lineCache.dailyFaceoff.get(teamAbbrev) || lineCache.leftWingLock.get(teamAbbrev);
  
  if (!lines) return [];
  
  // Search through forward lines
  for (let i = 1; i <= 4; i++) {
    const lineKey = `line${i}` as keyof typeof lines.forwardLines;
    const line = lines.forwardLines[lineKey];
    const players = [line.lw, line.c, line.rw].filter(Boolean);
    
    const isOnLine = players.some(p => {
      const normP = normalizePlayerName(p);
      const lastName = normalizedName.split(' ').pop() || '';
      return normP.includes(lastName) || normP === normalizedName;
    });
    
    if (isOnLine) {
      // Return other players on the line
      return players.filter(p => {
        const normP = normalizePlayerName(p);
        const lastName = normalizedName.split(' ').pop() || '';
        return !normP.includes(lastName) && normP !== normalizedName;
      });
    }
  }
  
  return [];
}

/**
 * Refresh line cache if needed
 */
async function refreshLineCacheIfNeeded(teamAbbrev: string): Promise<void> {
  const now = Date.now();
  
  // Check if we have recent data for this team
  const dfLines = lineCache.dailyFaceoff.get(teamAbbrev);
  const cacheAge = dfLines ? now - new Date(dfLines.lastUpdated).getTime() : Infinity;
  
  if (cacheAge < CACHE_TTL) return;
  
  console.log(`🔄 Refreshing line cache for ${teamAbbrev}...`);
  
  // Store previous lines before refresh
  const currentLines = lineCache.dailyFaceoff.get(teamAbbrev) || lineCache.leftWingLock.get(teamAbbrev);
  if (currentLines) {
    const playerLines = new Map<string, number>();
    for (let i = 1; i <= 4; i++) {
      const lineKey = `line${i}` as keyof typeof currentLines.forwardLines;
      const line = currentLines.forwardLines[lineKey];
      [line.lw, line.c, line.rw].forEach(p => {
        if (p) playerLines.set(normalizePlayerName(p), i);
      });
    }
    lineCache.previousLines.set(teamAbbrev, playerLines);
  }
  
  // Fetch fresh data
  const [dfLines2, lwlLines] = await Promise.all([
    fetchDailyFaceoffLines(teamAbbrev),
    fetchLeftWingLockLines(teamAbbrev),
  ]);
  
  if (dfLines2) lineCache.dailyFaceoff.set(teamAbbrev, dfLines2);
  if (lwlLines) lineCache.leftWingLock.set(teamAbbrev, lwlLines);
  
  lineCache.lastFetched = now;
}

/**
 * Get line promotion boost for player
 * Returns multiplier > 1 if promoted, < 1 if demoted, 1 if no change
 */
export async function getLinePromotionBoost(
  playerName: string,
  teamAbbrev: string
): Promise<number> {
  const changes = await detectLineChanges(teamAbbrev);
  const normalizedName = normalizePlayerName(playerName);
  
  const change = changes.find(c => 
    normalizePlayerName(c.playerName).includes(normalizedName.split(' ').pop() || '')
  );
  
  return change?.productionImpact || 1.0;
}

/**
 * Clear line cache (for testing)
 */
export function clearLineCache(): void {
  lineCache = {
    dailyFaceoff: new Map(),
    leftWingLock: new Map(),
    previousLines: new Map(),
    lastFetched: 0,
  };
}
