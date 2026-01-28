// NHL API Service
// Using the undocumented NHL Web API (no auth required)

const NHL_API_BASE = 'https://api-web.nhle.com/v1';

// Helper to fetch with timeout
async function fetchWithTimeout(url: string, timeoutMs: number = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'HockeyEdge/1.0',
      },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export interface NHLGame {
  id: number;
  season: number;
  gameType: number;
  gameDate: string;
  startTimeUTC: string;
  homeTeam: {
    id: number;
    name: { default: string };
    abbrev: string;
    score?: number;
  };
  awayTeam: {
    id: number;
    name: { default: string };
    abbrev: string;
    score?: number;
  };
  gameState: 'FUT' | 'PRE' | 'LIVE' | 'CRIT' | 'FINAL' | 'OFF';
  gameScheduleState: string;
  venue: {
    default: string;
  };
}

export interface NHLScheduleResponse {
  gameWeek: {
    date: string;
    games: NHLGame[];
  }[];
}

// Team ID to abbreviation mapping (for consistency)
export const NHL_TEAMS: Record<number, { name: string; abbrev: string; city: string }> = {
  1: { name: 'Devils', abbrev: 'NJD', city: 'New Jersey' },
  2: { name: 'Islanders', abbrev: 'NYI', city: 'New York' },
  3: { name: 'Rangers', abbrev: 'NYR', city: 'New York' },
  4: { name: 'Flyers', abbrev: 'PHI', city: 'Philadelphia' },
  5: { name: 'Penguins', abbrev: 'PIT', city: 'Pittsburgh' },
  6: { name: 'Bruins', abbrev: 'BOS', city: 'Boston' },
  7: { name: 'Sabres', abbrev: 'BUF', city: 'Buffalo' },
  8: { name: 'Canadiens', abbrev: 'MTL', city: 'Montréal' },
  9: { name: 'Senators', abbrev: 'OTT', city: 'Ottawa' },
  10: { name: 'Maple Leafs', abbrev: 'TOR', city: 'Toronto' },
  12: { name: 'Hurricanes', abbrev: 'CAR', city: 'Carolina' },
  13: { name: 'Panthers', abbrev: 'FLA', city: 'Florida' },
  14: { name: 'Lightning', abbrev: 'TBL', city: 'Tampa Bay' },
  15: { name: 'Capitals', abbrev: 'WSH', city: 'Washington' },
  16: { name: 'Blackhawks', abbrev: 'CHI', city: 'Chicago' },
  17: { name: 'Red Wings', abbrev: 'DET', city: 'Detroit' },
  18: { name: 'Predators', abbrev: 'NSH', city: 'Nashville' },
  19: { name: 'Blues', abbrev: 'STL', city: 'St. Louis' },
  20: { name: 'Flames', abbrev: 'CGY', city: 'Calgary' },
  21: { name: 'Avalanche', abbrev: 'COL', city: 'Colorado' },
  22: { name: 'Oilers', abbrev: 'EDM', city: 'Edmonton' },
  23: { name: 'Canucks', abbrev: 'VAN', city: 'Vancouver' },
  24: { name: 'Ducks', abbrev: 'ANA', city: 'Anaheim' },
  25: { name: 'Stars', abbrev: 'DAL', city: 'Dallas' },
  26: { name: 'Kings', abbrev: 'LAK', city: 'Los Angeles' },
  28: { name: 'Sharks', abbrev: 'SJS', city: 'San Jose' },
  29: { name: 'Blue Jackets', abbrev: 'CBJ', city: 'Columbus' },
  30: { name: 'Wild', abbrev: 'MIN', city: 'Minnesota' },
  52: { name: 'Jets', abbrev: 'WPG', city: 'Winnipeg' },
  53: { name: 'Coyotes', abbrev: 'ARI', city: 'Arizona' },
  54: { name: 'Golden Knights', abbrev: 'VGK', city: 'Vegas' },
  55: { name: 'Kraken', abbrev: 'SEA', city: 'Seattle' },
  59: { name: 'Utah Hockey Club', abbrev: 'UTA', city: 'Utah' },
};

/**
 * Get today's NHL schedule
 */
export async function getTodaySchedule(): Promise<NHLGame[]> {
  try {
    const response = await fetch(`${NHL_API_BASE}/schedule/now`, {
      next: { revalidate: 300 }, // Cache for 5 minutes
    });
    
    if (!response.ok) {
      throw new Error(`NHL API error: ${response.status}`);
    }
    
    const data: NHLScheduleResponse = await response.json();
    
    // Get today's games
    const today = new Date().toISOString().split('T')[0];
    const todayGames = data.gameWeek?.find(week => week.date === today)?.games || [];
    
    return todayGames;
  } catch (error) {
    console.error('Error fetching NHL schedule:', error);
    return [];
  }
}

/**
 * Get schedule for a specific date
 */
export async function getScheduleByDate(date: string): Promise<NHLGame[]> {
  try {
    const response = await fetch(`${NHL_API_BASE}/schedule/${date}`, {
      next: { revalidate: 300 },
    });
    
    if (!response.ok) {
      throw new Error(`NHL API error: ${response.status}`);
    }
    
    const data: NHLScheduleResponse = await response.json();
    const games = data.gameWeek?.find(week => week.date === date)?.games || [];
    
    return games;
  } catch (error) {
    console.error('Error fetching NHL schedule:', error);
    return [];
  }
}

/**
 * Get the full week schedule
 */
export async function getWeekSchedule(): Promise<NHLScheduleResponse['gameWeek']> {
  const url = `${NHL_API_BASE}/schedule/now`;
  console.log('Fetching NHL schedule from:', url);
  
  try {
    const response = await fetchWithTimeout(url, 15000);
    console.log('NHL API response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('NHL API error response:', errorText);
      throw new Error(`NHL API error: ${response.status} - ${errorText}`);
    }
    
    const data: NHLScheduleResponse = await response.json();
    console.log('NHL schedule data received, gameWeek length:', data.gameWeek?.length || 0);
    return data.gameWeek || [];
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('NHL API request timed out after 15 seconds');
      throw new Error('NHL API request timed out');
    }
    console.error('Error fetching NHL schedule:', error);
    throw error;
  }
}

/**
 * Convert NHL API game state to our status
 */
export function mapGameState(state: string): 'scheduled' | 'live' | 'final' {
  switch (state) {
    case 'LIVE':
    case 'CRIT':
      return 'live';
    case 'FINAL':
    case 'OFF':
      return 'final';
    default:
      return 'scheduled';
  }
}

/**
 * Get team info by ID
 */
export function getTeamInfo(teamId: number) {
  return NHL_TEAMS[teamId] || { name: 'Unknown', abbrev: 'UNK', city: 'Unknown' };
}
