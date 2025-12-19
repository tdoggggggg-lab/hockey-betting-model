'use client';

import { useState, useEffect } from 'react';

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
  edge?: number;
  impliedProbability?: number;
  bookmakerOdds?: number;
  bookmaker?: string;
  breakdown: {
    basePrediction: number;
    homeAwayAdj: number;
    backToBackAdj: number;
    opponentAdj: number;
    recentFormAdj: number;
    finalPrediction: number;
  };
}

interface PropsData {
  predictions: PropPrediction[];
  valueBets: PropPrediction[];
  lastUpdated: string;
  gamesAnalyzed: number;
  playersAnalyzed: number;
  error?: string;
}

// Team colors
const teamColors: Record<string, string> = {
  'EDM': '#FF4C00', 'BOS': '#FFB81C', 'MTL': '#AF1E2D', 'CHI': '#CF0A2C',
  'TOR': '#00205B', 'NYR': '#0038A8', 'COL': '#6F263D', 'VGK': '#B4975A',
  'FLA': '#041E42', 'DAL': '#006847', 'CAR': '#CC0000', 'NJD': '#CE1126',
  'WPG': '#041E42', 'VAN': '#00205B', 'LAK': '#111111', 'MIN': '#154734',
  'TBL': '#002868', 'SEA': '#99D9D9', 'OTT': '#C52032', 'PIT': '#FCB514',
  'WSH': '#C8102E', 'CGY': '#D2001C', 'STL': '#002F87', 'DET': '#CE1126',
  'PHI': '#F74902', 'BUF': '#002654', 'ANA': '#F47A38', 'NSH': '#FFB81C',
  'CBJ': '#002654', 'SJS': '#006D75', 'UTA': '#6CACE4', 'ARI': '#8C2633',
};

