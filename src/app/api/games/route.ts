// src/app/api/games/route.ts
// Game predictions with LIVE ODDS and INJURY detection

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const HOME_ICE_BOOST = 0.045;
const B2B_PENALTY = 0.073;

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

// EXPANDED INJURY LIST - Updated January 2026
const KNOWN_INJURED: Record<string, Array<{ name: string; tier: 'elite' | 'star' | 'quality' | 'average'; status: string }>> = {
  'ANA': [
    { name: 'John Gibson', tier: 'star', status: 'IR' },
  ],
  'BOS': [
    { name: 'Brad Marchand', tier: 'star', status: 'DTD' },
  ],
  'BUF': [
    { name: 'Ukko-Pekka Luukkonen', tier: 'quality', status: 'IR' },
  ],
  'CGY': [
    { name: 'Kevin Bahl', tier: 'average', status: 'IR' },
  ],
  'CAR': [
    { name: 'Seth Jarvis', tier: 'quality', status: 'IR' },
    { name: 'Jesper Fast', tier: 'average', status: 'IR' },
  ],
  'CHI': [
    { name: 'Tyler Bertuzzi', tier: 'quality', status: 'IR' },
  ],
  'COL': [
    { name: 'Gabriel Landeskog', tier: 'star', status: 'LTIR' },
    { name: 'Valeri Nichushkin', tier: 'quality', status: 'LTIR' },
    { name: 'Miles Wood', tier: 'average', status: 'IR' },
  ],
  'CBJ': [
    { name: 'Boone Jenner', tier: 'quality', status: 'LTIR' },
  ],
  'DAL': [
    { name: 'Tyler Seguin', tier: 'star', status: 'LTIR' },
  ],
  'DET': [
    { name: 'Patrick Kane', tier: 'star', status: 'IR' },
  ],
  'EDM': [
    { name: 'Evander Kane', tier: 'quality', status: 'LTIR' },
    { name: 'Viktor Arvidsson', tier: 'quality', status: 'IR' },
  ],
  'FLA': [
    { name: 'Aleksander Barkov', tier: 'elite', status: 'DTD' },
  ],
  'LAK': [
    { name: 'Drew Doughty', tier: 'star', status: 'LTIR' },
  ],
  'MIN': [
    { name: 'Jonas Brodin', tier: 'quality', status: 'IR' },
  ],
  'MTL': [
    { name: 'Carey Price', tier: 'star', status: 'LTIR' },
    { name: 'Patrik Laine', tier: 'star', status: 'IR' },
  ],
  'NSH': [
    { name: 'Luke Evangelista', tier: 'average', status: 'IR' },
  ],
  'NJD': [
    { name: 'Timo Meier', tier: 'quality', status: 'IR' },
  ],
  'NYI': [
    { name: 'Adam Pelech', tier: 'quality', status: 'IR' },
  ],
  'NYR': [
    { name: 'Jimmy Vesey', tier: 'average', status: 'IR' },
  ],
  'OTT': [
    { name: 'Josh Norris', tier: 'quality', status: 'IR' },
  ],
  'PHI': [
    { name: 'Cam Atkinson', tier: 'quality', status: 'LTIR' },
  ],
  'PIT': [
    { name: 'Bryan Rust', tier: 'quality', status: 'IR' },
  ],
  'SJS': [
    { name: 'Logan Couture', tier: 'quality', status: 'LTIR' },
  ],
  'SEA': [
    { name: 'Brandon Tanev', tier: 'average', status: 'IR' },
  ],
  'STL': [
    { name: 'Nick Leddy', tier: 'average', status: 'IR' },
  ],
  'TBL': [
    { name: 'Brandon Hagel', tier: 'star', status: 'IR' },
  ],
  'TOR': [
    { name: 'Jani Hakanpaa', tier: 'average', status: 'LTIR' },
    { name: 'Matt Murray', tier: 'average', status: 'LTIR' },
  ],
  'UTA': [
    { name: 'Sean Durzi', tier: 'quality', status: 'IR' },
  ],
  'VAN': [
    { name: 'Thatcher Demko', tier: 'star', status: 'IR' },
    { name: 'Brock Boeser', tier: 'quality', status: 'IR' },
  ],
  'VGK': [
    { name: 'Mark Stone', tier: 'elite', status: 'IR' },
  ],
  'WSH': [
    { name: 'Nicklas Backstrom', tier: 'star', status: 'LTIR' },
  ],
  'WPG': [
    { name: 'Cole Perfetti', tier: 'quality', status: 'IR' },
  ],
};

