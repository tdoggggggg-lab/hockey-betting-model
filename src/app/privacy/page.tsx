// src/app/privacy/page.tsx
import Link from 'next/link';

export default function PrivacyPage() {
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
        <h1 className="text-3xl font-bold mb-8">🔒 Privacy Policy</h1>

        <div className="prose prose-invert max-w-none text-slate-300">
          <p className="text-slate-400 mb-8">Last updated: January 2026</p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">Information We Collect</h2>
            <p>HockeyEdge is designed with privacy in mind. We collect minimal data:</p>
            <ul className="mt-4 space-y-2">
              <li>• <strong className="text-white">Analytics:</strong> Anonymous usage data (pages visited, time on site)</li>
              <li>• <strong className="text-white">No personal information:</strong> We don't require accounts or collect names, emails, or payment info</li>
              <li>• <strong className="text-white">No betting data:</strong> We don't track your actual bets or betting history</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">How We Use Data</h2>
            <ul className="space-y-2">
              <li>• Improve our prediction models and user experience</li>
              <li>• Monitor site performance and fix issues</li>
              <li>• Understand which features are most useful</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">Third-Party Services</h2>
            <p>We use the following third-party services:</p>
            <ul className="mt-4 space-y-2">
              <li>• <strong className="text-white">Vercel:</strong> Hosting and analytics</li>
              <li>• <strong className="text-white">NHL API:</strong> Game schedules and statistics</li>
              <li>• <strong className="text-white">The Odds API:</strong> Betting lines from sportsbooks</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">Cookies</h2>
            <p>
              We use minimal cookies for basic site functionality. We don't use tracking cookies or sell data to advertisers.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">Contact</h2>
            <p>
              Questions about privacy? This is a personal project, but you can reach out via GitHub.
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-12 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-slate-500 text-sm">
          <div className="flex justify-center gap-4">
            <Link href="/responsible-gambling" className="hover:text-white">Responsible Gambling</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
