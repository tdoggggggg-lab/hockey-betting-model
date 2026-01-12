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
  injuryNote?: string;
  breakdown?: {
    basePrediction: number;
    homeAwayAdj: number;
    productionMultiplier?: number;
    finalPrediction: number;
  };
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
  bestValueBets?: PropPrediction[];
  bestBetsOnly?: PropPrediction[];
  valueBetsOnly?: PropPrediction[];
  lastUpdated: string;
  gamesAnalyzed: number;
  playersAnalyzed: number;
  injuredPlayersFiltered?: number;
  filteredPlayerNames?: string[];
  injurySource?: string;
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
  const [sortBy, setSortBy] = useState<'probability' | 'confidence' | 'edge'>('probability');
  const [betFilter, setBetFilter] = useState<'all' | 'value' | 'best' | 'best_value'>('all');

  useEffect(() => {
    const fetchProps = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/props?type=goalscorer');
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
        <div className="text-slate-500 text-sm">{error}</div>
      </div>
    );
  }

  // Build games list from predictions
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

  // Determine which players are "top picks" from valueBets
  const topPickIds = new Set(propsData.valueBets?.map(vb => vb.playerId) || []);
  const bestValueIds = new Set(propsData.bestValueBets?.map(p => p.playerId) || []);
  const bestBetIds = new Set(propsData.bestBetsOnly?.map(p => p.playerId) || []);
  const valueOnlyIds = new Set(propsData.valueBetsOnly?.map(p => p.playerId) || []);

  // Mark predictions with bet classification
  const markedPredictions = propsData.predictions.map(pred => {
    let betClassification: BetClassification = pred.betClassification || 'none';
    
    // Override with explicit arrays if available
    if (bestValueIds.has(pred.playerId)) betClassification = 'best_value';
    else if (valueOnlyIds.has(pred.playerId)) betClassification = 'value';
    else if (bestBetIds.has(pred.playerId)) betClassification = 'best';
    
    return {
      ...pred,
      betClassification,
      isValueBet: topPickIds.has(pred.playerId) || betClassification !== 'none'
    };
  });

  // Filter predictions
  let filteredPredictions = [...markedPredictions];
  
  // Filter by game
  if (selectedGame !== 'all') {
    const game = gamesMap.get(selectedGame);
    if (game) {
      filteredPredictions = filteredPredictions.filter(p => 
        p.teamAbbrev === game.homeAbbrev || p.teamAbbrev === game.awayAbbrev
      );
    }
  }
  
  // Filter by bet type
  if (betFilter !== 'all') {
    if (betFilter === 'best_value') {
      filteredPredictions = filteredPredictions.filter(p => p.betClassification === 'best_value');
    } else if (betFilter === 'value') {
      filteredPredictions = filteredPredictions.filter(p => 
        p.betClassification === 'value' || p.betClassification === 'best_value'
      );
    } else if (betFilter === 'best') {
      filteredPredictions = filteredPredictions.filter(p => 
        p.betClassification === 'best' || p.betClassification === 'best_value'
      );
    }
  }
  
  // Sort
  if (sortBy === 'probability') {
    filteredPredictions.sort((a, b) => b.probability - a.probability);
  } else if (sortBy === 'confidence') {
    filteredPredictions.sort((a, b) => b.confidence - a.confidence);
  } else if (sortBy === 'edge') {
    filteredPredictions.sort((a, b) => (b.edge || 0) - (a.edge || 0));
  }

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

  const getBetBadge = (classification: BetClassification) => {
    switch (classification) {
      case 'best_value':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-emerald-500/30 to-blue-500/30 text-emerald-300 border border-emerald-500/50 rounded-full text-xs font-bold">
            ⭐ Best Value
          </span>
        );
      case 'value':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-xs font-medium">
            💰 Value
          </span>
        );
      case 'best':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-400 rounded-full text-xs font-medium">
            🎯 Best Bet
          </span>
        );
      default:
        return <span className="text-slate-600 text-xs">-</span>;
    }
  };

  // Get top picks for the cards section (best_value first, then value, then best)
  const topPicks = [...markedPredictions]
    .filter(p => p.betClassification !== 'none')
    .sort((a, b) => {
      const order = { 'best_value': 0, 'value': 1, 'best': 2, 'none': 3 };
      const orderDiff = order[a.betClassification || 'none'] - order[b.betClassification || 'none'];
      if (orderDiff !== 0) return orderDiff;
      return b.probability - a.probability;
    })
    .slice(0, 6);

  const betSummary = propsData.betSummary || { bestValue: 0, value: 0, best: 0, total: 0 };

  return (
    <div className="px-4">
      {/* Stats Banner */}
      <div className="mb-6 p-4 bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-800/50 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">Anytime Goalscorer</h2>
            <p className="text-slate-400 text-sm">Poisson-based predictions with injury adjustments</p>
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
              <div className="text-2xl font-bold text-emerald-400">{betSummary.total || propsData.valueBets?.length || 0}</div>
              <div className="text-slate-500">Top Picks</div>
            </div>
          </div>
        </div>
        
        {/* Injury Filter Info */}
        {propsData.injuredPlayersFiltered && propsData.injuredPlayersFiltered > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-700/50 text-xs text-slate-500">
            🏥 {propsData.injuredPlayersFiltered} injured players filtered • Source: {propsData.injurySource || '3-source validation'}
          </div>
        )}
      </div>

      {/* Top Picks Cards */}
      {topPicks.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            🎯 Top Picks 
            <span className="text-sm font-normal text-slate-400">
              {betSummary.bestValue > 0 && <span className="text-emerald-400">{betSummary.bestValue} Best Value</span>}
              {betSummary.value > 0 && <span className="text-emerald-400 ml-2">{betSummary.value} Value</span>}
              {betSummary.best > 0 && <span className="text-blue-400 ml-2">{betSummary.best} Best Bets</span>}
            </span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {topPicks.map((pred, index) => (
              <div 
                key={pred.playerId} 
                className={`rounded-lg p-3 border ${
                  pred.betClassification === 'best_value' 
                    ? 'bg-gradient-to-r from-emerald-900/30 to-blue-900/30 border-emerald-500/50' 
                    : pred.betClassification === 'value'
                    ? 'bg-emerald-900/20 border-emerald-800/50'
                    : 'bg-blue-900/20 border-blue-800/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" 
                      style={{ backgroundColor: teamColors[pred.teamAbbrev] || '#374151', color: 'white' }}
                    >
                      {pred.teamAbbrev}
                    </div>
                    <div>
                      <div className="font-medium text-white">{pred.playerName}</div>
                      <div className="text-xs text-slate-400">
                        {pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev} • {pred.gameTime}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold text-sm ${
                      pred.betClassification === 'best_value' ? 'text-emerald-300' :
                      pred.betClassification === 'value' ? 'text-emerald-400' : 'text-blue-400'
                    }`}>
                      #{index + 1}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex justify-between text-sm">
                  <div>
                    <div className="text-slate-500">Prob</div>
                    <div className="text-white font-semibold">{formatProbability(pred.probability)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Fair Odds</div>
                    <div className="text-white font-semibold">{formatFairOdds(pred.probability)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Confidence</div>
                    <div className="text-white font-semibold">{Math.round(pred.confidence * 100)}%</div>
                  </div>
                </div>
                {pred.edge && pred.edge > 0 && (
                  <div className="mt-2 text-center">
                    <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                      +{(pred.edge * 100).toFixed(1)}% edge
                    </span>
                  </div>
                )}
                {pred.injuryNote && (
                  <div className="mt-1 text-xs text-yellow-400">⚠️ {pred.injuryNote}</div>
                )}
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
            <option value="all">🏆 All Games</option>
            {games.map(game => (
              <option key={game.id} value={game.id}>{game.label}</option>
            ))}
          </select>
          
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value as 'probability' | 'confidence' | 'edge')} 
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="probability">Sort by Probability</option>
            <option value="confidence">Sort by Confidence</option>
            <option value="edge">Sort by Edge</option>
          </select>
          
          <select 
            value={betFilter} 
            onChange={(e) => setBetFilter(e.target.value as 'all' | 'value' | 'best' | 'best_value')} 
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="all">All Players</option>
            <option value="best_value">⭐ Best Value Only</option>
            <option value="value">💰 Value Bets</option>
            <option value="best">🎯 Best Bets</option>
          </select>
        </div>
        
        <div className="text-slate-500 text-sm">
          {filteredPredictions.length} players
        </div>
      </div>

      {/* Game Header when specific game selected */}
      {selectedGame !== 'all' && gamesMap.get(selectedGame) && (
        <div className="mb-4 p-3 bg-slate-800/50 rounded-lg">
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-2">
              <div 
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" 
                style={{ backgroundColor: teamColors[gamesMap.get(selectedGame)!.awayAbbrev] || '#374151', color: 'white' }}
              >
                {gamesMap.get(selectedGame)!.awayAbbrev}
              </div>
              <span className="text-white font-medium">{gamesMap.get(selectedGame)!.awayAbbrev}</span>
            </div>
            <span className="text-slate-500">@</span>
            <div className="flex items-center gap-2">
              <div 
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" 
                style={{ backgroundColor: teamColors[gamesMap.get(selectedGame)!.homeAbbrev] || '#374151', color: 'white' }}
              >
                {gamesMap.get(selectedGame)!.homeAbbrev}
              </div>
              <span className="text-white font-medium">{gamesMap.get(selectedGame)!.homeAbbrev}</span>
            </div>
            <span className="text-slate-400 ml-4">{gamesMap.get(selectedGame)!.gameTime}</span>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Player</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Matchup</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Time</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Exp. Goals</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Probability</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm" title="Fair odds from model">Fair Odds</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm" title="Sportsbook odds">Book Odds</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Confidence</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Bets</th>
            </tr>
          </thead>
          <tbody>
            {filteredPredictions.map((pred, index) => {
              const confDisplay = formatConfidence(pred.confidence);
              return (
                <tr 
                  key={`${pred.playerId}-${index}`} 
                  className={`border-b border-slate-800/50 hover:bg-slate-900/30 ${
                    pred.betClassification === 'best_value' ? 'bg-gradient-to-r from-emerald-900/10 to-blue-900/10' :
                    pred.betClassification === 'value' ? 'bg-emerald-900/10' :
                    pred.betClassification === 'best' ? 'bg-blue-900/10' : ''
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
                        {pred.injuryNote && (
                          <div className="text-xs text-yellow-400">⚠️ {pred.injuryNote}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-center text-slate-300">
                    {pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev}
                  </td>
                  <td className="py-3 px-2 text-center text-slate-400 text-sm">{pred.gameTime}</td>
                  <td className="py-3 px-2 text-center">
                    <span className="text-blue-400 font-mono">{pred.expectedValue.toFixed(3)}</span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${
                            pred.probability >= 0.4 ? 'bg-emerald-500' : 
                            pred.probability >= 0.25 ? 'bg-blue-500' : 'bg-slate-600'
                          }`} 
                          style={{ width: `${Math.min(pred.probability * 100, 100)}%` }} 
                        />
                      </div>
                      <span className={`font-semibold ${
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
                  <td className="py-3 px-2 text-center">
                    {pred.bookOdds ? (
                      <div className="flex flex-col items-center">
                        <span className="font-mono text-sm text-white">
                          {typeof pred.bookOdds === 'number' 
                            ? (pred.bookOdds > 0 ? `+${pred.bookOdds}` : pred.bookOdds)
                            : '-'}
                        </span>
                        {pred.edge && pred.edge > 0.03 && (
                          <span className="text-xs text-emerald-400">+{(pred.edge * 100).toFixed(1)}% edge</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-600 text-xs">-</span>
                    )}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <div className="flex flex-col items-center">
                      <span className={`text-sm ${confDisplay.color}`}>{confDisplay.dots}</span>
                      <span className="text-xs text-slate-500">{confDisplay.label}</span>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-center">
                    {getBetBadge(pred.betClassification || 'none')}
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
          <p className="text-slate-500 text-sm mt-2">
            {betFilter !== 'all' 
              ? `No ${betFilter === 'best_value' ? 'best value' : betFilter} bets found. Try "All Players" filter.`
              : 'Check back closer to game time'
            }
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 p-4 bg-slate-800/30 rounded-lg">
        <h4 className="text-sm font-medium text-slate-400 mb-2">Bet Classifications</h4>
        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-gradient-to-r from-emerald-500/30 to-blue-500/30 text-emerald-300 border border-emerald-500/50 rounded-full font-bold">⭐ Best Value</span>
            <span>High probability + edge (7%+) + high confidence</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full">💰 Value</span>
            <span>Edge 7%+ vs book odds</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full">🎯 Best Bet</span>
            <span>Probability 55%+ with high confidence</span>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-600">
          Last updated: {propsData.lastUpdated ? new Date(propsData.lastUpdated).toLocaleString() : 'N/A'}
        </div>
      </div>
    </div>
  );
}
