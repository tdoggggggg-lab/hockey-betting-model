import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ============ TYPES ============

interface PropPrediction {
  playerId: number;
  playerName: string;
  team: string;
  teamAbbrev: string;
  opponent: string;
  opponentAbbrev: string;
  gameTime: string;
  isHome: boolean;
  propType: string;
  expectedValue: number;
  probability: number;
  line: number;
  confidence: number;
  isValueBet: boolean;
  bookOdds?: {
    over: number;
    under: number;
    line: number;
  };
}

interface GoaliePrediction {
  playerId: number;
  playerName: string;
  team: string;
  teamAbbrev: string;
  opponent: string;
  opponentAbbrev: string;
  gameTime: string;
  isHome: boolean;
  isStarter: boolean;
  expectedSaves: number;
  savesLine: number;
  savesOverProb: number;
  savesUnderProb: number;
  expectedGA: number;
  gaLine: number;
  gaOverProb: number;
  gaUnderProb: number;
  bookOdds?: {
    savesOver: number;
    savesUnder: number;
    savesLine: number;
    gaOver: number;
    gaUnder: number;
    gaLine: number;
  };
  confidence: number;
  isValueBet: boolean;
}

// ============ CACHE ============
// Optimized for 500 credits/month:
// - Player props: 6 hour cache = 4 calls/day = 120/month
// - Game odds: 2 hour cache (handled in games route) = 360/month
// Total: ~480/month ✅

let propsCache: { 
  data: Map<string, any>; 
  timestamp: number;
  playerStats: Map<string, any[]>;
  playerStatsTimestamp: number;
} = {
  data: new Map(),
  timestamp: 0,
  playerStats: new Map(),
  playerStatsTimestamp: 0,
};

const PROPS_CACHE_TTL = 21600000; // 6 hours for book odds (to save API credits)
const PLAYER_STATS_CACHE_TTL = 600000; // 10 minutes for NHL stats (free)

const ODDS_API_KEY = process.env.ODDS_API_KEY;

// ============ ELITE PLAYERS ============

const ELITE_SCORERS = new Set([
  'Connor McDavid', 'Nathan MacKinnon', 'Auston Matthews', 'Leon Draisaitl',
  'Nikita Kucherov', 'David Pastrnak', 'Cale Makar', 'Kirill Kaprizov',
  'Mikko Rantanen', 'Sam Reinhart', 'Jake Guentzel', 'Matthew Tkachuk',
  'Jack Eichel', 'Mitch Marner', 'Sidney Crosby', 'Aleksander Barkov',
  'Sebastian Aho', 'Brayden Point', 'Brady Tkachuk', 'Tim Stutzle',
  'Kyle Connor', 'Mark Scheifele', 'Artemi Panarin', 'Adam Fox',
  'Quinn Hughes', 'Zach Hyman', 'William Nylander', 'Jason Robertson',
  'Tage Thompson', 'Dylan Larkin', 'Trevor Zegras', 'Clayton Keller',
]);

// ============ HELPERS ============

