// src/app/api/props/route.ts
// Self-contained Player Props API - no external lib dependencies

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ============ INLINE TYPE DEFINITIONS ============

type BetClassification = 'best_value' | 'value' | 'best' | 'none';

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
  betClassification: BetClassification;
  edge: number;
  edgePercent: string;
  bookOdds: number | null;
  bookLine: string;
  fairOdds: number;
  expectedProfit: number;
  breakdown: {
    basePrediction: number;
    homeAwayAdj: number;
    finalPrediction: number;
  };
}

// ============ INLINE HELPER FUNCTIONS ============

// Bet classification
function classifyBet(prob: number, edge: number, conf: number): BetClassification {
  const MIN_EDGE = 0.07;
  const MIN_PROB = 0.55;
  const MIN_CONF = 0.50;
  
  if (conf < MIN_CONF) return 'none';
  
  const hasEdge = edge >= MIN_EDGE;
  const hasProb = prob >= MIN_PROB;
  
  if (hasEdge && hasProb) return 'best_value';
  if (hasEdge) return 'value';
  if (hasProb) return 'best';
  return 'none';
}

function probToAmericanOdds(prob: number): number {
  if (prob <= 0 || prob >= 1) return 0;
  if (prob >= 0.5) {
    return Math.round((-100 * prob) / (1 - prob));
  }
  return Math.round((100 * (1 - prob)) / prob);
}

function americanToProb(odds: number): number {
  if (odds >= 100) return 100 / (odds + 100);
  if (odds <= -100) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 0.5;
}

// Poisson probability
function poissonProbability(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function probAtLeastOne(lambda: number): number {
  return 1 - poissonProbability(lambda, 0);
}

// ============ CACHE ============

let scheduleCache: any = null;
let scheduleCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getSchedule(): Promise<any[]> {
  const now = Date.now();
  if (scheduleCache && now - scheduleCacheTime < CACHE_TTL) {
    return scheduleCache;
  }
  
  try {
    const res = await fetch('https://api-web.nhle.com/v1/schedule/now', {
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    
    // Get today's games
    const gameWeek = data.gameWeek || [];
    const today = new Date().toISOString().split('T')[0];
    const todayGames = gameWeek.find((d: any) => d.date === today)?.games || [];
    
    // If no games today, get first day with games
    if (todayGames.length === 0 && gameWeek.length > 0) {
      for (const day of gameWeek) {
        if (day.games?.length > 0) {
          scheduleCache = day.games;
          scheduleCacheTime = now;
          return scheduleCache;
        }
      }
    }
    
    scheduleCache = todayGames;
    scheduleCacheTime = now;
    return scheduleCache;
  } catch (error) {
    console.error('Error fetching schedule:', error);
    return scheduleCache || [];
  }
}

async function getTeamRoster(teamAbbrev: string): Promise<any[]> {
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/roster/${teamAbbrev}/current`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    
    const players: any[] = [];
    for (const pos of ['forwards', 'defensemen', 'goalies']) {
      if (data[pos]) {
        for (const player of data[pos]) {
          players.push({
            id: player.id,
            name: `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim(),
            position: player.positionCode || 'F',
          });
        }
      }
    }
    return players;
  } catch (error) {
    console.error(`Error fetching roster for ${teamAbbrev}:`, error);
    return [];
  }
}

