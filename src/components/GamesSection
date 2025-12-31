'use client';

import { useState, useEffect } from 'react';
import GameRow from './GameRow';

interface Game {
  id: string;
  homeTeam: { name: string; abbreviation: string; };
  awayTeam: { name: string; abbreviation: string; };
  startTime: string;
  status: string;
  prediction: {
    homeWinProbability: number;
    awayWinProbability: number;
    predictedTotal: number;
    confidence: number;
    recommendation: string;
    reasoning: string[];
  };
}

interface GamesData {
  games: Game[];
  gamesAnalyzed: number;
  lastUpdated: string;
  modelInfo: {
    name: string;
    accuracy: string;
    factors: string[];
  };
}

export default function GamesSection() {
  const [data, setData] = useState<GamesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGames = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/games');
        if (!res.ok) throw new Error('Failed to fetch games');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load games');
      } finally {
        setLoading(false);
      }
    };
    
    fetchGames();
    const interval = setInterval(fetchGames, 5 * 60 * 1000);
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

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <div className="text-red-400 mb-2">Error loading games</div>
        <div className="text-slate-500 text-sm">{error}</div>
      </div>
    );
  }

  const bettableGames = data.games.filter(g => g.prediction.recommendation !== 'PASS');

  return (
    <div className="px-4">
      {/* Model Info Banner */}
      <div className="mb-6 p-4 bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-800/50 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              🤖 {data.modelInfo.name}
              <span className="text-sm font-normal text-slate-400">Game Predictions</span>
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Accuracy: <span className="text-emerald-400">{data.modelInfo.accuracy}</span> • 
              Factors: {data.modelInfo.factors.join(', ')}
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{data.gamesAnalyzed}</div>
              <div className="text-slate-500">Games</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-400">{bettableGames.length}</div>
              <div className="text-slate-500">Picks</div>
            </div>
          </div>
        </div>
      </div>

      {/* Best Picks */}
      {bettableGames.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            🎯 Today's Best Picks
            <span className="text-sm font-normal text-slate-400">High confidence recommendations</span>
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {bettableGames.slice(0, 4).map(game => {
              const pick = game.prediction.homeWinProbability > 0.5 
                ? game.homeTeam.abbreviation 
                : game.awayTeam.abbreviation;
              const prob = Math.max(game.prediction.homeWinProbability, game.prediction.awayWinProbability);
              
              return (
                <div key={game.id} className="bg-emerald-900/20 border border-emerald-800/50 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-white font-semibold">{pick}</span>
                      <span className="text-emerald-400 ml-2">({Math.round(prob * 100)}%)</span>
                    </div>
                    <span className="text-xs text-slate-400">
                      {game.awayTeam.abbreviation} @ {game.homeTeam.abbreviation}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Confidence: {Math.round(game.prediction.confidence * 100)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All Games */}
      <h3 className="text-lg font-semibold text-white mb-3">All Games</h3>
      <div className="space-y-3">
        {data.games.map(game => (
          <GameRow key={game.id} game={game} />
        ))}
      </div>

      {data.games.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-4">🏒</div>
          <h3 className="text-lg font-medium text-slate-400">No games scheduled</h3>
          <p className="text-slate-500 text-sm mt-2">Check back for upcoming matchups</p>
        </div>
      )}

      {/* Footer */}
      <div className="mt-6 p-4 bg-slate-800/30 rounded-lg text-xs text-slate-500">
        <p><strong>How it works:</strong> Model uses goal differential (strongest predictor, R²=0.45-0.55), 
        home ice (+4.5%), rest advantage (7.3% swing for B2B), and points percentage.</p>
        <p className="mt-1">Research shows NHL models cap at ~62% accuracy due to inherent randomness.</p>
        <p className="mt-1">Last updated: {data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'N/A'}</p>
      </div>
    </div>
  );
}
