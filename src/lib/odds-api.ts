// src/lib/odds-api.ts
// Fetches live betting odds from The Odds API

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

export interface OddsData {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: {
    key: string;
    title: string;
    markets: {
      h2h?: { home: number; away: number };      // Moneyline (American odds)
      spreads?: { home: number; away: number; homeOdds: number; awayOdds: number };
      totals?: { line: number; overOdds: number; underOdds: number };
    };
  }[];
  bestOdds: {
    homeML: number;
    awayML: number;
    homeSpread: number;
    awaySpread: number;
    homeSpreadOdds: number;
    awaySpreadOdds: number;
    totalLine: number;
    overOdds: number;
    underOdds: number;
  };
}

// Convert decimal odds (1.66) to American odds (-152)
function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) {
    return Math.round((decimal - 1) * 100);
  } else {
    return Math.round(-100 / (decimal - 1));
  }
}

// Team name mapping (Odds API uses full names, NHL API uses abbreviations)
const TEAM_NAME_MAP: Record<string, string> = {
  'Anaheim Ducks': 'ANA',
  'Arizona Coyotes': 'ARI',
  'Boston Bruins': 'BOS',
  'Buffalo Sabres': 'BUF',
  'Calgary Flames': 'CGY',
  'Carolina Hurricanes': 'CAR',
  'Chicago Blackhawks': 'CHI',
  'Colorado Avalanche': 'COL',
  'Columbus Blue Jackets': 'CBJ',
  'Dallas Stars': 'DAL',
  'Detroit Red Wings': 'DET',
  'Edmonton Oilers': 'EDM',
  'Florida Panthers': 'FLA',
  'Los Angeles Kings': 'LAK',
  'Minnesota Wild': 'MIN',
  'Montreal Canadiens': 'MTL',
  'Nashville Predators': 'NSH',
  'New Jersey Devils': 'NJD',
  'New York Islanders': 'NYI',
  'New York Rangers': 'NYR',
  'Ottawa Senators': 'OTT',
  'Philadelphia Flyers': 'PHI',
  'Pittsburgh Penguins': 'PIT',
  'San Jose Sharks': 'SJS',
  'Seattle Kraken': 'SEA',
  'St. Louis Blues': 'STL',
  'St Louis Blues': 'STL',
  'Tampa Bay Lightning': 'TBL',
  'Toronto Maple Leafs': 'TOR',
  'Utah Hockey Club': 'UTA',
  'Utah Mammoth': 'UTA',
  'Vancouver Canucks': 'VAN',
  'Vegas Golden Knights': 'VGK',
  'Washington Capitals': 'WSH',
  'Winnipeg Jets': 'WPG',
};

export function getTeamAbbrev(fullName: string): string {
  return TEAM_NAME_MAP[fullName] || fullName.substring(0, 3).toUpperCase();
}

export async function fetchNHLOdds(): Promise<OddsData[]> {
  if (!ODDS_API_KEY) {
    console.error('ODDS_API_KEY not set in environment variables');
    return [];
  }

  try {
    // Fetch h2h (moneyline), spreads, and totals
    const url = `${ODDS_API_BASE}/sports/icehockey_nhl/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&bookmakers=draftkings,fanduel,betmgm,betrivers`;
    
    console.log('Fetching odds from The Odds API...');
    const response = await fetch(url, {
      next: { revalidate: 300 } // Cache for 5 minutes
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Odds API error:', response.status, errorText);
      return [];
    }

    const data = await response.json();
    console.log(`Odds API returned ${data.length} games`);

    // Log remaining requests
    const remaining = response.headers.get('x-requests-remaining');
    const used = response.headers.get('x-requests-used');
    console.log(`Odds API usage: ${used} used, ${remaining} remaining this month`);

    return data.map((game: any) => {
      const bookmakers = game.bookmakers.map((bm: any) => {
        const markets: any = {};

        // Parse h2h (moneyline)
        const h2h = bm.markets.find((m: any) => m.key === 'h2h');
        if (h2h) {
          const homeOutcome = h2h.outcomes.find((o: any) => o.name === game.home_team);
          const awayOutcome = h2h.outcomes.find((o: any) => o.name === game.away_team);
          if (homeOutcome && awayOutcome) {
            markets.h2h = {
              home: decimalToAmerican(homeOutcome.price),
              away: decimalToAmerican(awayOutcome.price),
            };
          }
        }

        // Parse spreads
        const spreads = bm.markets.find((m: any) => m.key === 'spreads');
        if (spreads) {
          const homeSpread = spreads.outcomes.find((o: any) => o.name === game.home_team);
          const awaySpread = spreads.outcomes.find((o: any) => o.name === game.away_team);
          if (homeSpread && awaySpread) {
            markets.spreads = {
              home: homeSpread.point,
              away: awaySpread.point,
              homeOdds: decimalToAmerican(homeSpread.price),
              awayOdds: decimalToAmerican(awaySpread.price),
            };
          }
        }

        // Parse totals
        const totals = bm.markets.find((m: any) => m.key === 'totals');
        if (totals) {
          const over = totals.outcomes.find((o: any) => o.name === 'Over');
          const under = totals.outcomes.find((o: any) => o.name === 'Under');
          if (over && under) {
            markets.totals = {
              line: over.point,
              overOdds: decimalToAmerican(over.price),
              underOdds: decimalToAmerican(under.price),
            };
          }
        }

        return {
          key: bm.key,
          title: bm.title,
          markets,
        };
      });

      // Find best odds (use DraftKings as default, fallback to first bookmaker)
      const dk = bookmakers.find((b: any) => b.key === 'draftkings') || bookmakers[0];
      
      const bestOdds = {
        homeML: dk?.markets?.h2h?.home || 0,
        awayML: dk?.markets?.h2h?.away || 0,
        homeSpread: dk?.markets?.spreads?.home || -1.5,
        awaySpread: dk?.markets?.spreads?.away || 1.5,
        homeSpreadOdds: dk?.markets?.spreads?.homeOdds || -110,
        awaySpreadOdds: dk?.markets?.spreads?.awayOdds || -110,
        totalLine: dk?.markets?.totals?.line || 6,
        overOdds: dk?.markets?.totals?.overOdds || -110,
        underOdds: dk?.markets?.totals?.underOdds || -110,
      };

      return {
        gameId: game.id,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        commenceTime: game.commence_time,
        bookmakers,
        bestOdds,
      };
    });
  } catch (error) {
    console.error('Failed to fetch odds:', error);
    return [];
  }
}

// Match odds to a game by team abbreviations
export function findOddsForGame(
  odds: OddsData[],
  homeAbbrev: string,
  awayAbbrev: string
): OddsData | undefined {
  return odds.find((o) => {
    const oddsHome = getTeamAbbrev(o.homeTeam);
    const oddsAway = getTeamAbbrev(o.awayTeam);
    return oddsHome === homeAbbrev && oddsAway === awayAbbrev;
  });
}

// Convert American odds to implied probability
export function americanToProb(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

// Format American odds for display (+150, -110)
export function formatOdds(odds: number): string {
  if (!odds || odds === 0) return '-';
  return odds > 0 ? `+${odds}` : `${odds}`;
}
