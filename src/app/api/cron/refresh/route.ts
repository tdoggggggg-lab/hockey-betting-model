import { NextResponse } from 'next/server';

// ============================================================
// DYNAMIC REFRESH CRON - Runs every hour
// Checks if current hour matches the calculated optimal refresh time
// If yes, triggers full data refresh (odds, injuries, lineups)
// ============================================================

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_CACHE_MINUTES = 5;

// Cache for schedule data (populated by schedule cron)
let scheduleCache: {
  date: string;
  targetRefreshHourET: number;
} | null = null;

// Cache for odds data
let oddsCache: { data: any; timestamp: number } | null = null;

// Track last refresh
let lastRefresh: { date: string; hour: number; success: boolean } | null = null;

// Convert to ET
function getETDate(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function getETHour(): number {
  return getETDate().getHours();
}

function getTodayDateString(): string {
  const et = getETDate();
  return et.toISOString().split('T')[0];
}

// Fetch schedule cache from the schedule endpoint
async function fetchScheduleCache(): Promise<{ date: string; targetRefreshHourET: number } | null> {
  try {
    // Call our own schedule endpoint to get/set the cache
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/cron/schedule`, {
      signal: AbortSignal.timeout(15000),
    });
    
    if (response.ok) {
      const data = await response.json();
      return {
        date: data.date,
        targetRefreshHourET: data.targetRefreshHourET,
      };
    }
  } catch (error) {
    console.error('[Refresh Cron] Failed to fetch schedule cache:', error);
  }
  return null;
}

// Refresh odds data from The Odds API
async function refreshOddsData(): Promise<{ success: boolean; playerCount: number }> {
  if (!ODDS_API_KEY) {
    console.error('[Refresh Cron] ODDS_API_KEY not set');
    return { success: false, playerCount: 0 };
  }
  
  try {
    console.log('[Refresh Cron] Fetching fresh odds from The Odds API...');
    
    // First get today's events
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events?apiKey=${ODDS_API_KEY}`;
    const eventsRes = await fetch(eventsUrl, { signal: AbortSignal.timeout(15000) });
    
    if (!eventsRes.ok) {
      throw new Error(`Events API error: ${eventsRes.status}`);
    }
    
    const events = await eventsRes.json();
    const today = getTodayDateString();
    
    // Filter to today's games
    const todayEvents = events.filter((event: any) => {
      const eventDate = new Date(event.commence_time).toISOString().split('T')[0];
      return eventDate === today;
    });
    
    console.log(`[Refresh Cron] Found ${todayEvents.length} games today`);
    
    if (todayEvents.length === 0) {
      oddsCache = { data: { events: [], props: [] }, timestamp: Date.now() };
      return { success: true, playerCount: 0 };
    }
    
    // Get player props for today's events
    let allProps: any[] = [];
    
    for (const event of todayEvents) {
      try {
        const propsUrl = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events/${event.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=player_points,player_assists,player_shots_on_goal,player_goal_scorer_anytime&oddsFormat=american`;
        
        const propsRes = await fetch(propsUrl, { signal: AbortSignal.timeout(10000) });
        
        if (propsRes.ok) {
          const propsData = await propsRes.json();
          allProps.push({
            eventId: event.id,
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            commenceTime: event.commence_time,
            bookmakers: propsData.bookmakers || [],
          });
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        console.error(`[Refresh Cron] Error fetching props for ${event.id}:`, e);
      }
    }
    
    // Count unique players with props
    const playersWithProps = new Set<string>();
    for (const eventProps of allProps) {
      for (const book of eventProps.bookmakers || []) {
        for (const market of book.markets || []) {
          for (const outcome of market.outcomes || []) {
            if (outcome.description) {
              playersWithProps.add(outcome.description.toLowerCase());
            }
          }
        }
      }
    }
    
    oddsCache = {
      data: { events: todayEvents, props: allProps, playersWithProps: Array.from(playersWithProps) },
      timestamp: Date.now(),
    };
    
    console.log(`[Refresh Cron] Cached odds for ${allProps.length} games, ${playersWithProps.size} players with props`);
    
    return { success: true, playerCount: playersWithProps.size };
    
  } catch (error) {
    console.error('[Refresh Cron] Error refreshing odds:', error);
    return { success: false, playerCount: 0 };
  }
}

// Refresh injuries from ESPN
async function refreshInjuries(): Promise<{ success: boolean; injuredCount: number }> {
  try {
    console.log('[Refresh Cron] Fetching injuries from ESPN...');
    
    const response = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries',
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      }
    );
    
    if (!response.ok) {
      throw new Error(`ESPN API error: ${response.status}`);
    }
    
    const data = await response.json();
    let injuredCount = 0;
    
    for (const team of data.teams || []) {
      injuredCount += (team.injuries || []).length;
    }
    
    console.log(`[Refresh Cron] Found ${injuredCount} injuries`);
    return { success: true, injuredCount };
    
  } catch (error) {
    console.error('[Refresh Cron] Error refreshing injuries:', error);
    return { success: false, injuredCount: 0 };
  }
}

export async function GET() {
  const today = getTodayDateString();
  const currentHourET = getETHour();
  
  // Get schedule cache (will create if doesn't exist)
  scheduleCache = await fetchScheduleCache();
  
  // Default to 11 AM if no schedule cache
  const targetHour = scheduleCache?.targetRefreshHourET ?? 11;
  
  // Check if we already refreshed this hour today
  if (lastRefresh && lastRefresh.date === today && lastRefresh.hour === currentHourET) {
    return NextResponse.json({
      status: 'skipped',
      reason: 'Already refreshed this hour',
      currentHourET,
      targetRefreshHourET: targetHour,
      lastRefresh,
    });
  }
  
  // Check if current hour matches target
  const shouldRefresh = currentHourET === targetHour;
  
  if (!shouldRefresh) {
    return NextResponse.json({
      status: 'waiting',
      currentHourET,
      targetRefreshHourET: targetHour,
      hoursUntilRefresh: targetHour > currentHourET 
        ? targetHour - currentHourET 
        : (24 - currentHourET) + targetHour,
      lastRefresh,
    });
  }
  
  // Time to refresh!
  console.log(`[Refresh Cron] Current hour (${currentHourET}) matches target (${targetHour}). Refreshing...`);
  
  // Run refreshes in parallel
  const [oddsResult, injuryResult] = await Promise.all([
    refreshOddsData(),
    refreshInjuries(),
  ]);
  
  lastRefresh = {
    date: today,
    hour: currentHourET,
    success: oddsResult.success && injuryResult.success,
  };
  
  return NextResponse.json({
    status: 'refreshed',
    currentHourET,
    targetRefreshHourET: targetHour,
    results: {
      odds: oddsResult,
      injuries: injuryResult,
    },
    lastRefresh,
    nextCheck: 'Next hour',
  });
}

// Export cache getter for other routes
export function getOddsCache() {
  return oddsCache;
}
