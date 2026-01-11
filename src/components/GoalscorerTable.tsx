'use client';

import { useState, useEffect } from 'react';

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
  betClassification?: BetClassification;
  edge?: number;
  edgePercent?: string;
  bookOdds?: number | null;
  bookLine?: string;
  fairOdds?: number;
  isValueBet?: boolean;
  breakdown?: any;
}

interface GameInfo {
  id: string;
  label: string;
  awayAbbrev: string;
  homeAbbrev: string;
  gameTime: string;
}

interface PropsData {
  predictions: PropPrediction[];
  valueBets: PropPrediction[];
  lastUpdated: string;
  gamesAnalyzed: number;
  playersAnalyzed: number;
  betSummary?: {
    bestValue: number;
    value: number;
    best: number;
    total: number;
  };
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

export default function GoalscorerTable() {
  const [propsData, setPropsData] = useState<PropsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'probability' | 'confidence'>('probability');

  useEffect(() => {
    const fetchProps = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(`/api/props?type=goalscorer&t=${Date.now()}`, {
          cache: 'no-store',
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        
        setPropsData(data);
      } catch (err) {
        console.error('Fetch error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load predictions');
      } finally {
        setLoading(false);
      }
    };
    
    fetchProps();
    const interval = setInterval(fetchProps, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-3 text-slate-400">Loading predictions...</span>
      </div>
    );
  }

  if (error || !propsData) {
    return (
      <div className="text-center py-12">
        <div className="text-red-400 mb-2">Error loading predictions</div>
        <div className="text-slate-500 text-sm">{error || 'No data available'}</div>
        <button 
          onClick={() => window.location.reload()} 
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  // Build games list
  const gamesMap = new Map<string, GameInfo>();
  propsData.predictions.forEach(pred => {
    const awayAbbrev = pred.isHome ? pred.opponentAbbrev : pred.teamAbbrev;
    const homeAbbrev = pred.isHome ? pred.teamAbbrev : pred.opponentAbbrev;
    const gameId = `${awayAbbrev}-${homeAbbrev}`;
    
    if (!gamesMap.has(gameId)) {
      gamesMap.set(gameId, {
        id: gameId,
        label: `${awayAbbrev} @ ${homeAbbrev}`,
        awayAbbrev,
        homeAbbrev,
        gameTime: pred.gameTime,
      });
    }
  });
  const games = Array.from(gamesMap.values());

  // Get sorted predictions
  const sortedPredictions = [...propsData.predictions].sort((a, b) => b.probability - a.probability);

  // Filter predictions
  let filteredPredictions: PropPrediction[];
  
  if (selectedGame === 'all') {
    filteredPredictions = sortedPredictions.slice(0, 15);
  } else {
    const game = gamesMap.get(selectedGame);
    if (game) {
      filteredPredictions = sortedPredictions.filter(p => 
        p.teamAbbrev === game.homeAbbrev || p.teamAbbrev === game.awayAbbrev
      );
    } else {
      filteredPredictions = [];
    }
  }
  
  // Apply sort
  if (sortBy === 'confidence') {
    filteredPredictions = [...filteredPredictions].sort((a, b) => b.confidence - a.confidence);
  }

  // Get top 6 picks for cards (ORIGINAL DESIGN - always show top 6 overall)
  const topPicks = sortedPredictions.slice(0, 6);

  // Helper functions
  const formatProbability = (prob: number) => `${(prob * 100).toFixed(1)}%`;
  
  const formatFairOdds = (prob: number) => {
    if (prob <= 0 || prob >= 1) return '-';
    if (prob >= 0.5) return Math.round((-100 * prob) / (1 - prob)).toString();
    return `+${Math.round((100 * (1 - prob)) / prob)}`;
  };
  
  const formatConfidence = (conf: number) => {
    if (conf >= 0.75) return { dots: '●●●', color: 'text-emerald-400', label: 'High' };
    if (conf >= 0.50) return { dots: '●●○', color: 'text-yellow-400', label: 'Med' };
    return { dots: '●○○', color: 'text-slate-500', label: 'Low' };
  };

  // Check if a player is in top picks
  const isTopPick = (playerId: number) => topPicks.some(p => p.playerId === playerId);

  return (
    <div className="px-4">
      {/* ============ STATS BANNER - MATCHING IMAGE 2 ============ */}
      <div className="mb-6 p-4 bg-slate-800/50 border border-slate-700/50 rounded-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">Anytime Goalscorer</h2>
            <p className="text-slate-400 text-sm">Model predictions with Poisson distribution</p>
          </div>
          <div className="flex items-center gap-8">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{propsData.gamesAnalyzed}</div>
              <div className="text-slate-500 text-xs">Games</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-400">{propsData.playersAnalyzed}</div>
              <div className="text-slate-500 text-xs">Players</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-400">{topPicks.length}</div>
              <div className="text-slate-500 text-xs">Top Picks</div>
            </div>
          </div>
        </div>
      </div>

      {/* ============ TOP 6 PICKS CARDS - MATCHING IMAGE 2 ============ */}
      {topPicks.length > 0 && (
        <div className="mb-6">
          <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
            🎯 Top Picks
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {topPicks.map((pred, index) => (
              <div 
                key={pred.playerId} 
                className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-3 hover:border-slate-600 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold" 
                      style={{ backgroundColor: teamColors[pred.teamAbbrev] || '#374151', color: 'white' }}
                    >
                      {pred.teamAbbrev}
                    </div>
                    <div>
                      <div className="font-medium text-white text-sm">{pred.playerName}</div>
                      <div className="text-xs text-slate-400">
                        {pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev}
                      </div>
                    </div>
                  </div>
                  <div className="text-emerald-400 font-bold">#{index + 1}</div>
                </div>
                <div className="mt-2 flex justify-between text-xs">
                  <div>
                    <span className="text-slate-500">Prob: </span>
                    <span className="text-white font-semibold">{formatProbability(pred.probability)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Fair: </span>
                    <span className="text-emerald-400 font-semibold">{formatFairOdds(pred.probability)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============ FILTERS ============ */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <select 
            value={selectedGame} 
            onChange={(e) => setSelectedGame(e.target.value)} 
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm min-w-[160px]"
          >
            <option value="all">All Games (Top 15)</option>
            {games.map(game => (
              <option key={game.id} value={game.id}>{game.label}</option>
            ))}
          </select>
          
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value as 'probability' | 'confidence')} 
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="probability">Sort by Probability</option>
            <option value="confidence">Sort by Confidence</option>
          </select>
        </div>
        
        <div className="text-slate-500 text-sm">
          {filteredPredictions.length} players
        </div>
      </div>

      {/* ============ TABLE ============ */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left py-3 px-3 text-slate-400 font-medium text-sm">Player</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Matchup</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Time</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Exp. Goals</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Probability</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Fair Odds</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Book Odds</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Confidence</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredPredictions.map((pred, index) => {
              const confDisplay = formatConfidence(pred.confidence);
              const isPick = isTopPick(pred.playerId);
              return (
                <tr 
                  key={`${pred.playerId}-${index}`} 
                  className={`border-b border-slate-800/50 hover:bg-slate-800/30 ${isPick ? 'bg-emerald-900/5' : ''}`}
                >
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold" 
                        style={{ backgroundColor: teamColors[pred.teamAbbrev] || '#374151', color: 'white' }}
                      >
                        {pred.teamAbbrev}
                      </div>
                      <div>
                        <div className="font-medium text-white text-sm">{pred.playerName}</div>
                        <div className="text-slate-500 text-xs">{pred.team}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-center text-slate-300 text-sm">
                    {pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev}
                  </td>
                  <td className="py-3 px-2 text-center text-slate-400 text-sm">{pred.gameTime}</td>
                  <td className="py-3 px-2 text-center">
                    <span className="text-blue-400 font-mono text-sm">{pred.expectedValue.toFixed(2)}</span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-14 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${
                            pred.probability >= 0.4 ? 'bg-emerald-500' : 
                            pred.probability >= 0.25 ? 'bg-blue-500' : 'bg-slate-600'
                          }`} 
                          style={{ width: `${Math.min(pred.probability * 100, 100)}%` }} 
                        />
                      </div>
                      <span className={`font-semibold text-sm ${
                        pred.probability >= 0.4 ? 'text-emerald-400' : 
                        pred.probability >= 0.25 ? 'text-blue-400' : 'text-slate-400'
                      }`}>
                        {formatProbability(pred.probability)}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className={`font-mono text-sm ${
                      pred.probability >= 0.4 ? 'text-emerald-400' : 
                      pred.probability >= 0.25 ? 'text-amber-400' : 'text-slate-400'
                    }`}>
                      {formatFairOdds(pred.probability)}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center text-slate-500 font-mono text-sm">-</td>
                  <td className="py-3 px-2 text-center">
                    <div className="flex flex-col items-center">
                      <span className={`text-sm ${confDisplay.color}`}>{confDisplay.dots}</span>
                      <span className="text-[10px] text-slate-500">{confDisplay.label}</span>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-center">
                    {isPick ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-xs font-medium">
                        🎯 Pick
                      </span>
                    ) : (
                      <span className="text-slate-600 text-xs">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredPredictions.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-4">🏒</div>
          <h3 className="text-lg font-medium text-slate-400">No predictions available</h3>
          <p className="text-slate-500 text-sm mt-2">Check back closer to game time</p>
        </div>
      )}
    </div>
  );
}
