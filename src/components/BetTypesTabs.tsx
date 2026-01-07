'use client';

interface BetTypesTabsProps {
  activeType: string;
  onTypeChange: (type: string) => void;
}

const betTypes = [
  { id: 'game-lines', label: 'GAME LINES' },
  { id: 'goalscorer', label: 'GOALSCORER' },
  { id: 'shots', label: 'SHOTS ON GOAL' },
  { id: 'points', label: 'POINTS' },
  { id: 'assists', label: 'ASSISTS' },
  { id: 'goalie', label: 'GOALIE PROPS' },
  { id: 'futures', label: 'FUTURES' },
  { id: 'awards', label: 'AWARDS' },
  { id: 'playoffs', label: 'PLAYOFFS' },
];

export default function BetTypesTabs({ activeType, onTypeChange }: BetTypesTabsProps) {
  return (
    <div className="border-b border-slate-800 overflow-x-auto scrollbar-hide">
      <div className="flex items-center gap-1 px-4 min-w-max">
        {betTypes.map((type) => (
          <button
            key={type.id}
            onClick={() => onTypeChange(type.id)}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-all border-b-2 ${
              activeType === type.id
                ? 'text-white border-emerald-500'
                : 'text-slate-400 border-transparent hover:text-white hover:border-slate-600'
            }`}
          >
            {type.label}
          </button>
        ))}
      </div>
    </div>
  );
}
