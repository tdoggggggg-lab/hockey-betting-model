'use client';

interface LeagueTabsProps {
  activeLeague: string;
  onLeagueChange: (league: string) => void;
}

export default function LeagueTabs({ activeLeague, onLeagueChange }: LeagueTabsProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-slate-900 border-b border-slate-800">
      <button
        onClick={() => onLeagueChange('nhl')}
        className="flex items-center gap-2 px-4 py-2.5 rounded-full font-medium text-sm whitespace-nowrap transition-all bg-blue-600 text-white shadow-lg shadow-blue-600/25"
      >
        <span className="text-lg">🏒</span>
        <span>NHL</span>
      </button>
    </div>
  );
}
