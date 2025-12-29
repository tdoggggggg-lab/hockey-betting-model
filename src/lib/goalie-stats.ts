/**
 * Injury Service
 * Uses cached injuries from daily cron job + manual backup
 */

import { 
  getAllInjuries, 
  getTeamInjuries, 
  isPlayerInjured as checkInjured,
  CachedInjury 
} from './injury-cache';

export interface InjuredPlayer {
  playerId?: number;
  name: string;
  team: string;
  teamAbbrev: string;
  position: string;
  injuryType: string;
  status: string;
  lastUpdated: string;
}

export interface InjuryAdjustments {
  injuries: Map<string, InjuredPlayer[]>;
  isPlayerOut: (name: string, team: string) => boolean;
  getPlayerAdjustment: (name: string, team: string, isHome: boolean, isB2B: boolean) => number;
  getTeamInjuryImpact: (team: string) => number;
}

// Elite players - when injured, affects whole team
const ELITE_PLAYERS: Record<string, { gar: number; pp1: boolean; impact: number }> = {
  'Connor McDavid': { gar: 33, pp1: true, impact: 0.15 },
  'Nathan MacKinnon': { gar: 30, pp1: true, impact: 0.14 },
  'Auston Matthews': { gar: 28, pp1: true, impact: 0.13 },
  'Leon Draisaitl': { gar: 27, pp1: true, impact: 0.12 },
  'Nikita Kucherov': { gar: 26, pp1: true, impact: 0.12 },
  'Cale Makar': { gar: 28, pp1: true, impact: 0.13 },
  'Quinn Hughes': { gar: 22, pp1: true, impact: 0.10 },
  'Connor Hellebuyck': { gar: 25, pp1: false, impact: 0.12 },
  'Igor Shesterkin': { gar: 24, pp1: false, impact: 0.11 },
  'Mikko Rantanen': { gar: 24, pp1: true, impact: 0.11 },
  'Kirill Kaprizov': { gar: 24, pp1: true, impact: 0.11 },
  'David Pastrnak': { gar: 25, pp1: true, impact: 0.11 },
  'Sebastian Aho': { gar: 17, pp1: true, impact: 0.08 },
  'Seth Jarvis': { gar: 14, pp1: true, impact: 0.06 },
  'Brandon Hagel': { gar: 14, pp1: true, impact: 0.06 },
};

/**
 * Convert cached injury to InjuredPlayer format
 */
function toInjuredPlayer(cached: CachedInjury): InjuredPlayer {
  return {
    name: cached.name,
    team: cached.team,
    teamAbbrev: cached.teamAbbrev,
    position: cached.position,
    injuryType: cached.injuryType,
    status: cached.status,
    lastUpdated: cached.date,
  };
}

/**
 * Calculate team-wide impact from injuries
 */
function calculateTeamImpact(teamAbbrev: string): number {
  const injuries = getTeamInjuries(teamAbbrev);
  let totalImpact = 0;
  
  injuries.forEach(injury => {
    const elite = ELITE_PLAYERS[injury.name];
    if (elite) {
      totalImpact += elite.impact;
    }
  });
  
  return Math.min(totalImpact, 0.25); // Cap at 25%
}

/**
 * Get teammate adjustment when stars are injured
 */
function getTeammateAdjustment(
  playerName: string,
  teamAbbrev: string,
  isHome: boolean,
  isB2B: boolean
): number {
  const injuries = getTeamInjuries(teamAbbrev);
  let adjustment = 1.0;
  
  injuries.forEach(injury => {
    const elite = ELITE_PLAYERS[injury.name];
    if (elite && elite.gar >= 15) {
      const currentElite = ELITE_PLAYERS[playerName];
      if (currentElite && currentElite.gar >= 15) {
        adjustment *= 1.03; // Elite gets more opportunities
      } else {
        adjustment *= 0.92; // Non-elite suffers
      }
      if (elite.pp1) {
        adjustment *= 0.95; // PP impact
      }
    }
  });
  
  if (!isHome) adjustment *= 0.98;
  if (isB2B) adjustment *= 0.95;
  
  return adjustment;
}

/**
 * Main function - get injury adjustments
 */
export async function getInjuryAdjustmentsAsync(teamAbbrevs: string[]): Promise<InjuryAdjustments> {
  // Get all injuries from cache
  const allInjuries = getAllInjuries();
  
  // Group by team
  const injuryMap = new Map<string, InjuredPlayer[]>();
  allInjuries.forEach(injury => {
    const list = injuryMap.get(injury.teamAbbrev) || [];
    list.push(toInjuredPlayer(injury));
    injuryMap.set(injury.teamAbbrev, list);
  });
  
  // Log
  console.log(`Loaded ${allInjuries.length} injuries from cache`);
  teamAbbrevs.forEach(team => {
    const teamInj = injuryMap.get(team) || [];
    if (teamInj.length > 0) {
      console.log(`  ${team}: ${teamInj.map(i => i.name).join(', ')}`);
    }
  });
  
  return {
    injuries: injuryMap,
    isPlayerOut: (name, team) => checkInjured(name, team),
    getPlayerAdjustment: (name, team, isHome, isB2B) => 
      getTeammateAdjustment(name, team, isHome, isB2B),
    getTeamInjuryImpact: (team) => calculateTeamImpact(team),
  };
}

// Sync version
export function getInjuryAdjustments(): InjuryAdjustments {
  const allInjuries = getAllInjuries();
  const injuryMap = new Map<string, InjuredPlayer[]>();
  
  allInjuries.forEach(injury => {
    const list = injuryMap.get(injury.teamAbbrev) || [];
    list.push(toInjuredPlayer(injury));
    injuryMap.set(injury.teamAbbrev, list);
  });
  
  return {
    injuries: injuryMap,
    isPlayerOut: (name, team) => checkInjured(name, team),
    getPlayerAdjustment: (name, team, isHome, isB2B) => 
      getTeammateAdjustment(name, team, isHome, isB2B),
    getTeamInjuryImpact: (team) => calculateTeamImpact(team),
  };
}
