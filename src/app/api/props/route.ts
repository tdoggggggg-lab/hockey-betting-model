import { NextResponse } from 'next/server';
import { classifyBet as classifyBetFromLib } from '@/lib/bet-classification';
import {
  predictMultiplePlayers,
  PredictionResult,
  MIN_GAMES_FOR_PREDICTION,
  PropType,
  QUALITY_THRESHOLDS,
  DEFAULT_LINES,
} from '@/lib/prediction-engine';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

// ============================================================
// MULTI-PROP NHL PREDICTION API
// ============================================================
// Supports: goalscorer, shots, assists, points
// Uses research-backed factors for each prop type
// ============================================================

// Helper function for delays
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Normalize player names for matching
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[.''-]/g, '')
    .replace(/\s+/g, ' ');
}

// Prop type display configuration
const PROP_CONFIG: Record<PropType, { label: string; lineLabel: string; statLabel: string }> = {
  goalscorer: { label: 'Anytime Goalscorer', lineLabel: 'Goals', statLabel: 'Exp. Goals' },
  shots: { label: 'Shots on Goal', lineLabel: 'SOG', statLabel: 'Exp. Shots' },
  assists: { label: 'Assists', lineLabel: 'Assists', statLabel: 'Exp. Assists' },
  points: { label: 'Points', lineLabel: 'Points', statLabel: 'Exp. Points' },
};

// ============ ESPN INJURIES (with status) ============

const ESPN_INJURIES_CACHE_MINUTES = 10;

interface InjuredPlayer {
  name: string;
  status: 'IR' | 'OUT' | 'LTIR' | 'DAY_TO_DAY' | 'SUSPENDED' | 'QUESTIONABLE';
}

let espnInjuriesCache: { data: Map<string, InjuredPlayer>; timestamp: number } | null = null;

async function fetchWithTimeout(url: string, timeout = 5000): Promise<Response | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

