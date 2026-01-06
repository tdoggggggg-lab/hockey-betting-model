'use client';

import Link from 'next/link';

export default function Navigation() {
  return (
    <nav className="bg-slate-900 border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center space-x-2">
              <span className="text-2xl">🏒</span>
              <span className="text-xl font-bold text-white">
                Hockey<span className="text-emerald-400">Edge</span>
              </span>
            </Link>
          </div>

          {/* Right side - Futures link only */}
          <div className="flex items-center gap-4">
            <Link
              href="/futures"
              className="text-slate-300 hover:text-white text-sm font-medium transition-colors"
            >
              Futures & Awards
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
