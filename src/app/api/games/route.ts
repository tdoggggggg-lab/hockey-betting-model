import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HOME_ICE_BOOST = 0.045;
const B2B_PENALTY = 0.073;

interface TeamStats {
  teamAbbrev: string;
  teamName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  pointsPct: number;
}

async function getTeamStats(teamAbbrev: string): Promise<TeamStats | null> {
  try {
    const res = await fetch('https://api-web.nhle.com/v1/standings/now');
    if (!res.ok) return null;
    const data = await res.json();
    const team = (data.standings || []).find(
      (t: any) => t.teamAbbrev?.default === teamAbbrev
    );
    if (!team) return null;
    const gp = team.gamesPlayed || 1;
    return {
      teamAbbrev,
      teamName: team.teamName?.default || teamAbbrev,
      gamesPlayed: gp,
      wins: team.wins || 0,
      losses: team.losses || 0,
      goalsFor: team.goalFor || 0,
      goalsAgainst: team.goalAgainst || 0,
      goalsForPerGame: (team.goalFor || 0) / gp,
      goalsAgainstPerGame: (team.goalAgainst || 0) / gp,
      pointsPct: (team.points || 0) / (gp * 2),
    };
  } catch {
    return null;
  }
}

async function isBackToBack(teamAbbrev: string, gameDate: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/club-schedule/${teamAbbrev}/week/now`);
    if (!res.ok) return false;
    const data = await res.json();
    const yesterday = new Date(gameDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    return (data.games || []).some((g: any) => g.gameDate === yesterdayStr);
  } catch {
    return false;
  }
}

function predictGame(homeStats: TeamStats, awayStats: TeamStats, homeB2B: boolean, awayB2B: boolean) {
  const homeGD = homeStats.goalsForPerGame - homeStats.goalsAgainstPerGame;
  const awayGD = awayStats.goalsForPerGame - awayStats.goalsAgainstPerGame;
  const gdAdvantage = homeGD - awayGD;
  
  let baseProb = 1 / (1 + Math.exp(-0.18 * gdAdvantage * 10));
  baseProb = 0.5 + (baseProb - 0.5) * 0.75;
  
  let restAdj = 0;
  if (homeB2B && !awayB2B) restAdj = -B2B_PENALTY;
  else if (!homeB2B && awayB2B) restAdj = B2B_PENALTY;
  
  const ptsPctDiff = homeStats.pointsPct - awayStats.pointsPct;
  const ptsPctAdj = ptsPctDiff * 0.15;
  
  let homeWinProb = baseProb + HOME_ICE_BOOST + restAdj + ptsPctAdj;
  homeWinProb = Math.max(0.28, Math.min(0.72, homeWinProb));
  
  const predictedTotal = homeStats.goalsForPerGame + awayStats.goalsForPerGame;
  
  let confidence = 0.45;
  if (homeStats.gamesPlayed >= 20 && awayStats.gamesPlayed >= 20) confidence += 0.15;
  if (Math.abs(homeWinProb - 0.5) > 0.12) confidence += 0.1;
  if (Math.abs(restAdj) > 0) confidence += 0.1;
  confidence = Math.min(0.80, confidence);
  
  return { homeWinProb, awayWinProb: 1 - homeWinProb, predictedTotal, confidence };
}

export async function GET() {
  try {
    // Fetch week schedule
    const schedRes = await fetch('https://api-web.nhle.com/v1/schedule/now');
    if (!schedRes.ok) {
      return NextResponse.json({ gamesByDate: {}, dates: [], error: 'Schedule API error' });
    }
    
    const schedData = await schedRes.json();
    const gameWeek = schedData.gameWeek || [];
    
    console.log('NHL schedule data received, gameWeek length:', gameWeek.length);
    
    const gamesByDate: Record<string, any[]> = {};
    const dates: string[] = [];
    
    for (const day of gameWeek) {
      const dateStr = day.date;
      if (!dateStr) continue;
      
      dates.push(dateStr);
      gamesByDate[dateStr] = [];
      
      const games = day.games || [];
      
      for (const game of games) {
        const homeAbbrev = game.homeTeam?.abbrev;
        const awayAbbrev = game.awayTeam?.abbrev;
        if (!homeAbbrev || !awayAbbrev) continue;
        
        // Get team stats and B2B status
        const [homeStats, awayStats, homeB2B, awayB2B] = await Promise.all([
          getTeamStats(homeAbbrev),
          getTeamStats(awayAbbrev),
          isBackToBack(homeAbbrev, dateStr),
          isBackToBack(awayAbbrev, dateStr),
        ]);
        
        let prediction = {
          homeWinProbability: 0.5,
          awayWinProbability: 0.5,
          predictedTotal: 5.5,
          confidence: 0.5,
        };
        
        if (homeStats && awayStats) {
          const pred = predictGame(homeStats, awayStats, homeB2B, awayB2B);
          prediction = {
            homeWinProbability: pred.homeWinProb,
            awayWinProbability: pred.awayWinProb,
            predictedTotal: pred.predictedTotal,
            confidence: pred.confidence,
          };
        }
        
        const getTeamName = (team: any) => {
          if (team?.placeName?.default && team?.commonName?.default) {
            return `${team.placeName.default} ${team.commonName.default}`;
          }
          return team?.abbrev || 'Unknown';
        };
        
        gamesByDate[dateStr].push({
          id: `${game.id}`,
          homeTeam: {
            id: game.homeTeam?.id || 0,
            name: getTeamName(game.homeTeam),
            abbreviation: homeAbbrev,
          },
          awayTeam: {
            id: game.awayTeam?.id || 0,
            name: getTeamName(game.awayTeam),
            abbreviation: awayAbbrev,
          },
          startTime: game.startTimeUTC || '',
          status: game.gameState === 'LIVE' ? 'live' : game.gameState === 'FINAL' ? 'final' : 'scheduled',
          prediction,
          odds: [], // Odds API integration pending
        });
      }
    }
    
    return NextResponse.json({
      gamesByDate,
      dates,
      lastUpdated: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('Games API error:', error);
    return NextResponse.json({ gamesByDate: {}, dates: [], error: 'Failed to fetch games' });
  }
}
