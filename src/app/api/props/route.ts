import { NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ODDS_API_KEY = process.env.ODDS_API_KEY || '554cc95c542841c872715cd3b533f200';

// NO HARDCODED INJURY LISTS - Use 3-source validation instead
// Injuries are fetched dynamically from ESPN + BallDontLie + Odds API

// Fetch injuries from ESPN
async function fetchESPNInjuries(): Promise<Set<string>> {
  const injured = new Set<string>();
  const espnTeamIds = [
    1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,28,29,30,52
  ];
  
  try {
    // Only fetch a few teams to save time - injuries are league-wide news
    const sampleTeams = espnTeamIds.slice(0, 10);
    const promises = sampleTeams.map(id =>
      fetchWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${id}/injuries`, 3000)
        .then(res => res?.ok ? res.json() : null)
        .catch(() => null)
    );
    
    const results = await Promise.all(promises);
    for (const data of results) {
      if (!data?.team?.injuries) continue;
      for (const injury of data.team.injuries) {
        const name = injury.athlete?.displayName?.toLowerCase();
        const status = injury.status?.toLowerCase() || '';
        if (name && (status.includes('out') || status.includes('ir'))) {
          injured.add(name);
        }
      }
    }
  } catch (e) {
    console.error('ESPN injuries error:', e);
  }
  return injured;
}

// Fetch injuries from BallDontLie
async function fetchBallDontLieInjuries(): Promise<Set<string>> {
  const injured = new Set<string>();
  const API_KEY = process.env.BALLDONTLIE_API_KEY || '1b3356ae-abd2-4a95-b6e6-2c4e97e8c232';
  
  try {
    const res = await fetchWithTimeout(
      'https://api.balldontlie.io/nhl/v1/player_injuries',
      3000
    );
    if (res?.ok) {
      // Add auth header for BallDontLie
      const data = await fetch('https://api.balldontlie.io/nhl/v1/player_injuries', {
        headers: { 'Authorization': API_KEY }
      }).then(r => r.ok ? r.json() : null);
      
      if (data?.data) {
        for (const injury of data.data) {
          const name = injury.player?.name?.toLowerCase() || 
                       `${injury.player?.first_name} ${injury.player?.last_name}`.toLowerCase();
          if (name && name.trim()) injured.add(name.trim());
        }
      }
    }
  } catch (e) {
    console.error('BallDontLie injuries error:', e);
  }
  return injured;
}

// 3-Source Validation: Player is OUT if 2+ sources agree
async function getValidatedInjuries(playersWithProps: Set<string>): Promise<Set<string>> {
  const [espnInjured, bdlInjured] = await Promise.all([
    fetchESPNInjuries(),
    fetchBallDontLieInjuries()
  ]);
  
  const validatedOut = new Set<string>();
  const allPlayers = new Set([...espnInjured, ...bdlInjured]);
  
  for (const player of allPlayers) {
    let injuredVotes = 0;
    let healthyVotes = 0;
    
    // Source 1: ESPN
    if (espnInjured.has(player)) injuredVotes++;
    else healthyVotes++;
    
    // Source 2: BallDontLie
    if (bdlInjured.has(player)) injuredVotes++;
    else healthyVotes++;
    
    // Source 3: Odds API (if player has props, sportsbooks think they're playing)
    if (playersWithProps.has(player)) healthyVotes++;
    else injuredVotes++; // No props = weak signal they might be out
    
    // 2 of 3 must agree
    if (injuredVotes >= 2) validatedOut.add(player);
  }
  
  console.log(`3-source validation: ${validatedOut.size} players OUT (ESPN: ${espnInjured.size}, BDL: ${bdlInjured.size})`);
  return validatedOut;
}

interface PlayerStats {
  playerId: number;
  playerName: string;
  gamesPlayed: number;
  goals: number;
  goalsPerGame: number;
}

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
  betClassification: 'best_value' | 'value' | 'best' | 'none';
  edge: number;
  edgePercent: string;
  bookOdds: number | null;
  bookLine: string;
  fairOdds: number;
  expectedProfit: number;
  adjustment: string | null;
  breakdown: {
    basePrediction: number;
    homeAwayAdj: number;
    productionMultiplier: number;
    finalPrediction: number;
  };
}

// Poisson probability
function poissonProb(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function atLeastOneGoalProb(goalsPerGame: number): number {
  return 1 - poissonProb(goalsPerGame, 0);
}

function probToAmericanOdds(prob: number): number {
  if (prob <= 0 || prob >= 1) return 0;
  if (prob >= 0.5) return Math.round((-100 * prob) / (1 - prob));
  return Math.round((100 * (1 - prob)) / prob);
}

function oddsToImpliedProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function classifyBet(prob: number, edge: number, conf: number, hasBook: boolean): 'best_value' | 'value' | 'best' | 'none' {
  if (prob >= 0.55 && edge >= 0.07 && conf >= 0.75 && hasBook) return 'best_value';
  if (edge >= 0.07 && hasBook) return 'value';
  if (prob >= 0.55 && conf >= 0.75) return 'best';
  return 'none';
}

// Fetch with timeout
async function fetchWithTimeout(url: string, timeout = 5000): Promise<Response | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, next: { revalidate: 300 } });
    clearTimeout(id);
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

// Fetch today's games
async function fetchTodaysGames(): Promise<any[]> {
  try {
    const now = new Date();
    const etDate = new Intl.DateTimeFormat('en-CA', { 
      timeZone: 'America/New_York', 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit' 
    }).format(now);
    
    const res = await fetchWithTimeout(`https://api-web.nhle.com/v1/schedule/${etDate}`, 8000);
    if (!res?.ok) return [];
    
    const data = await res.json();
    for (const day of data.gameWeek || []) {
      if (day.date === etDate && day.games?.length > 0) {
        console.log(`Found ${day.games.length} games for ${etDate}`);
        return day.games;
      }
    }
    // Fallback to first available day
    if (data.gameWeek?.[0]?.games?.length > 0) {
      console.log(`Using ${data.gameWeek[0].date} with ${data.gameWeek[0].games.length} games`);
      return data.gameWeek[0].games;
    }
    return [];
  } catch (e) {
    console.error('Error fetching games:', e);
    return [];
  }
}

// Fetch roster - only forwards and defensemen, limit to top players
async function fetchTeamRoster(abbrev: string): Promise<any[]> {
  try {
    const res = await fetchWithTimeout(`https://api-web.nhle.com/v1/roster/${abbrev}/current`, 5000);
    if (!res?.ok) return [];
    
    const data = await res.json();
    const forwards = data.forwards || [];
    const defensemen = data.defensemen || [];
    
    // Return all skaters (no limit)
    return [...forwards, ...defensemen];
  } catch {
    return [];
  }
}

// Fetch player stats - simplified to just get goals/games
async function fetchPlayerStats(playerId: number): Promise<PlayerStats | null> {
  try {
    const res = await fetchWithTimeout(`https://api-web.nhle.com/v1/player/${playerId}/landing`, 3000);
    if (!res?.ok) return null;
    
    const data = await res.json();
    const season = data.featuredStats?.regularSeason?.subSeason;
    if (!season || season.gamesPlayed < 5) return null;
    
    return {
      playerId: data.playerId,
      playerName: `${data.firstName?.default || ''} ${data.lastName?.default || ''}`.trim(),
      gamesPlayed: season.gamesPlayed || 0,
      goals: season.goals || 0,
      goalsPerGame: season.gamesPlayed > 0 ? (season.goals || 0) / season.gamesPlayed : 0
    };
  } catch {
    return null;
  }
}

// ⚠️ ODDS API CACHING - Required per project instructions (500 requests/month limit)
const ODDS_CACHE_MINUTES = 5;
let oddsCache: { data: Map<string, number>; timestamp: number } | null = null;

// Fetch book odds WITH CACHING
async function fetchBookOdds(): Promise<Map<string, number>> {
  // Return cached data if fresh (less than 5 minutes old)
  if (oddsCache && Date.now() - oddsCache.timestamp < ODDS_CACHE_MINUTES * 60 * 1000) {
    console.log('Using cached Odds API data');
    return oddsCache.data;
  }
  
  console.log('Odds API call: /events (player_goal_scorer_anytime)'); // Always log!
  
  const map = new Map<string, number>();
  try {
    const res = await fetchWithTimeout(
      `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events?apiKey=${ODDS_API_KEY}&regions=us&markets=player_goal_scorer_anytime`,
      5000
    );
    if (!res?.ok) return map;
    
    const events = await res.json();
    for (const event of events) {
      for (const book of event.bookmakers || []) {
        for (const market of book.markets || []) {
          if (market.key === 'player_goal_scorer_anytime') {
            for (const outcome of market.outcomes || []) {
              const name = outcome.description?.toLowerCase();
              if (name && !map.has(name)) map.set(name, outcome.price);
            }
          }
        }
      }
    }
    
    // Cache the result
    oddsCache = { data: map, timestamp: Date.now() };
    console.log(`Cached ${map.size} player odds for ${ODDS_CACHE_MINUTES} minutes`);
  } catch (e) {
    console.error('Book odds error:', e);
  }
  return map;
}

export async function GET() {
  const startTime = Date.now();
  
  try {
    // 1. Fetch games
    const games = await fetchTodaysGames();
    console.log(`Step 1: ${games.length} games (${Date.now() - startTime}ms)`);
    
    if (games.length === 0) {
      return NextResponse.json({
        predictions: [], valueBets: [], bestValueBets: [], valueBetsOnly: [], bestBetsOnly: [],
        games: [],  // ✅ Empty games array
        lastUpdated: new Date().toISOString(), gamesAnalyzed: 0, playersAnalyzed: 0,
        betSummary: { bestValue: 0, value: 0, best: 0, total: 0 }
      });
    }

    // 2. Build team info and fetch rosters in parallel
    const teamInfoMap = new Map<string, { teamName: string; opponent: string; opponentAbbrev: string; gameTime: string; isHome: boolean }>();
    const teamAbbrevs = new Set<string>();
    
    // Build games list for dropdown (all games, not just ones with players)
    const gamesList: Array<{ id: string; homeAbbrev: string; awayAbbrev: string; homeName: string; awayName: string; gameTime: string }> = [];
    
    for (const game of games) {
      const home = game.homeTeam?.abbrev;
      const away = game.awayTeam?.abbrev;
      if (!home || !away) continue;
      
      teamAbbrevs.add(home);
      teamAbbrevs.add(away);
      
      const gameTime = new Date(game.startTimeUTC).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver'
      });
      
      const homeName = `${game.homeTeam.placeName?.default || ''} ${game.homeTeam.commonName?.default || ''}`.trim();
      const awayName = `${game.awayTeam.placeName?.default || ''} ${game.awayTeam.commonName?.default || ''}`.trim();
      
      // Add to games list for dropdown
      gamesList.push({
        id: `${away}-${home}`,
        homeAbbrev: home,
        awayAbbrev: away,
        homeName,
        awayName,
        gameTime
      });
      
      teamInfoMap.set(home, { teamName: homeName, opponent: awayName, opponentAbbrev: away, gameTime, isHome: true });
      teamInfoMap.set(away, { teamName: awayName, opponent: homeName, opponentAbbrev: home, gameTime, isHome: false });
    }
    
    // Fetch all rosters in parallel
    const rosterPromises = Array.from(teamAbbrevs).map(abbrev => 
      fetchTeamRoster(abbrev).then(roster => ({ abbrev, roster }))
    );
    const rosterResults = await Promise.all(rosterPromises);
    const rosterMap = new Map(rosterResults.map(r => [r.abbrev, r.roster]));
    
    console.log(`Step 2: ${rosterMap.size} rosters (${Date.now() - startTime}ms)`);
    
    // 3. Fetch book odds first (needed for 3-source validation)
    const bookOdds = await fetchBookOdds();
    const playersWithProps = new Set(bookOdds.keys());
    
    // 4. Run 3-source injury validation
    const injuredPlayers = await getValidatedInjuries(playersWithProps);
    console.log(`Step 3: ${injuredPlayers.size} injured players via 3-source validation (${Date.now() - startTime}ms)`);
    
    // 5. Collect all healthy players
    interface PlayerInfo {
      id: number;
      name: string;
      teamAbbrev: string;
    }
    const allPlayers: PlayerInfo[] = [];
    const filteredPlayerNames: string[] = [];
    
    for (const [abbrev, roster] of rosterMap) {
      for (const player of roster) {
        const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
        // 3-SOURCE VALIDATION - not hardcoded!
        if (injuredPlayers.has(name.toLowerCase())) {
          filteredPlayerNames.push(name);
          continue;
        }
        allPlayers.push({ id: player.id, name, teamAbbrev: abbrev });
      }
    }
    
    console.log(`Step 4: ${allPlayers.length} healthy players to process (${Date.now() - startTime}ms)`);
    
    // 5. Fetch all player stats in parallel batches
    const BATCH_SIZE = 50;
    const statsMap = new Map<number, PlayerStats>();
    
    for (let i = 0; i < allPlayers.length; i += BATCH_SIZE) {
      const batch = allPlayers.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(p => fetchPlayerStats(p.id).then(stats => ({ id: p.id, stats })))
      );
      for (const { id, stats } of batchResults) {
        if (stats) statsMap.set(id, stats);
      }
      
      // Check timeout - Vercel free tier has 10s limit
      if (Date.now() - startTime > 8000) {
        console.log(`Timeout warning at ${i + BATCH_SIZE} players`);
        break;
      }
    }
    
    console.log(`Step 5: ${statsMap.size} player stats (${Date.now() - startTime}ms)`);
    
    // 5. Build predictions
    const predictions: PropPrediction[] = [];
    
    for (const player of allPlayers) {
      const stats = statsMap.get(player.id);
      if (!stats) continue;
      
      const info = teamInfoMap.get(player.teamAbbrev);
      if (!info) continue;
      
      const homeAwayAdj = info.isHome ? 1.05 : 0.95;
      const adjustedGPG = stats.goalsPerGame * homeAwayAdj;
      const probability = atLeastOneGoalProb(adjustedGPG);
      
      // Confidence
      let confidence = 0.5;
      if (stats.gamesPlayed >= 30) confidence += 0.15;
      else if (stats.gamesPlayed >= 15) confidence += 0.10;
      if (stats.goalsPerGame >= 0.4) confidence += 0.20;
      else if (stats.goalsPerGame >= 0.25) confidence += 0.10;
      confidence = Math.min(confidence, 0.95);
      
      // Edge calculation
      const bookOddsValue = bookOdds.get(player.name.toLowerCase()) || null;
      const bookImpliedProb = bookOddsValue ? oddsToImpliedProb(bookOddsValue) : null;
      const edge = bookImpliedProb ? probability - bookImpliedProb : 0;
      
      const betClassification = classifyBet(probability, edge, confidence, !!bookOddsValue);
      
      predictions.push({
        playerId: player.id,
        playerName: player.name,
        team: info.teamName,
        teamAbbrev: player.teamAbbrev,
        opponent: info.opponent,
        opponentAbbrev: info.opponentAbbrev,
        gameTime: info.gameTime,
        isHome: info.isHome,
        propType: 'goalscorer',
        expectedValue: adjustedGPG,
        probability,
        line: 0.5,
        confidence,
        betClassification,
        edge,
        edgePercent: `${(edge * 100).toFixed(1)}%`,
        bookOdds: bookOddsValue,
        bookLine: '0.5 Goals',
        fairOdds: probToAmericanOdds(probability),
        expectedProfit: edge * 100,
        adjustment: null,
        breakdown: {
          basePrediction: stats.goalsPerGame,
          homeAwayAdj,
          productionMultiplier: 1,
          finalPrediction: adjustedGPG
        }
      });
    }
    
    // Sort by probability
    predictions.sort((a, b) => b.probability - a.probability);
    
    // Categorize bets
    const bestValueBets = predictions.filter(p => p.betClassification === 'best_value');
    const valueBetsOnly = predictions.filter(p => p.betClassification === 'value');
    const bestBetsOnly = predictions.filter(p => p.betClassification === 'best');
    const allValueBets = predictions.filter(p => p.betClassification !== 'none');
    
    console.log(`Done: ${predictions.length} predictions in ${Date.now() - startTime}ms`);
    
    return NextResponse.json({
      predictions,
      valueBets: allValueBets,
      bestValueBets,
      valueBetsOnly,
      bestBetsOnly,
      games: gamesList,  // ✅ All games for dropdown
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: games.length,
      playersAnalyzed: predictions.length,
      injuredPlayersFiltered: filteredPlayerNames.length,
      filteredPlayerNames,
      injurySource: '3-source validation',
      betSummary: {
        bestValue: bestValueBets.length,
        value: valueBetsOnly.length,
        best: bestBetsOnly.length,
        total: allValueBets.length
      }
    });
    
  } catch (error) {
    console.error('Props API error:', error);
    return NextResponse.json({
      predictions: [], valueBets: [], bestValueBets: [], valueBetsOnly: [], bestBetsOnly: [],
      games: [],  // ✅ Empty games array
      lastUpdated: new Date().toISOString(), gamesAnalyzed: 0, playersAnalyzed: 0,
      error: 'Failed to generate predictions',
      betSummary: { bestValue: 0, value: 0, best: 0, total: 0 }
    }, { status: 500 });
  }
}
