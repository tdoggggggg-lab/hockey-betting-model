'use client';

import GameRow from './GameRow';

interface Game {
  id: string;
  homeTeam: { id?: number; name: string; abbreviation: string; };
  awayTeam: { id?: number; name: string; abbreviation: string; };
  startTime: string;
  status: string;
  prediction?: {
    homeWinProbability: number;
    awayWinProbability: number;
    predictedTotal: number;
    confidence: number;
  };
  odds?: any[];
}

interface GamesTableProps {
  games: Game[];
  dateLabel: string;
}

export default function GamesTable({ games, dateLabel }: GamesTableProps) {
  if (!games || games.length === 0) {
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
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-lg font-semibold text-white">{dateLabel}</h2>
        <span className="text-sm text-slate-500">{games.length} games</span>
      </div>

      <div className="space-y-3 px-4">
        {games.map((game) => (
          <GameRow key={game.id} game={game} />
        ))}
      </div>
    </div>
  );
}
