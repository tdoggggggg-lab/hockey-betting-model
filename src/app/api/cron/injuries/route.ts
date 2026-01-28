// src/app/api/cron/injuries/route.ts
// Runs daily to refresh injury data from ESPN
// Auto-calculates player importance and star concentration

import { NextResponse } from 'next/server';
import { refreshInjuryCache, getCacheStatus } from '@/lib/injury-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    console.log('🔄 Injury cron starting...');
    const startTime = Date.now();
    
    await refreshInjuryCache();
    
    const status = getCacheStatus();
    
    console.log(`✅ Injury cron complete in ${Date.now() - startTime}ms`);
    console.log(`📊 ${status.totalInjuries} injuries across ${status.teamsWithInjuries} teams`);
    console.log(`⭐ Star players out: ${status.starPlayersOut.join(', ') || 'None'}`);
    console.log(`⚠️ High concentration: ${status.teamsWithHighConcentration.join(', ') || 'None'}`);
    
    return NextResponse.json({
      success: true,
      ...status,
      executionTimeMs: Date.now() - startTime,
    });
    
  } catch (error: any) {
    console.error('❌ Injury cron error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
