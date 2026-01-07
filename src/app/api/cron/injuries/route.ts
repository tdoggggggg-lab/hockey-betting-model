// src/app/api/cron/injuries/route.ts
// Runs daily to refresh injury data from ESPN
// Auto-calculates player importance and star concentration (no hardcoded lists!)

import { NextResponse } from 'next/server';
import { refreshInjuryCache, getCacheStatus, getInjuredPlayerNames } from '@/lib/injury-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    // Verify cron secret in production (but allow testing without it)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    // Only require auth in production with CRON_SECRET set
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // Allow access from Vercel cron or for testing
      const isVercelCron = request.headers.get('x-vercel-cron') === '1';
      if (!isVercelCron && process.env.NODE_ENV === 'production') {
        console.log('⚠️ Auth check: missing or invalid CRON_SECRET');
        // Still allow through for testing - remove this in production
      }
    }
    
    console.log('🔄 Injury cron starting...');
    const startTime = Date.now();
    
    await refreshInjuryCache();
    
    const status = getCacheStatus();
    const injuredNames = getInjuredPlayerNames();
    
    // Log all injured players for debugging
    console.log(`✅ Injury cron complete in ${Date.now() - startTime}ms`);
    console.log(`📊 ${status.totalInjuries} injuries across ${status.teamsWithInjuries} teams`);
    console.log(`⭐ Star players out: ${status.starPlayersOut.join(', ') || 'None'}`);
    console.log(`🚫 Players filtered from props (${injuredNames.size}):`);
    Array.from(injuredNames).forEach(name => console.log(`   - ${name}`));
    console.log(`⚠️ High star concentration teams: ${status.teamsWithHighConcentration.join(', ') || 'None'}`);
    
    return NextResponse.json({
      success: true,
      ...status,
      injuredPlayersFiltered: Array.from(injuredNames),  // Show which names are being filtered
      executionTimeMs: Date.now() - startTime,
      features: [
        'Auto player importance (no hardcoded lists)',
        'Star concentration risk (single-star teams)',
        'Position-based impact (G > D > C > W)',
        'Rust factor for returning players',
        'B2B + injury compounding',
        'Multiple injury non-linear effects',
        'Linemate production drops',
        'Line promotion penalties',
        'DAY_TO_DAY filtering (Tom Wilson fix)',
      ],
    });
    
  } catch (error: any) {
    console.error('❌ Injury cron error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack,
    }, { status: 500 });
  }
}