async function fetchESPNInjuries(): Promise<Map<string, InjuredPlayer>> {
  if (espnInjuriesCache && Date.now() - espnInjuriesCache.timestamp < ESPN_INJURIES_CACHE_MINUTES * 60 * 1000) {
    return espnInjuriesCache.data;
  }

  const injured = new Map<string, InjuredPlayer>();
  // ESPN team IDs - all 32 NHL teams
  // Note: Utah (129764), Seattle (124292), Vegas (37) have non-sequential IDs
  const espnTeamIds = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,25,26,27,28,29,30,37,124292,129764];
  
  try {
    const BATCH_SIZE = 5;
    for (let i = 0; i < espnTeamIds.length; i += BATCH_SIZE) {
      const batch = espnTeamIds.slice(i, i + BATCH_SIZE);
      
      const promises = batch.map(id =>
        fetchWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${id}/injuries`, 3000)
          .then(async (res) => res?.ok ? res.json().catch(() => null) : null)
          .catch(() => null)
      );
      
      const results = await Promise.all(promises);
      for (const data of results) {
        if (!data?.team?.injuries) continue;
        for (const injury of data.team.injuries) {
          const rawName = injury.athlete?.displayName || '';
          const name = normalizePlayerName(rawName);
          const statusRaw = (injury.status || '').toLowerCase();
          
          if (!name) continue;
          
          let status: InjuredPlayer['status'];
          if (statusRaw.includes('ir') && !statusRaw.includes('day')) {
            status = statusRaw.includes('lt') ? 'LTIR' : 'IR';
          } else if (statusRaw.includes('out')) {
            status = 'OUT';
          } else if (statusRaw.includes('day-to-day') || statusRaw.includes('dtd')) {
            status = 'DAY_TO_DAY';
          } else if (statusRaw.includes('suspend')) {
            status = 'SUSPENDED';
          } else if (statusRaw.includes('question')) {
            status = 'QUESTIONABLE';
          } else {
            status = 'OUT';
          }
          
          injured.set(name, { name: rawName, status });
        }
      }
      
      if (i + BATCH_SIZE < espnTeamIds.length) await delay(200);
    }
    
    espnInjuriesCache = { data: injured, timestamp: Date.now() };
    console.log(`[ESPN] Fetched ${injured.size} injuries`);
  } catch (e) {
    console.error('ESPN injuries error:', e);
  }
  return injured;
}

// ============ INJURY VALIDATION (IR overrides props) ============

async function getValidatedInjuries(playersWithProps: Set<string>): Promise<Set<string>> {
  const espnInjuries = await fetchESPNInjuries();
  const validatedOut = new Set<string>();
  
  for (const [playerName, injury] of espnInjuries) {
    const hasProps = playersWithProps.has(playerName);
    
    // IR/OUT/LTIR/SUSPENDED override props
    if (injury.status === 'IR' || injury.status === 'OUT' || injury.status === 'LTIR' || injury.status === 'SUSPENDED') {
      validatedOut.add(playerName);
      if (hasProps) {
        console.log(`[OVERRIDE] ${injury.name}: ${injury.status}`);
      }
      continue;
    }
    
    // DAY_TO_DAY: check props
    if (injury.status === 'DAY_TO_DAY' || injury.status === 'QUESTIONABLE') {
      if (!hasProps) {
        validatedOut.add(playerName);
      }
    }
  }
  
  return validatedOut;
}

// ============ ODDS API (cached - NO NEW CALLS since budget exhausted) ============

const ODDS_CACHE_MINUTES = 720; // 12 hours - keep cache longer since no new calls
let oddsCache: { data: Map<string, number>; timestamp: number } | null = null;

async function fetchBookOdds(): Promise<Map<string, number>> {
  // Return cached data if available (don't make new API calls - budget exhausted)
  if (oddsCache) {
    console.log('[Odds] Using cached data (API budget exhausted)');
    return oddsCache.data;
  }
  
  // If no cache exists, return empty (no API calls)
  console.log('[Odds] No cached data available, API budget exhausted');
  return new Map();
}

// ============ NHL API ============

async function fetchTodaysGames(): Promise<any[]> {
  try {
    const etDate = new Intl.DateTimeFormat('en-CA', { 
      timeZone: 'America/New_York', 
      year: 'numeric', month: '2-digit', day: '2-digit' 
    }).format(new Date());
    
    console.log(`[NHL] Fetching games for ${etDate}`);
    
    const res = await fetchWithTimeout(`https://api-web.nhle.com/v1/schedule/${etDate}`, 8000);
    if (!res?.ok) {
      console.log(`[NHL] Schedule fetch failed: ${res?.status}`);
      return [];
    }
    
    const data = await res.json();
    for (const day of data.gameWeek || []) {
      if (day.date === etDate && day.games?.length > 0) {
        console.log(`[NHL] Found ${day.games.length} games for ${etDate}`);
        return day.games;
      }
    }
    console.log(`[NHL] No games found for ${etDate}`);
    return [];
  } catch (e) {
    console.error('[NHL] Schedule error:', e);
    return [];
  }
}

async function fetchTeamRoster(teamAbbrev: string): Promise<any[]> {
  try {
    const res = await fetchWithTimeout(`https://api-web.nhle.com/v1/roster/${teamAbbrev}/current`, 5000);
    if (!res?.ok) {
      console.log(`[NHL] Roster fetch failed for ${teamAbbrev}: ${res?.status}`);
      return [];
    }
    const data = await res.json();
    const forwards = data.forwards || [];
    const defensemen = data.defensemen || [];
    console.log(`[NHL] ${teamAbbrev} roster: ${forwards.length} F, ${defensemen.length} D`);
    return [...forwards, ...defensemen];
  } catch (e) {
    console.error(`[NHL] Roster error for ${teamAbbrev}:`, e);
    return [];
  }
}

// ============ RESPONSE CACHE (per prop type) ============

const RESPONSE_CACHE_MINUTES = 2;
const responseCache = new Map<PropType, { data: any; timestamp: number }>();

// ============ MAIN HANDLER ============

export async function GET(request: Request) {
  const startTime = Date.now();
  
  const { searchParams } = new URL(request.url);
  
  // Handle goalie props separately (coming soon)
  if (searchParams.get('type') === 'goalie') {
    return NextResponse.json({ predictions: [], message: 'Goalie props coming soon' });
  }
  
  // Get prop type from query params (default: goalscorer)
  const propTypeParam = searchParams.get('propType') || searchParams.get('type') || 'goalscorer';
  const propType: PropType = ['goalscorer', 'shots', 'assists', 'points'].includes(propTypeParam) 
    ? propTypeParam as PropType 
    : 'goalscorer';
  
  console.log(`[Props] Request for propType: ${propType}`);
  
  // Return cached response if fresh
  const cached = responseCache.get(propType);
  if (cached && Date.now() - cached.timestamp < RESPONSE_CACHE_MINUTES * 60 * 1000) {
    console.log(`[Props] Returning cached response for ${propType}`);
    return NextResponse.json(cached.data);
  }
  
  try {
    // 1. Fetch games
    const games = await fetchTodaysGames();
    if (games.length === 0) {
      return NextResponse.json({
        predictions: [], games: [], gamesAnalyzed: 0, playersAnalyzed: 0,
        propType,
        modelVersion: 'v3-multi-prop',
      });
    }

    // 2. Build team info
    const teamInfoMap = new Map<string, { 
      teamName: string; 
      opponent: string; 
      opponentAbbrev: string; 
      gameTime: string; 
      isHome: boolean 
    }>();
    const teamAbbrevs = new Set<string>();
    const gamesList: any[] = [];
    
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
    
    console.log(`[Props] ${teamAbbrevs.size} teams: ${Array.from(teamAbbrevs).join(', ')}`);
    
    // 3. Fetch rosters for ALL teams
    const rosterPromises = Array.from(teamAbbrevs).map(abbrev => 
      fetchTeamRoster(abbrev).then(roster => ({ abbrev, roster }))
    );
    const rosterResults = await Promise.all(rosterPromises);
    const rosterMap = new Map(rosterResults.map(r => [r.abbrev, r.roster]));
    
    // Log roster counts per team
    for (const [abbrev, roster] of rosterMap) {
      console.log(`[Props] ${abbrev}: ${roster.length} players on roster`);
    }
    
    // 4. Fetch cached odds and validate injuries
    const bookOdds = await fetchBookOdds();
    const playersWithProps = new Set(bookOdds.keys());
    const injuredPlayers = await getValidatedInjuries(playersWithProps);
    
    console.log(`[Props] ${injuredPlayers.size} players filtered as injured`);
    
    // 5. Build player list for prediction
    const playersForPrediction: Array<{
      playerId: number;
      playerName: string;
      teamAbbrev: string;
      position: string;
      opponentAbbrev: string;
      isHome: boolean;
    }> = [];
    
    const filteredPlayerNames: string[] = [];
    
    for (const [abbrev, roster] of rosterMap) {
      const info = teamInfoMap.get(abbrev);
      if (!info) {
        console.log(`[Props] WARNING: No game info for ${abbrev}`);
        continue;
      }
      
      for (const player of roster) {
        const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
        const normalizedName = normalizePlayerName(name);
        
        // Check injury
        if (injuredPlayers.has(normalizedName)) {
          filteredPlayerNames.push(name);
          continue;
        }
        
        playersForPrediction.push({
          playerId: player.id,
          playerName: name,
          teamAbbrev: abbrev,
          position: player.positionCode || 'F',
          opponentAbbrev: info.opponentAbbrev,
          isHome: info.isHome,
        });
      }
    }
    
    console.log(`[Props] ${playersForPrediction.length} players to predict for ${propType}`);
    
    // Log player counts by team
    const playersByTeam = new Map<string, number>();
    for (const p of playersForPrediction) {
      playersByTeam.set(p.teamAbbrev, (playersByTeam.get(p.teamAbbrev) || 0) + 1);
    }
    for (const [team, count] of playersByTeam) {
      console.log(`[Props] ${team}: ${count} players for prediction`);
    }
    
    // 6. Run predictions with the specified prop type
    const predictionResults = await predictMultiplePlayers(playersForPrediction, propType);
    
    console.log(`[Props] Got ${predictionResults.length} predictions for ${propType}`);
    
    // Log prediction counts by team
    const predsByTeam = new Map<string, number>();
    for (const p of predictionResults) {
      predsByTeam.set(p.teamAbbrev, (predsByTeam.get(p.teamAbbrev) || 0) + 1);
    }
    for (const [team, count] of predsByTeam) {
      console.log(`[Props] ${team}: ${count} predictions`);
    }
    
    // 7. Get configuration for this prop type
    const config = PROP_CONFIG[propType];
    const defaultLine = DEFAULT_LINES[propType];
    const qualityThreshold = QUALITY_THRESHOLDS[propType];
    
    // 8. Build final predictions with bet classification
    const predictions = predictionResults
      .filter(p => p.expectedValue >= qualityThreshold)  // Quality filter per prop type
      .map(p => {
        const info = teamInfoMap.get(p.teamAbbrev);
        const normalizedName = normalizePlayerName(p.playerName);
        const bookOddsValue = bookOdds.get(normalizedName) || null;
        
        const betAnalysis = classifyBetFromLib(
          p.probability,
          bookOddsValue,
          defaultLine,
          propType,
          p.confidence,
          p.gamesPlayed
        );
        
        return {
          playerId: p.playerId,
          playerName: p.playerName,
          team: info?.teamName || p.teamAbbrev,
          teamAbbrev: p.teamAbbrev,
          opponent: info?.opponent || p.opponent,
          opponentAbbrev: p.opponent,
          gameTime: info?.gameTime || '',
          isHome: playersForPrediction.find(pl => pl.playerId === p.playerId)?.isHome || false,
          propType,
          expectedValue: p.expectedValue,
          // Include all expected values for reference
          expectedGoals: p.expectedGoals,
          expectedShots: p.expectedShots,
          expectedAssists: p.expectedAssists,
          expectedPoints: p.expectedPoints,
          probability: p.probability,
          line: defaultLine,
          confidence: p.confidence,
          gamesPlayed: p.gamesPlayed,
          betClassification: betAnalysis.classification,
          edge: betAnalysis.edge,
          edgePercent: betAnalysis.edgePercent,
          bookOdds: bookOddsValue,
          bookLine: `${defaultLine} ${config.lineLabel}`,  // FIXED: Correct label per prop type
          fairOdds: betAnalysis.fairOdds,
          expectedProfit: betAnalysis.expectedValue,
          kellyFraction: betAnalysis.kellyFraction,
          reasons: [...p.reasoning, ...betAnalysis.reasons],
          factors: p.factors,
          breakdown: {
            basePrediction: p.factors.baseGoalsPerGame,
            homeAwayAdj: p.factors.homeAwayAdjustment,
            goalieAdj: p.factors.goalieAdjustment,
            defenseAdj: p.factors.defenseAdjustment,
            ppBoost: p.factors.ppBoost,
            recentFormAdj: p.factors.recentFormMultiplier,
            finalPrediction: p.expectedValue
          }
        };
      })
      .sort((a, b) => b.probability - a.probability);  // Sort by probability
    
    // 9. Categorize bets
    const bestBets = predictions.filter(p => p.betClassification === 'best_bet');
    const strongValueBets = predictions.filter(p => p.betClassification === 'strong_value');
    const valueBets = predictions.filter(p => p.betClassification === 'value');
    const leanBets = predictions.filter(p => p.betClassification === 'lean');
    const allActionableBets = predictions.filter(p => p.betClassification !== 'none');
    
    console.log(`[Props] ${propType} done in ${Date.now() - startTime}ms: ${predictions.length} predictions`);
    
    const response = {
      predictions,
      bestBets,
      strongValueBets,
      valueBets: allActionableBets,
      leanBets,
      allActionableBets,
      games: gamesList,
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: games.length,
      playersAnalyzed: predictions.length,
      injuredPlayersFiltered: filteredPlayerNames.length,
      filteredPlayerNames,
      propType,
      propConfig: config,
      modelVersion: 'v3-multi-prop',
      modelFactors: [
        'Shot volume (recent vs season)',
        'Power play time',
        'Opposing goalie save %',
        'Home/away',
        'Opponent defense (GA/game)',
        'Recent form (L5 games)'
      ],
      injurySource: '2-source validation (ESPN IR overrides props)',
      betSummary: {
        bestBet: bestBets.length,
        strongValue: strongValueBets.length,
        value: valueBets.length,
        lean: leanBets.length,
        total: allActionableBets.length,
      },
      // Debug info
      debug: {
        teamsInGames: Array.from(teamAbbrevs),
        playersPerTeam: Object.fromEntries(playersByTeam),
        predictionsPerTeam: Object.fromEntries(predsByTeam),
      }
    };
    
    // Cache the response
    responseCache.set(propType, { data: response, timestamp: Date.now() });
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('Props API error:', error);
    return NextResponse.json({
      predictions: [], 
      games: [], 
      error: 'Failed to generate predictions',
      propType,
      modelVersion: 'v3-multi-prop',
    }, { status: 500 });
  }
}
