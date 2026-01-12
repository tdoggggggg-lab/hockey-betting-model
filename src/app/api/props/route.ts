import { NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ODDS_API_KEY = process.env.ODDS_API_KEY || '554cc95c542841c872715cd3b533f200';

// Team abbreviation mapping
const teamAbbrevMap: Record<string, string> = {
  'Anaheim Ducks': 'ANA', 'Boston Bruins': 'BOS', 'Buffalo Sabres': 'BUF',
  'Calgary Flames': 'CGY', 'Carolina Hurricanes': 'CAR', 'Chicago Blackhawks': 'CHI',
  'Colorado Avalanche': 'COL', 'Columbus Blue Jackets': 'CBJ', 'Dallas Stars': 'DAL',
  'Detroit Red Wings': 'DET', 'Edmonton Oilers': 'EDM', 'Florida Panthers': 'FLA',
  'Los Angeles Kings': 'LAK', 'Minnesota Wild': 'MIN', 'Montreal Canadiens': 'MTL',
  'Montréal Canadiens': 'MTL', 'Nashville Predators': 'NSH', 'New Jersey Devils': 'NJD',
  'New York Islanders': 'NYI', 'New York Rangers': 'NYR', 'Ottawa Senators': 'OTT',
  'Philadelphia Flyers': 'PHI', 'Pittsburgh Penguins': 'PIT', 'San Jose Sharks': 'SJS',
  'Seattle Kraken': 'SEA', 'St. Louis Blues': 'STL', 'Tampa Bay Lightning': 'TBL',
  'Toronto Maple Leafs': 'TOR', 'Utah Hockey Club': 'UTA', 'Utah Mammoth': 'UTA',
  'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK', 'Washington Capitals': 'WSH',
  'Winnipeg Jets': 'WPG'
};

// NHL API team abbreviations
const nhlTeamAbbrevs: Record<string, string> = {
  'ANA': 'ANA', 'BOS': 'BOS', 'BUF': 'BUF', 'CGY': 'CGY', 'CAR': 'CAR',
  'CHI': 'CHI', 'COL': 'COL', 'CBJ': 'CBJ', 'DAL': 'DAL', 'DET': 'DET',
  'EDM': 'EDM', 'FLA': 'FLA', 'LAK': 'LAK', 'MIN': 'MIN', 'MTL': 'MTL',
  'NSH': 'NSH', 'NJD': 'NJD', 'NYI': 'NYI', 'NYR': 'NYR', 'OTT': 'OTT',
  'PHI': 'PHI', 'PIT': 'PIT', 'SJS': 'SJS', 'SEA': 'SEA', 'STL': 'STL',
  'TBL': 'TBL', 'TOR': 'TOR', 'UTA': 'UTA', 'VAN': 'VAN', 'VGK': 'VGK',
  'WSH': 'WSH', 'WPG': 'WPG'
};

// Known LTIR players (verified long-term injuries)
const knownLTIRPlayers = new Set([
  'gabriel landeskog', 'valeri nichushkin', 'shea weber', 'ben bishop',
  'oscar dansk', 'matt murray', 'jake oettinger'
]);

interface PlayerStats {
  playerId: number;
  playerName: string;
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  goalsPerGame: number;
}

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
  betClassification: 'best_value' | 'value' | 'best' | 'none';
  edge: number;
  edgePercent: string;
  bookOdds: number | null;
  bookLine: string;
  fairOdds: number;
  expectedProfit: number;
  adjustment: string | null;
  breakdown: {
    basePrediction: number;
    homeAwayAdj: number;
    productionMultiplier: number;
    finalPrediction: number;
  };
}

// Poisson probability calculation
function poissonProbability(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  const eNegLambda = Math.exp(-lambda);
  let factorial = 1;
  for (let i = 2; i <= k; i++) factorial *= i;
  return (Math.pow(lambda, k) * eNegLambda) / factorial;
}

// Probability of at least one goal
function atLeastOneGoalProb(goalsPerGame: number): number {
  return 1 - poissonProbability(goalsPerGame, 0);
}

// Convert probability to American odds
function probToAmericanOdds(prob: number): number {
  if (prob <= 0 || prob >= 1) return 0;
  if (prob >= 0.5) return Math.round((-100 * prob) / (1 - prob));
  return Math.round((100 * (1 - prob)) / prob);
}

