import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export interface ScrapedInjury {
  name: string;
  team: string;
  teamAbbrev: string;
  position: string;
  injuryType: string;
  status: string;
  date: string;
}

const TEAM_NAME_TO_ABBREV: Record<string, string> = {
  'Anaheim Ducks': 'ANA', 'Boston Bruins': 'BOS', 'Buffalo Sabres': 'BUF',
  'Calgary Flames': 'CGY', 'Carolina Hurricanes': 'CAR', 'Chicago Blackhawks': 'CHI',
  'Colorado Avalanche': 'COL', 'Columbus Blue Jackets': 'CBJ', 'Dallas Stars': 'DAL',
  'Detroit Red Wings': 'DET', 'Edmonton Oilers': 'EDM', 'Florida Panthers': 'FLA',
  'Los Angeles Kings': 'LAK', 'Minnesota Wild': 'MIN', 'Montreal Canadiens': 'MTL',
  'Nashville Predators': 'NSH', 'New Jersey Devils': 'NJD', 'New York Islanders': 'NYI',
  'New York Rangers': 'NYR', 'Ottawa Senators': 'OTT', 'Philadelphia Flyers': 'PHI',
  'Pittsburgh Penguins': 'PIT', 'San Jose Sharks': 'SJS', 'Seattle Kraken': 'SEA',
  'St. Louis Blues': 'STL', 'Tampa Bay Lightning': 'TBL', 'Toronto Maple Leafs': 'TOR',
  'Utah Hockey Club': 'UTA', 'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK',
  'Washington Capitals': 'WSH', 'Winnipeg Jets': 'WPG',
};

let cachedInjuries: ScrapedInjury[] = [];
let lastUpdated: string = '';

async function scrapeDailyFaceoffInjuries(): Promise<ScrapedInjury[]> {
  const injuries: ScrapedInjury[] = [];
  
  try {
    const response = await fetch('https://www.dailyfaceoff.com/hockey-player-news/injuries/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });
    
    if (!response.ok) {
      console.error('Failed to fetch Daily Faceoff:', response.status);
      return injuries;
    }
    
    const html = await response.text();
    
    // Extract player names with regex
    const playerMatches = html.matchAll(/<a[^>]*>([A-Z][a-z]+ [A-Z][a-z]+)<\/a>/g);
    const teamMatches = html.matchAll(/(Ducks|Bruins|Sabres|Flames|Hurricanes|Blackhawks|Avalanche|Blue Jackets|Stars|Red Wings|Oilers|Panthers|Kings|Wild|Canadiens|Predators|Devils|Islanders|Rangers|Senators|Flyers|Penguins|Sharks|Kraken|Blues|Lightning|Maple Leafs|Hockey Club|Canucks|Golden Knights|Capitals|Jets)/g);
    
    const players = Array.from(playerMatches).map(m => m[1]);
    const teams = Array.from(teamMatches).map(m => m[1]);
    
    console.log(`Found ${players.length} players, ${teams.length} teams`);
    
    return injuries;
    
  } catch (error) {
    console.error('Error scraping Daily Faceoff:', error);
    return injuries;
  }
}

export async function GET(request: Request) {
  try {
    console.log('Starting daily injury scrape...');
    
    const scrapedInjuries = await scrapeDailyFaceoffInjuries();
    
    cachedInjuries = scrapedInjuries;
    lastUpdated = new Date().toISOString();
    
    return NextResponse.json({
      success: true,
      injuriesFound: cachedInjuries.length,
      injuries: cachedInjuries,
      lastUpdated,
    });
    
  } catch (error) {
    console.error('Cron job failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to scrape injuries' }, { status: 500 });
  }
}

export function getCachedInjuries(): ScrapedInjury[] {
  return cachedInjuries;
}
