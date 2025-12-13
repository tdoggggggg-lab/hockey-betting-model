'use client';

import { useState } from 'react';
import LeagueTabs from '@/components/LeagueTabs';
import DateTabs from '@/components/DateTabs';
import BetTypesTabs from '@/components/BetTypesTabs';
import GamesTable from '@/components/GamesTable';

// Mock data for now - will be replaced with real API calls
const mockGames = [
  {
    id: '1',
    homeTeam: { id: 19, name: 'St. Louis Blues', abbreviation: 'STL' },
    awayTeam: { id: 16, name: 'Chicago Blackhawks', abbreviation: 'CHI' },
    startTime: new Date(Date.now() + 3600000).toISOString(),
    status: 'scheduled' as const,
    prediction: {
      homeWinProbability: 0.58,
      awayWinProbability: 0.42,
      predictedTotal: 5.8,
      confidence: 0.72,
    },
    odds: [
      {
        bookmaker: 'DraftKings',
        homeMoneyline: -115,
        awayMoneyline: -105,
        homeSpread: -1.5,
        homeSpreadOdds: -278,
        awaySpreadOdds: +225,
        totalLine: 5.5,
        overOdds: -112,
        underOdds: -108,
      },
    ],
  },
  {
    id: '2',
    homeTeam: { id: 55, name: 'Utah Hockey Club', abbreviation: 'UTA' },
    awayTeam: { id: 55, name: 'Seattle Kraken', abbreviation: 'SEA' },
    startTime: new Date(Date.now() + 7200000).toISOString(),
    status: 'scheduled' as const,
    prediction: {
      homeWinProbability: 0.55,
      awayWinProbability: 0.45,
      predictedTotal: 5.5,
      confidence: 0.68,
    },
    odds: [
      {
        bookmaker: 'DraftKings',
        homeMoneyline: -185,
        awayMoneyline: +154,
        homeSpread: -1.5,
        homeSpreadOdds: +142,
        awaySpreadOdds: -170,
        totalLine: 5.5,
        overOdds: -115,
        underOdds: -105,
      },
    ],
  },
  {
    id: '3',
    homeTeam: { id: 1, name: 'New Jersey Devils', abbreviation: 'NJD' },
    awayTeam: { id: 24, name: 'Anaheim Ducks', abbreviation: 'ANA' },
    startTime: new Date(Date.now() + 10800000).toISOString(),
    status: 'scheduled' as const,
    prediction: {
      homeWinProbability: 0.62,
      awayWinProbability: 0.38,
      predictedTotal: 6.2,
      confidence: 0.75,
    },
    odds: [
      {
        bookmaker: 'FanDuel',
        homeMoneyline: -120,
        awayMoneyline: +100,
        homeSpread: -1.5,
        homeSpreadOdds: +205,
        awaySpreadOdds: -260,
        totalLine: 6.5,
        overOdds: +105,
        underOdds: -140,
      },
    ],
  },
  {
    id: '4',
    homeTeam: { id: 9, name: 'Ottawa Senators', abbreviation: 'OTT' },
    awayTeam: { id: 3, name: 'New York Rangers', abbreviation: 'NYR' },
    startTime: new Date(Date.now() + 14400000).toISOString(),
    status: 'scheduled' as const,
    prediction: {
      homeWinProbability: 0.48,
      awayWinProbability: 0.52,
      predictedTotal: 5.9,
      confidence: 0.70,
    },
    odds: [
      {
        bookmaker: 'BetMGM',
        homeMoneyline: +100,
        awayMoneyline: -120,
        homeSpread: +1.5,
        homeSpreadOdds: -260,
        awaySpreadOdds: +200,
        totalLine: 5.5,
        overOdds: -115,
        underOdds: -105,
      },
    ],
  },
];

export default function Home() {
  const [activeLeague, setActiveLeague] = useState('nhl');
  const [activeDate, setActiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [activeBetType, setActiveBetType] = useState('game-lines');

  return (
    <div className="min-h-screen bg-slate-950">
      {/* League Tabs */}
      <LeagueTabs 
        activeLeague={activeLeague} 
        onLeagueChange={setActiveLeague} 
      />

      {/* Hero Stats Bar */}
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
                <div className="text-2xl font-bold text-purple-400">1,247</div>
                <div className="text-xs text-slate-500">Games Analyzed</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bet Types Tabs */}
      <BetTypesTabs 
        activeType={activeBetType} 
        onTypeChange={setActiveBetType} 
      />

      {/* Date Tabs */}
      <DateTabs 
        activeDate={activeDate} 
        onDateChange={setActiveDate} 
      />

      {/* Games Content */}
      <div className="max-w-7xl mx-auto py-4">
        <GamesTable 
          games={mockGames} 
          dateLabel="Today" 
        />

        {/* Info Banner */}
        <div className="mx-4 mt-8 p-4 bg-slate-900/50 border border-slate-800 rounded-xl">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🤖</span>
            <div>
              <h3 className="font-semibold text-white mb-1">AI-Powered Predictions</h3>
              <p className="text-slate-400 text-sm">
                Our model uses expected goals (xG), Corsi/Fenwick possession metrics, 
                goalie performance (GSAx), and situational factors. Historical accuracy: 62% on moneyline picks.
                <a href="/model" className="text-blue-400 hover:underline ml-1">Learn more →</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
