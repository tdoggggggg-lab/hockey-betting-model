// src/app/api/props/route.ts
// Player Props API with Poisson predictions

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

type BetClassification = 'best_value' | 'value' | 'best' | 'none';

function classifyBet(prob: number, edge: number, conf: number): BetClassification {
  if (conf < 0.50) return 'none';
  if (edge >= 0.07 && prob >= 0.55) return 'best_value';
  if (edge >= 0.07) return 'value';
  if (prob >= 0.55) return 'best';
  return 'none';
}

function probToAmericanOdds(prob: number): number {
  if (prob <= 0 || prob >= 1) return 0;
  if (prob >= 0.5) return Math.round((-100 * prob) / (1 - prob));
  return Math.round((100 * (1 - prob)) / prob);
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function poissonProbability(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function probAtLeastOne(lambda: number): number {
  return 1 - poissonProbability(lambda, 0);
}

// Cache
let scheduleCache: any = null;
let scheduleCacheTime = 0;
const CACHE_TTL = 3 * 60 * 1000;

async function getSchedule(): Promise<any[]> {
  const now = Date.now();
  if (scheduleCache && now - scheduleCacheTime < CACHE_TTL) return scheduleCache;
  
  try {
    const response = await fetch('https://api-web.nhle.com/v1/schedule/now', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return [];
    
    const data = await response.json();
    for (const day of data.gameWeek || []) {
      if (day.games?.length > 0) {
        scheduleCache = day.games;
        scheduleCacheTime = now;
        return day.games;
      }
    }
    return [];
  } catch { return []; }
}

const rosterCache: Record<string, { data: any[]; time: number }> = {};

async function getRoster(teamAbbrev: string): Promise<any[]> {
  const cached = rosterCache[teamAbbrev];
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.data;
  
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];
    
    const data = await response.json();
    const skaters = data.skaters || [];
    rosterCache[teamAbbrev] = { data: skaters, time: Date.now() };
    return skaters;
  } catch { return []; }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const propType = searchParams.get('type') || 'goalscorer';
    
    const games = await getSchedule();
    if (!games.length) {
      return NextResponse.json({ predictions: [], valueBets: [], lastUpdated: new Date().toISOString(), gamesAnalyzed: 0, playersAnalyzed: 0, message: 'No games today' });
    }
    
    const predictions: any[] = [];
    let playersAnalyzed = 0;
    
    for (const game of games.slice(0, 8)) {
      const homeAbbrev = game.homeTeam?.abbrev;
      const awayAbbrev = game.awayTeam?.abbrev;
      if (!homeAbbrev || !awayAbbrev) continue;
      
      const homeName = game.homeTeam?.placeName?.default ? `${game.homeTeam.placeName.default} ${game.homeTeam.commonName?.default || ''}` : homeAbbrev;
      const awayName = game.awayTeam?.placeName?.default ? `${game.awayTeam.placeName.default} ${game.awayTeam.commonName?.default || ''}` : awayAbbrev;
      
      let gameTime = 'TBD';
      if (game.startTimeUTC) {
        gameTime = new Date(game.startTimeUTC).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
      }
      
      const [homeRoster, awayRoster] = await Promise.all([getRoster(homeAbbrev), getRoster(awayAbbrev)]);
      
      const processTeam = (roster: any[], teamAbbrev: string, teamName: string, opponentAbbrev: string, opponentName: string, isHome: boolean) => {
        for (const player of roster.slice(0, 15)) {
          const name = player.firstName?.default && player.lastName?.default ? `${player.firstName.default} ${player.lastName.default}` : 'Unknown';
          const gamesPlayed = player.gamesPlayed || 0;
          if (gamesPlayed < 10) continue;
          
          const goalsPerGame = (player.goals || 0) / gamesPlayed;
          const shotsPerGame = (player.shots || 0) / gamesPlayed;
          const assistsPerGame = (player.assists || 0) / gamesPlayed;
          const pointsPerGame = (player.points || 0) / gamesPlayed;
          
          if (propType === 'goalscorer' && goalsPerGame < 0.05) continue;
          if (propType === 'shots' && shotsPerGame < 1.5) continue;
          if (propType === 'assists' && assistsPerGame < 0.1) continue;
          if (propType === 'points' && pointsPerGame < 0.2) continue;
          
          let baseLambda: number, line: number, lineLabel: string;
          switch (propType) {
            case 'shots': baseLambda = shotsPerGame; line = 2.5; lineLabel = 'Shots'; break;
            case 'assists': baseLambda = assistsPerGame; line = 0.5; lineLabel = 'Assists'; break;
            case 'points': baseLambda = pointsPerGame; line = 0.5; lineLabel = 'Points'; break;
            default: baseLambda = goalsPerGame; line = 0.5; lineLabel = 'Goals';
          }
          
          const homeAdj = isHome ? 1.05 : 0.95;
          const expectedValue = baseLambda * homeAdj;
          const probability = propType === 'shots' ? Math.min(0.95, expectedValue / 5) : probAtLeastOne(expectedValue);
          
          let confidence = 0.5;
          if (gamesPlayed >= 30) confidence += 0.15;
          else if (gamesPlayed >= 20) confidence += 0.10;
          if (goalsPerGame >= 0.4) confidence += 0.20;
          else if (goalsPerGame >= 0.25) confidence += 0.10;
          if (shotsPerGame >= 3.0) confidence += 0.10;
          confidence = Math.min(0.95, confidence);
          
          const betClassification = classifyBet(probability, 0, confidence);
          
          predictions.push({
            playerId: player.playerId || Math.random(),
            playerName: name,
            team: teamName.trim(),
            teamAbbrev,
            opponent: opponentName.trim(),
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
            bookLine: `${line} ${lineLabel}`,
            fairOdds: probToAmericanOdds(probability),
            expectedProfit: 0,
            breakdown: { basePrediction: baseLambda, homeAwayAdj: homeAdj, finalPrediction: expectedValue }
          });
          playersAnalyzed++;
        }
      };
      
      processTeam(homeRoster, homeAbbrev, homeName, awayAbbrev, awayName, true);
      processTeam(awayRoster, awayAbbrev, awayName, homeAbbrev, homeName, false);
    }
    
    predictions.sort((a, b) => b.probability - a.probability);
    const valueBets = predictions.filter(p => p.betClassification !== 'none');
    
    return NextResponse.json({
      predictions: predictions.slice(0, 50),
      valueBets: valueBets.slice(0, 10),
      bestValueBets: predictions.filter(p => p.betClassification === 'best_value'),
      valueBetsOnly: valueBets.filter(p => p.betClassification === 'value'),
      bestBetsOnly: predictions.filter(p => p.betClassification === 'best'),
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: games.slice(0, 8).length,
      playersAnalyzed,
      betSummary: {
        bestValue: predictions.filter(p => p.betClassification === 'best_value').length,
        value: valueBets.filter(p => p.betClassification === 'value').length,
        best: predictions.filter(p => p.betClassification === 'best').length,
        total: valueBets.length,
      }
    });
  } catch (error) {
    console.error('Props API error:', error);
    return NextResponse.json({ predictions: [], valueBets: [], lastUpdated: new Date().toISOString(), gamesAnalyzed: 0, playersAnalyzed: 0, error: 'Failed to generate predictions' }, { status: 500 });
  }
}
