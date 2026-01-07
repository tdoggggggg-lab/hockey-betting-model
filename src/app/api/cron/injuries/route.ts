// src/app/api/cron/injuries/route.ts
// Runs every 2 hours to refresh injury data from ESPN
// Auto-calculates player importance (no hardcoded lists!)

import { NextResponse } from 'next/server';
import { refreshInjuryCache, getCacheStatus } from '@/lib/injury-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    // Verify cron secret in production
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
    
    console.log('🔄 Injury cron starting...');
    const startTime = Date.now();
    
    await refreshInjuryCache();
    
    const status = getCacheStatus();
    
    console.log(`✅ Injury cron complete in ${Date.now() - startTime}ms`);
    console.log(`📊 ${status.totalInjuries} injuries across ${status.teamsWithInjuries} teams`);
    console.log(`⭐ Star players out: ${status.starPlayersOut.join(', ') || 'None'}`);
    console.log(`🔄 Players returning (rust): ${status.playersReturning.join(', ') || 'None'}`);
    
    return NextResponse.json({
      success: true,
      ...status,
      executionTimeMs: Date.now() - startTime,
      features: [
        'Auto player importance (no hardcoded lists)',
        'Position-based impact (G > D > C > W)',
        'Rust factor for returning players',
        'B2B + injury compounding',
        'Multiple injury non-linear effects',
        'Linemate production drops',
        'Line promotion penalties',
      ],
    });
    
  } catch (error: any) {
    console.error('❌ Injury cron error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
