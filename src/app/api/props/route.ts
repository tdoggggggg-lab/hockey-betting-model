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

// Manual injury list - UPDATE REGULARLY
const INJURED_PLAYERS: Record<string, string[]> = {
  'COL': ['Gabriel Landeskog'],
  'EDM': ['Evander Kane'],
  'TBL': ['Brandon Hagel'],
  'CAR': ['Seth Jarvis'],
  'VAN': ['Thatcher Demko'],
  'PHI': ['Tyson Foerster'],
};

// Known elite scorers - these get confidence boost
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

// Check if player is injured
function isPlayerInjured(name: string, teamAbbrev: string): boolean {
  const teamInjuries = INJURED_PLAYERS[teamAbbrev] || [];
  const nameLower = name.toLowerCase();
  return teamInjuries.some(injured => 
    injured.toLowerCase() === nameLower ||
    nameLower.includes(injured.split(' ')[1]?.toLowerCase() || '')
  );
}

// Calculate Poisson probability P(X >= 1)
function poissonAtLeastOne(lambda: number): number {
  return 1 - Math.exp(-lambda);
}

// Get team goals against average
async function getTeamGAA(teamAbbrev: string): Promise<number> {
  try {
    const response = await fetch('https://api-web.nhle.com/v1/standings/now');
    if (!response.ok) return 3.0;
    const data = await response.json();
    const team = (data.standings || []).find((t: any) => t.teamAbbrev?.default === teamAbbrev);
    if (team && team.gamesPlayed > 0) {
      return team.goalAgainst / team.gamesPlayed;
    }
    return 3.0;
  } catch {
    return 3.0;
  }
}

