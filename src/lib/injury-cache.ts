/**
 * Injury Cache
 * Shared cache between cron job and injury service
 * Uses Vercel KV-like pattern with in-memory fallback
 */

export interface CachedInjury {
  name: string;
  team: string;
  teamAbbrev: string;
  position: string;
  injuryType: string;
  status: string;
  date: string;
}

// In-memory cache (persists within serverless instance)
let injuryCache: CachedInjury[] = [];
let cacheTimestamp: number = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Manual backup list - always included
const MANUAL_INJURIES: CachedInjury[] = [
  // Long-term injuries
  { name: 'Gabriel Landeskog', team: 'Colorado Avalanche', teamAbbrev: 'COL', position: 'LW', injuryType: 'Knee', status: 'LTIR', date: '2024-10-01' },
  { name: 'Evander Kane', team: 'Edmonton Oilers', teamAbbrev: 'EDM', position: 'LW', injuryType: 'Hernia', status: 'LTIR', date: '2024-12-01' },
  
  // Current injuries - UPDATE REGULARLY
  { name: 'Brandon Hagel', team: 'Tampa Bay Lightning', teamAbbrev: 'TBL', position: 'LW', injuryType: 'Lower Body', status: 'IR', date: '2024-12-20' },
  { name: 'Seth Jarvis', team: 'Carolina Hurricanes', teamAbbrev: 'CAR', position: 'RW', injuryType: 'Upper Body', status: 'IR', date: '2024-12-28' },
  { name: 'Thatcher Demko', team: 'Vancouver Canucks', teamAbbrev: 'VAN', position: 'G', injuryType: 'Lower Body', status: 'IR', date: '2024-12-15' },
  { name: 'Tyson Foerster', team: 'Philadelphia Flyers', teamAbbrev: 'PHI', position: 'RW', injuryType: 'Upper Body', status: 'Day-to-Day', date: '2024-12-20' },
];

/**
 * Update cache with scraped injuries
 */
export function updateInjuryCache(injuries: CachedInjury[]): void {
  injuryCache = injuries;
  cacheTimestamp = Date.now();
  console.log(`Injury cache updated: ${injuries.length} injuries`);
}

/**
 * Get all injuries (scraped + manual backup)
 */
export function getAllInjuries(): CachedInjury[] {
  const all = new Map<string, CachedInjury>();
  
  // Add manual injuries first
  MANUAL_INJURIES.forEach(injury => {
    all.set(injury.name.toLowerCase(), injury);
  });
  
  // Override/add scraped injuries (more recent)
  if (Date.now() - cacheTimestamp < CACHE_TTL) {
    injuryCache.forEach(injury => {
      all.set(injury.name.toLowerCase(), injury);
    });
  }
  
  return Array.from(all.values());
}

/**
 * Get injuries by team
 */
export function getTeamInjuries(teamAbbrev: string): CachedInjury[] {
  return getAllInjuries().filter(i => i.teamAbbrev === teamAbbrev);
}

/**
 * Check if player is injured
 */
export function isPlayerInjured(playerName: string, teamAbbrev: string): boolean {
  const teamInjuries = getTeamInjuries(teamAbbrev);
  const nameLower = playerName.toLowerCase();
  
  return teamInjuries.some(injury => {
    const injuryNameLower = injury.name.toLowerCase();
    // Match full name or last name
    return injuryNameLower === nameLower || 
           nameLower.includes(injury.name.split(' ')[1]?.toLowerCase() || '');
  });
}

/**
 * Get cache status
 */
export function getCacheStatus(): { count: number; age: number; isStale: boolean } {
  const age = Date.now() - cacheTimestamp;
  return {
    count: injuryCache.length,
    age: Math.round(age / 1000 / 60), // minutes
    isStale: age > CACHE_TTL,
  };
}

/**
 * Add manual injury (for quick updates)
 */
export function addManualInjury(injury: CachedInjury): void {
  const existing = MANUAL_INJURIES.findIndex(i => i.name.toLowerCase() === injury.name.toLowerCase());
  if (existing >= 0) {
    MANUAL_INJURIES[existing] = injury;
  } else {
    MANUAL_INJURIES.push(injury);
  }
}

/**
 * Remove manual injury (player returned)
 */
export function removeManualInjury(playerName: string): boolean {
  const index = MANUAL_INJURIES.findIndex(i => i.name.toLowerCase() === playerName.toLowerCase());
  if (index >= 0) {
    MANUAL_INJURIES.splice(index, 1);
    return true;
  }
  return false;
}