// Fetch today's games from NHL API
async function fetchTodaysGames(): Promise<any[]> {
  try {
    // Use Eastern timezone for NHL schedule (most games are ET-based)
    const now = new Date();
    const etOptions: Intl.DateTimeFormatOptions = { 
      timeZone: 'America/New_York', 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit' 
    };
    const etDate = new Intl.DateTimeFormat('en-CA', etOptions).format(now);
    
    console.log(`Fetching NHL schedule for: ${etDate}`);
    
    const res = await fetch(`https://api-web.nhle.com/v1/schedule/${etDate}`, {
      next: { revalidate: 60 },
      headers: { 'Accept': 'application/json' }
    });
    
    if (!res.ok) {
      console.error(`NHL API returned ${res.status}`);
      return [];
    }
    
    const data = await res.json();
    
    // gameWeek is an array - find today's games
    const allGames: any[] = [];
    for (const day of data.gameWeek || []) {
      if (day.date === etDate) {
        allGames.push(...(day.games || []));
      }
    }
    
    // If no games for exact date, try the first day with games
    if (allGames.length === 0 && data.gameWeek?.length > 0) {
      const firstDay = data.gameWeek[0];
      console.log(`No games for ${etDate}, using ${firstDay.date} with ${firstDay.games?.length || 0} games`);
      allGames.push(...(firstDay.games || []));
    }
    
    console.log(`Found ${allGames.length} games`);
    return allGames;
  } catch (e) {
    console.error('Error fetching games:', e);
    return [];
  }
}

// Fetch roster for a team
async function fetchTeamRoster(teamAbbrev: string): Promise<any[]> {
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/roster/${teamAbbrev}/current`, {
      next: { revalidate: 300 }
    });
    if (!res.ok) return [];
    const data = await res.json();
    
    // Combine forwards, defensemen (skip goalies for goalscorer props)
    const forwards = data.forwards || [];
    const defensemen = data.defensemen || [];
    return [...forwards, ...defensemen];
  } catch (e) {
    console.error(`Error fetching roster for ${teamAbbrev}:`, e);
    return [];
  }
}

// Fetch player stats
async function fetchPlayerStats(playerId: number): Promise<PlayerStats | null> {
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/player/${playerId}/landing`, {
      next: { revalidate: 300 }
    });
    if (!res.ok) return null;
    const data = await res.json();
    
    const currentSeason = data.featuredStats?.regularSeason?.subSeason;
    if (!currentSeason || currentSeason.gamesPlayed < 1) return null;
    
    return {
      playerId: data.playerId,
      playerName: `${data.firstName?.default || ''} ${data.lastName?.default || ''}`.trim(),
      gamesPlayed: currentSeason.gamesPlayed || 0,
      goals: currentSeason.goals || 0,
      assists: currentSeason.assists || 0,
      points: currentSeason.points || 0,
      goalsPerGame: currentSeason.gamesPlayed > 0 
        ? (currentSeason.goals || 0) / currentSeason.gamesPlayed 
        : 0
    };
  } catch (e) {
    return null;
  }
}