export default function GoalscorerTable() {
  const [propsData, setPropsData] = useState<PropsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'probability' | 'edge' | 'team' | 'name'>('probability');
  const [filterTeam, setFilterTeam] = useState<string>('all');
  const [showValueOnly, setShowValueOnly] = useState(false);

  useEffect(() => {
    async function fetchProps() {
      try {
        setLoading(true);
        const response = await fetch('/api/props?type=goalscorer');
        
        if (!response.ok) {
          throw new Error('Failed to fetch props');
        }
        
        const data = await response.json();
        setPropsData(data);
        
        if (data.error) {
          console.warn('Props API warning:', data.error);
        }
      } catch (err) {
        console.error('Error fetching props:', err);
        setError('Failed to load predictions. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    
    fetchProps();
    
    // Refresh every 5 minutes
    const interval = setInterval(fetchProps, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
        <p className="text-slate-400">Analyzing players and generating predictions...</p>
        <p className="text-slate-500 text-sm mt-2">This may take a moment for the first load</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4">⚠️</div>
        <h3 className="text-xl font-medium text-red-400">{error}</h3>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-500"
        >
          Try Again
        </button>
      </div>
    );
  }

  const predictions = propsData?.predictions || [];
  const valueBets = propsData?.valueBets || [];
  
  // Get unique teams for filter
  const teams = [...new Set(predictions.map(p => p.teamAbbrev))].sort();
  
  // Filter predictions
  let filteredPredictions = filterTeam === 'all' 
    ? predictions 
    : predictions.filter(p => p.teamAbbrev === filterTeam);
  
  if (showValueOnly) {
    filteredPredictions = filteredPredictions.filter(p => p.isValueBet);
  }
  
  // Sort predictions
  if (sortBy === 'probability') {
    filteredPredictions = [...filteredPredictions].sort((a, b) => b.probability - a.probability);
  } else if (sortBy === 'edge') {
    filteredPredictions = [...filteredPredictions].sort((a, b) => (b.edge || 0) - (a.edge || 0));
  } else if (sortBy === 'team') {
    filteredPredictions = [...filteredPredictions].sort((a, b) => a.teamAbbrev.localeCompare(b.teamAbbrev));
  } else {
    filteredPredictions = [...filteredPredictions].sort((a, b) => a.playerName.localeCompare(b.playerName));
  }

  const formatProbability = (prob: number) => `${(prob * 100).toFixed(1)}%`;
  const formatEdge = (edge: number | undefined) => {
    if (!edge) return '-';
    const sign = edge > 0 ? '+' : '';
    return `${sign}${(edge * 100).toFixed(1)}%`;
  };

  return (
    <div className="px-4">
      {/* Stats Banner */}
      <div className="mb-6 p-4 bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-800/50 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">Anytime Goalscorer Predictions</h2>
            <p className="text-slate-400 text-sm">Model-generated probabilities using Poisson distribution</p>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{propsData?.gamesAnalyzed || 0}</div>
              <div className="text-slate-500">Games</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-400">{propsData?.playersAnalyzed || 0}</div>
              <div className="text-slate-500">Players</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-400">{valueBets.length}</div>
              <div className="text-slate-500">Value Bets</div>
            </div>
          </div>
        </div>
      </div>

      {/* Value Bets Section */}
      {valueBets.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-bold text-emerald-400 mb-4 flex items-center gap-2">
            <span>🔥</span> Top Value Bets
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {valueBets.slice(0, 6).map((pred, index) => (
              <div 
                key={`value-${pred.playerId}-${index}`}
                className="bg-gradient-to-br from-emerald-900/30 to-emerald-800/20 border border-emerald-700/50 rounded-xl p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{ backgroundColor: teamColors[pred.teamAbbrev] || '#374151', color: 'white' }}
                    >
                      {pred.teamAbbrev}
                    </div>
                    <div>
                      <h4 className="font-semibold text-white">{pred.playerName}</h4>
                      <p className="text-slate-400 text-sm">{pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-400 font-bold text-lg">{formatEdge(pred.edge)}</div>
                    <div className="text-slate-500 text-xs">edge</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-slate-900/50 rounded-lg p-2">
                    <div className="text-slate-500 text-xs">Model Prob</div>
                    <div className="text-white font-semibold">{formatProbability(pred.probability)}</div>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-2">
                    <div className="text-slate-500 text-xs">Book Implied</div>
                    <div className="text-white font-semibold">{formatProbability(pred.impliedProbability || 0)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
        <div className="flex items-center gap-4">
          <select
            value={filterTeam}
            onChange={(e) => setFilterTeam(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="all">All Teams</option>
            {teams.map(team => <option key={team} value={team}>{team}</option>)}
          </select>
          
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="probability">Sort by Probability</option>
            <option value="edge">Sort by Edge</option>
            <option value="team">Sort by Team</option>
            <option value="name">Sort by Name</option>
          </select>
          
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showValueOnly}
              onChange={(e) => setShowValueOnly(e.target.checked)}
              className="rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
            />
            Value bets only
          </label>
        </div>
        
        <div className="text-slate-500 text-sm">
          {filteredPredictions.length} predictions
        </div>
      </div>

      {/* Predictions Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Player</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Matchup</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Time</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Exp. Goals</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Probability</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Confidence</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredPredictions.map((pred, index) => (
              <tr 
                key={`${pred.playerId}-${index}`}
                className={`border-b border-slate-800/50 hover:bg-slate-900/30 transition-colors ${
                  pred.isValueBet ? 'bg-emerald-900/10' : ''
                }`}
              >
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{ backgroundColor: teamColors[pred.teamAbbrev] || '#374151', color: 'white' }}
                    >
                      {pred.teamAbbrev}
                    </div>
                    <div>
                      <div className="font-medium text-white">{pred.playerName}</div>
                      <div className="text-slate-500 text-xs">{pred.team}</div>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-2 text-center">
                  <span className="text-slate-300">
                    {pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev}
                  </span>
                </td>
                <td className="py-3 px-2 text-center text-slate-400 text-sm">
                  {pred.gameTime}
                </td>
                <td className="py-3 px-2 text-center">
                  <span className="text-blue-400 font-mono">{pred.expectedValue.toFixed(3)}</span>
                </td>
                <td className="py-3 px-2 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${
                          pred.probability >= 0.4 ? 'bg-emerald-500' :
                          pred.probability >= 0.25 ? 'bg-blue-500' :
                          'bg-slate-600'
                        }`}
                        style={{ width: `${pred.probability * 100}%` }}
                      />
                    </div>
                    <span className={`font-semibold ${
                      pred.probability >= 0.4 ? 'text-emerald-400' :
                      pred.probability >= 0.25 ? 'text-blue-400' :
                      'text-slate-400'
                    }`}>
                      {formatProbability(pred.probability)}
                    </span>
                  </div>
                </td>
                <td className="py-3 px-2 text-center">
                  <span className={`text-sm ${
                    pred.confidence >= 0.8 ? 'text-emerald-400' :
                    pred.confidence >= 0.6 ? 'text-yellow-400' :
                    'text-slate-500'
                  }`}>
                    {pred.confidence >= 0.8 ? '●●●' : pred.confidence >= 0.6 ? '●●○' : '●○○'}
                  </span>
                </td>
                <td className="py-3 px-2 text-center">
                  {pred.isValueBet ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-xs font-medium">
                      🔥 Value
                    </span>
                  ) : (
                    <span className="text-slate-600 text-xs">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredPredictions.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-4">🏒</div>
          <h3 className="text-lg font-medium text-slate-400">No predictions available</h3>
          <p className="text-slate-500 text-sm mt-2">
            {showValueOnly ? 'No value bets found. Try showing all predictions.' : 'Check back closer to game time'}
          </p>
        </div>
      )}

      {/* Model Info */}
      <div className="mt-8 p-4 bg-slate-900/50 border border-slate-800 rounded-xl">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🧠</span>
          <div>
            <h3 className="font-semibold text-white mb-1">How This Model Works</h3>
            <p className="text-slate-400 text-sm">
              Predictions are generated using a Poisson distribution model based on each player's 
              goals-per-game rate. We weight recent performance (last 10 games) at 30% and season 
              average at 70%, then apply situational adjustments for home/away (+/-5%), 
              back-to-back games (-15%), and opponent strength. Value bets are identified when 
              our model probability exceeds the estimated sportsbook implied probability by 3%+.
            </p>
          </div>
        </div>
      </div>

      {propsData?.error && (
        <div className="mt-4 p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg">
          <p className="text-amber-400 text-sm">⚠️ {propsData.error}</p>
        </div>
      )}
    </div>
  );
}
