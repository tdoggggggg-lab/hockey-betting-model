'use client';

import { useState, useEffect } from 'react';

type BetClassification = 'best_value' | 'value' | 'best' | 'none';
type PropType = 'goalscorer' | 'shots' | 'assists' | 'points' | 'saves';

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
  betClassification: BetClassification;
  edge: number;
  edgePercent: string;
  bookOdds: number | null;
  bookLine: string;
  fairOdds: number;
  expectedProfit: number;
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
  playersWithBookOdds?: number;
  bookOddsAvailable?: boolean;
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

const propTypeConfig: Record<PropType, { 
  label: string; 
  statLabel: string; 
  defaultLine: number;
  lineFormat: string;
}> = {
  goalscorer: { label: 'Anytime Goalscorer', statLabel: 'Exp. Goals', defaultLine: 0.5, lineFormat: 'Goals' },
  shots: { label: 'Shots on Goal', statLabel: 'Exp. Shots', defaultLine: 2.5, lineFormat: 'Shots' },
  assists: { label: 'Assists', statLabel: 'Exp. Assists', defaultLine: 0.5, lineFormat: 'Assists' },
  points: { label: 'Points', statLabel: 'Exp. Points', defaultLine: 0.5, lineFormat: 'Points' },
  saves: { label: 'Goalie Saves', statLabel: 'Exp. Saves', defaultLine: 25.5, lineFormat: 'Saves' },
};

function getBetBadge(classification: BetClassification): { text: string; className: string } {
  switch (classification) {
    case 'best_value':
      return {
        text: '⭐ Best Bet',
        className: 'bg-amber-500/20 text-amber-400',
      };
    case 'value':
      return {
        text: '💰 Value Bet',
        className: 'bg-emerald-500/20 text-emerald-400',
      };
    case 'best':
      return {
        text: '🎯 Best',
        className: 'bg-blue-500/20 text-blue-400',
      };
    default:
      return {
        text: '-',
        className: 'text-slate-600',
      };
  }
}

interface PropsTableProps {
  propType: PropType;
}

