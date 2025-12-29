import { NextResponse } from 'next/server';

// Vercel Cron - runs daily at 10 AM EST (3 PM UTC)
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

// Team name to abbreviation mapping
const TEAM_NAME_TO_ABBREV: Record<string, string> = {
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
  'Tampa Bay Lightning': 'TBL',
  'Toronto Maple Leafs': 'TOR',
  'Utah Hockey Club': 'UTA',
  'Vancouver Canucks': 'VAN',
  'Vegas Golden Knights': 'VGK',
  'Washington Capitals': 'WSH',
  'Winnipeg Jets': 'WPG',
};

// Global cache for injuries (persists between requests in serverless)
let cachedInjuries: ScrapedInjury[] = [];
let lastUpdated: string = '';

/**
 * Scrape Daily Faceoff injury report
 */
async function scrapeDailyFaceoffInjuries(): Promise<ScrapedInjury[]> {
  const injuries: ScrapedInjury[] = [];
  
  try {
    const response = await fetch('https://www.dailyfaceoff.com/hockey-player-news/injuries/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    
    if (!response.ok) {
      console.error('Failed to fetch Daily Faceoff:', response.status);
      return injuries;
    }
    
    const html = await response.text();
    
    // Parse injury entries
    // Daily Faceoff format: player cards with name, team, injury info
    // Look for patterns in the HTML
    
    // Pattern 1: Player name in links/headers
    const playerPattern = /<a[^>]*href="\/players\/[^"]*"[^>]*>([^<]+)<\/a>/gi;
    
    // Pattern 2: Team names
    const teamPattern = /(Anaheim Ducks|Arizona Coyotes|Boston Bruins|Buffalo Sabres|Calgary Flames|Carolina Hurricanes|Chicago Blackhawks|Colorado Avalanche|Columbus Blue Jackets|Dallas Stars|Detroit Red Wings|Edmonton Oilers|Florida Panthers|Los Angeles Kings|Minnesota Wild|Montreal Canadiens|Nashville Predators|New Jersey Devils|New York Islanders|New York Rangers|Ottawa Senators|Philadelphia Flyers|Pittsburgh Penguins|San Jose Sharks|Seattle Kraken|St\. Louis Blues|Tampa Bay Lightning|Toronto Maple Leafs|Utah Hockey Club|Vancouver Canucks|Vegas Golden Knights|Washington Capitals|Winnipeg Jets)/gi;
    
    // Pattern 3: Injury status
    const statusPattern = /(IR|LTIR|Day-to-Day|Out|Injured Reserve|Long-Term Injured Reserve)/gi;
    
    // Pattern 4: Injury types
    const injuryTypePattern = /(Upper Body|Lower Body|Undisclosed|Illness|Concussion|Knee|Shoulder|Ankle|Back|Hip|Groin|Hand|Wrist|Foot|Head|Neck)/gi;
    
    // Simple extraction - find injury card sections
    // Look for sections that contain player + team + status
    const cardPattern = /<div[^>]*class="[^"]*player[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
    const cards = html.match(cardPattern) || [];
    
    // Also try to find injury list items
    const listPattern = /<li[^>]*>[\s\S]*?<\/li>/gi;
    const listItems = html.match(listPattern) || [];
    
    // Combine and process
    const allSections = [...cards, ...listItems];
    
    for (const section of allSections) {
      const playerMatch = section.match(/<a[^>]*>([A-Z][a-z]+ [A-Z][a-z]+)<\/a>/);
      const teamMatch = section.match(teamPattern);
      const statusMatch = section.match(statusPattern);
      const injuryMatch = section.match(injuryTypePattern);
      
      if (playerMatch && teamMatch) {
        const teamName = teamMatch[0];
        const teamAbbrev = TEAM_NAME_TO_ABBREV[teamName] || '';
        
        if (teamAbbrev) {
          injuries.push({
            name: playerMatch[1],
            team: teamName,
            teamAbbrev,
            position: 'F', // Default, would need more parsing
            injuryType: injuryMatch ? injuryMatch[0] : 'Undisclosed',
            status: statusMatch ? statusMatch[0] : 'Out',
            date: new Date().toISOString().split('T')[0],
          });
        }
      }
    }
    
    // Fallback: simple regex for common patterns
    // "Player Name - Team - Injury - Status"
    const simplePattern = /([A-Z][a-z]+ [A-Z][a-z]+)[^A-Z]*(Ducks|Coyotes|Bruins|Sabres|Flames|Hurricanes|Blackhawks|Avalanche|Blue Jackets|Stars|Red Wings|Oilers|Panthers|Kings|Wild|Canadiens|Predators|Devils|Islanders|Rangers|Senators|Flyers|Penguins|Sharks|Kraken|Blues|Lightning|Maple Leafs|Hockey Club|Canucks|Golden Knights|Capitals|Jets)[^A-Z]*(Upper Body|Lower Body|Undisclosed|Illness|Concussion|Knee|Shoulder|Ankle)[^A-Z]*(IR|LTIR|Day-to-Day|Out)/gi;
    
    let match;
    while ((match = simplePattern.exec(html)) !== null) {
      const teamSuffix = match[2];
      // Find full team name
      const fullTeam = Object.keys(TEAM_NAME_TO_ABBREV).find(t => t.includes(teamSuffix));
      if (fullTeam) {
        const existing = injuries.find(i => i.name === match[1]);
        if (!existing) {
          injuries.push({
            name: match[1],
            team: fullTeam,
            teamAbbrev: TEAM_NAME_TO_ABBREV[fullTeam],
            position: 'F',
            injuryType: match[3] || 'Undisclosed',
            status: match[4] || 'Out',
            date: new Date().toISOString().split('T')[0],
          });
        }
      }
    }
    
    console.log(`Scraped ${injuries.length} injuries from Daily Faceoff`);
    return injuries;
    
  } catch (error) {
    console.error('Error scraping Daily Faceoff:', error);
    return injuries;
  }
}

/**
 * Cron endpoint - called by Vercel Cron
 */
export async function GET(request: Request) {
  // Verify cron secret (optional security)
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow without auth for testing, but log warning
    console.warn('Cron called without valid auth');
  }
  
  try {
    console.log('Starting daily injury scrape...');
    
    // Scrape injuries
    const scrapedInjuries = await scrapeDailyFaceoffInjuries();
    
    // Update cache
    cachedInjuries = scrapedInjuries;
    lastUpdated = new Date().toISOString();
    
    // Log results
    console.log(`Updated injury cache: ${cachedInjuries.length} injuries`);
    cachedInjuries.forEach(i => console.log(`  - ${i.name} (${i.teamAbbrev}): ${i.status}`));
    
    return NextResponse.json({
      success: true,
      injuriesFound: cachedInjuries.length,
      injuries: cachedInjuries,
      lastUpdated,
    });
    
  } catch (error) {
    console.error('Cron job failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to scrape injuries',
    }, { status: 500 });
  }
}

/**
 * Export cached injuries for use by other modules
 */
export function getCachedInjuries(): ScrapedInjury[] {
  return cachedInjuries;
}

export function getLastUpdated(): string {
  return lastUpdated;
}
