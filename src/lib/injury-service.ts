/**
 * NHL Injury Service
 * Fetches injury data and calculates impact on predictions
 */

export interface InjuredPlayer {
  playerId?: number;
  name: string;
  team: string;
  teamAbbrev: string;
  position: string;
  injuryType: string;
  status: string;
  expectedReturn?: string;
  lastUpdated: string;
}

export interface InjuryAdjustments {
  injuries: Map<string, InjuredPlayer[]>;
  isPlayerOut: (name: string, team: string) => boolean;
  getPlayerAdjustment: (name: string, team: string, isHome: boolean, isB2B: boolean) => number;
}

// Known elite players with their GAR values
const ELITE_PLAYERS: Record<string, { gar: number; pp1: boolean }> = {
  'Connor McDavid': { gar: 33, pp1: true },
  'Nathan MacKinnon': { gar: 30, pp1: true },
  'Auston Matthews': { gar: 28, pp1: true },
  'Leon Draisaitl': { gar: 27, pp1: true },
  'Nikita Kucherov': { gar: 26, pp1: true },
  'David Pastrnak': { gar: 25, pp1: true },
  'Cale Makar': { gar: 28, pp1: true },
  'Quinn Hughes': { gar: 22, pp1: true },
  'Adam Fox': { gar: 20, pp1: true },
  'Connor Hellebuyck': { gar: 25, pp1: false },
  'Igor Shesterkin': { gar: 24, pp1: false },
  'Matthew Tkachuk': { gar: 22, pp1: true },
  'Jack Eichel': { gar: 21, pp1: true },
  'Mitch Marner': { gar: 21, pp1: true },
  'Sidney Crosby': { gar: 20, pp1: true },
  'Aleksander Barkov': { gar: 20, pp1: true },
  'Sam Reinhart': { gar: 19, pp1: true },
  'Jake Guentzel': { gar: 18, pp1: true },
  'Brady Tkachuk': { gar: 18, pp1: true },
  'Brayden Point': { gar: 18, pp1: true },
  'Brandon Hagel': { gar: 14, pp1: true },
  'Tyson Foerster': { gar: 10, pp1: false },
};

/**
 * Get known injuries (manually maintained list)
 */
function getKnownInjuries(): Map<string, InjuredPlayer[]> {
  const injuries = new Map<string, InjuredPlayer[]>();
  
  const currentInjuries: InjuredPlayer[] = [
    { name: 'Brandon Hagel', team: 'Tampa Bay Lightning', teamAbbrev: 'TBL', position: 'LW', injuryType: 'Lower Body', status: 'IR', lastUpdated: '2024-12-20' },
    { name: 'Tyson Foerster', team: 'Philadelphia Flyers', teamAbbrev: 'PHI', position: 'RW', injuryType: 'Upper Body', status: 'Day-to-Day', lastUpdated: '2024-12-20' },
    { name: 'Evander Kane', team: 'Edmonton Oilers', teamAbbrev: 'EDM', position: 'LW', injuryType: 'Hernia', status: 'LTIR', lastUpdated: '2024-12-01' },
    { name: 'Gabriel Landeskog', team: 'Colorado Avalanche', teamAbbrev: 'COL', position: 'LW', injuryType: 'Knee', status: 'LTIR', lastUpdated: '2024-10-01' },
    { name: 'Thatcher Demko', team: 'Vancouver Canucks', teamAbbrev: 'VAN', position: 'G', injuryType: 'Lower Body', status: 'IR', lastUpdated: '2024-12-15' },
  ];
  
  currentInjuries.forEach(injury => {
    const teamInjuries = injuries.get(injury.teamAbbrev) || [];
    teamInjuries.push(injury);
    injuries.set(injury.teamAbbrev, teamInjuries);
  });
  
  return injuries;
}

/**
 * Check if a player is injured
 */
function isPlayerInjured(playerName: string, teamAbbrev: string, injuries: Map<string, InjuredPlayer[]>): boolean {
  const teamInjuries = injuries.get(teamAbbrev) || [];
  return teamInjuries.some(injury => 
    injury.name.toLowerCase() === playerName.toLowerCase() ||
    playerName.toLowerCase().includes(injury.name.split(' ')[1]?.toLowerCase() || '')
  );
}

/**
 * Get adjustment for teammates when key players are injured
 */
function getTeammateAdjustment(playerName: string, teamAbbrev: string, injuries: Map<string, InjuredPlayer[]>): number {
  const teamInjuries = injuries.get(teamAbbrev) || [];
  let adjustment = 1.0;
  
  teamInjuries.forEach(injury => {
    const injuredPlayer = ELITE_PLAYERS[injury.name];
    if (injuredPlayer && injuredPlayer.gar >= 15) {
      // Star is out - linemates see decreased production
      const currentPlayer = ELITE_PLAYERS[playerName];
      if (currentPlayer && currentPlayer.gar >= 15) {
        adjustment *= 1.05; // Stars take over more duties
      } else {
        adjustment *= 0.90; // Non-stars suffer without playmaker
      }
    }
  });
  
  return adjustment;
}

/**
 * Apply situational modifiers
 */
function applySituationalModifiers(baseAdjustment: number, isHome: boolean, isBackToBack: boolean): number {
  let modifier = baseAdjustment;
  
  if (!isHome && baseAdjustment < 1.0) {
    modifier *= 0.95; // Road penalty compounds injury impact
  }
  
  if (isBackToBack && baseAdjustment < 1.0) {
    modifier *= 0.93; // B2B penalty compounds injury impact
  }
  
  return modifier;
}

/**
 * Main function to get injury adjustments
 */
export async function getInjuryAdjustmentsAsync(teamAbbrevs: string[]): Promise<InjuryAdjustments> {
  const injuries = getKnownInjuries();
  
  console.log(`Loaded injuries for ${injuries.size} teams`);
  
  return {
    injuries,
    isPlayerOut: (name: string, team: string) => isPlayerInjured(name, team, injuries),
    getPlayerAdjustment: (name: string, team: string, isHome: boolean, isB2B: boolean) => {
      const baseAdjustment = getTeammateAdjustment(name, team, injuries);
      return applySituationalModifiers(baseAdjustment, isHome, isB2B);
    },
  };
}

// Synchronous version for backward compatibility
export function getInjuryAdjustments(): InjuryAdjustments {
  const injuries = getKnownInjuries();
  
  return {
    injuries,
    isPlayerOut: (name: string, team: string) => isPlayerInjured(name, team, injuries),
    getPlayerAdjustment: (name: string, team: string, isHome: boolean, isB2B: boolean) => {
      const baseAdjustment = getTeammateAdjustment(name, team, injuries);
      return applySituationalModifiers(baseAdjustment, isHome, isB2B);
    },
  };
}
