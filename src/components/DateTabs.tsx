'use client';

interface DateTabsProps {
  activeDate: string;
  onDateChange: (date: string) => void;
}

function getDateTabs() {
  const today = new Date();
  const tabs = [];
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    
    let label: string;
    if (i === 0) {
      label = 'TODAY';
    } else if (i === 1) {
      label = 'Tomorrow';
    } else {
      // Format: "Sun 12/14"
      const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
      const monthDay = date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
      label = `${weekday} ${monthDay}`;
    }
    
    tabs.push({
      id: date.toISOString().split('T')[0],
      label,
      date,
    });
  }
  
  return tabs;
}

export default function DateTabs({ activeDate, onDateChange }: DateTabsProps) {
  const tabs = getDateTabs();
  
  return (
    <div className="flex items-center gap-2 px-4 py-3 overflow-x-auto scrollbar-hide">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onDateChange(tab.id)}
          className={`px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-all ${
            activeDate === tab.id
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
