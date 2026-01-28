import { NextResponse } from 'next/server';

// ============================================================
// DYNAMIC SCHEDULE CRON - Runs at 8 AM ET daily
// Fetches today's NHL schedule, finds first game time,
// and calculates optimal refresh time based on morning skate
// ============================================================

// Cache the target refresh hour for today
let scheduleCache: {
  date: string;
  firstGameTimeET: string;
  targetRefreshHourET: number;
  games: Array<{ teams: string; timeET: string }>;
} | null = null;

// Convert UTC to ET (handles EST/EDT automatically)
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

// Calculate optimal refresh time based on first game
// Logic from project docs:
// - Morning skate: 10:00-11:30 AM local time
// - Goalie confirmations: 10:30 AM - 12:00 PM ET for standard 7 PM games
// - Best window: 2-3 hours before first puck drop, but not before 10 AM ET
function calculateOptimalRefreshHour(firstGameHourET: number): number {
  // Target: 2-3 hours before first game, but within morning skate window
  const idealRefresh = firstGameHourET - 3;
  
  // Constraints:
  // - Not before 10 AM ET (morning skate hasn't happened)
  // - Not after 1 PM ET (want time to act on info)
  // - Not after firstGame - 1 hour (too close to game)
  
  const minRefresh = 10; // 10 AM ET earliest (morning skate)
  const maxRefresh = Math.min(13, firstGameHourET - 1); // 1 PM ET or 1 hour before game
  
  return Math.max(minRefresh, Math.min(idealRefresh, maxRefresh));
}

export async function GET() {
  const today = getTodayDateString();
  
  // If we already calculated for today, return cached
  if (scheduleCache && scheduleCache.date === today) {
    return NextResponse.json({
      cached: true,
      ...scheduleCache,
      currentHourET: getETHour(),
    });
  }
  
  try {
    // Fetch today's NHL schedule
    console.log(`[Schedule Cron] Fetching NHL schedule for ${today}`);
    
    const response = await fetch(
      `https://api-web.nhle.com/v1/schedule/${today}`,
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      }
    );
    
    if (!response.ok) {
      throw new Error(`NHL API error: ${response.status}`);
    }
    
    const data = await response.json();
    const gameWeek = data.gameWeek || [];
    
    // Find today's games
    const todayGames = gameWeek.find((day: any) => day.date === today);
    const games = todayGames?.games || [];
    
    if (games.length === 0) {
      // No games today - set refresh to default 11 AM
      scheduleCache = {
        date: today,
        firstGameTimeET: 'No games',
        targetRefreshHourET: 11,
        games: [],
      };
      
      return NextResponse.json({
        cached: false,
        message: 'No NHL games today',
        ...scheduleCache,
        currentHourET: getETHour(),
      });
    }
    
    // Parse game times and find the earliest
    const gameTimes = games.map((game: any) => {
      const startTime = new Date(game.startTimeUTC);
      const etTime = new Date(startTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hourET = etTime.getHours();
      const minuteET = etTime.getMinutes();
      
      const awayTeam = game.awayTeam?.abbrev || 'TBD';
      const homeTeam = game.homeTeam?.abbrev || 'TBD';
      
      return {
        teams: `${awayTeam} @ ${homeTeam}`,
        timeET: `${hourET}:${minuteET.toString().padStart(2, '0')} ET`,
        hourET,
        startTimeUTC: game.startTimeUTC,
      };
    });
    
    // Sort by time and get first game
    gameTimes.sort((a: any, b: any) => new Date(a.startTimeUTC).getTime() - new Date(b.startTimeUTC).getTime());
    const firstGame = gameTimes[0];
    
    // Calculate optimal refresh time
    const targetRefreshHourET = calculateOptimalRefreshHour(firstGame.hourET);
    
    scheduleCache = {
      date: today,
      firstGameTimeET: firstGame.timeET,
      targetRefreshHourET,
      games: gameTimes.map((g: any) => ({ teams: g.teams, timeET: g.timeET })),
    };
    
    console.log(`[Schedule Cron] First game: ${firstGame.timeET}, target refresh: ${targetRefreshHourET}:00 ET`);
    
    return NextResponse.json({
      cached: false,
      ...scheduleCache,
      currentHourET: getETHour(),
      logic: {
        firstGameHourET: firstGame.hourET,
        calculatedRefresh: targetRefreshHourET,
        reason: targetRefreshHourET === 10 
          ? 'Early game - refresh at morning skate time (10 AM)'
          : targetRefreshHourET === 13
          ? 'Late game - refresh at latest reasonable time (1 PM)'
          : `Standard - refresh ${firstGame.hourET - targetRefreshHourET} hours before first game`,
      },
    });
    
  } catch (error) {
    console.error('[Schedule Cron] Error:', error);
    
    // Default to 11 AM if we can't fetch schedule
    scheduleCache = {
      date: today,
      firstGameTimeET: 'Error fetching',
      targetRefreshHourET: 11,
      games: [],
    };
    
    return NextResponse.json({
      error: 'Failed to fetch schedule',
      defaulting: true,
      ...scheduleCache,
      currentHourET: getETHour(),
    }, { status: 500 });
  }
}

// Export the cache getter for the refresh cron to use
export function getScheduleCache() {
  return scheduleCache;
}
