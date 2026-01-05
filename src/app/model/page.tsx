// src/app/model/page.tsx
import Link from 'next/link';

export default function ModelPage() {
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
              <Link href="/props" className="text-slate-400 hover:text-white transition">Player Props</Link>
              <Link href="/futures" className="text-slate-400 hover:text-white transition">Futures</Link>
              <Link href="/model" className="text-white font-medium">Model</Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-8">🤖 How Our Model Works</h1>

        {/* Game Prediction Model */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4 text-blue-400">Game Outcome Predictions</h2>
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            <p className="text-slate-300 mb-4">
              Our game prediction model uses research-backed factors weighted by their predictive power:
            </p>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg">
                <span className="text-white">Goal Differential</span>
                <span className="text-emerald-400 font-mono">R² = 0.45-0.55 (strongest)</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg">
                <span className="text-white">Home Ice Advantage</span>
                <span className="text-blue-400 font-mono">+4.5%</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg">
                <span className="text-white">Rest Advantage (B2B)</span>
                <span className="text-yellow-400 font-mono">±7.3%</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg">
                <span className="text-white">Points Percentage</span>
                <span className="text-purple-400 font-mono">Team quality indicator</span>
              </div>
            </div>
            <div className="mt-4 p-4 bg-blue-900/20 border border-blue-800/50 rounded-lg">
              <p className="text-slate-300 text-sm">
                <strong className="text-white">Expected Accuracy:</strong> 60-64% (NHL theoretical max due to inherent randomness)
              </p>
              <p className="text-slate-400 text-sm mt-1">
                Probability caps: 28% minimum, 72% maximum (NHL parity)
              </p>
            </div>
          </div>
        </section>

        {/* Player Props Model */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4 text-emerald-400">Player Props Model</h2>
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            <p className="text-slate-300 mb-4">
              Player props use a Poisson distribution model with multiple adjustments:
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="p-3 bg-slate-800/50 rounded-lg">
                <span className="text-white">Home/Away</span>
                <span className="text-slate-400 text-sm block">±5% adjustment</span>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-lg">
                <span className="text-white">Opponent Defense</span>
                <span className="text-slate-400 text-sm block">Ranking factor</span>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-lg">
                <span className="text-white">Back-to-Back</span>
                <span className="text-slate-400 text-sm block">-8% fatigue penalty</span>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-lg">
                <span className="text-white">Recent Form</span>
                <span className="text-slate-400 text-sm block">Last 5 games trend</span>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-lg">
                <span className="text-white">Power Play Time</span>
                <span className="text-slate-400 text-sm block">PP opportunity boost</span>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-lg">
                <span className="text-white">Goalie Matchup</span>
                <span className="text-slate-400 text-sm block">Save % adjustment</span>
              </div>
            </div>
          </div>
        </section>

        {/* Value Bet Detection */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4 text-yellow-400">Value Bet Detection</h2>
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            <p className="text-slate-300 mb-4">
              We flag value bets using conservative thresholds:
            </p>
            <div className="space-y-2 font-mono text-sm">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400">✓</span>
                <span className="text-slate-300">Edge &gt; 8% (model vs Vegas)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400">✓</span>
                <span className="text-slate-300">Confidence &gt; 70%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400">✓</span>
                <span className="text-slate-300">Model probability &gt; 58%</span>
              </div>
            </div>
            <p className="text-slate-500 text-sm mt-4">
              Result: ~2-4 high-quality picks per day instead of 8-10 marginal ones
            </p>
          </div>
        </section>

        {/* Data Sources */}
        <section>
          <h2 className="text-2xl font-semibold mb-4 text-slate-400">Data Sources</h2>
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold text-white mb-2">NHL Data</h3>
                <p className="text-slate-400 text-sm">Official NHL API for schedules, rosters, and statistics</p>
              </div>
              <div>
                <h3 className="font-semibold text-white mb-2">Betting Odds</h3>
                <p className="text-slate-400 text-sm">The Odds API for live lines from DraftKings, FanDuel, BetMGM</p>
              </div>
            </div>
          </div>
        </section>
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
