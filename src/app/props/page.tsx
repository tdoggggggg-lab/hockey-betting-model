// src/app/props/page.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface PropPrediction {
  playerId: number;
  playerName: string;
  team: string;
  opponent: string;
  propType: string;
  line: number;
  probability: number;
  confidence: number;
  recommendation: 'OVER' | 'UNDER' | 'PASS';
  isTopPick: boolean;
  rank?: number;
}

interface PropsData {
  predictions: PropPrediction[];
  valueBets: PropPrediction[];
  gamesAnalyzed: number;
  playersAnalyzed: number;
  message?: string;
}

const PROP_TYPES = ['goalscorer', 'shots', 'assists', 'points', 'saves'] as const;
type PropType = typeof PROP_TYPES[number];

export default function PropsPage() {
  const [data, setData] = useState<PropsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProp, setSelectedProp] = useState<PropType>('goalscorer');
  const [topPicksOnly, setTopPicksOnly] = useState(false);

  useEffect(() => {
    fetchProps();
  }, [selectedProp]);

  const fetchProps = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/props?type=${selectedProp}`);
      if (!res.ok) throw new Error('Failed to fetch props');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load props');
    } finally {
      setLoading(false);
    }
  };

  const filteredPredictions = data?.predictions.filter(p => !topPicksOnly || p.isTopPick) || [];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-2xl">🏒</span>
              <span className="text-xl font-bold">HockeyEdge</span>
            </Link>
            <nav className="flex gap-6">
              <Link href="/" className="text-slate-400 hover:text-white transition">Game Lines</Link>
              <Link href="/props" className="text-white font-medium">Player Props</Link>
              <Link href="/futures" className="text-slate-400 hover:text-white transition">Futures</Link>
              <Link href="/model" className="text-slate-400 hover:text-white transition">Model</Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">Player Props</h1>

        {/* Prop Type Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {PROP_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setSelectedProp(type)}
              className={`px-4 py-2 rounded-lg font-medium capitalize whitespace-nowrap transition ${
                selectedProp === type
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {type === 'goalscorer' ? '⚽ Goalscorer' : 
               type === 'shots' ? '🎯 Shots' :
               type === 'assists' ? '🅰️ Assists' :
               type === 'points' ? '📊 Points' : '🧤 Saves'}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={topPicksOnly}
              onChange={(e) => setTopPicksOnly(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-slate-300">Top picks only</span>
          </label>
          {data && (
            <span className="text-slate-500 text-sm">
              {filteredPredictions.length} players • {data.gamesAnalyzed} games
            </span>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-slate-400">Loading predictions...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-center py-12">
            <div className="text-red-400 mb-2">Error loading props</div>
            <div className="text-slate-500 text-sm">{error}</div>
          </div>
        )}

        {/* Message (e.g., no games today) */}
        {data?.message && !loading && (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">📅</div>
            <div className="text-slate-400">{data.message}</div>
          </div>
        )}

        {/* Results */}
        {!loading && !error && data && filteredPredictions.length > 0 && (
          <div className="grid gap-3">
            {filteredPredictions.map((pred, idx) => (
              <div
                key={`${pred.playerId}-${idx}`}
                className={`p-4 rounded-lg border ${
                  pred.isTopPick
                    ? 'bg-emerald-900/20 border-emerald-800/50'
                    : 'bg-slate-900/50 border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {pred.isTopPick && pred.rank && (
                      <span className="text-emerald-400 font-bold">#{pred.rank}</span>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{pred.playerName}</span>
                        <span className="text-slate-500 text-sm">{pred.team}</span>
                        {pred.isTopPick && (
                          <span className="px-2 py-0.5 bg-emerald-600/20 text-emerald-400 text-xs rounded">
                            🎯 Top Pick
                          </span>
                        )}
                      </div>
                      <div className="text-slate-400 text-sm">vs {pred.opponent}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-white">
                      {Math.round(pred.probability * 100)}%
                    </div>
                    <div className="text-slate-500 text-sm">
                      {Math.round(pred.confidence * 100)}% conf
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* No results */}
        {!loading && !error && data && filteredPredictions.length === 0 && !data.message && (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">🔍</div>
            <div className="text-slate-400">No predictions match your filters</div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-12 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-slate-500 text-sm">
          <p>For entertainment purposes only. Please gamble responsibly.</p>
          <div className="flex justify-center gap-4 mt-2">
            <Link href="/responsible-gambling" className="hover:text-white">Responsible Gambling</Link>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
