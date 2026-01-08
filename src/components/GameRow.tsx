'use client';

interface InjuryImpact {
  homeStarsOut: string[];
  awayStarsOut: string[];
  homeAdjustment: number;
  awayAdjustment: number;
  homeSummary: string;
  awaySummary: string;
  homeGoalie: string;
  awayGoalie: string;
  compoundingWarning?: string;
  homePPImpact: number;
  awayPPImpact: number;
}

interface GameRowProps {
  game: {
    id: string;
    homeTeam: { id?: number; name: string; abbreviation: string; isB2B?: boolean; };
    awayTeam: { id?: number; name: string; abbreviation: string; isB2B?: boolean; };
    startTime: string;
    status: string;
    prediction?: {
      homeWinProbability: number;
      awayWinProbability: number;
      predictedTotal: number;
      confidence: number;
      injuryImpact?: InjuryImpact | null;
      isHomeB2B?: boolean;
      isAwayB2B?: boolean;
    };
    odds?: {
      bookmaker: string;
      homeMoneyline: number;
      awayMoneyline: number;
      homeSpread: number;
      homeSpreadOdds: number;
      awaySpreadOdds: number;
      totalLine: number;
      overOdds: number;
      underOdds: number;
    }[];
  };
}

const teamColors: Record<string, string> = {
  'EDM': '#FF4C00', 'BOS': '#FFB81C', 'MTL': '#AF1E2D', 'CHI': '#CF0A2C',
  'TOR': '#00205B', 'NYR': '#0038A8', 'COL': '#6F263D', 'VGK': '#B4975A',
  'FLA': '#041E42', 'DAL': '#006847', 'CAR': '#CC0000', 'NJD': '#CE1126',
  'WPG': '#041E42', 'VAN': '#00205B', 'LAK': '#111111', 'MIN': '#154734',
  'TBL': '#002868', 'SEA': '#99D9D9', 'OTT': '#C52032', 'PIT': '#FCB514',
  'WSH': '#C8102E', 'CGY': '#D2001C', 'STL': '#002F87', 'DET': '#CE1126',
  'PHI': '#F74902', 'BUF': '#002654', 'ANA': '#F47A38', 'NSH': '#FFB81C',
  'CBJ': '#002654', 'SJS': '#006D75', 'UTA': '#6CACE4', 'NYI': '#00539B',
};

function formatTime(dateString: string): string {
  if (!dateString) return 'TBD';
  try {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York'
    }) + ' ET';
  } catch {
    return 'TBD';
  }
}

