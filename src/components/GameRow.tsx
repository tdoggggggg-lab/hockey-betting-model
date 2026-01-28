'use client';

interface GameRowProps {
  game: {
    id: string;
    homeTeam: { id?: number; name: string; abbreviation: string; injuries?: string[]; };
    awayTeam: { id?: number; name: string; abbreviation: string; injuries?: string[]; };
    startTime: string;
    status: string;
    prediction?: {
      homeWinProbability: number;
      awayWinProbability: number;
      predictedTotal: number;
      confidence: number;
      factors?: {
        goalDiff: number;
        homeIce: number;
        rest: number;
        pointsPct: number;
        injury: number;
      };
    };
    odds?: Array<{
      bookmaker: string;
      homeMoneyline: number;
      awayMoneyline: number;
      homeSpreadLine?: string;
      awaySpreadLine?: string;
      homeSpreadOdds: number;
      awaySpreadOdds: number;
      totalLine: number;
      overLine?: string;
      underLine?: string;
      overOdds: number;
      underOdds: number;
    }>;
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

function probToOdds(prob: number): string {
  if (prob >= 0.5) {
    return Math.round(-100 * prob / (1 - prob)).toString();
  }
  return `+${Math.round(100 * (1 - prob) / prob)}`;
}

function formatOdds(odds: number): string {
  if (odds === 0) return '-';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export default function GameRow({ game }: GameRowProps) {
  const prediction = game.prediction || {
    homeWinProbability: 0.5,
    awayWinProbability: 0.5,
    predictedTotal: 5.5,
    confidence: 0.5,
  };
  
  const homeProb = prediction.homeWinProbability;
  const awayProb = prediction.awayWinProbability;
  const favoriteAbbrev = homeProb > awayProb ? game.homeTeam.abbreviation : game.awayTeam.abbreviation;
  const favoriteProb = Math.max(homeProb, awayProb);
  
  const confDisplay = prediction.confidence >= 0.65 
    ? { label: 'High', color: 'text-emerald-400', bg: 'bg-emerald-500/20' }
    : prediction.confidence >= 0.50 
    ? { label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-500/20' }
    : { label: 'Low', color: 'text-slate-500', bg: 'bg-slate-500/20' };

  const bookOdds = game.odds?.[0];
  const homeInjuries = game.homeTeam.injuries || [];
  const awayInjuries = game.awayTeam.injuries || [];

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-all">
      <div className="p-4">
        <div className="flex items-start justify-between">
          {/* Teams */}
          <div className="flex-1">
            {/* Away Team */}
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: teamColors[game.awayTeam.abbreviation] || '#374151', color: 'white' }}>
                {game.awayTeam.abbreviation}
              </div>
              <div className="flex-1">
                <div>
                  <span className="text-white font-medium">{game.awayTeam.name}</span>
                  <span className={`ml-2 text-sm ${awayProb > homeProb ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>
                    ({Math.round(awayProb * 100)}%)
                  </span>
                </div>
                {awayInjuries.length > 0 && (
                  <div className="text-xs text-red-400/70 mt-0.5">
                    🏥 {awayInjuries.slice(0, 2).join(', ')}{awayInjuries.length > 2 ? ` +${awayInjuries.length - 2}` : ''}
                  </div>
                )}
              </div>
              <div className="text-right">
                <span className={`font-mono text-sm ${awayProb > homeProb ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {probToOdds(awayProb)}
                </span>
              </div>
            </div>
            
            <div className="text-slate-600 text-xs ml-4 mb-2">@</div>
            
            {/* Home Team */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: teamColors[game.homeTeam.abbreviation] || '#374151', color: 'white' }}>
                {game.homeTeam.abbreviation}
              </div>
              <div className="flex-1">
                <div>
                  <span className="text-white font-medium">{game.homeTeam.name}</span>
                  <span className={`ml-2 text-sm ${homeProb > awayProb ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>
                    ({Math.round(homeProb * 100)}%)
                  </span>
                </div>
                {homeInjuries.length > 0 && (
                  <div className="text-xs text-red-400/70 mt-0.5">
                    🏥 {homeInjuries.slice(0, 2).join(', ')}{homeInjuries.length > 2 ? ` +${homeInjuries.length - 2}` : ''}
                  </div>
                )}
              </div>
              <div className="text-right">
                <span className={`font-mono text-sm ${homeProb > awayProb ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {probToOdds(homeProb)}
                </span>
              </div>
            </div>
          </div>
          
          {/* Game Info */}
          <div className="ml-6 text-right">
            <div className="text-slate-400 text-sm mb-1">{formatTime(game.startTime)}</div>
            <div className="text-slate-500 text-xs">
              Total: <span className="text-white">{prediction.predictedTotal.toFixed(1)}</span>
            </div>
            <div className={`text-xs mt-1 px-2 py-0.5 rounded ${confDisplay.bg} ${confDisplay.color}`}>
              {confDisplay.label}
            </div>
          </div>
        </div>
      </div>
      
      {/* Book Lines + Book Odds Section */}
      {bookOdds && (
        <div className="px-4 py-2 bg-slate-800/30 border-t border-slate-800">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">{bookOdds.bookmaker}</span>
            <div className="flex gap-4">
              {/* Moneyline */}
              <div className="flex gap-2">
                <span className="text-slate-400">ML:</span>
                <span className="text-white font-mono">{formatOdds(bookOdds.awayMoneyline)}</span>
                <span className="text-slate-600">/</span>
                <span className="text-white font-mono">{formatOdds(bookOdds.homeMoneyline)}</span>
              </div>
              {/* Spread */}
              <div className="flex gap-2">
                <span className="text-slate-400">Spread:</span>
                <span className="text-slate-300">{bookOdds.awaySpreadLine || '+1.5'}</span>
                <span className="text-white font-mono">({formatOdds(bookOdds.awaySpreadOdds)})</span>
              </div>
              {/* Total */}
              <div className="flex gap-2">
                <span className="text-slate-400">Total:</span>
                <span className="text-slate-300">{bookOdds.overLine || `O ${bookOdds.totalLine}`}</span>
                <span className="text-white font-mono">({formatOdds(bookOdds.overOdds)})</span>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Model Prediction Banner */}
      <div className="px-4 py-3 bg-gradient-to-r from-blue-600/20 to-purple-600/20 border-t border-slate-800">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-3">
            <span className="text-slate-400">🤖 Model Pick:</span>
            <span className="text-white font-semibold">
              {favoriteAbbrev}
              <span className={`ml-1 ${favoriteProb >= 0.58 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                ({Math.round(favoriteProb * 100)}%)
              </span>
            </span>
            {favoriteProb >= 0.58 && prediction.confidence >= 0.55 && (
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-xs font-medium">
                ✓ BET
              </span>
            )}
          </div>
          <div className="text-slate-500 text-xs">
            Confidence: <span className="text-white">{Math.round(prediction.confidence * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
