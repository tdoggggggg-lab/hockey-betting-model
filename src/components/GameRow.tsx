'use client';

interface Team {
  id: number;
  name: string;
  abbreviation: string;
  logo?: string;
}

interface Odds {
  bookmaker: string;
  homeMoneyline: number;
  awayMoneyline: number;
  homeSpread: number;
  homeSpreadOdds: number;
  awaySpreadOdds: number;
  totalLine: number;
  overOdds: number;
  underOdds: number;
}

interface Prediction {
  homeWinProbability: number;
  awayWinProbability: number;
  predictedTotal: number;
  confidence: number;
}

interface GameRowProps {
  game: {
    id: string;
    homeTeam: Team;
    awayTeam: Team;
    startTime: string;
    status: 'scheduled' | 'live' | 'final';
    homeScore?: number;
    awayScore?: number;
    prediction?: Prediction;
    odds: Odds[];
  };
}

// NHL team colors for styling
const teamColors: Record<string, string> = {
  COL: '#6F263D',
  VGK: '#B4975A',
  TOR: '#00205B',
  BOS: '#FFB81C',
  EDM: '#FF4C00',
  CGY: '#D2001C',
  CHI: '#CF0A2C',
  STL: '#002F87',
  SEA: '#99D9D9',
  UTA: '#6CACE4',
  ANA: '#F47A38',
  NJD: '#CE1126',
  OTT: '#C52032',
  NYR: '#0038A8',
  // Add more as needed
};

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const timeStr = date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true,
  });
  // Returns something like "7:10 PM MT"
  return timeStr;
}

function OddsBox({ 
  topValue, 
  bottomValue, 
  isPositive = false,
  highlight = false 
}: { 
  topValue: string; 
  bottomValue: string; 
  isPositive?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center w-full h-14 rounded-lg border transition-all cursor-pointer hover:bg-slate-700 ${
      highlight ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-700 bg-slate-800/50'
    }`}>
      <span className="text-white text-xs font-medium leading-tight">{topValue || '\u00A0'}</span>
      <span className={`text-sm font-bold ${isPositive ? 'text-emerald-400' : 'text-blue-400'}`}>
        {bottomValue}
      </span>
    </div>
  );
}

export default function GameRow({ game }: GameRowProps) {
  const odds = game.odds[0]; // Use first bookmaker for display
  
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-all">
      {/* Game content */}
      <div className="p-4">
        <div className="grid grid-cols-12 gap-4 items-center">
          {/* Teams Column */}
          <div className="col-span-5 lg:col-span-4">
            {/* Away Team */}
            <div className="flex items-center gap-3 mb-3">
              <div 
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ 
                  backgroundColor: teamColors[game.awayTeam.abbreviation] || '#374151',
                  color: 'white'
                }}
              >
                {game.awayTeam.abbreviation.slice(0, 2)}
              </div>
              <div>
                <span className="text-white font-medium">{game.awayTeam.name}</span>
                {game.prediction && (
                  <span className="ml-2 text-xs text-slate-400">
                    ({Math.round(game.prediction.awayWinProbability * 100)}%)
                  </span>
                )}
              </div>
            </div>
            
            {/* @ symbol */}
            <div className="text-slate-600 text-xs ml-3 mb-3">@</div>
            
            {/* Home Team */}
            <div className="flex items-center gap-3">
              <div 
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ 
                  backgroundColor: teamColors[game.homeTeam.abbreviation] || '#374151',
                  color: 'white'
                }}
              >
                {game.homeTeam.abbreviation.slice(0, 2)}
              </div>
              <div>
                <span className="text-white font-medium">{game.homeTeam.name}</span>
                {game.prediction && (
                  <span className="ml-2 text-xs text-slate-400">
                    ({Math.round(game.prediction.homeWinProbability * 100)}%)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Puck Line Column */}
          <div className="col-span-2 lg:col-span-2">
            <div className="text-center mb-2">
              <span className="text-slate-500 text-xs uppercase tracking-wide">Spread</span>
            </div>
            <div className="space-y-2">
              <OddsBox 
                topValue="+1.5" 
                bottomValue={odds ? formatOdds(odds.awaySpreadOdds) : '-'}
                isPositive={odds && odds.awaySpreadOdds > 0}
              />
              <OddsBox 
                topValue="-1.5" 
                bottomValue={odds ? formatOdds(odds.homeSpreadOdds) : '-'}
                isPositive={odds && odds.homeSpreadOdds > 0}
              />
            </div>
          </div>

          {/* Moneyline Column */}
          <div className="col-span-2 lg:col-span-2">
            <div className="text-center mb-2">
              <span className="text-slate-500 text-xs uppercase tracking-wide">Money</span>
            </div>
            <div className="space-y-2">
              <OddsBox 
                topValue={game.awayTeam.abbreviation}
                bottomValue={odds ? formatOdds(odds.awayMoneyline) : '-'}
                isPositive={odds && odds.awayMoneyline > 0}
                highlight={odds && odds.awayMoneyline > 0}
              />
              <OddsBox 
                topValue={game.homeTeam.abbreviation}
                bottomValue={odds ? formatOdds(odds.homeMoneyline) : '-'}
                isPositive={odds && odds.homeMoneyline > 0}
                highlight={odds && odds.homeMoneyline > 0}
              />
            </div>
          </div>

          {/* Total Column */}
          <div className="col-span-2 lg:col-span-2">
            <div className="text-center mb-2">
              <span className="text-slate-500 text-xs uppercase tracking-wide">Total</span>
            </div>
            <div className="space-y-2">
              <OddsBox 
                topValue={odds ? `O ${odds.totalLine}` : '-'} 
                bottomValue={odds ? formatOdds(odds.overOdds) : '-'}
                isPositive={odds && odds.overOdds > 0}
              />
              <OddsBox 
                topValue={odds ? `U ${odds.totalLine}` : '-'} 
                bottomValue={odds ? formatOdds(odds.underOdds) : '-'}
                isPositive={odds && odds.underOdds > 0}
              />
            </div>
          </div>

          {/* Time & More Column */}
          <div className="col-span-1 lg:col-span-2 text-right">
            <div className="flex flex-col items-end gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 rounded text-xs text-emerald-400 font-medium">
                SGP
              </span>
              <span className="text-slate-400 text-sm">
                {formatTime(game.startTime)}
              </span>
              <button className="text-blue-400 hover:text-blue-300 text-sm font-medium flex items-center gap-1">
                More Bets
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Model Prediction Banner */}
      {game.prediction && (
        <div className="px-4 py-2 bg-gradient-to-r from-blue-600/20 to-purple-600/20 border-t border-slate-800">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-4">
              <span className="text-slate-400">🤖 Model Pick:</span>
              <span className="text-white font-medium">
                {game.prediction.homeWinProbability > game.prediction.awayWinProbability 
                  ? game.homeTeam.abbreviation 
                  : game.awayTeam.abbreviation}
                {' '}
                <span className="text-emerald-400">
                  ({Math.round(Math.max(game.prediction.homeWinProbability, game.prediction.awayWinProbability) * 100)}%)
                </span>
              </span>
            </div>
            <div className="flex items-center gap-4 text-slate-400">
              <span>Predicted Total: <span className="text-white">{game.prediction.predictedTotal.toFixed(1)}</span></span>
              <span>Confidence: <span className="text-white">{Math.round(game.prediction.confidence * 100)}%</span></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
