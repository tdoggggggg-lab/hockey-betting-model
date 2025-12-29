import { NextResponse } from 'next/server';
import { getWeekSchedule } from '@/lib/nhl-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PropPrediction {
  playerId: number;
  playerName: string;
  team: string;
  teamAbbrev: string;
  opponent: string;
  opponentAbbrev: string;
  gameTime: string;
  isHome: boolean;
  propType: string;
  expectedValue: number;
  probability: number;
  line: number;
  confidence: number;
  isValueBet: boolean;
  bookmakerOdds?: number;
  breakdown: {
    basePrediction: number;
    homeAwayAdj: number;
    backToBackAdj: number;
    opponentAdj: number;
    recentFormAdj: number;
    goalieAdj: number;
    toiAdj: number;
    shotVolumeAdj: number;
    finalPrediction: number;
  };
}

// Manual injury list
const INJURED_PLAYERS: Record<string, string[]> = {
  'COL': ['Gabriel Landeskog'],
  'EDM': ['Evander Kane'],
  'TBL': ['Brandon Hagel'],
  'CAR': ['Seth Jarvis'],
  'VAN': ['Thatcher Demko'],
  'PHI': ['Tyson Foerster'],
};

// Elite scorers get confidence boost
const ELITE_SCORERS = new Set([
  'Connor McDavid', 'Nathan MacKinnon', 'Auston Matthews', 'Leon Draisaitl',
  'Nikita Kucherov', 'David Pastrnak', 'Cale Makar', 'Kirill Kaprizov',
  'Mikko Rantanen', 'Sam Reinhart', 'Jake Guentzel', 'Matthew Tkachuk',
  'Jack Eichel', 'Mitch Marner', 'Sidney Crosby', 'Aleksander Barkov',
  'Sebastian Aho', 'Brayden Point', 'Brady Tkachuk', 'Tim Stutzle',
  'Kyle Connor', 'Mark Scheifele', 'Artemi Panarin', 'Adam Fox',
  'Quinn Hughes', 'Zach Hyman', 'William Nylander', 'Jason Robertson',
  'Tage Thompson', 'Dylan Larkin', 'Trevor Zegras', 'Clayton Keller',
]);

function isPlayerInjured(name: string, teamAbbrev: string): boolean {
  const teamInjuries = INJURED_PLAYERS[teamAbbrev] || [];
  const nameLower = name.toLowerCase();
  return teamInjuries.some(injured => 
    injured.toLowerCase() === nameLower ||
    nameLower.includes(injured.split(' ')[1]?.toLowerCase() || '')
  );
}

function poissonAtLeastOne(lambda: number): number {
  return 1 - Math.exp(-lambda);
}

async function getTeamGAA(teamAbbrev: string): Promise<number> {
  try {
    const response = await fetch('https://api-web.nhle.com/v1/standings/now');
    if (!response.ok) return 3.0;
    const data = await response.json();
    const team = (data.standings || []).find((t: any) => t.teamAbbrev?.default === teamAbbrev);
    return team && team.gamesPlayed > 0 ? team.goalAgainst / team.gamesPlayed : 3.0;
  } catch { return 3.0; }
}

