import { NextResponse } from 'next/server';
import { getWeekSchedule, mapGameState, NHL_TEAMS } from '@/lib/nhl-api';
import { getNHLOdds, processOddsForGame, TEAM_NAME_MAP } from '@/lib/odds-api';

export const revalidate = 120; // Revalidate every 2 minutes
export const dynamic = 'force-dynamic'; // Always run dynamically

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  
  console.log('API /api/games called');
  
  try {
    // Fetch NHL schedule
    let weekSchedule: any[] = [];
    try {
      console.log('Fetching NHL schedule...');
      weekSchedule = await getWeekSchedule();
      console.log('NHL Schedule fetched:', weekSchedule?.length || 0, 'days');
    } catch (nhlError) {
      console.error('NHL API Error:', nhlError);
      return NextResponse.json({
        error: 'Failed to fetch NHL schedule',
        details: nhlError instanceof Error ? nhlError.message : String(nhlError),
        gamesByDate: {},
        dates: []
      });
    }

    // If no schedule data, return empty
    if (!weekSchedule || weekSchedule.length === 0) {
      console.log('No schedule data returned');
      return NextResponse.json({
        gamesByDate: {},
        dates: [],
        message: 'No games found in schedule'
      });
    }

    // Fetch odds (optional - don't fail if this doesn't work)
    let oddsData: any[] = [];
    try {
      console.log('Fetching odds...');
      oddsData = await getNHLOdds();
      console.log('Odds fetched:', oddsData?.length || 0, 'games');
    } catch (oddsError) {
      console.error('Odds API Error (continuing without odds):', oddsError);
    }
    
    // Process games by date
    const gamesByDate: Record<string, any[]> = {};
    
    for (const day of weekSchedule) {
      if (!day || !day.games) {
        console.log('Skipping day with no games:', day?.date);
        continue;
      }
      
      const gamesForDay = day.games.map((game: any) => {
        try {
          // Safely get team info with multiple fallbacks
          const homeTeamId = game.homeTeam?.id;
          const awayTeamId = game.awayTeam?.id;
          
          // Get name - handle both old and new API formats
          const getTeamName = (team: any) => {
            if (!team) return 'Unknown';
            if (typeof team.name === 'string') return team.name;
            if (team.name?.default) return team.name.default;
            if (team.placeName?.default) return team.placeName.default;
            if (team.commonName?.default) return team.commonName.default;
            return 'Unknown';
          };
          
          const homeTeamName = getTeamName(game.homeTeam);
          const awayTeamName = getTeamName(game.awayTeam);
          
          const homeTeamInfo = NHL_TEAMS[homeTeamId] || {
            name: homeTeamName,
            abbrev: game.homeTeam?.abbrev || 'UNK',
            city: '',
          };
          const awayTeamInfo = NHL_TEAMS[awayTeamId] || {
            name: awayTeamName,
            abbrev: game.awayTeam?.abbrev || 'UNK',
            city: '',
          };
          
          // Find matching odds
          const homeFullName = TEAM_NAME_MAP[homeTeamInfo.name] || `${homeTeamInfo.city} ${homeTeamInfo.name}`;
          const awayFullName = TEAM_NAME_MAP[awayTeamInfo.name] || `${awayTeamInfo.city} ${awayTeamInfo.name}`;
          
          const matchingOdds = oddsData.find(odds => {
            if (!odds.home_team || !odds.away_team) return false;
            const oddsHome = odds.home_team.toLowerCase();
            const oddsAway = odds.away_team.toLowerCase();
            const homeMatch = oddsHome.includes(homeTeamInfo.name.toLowerCase()) ||
                            homeFullName.toLowerCase().includes(oddsHome.split(' ').pop() || '');
            const awayMatch = oddsAway.includes(awayTeamInfo.name.toLowerCase()) ||
                            awayFullName.toLowerCase().includes(oddsAway.split(' ').pop() || '');
            return homeMatch && awayMatch;
          });
          
          const odds = matchingOdds ? processOddsForGame(matchingOdds) : [];
          const prediction = generateSimplePrediction(odds);
          
          return {
            id: String(game.id || Math.random()),
            homeTeam: {
              id: game.homeTeam?.id || 0,
              name: `${homeTeamInfo.city} ${homeTeamInfo.name}`.trim(),
              abbreviation: game.homeTeam?.abbrev || homeTeamInfo.abbrev,
            },
            awayTeam: {
              id: game.awayTeam?.id || 0,
              name: `${awayTeamInfo.city} ${awayTeamInfo.name}`.trim(),
              abbreviation: game.awayTeam?.abbrev || awayTeamInfo.abbrev,
            },
            startTime: game.startTimeUTC || game.gameDate,
            status: mapGameState(game.gameState || 'FUT'),
            homeScore: game.homeTeam?.score,
            awayScore: game.awayTeam?.score,
            venue: game.venue?.default,
            odds,
            prediction,
          };
        } catch (gameError) {
          console.error('Error processing game:', gameError, game);
          return null;
        }
      }).filter(Boolean);
      
      if (gamesForDay.length > 0) {
        gamesByDate[day.date] = gamesForDay;
      }
    }
    
    // If specific date requested, return just that day
    if (date && gamesByDate[date]) {
      return NextResponse.json({
        date,
        games: gamesByDate[date],
      });
    }
    
    // Return all days
    return NextResponse.json({
      gamesByDate,
      dates: Object.keys(gamesByDate).sort(),
    });
    
  } catch (error) {
    console.error('Unhandled error in /api/games:', error);
    return NextResponse.json({
      error: 'Failed to fetch games',
      details: error instanceof Error ? error.message : String(error),
      gamesByDate: {},
      dates: []
    });
  }
}

function generateSimplePrediction(odds: any[]) {
  if (!odds || odds.length === 0) {
    return {
      homeWinProbability: 0.5,
      awayWinProbability: 0.5,
      predictedTotal: 5.5,
      confidence: 0.5,
    };
  }
  
  const firstOdds = odds[0];
  const homeProb = americanToImpliedProbability(firstOdds.homeMoneyline || 0);
  const awayProb = americanToImpliedProbability(firstOdds.awayMoneyline || 0);
  
  const total = homeProb + awayProb;
  const normalizedHome = total > 0 ? homeProb / total : 0.5;
  const normalizedAway = total > 0 ? awayProb / total : 0.5;
  
  return {
    homeWinProbability: Math.round(normalizedHome * 100) / 100,
    awayWinProbability: Math.round(normalizedAway * 100) / 100,
    predictedTotal: firstOdds.totalLine || 5.5,
    confidence: 0.65,
  };
}

function americanToImpliedProbability(odds: number): number {
  if (!odds || odds === 0) return 0.5;
  
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}
