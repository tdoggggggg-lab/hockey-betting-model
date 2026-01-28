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

interface GameCardProps {
  game: {
    id: string;
    homeTeam: Team;
    awayTeam: Team;
    startTime: string;
    status: 'scheduled' | 'live' | 'final';
    homeScore?: number;
    awayScore?: number;
    prediction?: Prediction;
    odds: Odds[];
  };
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
}

function getProbabilityColor(prob: number): string {
  if (prob >= 0.6) return 'text-green-400';
  if (prob >= 0.5) return 'text-blue-400';
  if (prob >= 0.4) return 'text-amber-400';
  return 'text-red-400';
}

export default function GameCard({ game }: GameCardProps) {
  const bestHomeML = game.odds.length > 0 
    ? Math.max(...game.odds.map(o => o.homeMoneyline))
    : null;
  const bestAwayML = game.odds.length > 0 
    ? Math.max(...game.odds.map(o => o.awayMoneyline))
    : null;

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden hover:border-slate-600 transition-colors">
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-3 bg-slate-800/50 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            game.status === 'live' 
              ? 'bg-red-500/20 text-red-400' 
              : game.status === 'final'
              ? 'bg-slate-600 text-slate-300'
              : 'bg-green-500/20 text-green-400'
          }`}>
            {game.status === 'live' ? '🔴 LIVE' : game.status === 'final' ? 'FINAL' : formatTime(game.startTime)}
          </span>
        </div>
        {game.prediction && (
          <div className="text-xs text-slate-400">
            Confidence: <span className="text-white">{Math.round(game.prediction.confidence * 100)}%</span>
          </div>
        )}
      </div>

      {/* Teams and Prediction */}
      <div className="p-4">
        <div className="grid grid-cols-3 gap-4 items-center">
          {/* Away Team */}
          <div className="text-center">
            <div className="text-3xl mb-2">🏒</div>
            <div className="font-bold text-lg">{game.awayTeam.abbreviation}</div>
            <div className="text-slate-400 text-sm truncate">{game.awayTeam.name}</div>
            {game.prediction && (
              <div className={`mt-2 text-2xl font-bold ${getProbabilityColor(game.prediction.awayWinProbability)}`}>
                {Math.round(game.prediction.awayWinProbability * 100)}%
              </div>
            )}
          </div>

          {/* VS / Score */}
          <div className="text-center">
            {game.status === 'final' || game.status === 'live' ? (
              <div className="text-3xl font-bold">
                {game.awayScore} - {game.homeScore}
              </div>
            ) : (
              <div className="text-slate-500 text-xl font-medium">VS</div>
            )}
            {game.prediction && (
              <div className="mt-2 text-sm text-slate-400">
                Predicted Total: <span className="text-white">{game.prediction.predictedTotal.toFixed(1)}</span>
              </div>
            )}
          </div>

          {/* Home Team */}
          <div className="text-center">
            <div className="text-3xl mb-2">🏒</div>
            <div className="font-bold text-lg">{game.homeTeam.abbreviation}</div>
            <div className="text-slate-400 text-sm truncate">{game.homeTeam.name}</div>
            {game.prediction && (
              <div className={`mt-2 text-2xl font-bold ${getProbabilityColor(game.prediction.homeWinProbability)}`}>
                {Math.round(game.prediction.homeWinProbability * 100)}%
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Odds Comparison */}
      {game.odds.length > 0 && (
        <div className="border-t border-slate-700 px-4 py-3">
          <div className="text-xs text-slate-400 mb-3 uppercase tracking-wide">Best Odds</div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            {/* Moneyline */}
            <div>
              <div className="text-slate-500 text-xs mb-1">Moneyline</div>
              <div className="flex justify-between">
                <span className={bestAwayML && bestAwayML > 0 ? 'text-green-400' : ''}>
                  {bestAwayML !== null ? formatOdds(bestAwayML) : '-'}
                </span>
                <span className={bestHomeML && bestHomeML > 0 ? 'text-green-400' : ''}>
                  {bestHomeML !== null ? formatOdds(bestHomeML) : '-'}
                </span>
              </div>
            </div>

            {/* Puck Line */}
            <div>
              <div className="text-slate-500 text-xs mb-1">Puck Line</div>
              <div className="flex justify-between">
                <span>+1.5</span>
                <span>-1.5</span>
              </div>
            </div>

            {/* Total */}
            <div>
              <div className="text-slate-500 text-xs mb-1">Total</div>
              <div className="text-center">
                O/U {game.odds[0].totalLine}
              </div>
            </div>
          </div>

          {/* Bookmaker breakdown */}
          <div className="mt-3 pt-3 border-t border-slate-700/50">
            <div className="flex flex-wrap gap-2">
              {game.odds.map((odd, idx) => (
                <span key={idx} className="text-xs bg-slate-700/50 px-2 py-1 rounded">
                  {odd.bookmaker}: {formatOdds(odd.awayMoneyline)} / {formatOdds(odd.homeMoneyline)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Action Button */}
      <div className="px-4 py-3 bg-slate-800/30 border-t border-slate-700">
        <button className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium text-sm transition-colors">
          View Full Analysis →
        </button>
      </div>
    </div>
  );
}
