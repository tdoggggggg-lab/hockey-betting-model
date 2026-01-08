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
  injuryNote?: string;  // e.g., "Linemate injured (-25%)"
  bookOdds?: {
    over: number;
    under: number;
    line: number;
  };
}

interface PropsData {
  predictions: PropPrediction[];
  valueBets: PropPrediction[];
  lastUpdated: string;
  gamesAnalyzed: number;
  playersAnalyzed: number;
}

interface PlayerPropsTableProps {
  propType: 'goalscorer' | 'shots' | 'points' | 'assists';
  title: string;
  statLabel: string; // "Exp. Goals", "Exp. Shots", etc.
}

const teamColors: Record<string, string> = {
  'EDM': '#FF4C00', 'BOS': '#FFB81C', 'MTL': '#AF1E2D', 'CHI': '#CF0A2C',
  'TOR': '#00205B', 'NYR': '#0038A8', 'COL': '#6F263D', 'VGK': '#B4975A',
  'FLA': '#041E42', 'DAL': '#006847', 'CAR': '#CC0000', 'NJD': '#CE1126',
  'WPG': '#041E42', 'VAN': '#00205B', 'LAK': '#111111', 'MIN': '#154734',
  'TBL': '#002868', 'SEA': '#99D9D9', 'OTT': '#C52032', 'PIT': '#FCB514',
  'WSH': '#C8102E', 'CGY': '#D2001C', 'STL': '#002F87', 'DET': '#CE1126',
  'PHI': '#F74902', 'BUF': '#002654', 'ANA': '#F47A38', 'NSH': '#FFB81C',
  'CBJ': '#002654', 'SJS': '#006D75', 'UTA': '#6CACE4', 'NYI': '#00539B',
};

