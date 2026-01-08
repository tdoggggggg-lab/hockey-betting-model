import { NextResponse } from 'next/server';
import { isPlayerInjured, getPlayerPropsAdjustment, refreshInjuryCache, getInjuredPlayerNames } from '@/lib/injury-service';

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
  edge?: number;  // Model prob - Book implied prob (e.g., 0.08 = 8% edge)
  bookImpliedProb?: number;  // Book's implied probability
  bookOdds?: {
    over: number;
    under: number;
    line: number;
    bookmaker?: string;
  };
  injuryNote?: string;  // e.g., "Linemate injured (-25% production)"
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
// Optimized for 500 credits/month FREE TIER:
// - Events: 24hr cache = 1 call/day = 30/month
// - Game odds: 24hr cache = 1 call/day = 30/month (in games route)
// - Player props: 24hr cache, 2 games per market = 60/month per market
// - 4 markets = 240/month
// Total: ~300/month ✅

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

const PROPS_CACHE_TTL = 86400000; // 24 hours - refreshes once daily to save credits
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

// ============ FETCH BOOK ODDS (Per-Event for Player Props) ============

// Cache for events list (valid for 24 hours to save credits)
let eventsCache: { events: any[]; timestamp: number } = { events: [], timestamp: 0 };
const EVENTS_CACHE_TTL = 86400000; // 24 hours

