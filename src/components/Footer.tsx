import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-slate-900 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Responsible Gambling Notice */}
        <div className="bg-slate-800/50 rounded-lg p-4 mb-6">
          <p className="text-amber-400 font-semibold text-sm mb-2">
            🎰 Gambling Problem? Call 1-800-522-4700
          </p>
          <p className="text-slate-400 text-xs">
            If you or someone you know has a gambling problem, crisis counseling and referral 
            services can be accessed by calling 1-800-GAMBLER (1-800-426-2537) or visiting{' '}
            <a 
              href="https://www.ncpgambling.org" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              ncpgambling.org
            </a>
          </p>
        </div>

        {/* Links */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8 mb-8">
          <div>
            <h3 className="text-white font-semibold mb-3">Predictions</h3>
            <ul className="space-y-2">
              <li><Link href="/" className="text-slate-400 hover:text-white text-sm">Game Lines</Link></li>
              <li><Link href="/?tab=goalscorer" className="text-slate-400 hover:text-white text-sm">Player Props</Link></li>
              <li><Link href="/?tab=goalie" className="text-slate-400 hover:text-white text-sm">Goalie Props</Link></li>
              <li><Link href="/?tab=futures" className="text-slate-400 hover:text-white text-sm">Futures</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-3">About</h3>
            <ul className="space-y-2">
              <li><Link href="/model" className="text-slate-400 hover:text-white text-sm">Our Model</Link></li>
              <li><Link href="/accuracy" className="text-slate-400 hover:text-white text-sm">Track Record</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-3">Legal</h3>
            <ul className="space-y-2">
              <li><Link href="/terms" className="text-slate-400 hover:text-white text-sm">Terms of Service</Link></li>
              <li><Link href="/privacy" className="text-slate-400 hover:text-white text-sm">Privacy Policy</Link></li>
              <li><Link href="/responsible-gambling" className="text-slate-400 hover:text-white text-sm">Responsible Gambling</Link></li>
            </ul>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="border-t border-slate-800 pt-6">
          <p className="text-slate-500 text-xs leading-relaxed mb-4">
            <strong>Disclaimer:</strong> This site is for informational and entertainment purposes only. 
            We do not accept wagers or facilitate gambling. All predictions are based on statistical models 
            and should not be relied upon as the sole basis for betting decisions. Past performance does not 
            guarantee future results. Sports betting involves risk and you should only bet what you can afford to lose.
            Must be 21+ to bet. Please gamble responsibly.
          </p>
          <p className="text-slate-600 text-xs">
            © {new Date().getFullYear()} HockeyEdge. Not affiliated with the NHL or any sports betting operator.
            Odds data provided by The Odds API.
          </p>
        </div>
      </div>
    </footer>
  );
}