async function getPlayerStats(playerId: number): Promise<any> {
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/player/${playerId}/landing`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    
    const stats = data.featuredStats?.regularSeason?.subSeason;
    if (!stats) return null;
    
    const gp = stats.gamesPlayed || 1;
    return {
      gamesPlayed: gp,
      goals: stats.goals || 0,
      assists: stats.assists || 0,
      points: stats.points || 0,
      shots: stats.shots || 0,
      goalsPerGame: (stats.goals || 0) / gp,
      assistsPerGame: (stats.assists || 0) / gp,
      pointsPerGame: (stats.points || 0) / gp,
      shotsPerGame: (stats.shots || 0) / gp,
    };
  } catch {
    return null;
  }
}

// ============ MAIN HANDLER ============

export async function GET(request: Request) {
  try {
    console.log('Props API: Starting...');
    
    const { searchParams } = new URL(request.url);
    const propType = searchParams.get('propType') || 'goalscorer';
    
    // Get today's games
    const games = await getSchedule();
    console.log(`Props API: Found ${games.length} games`);
    
    if (games.length === 0) {
      return NextResponse.json({
        predictions: [],
        valueBets: [],
        lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0,
        playersAnalyzed: 0,
        message: 'No games scheduled today'
      });
    }
    
    const predictions: PropPrediction[] = [];
    let playersAnalyzed = 0;
    
    // Process each game
    for (const game of games.slice(0, 8)) { // Limit to 8 games to avoid timeout
      const homeAbbrev = game.homeTeam?.abbrev;
      const awayAbbrev = game.awayTeam?.abbrev;
      if (!homeAbbrev || !awayAbbrev) continue;
      
      const homeName = game.homeTeam?.placeName?.default && game.homeTeam?.commonName?.default
        ? `${game.homeTeam.placeName.default} ${game.homeTeam.commonName.default}`
        : homeAbbrev;
      const awayName = game.awayTeam?.placeName?.default && game.awayTeam?.commonName?.default
        ? `${game.awayTeam.placeName.default} ${game.awayTeam.commonName.default}`
        : awayAbbrev;
      
      const gameTime = game.startTimeUTC 
        ? new Date(game.startTimeUTC).toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit', 
            hour12: true,
            timeZone: 'America/New_York'
          }) + ' ET'
        : 'TBD';
      
      // Get rosters
      const [homeRoster, awayRoster] = await Promise.all([
        getTeamRoster(homeAbbrev),
        getTeamRoster(awayAbbrev),
      ]);
      
      // Process players from both teams
      const processTeam = async (roster: any[], teamAbbrev: string, teamName: string, opponentAbbrev: string, opponentName: string, isHome: boolean) => {
        // Only get forwards for goalscorer props
        const eligiblePlayers = propType === 'goalscorer' 
          ? roster.filter(p => p.position === 'C' || p.position === 'L' || p.position === 'R' || p.position === 'F').slice(0, 12)
          : roster.slice(0, 15);
        
        for (const player of eligiblePlayers) {
          playersAnalyzed++;
          
          const stats = await getPlayerStats(player.id);
          if (!stats || stats.gamesPlayed < 5) continue;
          
          // Calculate expected value based on prop type
          let expectedValue = 0;
          let line = 0.5;
          
          switch (propType) {
            case 'goalscorer':
              expectedValue = stats.goalsPerGame * (isHome ? 1.05 : 0.95);
              line = 0.5;
              break;
            case 'shots':
              expectedValue = stats.shotsPerGame * (isHome ? 1.05 : 0.95);
              line = 2.5;
              break;
            case 'assists':
              expectedValue = stats.assistsPerGame * (isHome ? 1.05 : 0.95);
              line = 0.5;
              break;
            case 'points':
              expectedValue = stats.pointsPerGame * (isHome ? 1.05 : 0.95);
              line = 0.5;
              break;
            default:
              expectedValue = stats.goalsPerGame * (isHome ? 1.05 : 0.95);
              line = 0.5;
          }
          
          // Calculate probability using Poisson
          const probability = propType === 'shots' 
            ? 1 - poissonProbability(expectedValue, 0) - poissonProbability(expectedValue, 1) - poissonProbability(expectedValue, 2)
            : probAtLeastOne(expectedValue);
          
          // Calculate confidence based on sample size
          let confidence = 0.45;
          if (stats.gamesPlayed >= 30) confidence += 0.25;
          else if (stats.gamesPlayed >= 20) confidence += 0.15;
          else if (stats.gamesPlayed >= 10) confidence += 0.05;
          
          if (expectedValue >= 0.4) confidence += 0.10; // High-volume players
          confidence = Math.min(0.85, confidence);
          
          // Bet classification
          const edge = 0; // No book odds, so no edge
          const betClassification = classifyBet(probability, edge, confidence);
          
          predictions.push({
            playerId: player.id,
            playerName: player.name,
            team: teamName,
            teamAbbrev,
            opponent: opponentName,
            opponentAbbrev,
            gameTime,
            isHome,
            propType,
            expectedValue,
            probability,
            line,
            confidence,
            betClassification,
            edge: 0,
            edgePercent: '0%',
            bookOdds: null,
            bookLine: `${line} ${propType === 'shots' ? 'Shots' : propType === 'assists' ? 'Assists' : propType === 'points' ? 'Points' : 'Goals'}`,
            fairOdds: probToAmericanOdds(probability),
            expectedProfit: 0,
            breakdown: {
              basePrediction: propType === 'goalscorer' ? stats.goalsPerGame : 
                             propType === 'shots' ? stats.shotsPerGame :
                             propType === 'assists' ? stats.assistsPerGame : stats.pointsPerGame,
              homeAwayAdj: isHome ? 1.05 : 0.95,
              finalPrediction: expectedValue,
            }
          });
        }
      };
      
      await processTeam(homeRoster, homeAbbrev, homeName, awayAbbrev, awayName, true);
      await processTeam(awayRoster, awayAbbrev, awayName, homeAbbrev, homeName, false);
    }
    
    // Sort by probability
    predictions.sort((a, b) => b.probability - a.probability);
    
    // Get value bets
    const valueBets = predictions.filter(p => p.betClassification !== 'none');
    const bestValueBets = predictions.filter(p => p.betClassification === 'best_value');
    const bestBets = predictions.filter(p => p.betClassification === 'best');
    
    console.log(`Props API: Generated ${predictions.length} predictions, ${valueBets.length} bets`);
    
    return NextResponse.json({
      predictions: predictions.slice(0, 50), // Top 50
      valueBets,
      bestValueBets,
      valueBetsOnly: valueBets.filter(p => p.betClassification === 'value'),
      bestBetsOnly: bestBets,
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: games.length,
      playersAnalyzed,
      playersWithBookOdds: 0,
      bookOddsAvailable: false,
      betSummary: {
        bestValue: bestValueBets.length,
        value: valueBets.filter(p => p.betClassification === 'value').length,
        best: bestBets.length,
        total: valueBets.length,
      }
    });
    
  } catch (error) {
    console.error('Props API error:', error);
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