function formatOdds(odds: number): string {
  if (!odds || odds === 0) return '-';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function probToOdds(prob: number): string {
  if (prob >= 0.5) {
    return Math.round(-100 * prob / (1 - prob)).toString();
  }
  return `+${Math.round(100 * (1 - prob) / prob)}`;
}

// Convert American odds to implied probability
function oddsToProb(americanOdds: number): number {
  if (americanOdds === 0) return 0.5;
  if (americanOdds > 0) {
    return 100 / (americanOdds + 100);
  } else {
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
  }
}

export default function GameRow({ game }: GameRowProps) {
  const prediction = game.prediction || {
    homeWinProbability: 0.5,
    awayWinProbability: 0.5,
    predictedTotal: 5.5,
    confidence: 0.5,
    injuryImpact: null,
  };
  
  const injuryImpact = prediction.injuryImpact;
  const odds = game.odds?.[0]; // Get first bookmaker (DraftKings)
  const hasOdds = odds && (odds.homeMoneyline !== 0 || odds.awayMoneyline !== 0);
  
  const homeProb = prediction.homeWinProbability;
  const awayProb = prediction.awayWinProbability;
  const favoriteAbbrev = homeProb > awayProb ? game.homeTeam.abbreviation : game.awayTeam.abbreviation;
  const favoriteProb = Math.max(homeProb, awayProb);
  
  // Format injury adjustment display (e.g., "-3.2%")
  const formatInjuryAdj = (adj: number): string => {
    if (!adj || adj === 0) return '';
    return adj > 0 ? `+${adj}%` : `${adj}%`;
  };
  
  // Get first star name for display (e.g., "McDavid out" instead of full array)
  const getInjuryNote = (starsOut: string[], adjustment: number): string | null => {
    if (!starsOut || starsOut.length === 0 || adjustment >= 0) return null;
    // Extract just the player name (before the tier notation)
    const firstName = starsOut[0].split(' (')[0];
    const lastName = firstName.split(' ').pop() || firstName;
    return `${lastName} out`;
  };
  
  // Calculate edge (value) if we have book odds
  let homeEdge = 0;
  let awayEdge = 0;
  if (hasOdds) {
    const bookHomeProb = oddsToProb(odds.homeMoneyline);
    const bookAwayProb = oddsToProb(odds.awayMoneyline);
    homeEdge = homeProb - bookHomeProb;
    awayEdge = awayProb - bookAwayProb;
  }
  
  const hasValue = Math.abs(homeEdge) >= 0.05 || Math.abs(awayEdge) >= 0.05;
  const valuePick = homeEdge > awayEdge ? 'home' : 'away';
  const valueEdge = Math.max(homeEdge, awayEdge);
  
  const confDisplay = prediction.confidence >= 0.65 
    ? { label: 'High', color: 'text-emerald-400', bg: 'bg-emerald-500/20' }
    : prediction.confidence >= 0.50 
    ? { label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-500/20' }
    : { label: 'Low', color: 'text-slate-500', bg: 'bg-slate-500/20' };

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-all">
      {/* Header with time and bookmaker */}
      <div className="px-4 py-2 border-b border-slate-800/50 flex justify-between items-center">
        <span className="text-slate-400 text-sm">{formatTime(game.startTime)}</span>
        {hasOdds && (
          <span className="text-xs text-slate-500">
            📊 {odds.bookmaker}
          </span>
        )}
      </div>
      
      <div className="p-4">
        {/* Column Headers */}
        <div className="grid grid-cols-12 gap-2 mb-2 text-xs text-slate-500">
          <div className="col-span-5">Team</div>
          <div className="col-span-2 text-center">Model</div>
          <div className="col-span-2 text-center">{hasOdds ? 'Book' : 'Fair'}</div>
          <div className="col-span-3 text-center">Spread / Total</div>
        </div>
        
        {/* Away Team Row */}
        <div className="grid grid-cols-12 gap-2 items-center mb-3">
          <div className="col-span-5 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ backgroundColor: teamColors[game.awayTeam.abbreviation] || '#374151', color: 'white' }}>
              {game.awayTeam.abbreviation}
            </div>
            <div className="flex flex-col">
              <span className="text-white font-medium text-sm truncate">{game.awayTeam.name}</span>
              {/* Injury indicator */}
              {injuryImpact && injuryImpact.awayStarsOut && injuryImpact.awayStarsOut.length > 0 && (
                <span className="text-red-400 text-xs">
                  🏥 {formatInjuryAdj(injuryImpact.awayAdjustment)} ({getInjuryNote(injuryImpact.awayStarsOut, injuryImpact.awayAdjustment)})
                </span>
              )}
              {prediction.isAwayB2B && (
                <span className="text-yellow-500 text-xs">⚡ B2B</span>
              )}
            </div>
          </div>
          <div className="col-span-2 text-center">
            <span className={`text-sm font-semibold ${awayProb > homeProb ? 'text-emerald-400' : 'text-slate-400'}`}>
              {Math.round(awayProb * 100)}%
            </span>
          </div>
          <div className="col-span-2 text-center">
            <span className={`font-mono text-sm ${hasOdds ? (awayEdge > 0.05 ? 'text-emerald-400' : 'text-white') : 'text-slate-400'}`}>
              {hasOdds ? formatOdds(odds.awayMoneyline) : probToOdds(awayProb)}
            </span>
            {awayEdge > 0.05 && <span className="text-emerald-400 text-xs ml-1">+{Math.round(awayEdge * 100)}%</span>}
          </div>
          <div className="col-span-3 text-center text-slate-400 text-sm font-mono">
            {hasOdds ? `+1.5 (${formatOdds(odds.awaySpreadOdds)})` : '+1.5'}
          </div>
        </div>
        
        {/* Home Team Row */}
        <div className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-5 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ backgroundColor: teamColors[game.homeTeam.abbreviation] || '#374151', color: 'white' }}>
              {game.homeTeam.abbreviation}
            </div>
            <div className="flex flex-col">
              <span className="text-white font-medium text-sm truncate">{game.homeTeam.name}</span>
              {/* Injury indicator */}
              {injuryImpact && injuryImpact.homeStarsOut && injuryImpact.homeStarsOut.length > 0 && (
                <span className="text-red-400 text-xs">
                  🏥 {formatInjuryAdj(injuryImpact.homeAdjustment)} ({getInjuryNote(injuryImpact.homeStarsOut, injuryImpact.homeAdjustment)})
                </span>
              )}
              {prediction.isHomeB2B && (
                <span className="text-yellow-500 text-xs">⚡ B2B</span>
              )}
            </div>
          </div>
          <div className="col-span-2 text-center">
            <span className={`text-sm font-semibold ${homeProb > awayProb ? 'text-emerald-400' : 'text-slate-400'}`}>
              {Math.round(homeProb * 100)}%
            </span>
          </div>
          <div className="col-span-2 text-center">
            <span className={`font-mono text-sm ${hasOdds ? (homeEdge > 0.05 ? 'text-emerald-400' : 'text-white') : 'text-slate-400'}`}>
              {hasOdds ? formatOdds(odds.homeMoneyline) : probToOdds(homeProb)}
            </span>
            {homeEdge > 0.05 && <span className="text-emerald-400 text-xs ml-1">+{Math.round(homeEdge * 100)}%</span>}
          </div>
          <div className="col-span-3 text-center text-slate-400 text-sm font-mono">
            {hasOdds ? `-1.5 (${formatOdds(odds.homeSpreadOdds)})` : '-1.5'}
          </div>
        </div>
        
        {/* Total Line */}
        {hasOdds && (
          <div className="mt-3 pt-3 border-t border-slate-800/50 flex justify-center gap-6 text-sm">
            <span className="text-slate-500">
              O/U <span className="text-white font-mono">{odds.totalLine}</span>
            </span>
            <span className="text-slate-400 font-mono">
              O {formatOdds(odds.overOdds)} / U {formatOdds(odds.underOdds)}
            </span>
            <span className="text-slate-500">
              Model: <span className="text-blue-400">{prediction.predictedTotal.toFixed(1)}</span>
            </span>
          </div>
        )}
      </div>
      
      {/* Model Prediction Banner */}
      <div className="px-4 py-3 bg-gradient-to-r from-blue-600/20 to-purple-600/20 border-t border-slate-800">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-3">
            <span className="text-slate-400">🤖 Pick:</span>
            <span className="text-white font-semibold">
              {favoriteAbbrev}
              <span className={`ml-1 ${favoriteProb >= 0.58 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                ({Math.round(favoriteProb * 100)}%)
              </span>
            </span>
            {hasValue && valueEdge >= 0.05 && (
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-xs font-medium">
                ✓ VALUE +{Math.round(valueEdge * 100)}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className={`text-xs px-2 py-0.5 rounded ${confDisplay.bg} ${confDisplay.color}`}>
              {confDisplay.label}
            </span>
            {!hasOdds && (
              <span className="text-slate-500 text-xs">No live odds</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