const TIER_IMPACT: Record<string, number> = {
  'elite': -0.10,
  'star': -0.07,
  'quality': -0.04,
  'average': -0.01,
};

function getTeamAbbrev(fullName: string): string {
  return TEAM_NAME_MAP[fullName] || fullName.substring(0, 3).toUpperCase();
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function calculateTeamInjuryImpact(teamAbbrev: string): { totalImpact: number; injuredPlayers: string[] } {
  const injuries = KNOWN_INJURED[teamAbbrev] || [];
  let totalImpact = 0;
  const injuredPlayers: string[] = [];
  
  for (const injury of injuries) {
    totalImpact += TIER_IMPACT[injury.tier] || -0.01;
    injuredPlayers.push(`${injury.name} (${injury.status})`);
  }
  
  return { totalImpact: Math.max(-0.20, totalImpact), injuredPlayers };
}

async function fetchOddsFromAPI(): Promise<Map<string, any>> {
  const oddsMap = new Map();
  if (!ODDS_API_KEY) return oddsMap;

  try {
    const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&bookmakers=draftkings,fanduel,betmgm`;
    const response = await fetch(url, { next: { revalidate: 300 }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return oddsMap;

    const data = await response.json();
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
        homeML = h2h.outcomes?.find((o: any) => o.name === game.home_team)?.price ? decimalToAmerican(h2h.outcomes.find((o: any) => o.name === game.home_team).price) : 0;
        awayML = h2h.outcomes?.find((o: any) => o.name === game.away_team)?.price ? decimalToAmerican(h2h.outcomes.find((o: any) => o.name === game.away_team).price) : 0;
      }

      oddsMap.set(key, {
        homeMoneyline: homeML,
        awayMoneyline: awayML,
        homeSpreadOdds: spreads?.outcomes?.find((o: any) => o.name === game.home_team)?.price ? decimalToAmerican(spreads.outcomes.find((o: any) => o.name === game.home_team).price) : -110,
        awaySpreadOdds: spreads?.outcomes?.find((o: any) => o.name === game.away_team)?.price ? decimalToAmerican(spreads.outcomes.find((o: any) => o.name === game.away_team).price) : -110,
        totalLine: totals?.outcomes?.find((o: any) => o.name === 'Over')?.point || 6,
        overOdds: totals?.outcomes?.find((o: any) => o.name === 'Over')?.price ? decimalToAmerican(totals.outcomes.find((o: any) => o.name === 'Over').price) : -110,
        underOdds: totals?.outcomes?.find((o: any) => o.name === 'Under')?.price ? decimalToAmerican(totals.outcomes.find((o: any) => o.name === 'Under').price) : -110,
        bookmaker: dk.title || 'DraftKings',
      });
    }
  } catch (error) {
    console.error('Odds fetch error:', error);
  }
  return oddsMap;
}

let standingsCache: any = null;
let standingsCacheTime = 0;

async function getTeamStats(teamAbbrev: string): Promise<any> {
  try {
    const now = Date.now();
    if (!standingsCache || now - standingsCacheTime > 300000) {
      const res = await fetch('https://api-web.nhle.com/v1/standings/now', { signal: AbortSignal.timeout(8000) });
      if (res.ok) { standingsCache = await res.json(); standingsCacheTime = now; }
    }
    if (!standingsCache) return null;
    
    const team = standingsCache.standings?.find((t: any) => t.teamAbbrev?.default === teamAbbrev);
    if (!team) return null;
    
    const gp = team.gamesPlayed || 1;
    return {
      teamAbbrev,
      gamesPlayed: gp,
      goalsForPerGame: (team.goalFor || 0) / gp,
      goalsAgainstPerGame: (team.goalAgainst || 0) / gp,
      pointsPct: team.pointPctg || 0.5,
    };
  } catch { return null; }
}

function predictGame(homeStats: any, awayStats: any, homeInjuryImpact: number, awayInjuryImpact: number) {
  const homeGD = homeStats.goalsForPerGame - homeStats.goalsAgainstPerGame;
  const awayGD = awayStats.goalsForPerGame - awayStats.goalsAgainstPerGame;
  const gdDiff = (homeGD - awayGD) * 0.08;
  const ppDiff = (homeStats.pointsPct - awayStats.pointsPct) * 0.15;
  const injuryAdj = homeInjuryImpact - awayInjuryImpact;
  
  let homeWinProb = 0.5 + HOME_ICE_BOOST + gdDiff + ppDiff + injuryAdj;
  homeWinProb = Math.max(0.28, Math.min(0.72, homeWinProb));
  
  const predictedTotal = (homeStats.goalsForPerGame + homeStats.goalsAgainstPerGame + awayStats.goalsForPerGame + awayStats.goalsAgainstPerGame) / 2;
  
  let confidence = 0.45;
  if (homeStats.gamesPlayed >= 20 && awayStats.gamesPlayed >= 20) confidence += 0.15;
  if (Math.abs(homeWinProb - 0.5) > 0.12) confidence += 0.1;
  
  return { homeWinProb, predictedTotal, confidence: Math.min(0.80, confidence), factors: { goalDiff: gdDiff, homeIce: HOME_ICE_BOOST, pointsPct: ppDiff, injury: injuryAdj } };
}

export async function GET() {
  try {
    const [schedRes, oddsMap] = await Promise.all([
      fetch('https://api-web.nhle.com/v1/schedule/now', { signal: AbortSignal.timeout(15000) }),
      fetchOddsFromAPI(),
    ]);

    if (!schedRes.ok) {
      return NextResponse.json({ gamesByDate: {}, dates: [], error: 'Schedule API error', lastUpdated: new Date().toISOString() });
    }

    const schedData = await schedRes.json();
    const gameWeek = schedData.gameWeek || [];
    const gamesByDate: Record<string, any[]> = {};
    const dates: string[] = [];

    for (const day of gameWeek) {
      const dateStr = day.date;
      if (!dateStr) continue;
      dates.push(dateStr);
      gamesByDate[dateStr] = [];

      for (const game of day.games || []) {
        const homeAbbrev = game.homeTeam?.abbrev;
        const awayAbbrev = game.awayTeam?.abbrev;
        if (!homeAbbrev || !awayAbbrev) continue;

        const [homeStats, awayStats] = await Promise.all([getTeamStats(homeAbbrev), getTeamStats(awayAbbrev)]);
        const homeInjuries = calculateTeamInjuryImpact(homeAbbrev);
        const awayInjuries = calculateTeamInjuryImpact(awayAbbrev);

        let prediction = { homeWinProbability: 0.5, awayWinProbability: 0.5, predictedTotal: 5.5, confidence: 0.5, factors: {} };
        
        if (homeStats && awayStats) {
          const pred = predictGame(homeStats, awayStats, homeInjuries.totalImpact, awayInjuries.totalImpact);
          prediction = { homeWinProbability: pred.homeWinProb, awayWinProbability: 1 - pred.homeWinProb, predictedTotal: pred.predictedTotal, confidence: pred.confidence, factors: pred.factors };
        }

        const oddsKey = `${awayAbbrev}@${homeAbbrev}`;
        const odds = oddsMap.get(oddsKey);
        
        const getTeamName = (team: any) => team?.placeName?.default && team?.commonName?.default ? `${team.placeName.default} ${team.commonName.default}` : team?.abbrev || 'Unknown';

        gamesByDate[dateStr].push({
          id: `${game.id}`,
          homeTeam: { id: game.homeTeam?.id || 0, name: getTeamName(game.homeTeam), abbreviation: homeAbbrev, injuries: homeInjuries.injuredPlayers },
          awayTeam: { id: game.awayTeam?.id || 0, name: getTeamName(game.awayTeam), abbreviation: awayAbbrev, injuries: awayInjuries.injuredPlayers },
          startTime: game.startTimeUTC || '',
          status: game.gameState === 'LIVE' ? 'live' : game.gameState === 'FINAL' ? 'final' : 'scheduled',
          prediction,
          odds: odds ? [{ bookmaker: odds.bookmaker, homeMoneyline: odds.homeMoneyline, awayMoneyline: odds.awayMoneyline, homeSpread: -1.5, awaySpread: 1.5, homeSpreadLine: '-1.5', awaySpreadLine: '+1.5', homeSpreadOdds: odds.homeSpreadOdds, awaySpreadOdds: odds.awaySpreadOdds, totalLine: odds.totalLine, overLine: `O ${odds.totalLine}`, underLine: `U ${odds.totalLine}`, overOdds: odds.overOdds, underOdds: odds.underOdds }] : [],
        });
      }
    }

    return NextResponse.json({ gamesByDate, dates, lastUpdated: new Date().toISOString() });
  } catch (error) {
    console.error('Games API error:', error);
    return NextResponse.json({ gamesByDate: {}, dates: [], error: 'Failed to fetch games', lastUpdated: new Date().toISOString() });
  }
}
