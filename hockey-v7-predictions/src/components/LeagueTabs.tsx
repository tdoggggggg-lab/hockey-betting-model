'use client';

import { useState } from 'react';

interface League {
  id: string;
  name: string;
  icon: string;
  active: boolean;
}

const leagues: League[] = [
  { id: 'nhl', name: 'NHL', icon: '🏒', active: true },
  { id: '4nations', name: '4 Nations', icon: '🌍', active: false },
  { id: 'olympics', name: 'Olympics', icon: '🥇', active: false },
];

interface LeagueTabsProps {
  activeLeague: string;
  onLeagueChange: (league: string) => void;
}

export default function LeagueTabs({ activeLeague, onLeagueChange }: LeagueTabsProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-slate-900 border-b border-slate-800 overflow-x-auto">
      {leagues.map((league) => (
        <button
          key={league.id}
          onClick={() => onLeagueChange(league.id)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-full font-medium text-sm whitespace-nowrap transition-all ${
            activeLeague === league.id
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
          }`}
        >
          <span className="text-lg">{league.icon}</span>
          <span>{league.name}</span>
        </button>
      ))}
      
      {/* Divider */}
      <div className="w-px h-8 bg-slate-700 mx-2" />
      
      {/* Coming Soon badges for inactive leagues */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 bg-slate-800/50 px-3 py-1.5 rounded-full">
          4 Nations: Feb 2025
        </span>
        <span className="text-xs text-slate-500 bg-slate-800/50 px-3 py-1.5 rounded-full">
          Olympics: Feb 2026
        </span>
      </div>
    </div>
  );
}
