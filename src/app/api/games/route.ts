// src/app/api/games/route.ts
import { NextResponse } from 'next/server';
import { getGamePredictionAdjustments, refreshInjuryCache } from '@/lib/injury-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ============ GLOBALS ============

const ODDS_API_KEY = process.env.ODDS_API_KEY;

// In-memory cache
let oddsCache: { data: Map<string, any>; timestamp: number } | null = null;
let standingsCache: { data: any[]; timestamp: number } | null = null;

const ODDS_CACHE_TTL = 7200000; // 2 hours (for 500 credits/month)
const STANDINGS_CACHE_TTL = 300000; // 5 minutes

// ============ HELPERS ============

const TEAM_NAME_MAP: Record<string, string> = {
  'Anaheim Ducks': 'ANA', 'Boston Bruins': 'BOS', 'Buffalo Sabres': 'BUF',
  'Calgary Flames': 'CGY', 'Carolina Hurricanes': 'CAR', 'Chicago Blackhawks': 'CHI',
  'Colorado Avalanche': 'COL', 'Columbus Blue Jackets': 'CBJ', 'Dallas Stars': 'DAL',
  'Detroit Red Wings': 'DET', 'Edmonton Oilers': 'EDM', 'Florida Panthers': 'FLA',
  'Los Angeles Kings': 'LAK', 'Minnesota Wild': 'MIN', 'Montreal Canadiens': 'MTL',
  'Nashville Predators': 'NSH', 'New Jersey Devils': 'NJD', 'New York Islanders': 'NYI',
  'New York Rangers': 'NYR', 'Ottawa Senators': 'OTT', 'Philadelphia Flyers': 'PHI',
  'Pittsburgh Penguins': 'PIT', 'San Jose Sharks': 'SJS', 'Seattle Kraken': 'SEA',
  'St. Louis Blues': 'STL', 'St Louis Blues': 'STL', 'Tampa Bay Lightning': 'TBL',
  'Toronto Maple Leafs': 'TOR', 'Utah Hockey Club': 'UTA', 'Utah Mammoth': 'UTA',
  'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK', 'Washington Capitals': 'WSH',
  'Winnipeg Jets': 'WPG',
};

