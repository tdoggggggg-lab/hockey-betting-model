// src/app/api/props/route.ts
// Improved Player Props API with better caching and initial load handling

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

// ============ TYPE DEFINITIONS ============

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

// ============ HELPER FUNCTIONS ============

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

// ============ GLOBAL CACHE ============

interface CacheData {
  data: any;
  timestamp: number;
}

const cache: Record<string, CacheData> = {};
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

function getCached(key: string): any | null {
  const entry = cache[key];
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  return null;
}

function setCache(key: string, data: any): void {
  cache[key] = { data, timestamp: Date.now() };
}

// ============ API FUNCTIONS WITH TIMEOUT ============

async function fetchWithTimeout(url: string, timeout: number = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function getSchedule(): Promise<any[]> {
  const cacheKey = 'schedule';
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('Using cached schedule');
    return cached;
  }
  
  try {
    // Try primary endpoint
    const response = await fetchWithTimeout('https://api-web.nhle.com/v1/schedule/now', 10000);
    
    if (!response.ok) {
      throw new Error(`Schedule API returned ${response.status}`);
    }
    
    const data = await response.json();
    const gameWeek = data.gameWeek || [];
    
    // Find first day with games
    for (const day of gameWeek) {
      if (day.games && day.games.length > 0) {
        console.log(`Found ${day.games.length} games for ${day.date}`);
        setCache(cacheKey, day.games);
        return day.games;
      }
    }
    
    return [];
  } catch (error) {
    console.error('Schedule fetch failed:', error);
    
    // Try fallback
    try {
      const today = new Date().toISOString().split('T')[0];
      const fallback = await fetchWithTimeout(`https://api-web.nhle.com/v1/schedule/${today}`, 8000);
      if (fallback.ok) {
        const data = await fallback.json();
        const games = data.gameWeek?.[0]?.games || [];
        if (games.length > 0) {
          setCache(cacheKey, games);
          return games;
        }
      }
    } catch {
      console.log('Fallback also failed');
    }
    
    return [];
  }
}

async function getRoster(teamAbbrev: string): Promise<any[]> {
  const cacheKey = `roster_${teamAbbrev}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  
  try {
    const response = await fetchWithTimeout(
      `https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`,
      8000
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const skaters = data.skaters || [];
    setCache(cacheKey, skaters);
    return skaters;
  } catch (error) {
    console.error(`Roster fetch failed for ${teamAbbrev}:`, error);
    return [];
  }
}

// ============ MAIN GET HANDLER ============

export async function GET(request: Request) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const propType = searchParams.get('type') || searchParams.get('propType') || 'goalscorer';
    
    console.log(`\n🏒 Props API called for: ${propType}`);
    
    // Get schedule
    const games = await getSchedule();
    
    if (!games || games.length === 0) {
      console.log('No games found');
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
    
    // Process games (limit to first 8 for speed)
    const gamesToProcess = games.slice(0, 8);
    
    for (const game of gamesToProcess) {
      try {
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
        
        // Fetch rosters in parallel
        const [homeRoster, awayRoster] = await Promise.all([
          getRoster(homeAbbrev),
          getRoster(awayAbbrev)
        ]);
        
        // Process players
        const processTeam = (roster: any[], teamAbbrev: string, teamName: string, 
                           opponentAbbrev: string, opponentName: string, isHome: boolean) => {
          // Limit players per team
          const limitedRoster = roster.slice(0, 15);
          
          for (const player of limitedRoster) {
            const name = player.firstName?.default && player.lastName?.default
              ? `${player.firstName.default} ${player.lastName.default}`
              : 'Unknown';
            
            const gamesPlayed = player.gamesPlayed || 0;
            if (gamesPlayed < 10) continue;
            
            const goals = player.goals || 0;
            const shots = player.shots || 0;
            const assists = player.assists || 0;
            const points = player.points || 0;
            
            const goalsPerGame = goals / gamesPlayed;
            const shotsPerGame = shots / gamesPlayed;
            const assistsPerGame = assists / gamesPlayed;
            const pointsPerGame = points / gamesPlayed;
            
            // Filter by prop type
            if (propType === 'goalscorer' && goalsPerGame < 0.05) continue;
            if (propType === 'shots' && shotsPerGame < 1.5) continue;
            if (propType === 'assists' && assistsPerGame < 0.1) continue;
            if (propType === 'points' && pointsPerGame < 0.2) continue;
            
            // Calculate based on prop type
            let baseLambda: number;
            let line: number;
            let lineLabel: string;
            
            switch (propType) {
              case 'shots':
                baseLambda = shotsPerGame;
                line = 2.5;
                lineLabel = 'Shots';
                break;
              case 'assists':
                baseLambda = assistsPerGame;
                line = 0.5;
                lineLabel = 'Assists';
                break;
              case 'points':
                baseLambda = pointsPerGame;
                line = 0.5;
                lineLabel = 'Points';
                break;
              default: // goalscorer
                baseLambda = goalsPerGame;
                line = 0.5;
                lineLabel = 'Goals';
            }
            
            // Apply adjustments
            const homeAdj = isHome ? 1.05 : 0.95;
            const expectedValue = baseLambda * homeAdj;
            
            // Calculate probability
            const probability = propType === 'shots' 
              ? Math.min(0.95, expectedValue / 5) // Simple approximation for shots
              : probAtLeastOne(expectedValue);
            
            // Confidence based on sample size and production
            let confidence = 0.5;
            if (gamesPlayed >= 30) confidence += 0.15;
            else if (gamesPlayed >= 20) confidence += 0.10;
            if (goalsPerGame >= 0.4) confidence += 0.20;
            else if (goalsPerGame >= 0.25) confidence += 0.10;
            if (shotsPerGame >= 3.0) confidence += 0.10;
            confidence = Math.min(0.95, confidence);
            
            // Classify bet
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
              breakdown: {
                basePrediction: baseLambda,
                homeAwayAdj: homeAdj,
                finalPrediction: expectedValue,
              }
            });
            
            playersAnalyzed++;
          }
        };
        
        processTeam(homeRoster, homeAbbrev, homeName, awayAbbrev, awayName, true);
        processTeam(awayRoster, awayAbbrev, awayName, homeAbbrev, homeName, false);
        
      } catch (gameError) {
        console.error('Error processing game:', gameError);
      }
    }
    
    // Sort by probability
    predictions.sort((a, b) => b.probability - a.probability);
    
    // Get value bets
    const valueBets = predictions.filter(p => p.betClassification !== 'none');
    const bestValueBets = predictions.filter(p => p.betClassification === 'best_value');
    const bestBets = predictions.filter(p => p.betClassification === 'best');
    
    const elapsed = Date.now() - startTime;
    console.log(`Props API: ${predictions.length} predictions, ${valueBets.length} bets in ${elapsed}ms`);
    
    return NextResponse.json({
      predictions: predictions.slice(0, 50),
      valueBets: valueBets.slice(0, 10),
      bestValueBets,
      valueBetsOnly: valueBets.filter(p => p.betClassification === 'value'),
      bestBetsOnly: bestBets,
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: gamesToProcess.length,
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
    }, { status: 500 });
  }
}
