'use client';

import GameRow from './GameRow';

interface Team {
  id: number;
  name: string;
  abbreviation: string;
}

interface Odds {
  bookmaker: string;
  homeMoneyline: number;
  awayMoneyline: number;
  homeSpread: number;
  homeSpreadOdds: number;
  awaySpreadOdds: number;
  totalLine: number;
  overOdds: number;
  underOdds: number;
}

interface Prediction {
  homeWinProbability: number;
  awayWinProbability: number;
  predictedTotal: number;
  confidence: number;
}

interface Game {
  id: string;
  homeTeam: Team;
  awayTeam: Team;
  startTime: string;
  status: 'scheduled' | 'live' | 'final';
  homeScore?: number;
  awayScore?: number;
  prediction?: Prediction;
  odds: Odds[];
}

interface GamesTableProps {
  games: Game[];
  dateLabel: string;
}

export default function GamesTable({ games, dateLabel }: GamesTableProps) {
  if (games.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">🏒</div>
        <h3 className="text-xl font-medium text-slate-400">No games scheduled</h3>
        <p className="text-slate-500 mt-2">Check back later for upcoming matchups</p>
      </div>
    );
  }

  return (
    <div>
      {/* Section Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-lg font-semibold text-white">{dateLabel}</h2>
        <div className="hidden lg:flex items-center gap-16 text-sm text-slate-500 uppercase tracking-wide">
          <span className="w-24 text-center">Puck Line</span>
          <span className="w-24 text-center">Total</span>
          <span className="w-24 text-center">Moneyline</span>
        </div>
      </div>

      {/* Games List */}
      <div className="space-y-3 px-4">
        {games.map((game) => (
          <GameRow key={game.id} game={game} />
        ))}
      </div>
    </div>
  );
}
