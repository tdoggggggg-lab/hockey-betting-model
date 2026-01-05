// src/app/api/games/route.ts
// Game predictions with LIVE ODDS from The Odds API

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ============ ODDS API INTEGRATION ============

const ODDS_API_KEY = process.env.ODDS_API_KEY;

// Team name mapping (Odds API full names → NHL abbreviations)
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
  if (decimal >= 2.0) {
    return Math.round((decimal - 1) * 100);
  } else {
    return Math.round(-100 / (decimal - 1));
  }
}

async function fetchOddsFromAPI(): Promise<Map<string, any>> {
  const oddsMap = new Map();
  
  if (!ODDS_API_KEY) {
    console.log('ODDS_API_KEY not set - skipping odds fetch');
    return oddsMap;
  }

  try {
    const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&bookmakers=draftkings,fanduel,betmgm`;
    
    console.log('Fetching live odds...');
    const response = await fetch(url, { next: { revalidate: 300 } });

    if (!response.ok) {
      console.error('Odds API error:', response.status);
      return oddsMap;
    }

    const data = await response.json();
    console.log(`Odds API: ${data.length} games returned`);
    
    // Log usage
    const remaining = response.headers.get('x-requests-remaining');
    console.log(`Odds API requests remaining: ${remaining}`);

    for (const game of data) {
      const homeAbbrev = getTeamAbbrev(game.home_team);
      const awayAbbrev = getTeamAbbrev(game.away_team);
      const key = `${awayAbbrev}@${homeAbbrev}`;

      // Get DraftKings odds (or first bookmaker)
      const dk = game.bookmakers.find((b: any) => b.key === 'draftkings') || game.bookmakers[0];
      if (!dk) continue;

      const h2h = dk.markets.find((m: any) => m.key === 'h2h');
      const spreads = dk.markets.find((m: any) => m.key === 'spreads');
      const totals = dk.markets.find((m: any) => m.key === 'totals');

      let homeML = 0, awayML = 0;
      if (h2h) {
        const homeOutcome = h2h.outcomes.find((o: any) => o.name === game.home_team);
        const awayOutcome = h2h.outcomes.find((o: any) => o.name === game.away_team);
        homeML = homeOutcome ? decimalToAmerican(homeOutcome.price) : 0;
        awayML = awayOutcome ? decimalToAmerican(awayOutcome.price) : 0;
      }

      let homeSpreadOdds = -110, awaySpreadOdds = -110;
      if (spreads) {
        const homeSpread = spreads.outcomes.find((o: any) => o.name === game.home_team);
        const awaySpread = spreads.outcomes.find((o: any) => o.name === game.away_team);
        homeSpreadOdds = homeSpread ? decimalToAmerican(homeSpread.price) : -110;
        awaySpreadOdds = awaySpread ? decimalToAmerican(awaySpread.price) : -110;
      }

      let totalLine = 6, overOdds = -110, underOdds = -110;
      if (totals) {
        const over = totals.outcomes.find((o: any) => o.name === 'Over');
        const under = totals.outcomes.find((o: any) => o.name === 'Under');
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

    console.log(`Parsed odds for ${oddsMap.size} games`);
  } catch (error) {
    console.error('Failed to fetch odds:', error);
  }

  return oddsMap;
}

// ============ PREDICTION MODEL ============

const HOME_ICE_BOOST = 0.045;
const B2B_PENALTY = 0.073;

interface TeamStats {
  teamAbbrev: string;
  gamesPlayed: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  pointsPct: number;
}

async function getTeamStats(teamAbbrev: string): Promise<TeamStats | null> {
  try {
    const res = await fetch('https://api-web.nhle.com/v1/standings/now');
    if (!res.ok) return null;
    const data = await res.json();
    const team = (data.standings || []).find(
      (t: any) => t.teamAbbrev?.default === teamAbbrev
    );
    if (!team) return null;
    const gp = team.gamesPlayed || 1;
    return {
      teamAbbrev,
      gamesPlayed: gp,
      goalsForPerGame: (team.goalFor || 0) / gp,
      goalsAgainstPerGame: (team.goalAgainst || 0) / gp,
      pointsPct: (team.points || 0) / (gp * 2),
    };
  } catch { return null; }
}

async function isBackToBack(teamAbbrev: string, gameDate: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/club-schedule/${teamAbbrev}/week/now`);
    if (!res.ok) return false;
    const data = await res.json();
    const yesterday = new Date(gameDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    return (data.games || []).some((g: any) => g.gameDate === yesterdayStr);
  } catch { return false; }
}

