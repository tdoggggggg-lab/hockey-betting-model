// src/app/terms/page.tsx
import Link from 'next/link';

export default function TermsPage() {
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
        <h1 className="text-3xl font-bold mb-8">📜 Terms of Service</h1>

        <div className="prose prose-invert max-w-none text-slate-300">
          <p className="text-slate-400 mb-8">Last updated: January 2026</p>

          <div className="bg-red-900/20 border border-red-800/50 rounded-xl p-6 mb-8">
            <p className="text-red-200 font-medium">
              ⚠️ Important: HockeyEdge provides predictions for entertainment purposes only. We are not a sportsbook and do not facilitate betting.
            </p>
          </div>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">1. Entertainment Only</h2>
            <p>
              All predictions, odds comparisons, and analysis on HockeyEdge are for entertainment and informational purposes only. 
              We do not guarantee any outcomes and are not responsible for any betting decisions you make.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">2. No Financial Advice</h2>
            <p>
              Nothing on this site constitutes financial advice. Our predictions are statistical models that are frequently wrong. 
              Never bet money you cannot afford to lose.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">3. Accuracy Disclaimer</h2>
            <ul className="space-y-2">
              <li>• Our models target 60-64% accuracy, meaning they're wrong 36-40% of the time</li>
              <li>• Past performance does not guarantee future results</li>
              <li>• Odds and lines change frequently; displayed values may not be current</li>
              <li>• Injury and lineup information may be delayed or inaccurate</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">4. Legal Gambling Age</h2>
            <p>
              You must be of legal gambling age in your jurisdiction to use this site. 
              Online sports betting may not be legal in your area. It is your responsibility to know and follow local laws.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">5. Third-Party Links</h2>
            <p>
              We may display odds from third-party sportsbooks. We are not affiliated with these sportsbooks and are not responsible for their services, odds accuracy, or your interactions with them.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">6. Limitation of Liability</h2>
            <p>
              HockeyEdge and its creators shall not be liable for any losses, damages, or harm resulting from your use of this site or reliance on its predictions.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">7. Changes to Terms</h2>
            <p>
              We may update these terms at any time. Continued use of the site constitutes acceptance of any changes.
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-12 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-slate-500 text-sm">
          <div className="flex justify-center gap-4">
            <Link href="/responsible-gambling" className="hover:text-white">Responsible Gambling</Link>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
