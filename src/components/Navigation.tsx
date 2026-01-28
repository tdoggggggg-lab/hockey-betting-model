'use client';

import Link from 'next/link';

export default function Navigation() {
  return (
    <nav className="bg-slate-950 border-b border-slate-800/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center h-14">
          <Link href="/" className="flex items-center space-x-2">
            <span className="text-2xl">🏒</span>
            <span className="text-xl font-bold text-white tracking-tight">
              Hockey<span className="text-emerald-400">Edge</span>
            </span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