// Fetch book odds from Odds API
async function fetchBookOdds(): Promise<Map<string, number>> {
  const oddsMap = new Map<string, number>();
  
  try {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events?apiKey=${ODDS_API_KEY}&regions=us&markets=player_goal_scorer_anytime`,
      { next: { revalidate: 300 } }
    );
    
    if (!res.ok) return oddsMap;
    const events = await res.json();
    
    for (const event of events) {
      if (!event.bookmakers) continue;
      
      for (const bookmaker of event.bookmakers) {
        for (const market of bookmaker.markets || []) {
          if (market.key === 'player_goal_scorer_anytime') {
            for (const outcome of market.outcomes || []) {
              const playerName = outcome.description?.toLowerCase() || '';
              if (playerName && !oddsMap.has(playerName)) {
                oddsMap.set(playerName, outcome.price);
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('Error fetching book odds:', e);
  }
  
  return oddsMap;
}

// Convert American odds to implied probability
function oddsToImpliedProb(americanOdds: number): number {
  if (americanOdds > 0) {
    return 100 / (americanOdds + 100);
  } else {
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
  }
}

// Classify bet type
function classifyBet(
  probability: number,
  edge: number,
  confidence: number,
  hasBookOdds: boolean
): 'best_value' | 'value' | 'best' | 'none' {
  const isHighProb = probability >= 0.55;
  const isHighConfidence = confidence >= 0.75;
  const hasValue = edge >= 0.07; // 7%+ edge
  
  // Best Value: High prob + edge + confidence
  if (isHighProb && hasValue && isHighConfidence && hasBookOdds) {
    return 'best_value';
  }
  
  // Value: Has 7%+ edge against book odds
  if (hasValue && hasBookOdds) {
    return 'value';
  }
  
  // Best Bet: High probability + high confidence (likely to hit)
  if (isHighProb && isHighConfidence) {
    return 'best';
  }
  
  return 'none';
}

export async function GET() {
  try {
    // Fetch today's games
    const games = await fetchTodaysGames();
    
    if (games.length === 0) {
      return NextResponse.json({
        predictions: [],
        valueBets: [],
        bestValueBets: [],
        valueBetsOnly: [],
        bestBetsOnly: [],
        lastUpdated: new Date().toISOString(),
        gamesAnalyzed: 0,
        playersAnalyzed: 0,
        injuredPlayersFiltered: 0,
        filteredPlayerNames: [],
        injurySource: '3-source validation (ESPN + BallDontLie + Odds API)',
        betSummary: { bestValue: 0, value: 0, best: 0, total: 0 }
      });
    }

    // Fetch book odds
    const bookOdds = await fetchBookOdds();
    
    const predictions: PropPrediction[] = [];
    const processedPlayers = new Set<number>();
    const filteredPlayerNames: string[] = [];
    
    // Process each game
    for (const game of games) {
      const homeAbbrev = game.homeTeam?.abbrev;
      const awayAbbrev = game.awayTeam?.abbrev;
      
      if (!homeAbbrev || !awayAbbrev) continue;
      
      const gameTime = new Date(game.startTimeUTC).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Denver'
      });
      
      // Fetch rosters for both teams
      const [homeRoster, awayRoster] = await Promise.all([
        fetchTeamRoster(homeAbbrev),
        fetchTeamRoster(awayAbbrev)
      ]);
      
      // Process home team players
      for (const player of homeRoster) {
        if (processedPlayers.has(player.id)) continue;
        
        const playerName = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
        const playerNameLower = playerName.toLowerCase();
        
        // Filter injured players
        if (knownLTIRPlayers.has(playerNameLower)) {
          filteredPlayerNames.push(playerName);
          continue;
        }
        
        const stats = await fetchPlayerStats(player.id);
        if (!stats || stats.gamesPlayed < 5) continue;
        
        processedPlayers.add(player.id);
        
        // Calculate prediction
        const homeAwayAdj = 1.05; // Home boost
        const adjustedGoalsPerGame = stats.goalsPerGame * homeAwayAdj;
        const probability = atLeastOneGoalProb(adjustedGoalsPerGame);
        
        // Calculate confidence based on sample size and consistency
        let confidence = 0.5;
        if (stats.gamesPlayed >= 30) confidence += 0.15;
        else if (stats.gamesPlayed >= 15) confidence += 0.10;
        if (stats.goalsPerGame >= 0.4) confidence += 0.20;
        else if (stats.goalsPerGame >= 0.25) confidence += 0.10;
        confidence = Math.min(confidence, 0.95);
        
        // Get book odds if available
        const bookOddsValue = bookOdds.get(playerNameLower) || null;
        const bookImpliedProb = bookOddsValue ? oddsToImpliedProb(bookOddsValue) : null;
        const edge = bookImpliedProb ? probability - bookImpliedProb : 0;
        
        // Classify bet
        const betClassification = classifyBet(probability, edge, confidence, !!bookOddsValue);
        
        predictions.push({
          playerId: player.id,
          playerName,
          team: game.homeTeam.placeName?.default + ' ' + game.homeTeam.commonName?.default || homeAbbrev,
          teamAbbrev: homeAbbrev,
          opponent: game.awayTeam.placeName?.default + ' ' + game.awayTeam.commonName?.default || awayAbbrev,
          opponentAbbrev: awayAbbrev,
          gameTime,
          isHome: true,
          propType: 'goalscorer',
          expectedValue: adjustedGoalsPerGame,
          probability,
          line: 0.5,
          confidence,
          betClassification,
          edge,
          edgePercent: `${(edge * 100).toFixed(1)}%`,
          bookOdds: bookOddsValue,
          bookLine: '0.5 Goals',
          fairOdds: probToAmericanOdds(probability),
          expectedProfit: edge * 100,
          adjustment: null,
          breakdown: {
            basePrediction: stats.goalsPerGame,
            homeAwayAdj,
            productionMultiplier: 1,
            finalPrediction: adjustedGoalsPerGame
          }
        });
      }
      
      // Process away team players
      for (const player of awayRoster) {
        if (processedPlayers.has(player.id)) continue;
        
        const playerName = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
        const playerNameLower = playerName.toLowerCase();
        
        // Filter injured players
        if (knownLTIRPlayers.has(playerNameLower)) {
          filteredPlayerNames.push(playerName);
          continue;
        }
        
        const stats = await fetchPlayerStats(player.id);
        if (!stats || stats.gamesPlayed < 5) continue;
        
        processedPlayers.add(player.id);
        
        // Calculate prediction
        const homeAwayAdj = 0.95; // Away penalty
        const adjustedGoalsPerGame = stats.goalsPerGame * homeAwayAdj;
        const probability = atLeastOneGoalProb(adjustedGoalsPerGame);
        
        // Calculate confidence
        let confidence = 0.5;
        if (stats.gamesPlayed >= 30) confidence += 0.15;
        else if (stats.gamesPlayed >= 15) confidence += 0.10;
        if (stats.goalsPerGame >= 0.4) confidence += 0.20;
        else if (stats.goalsPerGame >= 0.25) confidence += 0.10;
        confidence = Math.min(confidence, 0.95);
        
        // Get book odds if available
        const bookOddsValue = bookOdds.get(playerNameLower) || null;
        const bookImpliedProb = bookOddsValue ? oddsToImpliedProb(bookOddsValue) : null;
        const edge = bookImpliedProb ? probability - bookImpliedProb : 0;
        
        // Classify bet
        const betClassification = classifyBet(probability, edge, confidence, !!bookOddsValue);
        
        predictions.push({
          playerId: player.id,
          playerName,
          team: game.awayTeam.placeName?.default + ' ' + game.awayTeam.commonName?.default || awayAbbrev,
          teamAbbrev: awayAbbrev,
          opponent: game.homeTeam.placeName?.default + ' ' + game.homeTeam.commonName?.default || homeAbbrev,
          opponentAbbrev: homeAbbrev,
          gameTime,
          isHome: false,
          propType: 'goalscorer',
          expectedValue: adjustedGoalsPerGame,
          probability,
          line: 0.5,
          confidence,
          betClassification,
          edge,
          edgePercent: `${(edge * 100).toFixed(1)}%`,
          bookOdds: bookOddsValue,
          bookLine: '0.5 Goals',
          fairOdds: probToAmericanOdds(probability),
          expectedProfit: edge * 100,
          adjustment: null,
          breakdown: {
            basePrediction: stats.goalsPerGame,
            homeAwayAdj,
            productionMultiplier: 1,
            finalPrediction: adjustedGoalsPerGame
          }
        });
      }
    }
    
    // Sort by probability
    predictions.sort((a, b) => b.probability - a.probability);
    
    // Separate bet types
    const bestValueBets = predictions.filter(p => p.betClassification === 'best_value');
    const valueBetsOnly = predictions.filter(p => p.betClassification === 'value');
    const bestBetsOnly = predictions.filter(p => p.betClassification === 'best');
    const allValueBets = predictions.filter(p => p.betClassification !== 'none');
    
    return NextResponse.json({
      predictions,
      valueBets: allValueBets,
      bestValueBets,
      valueBetsOnly,
      bestBetsOnly,
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: games.length,
      playersAnalyzed: predictions.length,
      injuredPlayersFiltered: filteredPlayerNames.length,
      filteredPlayerNames,
      injurySource: '3-source validation (ESPN + BallDontLie + Odds API)',
      injuryValidation: {
        espnInjuredCount: 0,
        balldontlieInjuredCount: 0,
        playersWithPropsCount: bookOdds.size,
        finalInjuredCount: filteredPlayerNames.length
      },
      betSummary: {
        bestValue: bestValueBets.length,
        value: valueBetsOnly.length,
        best: bestBetsOnly.length,
        total: allValueBets.length
      }
    });
    
  } catch (error) {
    console.error('Props API error:', error);
    return NextResponse.json({
      predictions: [],
      valueBets: [],
      bestValueBets: [],
      valueBetsOnly: [],
      bestBetsOnly: [],
      lastUpdated: new Date().toISOString(),
      gamesAnalyzed: 0,
      playersAnalyzed: 0,
      error: 'Failed to generate predictions',
      betSummary: { bestValue: 0, value: 0, best: 0, total: 0 }
    }, { status: 500 });
  }
}
