import { NextResponse } from 'next/server';
import { getWeekSchedule, mapGameState, NHL_TEAMS } from '@/lib/nhl-api';
import { getNHLOdds, processOddsForGame, TEAM_NAME_MAP } from '@/lib/odds-api';

export const revalidate = 120; // Revalidate every 2 minutes

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date'); // Optional: specific date
  
  try {
    // Fetch both data sources in parallel
    const [weekSchedule, oddsData] = await Promise.all([
      getWeekSchedule(),
      getNHLOdds(),
    ]);
    
    // Process games by date
    const gamesByDate: Record<string, any[]> = {};
    
    for (const day of weekSchedule) {
      const gamesForDay = day.games.map(game => {
        const homeTeamInfo = NHL_TEAMS[game.homeTeam.id] || {
          name: game.homeTeam.name.default,
          abbrev: game.homeTeam.abbrev,
          city: '',
        };
        const awayTeamInfo = NHL_TEAMS[game.awayTeam.id] || {
          name: game.awayTeam.name.default,
          abbrev: game.awayTeam.abbrev,
          city: '',
        };
        
        // Find matching odds
        const homeFullName = TEAM_NAME_MAP[homeTeamInfo.name] || `${homeTeamInfo.city} ${homeTeamInfo.name}`;
        const awayFullName = TEAM_NAME_MAP[awayTeamInfo.name] || `${awayTeamInfo.city} ${awayTeamInfo.name}`;
        
        const matchingOdds = oddsData.find(odds => {
          const oddsHome = odds.home_team.toLowerCase();
          const oddsAway = odds.away_team.toLowerCase();
          const homeMatch = oddsHome.includes(homeTeamInfo.name.toLowerCase()) ||
                          homeFullName.toLowerCase().includes(oddsHome.split(' ').pop() || '');
          const awayMatch = oddsAway.includes(awayTeamInfo.name.toLowerCase()) ||
                          awayFullName.toLowerCase().includes(oddsAway.split(' ').pop() || '');
          return homeMatch && awayMatch;
        });
        
        const odds = matchingOdds ? processOddsForGame(matchingOdds) : [];
        
        // Generate simple prediction (placeholder until we build the real model)
        const prediction = generateSimplePrediction(odds);
        
        return {
          id: game.id.toString(),
          homeTeam: {
            id: game.homeTeam.id,
            name: `${homeTeamInfo.city} ${homeTeamInfo.name}`.trim(),
            abbreviation: game.homeTeam.abbrev,
          },
          awayTeam: {
            id: game.awayTeam.id,
            name: `${awayTeamInfo.city} ${awayTeamInfo.name}`.trim(),
            abbreviation: game.awayTeam.abbrev,
          },
          startTime: game.startTimeUTC,
          status: mapGameState(game.gameState),
          homeScore: game.homeTeam.score,
          awayScore: game.awayTeam.score,
          venue: game.venue?.default,
          odds,
          prediction,
        };
      });
      
      gamesByDate[day.date] = gamesForDay;
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
      dates: Object.keys(gamesByDate),
    });
    
  } catch (error) {
    console.error('Error fetching games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}

/**
 * Simple prediction based on moneyline odds (placeholder)
 * Will be replaced with our ML model
 */
function generateSimplePrediction(odds: any[]) {
  if (odds.length === 0) {
    return {
      homeWinProbability: 0.5,
      awayWinProbability: 0.5,
      predictedTotal: 5.5,
      confidence: 0.5,
    };
  }
  
  // Use first bookmaker's odds to estimate probabilities
  const firstOdds = odds[0];
  
  // Convert American odds to implied probability
  const homeProb = americanToImpliedProbability(firstOdds.homeMoneyline);
  const awayProb = americanToImpliedProbability(firstOdds.awayMoneyline);
  
  // Normalize to remove vig
  const total = homeProb + awayProb;
  const normalizedHome = homeProb / total;
  const normalizedAway = awayProb / total;
  
  return {
    homeWinProbability: Math.round(normalizedHome * 100) / 100,
    awayWinProbability: Math.round(normalizedAway * 100) / 100,
    predictedTotal: firstOdds.totalLine,
    confidence: 0.65, // Placeholder
  };
}

/**
 * Convert American odds to implied probability
 */
function americanToImpliedProbability(odds: number): number {
  if (odds === 0) return 0.5;
  
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}
