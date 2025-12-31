import { NextResponse } from 'next/server';

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

// ============ INJURY DATA ============
interface InjuryInfo {
  name: string;
  status: string;
  detail: string;
}

// In-memory injury cache
let injuryCache: Record<string, InjuryInfo[]> = {};
let lastInjuryFetch = 0;

async function fetchInjuries(): Promise<Record<string, InjuryInfo[]>> {
  const now = Date.now();
  // Cache for 1 hour
  if (now - lastInjuryFetch < 3600000 && Object.keys(injuryCache).length > 0) {
    return injuryCache;
  }
  
  const injuries: Record<string, InjuryInfo[]> = {};
  const teams = ['EDM', 'COL', 'TOR', 'TBL', 'BOS', 'FLA', 'DAL', 'VGK', 'NYR', 'NJD',
                 'CAR', 'WPG', 'MIN', 'VAN', 'LAK', 'CGY', 'OTT', 'DET', 'BUF', 'PIT',
                 'WSH', 'PHI', 'NYI', 'CBJ', 'MTL', 'CHI', 'NSH', 'STL', 'ANA', 'SJS', 'SEA', 'UTA'];
  
  try {
    await Promise.all(teams.map(async (teamAbbrev) => {
      try {
        const res = await fetch(`https://api-web.nhle.com/v1/roster/${teamAbbrev}/current`);
        if (!res.ok) return;
        
        const data = await res.json();
        const teamInjuries: InjuryInfo[] = [];
        
        const allPlayers = [
          ...(data.forwards || []),
          ...(data.defensemen || []),
          ...(data.goalies || []),
        ];
        
        for (const player of allPlayers) {
          if (player.injuryStatus || player.injuries) {
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
        // Skip team
      }
    }));
    
    // Manual backup for known long-term injuries
    const manualInjuries: Record<string, InjuryInfo[]> = {
      'COL': [{ name: 'Gabriel Landeskog', status: 'LTIR', detail: 'Knee' }],
      'EDM': [{ name: 'Evander Kane', status: 'LTIR', detail: 'Hernia' }],
      'TBL': [{ name: 'Brandon Hagel', status: 'IR', detail: 'Lower Body' }],
      'CAR': [{ name: 'Seth Jarvis', status: 'IR', detail: 'Upper Body' }],
      'VAN': [{ name: 'Thatcher Demko', status: 'IR', detail: 'Lower Body' }],
    };
    
    for (const [team, players] of Object.entries(manualInjuries)) {
      if (!injuries[team]) injuries[team] = [];
      for (const player of players) {
        if (!injuries[team].some(p => p.name === player.name)) {
          injuries[team].push(player);
        }
      }
    }
    
    injuryCache = injuries;
    lastInjuryFetch = now;
    
  } catch (error) {
    console.error('Error fetching injuries:', error);
  }
  
  return injuries;
}

function isPlayerInjured(name: string, teamAbbrev: string, injuries: Record<string, InjuryInfo[]>): boolean {
  const teamInjuries = injuries[teamAbbrev] || [];
  const nameLower = name.toLowerCase();
  const lastName = name.split(' ').pop()?.toLowerCase() || '';
  
  return teamInjuries.some(injured => {
    const injuredLower = injured.name.toLowerCase();
    return injuredLower === nameLower || injuredLower.includes(lastName);
  });
}

// ============ END INJURY DATA ============

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

function poissonAtLeastOne(lambda: number): number {
  return 1 - Math.exp(-lambda);
}

async function getPlayerStats(teamAbbrev: string): Promise<any[]> {
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.skaters || [];
  } catch { return []; }
}

async function processGame(
  game: any, 
  injuries: Record<string, InjuryInfo[]>
): Promise<{ predictions: PropPrediction[], playerCount: number }> {
  const predictions: PropPrediction[] = [];
  let playerCount = 0;
  
  try {
    const homeAbbrev = game.homeTeam?.abbrev;
    const awayAbbrev = game.awayTeam?.abbrev;
    if (!homeAbbrev || !awayAbbrev) return { predictions, playerCount };
    
    console.log(`Processing game: ${awayAbbrev} @ ${homeAbbrev}`);
    
    const [homePlayers, awayPlayers] = await Promise.all([
      getPlayerStats(homeAbbrev),
      getPlayerStats(awayAbbrev),
    ]);
    
    console.log(`  Home players: ${homePlayers.length}, Away players: ${awayPlayers.length}`);
    
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
      
      // AUTOMATIC INJURY CHECK
      if (isPlayerInjured(name, homeAbbrev, injuries)) {
        console.log(`  Skipping injured player: ${name} (${homeAbbrev})`);
        continue;
      }
      
      const gamesPlayed = player.gamesPlayed || 1;
      const goals = player.goals || 0;
      if (gamesPlayed < 10) continue;
      
      const baseLambda = goals / gamesPlayed;
      if (baseLambda < 0.05) continue;
      
      const finalLambda = baseLambda * 1.05;
      const probability = poissonAtLeastOne(finalLambda);
      
      let confidence = 0.3;
      if (ELITE_SCORERS.has(name)) confidence += 0.35;
      else if (baseLambda >= 0.35) confidence += 0.25;
      else if (baseLambda >= 0.20) confidence += 0.15;
      if (gamesPlayed >= 30) confidence += 0.15;
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
        breakdown: { basePrediction: baseLambda, homeAwayAdj: 1.05, backToBackAdj: 1.0, opponentAdj: 1.0, recentFormAdj: 1.0, goalieAdj: 1.0, toiAdj: 1.0, shotVolumeAdj: 1.0, finalPrediction: finalLambda },
      });
      playerCount++;
    }
    
    // Process away team
    for (const player of awayPlayers) {
      const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
      
      // AUTOMATIC INJURY CHECK
      if (isPlayerInjured(name, awayAbbrev, injuries)) {
        console.log(`  Skipping injured player: ${name} (${awayAbbrev})`);
        continue;
      }
      
      const gamesPlayed = player.gamesPlayed || 1;
      const goals = player.goals || 0;
      if (gamesPlayed < 10) continue;
      
      const baseLambda = goals / gamesPlayed;
      if (baseLambda < 0.05) continue;
      
      const finalLambda = baseLambda * 0.95;
      const probability = poissonAtLeastOne(finalLambda);
      
      let confidence = 0.3;
      if (ELITE_SCORERS.has(name)) confidence += 0.35;
      else if (baseLambda >= 0.35) confidence += 0.25;
      else if (baseLambda >= 0.20) confidence += 0.15;
      if (gamesPlayed >= 30) confidence += 0.15;
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
        breakdown: { basePrediction: baseLambda, homeAwayAdj: 0.95, backToBackAdj: 1.0, opponentAdj: 1.0, recentFormAdj: 1.0, goalieAdj: 1.0, toiAdj: 1.0, shotVolumeAdj: 1.0, finalPrediction: finalLambda },
      });
      playerCount++;
    }
    
    console.log(`  Generated ${predictions.length} predictions`);
  } catch (error) {
    console.error('Error processing game:', error);
  }
  
  return { predictions, playerCount };
}

