import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// In-memory cache (persists within serverless instance)
let injuryCache: {
  injuries: Record<string, { name: string; status: string; detail: string }[]>;
  lastUpdated: string;
} = {
  injuries: {},
  lastUpdated: '',
};

// Manual backup list (always included)
const MANUAL_INJURIES: Record<string, { name: string; status: string; detail: string }[]> = {
  'COL': [{ name: 'Gabriel Landeskog', status: 'LTIR', detail: 'Knee' }],
  'EDM': [{ name: 'Evander Kane', status: 'LTIR', detail: 'Hernia' }],
  'TBL': [{ name: 'Brandon Hagel', status: 'IR', detail: 'Lower Body' }],
  'CAR': [{ name: 'Seth Jarvis', status: 'IR', detail: 'Upper Body' }],
  'VAN': [{ name: 'Thatcher Demko', status: 'IR', detail: 'Lower Body' }],
  'PHI': [{ name: 'Tyson Foerster', status: 'DTD', detail: 'Upper Body' }],
};

// Team name to abbreviation mapping
const TEAM_MAP: Record<string, string> = {
  'Avalanche': 'COL', 'Oilers': 'EDM', 'Lightning': 'TBL', 'Hurricanes': 'CAR',
  'Canucks': 'VAN', 'Flyers': 'PHI', 'Maple Leafs': 'TOR', 'Bruins': 'BOS',
  'Rangers': 'NYR', 'Devils': 'NJD', 'Islanders': 'NYI', 'Penguins': 'PIT',
  'Capitals': 'WSH', 'Blue Jackets': 'CBJ', 'Red Wings': 'DET', 'Sabres': 'BUF',
  'Senators': 'OTT', 'Panthers': 'FLA', 'Canadiens': 'MTL', 'Blackhawks': 'CHI',
  'Blues': 'STL', 'Wild': 'MIN', 'Jets': 'WPG', 'Predators': 'NSH',
  'Stars': 'DAL', 'Flames': 'CGY', 'Golden Knights': 'VGK', 'Kings': 'LAK',
  'Ducks': 'ANA', 'Sharks': 'SJS', 'Kraken': 'SEA', 'Utah': 'UTA',
};

async function scrapeInjuries(): Promise<Record<string, { name: string; status: string; detail: string }[]>> {
  const injuries: Record<string, { name: string; status: string; detail: string }[]> = {};
  
  try {
    // Try to fetch from Daily Faceoff or similar source
    // For now, we'll use NHL API roster status as a backup
    const teams = Object.values(TEAM_MAP);
    
    for (const teamAbbrev of teams) {
      try {
        const res = await fetch(`https://api-web.nhle.com/v1/roster/${teamAbbrev}/current`);
        if (!res.ok) continue;
        
        const data = await res.json();
        const teamInjuries: { name: string; status: string; detail: string }[] = [];
        
        // Check forwards, defensemen, goalies
        const allPlayers = [
          ...(data.forwards || []),
          ...(data.defensemen || []),
          ...(data.goalies || []),
        ];
        
        for (const player of allPlayers) {
          // NHL API doesn't always have injury status, but we can check for roster status
          if (player.injuryStatus) {
            const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
            teamInjuries.push({
              name,
              status: player.injuryStatus || 'OUT',
              detail: player.injuryDescription || 'Unknown',
            });
          }
        }
        
        if (teamInjuries.length > 0) {
          injuries[teamAbbrev] = teamInjuries;
        }
      } catch {
        // Skip team if fetch fails
      }
    }
  } catch (error) {
    console.error('Error scraping injuries:', error);
  }
  
  return injuries;
}

export async function GET(request: Request) {
  // Check for cron secret (optional security)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Allow without auth for testing, but log warning
    console.log('Warning: Cron endpoint called without valid auth');
  }
  
  console.log('Starting daily injury scrape...');
  
  try {
    const scrapedInjuries = await scrapeInjuries();
    
    // Merge scraped injuries with manual list
    const mergedInjuries: Record<string, { name: string; status: string; detail: string }[]> = { ...MANUAL_INJURIES };
    
    for (const [team, players] of Object.entries(scrapedInjuries)) {
      if (!mergedInjuries[team]) {
        mergedInjuries[team] = [];
      }
      // Add scraped injuries that aren't already in manual list
      for (const player of players) {
        const exists = mergedInjuries[team].some(
          p => p.name.toLowerCase() === player.name.toLowerCase()
        );
        if (!exists) {
          mergedInjuries[team].push(player);
        }
      }
    }
    
    // Update cache
    injuryCache = {
      injuries: mergedInjuries,
      lastUpdated: new Date().toISOString(),
    };
    
    const totalInjured = Object.values(mergedInjuries).flat().length;
    console.log(`Injury scrape complete: ${totalInjured} injured players across ${Object.keys(mergedInjuries).length} teams`);
    
    return NextResponse.json({
      success: true,
      injuries: mergedInjuries,
      lastUpdated: injuryCache.lastUpdated,
      totalInjured,
    });
    
  } catch (error) {
    console.error('Injury scrape failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to scrape injuries',
      injuries: MANUAL_INJURIES,
    });
  }
}

// Export for use by other routes
export function getInjuryCache() {
  // If cache is empty or stale (>24h), return manual list
  if (!injuryCache.lastUpdated) {
    return { injuries: MANUAL_INJURIES, lastUpdated: new Date().toISOString() };
  }
  
  const cacheAge = Date.now() - new Date(injuryCache.lastUpdated).getTime();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  if (cacheAge > maxAge) {
    // Merge manual with cached (manual takes precedence)
    const merged = { ...injuryCache.injuries };
    for (const [team, players] of Object.entries(MANUAL_INJURIES)) {
      merged[team] = players;
    }
    return { injuries: merged, lastUpdated: injuryCache.lastUpdated };
  }
  
  return injuryCache;
}