function predictGame(homeStats: TeamStats, awayStats: TeamStats, homeB2B: boolean, awayB2B: boolean) {
  const homeGD = homeStats.goalsForPerGame - homeStats.goalsAgainstPerGame;
  const awayGD = awayStats.goalsForPerGame - awayStats.goalsAgainstPerGame;
  const gdAdvantage = homeGD - awayGD;

  let baseProb = 1 / (1 + Math.exp(-0.18 * gdAdvantage * 10));
  baseProb = 0.5 + (baseProb - 0.5) * 0.75;

  let restAdj = 0;
  if (homeB2B && !awayB2B) restAdj = -B2B_PENALTY;
  else if (!homeB2B && awayB2B) restAdj = B2B_PENALTY;

  const ptsPctAdj = (homeStats.pointsPct - awayStats.pointsPct) * 0.15;

  let homeWinProb = baseProb + HOME_ICE_BOOST + restAdj + ptsPctAdj;
  homeWinProb = Math.max(0.28, Math.min(0.72, homeWinProb));

  const predictedTotal = homeStats.goalsForPerGame + awayStats.goalsForPerGame;

  let confidence = 0.45;
  if (homeStats.gamesPlayed >= 20 && awayStats.gamesPlayed >= 20) confidence += 0.15;
  if (Math.abs(homeWinProb - 0.5) > 0.12) confidence += 0.1;
  if (Math.abs(restAdj) > 0) confidence += 0.1;
  confidence = Math.min(0.80, confidence);

  return { homeWinProb, predictedTotal, confidence };
}

// ============ MAIN HANDLER ============

export async function GET() {
  try {
    // Fetch schedule and odds in parallel
    const [schedRes, oddsMap] = await Promise.all([
      fetch('https://api-web.nhle.com/v1/schedule/now'),
      fetchOddsFromAPI(),
    ]);

    if (!schedRes.ok) {
      return NextResponse.json({ gamesByDate: {}, dates: [], error: 'Schedule API error' });
    }

    const schedData = await schedRes.json();
    const gameWeek = schedData.gameWeek || [];

    console.log(`Schedule: ${gameWeek.length} days`);

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

        // Get prediction
        const [homeStats, awayStats, homeB2B, awayB2B] = await Promise.all([
          getTeamStats(homeAbbrev),
          getTeamStats(awayAbbrev),
          isBackToBack(homeAbbrev, dateStr),
          isBackToBack(awayAbbrev, dateStr),
        ]);

        let prediction = {
          homeWinProbability: 0.5,
          awayWinProbability: 0.5,
          predictedTotal: 5.5,
          confidence: 0.5,
        };

        if (homeStats && awayStats) {
          const pred = predictGame(homeStats, awayStats, homeB2B, awayB2B);
          prediction = {
            homeWinProbability: pred.homeWinProb,
            awayWinProbability: 1 - pred.homeWinProb,
            predictedTotal: pred.predictedTotal,
            confidence: pred.confidence,
          };
        }

        // Get odds for this game
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
          },
          awayTeam: {
            id: game.awayTeam?.id || 0,
            name: getTeamName(game.awayTeam),
            abbreviation: awayAbbrev,
          },
          startTime: game.startTimeUTC || '',
          status: game.gameState === 'LIVE' ? 'live' : game.gameState === 'FINAL' ? 'final' : 'scheduled',
          prediction,
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

    return NextResponse.json({
      gamesByDate,
      dates,
      lastUpdated: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Games API error:', error);
    return NextResponse.json({ gamesByDate: {}, dates: [], error: 'Failed to fetch games' });
  }
}