export default function PlayerPropsTable({ propType, title, statLabel }: PlayerPropsTableProps) {
  const [propsData, setPropsData] = useState<PropsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'probability' | 'confidence' | 'expectedValue'>('probability');

  useEffect(() => {
    const fetchProps = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/props?type=${propType}`);
        if (!response.ok) throw new Error('Failed to fetch props');
        const data = await response.json();
        setPropsData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load predictions');
      } finally {
        setLoading(false);
      }
    };
    fetchProps();
    const interval = setInterval(fetchProps, 5 * 60 * 1000); // Refresh every 5 min
    return () => clearInterval(interval);
  }, [propType]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mb-4"></div>
        <span className="text-slate-400">Loading {title.toLowerCase()}...</span>
      </div>
    );
  }

  if (error || !propsData) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-4">⚠️</div>
        <div className="text-red-400 mb-2">Error loading predictions</div>
        <div className="text-slate-500 text-sm">{error}</div>
        <button 
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Build games list for filter
  const gamesMap = new Map<string, { id: string; label: string; awayAbbrev: string; homeAbbrev: string }>();
  propsData.predictions.forEach(pred => {
    const awayAbbrev = pred.isHome ? pred.opponentAbbrev : pred.teamAbbrev;
    const homeAbbrev = pred.isHome ? pred.teamAbbrev : pred.opponentAbbrev;
    const gameId = `${awayAbbrev}-${homeAbbrev}`;
    if (!gamesMap.has(gameId)) {
      gamesMap.set(gameId, { id: gameId, label: `${awayAbbrev} @ ${homeAbbrev}`, awayAbbrev, homeAbbrev });
    }
  });
  const games = Array.from(gamesMap.values());

  // Filter and sort predictions
  let filtered = [...propsData.predictions];
  
  if (selectedGame !== 'all') {
    const game = gamesMap.get(selectedGame);
    if (game) {
      filtered = filtered.filter(p => 
        p.teamAbbrev === game.homeAbbrev || p.teamAbbrev === game.awayAbbrev
      );
    }
  } else {
    // Show top 15 for "all games" view
    filtered = filtered.slice(0, 15);
  }

  // Sort
  filtered.sort((a, b) => {
    if (sortBy === 'probability') return b.probability - a.probability;
    if (sortBy === 'confidence') return b.confidence - a.confidence;
    return b.expectedValue - a.expectedValue;
  });

  const formatProbability = (prob: number) => `${(prob * 100).toFixed(1)}%`;
  
  const formatFairOdds = (prob: number) => {
    if (prob <= 0 || prob >= 1) return '-';
    if (prob >= 0.5) return Math.round((-100 * prob) / (1 - prob)).toString();
    return `+${Math.round((100 * (1 - prob)) / prob)}`;
  };

  const getConfidenceDisplay = (conf: number) => {
    if (conf >= 0.75) return { dots: '●●●', color: 'text-emerald-400', label: 'High' };
    if (conf >= 0.50) return { dots: '●●○', color: 'text-yellow-400', label: 'Med' };
    return { dots: '●○○', color: 'text-slate-500', label: 'Low' };
  };

  return (
    <div className="px-4">
      {/* Header Stats */}
      <div className="mb-6 p-4 bg-gradient-to-r from-slate-800/50 to-slate-900/50 border border-slate-700 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">{title}</h2>
            <p className="text-slate-400 text-sm">Model predictions with Poisson distribution</p>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{propsData.gamesAnalyzed}</div>
              <div className="text-slate-500">Games</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-400">{propsData.playersAnalyzed}</div>
              <div className="text-slate-500">Players</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-400">{propsData.valueBets?.length || 0}</div>
              <div className="text-slate-500">Top Picks</div>
            </div>
          </div>
        </div>
      </div>

      {/* Top Picks Cards */}
      {propsData.valueBets && propsData.valueBets.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            🎯 Top Picks
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {propsData.valueBets.slice(0, 6).map((pred, index) => (
              <div key={pred.playerId} className="bg-gradient-to-r from-emerald-900/20 to-slate-800/50 border border-emerald-800/50 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" 
                      style={{ backgroundColor: teamColors[pred.teamAbbrev] || '#374151', color: 'white' }}
                    >
                      {pred.teamAbbrev}
                    </div>
                    <div>
                      <div className="font-medium text-white text-sm">{pred.playerName}</div>
                      <div className="text-xs text-slate-400">{pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev}</div>
                      {pred.injuryNote && (
                        <div className="text-xs text-yellow-400">⚠️ {pred.injuryNote}</div>
                      )}
                    </div>
                  </div>
                  <div className="text-emerald-400 font-bold">#{index + 1}</div>
                </div>
                <div className="mt-2 flex justify-between text-xs">
                  <span className="text-slate-400">Prob: <span className="text-white">{formatProbability(pred.probability)}</span></span>
                  <span className="text-slate-400">Fair: <span className="text-emerald-400">{formatFairOdds(pred.probability)}</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <select 
            value={selectedGame} 
            onChange={(e) => setSelectedGame(e.target.value)} 
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm min-w-[180px]"
          >
            <option value="all">All Games (Top 15)</option>
            {games.map(game => (
              <option key={game.id} value={game.id}>{game.label}</option>
            ))}
          </select>
          
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value as any)} 
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="probability">Sort by Probability</option>
            <option value="confidence">Sort by Confidence</option>
            <option value="expectedValue">Sort by {statLabel}</option>
          </select>
        </div>
        
        <div className="text-slate-500 text-sm">
          {filtered.length} players
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full">
          <thead className="bg-slate-800/50">
            <tr>
              <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Player</th>
              <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Matchup</th>
              <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Time</th>
              <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">{statLabel}</th>
              <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Probability</th>
              <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Fair Odds</th>
              <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Book Odds</th>
              <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Confidence</th>
              <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((pred, index) => {
              const conf = getConfidenceDisplay(pred.confidence);
              const isTopPick = propsData.valueBets?.some(v => v.playerId === pred.playerId);
              
              return (
                <tr 
                  key={`${pred.playerId}-${index}`} 
                  className={`border-t border-slate-800/50 hover:bg-slate-800/30 ${isTopPick ? 'bg-emerald-900/10' : ''}`}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" 
                        style={{ backgroundColor: teamColors[pred.teamAbbrev] || '#374151', color: 'white' }}
                      >
                        {pred.teamAbbrev}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">{pred.playerName}</div>
                        <div className="text-slate-500 text-xs truncate">{pred.team}</div>
                        {pred.injuryNote && (
                          <div className="text-xs text-yellow-400">⚠️ {pred.injuryNote}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center text-slate-300 text-sm">
                    {pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev}
                  </td>
                  <td className="py-3 px-3 text-center text-slate-400 text-sm">{pred.gameTime}</td>
                  <td className="py-3 px-3 text-center">
                    <span className="text-blue-400 font-mono">{pred.expectedValue.toFixed(2)}</span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${
                            pred.probability >= 0.35 ? 'bg-emerald-500' : 
                            pred.probability >= 0.20 ? 'bg-blue-500' : 'bg-slate-500'
                          }`} 
                          style={{ width: `${Math.min(pred.probability * 100, 100)}%` }} 
                        />
                      </div>
                      <span className={`font-medium text-sm ${
                        pred.probability >= 0.35 ? 'text-emerald-400' : 
                        pred.probability >= 0.20 ? 'text-blue-400' : 'text-slate-400'
                      }`}>
                        {formatProbability(pred.probability)}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className="font-mono text-sm text-amber-400">{formatFairOdds(pred.probability)}</span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    {pred.bookOdds ? (
                      <span className="font-mono text-sm text-white">
                        {pred.bookOdds.over > 0 ? '+' : ''}{pred.bookOdds.over}
                      </span>
                    ) : (
                      <span className="text-slate-600 text-sm">-</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <div className="flex flex-col items-center">
                      <span className={`text-sm ${conf.color}`}>{conf.dots}</span>
                      <span className="text-xs text-slate-500">{conf.label}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center">
                    {isTopPick ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-xs font-medium">
                        🎯 Pick
                      </span>
                    ) : (
                      <span className="text-slate-600">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-4">🏒</div>
          <h3 className="text-lg font-medium text-slate-400">No predictions available</h3>
          <p className="text-slate-500 text-sm mt-2">Check back closer to game time</p>
        </div>
      )}

      {/* Footer Info */}
      <div className="mt-6 p-4 bg-slate-800/30 rounded-lg text-xs text-slate-500">
        <p><strong className="text-slate-400">Fair Odds:</strong> What odds should be based on model probability (no vig)</p>
        <p><strong className="text-slate-400">Book Odds:</strong> Live sportsbook odds (when available)</p>
        <p className="mt-2 text-slate-600">Last updated: {propsData.lastUpdated ? new Date(propsData.lastUpdated).toLocaleString() : 'N/A'}</p>
      </div>
    </div>
  );
}
