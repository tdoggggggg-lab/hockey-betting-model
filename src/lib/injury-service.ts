/**
 * Shared Injury Service
 * Used by both Game Lines and Goalscorer predictions
 */

// Manual injury list - UPDATE THIS when players get hurt/return
// This serves as a backup when automatic scraping fails
export const MANUAL_INJURIES: Record<string, { name: string; status: string; detail: string; isElite?: boolean }[]> = {
  'COL': [{ name: 'Gabriel Landeskog', status: 'LTIR', detail: 'Knee', isElite: true }],
  'EDM': [{ name: 'Evander Kane', status: 'LTIR', detail: 'Hernia', isElite: false }],
  'TBL': [{ name: 'Brandon Hagel', status: 'IR', detail: 'Lower Body', isElite: false }],
  'CAR': [{ name: 'Seth Jarvis', status: 'IR', detail: 'Upper Body', isElite: false }],
  'VAN': [{ name: 'Thatcher Demko', status: 'IR', detail: 'Lower Body', isElite: false }],
  'PHI': [{ name: 'Tyson Foerster', status: 'DTD', detail: 'Upper Body', isElite: false }],
};

// Elite players - their absence significantly impacts team performance
export const ELITE_PLAYERS: Record<string, string[]> = {
  'EDM': ['Connor McDavid', 'Leon Draisaitl'],
  'COL': ['Nathan MacKinnon', 'Cale Makar', 'Mikko Rantanen'],
  'TOR': ['Auston Matthews', 'Mitch Marner', 'William Nylander'],
  'TBL': ['Nikita Kucherov', 'Brayden Point'],
  'BOS': ['David Pastrnak'],
  'FLA': ['Sam Reinhart', 'Aleksander Barkov', 'Matthew Tkachuk'],
  'DAL': ['Jason Robertson'],
  'VGK': ['Jack Eichel', 'Mark Stone'],
  'NYR': ['Artemi Panarin', 'Adam Fox'],
  'NJD': ['Jack Hughes', 'Jesper Bratt'],
  'CAR': ['Sebastian Aho', 'Andrei Svechnikov'],
  'WPG': ['Kyle Connor', 'Mark Scheifele'],
  'MIN': ['Kirill Kaprizov'],
  'VAN': ['Elias Pettersson', 'J.T. Miller'],
  'LAK': ['Adrian Kempe'],
  'CGY': ['Nazem Kadri'],
  'OTT': ['Brady Tkachuk', 'Tim Stutzle'],
  'DET': ['Dylan Larkin', 'Lucas Raymond'],
  'BUF': ['Tage Thompson', 'Rasmus Dahlin'],
  'PIT': ['Sidney Crosby', 'Evgeni Malkin'],
  'WSH': ['Alex Ovechkin', 'Dylan Strome'],
  'PHI': ['Travis Konecny'],
  'NYI': ['Mathew Barzal', 'Bo Horvat'],
  'CBJ': ['Zach Werenski'],
  'MTL': ['Cole Caufield', 'Nick Suzuki'],
  'CHI': ['Connor Bedard'],
  'NSH': ['Filip Forsberg'],
  'STL': ['Robert Thomas'],
  'ANA': ['Troy Terry'],
  'SJS': ['Macklin Celebrini'],
  'SEA': ['Jared McCann'],
  'UTA': ['Clayton Keller'],
};

/**
 * Check if a player is injured
 */
export function isPlayerInjured(name: string, teamAbbrev: string, injuries?: typeof MANUAL_INJURIES): boolean {
  const injuryList = injuries || MANUAL_INJURIES;
  const teamInjuries = injuryList[teamAbbrev] || [];
  const nameLower = name.toLowerCase();
  
  return teamInjuries.some(injured => {
    const injuredLower = injured.name.toLowerCase();
    // Match full name or last name
    return injuredLower === nameLower || 
           nameLower.includes(injured.name.split(' ')[1]?.toLowerCase() || '');
  });
}

/**
 * Check if any elite players are injured for a team
 * Returns list of injured elite players
 */
export function getInjuredElitePlayers(teamAbbrev: string, injuries?: typeof MANUAL_INJURIES): string[] {
  const injuryList = injuries || MANUAL_INJURIES;
  const teamInjuries = injuryList[teamAbbrev] || [];
  const elitePlayers = ELITE_PLAYERS[teamAbbrev] || [];
  
  const injuredElites: string[] = [];
  
  for (const elite of elitePlayers) {
    const eliteLower = elite.toLowerCase();
    const isInjured = teamInjuries.some(injured => {
      const injuredLower = injured.name.toLowerCase();
      return injuredLower === eliteLower ||
             eliteLower.includes(injured.name.split(' ')[1]?.toLowerCase() || '') ||
             injuredLower.includes(elite.split(' ')[1]?.toLowerCase() || '');
    });
    
    if (isInjured) {
      injuredElites.push(elite);
    }
  }
  
  return injuredElites;
}

/**
 * Calculate team win probability adjustment based on injuries
 * 
 * Research-based impact:
 * - Elite player (McDavid, MacKinnon): -8% to -12% win probability
 * - Star player (Kaprizov, Eichel): -5% to -8%
 * - Good player: -2% to -4%
 * - Multiple injuries compound (but capped)
 */
export function getTeamInjuryImpact(teamAbbrev: string, injuries?: typeof MANUAL_INJURIES): {
  adjustment: number;
  injuredStars: string[];
  description: string;
} {
  const injuredElites = getInjuredElitePlayers(teamAbbrev, injuries);
  
  if (injuredElites.length === 0) {
    return { adjustment: 0, injuredStars: [], description: '' };
  }
  
  // Calculate impact
  let totalAdjustment = 0;
  
  // Tier 1 superstars (biggest impact)
  const tier1 = ['Connor McDavid', 'Nathan MacKinnon', 'Auston Matthews', 'Nikita Kucherov'];
  // Tier 2 stars
  const tier2 = ['Leon Draisaitl', 'Cale Makar', 'David Pastrnak', 'Kirill Kaprizov', 
                 'Sidney Crosby', 'Alex Ovechkin', 'Jack Eichel', 'Mitch Marner'];
  
  for (const player of injuredElites) {
    if (tier1.includes(player)) {
      totalAdjustment -= 0.10; // -10%
    } else if (tier2.includes(player)) {
      totalAdjustment -= 0.07; // -7%
    } else {
      totalAdjustment -= 0.04; // -4%
    }
  }
  
  // Cap total impact at -20%
  totalAdjustment = Math.max(totalAdjustment, -0.20);
  
  const description = injuredElites.length === 1
    ? `${injuredElites[0]} OUT`
    : `${injuredElites.length} stars OUT`;
  
  return {
    adjustment: totalAdjustment,
    injuredStars: injuredElites,
    description,
  };
}

/**
 * Fetch latest injuries (tries API first, falls back to manual)
 */
export async function fetchCurrentInjuries(): Promise<typeof MANUAL_INJURIES> {
  try {
    // Try to get from our cron cache endpoint
    const res = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/cron/injuries`);
    if (res.ok) {
      const data = await res.json();
      if (data.injuries && Object.keys(data.injuries).length > 0) {
        return data.injuries;
      }
    }
  } catch {
    // Fall through to manual list
  }
  
  return MANUAL_INJURIES;
}