// Check back-to-back
async function isBackToBack(teamAbbrev: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/club-schedule/${teamAbbrev}/week/now`);
    if (!response.ok) return false;
    const data = await response.json();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    return (data.games || []).some((g: any) => g.gameDate === yesterdayStr);
  } catch {
    return false;
  }
}

// Fetch player stats
async function getPlayerStats(teamAbbrev: string): Promise<any[]> {
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.skaters || [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const propType = searchParams.get('type') || 'goalscorer';
    
    // Get today's schedule
    const weekSchedule = await getWeekSchedule();
    const today = new Date().toISOString().split('T')[0];
    const todaySchedule = weekSchedule.find(d => d.date === today);
    const todayGames = todaySchedule?.games || weekSchedule[0]?.games || [];
    
    if (!todayGames.length) {
      return NextResponse.json({
        predictions: [],
        valueBets: [],
        lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0,
        playersAnalyzed: 0,
      });
    }
    
    const allPredictions: PropPrediction[] = [];
    let totalPlayers = 0;
    
    // Process each game
    for (const game of todayGames) {
      const homeAbbrev = game.homeTeam?.abbrev;
      const awayAbbrev = game.awayTeam?.abbrev;
      if (!homeAbbrev || !awayAbbrev) continue;
      
      // Fetch data in parallel
      const [homePlayers, awayPlayers, homeB2B, awayB2B, homeGAA, awayGAA] = await Promise.all([
        getPlayerStats(homeAbbrev),
        getPlayerStats(awayAbbrev),
        isBackToBack(homeAbbrev),
        isBackToBack(awayAbbrev),
        getTeamGAA(homeAbbrev),
        getTeamGAA(awayAbbrev),
      ]);
      
      // Format game time
      let gameTime = 'TBD';
      if (game.startTimeUTC) {
        gameTime = new Date(game.startTimeUTC).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'America/New_York'
        });
      }
      
      const getTeamName = (team: any) => {
        if (!team) return 'Unknown';
        if (team.placeName?.default && team.commonName?.default) {
          return `${team.placeName.default} ${team.commonName.default}`;
        }
        return team.abbrev || 'Unknown';
      };
      
      // Process home team players
      for (const player of homePlayers) {
        const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
        
        // Skip injured players
        if (isPlayerInjured(name, homeAbbrev)) {
          console.log(`Skipping injured player: ${name} (${homeAbbrev})`);
          continue;
        }
        
        const gamesPlayed = player.gamesPlayed || 1;
        const goals = player.goals || 0;
        const shots = player.shots || 0;
        
        // MINIMUM GAMES REQUIREMENT - prevents small sample size issues
        if (gamesPlayed < 10) continue;
        
        let baseLambda = goals / gamesPlayed;
        
        // Skip players with very low goal rates
        if (baseLambda < 0.05) continue;
        
        // Adjustments
        const homeAwayAdj = 1.05;
        const b2bAdj = homeB2B ? 0.85 : 1.0;
        let opponentAdj = 1.0;
        if (awayGAA >= 3.5) opponentAdj = 1.12;
        else if (awayGAA <= 2.5) opponentAdj = 0.88;
        
        // TOI adjustment (shots as proxy)
        const shotsPerGame = shots / gamesPlayed;
        const toiAdj = Math.min(1.15, Math.max(0.85, 0.9 + shotsPerGame * 0.05));
        
        const finalLambda = baseLambda * homeAwayAdj * b2bAdj * opponentAdj * toiAdj;
        const probability = poissonAtLeastOne(finalLambda);
        
        // CONFIDENCE - heavily favor proven scorers
        let confidence = 0.3; // Base
        if (ELITE_SCORERS.has(name)) confidence += 0.35;
        else if (baseLambda >= 0.35) confidence += 0.25;
        else if (baseLambda >= 0.20) confidence += 0.15;
        
        if (gamesPlayed >= 30) confidence += 0.15;
        else if (gamesPlayed >= 20) confidence += 0.10;
        
        if (!homeB2B) confidence += 0.05;
        confidence = Math.min(0.95, confidence);
        
        allPredictions.push({
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
          breakdown: {
            basePrediction: baseLambda,
            homeAwayAdj,
            backToBackAdj: b2bAdj,
            opponentAdj,
            recentFormAdj: 1.0,
            goalieAdj: 1.0,
            toiAdj,
            shotVolumeAdj: 1.0,
            finalPrediction: finalLambda,
          },
        });
        totalPlayers++;
      }
      
      // Process away team players (same logic)
      for (const player of awayPlayers) {
        const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
        
        if (isPlayerInjured(name, awayAbbrev)) {
          console.log(`Skipping injured player: ${name} (${awayAbbrev})`);
          continue;
        }
        
        const gamesPlayed = player.gamesPlayed || 1;
        const goals = player.goals || 0;
        const shots = player.shots || 0;
        
        if (gamesPlayed < 10) continue;
        
        let baseLambda = goals / gamesPlayed;
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
        
        allPredictions.push({
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
          breakdown: {
            basePrediction: baseLambda,
            homeAwayAdj,
            backToBackAdj: b2bAdj,
            opponentAdj,
            recentFormAdj: 1.0,
            goalieAdj: 1.0,
            toiAdj,
            shotVolumeAdj: 1.0,
            finalPrediction: finalLambda,
          },
        });
        totalPlayers++;
      }
    }
    
    // Sort by probability
    allPredictions.sort((a, b) => b.probability - a.probability);
    
    // Top picks: probability * 0.5 + confidence * 0.5 (weight confidence more)
    const topPicks = [...allPredictions]
      .filter(p => p.probability >= 0.25 && p.confidence >= 0.50) // Must have decent confidence
      .sort((a, b) => {
        const scoreA = a.probability * 0.5 + a.confidence * 0.5;
        const scoreB = b.probability * 0.5 + b.confidence * 0.5;
        return scoreB - scoreA;
      })
      .slice(0, 10)
      .map(p => ({ ...p, isValueBet: true }));
    
    const topPickIds = new Set(topPicks.map(p => p.playerId));
    const markedPredictions = allPredictions.map(p => ({
      ...p,
      isValueBet: topPickIds.has(p.playerId)
    }));
    
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
      predictions: [],
      valueBets: [],
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: 0,
      playersAnalyzed: 0,
      error: 'Failed to generate predictions'
    });
  }
}
