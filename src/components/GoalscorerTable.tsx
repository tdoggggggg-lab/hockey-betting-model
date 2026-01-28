// src/components/GoalscorerTable.tsx
// ============================================================
// GOALSCORER TABLE - Complete ready-to-deploy version
// ============================================================
// 
// FEATURES:
// - Top 10 players in "All Games" dropdown (not Top 20)
// - Top Picks cards showing 6 best bets
// - ALL games shown in dropdown
// - Stats banner with games/players/picks counts
//
// ⚠️ NO HARDCODED PLAYER NAMES - All data from API
// ============================================================

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
  gamesPlayed?: number;
  betClassification?: 'best_bet' | 'strong_value' | 'value' | 'lean' | 'none';
  edge?: number;
  edgePercent?: string;
  bookOdds?: number | null;
  bookLine?: string;
  fairOdds?: number;
  expectedProfit?: number;
  kellyFraction?: number;
  reasons?: string[];
  isValueBet?: boolean;  // Legacy
  injuryNote?: string;
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
  games?: Array<{  // ✅ Games from API for dropdown
    id: string;
    homeAbbrev: string;
    awayAbbrev: string;
    homeName: string;
    awayName: string;
    gameTime: string;
  }>;
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

// Team colors for badges - this is STABLE data (colors don't change frequently)
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

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-3 text-slate-400">Loading predictions...</span>
      </div>
    );
  }

  // Error state
  if (error || !propsData) {
    return (
      <div className="text-center py-12">
        <div className="text-red-400 mb-2">Error loading predictions</div>
        <div className="text-slate-500 text-sm">{error}</div>
      </div>
    );
  }

  // Build games list - prefer API games array, fallback to building from predictions
  const gamesMap = new Map<string, GameInfo>();
  
  // Use games from API if available (all games, not just ones with players)
  if (propsData.games && propsData.games.length > 0) {
    propsData.games.forEach(game => {
      gamesMap.set(game.id, {
        id: game.id,
        label: `${game.awayAbbrev} @ ${game.homeAbbrev}`,
        awayAbbrev: game.awayAbbrev,
        homeAbbrev: game.homeAbbrev,
        gameTime: game.gameTime,
      });
    });
  } else {
    // Fallback: build from predictions
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
  }
  const games = Array.from(gamesMap.values());

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

  // Get top 6 picks for the cards (sorted by probability, then name for consistency)
  const topPicks = [...propsData.predictions]
    .sort((a, b) => {
      if (b.probability !== a.probability) return b.probability - a.probability;
      return a.playerName.localeCompare(b.playerName);
    })
    .slice(0, 6);

  // Filter predictions for table
  let filteredPredictions = [...propsData.predictions];
  
  // Sort first (with deterministic tie-breaking by player name)
  if (sortBy === 'probability') {
    filteredPredictions.sort((a, b) => {
      if (b.probability !== a.probability) return b.probability - a.probability;
      return a.playerName.localeCompare(b.playerName);
    });
  } else if (sortBy === 'confidence') {
    filteredPredictions.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.playerName.localeCompare(b.playerName);
    });
  } else if (sortBy === 'edge') {
    filteredPredictions.sort((a, b) => {
      const edgeDiff = (b.edge || 0) - (a.edge || 0);
      if (edgeDiff !== 0) return edgeDiff;
      return a.playerName.localeCompare(b.playerName);
    });
  }
  
  // Filter by game
  if (selectedGame !== 'all') {
    const game = gamesMap.get(selectedGame);
    if (game) {
      filteredPredictions = filteredPredictions.filter(p => 
        p.teamAbbrev === game.homeAbbrev || p.teamAbbrev === game.awayAbbrev
      );
    }
  } else {
    // *** TOP 10 for "All Games" - NOT Top 20 ***
    filteredPredictions = filteredPredictions.slice(0, 10);
  }

  const betSummary = propsData.betSummary || { bestValue: 0, value: 0, best: 0, total: 0 };

  return (
    <div className="px-4">
      {/* Stats Banner */}
      <div className="mb-6 p-4 bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-800/50 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">Anytime Goalscorer</h2>
            <p className="text-slate-400 text-sm">Model-generated probabilities using Poisson distribution</p>
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
      </div>

      {/* ============================================ */}
      {/* TOP PICKS CARDS - 6 players in 3x2 grid    */}
      {/* ============================================ */}
      {topPicks.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            🎯 Top Picks
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {topPicks.map((pred, index) => (
              <div 
                key={`topPick-${pred.playerId}-${index}`} 
                className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3"
              >
                {/* Header row: Team badge, name, rank */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-10 h-10 rounded flex items-center justify-center text-xs font-bold" 
                      style={{ backgroundColor: teamColors[pred.teamAbbrev] || '#374151', color: 'white' }}
                    >
                      {pred.teamAbbrev}
                    </div>
                    <div>
                      <div className="font-medium text-white">{pred.playerName}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-400 font-bold text-lg">#{index + 1}</div>
                  </div>
                </div>
                {/* Stats row: Prob, Fair, Edge/Confidence */}
                <div className="mt-3 flex justify-between text-sm">
                  <div>
                    <div className="text-slate-500 text-xs">Prob</div>
                    <div className="text-white font-semibold">{formatProbability(pred.probability)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-xs">Fair</div>
                    <div className="text-emerald-400 font-semibold">{formatFairOdds(pred.probability)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-xs">&nbsp;</div>
                    {pred.edge && pred.edge > 0.03 ? (
                      <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                        +{(pred.edge * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-slate-400 text-sm">
                        {Math.round(pred.confidence * 100)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* FILTERS - Game dropdown & Sort              */}
      {/* ============================================ */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <select 
            value={selectedGame} 
            onChange={(e) => setSelectedGame(e.target.value)} 
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm min-w-[180px]"
          >
            {/* *** TOP 10 - NOT Top 20 *** */}
            <option value="all">🏆 All Games (Top 10)</option>
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

      {/* ============================================ */}
      {/* TABLE                                        */}
      {/* ============================================ */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Player</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Matchup</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Time</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Exp. Goals</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Probability</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Fair Odds</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Book Odds</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Confidence</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Bets</th>
            </tr>
          </thead>
          <tbody>
            {filteredPredictions.map((pred, index) => {
              const confDisplay = formatConfidence(pred.confidence);
              return (
                <tr 
                  key={`row-${pred.playerId}-${index}`} 
                  className="border-b border-slate-800/50 hover:bg-slate-900/30"
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
                  <td className="py-3 px-2 text-center text-slate-300">
                    {pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev}
                  </td>
                  <td className="py-3 px-2 text-center text-slate-400 text-sm">{pred.gameTime}</td>
                  <td className="py-3 px-2 text-center">
                    <span className="text-blue-400 font-mono">{pred.expectedValue.toFixed(2)}</span>
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
                    {/* Bet Classification from API - using prop-specific thresholds */}
                    {pred.betClassification === 'best_bet' ? (
                      <div className="flex flex-col items-center">
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-yellow-600/30 to-amber-600/30 border border-yellow-500/50 text-yellow-300 rounded text-xs font-medium">
                          ⭐ Best Bet
                        </span>
                        {pred.kellyFraction && (
                          <span className="text-xs text-yellow-500/70 mt-1">{(pred.kellyFraction * 100).toFixed(0)}% Kelly</span>
                        )}
                      </div>
                    ) : pred.betClassification === 'strong_value' ? (
                      <div className="flex flex-col items-center">
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 rounded text-xs font-medium">
                          💰 Strong Value
                        </span>
                        {pred.kellyFraction && (
                          <span className="text-xs text-emerald-500/70 mt-1">{(pred.kellyFraction * 100).toFixed(0)}% Kelly</span>
                        )}
                      </div>
                    ) : pred.betClassification === 'value' ? (
                      <div className="flex flex-col items-center">
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/20 border border-blue-500/50 text-blue-400 rounded text-xs font-medium">
                          ✓ Value
                        </span>
                      </div>
                    ) : pred.betClassification === 'lean' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-500/20 border border-slate-500/50 text-slate-400 rounded text-xs font-medium">
                        → Lean
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

      {/* Empty state */}
      {filteredPredictions.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-4">🏒</div>
          <h3 className="text-lg font-medium text-slate-400">No predictions available</h3>
          <p className="text-slate-500 text-sm mt-2">Check back closer to game time</p>
        </div>
      )}

      {/* Info Footer */}
      <div className="mt-6 p-4 bg-slate-800/30 rounded-lg">
        <h4 className="text-sm font-medium text-slate-400 mb-2">Bet Classification (Prop-Specific Thresholds)</h4>
        <div className="text-xs text-slate-500 space-y-1">
          <p><span className="text-yellow-300">⭐ Best Bet:</span> 10%+ edge, high confidence, 30+ games played (50% Kelly)</p>
          <p><span className="text-emerald-400">💰 Strong Value:</span> 7-10% edge with good confidence (25% Kelly)</p>
          <p><span className="text-blue-400">✓ Value:</span> 5-7% edge meets goalscorer threshold (15% Kelly)</p>
          <p><span className="text-slate-400">→ Lean:</span> 55%+ probability with small positive edge</p>
        </div>
        <div className="mt-3 text-xs text-slate-600 border-t border-slate-700 pt-2">
          <p className="text-slate-500 mb-1">Goals require higher edge (5%+ min) due to high variance vs shots (3%+ min)</p>
          <p>Last updated: {propsData.lastUpdated ? new Date(propsData.lastUpdated).toLocaleString() : 'N/A'}</p>
        </div>
      </div>
    </div>
  );
}
