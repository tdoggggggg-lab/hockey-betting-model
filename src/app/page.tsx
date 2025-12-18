'use client';

import { useState, useEffect } from 'react';
import LeagueTabs from '@/components/LeagueTabs';
import DateTabs from '@/components/DateTabs';
import BetTypesTabs from '@/components/BetTypesTabs';
import GamesTable from '@/components/GamesTable';
import GoalscorerTable from '@/components/GoalscorerTable';

interface Team { id: number; name: string; abbreviation: string; }
interface Odds { bookmaker: string; homeMoneyline: number; awayMoneyline: number; homeSpread: number; homeSpreadOdds: number; awaySpreadOdds: number; totalLine: number; overOdds: number; underOdds: number; }
interface Prediction { homeWinProbability: number; awayWinProbability: number; predictedTotal: number; confidence: number; }
interface Game { id: string; homeTeam: Team; awayTeam: Team; startTime: string; status: 'scheduled' | 'live' | 'final'; homeScore?: number; awayScore?: number; prediction?: Prediction; odds: Odds[]; }
interface GamesData { gamesByDate: Record<string, Game[]>; dates: string[]; }

export default function Home() {
  const [activeLeague, setActiveLeague] = useState('nhl');
  const [activeDate, setActiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [activeBetType, setActiveBetType] = useState('game-lines');
  const [gamesData, setGamesData] = useState<GamesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGames() {
      try {
        setLoading(true);
        const response = await fetch('/api/games');
        if (!response.ok) throw new Error('Failed to fetch games');
        const data = await response.json();
        setGamesData(data);
        if (data.dates && data.dates.length > 0) setActiveDate(data.dates[0]);
      } catch (err) {
        console.error('Error fetching games:', err);
        setError('Failed to load games. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    fetchGames();
    const interval = setInterval(fetchGames, 120000);
    return () => clearInterval(interval);
  }, []);

  const todayGames = gamesData?.gamesByDate?.[activeDate] || [];

  const getDateLabel = (dateStr: string) => {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    if (dateStr === today) return 'Today';
    if (dateStr === tomorrow) return 'Tomorrow';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <LeagueTabs activeLeague={activeLeague} onLeagueChange={setActiveLeague} />
      
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🏒</span>
              <div>
                <h1 className="text-xl font-bold text-white">NHL Odds</h1>
                <p className="text-slate-400 text-sm">Live lines from 40+ sportsbooks</p>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-400">62%</div>
                <div className="text-xs text-slate-500">Model Accuracy</div>
              </div>
              <div className="w-px h-10 bg-slate-700" />
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-400">+8.2%</div>
                <div className="text-xs text-slate-500">Season ROI</div>
              </div>
              <div className="w-px h-10 bg-slate-700" />
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-400">{loading ? '...' : todayGames.length}</div>
                <div className="text-xs text-slate-500">Games Today</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <BetTypesTabs activeType={activeBetType} onTypeChange={setActiveBetType} />
      
      {activeBetType === 'game-lines' && (
        <DateTabs activeDate={activeDate} onDateChange={setActiveDate} />
      )}

      <div className="max-w-7xl mx-auto py-4">
        {activeBetType === 'game-lines' ? (
          loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
              <p className="text-slate-400">Loading games...</p>
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <div className="text-4xl mb-4">⚠️</div>
              <h3 className="text-xl font-medium text-red-400">{error}</h3>
              <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-500">Try Again</button>
            </div>
          ) : (
            <GamesTable games={todayGames} dateLabel={getDateLabel(activeDate)} />
          )
        ) : activeBetType === 'goalscorer' ? (
          <GoalscorerTable />
        ) : (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🏗️</div>
            <h3 className="text-2xl font-bold text-white mb-2">Coming Soon</h3>
            <p className="text-slate-400">This feature is under development</p>
          </div>
        )}

        {activeBetType === 'game-lines' && (
          <div className="mx-4 mt-8 p-4 bg-slate-900/50 border border-slate-800 rounded-xl">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🤖</span>
              <div>
                <h3 className="font-semibold text-white mb-1">AI-Powered Predictions</h3>
                <p className="text-slate-400 text-sm">
                  Our model uses expected goals (xG), Corsi/Fenwick possession metrics, 
                  goalie performance (GSAx), and situational factors. Historical accuracy: 62% on moneyline picks.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
