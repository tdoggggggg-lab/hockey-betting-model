// src/app/responsible-gambling/page.tsx
import Link from 'next/link';

export default function ResponsibleGamblingPage() {
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
              <Link href="/model" className="text-slate-400 hover:text-white transition">Model</Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-8">🎲 Responsible Gambling</h1>

        <div className="prose prose-invert max-w-none">
          <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-xl p-6 mb-8">
            <p className="text-yellow-200 font-medium">
              Gambling should be entertaining, not a way to make money. Never bet more than you can afford to lose.
            </p>
          </div>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">Know the Risks</h2>
            <ul className="space-y-2 text-slate-300">
              <li>• Even the best prediction models are wrong 35-40% of the time</li>
              <li>• Past performance does not guarantee future results</li>
              <li>• The house always has an edge built into the odds</li>
              <li>• Chasing losses leads to bigger losses</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">Set Limits</h2>
            <ul className="space-y-2 text-slate-300">
              <li>• Decide on a bankroll you can afford to lose completely</li>
              <li>• Never bet more than 1-5% of your bankroll on a single bet</li>
              <li>• Set daily, weekly, and monthly loss limits</li>
              <li>• Take breaks and don't bet when emotional</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">Warning Signs</h2>
            <ul className="space-y-2 text-slate-300">
              <li>• Betting more than you planned</li>
              <li>• Chasing losses with bigger bets</li>
              <li>• Borrowing money to gamble</li>
              <li>• Neglecting responsibilities to gamble</li>
              <li>• Lying about gambling habits</li>
              <li>• Feeling anxious or irritable when not gambling</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">Get Help</h2>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
              <p className="text-slate-300 mb-4">If you or someone you know has a gambling problem:</p>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-blue-400">📞</span>
                  <div>
                    <div className="text-white font-medium">National Problem Gambling Helpline</div>
                    <div className="text-slate-400">1-800-522-4700 (24/7)</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-blue-400">💬</span>
                  <div>
                    <div className="text-white font-medium">Chat Support</div>
                    <div className="text-slate-400">ncpgambling.org/chat</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-blue-400">🌐</span>
                  <div>
                    <div className="text-white font-medium">Gamblers Anonymous</div>
                    <div className="text-slate-400">gamblersanonymous.org</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-12 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-slate-500 text-sm">
          <div className="flex justify-center gap-4">
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
