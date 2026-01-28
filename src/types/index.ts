// Team and Game Types
export interface Team {
  id: number;
  name: string;
  abbreviation: string;
  logo?: string;
}

export interface Game {
  id: string;
  homeTeam: Team;
  awayTeam: Team;
  startTime: string;
  status: 'scheduled' | 'live' | 'final';
  homeScore?: number;
  awayScore?: number;
  period?: number;
  timeRemaining?: string;
}

// Odds Types
export interface Odds {
  bookmaker: string;
  homeMoneyline: number;
  awayMoneyline: number;
  homeSpread: number;
  homeSpreadOdds: number;
  awaySpreadOdds: number;
  totalLine: number;
  overOdds: number;
  underOdds: number;
  lastUpdate: string;
}

export interface GameWithOdds extends Game {
  odds: Odds[];
  prediction?: Prediction;
}

// Prediction Types
export interface Prediction {
  homeWinProbability: number;
  awayWinProbability: number;
  predictedTotal: number;
  confidence: number;
  modelVersion: string;
  factors: PredictionFactor[];
}

export interface PredictionFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  description: string;
}

// Player Props
export interface PlayerProp {
  playerId: number;
  playerName: string;
  team: string;
  propType: 'goals' | 'assists' | 'points' | 'shots' | 'saves';
  line: number;
  overOdds: number;
  underOdds: number;
  prediction: number;
  confidence: number;
}

// Futures
export interface FuturesBet {
  type: 'stanley_cup' | 'conference' | 'division' | 'award';
  description: string;
  options: FuturesOption[];
}

export interface FuturesOption {
  name: string;
  odds: number;
  impliedProbability: number;
  modelProbability?: number;
}

// API Response Types
export interface OddsApiResponse {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: BookmakerData[];
}

export interface BookmakerData {
  key: string;
  title: string;
  last_update: string;
  markets: MarketData[];
}

export interface MarketData {
  key: string;
  last_update: string;
  outcomes: OutcomeData[];
}

export interface OutcomeData {
  name: string;
  price: number;
  point?: number;
}

// NHL API Types
export interface NHLScheduleResponse {
  games: NHLGame[];
}

export interface NHLGame {
  id: number;
  gameType: number;
  gameDate: string;
  startTimeUTC: string;
  homeTeam: NHLTeam;
  awayTeam: NHLTeam;
  gameState: string;
  homeScore?: number;
  awayScore?: number;
}

export interface NHLTeam {
  id: number;
  name: { default: string };
  abbrev: string;
  score?: number;
}