function getTeamAbbrev(fullName: string): string {
  return TEAM_NAME_MAP[fullName] || fullName.substring(0, 3).toUpperCase();
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

async function fetchWithTimeout(url: string, timeoutMs: number = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// ============ ODDS API ============

async function fetchOdds(): Promise<Map<string, any>> {
  // Check cache first
  if (oddsCache && Date.now() - oddsCache.timestamp < ODDS_CACHE_TTL) {
    console.log('✅ Using cached odds');
    return oddsCache.data;
  }
  
  const oddsMap = new Map();
  
  if (!ODDS_API_KEY) {
    console.log('⚠️ No ODDS_API_KEY');
    return oddsMap;
  }
  
  try {
    const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&bookmakers=draftkings,fanduel`;
    
    console.log('🔄 Fetching fresh odds...');
    const response = await fetchWithTimeout(url, 10000);
    
    if (!response.ok) {
      console.log(`❌ Odds API: ${response.status}`);
      return oddsCache?.data || oddsMap;
    }
    
    const data = await response.json();
    const remaining = response.headers.get('x-requests-remaining');
    console.log(`📊 Odds API: ${data.length} games, ${remaining} credits left`);
    
    for (const game of data) {
      const homeAbbrev = getTeamAbbrev(game.home_team);
      const awayAbbrev = getTeamAbbrev(game.away_team);
      const key = `${awayAbbrev}@${homeAbbrev}`;
      
      const dk = game.bookmakers?.find((b: any) => b.key === 'draftkings') || game.bookmakers?.[0];
      if (!dk) continue;
      
      const h2h = dk.markets?.find((m: any) => m.key === 'h2h');
      const spreads = dk.markets?.find((m: any) => m.key === 'spreads');
      const totals = dk.markets?.find((m: any) => m.key === 'totals');
      
      let homeML = 0, awayML = 0;
      if (h2h) {
        const homeOutcome = h2h.outcomes?.find((o: any) => o.name === game.home_team);
        const awayOutcome = h2h.outcomes?.find((o: any) => o.name === game.away_team);
        homeML = homeOutcome ? decimalToAmerican(homeOutcome.price) : 0;
        awayML = awayOutcome ? decimalToAmerican(awayOutcome.price) : 0;
      }
      
      let homeSpreadOdds = -110, awaySpreadOdds = -110;
      if (spreads) {
        const homeSpread = spreads.outcomes?.find((o: any) => o.name === game.home_team);
        const awaySpread = spreads.outcomes?.find((o: any) => o.name === game.away_team);
        homeSpreadOdds = homeSpread ? decimalToAmerican(homeSpread.price) : -110;
        awaySpreadOdds = awaySpread ? decimalToAmerican(awaySpread.price) : -110;
      }
      
      let totalLine = 6, overOdds = -110, underOdds = -110;
      if (totals) {
        const over = totals.outcomes?.find((o: any) => o.name === 'Over');
        const under = totals.outcomes?.find((o: any) => o.name === 'Under');
        totalLine = over?.point || 6;
        overOdds = over ? decimalToAmerican(over.price) : -110;
        underOdds = under ? decimalToAmerican(under.price) : -110;
      }
      
      oddsMap.set(key, {
        homeMoneyline: homeML,
        awayMoneyline: awayML,
        homeSpreadOdds,
        awaySpreadOdds,
        totalLine,
        overOdds,
        underOdds,
        bookmaker: dk.title || 'DraftKings',
      });
    }
    
    // Update cache
    oddsCache = { data: oddsMap, timestamp: Date.now() };
    console.log(`💾 Cached ${oddsMap.size} games odds`);
    
  } catch (error: any) {
    console.log(`❌ Odds fetch error: ${error.message}`);
    return oddsCache?.data || oddsMap;
  }
  
  return oddsMap;
}

// ============ STANDINGS / TEAM STATS ============

async function getStandings(): Promise<any[]> {
  if (standingsCache && Date.now() - standingsCache.timestamp < STANDINGS_CACHE_TTL) {
    return standingsCache.data;
  }
  
  try {
    const response = await fetchWithTimeout('https://api-web.nhle.com/v1/standings/now', 8000);
    if (!response.ok) return standingsCache?.data || [];
    
    const data = await response.json();
    const standings = data.standings || [];
    
    standingsCache = { data: standings, timestamp: Date.now() };
    return standings;
  } catch {
    return standingsCache?.data || [];
  }
}

function getTeamStats(standings: any[], teamAbbrev: string) {
  const team = standings.find((t: any) => t.teamAbbrev?.default === teamAbbrev);
  if (!team) return null;
  
  const gp = team.gamesPlayed || 1;
  return {
    teamAbbrev,
    gamesPlayed: gp,
    goalsForPerGame: (team.goalFor || 0) / gp,
    goalsAgainstPerGame: (team.goalAgainst || 0) / gp,
    pointsPct: (team.points || 0) / (gp * 2),
  };
}

// ============ PREDICTION MODEL ============

const HOME_ICE_BOOST = 0.045;
const B2B_PENALTY = 0.05;  // 5% base penalty for back-to-back

interface InjuryAdjustments {
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
  compoundingWarning: string;
}

// Track which teams played yesterday for B2B detection
let yesterdayGamesCache: { teams: Set<string>; date: string } | null = null;

async function getYesterdayTeams(gameWeek: any[]): Promise<Set<string>> {
  const now = new Date();
  const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  etDate.setDate(etDate.getDate() - 1);
  const yesterdayStr = etDate.toISOString().split('T')[0];
  
  if (yesterdayGamesCache?.date === yesterdayStr) {
    return yesterdayGamesCache.teams;
  }
  
  const teams = new Set<string>();
  for (const day of gameWeek) {
    if (day.date === yesterdayStr) {
      for (const game of day.games || []) {
        if (game.homeTeam?.abbrev) teams.add(game.homeTeam.abbrev);
        if (game.awayTeam?.abbrev) teams.add(game.awayTeam.abbrev);
      }
      break;
    }
  }
  
  yesterdayGamesCache = { teams, date: yesterdayStr };
  return teams;
}

function predictGame(
  homeStats: any, 
  awayStats: any, 
  injuryAdj: InjuryAdjustments | null,
  isHomeB2B: boolean,
  isAwayB2B: boolean
) {
  if (!homeStats || !awayStats) {
    return { homeWinProb: 0.5, predictedTotal: 5.5, confidence: 0.5, injuryImpact: null };
  }
  
  const homeGD = homeStats.goalsForPerGame - homeStats.goalsAgainstPerGame;
  const awayGD = awayStats.goalsForPerGame - awayStats.goalsAgainstPerGame;
  const gdAdvantage = homeGD - awayGD;
  
  let baseProb = 1 / (1 + Math.exp(-0.18 * gdAdvantage * 10));
  baseProb = 0.5 + (baseProb - 0.5) * 0.75;
  
  const ptsPctAdj = (homeStats.pointsPct - awayStats.pointsPct) * 0.15;
  
  let homeWinProb = baseProb + HOME_ICE_BOOST + ptsPctAdj;
  
  // Apply B2B penalties (before injuries, as they compound)
  if (isHomeB2B) homeWinProb -= B2B_PENALTY;
  if (isAwayB2B) homeWinProb += B2B_PENALTY;  // Away B2B helps home team
  
  // Apply injury adjustments
  let injuryImpact = null;
  if (injuryAdj) {
    // Net injury effect: home injuries hurt home, away injuries hurt away
    const netInjuryEffect = injuryAdj.homeWinProbAdjustment - injuryAdj.awayWinProbAdjustment;
    homeWinProb += netInjuryEffect;
    
    // Build detailed injury impact object
    injuryImpact = {
      homeStarsOut: injuryAdj.homeStarsOut,
      awayStarsOut: injuryAdj.awayStarsOut,
      homeAdjustment: Math.round(injuryAdj.homeWinProbAdjustment * 100),  // As percentage
      awayAdjustment: Math.round(injuryAdj.awayWinProbAdjustment * 100),
      homeSummary: injuryAdj.homeInjurySummary,
      awaySummary: injuryAdj.awayInjurySummary,
      homeGoalie: injuryAdj.homeGoalieSituation,
      awayGoalie: injuryAdj.awayGoalieSituation,
      compoundingWarning: injuryAdj.compoundingWarning || null,
      homePPImpact: Math.round(injuryAdj.homePPAdjustment * 100),
      awayPPImpact: Math.round(injuryAdj.awayPPAdjustment * 100),
    };
  }
  
  homeWinProb = Math.max(0.28, Math.min(0.72, homeWinProb));
  
  let predictedTotal = homeStats.goalsForPerGame + awayStats.goalsForPerGame;
  if (injuryAdj) {
    predictedTotal += injuryAdj.expectedTotalAdjustment;
  }
  
  // Confidence adjustments
  let confidence = 0.45;
  if (homeStats.gamesPlayed >= 20 && awayStats.gamesPlayed >= 20) confidence += 0.15;
  if (Math.abs(homeWinProb - 0.5) > 0.12) confidence += 0.1;
  // Reduce confidence if major injuries or compounding
  if (injuryAdj?.compoundingWarning) confidence -= 0.05;
  confidence = Math.max(0.30, Math.min(0.80, confidence));
  
  return { 
    homeWinProb, 
    predictedTotal, 
    confidence, 
    injuryImpact,
    isHomeB2B,
    isAwayB2B,
  };
}

// ============ MAIN HANDLER ============

export async function GET() {
  const startTime = Date.now();
  
  try {
    console.log('🏒 Games API started');
    
    // Refresh injury cache (will use cached if fresh)
    await refreshInjuryCache().catch(e => console.log('⚠️ Injury refresh error:', e.message));
    
    // Fetch schedule, standings, and odds in parallel
    const [schedRes, standings, oddsMap] = await Promise.all([
      fetchWithTimeout('https://api-web.nhle.com/v1/schedule/now', 8000).catch(() => null),
      getStandings(),
      fetchOdds(),
    ]);
    
    if (!schedRes?.ok) {
      return NextResponse.json({
        gamesByDate: {},
        dates: [],
        error: 'Schedule unavailable. Please refresh.',
      });
    }
    
    const schedData = await schedRes.json();
    const gameWeek = schedData.gameWeek || [];
    
    // Get today in ET
    const now = new Date();
    const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayStr = etDate.toISOString().split('T')[0];
    
    console.log(`📅 Today (ET): ${todayStr}, Schedule has ${gameWeek.length} days`);
    
    // Detect B2B: get teams that played yesterday
    const yesterdayTeams = await getYesterdayTeams(gameWeek);
    console.log(`📊 Teams on B2B: ${Array.from(yesterdayTeams).join(', ') || 'none'}`);
    
    const gamesByDate: Record<string, any[]> = {};
    const dates: string[] = [];
    
    for (const day of gameWeek) {
      const dateStr = day.date;
      if (!dateStr || dateStr < todayStr) continue;
      
      dates.push(dateStr);
      gamesByDate[dateStr] = [];
      
      // For future dates, we need to track B2B from previous day
      let teamsPlayedPrevDay = new Set<string>();
      if (dateStr === todayStr) {
        teamsPlayedPrevDay = yesterdayTeams;
      } else {
        // For future dates, check if they played the day before
        const prevDateIdx = gameWeek.findIndex((d: any) => d.date === dateStr) - 1;
        if (prevDateIdx >= 0) {
          for (const g of gameWeek[prevDateIdx]?.games || []) {
            if (g.homeTeam?.abbrev) teamsPlayedPrevDay.add(g.homeTeam.abbrev);
            if (g.awayTeam?.abbrev) teamsPlayedPrevDay.add(g.awayTeam.abbrev);
          }
        }
      }
      
      for (const game of day.games || []) {
        const homeAbbrev = game.homeTeam?.abbrev;
        const awayAbbrev = game.awayTeam?.abbrev;
        if (!homeAbbrev || !awayAbbrev) continue;
        
        const homeStats = getTeamStats(standings, homeAbbrev);
        const awayStats = getTeamStats(standings, awayAbbrev);
        
        // Detect back-to-back
        const isHomeB2B = teamsPlayedPrevDay.has(homeAbbrev);
        const isAwayB2B = teamsPlayedPrevDay.has(awayAbbrev);
        
        // Get injury adjustments (with B2B for compounding)
        const injuryAdj = await getGamePredictionAdjustments(
          homeAbbrev, 
          awayAbbrev, 
          isHomeB2B, 
          isAwayB2B
        );
        
        const pred = predictGame(homeStats, awayStats, injuryAdj, isHomeB2B, isAwayB2B);
        
        const oddsKey = `${awayAbbrev}@${homeAbbrev}`;
        const odds = oddsMap.get(oddsKey);
        
        const getTeamName = (team: any) => {
          if (team?.placeName?.default && team?.commonName?.default) {
            return `${team.placeName.default} ${team.commonName.default}`;
          }
          return team?.abbrev || 'Unknown';
        };
        
        gamesByDate[dateStr].push({
          id: `${game.id}`,
          homeTeam: {
            id: game.homeTeam?.id || 0,
            name: getTeamName(game.homeTeam),
            abbreviation: homeAbbrev,
            isB2B: isHomeB2B,
          },
          awayTeam: {
            id: game.awayTeam?.id || 0,
            name: getTeamName(game.awayTeam),
            abbreviation: awayAbbrev,
            isB2B: isAwayB2B,
          },
          startTime: game.startTimeUTC || '',
          status: game.gameState === 'LIVE' ? 'live' : game.gameState === 'FINAL' ? 'final' : 'scheduled',
          prediction: {
            homeWinProbability: pred.homeWinProb,
            awayWinProbability: 1 - pred.homeWinProb,
            predictedTotal: pred.predictedTotal,
            confidence: pred.confidence,
            injuryImpact: pred.injuryImpact,
            isHomeB2B: pred.isHomeB2B,
            isAwayB2B: pred.isAwayB2B,
          },
          odds: odds ? [{
            bookmaker: odds.bookmaker,
            homeMoneyline: odds.homeMoneyline,
            awayMoneyline: odds.awayMoneyline,
            homeSpread: -1.5,
            homeSpreadOdds: odds.homeSpreadOdds,
            awaySpreadOdds: odds.awaySpreadOdds,
            totalLine: odds.totalLine,
            overOdds: odds.overOdds,
            underOdds: odds.underOdds,
          }] : [],
        });
      }
    }
    
    const totalGames = Object.values(gamesByDate).reduce((sum, g) => sum + g.length, 0);
    console.log(`✅ Games API: ${totalGames} games in ${Date.now() - startTime}ms`);
    
    return NextResponse.json({
      gamesByDate,
      dates,
      lastUpdated: new Date().toISOString(),
      oddsSource: oddsMap.size > 0 ? 'live' : 'none',
      fetchTimeMs: Date.now() - startTime,
    });
    
  } catch (error: any) {
    console.error('❌ Games API error:', error);
    return NextResponse.json({
      gamesByDate: {},
      dates: [],
      error: 'Failed to fetch games. Please refresh.',
    });
  }
}
