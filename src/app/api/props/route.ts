// src/app/api/props/route.ts
// Player Props API using injury-service.ts for AUTOMATIC injury filtering
// NO HARDCODED INJURIES - uses 3-source validation from injury-service

import { NextResponse } from 'next/server';
import { 
  getInjuredPlayerNames, 
  getPlayerPropsAdjustment,
  refreshInjuryCache,
  getCacheStatus 
} from '@/lib/injury-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

// ============ PREDICTION HELPERS ============

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

function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, '')
    .replace(/[^a-z\s-]/g, '')
    .trim();
}

// ============ SCHEDULE/ROSTER CACHING ============

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

// ============ MAIN HANDLER ============

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const propType = searchParams.get('type') || searchParams.get('propType') || 'goalscorer';
    
    // REFRESH INJURY CACHE (uses 3-source validation: ESPN + BallDontLie + Odds API)
    await refreshInjuryCache();
    
    // GET INJURED PLAYERS SET FROM INJURY-SERVICE (automatic, validated)
    const injuredPlayersSet = await getInjuredPlayerNames();
    
    const games = await getSchedule();
    
    if (!games.length) {
      return NextResponse.json({ 
        predictions: [], 
        valueBets: [], 
        lastUpdated: new Date().toISOString(), 
        gamesAnalyzed: 0, 
        playersAnalyzed: 0, 
        message: 'No games today' 
      });
    }
    
    const predictions: any[] = [];
    let playersAnalyzed = 0;
    let injuredSkipped = 0;
    const skippedPlayers: string[] = [];
    
    for (const game of games.slice(0, 8)) {
      const homeAbbrev = game.homeTeam?.abbrev;
      const awayAbbrev = game.awayTeam?.abbrev;
      if (!homeAbbrev || !awayAbbrev) continue;
      
      const homeName = game.homeTeam?.placeName?.default 
        ? `${game.homeTeam.placeName.default} ${game.homeTeam.commonName?.default || ''}` 
        : homeAbbrev;
      const awayName = game.awayTeam?.placeName?.default 
        ? `${game.awayTeam.placeName.default} ${game.awayTeam.commonName?.default || ''}` 
        : awayAbbrev;
      
      let gameTime = 'TBD';
      if (game.startTimeUTC) {
        gameTime = new Date(game.startTimeUTC).toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit', 
          hour12: true, 
          timeZone: 'America/New_York' 
        });
      }
      
      const [homeRoster, awayRoster] = await Promise.all([
        getRoster(homeAbbrev), 
        getRoster(awayAbbrev)
      ]);
      
      const processTeam = async (
        roster: any[], 
        teamAbbrev: string, 
        teamName: string, 
        opponentAbbrev: string, 
        opponentName: string, 
        isHome: boolean
      ) => {
        for (const player of roster.slice(0, 20)) {
          const firstName = player.firstName?.default || '';
          const lastName = player.lastName?.default || '';
          const fullName = `${firstName} ${lastName}`.trim();
          
          if (!fullName || fullName === 'Unknown') continue;
          
          // CHECK IF PLAYER IS INJURED USING INJURY-SERVICE (3-source validated)
          const normalizedName = normalizePlayerName(fullName);
          if (injuredPlayersSet.has(normalizedName)) {
            injuredSkipped++;
            skippedPlayers.push(fullName);
            console.log(`[Props] Skipping injured: ${fullName} (validated by injury-service)`);
            continue;
          }
          
          // Also get any production adjustments (rust factor, linemate injuries, etc.)
          const propsAdjustment = await getPlayerPropsAdjustment(fullName, teamAbbrev);
          if (propsAdjustment.isInjured) {
            injuredSkipped++;
            skippedPlayers.push(fullName);
            console.log(`[Props] Skipping injured: ${fullName} - ${propsAdjustment.reason}`);
            continue;
          }
          
          const gamesPlayed = player.gamesPlayed || 0;
          if (gamesPlayed < 10) continue;
          
          const goalsPerGame = (player.goals || 0) / gamesPlayed;
          const shotsPerGame = (player.shots || 0) / gamesPlayed;
          const assistsPerGame = (player.assists || 0) / gamesPlayed;
          const pointsPerGame = (player.points || 0) / gamesPlayed;
          
          // Filter by prop type minimum
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
          
          // Apply production multiplier from injury-service (rust factor, linemate injuries)
          const productionMultiplier = propsAdjustment.productionMultiplier;
          
          let expectedValue = baseLambda * homeAdj * productionMultiplier;
          const probability = propType === 'shots' 
            ? Math.min(0.95, expectedValue / 5) 
            : probAtLeastOne(expectedValue);
          
          // Confidence based on sample size and production
          let confidence = 0.5;
          if (gamesPlayed >= 30) confidence += 0.15;
          else if (gamesPlayed >= 20) confidence += 0.10;
          if (goalsPerGame >= 0.4) confidence += 0.20;
          else if (goalsPerGame >= 0.25) confidence += 0.10;
          if (shotsPerGame >= 3.0) confidence += 0.10;
          confidence = Math.min(0.95, confidence);
          
          // Reduce confidence if there's a production adjustment (rust, etc.)
          if (productionMultiplier < 1.0) {
            confidence *= 0.9;
          }
          
          predictions.push({
            playerId: player.playerId || Math.floor(Math.random() * 100000),
            playerName: fullName,
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
            betClassification: confidence >= 0.5 && probability >= 0.55 ? 'best' : 'none',
            edge: 0,
            edgePercent: '0%',
            bookOdds: null,
            bookLine: `${line} ${lineLabel}`,
            fairOdds: probToAmericanOdds(probability),
            expectedProfit: 0,
            adjustment: propsAdjustment.reason || null,
            breakdown: { 
              basePrediction: baseLambda, 
              homeAwayAdj: homeAdj, 
              productionMultiplier,
              finalPrediction: expectedValue 
            }
          });
          playersAnalyzed++;
        }
      };
      
      await processTeam(homeRoster, homeAbbrev, homeName, awayAbbrev, awayName, true);
      await processTeam(awayRoster, awayAbbrev, awayName, homeAbbrev, homeName, false);
    }
    
    // Sort by probability
    predictions.sort((a, b) => b.probability - a.probability);
    
    const valueBets = predictions.filter(p => p.betClassification !== 'none');
    
    // Get injury cache status for response
    const injuryCacheStatus = getCacheStatus();
    
    console.log(`[Props API] ${predictions.length} predictions, ${injuredSkipped} injured players filtered`);
    console.log(`[Props API] Filtered out: ${skippedPlayers.join(', ') || 'None'}`);
    
    return NextResponse.json({
      predictions: predictions.slice(0, 50),
      valueBets: valueBets.slice(0, 10),
      bestValueBets: [],
      valueBetsOnly: [],
      bestBetsOnly: valueBets,
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: games.slice(0, 8).length,
      playersAnalyzed,
      injuredPlayersFiltered: injuredSkipped,
      filteredPlayerNames: skippedPlayers,
      injurySource: '3-source validation (ESPN + BallDontLie + Odds API)',
      injuryValidation: injuryCacheStatus.threeSourceValidation,
      betSummary: {
        bestValue: 0,
        value: 0,
        best: valueBets.length,
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
    }, { status: 500 });
  }
}
