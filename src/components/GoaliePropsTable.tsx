'use client';

import { useState, useEffect } from 'react';

interface GoaliePrediction {
  playerId: number;
  playerName: string;
  team: string;
  teamAbbrev: string;
  opponent: string;
  opponentAbbrev: string;
  gameTime: string;
  isHome: boolean;
  isStarter: boolean;
  // Saves prediction
  expectedSaves: number;
  savesLine: number;
  savesOverProb: number;
  savesUnderProb: number;
  // Goals Against prediction
  expectedGA: number;
  gaLine: number;
  gaOverProb: number;
  gaUnderProb: number;
  // Book odds
  bookOdds?: {
    savesOver: number;
    savesUnder: number;
    savesLine: number;
    gaOver: number;
    gaUnder: number;
    gaLine: number;
  };
  confidence: number;
  isValueBet: boolean;
  valueBetType?: 'saves_over' | 'saves_under' | 'ga_over' | 'ga_under';
}

interface GoaliePropsData {
  predictions: GoaliePrediction[];
  valueBets: GoaliePrediction[];
  lastUpdated: string;
  gamesAnalyzed: number;
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

export default function GoaliePropsTable() {
  const [propsData, setPropsData] = useState<GoaliePropsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [propType, setPropType] = useState<'saves' | 'goals_against'>('saves');

  useEffect(() => {
    const fetchProps = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch('/api/props?type=goalie');
        if (!response.ok) throw new Error('Failed to fetch goalie props');
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
      <div className="flex flex-col items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mb-4"></div>
        <span className="text-slate-400">Loading goalie props...</span>
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

  const formatOdds = (odds: number) => {
    if (!odds || odds === 0) return '-';
    return odds > 0 ? `+${odds}` : `${odds}`;
  };

  const formatProbability = (prob: number) => `${(prob * 100).toFixed(0)}%`;

  const getConfidenceDisplay = (conf: number) => {
    if (conf >= 0.70) return { label: 'High', color: 'text-emerald-400', bg: 'bg-emerald-500/20' };
    if (conf >= 0.50) return { label: 'Med', color: 'text-yellow-400', bg: 'bg-yellow-500/20' };
    return { label: 'Low', color: 'text-slate-500', bg: 'bg-slate-500/20' };
  };

  return (
    <div className="px-4">
      {/* Header */}
      <div className="mb-6 p-4 bg-gradient-to-r from-slate-800/50 to-slate-900/50 border border-slate-700 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">Goalie Props</h2>
            <p className="text-slate-400 text-sm">Saves and Goals Against predictions</p>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{propsData.gamesAnalyzed}</div>
              <div className="text-slate-500">Games</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-400">{propsData.predictions.length}</div>
              <div className="text-slate-500">Goalies</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-400">{propsData.valueBets?.length || 0}</div>
              <div className="text-slate-500">Value Bets</div>
            </div>
          </div>
        </div>
      </div>

      {/* Prop Type Toggle */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => setPropType('saves')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            propType === 'saves'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          Saves O/U
        </button>
        <button
          onClick={() => setPropType('goals_against')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            propType === 'goals_against'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          Goals Against O/U
        </button>
      </div>

      {/* Value Bets Section */}
      {propsData.valueBets && propsData.valueBets.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            🎯 Top Goalie Picks
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {propsData.valueBets.slice(0, 4).map((pred, index) => (
              <div key={pred.playerId} className="bg-gradient-to-r from-emerald-900/20 to-slate-800/50 border border-emerald-800/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold" 
                      style={{ backgroundColor: teamColors[pred.teamAbbrev] || '#374151', color: 'white' }}
                    >
                      {pred.teamAbbrev}
                    </div>
                    <div>
                      <div className="font-medium text-white">{pred.playerName}</div>
                      <div className="text-xs text-slate-400">{pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev}</div>
                    </div>
                  </div>
                  <div className="text-emerald-400 font-bold">#{index + 1}</div>
                </div>
                <div className="flex justify-between text-sm">
                  <div>
                    <span className="text-slate-400">Saves: </span>
                    <span className="text-white font-mono">{pred.expectedSaves.toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">GA: </span>
                    <span className="text-white font-mono">{pred.expectedGA.toFixed(1)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full">
          <thead className="bg-slate-800/50">
            <tr>
              <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Goalie</th>
              <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Matchup</th>
              <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Time</th>
              {propType === 'saves' ? (
                <>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Exp. Saves</th>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Line</th>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Over %</th>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Under %</th>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Book O/U</th>
                </>
              ) : (
                <>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Exp. GA</th>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Line</th>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Over %</th>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Under %</th>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Book O/U</th>
                </>
              )}
              <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Confidence</th>
              <th className="text-center py-3 px-3 text-slate-400 font-medium text-sm">Pick</th>
            </tr>
          </thead>
          <tbody>
            {propsData.predictions.map((pred, index) => {
              const conf = getConfidenceDisplay(pred.confidence);
              const isValueBet = propsData.valueBets?.some(v => v.playerId === pred.playerId);
              
              const expectedVal = propType === 'saves' ? pred.expectedSaves : pred.expectedGA;
              const line = propType === 'saves' ? pred.savesLine : pred.gaLine;
              const overProb = propType === 'saves' ? pred.savesOverProb : pred.gaOverProb;
              const underProb = propType === 'saves' ? pred.savesUnderProb : pred.gaUnderProb;
              
              const bookOver = propType === 'saves' ? pred.bookOdds?.savesOver : pred.bookOdds?.gaOver;
              const bookUnder = propType === 'saves' ? pred.bookOdds?.savesUnder : pred.bookOdds?.gaUnder;
              
              // Determine best pick
              const bestPick = overProb > underProb ? 'OVER' : 'UNDER';
              const bestProb = Math.max(overProb, underProb);
              
              return (
                <tr 
                  key={`${pred.playerId}-${index}`} 
                  className={`border-t border-slate-800/50 hover:bg-slate-800/30 ${isValueBet ? 'bg-emerald-900/10' : ''}`}
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
                        <div className="text-slate-500 text-xs">
                          {pred.isStarter ? '🟢 Starter' : '⚪ Backup'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center text-slate-300 text-sm">
                    {pred.isHome ? 'vs' : '@'} {pred.opponentAbbrev}
                  </td>
                  <td className="py-3 px-3 text-center text-slate-400 text-sm">{pred.gameTime}</td>
                  <td className="py-3 px-3 text-center">
                    <span className="text-blue-400 font-mono font-semibold">{expectedVal.toFixed(1)}</span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className="text-white font-mono">{line.toFixed(1)}</span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className={`font-medium ${overProb > 0.55 ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {formatProbability(overProb)}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className={`font-medium ${underProb > 0.55 ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {formatProbability(underProb)}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    {bookOver && bookUnder ? (
                      <div className="text-xs">
                        <span className="text-slate-400">O </span>
                        <span className="font-mono text-white">{formatOdds(bookOver)}</span>
                        <span className="text-slate-600 mx-1">/</span>
                        <span className="text-slate-400">U </span>
                        <span className="font-mono text-white">{formatOdds(bookUnder)}</span>
                      </div>
                    ) : (
                      <span className="text-slate-600">-</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className={`text-xs px-2 py-1 rounded ${conf.bg} ${conf.color}`}>
                      {conf.label}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    {bestProb >= 0.55 ? (
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        bestProb >= 0.65 
                          ? 'bg-emerald-500/20 text-emerald-400' 
                          : 'bg-blue-500/20 text-blue-400'
                      }`}>
                        {bestPick}
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

      {propsData.predictions.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-4">🥅</div>
          <h3 className="text-lg font-medium text-slate-400">No goalie predictions available</h3>
          <p className="text-slate-500 text-sm mt-2">Check back closer to game time</p>
        </div>
      )}

      {/* Footer Info */}
      <div className="mt-6 p-4 bg-slate-800/30 rounded-lg text-xs text-slate-500">
        <p><strong className="text-slate-400">Exp. Saves:</strong> Predicted saves based on opponent shots/game and goalie's save %</p>
        <p><strong className="text-slate-400">Exp. GA:</strong> Predicted goals against based on opponent scoring rate</p>
        <p className="mt-2 text-slate-600">Last updated: {propsData.lastUpdated ? new Date(propsData.lastUpdated).toLocaleString() : 'N/A'}</p>
      </div>
    </div>
  );
}