export default function PropsTable({ propType }: PropsTableProps) {
  const [propsData, setPropsData] = useState<PropsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'probability' | 'confidence' | 'edge'>('probability');
  const [showBetsOnly, setShowBetsOnly] = useState(false);

  const config = propTypeConfig[propType];

  useEffect(() => {
    const fetchProps = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/props?propType=${propType}`);
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
  }, [propType]);

  const handleGameChange = (value: string) => {
    setSelectedGame(value);
    if (value !== 'all') {
      setShowBetsOnly(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-3 text-slate-400">Loading {config.label.toLowerCase()} predictions...</span>
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

  // Get top 6 picks for the cards (sorted by probability, then name for consistency)
  const topPicks = [...propsData.predictions]
    .sort((a, b) => {
      if (b.probability !== a.probability) return b.probability - a.probability;
      return a.playerName.localeCompare(b.playerName);
    })
    .slice(0, 6);

  // Filter predictions
  let filteredPredictions: PropPrediction[];
  
  if (selectedGame === 'all') {
    filteredPredictions = [...propsData.predictions]
      .sort((a, b) => {
        if (b.probability !== a.probability) return b.probability - a.probability;
        return a.playerName.localeCompare(b.playerName);
      })
      .slice(0, 10);
  } else {
    const game = gamesMap.get(selectedGame);
    if (game) {
      filteredPredictions = propsData.predictions.filter(p => 
        p.teamAbbrev === game.homeAbbrev || p.teamAbbrev === game.awayAbbrev
      );
    } else {
      filteredPredictions = [];
    }
  }
  
  // Apply bets only filter
  if (showBetsOnly && selectedGame === 'all') {
    filteredPredictions = filteredPredictions.filter(p => p.betClassification !== 'none');
  }
  
  // Sort (with deterministic tie-breaking by player name)
  if (sortBy === 'probability') {
    filteredPredictions = [...filteredPredictions].sort((a, b) => {
      if (b.probability !== a.probability) return b.probability - a.probability;
      return a.playerName.localeCompare(b.playerName);
    });
  } else if (sortBy === 'confidence') {
    filteredPredictions = [...filteredPredictions].sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.playerName.localeCompare(b.playerName);
    });
  } else if (sortBy === 'edge') {
    filteredPredictions = [...filteredPredictions].sort((a, b) => {
      if (b.edge !== a.edge) return b.edge - a.edge;
      return a.playerName.localeCompare(b.playerName);
    });
  }

  const formatProbability = (prob: number) => `${(prob * 100).toFixed(1)}%`;
  
  const formatFairOdds = (prob: number) => {
    if (prob <= 0 || prob >= 1) return '-';
    if (prob >= 0.5) return Math.round((-100 * prob) / (1 - prob)).toString();
    return `+${Math.round((100 * (1 - prob)) / prob)}`;
  };
  
  const formatBookOdds = (odds: number | null) => {
    if (odds === null || odds === 0) return '-';
    return odds > 0 ? `+${odds}` : `${odds}`;
  };
  
  const formatConfidence = (conf: number) => {
    if (conf >= 0.75) return { dots: '●●●', color: 'text-emerald-400', label: 'High' };
    if (conf >= 0.50) return { dots: '●●○', color: 'text-blue-400', label: 'Med' };
    return { dots: '●○○', color: 'text-slate-500', label: 'Low' };
  };

  // Bet summary for header
  const betSummary = propsData.betSummary || { bestValue: 0, value: 0, best: 0, total: 0 };

  return (
    <div className="bg-slate-900/50 rounded-xl p-6">
      {/* Bet Summary Header */}
      {betSummary.total > 0 && (
        <div className="mb-6 p-4 bg-gradient-to-r from-emerald-900/30 to-blue-900/30 border border-emerald-800/50 rounded-lg">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            🎯 {config.label} Bets ({betSummary.total} found)
          </h3>
          <div className="flex flex-wrap gap-4">
            {betSummary.bestValue > 0 && (
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 bg-gradient-to-r from-yellow-600/30 to-emerald-600/30 border border-yellow-500/50 text-yellow-300 rounded text-xs font-medium">
                  Best Value
                </span>
                <span className="text-white font-bold">{betSummary.bestValue}</span>
              </div>
            )}
            {betSummary.value > 0 && (
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 rounded text-xs font-medium">
                  Value
                </span>
                <span className="text-white font-bold">{betSummary.value}</span>
              </div>
            )}
            {betSummary.best > 0 && (
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 bg-blue-500/20 border border-blue-500/50 text-blue-400 rounded text-xs font-medium">
                  Best
                </span>
                <span className="text-white font-bold">{betSummary.best}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top Picks Cards - 6 players in 3x2 grid */}
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
                    <div className="text-white font-semibold">{(pred.probability * 100).toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-xs">Fair</div>
                    <div className="text-emerald-400 font-semibold">
                      {pred.probability >= 0.5 
                        ? Math.round((-100 * pred.probability) / (1 - pred.probability))
                        : `+${Math.round((100 * (1 - pred.probability)) / pred.probability)}`
                      }
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-xs">&nbsp;</div>
                    {pred.edge > 0.03 ? (
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

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <select value={selectedGame} onChange={(e) => handleGameChange(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm min-w-[200px]">
            <option value="all">🏆 All Games (Top 10)</option>
            {games.map(game => (
              <option key={game.id} value={game.id}>{game.label}</option>
            ))}
          </select>
          
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm">
            <option value="probability">Sort by Probability</option>
            <option value="confidence">Sort by Confidence</option>
            <option value="edge">Sort by Edge</option>
          </select>
          
          {selectedGame === 'all' && (
            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
              <input type="checkbox" checked={showBetsOnly} onChange={(e) => setShowBetsOnly(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-emerald-500" />
              Bets only
            </label>
          )}
        </div>
        
        <div className="text-slate-500 text-sm">
          {filteredPredictions.length} players
          {propsData.playersWithBookOdds !== undefined && propsData.playersWithBookOdds > 0 && (
            <span className="ml-2 text-emerald-400">• {propsData.playersWithBookOdds} with book odds</span>
          )}
        </div>
      </div>

      {/* Game Header when specific game selected */}
      {selectedGame !== 'all' && gamesMap.get(selectedGame) && (
        <div className="mb-4 p-3 bg-slate-800/50 rounded-lg">
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: teamColors[gamesMap.get(selectedGame)!.awayAbbrev] || '#374151', color: 'white' }}>
                {gamesMap.get(selectedGame)!.awayAbbrev}
              </div>
              <span className="text-white font-medium">{gamesMap.get(selectedGame)!.awayAbbrev}</span>
            </div>
            <span className="text-slate-500">@</span>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: teamColors[gamesMap.get(selectedGame)!.homeAbbrev] || '#374151', color: 'white' }}>
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
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">{config.statLabel}</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Probability</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Fair Odds</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Book Line</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Book Odds</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Confidence</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Bets</th>
            </tr>
          </thead>
          <tbody>
            {filteredPredictions.map((pred, index) => {
              const confDisplay = formatConfidence(pred.confidence);
              const betBadge = getBetBadge(pred.betClassification);
              return (
                <tr key={`${pred.playerId}-${index}`} className={`border-b border-slate-800/50 hover:bg-slate-900/30 ${pred.betClassification !== 'none' ? 'bg-emerald-900/10' : ''}`}>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: teamColors[pred.teamAbbrev] || '#374151', color: 'white' }}>
                        {pred.teamAbbrev}
                      </div>
                      <div>
                        <div className="font-medium text-white">{pred.playerName}</div>
                        <div className="text-slate-500 text-xs">{pred.team}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-center text-slate-300">{pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev}</td>
                  <td className="py-3 px-2 text-center text-slate-400 text-sm">{pred.gameTime}</td>
                  <td className="py-3 px-2 text-center"><span className="text-blue-400 font-mono">{pred.expectedValue.toFixed(2)}</span></td>
                  <td className="py-3 px-2 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pred.probability >= 0.55 ? 'bg-emerald-500' : pred.probability >= 0.40 ? 'bg-blue-500' : 'bg-slate-600'}`} style={{ width: `${Math.min(pred.probability * 100, 100)}%` }} />
                      </div>
                      <span className={`font-semibold ${pred.probability >= 0.55 ? 'text-emerald-400' : pred.probability >= 0.40 ? 'text-blue-400' : 'text-slate-400'}`}>
                        {formatProbability(pred.probability)}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className={`font-mono text-sm ${pred.probability >= 0.55 ? 'text-emerald-400' : pred.probability >= 0.40 ? 'text-amber-400' : 'text-slate-400'}`}>
                      {formatFairOdds(pred.probability)}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className="text-slate-300 text-sm">
                      {pred.bookLine || `${pred.line} ${config.lineFormat}`}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className={`font-mono text-sm ${pred.bookOdds ? 'text-white' : 'text-slate-600'}`}>
                      {formatBookOdds(pred.bookOdds)}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <div className="flex flex-col items-center">
                      <span className={`text-sm ${confDisplay.color}`}>{confDisplay.dots}</span>
                      <span className="text-xs text-slate-500">{confDisplay.label}</span>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-center">
                    {pred.betClassification !== 'none' ? (
                      <div className="flex flex-col items-center gap-1">
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${betBadge.className}`}>
                          {betBadge.text}
                        </span>
                        {pred.edge > 0 && (
                          <span className="text-xs text-emerald-400">{pred.edgePercent}</span>
                        )}
                      </div>
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
          <h3 className="text-lg font-medium text-slate-400">No {config.label.toLowerCase()} predictions available</h3>
          <p className="text-slate-500 text-sm mt-2">Check back closer to game time</p>
        </div>
      )}

      {/* Info Footer */}
      <div className="mt-6 p-4 bg-slate-800/30 rounded-lg">
        <h4 className="text-sm font-medium text-slate-400 mb-2">About {config.label} Predictions</h4>
        <div className="text-xs text-slate-500 space-y-1">
          <p><strong>Best Value:</strong> High probability (&gt;55%) AND edge (&gt;7%) - Rare, highest quality plays</p>
          <p><strong>Value:</strong> Model edge over sportsbook (&gt;7%) - May not hit often but profitable long-term</p>
          <p><strong>Best:</strong> High probability (&gt;55%) - Most likely to hit</p>
          <p><strong>Book Line:</strong> The line from sportsbooks (e.g., &quot;{config.defaultLine} {config.lineFormat}&quot;)</p>
        </div>
        <div className="mt-2 text-xs text-slate-600">Last updated: {propsData.lastUpdated ? new Date(propsData.lastUpdated).toLocaleString() : 'N/A'}</div>
      </div>
    </div>
  );
}
