import GameCard from '@/components/GameCard';

// Mock data for now - will be replaced with real API calls
const mockGames = [
  {
    id: '1',
    homeTeam: { id: 1, name: 'Colorado Avalanche', abbreviation: 'COL' },
    awayTeam: { id: 2, name: 'Vegas Golden Knights', abbreviation: 'VGK' },
    startTime: new Date(Date.now() + 3600000).toISOString(),
    status: 'scheduled' as const,
    prediction: {
      homeWinProbability: 0.52,
      awayWinProbability: 0.48,
      predictedTotal: 6.2,
      confidence: 0.72,
    },
    odds: [
      {
        bookmaker: 'DraftKings',
        homeMoneyline: -125,
        awayMoneyline: +105,
        homeSpread: -1.5,
        homeSpreadOdds: +165,
        awaySpreadOdds: -195,
        totalLine: 6.5,
        overOdds: -110,
        underOdds: -110,
      },
      {
        bookmaker: 'FanDuel',
        homeMoneyline: -130,
        awayMoneyline: +108,
        homeSpread: -1.5,
        homeSpreadOdds: +170,
        awaySpreadOdds: -200,
        totalLine: 6.5,
        overOdds: -108,
        underOdds: -112,
      },
    ],
  },
  {
    id: '2',
    homeTeam: { id: 3, name: 'Toronto Maple Leafs', abbreviation: 'TOR' },
    awayTeam: { id: 4, name: 'Boston Bruins', abbreviation: 'BOS' },
    startTime: new Date(Date.now() + 7200000).toISOString(),
    status: 'scheduled' as const,
    prediction: {
      homeWinProbability: 0.45,
      awayWinProbability: 0.55,
      predictedTotal: 5.8,
      confidence: 0.68,
    },
    odds: [
      {
        bookmaker: 'DraftKings',
        homeMoneyline: +110,
        awayMoneyline: -130,
        homeSpread: +1.5,
        homeSpreadOdds: -180,
        awaySpreadOdds: +155,
        totalLine: 6,
        overOdds: -105,
        underOdds: -115,
      },
    ],
  },
  {
    id: '3',
    homeTeam: { id: 5, name: 'Edmonton Oilers', abbreviation: 'EDM' },
    awayTeam: { id: 6, name: 'Calgary Flames', abbreviation: 'CGY' },
    startTime: new Date(Date.now() + 10800000).toISOString(),
    status: 'scheduled' as const,
    prediction: {
      homeWinProbability: 0.61,
      awayWinProbability: 0.39,
      predictedTotal: 6.5,
      confidence: 0.75,
    },
    odds: [
      {
        bookmaker: 'BetMGM',
        homeMoneyline: -165,
        awayMoneyline: +140,
        homeSpread: -1.5,
        homeSpreadOdds: +130,
        awaySpreadOdds: -150,
        totalLine: 6.5,
        overOdds: -110,
        underOdds: -110,
      },
    ],
  },
];

export default function Home() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hero Section */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">
          NHL Betting <span className="text-blue-400">Predictions</span>
        </h1>
        <p className="text-slate-400 max-w-2xl mx-auto">
          AI-powered predictions with live odds comparison from top sportsbooks. 
          Our model analyzes expected goals, possession metrics, and historical performance.
        </p>
      </div>

      {/* Stats Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
        <div className="bg-slate-800/50 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-blue-400">62%</div>
          <div className="text-slate-400 text-sm">Model Accuracy</div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-green-400">+8.2%</div>
          <div className="text-slate-400 text-sm">ROI This Season</div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-purple-400">1,247</div>
          <div className="text-slate-400 text-sm">Games Analyzed</div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-amber-400">40+</div>
          <div className="text-slate-400 text-sm">Bookmakers</div>
        </div>
      </div>

      {/* League Filter */}
      <div className="flex gap-2 mb-6">
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
          NHL
        </button>
        <button className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg font-medium hover:bg-slate-700">
          4 Nations
        </button>
        <button className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg font-medium hover:bg-slate-700">
          Olympics
        </button>
      </div>

      {/* Today's Games Header */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Today&apos;s Games</h2>
        <div className="text-slate-400 text-sm">
          {new Date().toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric' 
          })}
        </div>
      </div>

      {/* Games Grid */}
      <div className="grid gap-6">
        {mockGames.map((game) => (
          <GameCard key={game.id} game={game} />
        ))}
      </div>

      {/* Info Box */}
      <div className="mt-12 bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-2">📊 How Our Model Works</h3>
        <p className="text-slate-400 text-sm">
          Our prediction model uses expected goals (xG), Corsi/Fenwick possession metrics, 
          goalie performance (GSAx), and situational factors like back-to-back games and home ice advantage. 
          The model is trained on 10+ years of NHL data and updates daily. 
          <a href="/model" className="text-blue-400 hover:underline ml-1">Learn more →</a>
        </p>
      </div>
    </div>
  );
}