async function fetchNHLEvents(): Promise<any[]> {
  // Check cache
  if (eventsCache.events.length > 0 && Date.now() - eventsCache.timestamp < EVENTS_CACHE_TTL) {
    return eventsCache.events;
  }
  
  if (!ODDS_API_KEY) return [];
  
  try {
    const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events?apiKey=${ODDS_API_KEY}`;
    const response = await fetchWithTimeout(url, 10000);
    
    if (!response.ok) {
      console.log(`❌ Events API: ${response.status}`);
      return eventsCache.events; // Return stale cache if available
    }
    
    const events = await response.json();
    const remaining = response.headers.get('x-requests-remaining');
    console.log(`📋 Events API: ${events.length} NHL events, ${remaining} credits left`);
    
    eventsCache = { events, timestamp: Date.now() };
    return events;
  } catch (error: any) {
    console.log(`❌ Events error: ${error.message}`);
    return eventsCache.events;
  }
}

async function fetchPlayerPropsOdds(propType: string): Promise<Map<string, any>> {
  const oddsMap = new Map();
  
  if (!ODDS_API_KEY) {
    console.log('⚠️ No ODDS_API_KEY - skipping book odds');
    return oddsMap;
  }
  
  // Check cache (6 hour TTL to save credits)
  const cacheKey = `props_${propType}`;
  const cached = propsCache.data.get(cacheKey);
  if (cached && Date.now() - propsCache.timestamp < PROPS_CACHE_TTL) {
    console.log(`✅ Using cached ${propType} odds (${cached.size} players)`);
    return cached;
  }
  
  // Map prop type to Odds API market
  const marketMap: Record<string, string> = {
    'goalscorer': 'player_goal_scorer_anytime',  // Anytime goalscorer
    'shots': 'player_shots_on_goal',
    'points': 'player_points',
    'assists': 'player_assists',
  };
  
  const market = marketMap[propType];
  if (!market) {
    console.log(`⚠️ No market mapping for ${propType}`);
    return oddsMap;
  }
  
  try {
    // Step 1: Get list of events (uses 1 credit, cached for 1 hour)
    const events = await fetchNHLEvents();
    
    if (events.length === 0) {
      console.log('⚠️ No NHL events found');
      return cached || oddsMap;
    }
    
    // Filter to today's events only (to save credits)
    const now = new Date();
    const todayStart = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    
    const todayEvents = events.filter((e: any) => {
      const eventTime = new Date(e.commence_time);
      return eventTime >= todayStart && eventTime < tomorrowStart;
    });
    
    console.log(`🔄 Fetching ${propType} props for ${todayEvents.length} today's games...`);
    
    // Step 2: Fetch player props for each event (1 credit per event per market)
    // Limit to max 2 games to stay within 500 free credits/month
    const eventsToFetch = todayEvents.slice(0, 2);
    
    let totalPlayersFound = 0;
    
    for (const event of eventsToFetch) {
      try {
        const eventUrl = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events/${event.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${market}&bookmakers=draftkings,fanduel`;
        
        const response = await fetchWithTimeout(eventUrl, 8000);
        
        if (!response.ok) {
          console.log(`❌ Event ${event.id} props: ${response.status}`);
          continue;
        }
        
        const data = await response.json();
        const remaining = response.headers.get('x-requests-remaining');
        
        // Parse bookmakers
        for (const bookmaker of data.bookmakers || []) {
          const marketData = bookmaker.markets?.find((m: any) => m.key === market);
          if (!marketData) continue;
          
          for (const outcome of marketData.outcomes || []) {
            // For anytime goalscorer, the player name is in 'description' or 'name'
            const playerName = outcome.description || outcome.name;
            if (!playerName || playerName === 'Over' || playerName === 'Under') continue;
            
            const line = outcome.point ?? 0.5;
            const odds = outcome.price || 0;
            
            // Normalize player name for matching
            const key = playerName.toLowerCase().trim();
            
            if (!oddsMap.has(key)) {
              oddsMap.set(key, { 
                over: 0, 
                under: 0, 
                line,
                bookmaker: bookmaker.title,
                homeTeam: event.home_team,
                awayTeam: event.away_team,
              });
            }
            
            const entry = oddsMap.get(key);
            
            // For anytime goalscorer, there's typically just one price (to score)
            if (market === 'player_goal_scorer_anytime') {
              entry.over = odds; // The odds TO score
              entry.line = 0.5;
            } else {
              // For O/U props (shots, points, assists)
              if (outcome.name === 'Over') {
                entry.over = odds;
                entry.line = line;
              } else if (outcome.name === 'Under') {
                entry.under = odds;
              }
            }
            
            totalPlayersFound++;
          }
        }
        
        console.log(`  ✅ ${event.home_team} vs ${event.away_team}: found props, ${remaining} credits left`);
        
      } catch (eventError: any) {
        console.log(`  ❌ Event error: ${eventError.message}`);
      }
    }
    
    // Update cache
    if (oddsMap.size > 0) {
      propsCache.data.set(cacheKey, oddsMap);
      propsCache.timestamp = Date.now();
      console.log(`💾 Cached ${oddsMap.size} player ${propType} odds`);
    }
    
    return oddsMap;
    
  } catch (error: any) {
    console.log(`❌ Props odds error: ${error.message}`);
    return cached || oddsMap;
  }
}

// ============ PROCESS PLAYERS ============

async function processSkaterProps(
  players: any[],
  teamAbbrev: string,
  teamName: string,
  opponentAbbrev: string,
  opponentName: string,
  gameTime: string,
  isHome: boolean,
  propType: string,
  bookOddsMap: Map<string, any>,
  injuredNames: Set<string>
): Promise<PropPrediction[]> {
  const predictions: PropPrediction[] = [];
  
  for (const player of players) {
    try {
      const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
      if (!name) continue;
      
      // Skip injured players - normalize EXACTLY like injury-service.ts does
      const normalizedName = name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, '')
        .replace(/[^a-z\s-]/g, '')
        .trim();
      if (injuredNames.has(normalizedName)) {
        console.log(`🏥 Skipping injured player: ${name}`);
        continue;
      }
      
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
      
      // Get injury adjustment for this player (linemate effects, line shuffling)
      const injuryAdj = await getPlayerPropsAdjustment(name, teamAbbrev);
      
      // Apply adjustments
      const homeAwayAdj = isHome ? 1.05 : 0.95;
      const linemateAdj = injuryAdj.productionMultiplier; // e.g., 0.75 if linemate injured
      const finalLambda = baseLambda * homeAwayAdj * linemateAdj;
      
      // Calculate probability
      let probability: number;
      if (propType === 'goalscorer') {
        probability = poissonAtLeastOne(finalLambda);
      } else {
        probability = poissonOver(finalLambda, line);
      }
      
      // Confidence (reduce if affected by injuries)
      let confidence = 0.3;
      if (ELITE_SCORERS.has(name)) confidence += 0.35;
      else if (baseLambda >= 0.35) confidence += 0.25;
      else if (baseLambda >= 0.20) confidence += 0.15;
      if (gamesPlayed >= 30) confidence += 0.15;
      if (injuryAdj.reason) confidence -= 0.1; // Less confident when linemate injured
      confidence = Math.max(0.2, Math.min(0.95, confidence));
      
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
        injuryNote: injuryAdj.reason || undefined,
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
    
    // Refresh injury cache and get injured names (MUST await - it's async now!)
    await refreshInjuryCache().catch(e => console.log('⚠️ Injury refresh error:', e.message));
    const injuredNames = await getInjuredPlayerNames();
    console.log(`🏥 ${injuredNames.size} injured players will be filtered out`);
    
    // Debug: log some injured names
    if (injuredNames.size > 0) {
      const sampleNames = Array.from(injuredNames).slice(0, 5);
      console.log(`🏥 Sample injured: ${sampleNames.join(', ')}`);
    } else {
      console.log('⚠️ WARNING: No injured players in cache - filter may not work!');
    }
    
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
        
        const homePreds = await processSkaterProps(
          homePlayers, homeAbbrev, getTeamName(game.homeTeam),
          awayAbbrev, getTeamName(game.awayTeam), gameTime, true,
          propType, bookOddsMap, injuredNames
        );
        
        const awayPreds = await processSkaterProps(
          awayPlayers, awayAbbrev, getTeamName(game.awayTeam),
          homeAbbrev, getTeamName(game.homeTeam), gameTime, false,
          propType, bookOddsMap, injuredNames
        );
        
        allPredictions.push(...homePreds, ...awayPreds);
      }
      
      // Sort by probability
      allPredictions.sort((a, b) => b.probability - a.probability);
      
      // Calculate edge when we have book odds
      // Edge = Model Probability - Book Implied Probability
      const predictionsWithEdge = allPredictions.map(p => {
        let edge = 0;
        let bookImpliedProb = 0;
        
        if (p.bookOdds?.over) {
          // Convert American odds to implied probability
          const odds = p.bookOdds.over;
          if (odds > 0) {
            bookImpliedProb = 100 / (odds + 100);
          } else {
            bookImpliedProb = Math.abs(odds) / (Math.abs(odds) + 100);
          }
          edge = p.probability - bookImpliedProb;
        }
        
        return {
          ...p,
          edge: Math.round(edge * 100) / 100, // e.g., 0.08 = 8% edge
          bookImpliedProb: Math.round(bookImpliedProb * 100) / 100,
        };
      });
      
      // Mark value bets: edge > 5% AND confidence > 50% AND has book odds
      const valueBets = predictionsWithEdge
        .filter(p => p.edge > 0.05 && p.confidence >= 0.50 && p.bookOdds)
        .sort((a, b) => b.edge - a.edge)
        .slice(0, 10)
        .map(p => ({ ...p, isValueBet: true }));
      
      // If no edge-based value bets, fall back to top picks by probability
      const topPicks = valueBets.length > 0 ? valueBets : predictionsWithEdge
        .filter(p => p.probability >= 0.20 && p.confidence >= 0.45)
        .slice(0, 10)
        .map(p => ({ ...p, isValueBet: true }));
      
      const topPickIds = new Set(topPicks.map(p => p.playerId));
      const markedPredictions = predictionsWithEdge.map(p => ({
        ...p,
        isValueBet: topPickIds.has(p.playerId),
      }));
      
      console.log(`📊 Generated ${allPredictions.length} ${propType} predictions`);
      console.log(`💰 Found ${valueBets.length} value bets with edge > 5%`);
      
      return NextResponse.json({
        predictions: markedPredictions,
        valueBets: topPicks,
        lastUpdated: new Date().toISOString(),
        gamesAnalyzed: todayGames.length,
        playersAnalyzed: allPredictions.length,
        gameDate,
        fetchTimeMs: Date.now() - startTime,
        oddsSource: valueBets.length > 0 ? 'live' : 'model-only',
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