async function fetchWithTimeout(url: string, timeoutMs: number = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function poissonProb(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function poissonAtLeastOne(lambda: number): number {
  return 1 - Math.exp(-lambda);
}

function poissonOver(lambda: number, line: number): number {
  // P(X > line) = 1 - P(X <= floor(line))
  let cumProb = 0;
  for (let k = 0; k <= Math.floor(line); k++) {
    cumProb += poissonProb(lambda, k);
  }
  return 1 - cumProb;
}

function normalCDF(x: number, mean: number, stdDev: number): number {
  const z = (x - mean) / stdDev;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// ============ FETCH PLAYER STATS ============

async function getPlayerStats(teamAbbrev: string): Promise<any[]> {
  // Check cache
  const cached = propsCache.playerStats.get(teamAbbrev);
  if (cached && Date.now() - propsCache.playerStatsTimestamp < PLAYER_STATS_CACHE_TTL) {
    return cached;
  }
  
  try {
    const response = await fetchWithTimeout(
      `https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`,
      5000
    );
    if (!response.ok) return [];
    const data = await response.json();
    const players = data.skaters || [];
    propsCache.playerStats.set(teamAbbrev, players);
    propsCache.playerStatsTimestamp = Date.now();
    return players;
  } catch {
    return propsCache.playerStats.get(teamAbbrev) || [];
  }
}

async function getGoalieStats(teamAbbrev: string): Promise<any[]> {
  try {
    const response = await fetchWithTimeout(
      `https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`,
      5000
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.goalies || [];
  } catch {
    return [];
  }
}

// ============ FETCH BOOK ODDS (Optimized) ============

async function fetchPlayerPropsOdds(propType: string): Promise<Map<string, any>> {
  const oddsMap = new Map();
  
  if (!ODDS_API_KEY) return oddsMap;
  
  // Check cache (6 hour TTL to save credits)
  const cacheKey = `props_${propType}`;
  const cached = propsCache.data.get(cacheKey);
  if (cached && Date.now() - propsCache.timestamp < PROPS_CACHE_TTL) {
    console.log(`✅ Using cached ${propType} odds`);
    return cached;
  }
  
  // Map prop type to Odds API market
  const marketMap: Record<string, string> = {
    'goalscorer': 'player_goal_scorer_anytime',
    'shots': 'player_shots_on_goal',
    'points': 'player_points',
    'assists': 'player_assists',
  };
  
  const market = marketMap[propType];
  if (!market) return oddsMap;
  
  try {
    console.log(`🔄 Fetching ${propType} book odds...`);
    const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${market}&bookmakers=draftkings`;
    
    const response = await fetchWithTimeout(url, 10000);
    if (!response.ok) {
      console.log(`❌ Props odds API: ${response.status}`);
      return cached || oddsMap;
    }
    
    const data = await response.json();
    const remaining = response.headers.get('x-requests-remaining');
    console.log(`📊 Props API: ${data.length} games, ${remaining} credits left`);
    
    // Parse odds
    for (const game of data) {
      const dk = game.bookmakers?.find((b: any) => b.key === 'draftkings');
      if (!dk) continue;
      
      const marketData = dk.markets?.find((m: any) => m.key === market);
      if (!marketData) continue;
      
      for (const outcome of marketData.outcomes || []) {
        const playerName = outcome.description || outcome.name;
        const line = outcome.point || 0.5;
        const odds = outcome.price || 0;
        
        // Store by player name (normalized)
        const key = playerName.toLowerCase().trim();
        if (!oddsMap.has(key)) {
          oddsMap.set(key, { over: 0, under: 0, line });
        }
        
        const entry = oddsMap.get(key);
        if (outcome.name === 'Over' || !outcome.name.includes('Under')) {
          entry.over = odds > 0 ? odds : Math.round(-100 / (odds / 100 - 1));
        } else {
          entry.under = odds > 0 ? odds : Math.round(-100 / (odds / 100 - 1));
        }
      }
    }
    
    // Update cache
    propsCache.data.set(cacheKey, oddsMap);
    propsCache.timestamp = Date.now();
    console.log(`💾 Cached ${oddsMap.size} player odds for ${propType}`);
    
  } catch (error: any) {
    console.log(`❌ Props odds error: ${error.message}`);
    return cached || oddsMap;
  }
  
  return oddsMap;
}

// ============ PROCESS PLAYERS ============

function processSkaterProps(
  players: any[],
  teamAbbrev: string,
  teamName: string,
  opponentAbbrev: string,
  opponentName: string,
  gameTime: string,
  isHome: boolean,
  propType: string,
  bookOddsMap: Map<string, any>
): PropPrediction[] {
  const predictions: PropPrediction[] = [];
  
  for (const player of players) {
    try {
      const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
      if (!name) continue;
      
      const gamesPlayed = player.gamesPlayed || 0;
      if (gamesPlayed < 10) continue;
      
      let baseLambda = 0;
      let line = 0.5;
      
      // Calculate expected value based on prop type
      switch (propType) {
        case 'goalscorer':
          baseLambda = (player.goals || 0) / gamesPlayed;
          line = 0.5;
          if (baseLambda < 0.05) continue;
          break;
        case 'shots':
          baseLambda = (player.shots || 0) / gamesPlayed;
          line = 2.5; // Default line
          if (baseLambda < 1.0) continue;
          break;
        case 'points':
          baseLambda = (player.points || 0) / gamesPlayed;
          line = 0.5;
          if (baseLambda < 0.15) continue;
          break;
        case 'assists':
          baseLambda = (player.assists || 0) / gamesPlayed;
          line = 0.5;
          if (baseLambda < 0.10) continue;
          break;
      }
      
      // Adjustments
      const homeAwayAdj = isHome ? 1.05 : 0.95;
      const finalLambda = baseLambda * homeAwayAdj;
      
      // Calculate probability
      let probability: number;
      if (propType === 'goalscorer') {
        probability = poissonAtLeastOne(finalLambda);
      } else {
        probability = poissonOver(finalLambda, line);
      }
      
      // Confidence
      let confidence = 0.3;
      if (ELITE_SCORERS.has(name)) confidence += 0.35;
      else if (baseLambda >= 0.35) confidence += 0.25;
      else if (baseLambda >= 0.20) confidence += 0.15;
      if (gamesPlayed >= 30) confidence += 0.15;
      confidence = Math.min(0.95, confidence);
      
      // Get book odds
      const bookKey = name.toLowerCase().trim();
      const bookOdds = bookOddsMap.get(bookKey);
      
      predictions.push({
        playerId: player.playerId || Math.floor(Math.random() * 100000),
        playerName: name,
        team: teamName,
        teamAbbrev,
        opponent: opponentName,
        opponentAbbrev,
        gameTime,
        isHome,
        propType,
        expectedValue: finalLambda,
        probability,
        line,
        confidence,
        isValueBet: false,
        bookOdds: bookOdds || undefined,
      });
    } catch (e) {
      // Skip problematic players
    }
  }
  
  return predictions;
}

function processGoalieProps(
  goalies: any[],
  teamAbbrev: string,
  teamName: string,
  opponentAbbrev: string,
  opponentName: string,
  gameTime: string,
  isHome: boolean,
  opponentShotsPerGame: number,
  opponentGoalsPerGame: number
): GoaliePrediction[] {
  const predictions: GoaliePrediction[] = [];
  
  for (const goalie of goalies) {
    try {
      const name = `${goalie.firstName?.default || ''} ${goalie.lastName?.default || ''}`.trim();
      if (!name) continue;
      
      const gamesPlayed = goalie.gamesPlayed || 0;
      if (gamesPlayed < 5) continue;
      
      const savePct = goalie.savePctg || 0.900;
      const gaa = goalie.goalsAgainstAverage || 3.0;
      
      // Expected saves = opponent shots × save %
      const expectedShots = opponentShotsPerGame * (isHome ? 0.97 : 1.03); // Slight home advantage
      const expectedSaves = expectedShots * savePct;
      const savesLine = Math.round(expectedSaves * 2) / 2; // Round to .5
      
      // Expected GA
      const expectedGA = opponentGoalsPerGame * (isHome ? 0.95 : 1.05);
      const gaLine = Math.round(expectedGA * 2) / 2;
      
      // Saves probabilities (normal distribution, std dev ~4)
      const savesOverProb = 1 - normalCDF(savesLine, expectedSaves, 4);
      const savesUnderProb = normalCDF(savesLine, expectedSaves, 4);
      
      // GA probabilities (Poisson)
      const gaOverProb = poissonOver(expectedGA, gaLine);
      const gaUnderProb = 1 - gaOverProb;
      
      // Is starter? (most games played = likely starter)
      const isStarter = gamesPlayed >= 20;
      
      // Confidence
      let confidence = 0.4;
      if (gamesPlayed >= 30) confidence += 0.2;
      if (savePct >= 0.910) confidence += 0.15;
      confidence = Math.min(0.85, confidence);
      
      predictions.push({
        playerId: goalie.playerId || Math.floor(Math.random() * 100000),
        playerName: name,
        team: teamName,
        teamAbbrev,
        opponent: opponentName,
        opponentAbbrev,
        gameTime,
        isHome,
        isStarter,
        expectedSaves,
        savesLine,
        savesOverProb,
        savesUnderProb,
        expectedGA,
        gaLine,
        gaOverProb,
        gaUnderProb,
        confidence,
        isValueBet: false,
      });
    } catch (e) {
      // Skip problematic goalies
    }
  }
  
  return predictions;
}

// ============ MAIN HANDLER ============

export async function GET(request: Request) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const propType = searchParams.get('type') || 'goalscorer';
  
  try {
    console.log(`🏒 Props API started (type: ${propType})`);
    
    // Get schedule
    let schedData: any = null;
    try {
      const schedRes = await fetchWithTimeout('https://api-web.nhle.com/v1/schedule/now', 8000);
      if (schedRes.ok) {
        schedData = await schedRes.json();
      }
    } catch (e) {
      console.log('⚠️ Schedule fetch failed');
    }
    
    if (!schedData?.gameWeek) {
      return NextResponse.json({
        predictions: [],
        valueBets: [],
        lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0,
        playersAnalyzed: 0,
        message: 'Unable to fetch schedule.',
      });
    }
    
    // Get today in ET
    const now = new Date();
    const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayStr = etDate.toISOString().split('T')[0];
    
    // Find today's games
    let todayGames: any[] = [];
    let gameDate = '';
    
    for (const day of schedData.gameWeek || []) {
      if (day.date < todayStr) continue;
      if (day.games?.length > 0) {
        todayGames = day.games;
        gameDate = day.date;
        break;
      }
    }
    
    if (!todayGames.length) {
      return NextResponse.json({
        predictions: [],
        valueBets: [],
        lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0,
        playersAnalyzed: 0,
        message: 'No games scheduled.',
      });
    }
    
    console.log(`📅 Found ${todayGames.length} games for ${gameDate}`);
    
    // Fetch book odds (only for skater props)
    let bookOddsMap = new Map();
    if (propType !== 'goalie' && ODDS_API_KEY) {
      bookOddsMap = await fetchPlayerPropsOdds(propType);
    }
    
    // Collect teams
    const teamsToFetch = new Set<string>();
    for (const game of todayGames) {
      if (game.homeTeam?.abbrev) teamsToFetch.add(game.homeTeam.abbrev);
      if (game.awayTeam?.abbrev) teamsToFetch.add(game.awayTeam.abbrev);
    }
    
    // Fetch all team stats in parallel
    const teamStatsMap = new Map<string, any[]>();
    const goalieStatsMap = new Map<string, any[]>();
    
    await Promise.all(
      Array.from(teamsToFetch).map(async (abbrev) => {
        if (propType === 'goalie') {
          const goalies = await getGoalieStats(abbrev);
          goalieStatsMap.set(abbrev, goalies);
        }
        const players = await getPlayerStats(abbrev);
        teamStatsMap.set(abbrev, players);
      })
    );
    
    console.log(`✅ Fetched ${teamStatsMap.size} teams in ${Date.now() - startTime}ms`);
    
    // Process all games
    if (propType === 'goalie') {
      // Goalie props
      const allPredictions: GoaliePrediction[] = [];
      
      for (const game of todayGames) {
        const homeAbbrev = game.homeTeam?.abbrev;
        const awayAbbrev = game.awayTeam?.abbrev;
        if (!homeAbbrev || !awayAbbrev) continue;
        
        const getTeamName = (team: any) => {
          if (team?.placeName?.default && team?.commonName?.default) {
            return `${team.placeName.default} ${team.commonName.default}`;
          }
          return team?.abbrev || 'Unknown';
        };
        
        let gameTime = 'TBD';
        if (game.startTimeUTC) {
          gameTime = new Date(game.startTimeUTC).toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
          });
        }
        
        // Get opponent stats for expected shots/goals
        const homeSkaters = teamStatsMap.get(homeAbbrev) || [];
        const awaySkaters = teamStatsMap.get(awayAbbrev) || [];
        
        // Calculate team averages
        const homeShots = homeSkaters.reduce((sum, p) => sum + (p.shots || 0), 0) / 
          Math.max(1, homeSkaters[0]?.gamesPlayed || 40);
        const awayShots = awaySkaters.reduce((sum, p) => sum + (p.shots || 0), 0) / 
          Math.max(1, awaySkaters[0]?.gamesPlayed || 40);
        const homeGoals = homeSkaters.reduce((sum, p) => sum + (p.goals || 0), 0) / 
          Math.max(1, homeSkaters[0]?.gamesPlayed || 40);
        const awayGoals = awaySkaters.reduce((sum, p) => sum + (p.goals || 0), 0) / 
          Math.max(1, awaySkaters[0]?.gamesPlayed || 40);
        
        // Home goalies (face away team)
        const homeGoalies = goalieStatsMap.get(homeAbbrev) || [];
        const homePreds = processGoalieProps(
          homeGoalies, homeAbbrev, getTeamName(game.homeTeam),
          awayAbbrev, getTeamName(game.awayTeam), gameTime, true,
          awayShots || 30, awayGoals || 3
        );
        
        // Away goalies (face home team)
        const awayGoalies = goalieStatsMap.get(awayAbbrev) || [];
        const awayPreds = processGoalieProps(
          awayGoalies, awayAbbrev, getTeamName(game.awayTeam),
          homeAbbrev, getTeamName(game.homeTeam), gameTime, false,
          homeShots || 30, homeGoals || 3
        );
        
        allPredictions.push(...homePreds, ...awayPreds);
      }
      
      // Sort by confidence
      allPredictions.sort((a, b) => b.confidence - a.confidence);
      
      // Mark value bets (starters with high confidence)
      const valueBets = allPredictions
        .filter(p => p.isStarter && p.confidence >= 0.55)
        .slice(0, 4)
        .map(p => ({ ...p, isValueBet: true }));
      
      return NextResponse.json({
        predictions: allPredictions,
        valueBets,
        lastUpdated: new Date().toISOString(),
        gamesAnalyzed: todayGames.length,
        fetchTimeMs: Date.now() - startTime,
      });
      
    } else {
      // Skater props (goalscorer, shots, points, assists)
      const allPredictions: PropPrediction[] = [];
      
      for (const game of todayGames) {
        const homeAbbrev = game.homeTeam?.abbrev;
        const awayAbbrev = game.awayTeam?.abbrev;
        if (!homeAbbrev || !awayAbbrev) continue;
        
        const getTeamName = (team: any) => {
          if (team?.placeName?.default && team?.commonName?.default) {
            return `${team.placeName.default} ${team.commonName.default}`;
          }
          return team?.abbrev || 'Unknown';
        };
        
        let gameTime = 'TBD';
        if (game.startTimeUTC) {
          gameTime = new Date(game.startTimeUTC).toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
          });
        }
        
        const homePlayers = teamStatsMap.get(homeAbbrev) || [];
        const awayPlayers = teamStatsMap.get(awayAbbrev) || [];
        
        const homePreds = processSkaterProps(
          homePlayers, homeAbbrev, getTeamName(game.homeTeam),
          awayAbbrev, getTeamName(game.awayTeam), gameTime, true,
          propType, bookOddsMap
        );
        
        const awayPreds = processSkaterProps(
          awayPlayers, awayAbbrev, getTeamName(game.awayTeam),
          homeAbbrev, getTeamName(game.homeTeam), gameTime, false,
          propType, bookOddsMap
        );
        
        allPredictions.push(...homePreds, ...awayPreds);
      }
      
      // Sort by probability
      allPredictions.sort((a, b) => b.probability - a.probability);
      
      // Mark top picks
      const topPicks = allPredictions
        .filter(p => p.probability >= 0.20 && p.confidence >= 0.45)
        .slice(0, 10)
        .map(p => ({ ...p, isValueBet: true }));
      
      const topPickIds = new Set(topPicks.map(p => p.playerId));
      const markedPredictions = allPredictions.map(p => ({
        ...p,
        isValueBet: topPickIds.has(p.playerId),
      }));
      
      console.log(`📊 Generated ${allPredictions.length} ${propType} predictions`);
      
      return NextResponse.json({
        predictions: markedPredictions,
        valueBets: topPicks,
        lastUpdated: new Date().toISOString(),
        gamesAnalyzed: todayGames.length,
        playersAnalyzed: allPredictions.length,
        gameDate,
        fetchTimeMs: Date.now() - startTime,
      });
    }
    
  } catch (error: any) {
    console.error('❌ Props API error:', error);
    return NextResponse.json({
      predictions: [],
      valueBets: [],
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: 0,
      playersAnalyzed: 0,
      error: 'Failed to generate predictions.',
    });
  }
}
