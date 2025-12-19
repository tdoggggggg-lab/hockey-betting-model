// The Odds API Service
// Get your free API key at https://the-odds-api.com/ (500 requests/month)

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'icehockey_nhl';

export interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface OddsMarket {
  key: string;
  last_update: string;
  outcomes: OddsOutcome[];
}

export interface OddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsMarket[];
}

export interface OddsGame {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

export interface ProcessedOdds {
  bookmaker: string;
  homeMoneyline: number;
  awayMoneyline: number;
  homeSpread: number;
  homeSpreadOdds: number;
  awaySpreadOdds: number;
  totalLine: number;
  overOdds: number;
  underOdds: number;
  lastUpdate: string;
}

/**
 * Get NHL odds from The Odds API
 * Markets: h2h (moneyline), spreads (puck line), totals (over/under)
 */
export async function getNHLOdds(): Promise<OddsGame[]> {
  const apiKey = process.env.ODDS_API_KEY;
  
  if (!apiKey) {
    console.warn('ODDS_API_KEY not set - using mock data');
    return [];
  }
  
  try {
    const params = new URLSearchParams({
      apiKey,
      regions: 'us',
      markets: 'h2h,spreads,totals',
      oddsFormat: 'american',
    });
    
    const response = await fetch(
      `${ODDS_API_BASE}/sports/${SPORT_KEY}/odds?${params}`,
      { next: { revalidate: 120 } } // Cache for 2 minutes
    );
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Odds API error: ${response.status} - ${error}`);
    }
    
    // Log remaining requests (helpful for monitoring free tier)
    const remaining = response.headers.get('x-requests-remaining');
    const used = response.headers.get('x-requests-used');
    console.log(`Odds API: ${used} used, ${remaining} remaining this month`);
    
    const data: OddsGame[] = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching odds:', error);
    return [];
  }
}

/**
 * Process raw odds data into our format
 */
export function processOddsForGame(
  oddsGame: OddsGame,
  bookmakerKeys: string[] = ['draftkings', 'fanduel', 'betmgm', 'pointsbetus', 'bovada']
): ProcessedOdds[] {
  const processedOdds: ProcessedOdds[] = [];
  
  for (const bookmaker of oddsGame.bookmakers) {
    // Filter to preferred bookmakers if specified
    if (bookmakerKeys.length > 0 && !bookmakerKeys.includes(bookmaker.key)) {
      continue;
    }
    
    const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
    const spreadsMarket = bookmaker.markets.find(m => m.key === 'spreads');
    const totalsMarket = bookmaker.markets.find(m => m.key === 'totals');
    
    // Get moneyline odds
    const homeML = h2hMarket?.outcomes.find(o => o.name === oddsGame.home_team)?.price || 0;
    const awayML = h2hMarket?.outcomes.find(o => o.name === oddsGame.away_team)?.price || 0;
    
    // Get spread/puck line odds
    const homeSpreadOutcome = spreadsMarket?.outcomes.find(o => o.name === oddsGame.home_team);
    const awaySpreadOutcome = spreadsMarket?.outcomes.find(o => o.name === oddsGame.away_team);
    
    // Get totals
    const overOutcome = totalsMarket?.outcomes.find(o => o.name === 'Over');
    const underOutcome = totalsMarket?.outcomes.find(o => o.name === 'Under');
    
    processedOdds.push({
      bookmaker: bookmaker.title,
      homeMoneyline: homeML,
      awayMoneyline: awayML,
      homeSpread: homeSpreadOutcome?.point || -1.5,
      homeSpreadOdds: homeSpreadOutcome?.price || 0,
      awaySpreadOdds: awaySpreadOutcome?.price || 0,
      totalLine: overOutcome?.point || 5.5,
      overOdds: overOutcome?.price || 0,
      underOdds: underOutcome?.price || 0,
      lastUpdate: bookmaker.last_update,
    });
  }
  
  return processedOdds;
}

/**
 * Find the best odds across all bookmakers
 */
export function findBestOdds(odds: ProcessedOdds[]): {
  bestHomeML: { odds: number; bookmaker: string };
  bestAwayML: { odds: number; bookmaker: string };
  bestOver: { odds: number; bookmaker: string };
  bestUnder: { odds: number; bookmaker: string };
} {
  let bestHomeML = { odds: -Infinity, bookmaker: '' };
  let bestAwayML = { odds: -Infinity, bookmaker: '' };
  let bestOver = { odds: -Infinity, bookmaker: '' };
  let bestUnder = { odds: -Infinity, bookmaker: '' };
  
  for (const odd of odds) {
    if (odd.homeMoneyline > bestHomeML.odds) {
      bestHomeML = { odds: odd.homeMoneyline, bookmaker: odd.bookmaker };
    }
    if (odd.awayMoneyline > bestAwayML.odds) {
      bestAwayML = { odds: odd.awayMoneyline, bookmaker: odd.bookmaker };
    }
    if (odd.overOdds > bestOver.odds) {
      bestOver = { odds: odd.overOdds, bookmaker: odd.bookmaker };
    }
    if (odd.underOdds > bestUnder.odds) {
      bestUnder = { odds: odd.underOdds, bookmaker: odd.bookmaker };
    }
  }
  
  return { bestHomeML, bestAwayML, bestOver, bestUnder };
}

/**
 * Match odds data to NHL game by team names
 */
export function matchOddsToGame(
  homeTeam: string,
  awayTeam: string,
  oddsGames: OddsGame[]
): OddsGame | undefined {
  return oddsGames.find(game => {
    const homeMatch = game.home_team.toLowerCase().includes(homeTeam.toLowerCase()) ||
                      homeTeam.toLowerCase().includes(game.home_team.split(' ').pop()?.toLowerCase() || '');
    const awayMatch = game.away_team.toLowerCase().includes(awayTeam.toLowerCase()) ||
                      awayTeam.toLowerCase().includes(game.away_team.split(' ').pop()?.toLowerCase() || '');
    return homeMatch && awayMatch;
  });
}

/**
 * Team name mapping (NHL API name -> Odds API name)
 */
export const TEAM_NAME_MAP: Record<string, string> = {
  'Devils': 'New Jersey Devils',
  'Islanders': 'New York Islanders',
  'Rangers': 'New York Rangers',
  'Flyers': 'Philadelphia Flyers',
  'Penguins': 'Pittsburgh Penguins',
  'Bruins': 'Boston Bruins',
  'Sabres': 'Buffalo Sabres',
  'Canadiens': 'Montreal Canadiens',
  'Senators': 'Ottawa Senators',
  'Maple Leafs': 'Toronto Maple Leafs',
  'Hurricanes': 'Carolina Hurricanes',
  'Panthers': 'Florida Panthers',
  'Lightning': 'Tampa Bay Lightning',
  'Capitals': 'Washington Capitals',
  'Blackhawks': 'Chicago Blackhawks',
  'Red Wings': 'Detroit Red Wings',
  'Predators': 'Nashville Predators',
  'Blues': 'St Louis Blues',
  'Flames': 'Calgary Flames',
  'Avalanche': 'Colorado Avalanche',
  'Oilers': 'Edmonton Oilers',
  'Canucks': 'Vancouver Canucks',
  'Ducks': 'Anaheim Ducks',
  'Stars': 'Dallas Stars',
  'Kings': 'Los Angeles Kings',
  'Sharks': 'San Jose Sharks',
  'Blue Jackets': 'Columbus Blue Jackets',
  'Wild': 'Minnesota Wild',
  'Jets': 'Winnipeg Jets',
  'Coyotes': 'Arizona Coyotes',
  'Golden Knights': 'Vegas Golden Knights',
  'Kraken': 'Seattle Kraken',
  'Utah Hockey Club': 'Utah Hockey Club',
};