export async function GET() {
  try {
    // Fetch injuries first
    const injuries = await fetchInjuries();
    console.log(`Loaded injuries for ${Object.keys(injuries).length} teams`);
    
    // Fetch schedule
    const schedRes = await fetch('https://api-web.nhle.com/v1/schedule/now');
    if (!schedRes.ok) {
      console.error('Schedule API failed');
      return NextResponse.json({
        predictions: [], valueBets: [], lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0, playersAnalyzed: 0, error: 'Schedule API failed'
      });
    }
    
    const schedData = await schedRes.json();
    const gameWeek = schedData.gameWeek || [];
    
    console.log(`Props API: Schedule has ${gameWeek.length} days`);
    
    // Find today's games (first day with games)
    let todayGames: any[] = [];
    
    for (const day of gameWeek) {
      console.log(`  Day: ${day.date} has ${day.games?.length || 0} games`);
      if (day.games && day.games.length > 0) {
        todayGames = day.games;
        console.log(`  Using ${day.date} with ${todayGames.length} games`);
        break;
      }
    }
    
    if (!todayGames.length) {
      console.log('No games found in schedule');
      return NextResponse.json({
        predictions: [], valueBets: [], lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0, playersAnalyzed: 0,
      });
    }
    
    console.log(`Processing ${todayGames.length} games...`);
    
    // Process all games in parallel, passing injuries
    const results = await Promise.all(
      todayGames.map((game: any) => processGame(game, injuries))
    );
    
    const allPredictions: PropPrediction[] = [];
    let totalPlayers = 0;
    
    for (const result of results) {
      allPredictions.push(...result.predictions);
      totalPlayers += result.playerCount;
    }
    
    console.log(`Total: ${allPredictions.length} predictions from ${totalPlayers} players`);
    
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
      injuriesLoaded: Object.keys(injuries).length,
    });
    
  } catch (error) {
    console.error('Error in props API:', error);
    return NextResponse.json({
      predictions: [], valueBets: [], lastUpdated: new Date().toISOString(),
      gamesAnalyzed: 0, playersAnalyzed: 0, error: 'Failed to generate predictions'
    });
  }
}
