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
  bookmakerOdds?: number;
  injuryNote?: string;  // e.g., "Linemate injured (-25%)"
  breakdown: {
    basePrediction: number;
    homeAwayAdj: number;
    backToBackAdj: number;
    opponentAdj: number;
    recentFormAdj: number;
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
  lastUpdated: string;
  gamesAnalyzed: number;
  playersAnalyzed: number;
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
  const [showValueOnly, setShowValueOnly] = useState(false);

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

  // Auto-uncheck "Top picks only" when selecting a specific game
  const handleGameChange = (value: string) => {
    setSelectedGame(value);
    if (value !== 'all') {
      setShowValueOnly(false); // Show all players for specific game
    }
  };

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

  const valueBetIds = new Set(propsData.valueBets.map(vb => vb.playerId));
  const markedPredictions = propsData.predictions.map(pred => ({
    ...pred,
    isValueBet: valueBetIds.has(pred.playerId)
  }));

  // Filter predictions
  let filteredPredictions: PropPrediction[];
  
  if (selectedGame === 'all') {
    filteredPredictions = [...markedPredictions].sort((a, b) => b.probability - a.probability).slice(0, 10);
  } else {
    const game = gamesMap.get(selectedGame);
    if (game) {
      filteredPredictions = markedPredictions.filter(p => 
        p.teamAbbrev === game.homeAbbrev || p.teamAbbrev === game.awayAbbrev
      );
    } else {
      filteredPredictions = [];
    }
  }
  
  // Apply value bets filter (only for "all games" view)
  if (showValueOnly && selectedGame === 'all') {
    filteredPredictions = filteredPredictions.filter(p => p.isValueBet);
  }
  
  // Sort
  if (sortBy === 'probability') {
    filteredPredictions = [...filteredPredictions].sort((a, b) => b.probability - a.probability);
  } else {
    filteredPredictions = [...filteredPredictions].sort((a, b) => b.confidence - a.confidence);
  }

  const formatProbability = (prob: number) => `${(prob * 100).toFixed(1)}%`;
  
  const formatFairOdds = (prob: number) => {
    if (prob <= 0 || prob >= 1) return '-';
    if (prob >= 0.5) return Math.round((-100 * prob) / (1 - prob)).toString();
    return `+${Math.round((100 * (1 - prob)) / prob)}`;
  };
  
  const formatConfidence = (conf: number) => {
    if (conf >= 0.75) return { dots: '●●●', color: 'text-emerald-400', label: 'High' };
    if (conf >= 0.50) return { dots: '●●○', color: 'text-yellow-400', label: 'Medium' };
    return { dots: '●○○', color: 'text-slate-500', label: 'Low' };
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

      {/* Top Picks */}
      {propsData.valueBets && propsData.valueBets.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            🎯 Top Picks <span className="text-sm font-normal text-slate-400">Best combination of probability & confidence</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {propsData.valueBets.slice(0, 6).map((pred, index) => (
              <div key={pred.playerId} className="bg-gradient-to-r from-emerald-900/20 to-blue-900/20 border border-emerald-800/50 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: teamColors[pred.teamAbbrev] || '#374151', color: 'white' }}>
                      {pred.teamAbbrev}
                    </div>
                    <div>
                      <div className="font-medium text-white">{pred.playerName}</div>
                      <div className="text-xs text-slate-400">{pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev} • {pred.gameTime}</div>
                      {pred.injuryNote && (
                        <div className="text-xs text-yellow-400">⚠️ {pred.injuryNote}</div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-400 font-bold text-sm">#{index + 1}</div>
                    <div className="text-xs text-slate-500">rank</div>
                  </div>
                </div>
                <div className="mt-2 flex justify-between text-sm">
                  <div><div className="text-slate-500">Probability</div><div className="text-white font-semibold">{formatProbability(pred.probability)}</div></div>
                  <div><div className="text-slate-500">Confidence</div><div className="text-white font-semibold">{Math.round(pred.confidence * 100)}%</div></div>
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
          </select>
          
          {selectedGame === 'all' && (
            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
              <input type="checkbox" checked={showValueOnly} onChange={(e) => setShowValueOnly(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-emerald-500" />
              Top picks only
            </label>
          )}
        </div>
        
        <div className="text-slate-500 text-sm">
          {filteredPredictions.length} {selectedGame === 'all' ? 'top players' : 'players'}
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
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Exp. Goals</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Probability</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm" title="Fair odds from model">Fair Odds</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm" title="Sportsbook odds (coming Jan)">Book Odds</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Confidence</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium text-sm">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredPredictions.map((pred, index) => {
              const confDisplay = formatConfidence(pred.confidence);
              return (
                <tr key={`${pred.playerId}-${index}`} className={`border-b border-slate-800/50 hover:bg-slate-900/30 ${pred.isValueBet ? 'bg-emerald-900/10' : ''}`}>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: teamColors[pred.teamAbbrev] || '#374151', color: 'white' }}>
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
                  <td className="py-3 px-2 text-center text-slate-300">{pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev}</td>
                  <td className="py-3 px-2 text-center text-slate-400 text-sm">{pred.gameTime}</td>
                  <td className="py-3 px-2 text-center"><span className="text-blue-400 font-mono">{pred.expectedValue.toFixed(3)}</span></td>
                  <td className="py-3 px-2 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pred.probability >= 0.4 ? 'bg-emerald-500' : pred.probability >= 0.25 ? 'bg-blue-500' : 'bg-slate-600'}`} style={{ width: `${Math.min(pred.probability * 100, 100)}%` }} />
                      </div>
                      <span className={`font-semibold ${pred.probability >= 0.4 ? 'text-emerald-400' : pred.probability >= 0.25 ? 'text-blue-400' : 'text-slate-400'}`}>
                        {formatProbability(pred.probability)}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className={`font-mono text-sm ${pred.probability >= 0.4 ? 'text-emerald-400' : pred.probability >= 0.25 ? 'text-amber-400' : 'text-slate-400'}`}>
                      {formatFairOdds(pred.probability)}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center text-slate-500 font-mono text-sm">-</td>
                  <td className="py-3 px-2 text-center">
                    <div className="flex flex-col items-center">
                      <span className={`text-sm ${confDisplay.color}`}>{confDisplay.dots}</span>
                      <span className="text-xs text-slate-500">{confDisplay.label}</span>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-center">
                    {pred.isValueBet ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-xs font-medium">🎯 Top Pick</span>
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

      {/* Info Footer */}
      <div className="mt-6 p-4 bg-slate-800/30 rounded-lg">
        <h4 className="text-sm font-medium text-slate-400 mb-2">About the Predictions</h4>
        <div className="text-xs text-slate-500 space-y-1">
          <p><strong>Fair Odds:</strong> What the odds should be based on our model&apos;s probability (no vig)</p>
          <p><strong>Book Odds:</strong> Live sportsbook odds from DraftKings, FanDuel, etc. (coming January)</p>
          <p><strong>Probability:</strong> Model-predicted chance of scoring using Poisson distribution</p>
          <p><strong>Confidence:</strong> How reliable the prediction is (player quality, form, matchup)</p>
        </div>
        <div className="mt-2 text-xs text-slate-600">Last updated: {propsData.lastUpdated ? new Date(propsData.lastUpdated).toLocaleString() : 'N/A'}</div>
      </div>
    </div>
  );
}
