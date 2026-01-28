// src/app/accuracy/page.tsx
import Link from 'next/link';

export default function AccuracyPage() {
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
              <Link href="/model" className="text-slate-400 hover:text-white transition">Model</Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-8">📊 Model Accuracy</h1>

        <div className="text-center py-16">
          <div className="text-6xl mb-6">📈</div>
          <h2 className="text-2xl font-semibold text-slate-300 mb-4">Tracking Coming Soon</h2>
          <p className="text-slate-500 max-w-md mx-auto mb-8">
            We're implementing prediction tracking to show you real performance data.
          </p>
          
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 max-w-lg mx-auto text-left">
            <h3 className="font-semibold text-white mb-4">What We'll Track:</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-emerald-400">✓</span>
                <span className="text-slate-300">Game prediction accuracy (win/loss)</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-emerald-400">✓</span>
                <span className="text-slate-300">Value bet ROI over time</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-emerald-400">✓</span>
                <span className="text-slate-300">Player prop hit rates by type</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-emerald-400">✓</span>
                <span className="text-slate-300">Model confidence vs actual results</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-emerald-400">✓</span>
                <span className="text-slate-300">Week-over-week improvement</span>
              </div>
            </div>
          </div>
        </div>
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