async function isBackToBack(teamAbbrev: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/club-schedule/${teamAbbrev}/week/now`);
    if (!response.ok) return false;
    const data = await response.json();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    return (data.games || []).some((g: any) => g.gameDate === yesterdayStr);
  } catch { return false; }
}

async function getPlayerStats(teamAbbrev: string): Promise<any[]> {
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.skaters || [];
  } catch { return []; }
}

async function processGame(game: any): Promise<{ predictions: PropPrediction[], playerCount: number }> {
  const predictions: PropPrediction[] = [];
  let playerCount = 0;
  
  try {
    const homeAbbrev = game.homeTeam?.abbrev;
    const awayAbbrev = game.awayTeam?.abbrev;
    if (!homeAbbrev || !awayAbbrev) return { predictions, playerCount };
    
    const [homePlayers, awayPlayers, homeB2B, awayB2B, homeGAA, awayGAA] = await Promise.all([
      getPlayerStats(homeAbbrev),
      getPlayerStats(awayAbbrev),
      isBackToBack(homeAbbrev),
      isBackToBack(awayAbbrev),
      getTeamGAA(homeAbbrev),
      getTeamGAA(awayAbbrev),
    ]);
    
    let gameTime = 'TBD';
    if (game.startTimeUTC) {
      gameTime = new Date(game.startTimeUTC).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York'
      });
    }
    
    const getTeamName = (team: any) => {
      if (!team) return 'Unknown';
      if (team.placeName?.default && team.commonName?.default) {
        return `${team.placeName.default} ${team.commonName.default}`;
      }
      return team.abbrev || 'Unknown';
    };
    
    // Process home team
    for (const player of homePlayers) {
      const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
      if (isPlayerInjured(name, homeAbbrev)) continue;
      
      const gamesPlayed = player.gamesPlayed || 1;
      const goals = player.goals || 0;
      const shots = player.shots || 0;
      
      if (gamesPlayed < 10) continue;
      
      const baseLambda = goals / gamesPlayed;
      if (baseLambda < 0.05) continue;
      
      const homeAwayAdj = 1.05;
      const b2bAdj = homeB2B ? 0.85 : 1.0;
      let opponentAdj = 1.0;
      if (awayGAA >= 3.5) opponentAdj = 1.12;
      else if (awayGAA <= 2.5) opponentAdj = 0.88;
      
      const shotsPerGame = shots / gamesPlayed;
      const toiAdj = Math.min(1.15, Math.max(0.85, 0.9 + shotsPerGame * 0.05));
      
      const finalLambda = baseLambda * homeAwayAdj * b2bAdj * opponentAdj * toiAdj;
      const probability = poissonAtLeastOne(finalLambda);
      
      let confidence = 0.3;
      if (ELITE_SCORERS.has(name)) confidence += 0.35;
      else if (baseLambda >= 0.35) confidence += 0.25;
      else if (baseLambda >= 0.20) confidence += 0.15;
      if (gamesPlayed >= 30) confidence += 0.15;
      else if (gamesPlayed >= 20) confidence += 0.10;
      if (!homeB2B) confidence += 0.05;
      confidence = Math.min(0.95, confidence);
      
      predictions.push({
        playerId: player.playerId,
        playerName: name,
        team: getTeamName(game.homeTeam),
        teamAbbrev: homeAbbrev,
        opponent: getTeamName(game.awayTeam),
        opponentAbbrev: awayAbbrev,
        gameTime,
        isHome: true,
        propType: 'goalscorer',
        expectedValue: finalLambda,
        probability,
        line: 0.5,
        confidence,
        isValueBet: false,
        breakdown: { basePrediction: baseLambda, homeAwayAdj, backToBackAdj: b2bAdj, opponentAdj, recentFormAdj: 1.0, goalieAdj: 1.0, toiAdj, shotVolumeAdj: 1.0, finalPrediction: finalLambda },
      });
      playerCount++;
    }
    
    // Process away team
    for (const player of awayPlayers) {
      const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
      if (isPlayerInjured(name, awayAbbrev)) continue;
      
      const gamesPlayed = player.gamesPlayed || 1;
      const goals = player.goals || 0;
      const shots = player.shots || 0;
      
      if (gamesPlayed < 10) continue;
      
      const baseLambda = goals / gamesPlayed;
      if (baseLambda < 0.05) continue;
      
      const homeAwayAdj = 0.95;
      const b2bAdj = awayB2B ? 0.85 : 1.0;
      let opponentAdj = 1.0;
      if (homeGAA >= 3.5) opponentAdj = 1.12;
      else if (homeGAA <= 2.5) opponentAdj = 0.88;
      
      const shotsPerGame = shots / gamesPlayed;
      const toiAdj = Math.min(1.15, Math.max(0.85, 0.9 + shotsPerGame * 0.05));
      
      const finalLambda = baseLambda * homeAwayAdj * b2bAdj * opponentAdj * toiAdj;
      const probability = poissonAtLeastOne(finalLambda);
      
      let confidence = 0.3;
      if (ELITE_SCORERS.has(name)) confidence += 0.35;
      else if (baseLambda >= 0.35) confidence += 0.25;
      else if (baseLambda >= 0.20) confidence += 0.15;
      if (gamesPlayed >= 30) confidence += 0.15;
      else if (gamesPlayed >= 20) confidence += 0.10;
      if (!awayB2B) confidence += 0.05;
      confidence = Math.min(0.95, confidence);
      
      predictions.push({
        playerId: player.playerId,
        playerName: name,
        team: getTeamName(game.awayTeam),
        teamAbbrev: awayAbbrev,
        opponent: getTeamName(game.homeTeam),
        opponentAbbrev: homeAbbrev,
        gameTime,
        isHome: false,
        propType: 'goalscorer',
        expectedValue: finalLambda,
        probability,
        line: 0.5,
        confidence,
        isValueBet: false,
        breakdown: { basePrediction: baseLambda, homeAwayAdj, backToBackAdj: b2bAdj, opponentAdj, recentFormAdj: 1.0, goalieAdj: 1.0, toiAdj, shotVolumeAdj: 1.0, finalPrediction: finalLambda },
      });
      playerCount++;
    }
  } catch (error) {
    console.error('Error processing game:', error);
  }
  
  return { predictions, playerCount };
}

export async function GET(request: Request) {
  try {
    const weekSchedule = await getWeekSchedule();
    const today = new Date().toISOString().split('T')[0];
    const todaySchedule = weekSchedule.find(d => d.date === today);
    const todayGames = todaySchedule?.games || weekSchedule[0]?.games || [];
    
    if (!todayGames.length) {
      return NextResponse.json({
        predictions: [], valueBets: [], lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0, playersAnalyzed: 0,
      });
    }
    
    console.log(`Processing ${todayGames.length} games...`);
    
    // Process all games in PARALLEL
    const results = await Promise.all(todayGames.map((game: any) => processGame(game)));
    
    const allPredictions: PropPrediction[] = [];
    let totalPlayers = 0;
    
    for (const result of results) {
      allPredictions.push(...result.predictions);
      totalPlayers += result.playerCount;
    }
    
    console.log(`Generated ${allPredictions.length} predictions from ${totalPlayers} players`);
    
    allPredictions.sort((a, b) => b.probability - a.probability);
    
    const topPicks = [...allPredictions]
      .filter(p => p.probability >= 0.25 && p.confidence >= 0.50)
      .sort((a, b) => (b.probability * 0.5 + b.confidence * 0.5) - (a.probability * 0.5 + a.confidence * 0.5))
      .slice(0, 10)
      .map(p => ({ ...p, isValueBet: true }));
    
    const topPickIds = new Set(topPicks.map(p => p.playerId));
    const markedPredictions = allPredictions.map(p => ({ ...p, isValueBet: topPickIds.has(p.playerId) }));
    
    return NextResponse.json({
      predictions: markedPredictions,
      valueBets: topPicks,
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: todayGames.length,
      playersAnalyzed: totalPlayers,
    });
    
  } catch (error) {
    console.error('Error in props API:', error);
    return NextResponse.json({
      predictions: [], valueBets: [], lastUpdated: new Date().toISOString(),
      gamesAnalyzed: 0, playersAnalyzed: 0, error: 'Failed to generate predictions'
    });
  }
}
