'use client';

// Reusable Top Picks Cards Component
// Use this on any props tab (Goalscorer, Shots, Assists, Points, Goalie Props)

interface TopPick {
  playerId: number;
  playerName: string;
  teamAbbrev: string;
  probability: number;
  confidence: number;
  edge?: number;
}

interface TopPicksCardsProps {
  picks: TopPick[];
  title?: string;
  formatValue?: (prob: number) => string;  // Custom value formatter (e.g., for shots: "3.5 SOG")
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

export default function TopPicksCards({ picks, title = 'Top Picks', formatValue }: TopPicksCardsProps) {
  // Format probability as percentage
  const formatProbability = (prob: number) => `${(prob * 100).toFixed(1)}%`;
  
  // Format fair odds from probability
  const formatFairOdds = (prob: number) => {
    if (prob <= 0 || prob >= 1) return '-';
    if (prob >= 0.5) return Math.round((-100 * prob) / (1 - prob)).toString();
    return `+${Math.round((100 * (1 - prob)) / prob)}`;
  };

  // Only show top 6
  const topSix = picks.slice(0, 6);

  if (topSix.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
        🎯 {title}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {topSix.map((pick, index) => (
          <div 
            key={pick.playerId} 
            className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3"
          >
            {/* Header: Team badge, name, rank */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div 
                  className="w-10 h-10 rounded flex items-center justify-center text-xs font-bold" 
                  style={{ backgroundColor: teamColors[pick.teamAbbrev] || '#374151', color: 'white' }}
                >
                  {pick.teamAbbrev}
                </div>
                <div>
                  <div className="font-medium text-white">{pick.playerName}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-emerald-400 font-bold text-lg">#{index + 1}</div>
              </div>
            </div>
            
            {/* Stats row: Prob, Fair, Edge/Confidence */}
            <div className="mt-3 flex justify-between text-sm">
              <div>
                <div className="text-slate-500 text-xs">Prob</div>
                <div className="text-white font-semibold">
                  {formatValue ? formatValue(pick.probability) : formatProbability(pick.probability)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs">Fair</div>
                <div className="text-emerald-400 font-semibold">{formatFairOdds(pick.probability)}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs">&nbsp;</div>
                {pick.edge && pick.edge > 0.03 ? (
                  <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                    +{(pick.edge * 100).toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-slate-400 text-sm">
                    {Math.round(pick.confidence * 100)}%
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Example usage in any prop tab:
// 
// import TopPicksCards from '@/components/TopPicksCards';
// 
// // In your component:
// const topPicks = predictions
//   .sort((a, b) => b.probability - a.probability)
//   .slice(0, 6)
//   .map(p => ({
//     playerId: p.playerId,
//     playerName: p.playerName,
//     teamAbbrev: p.teamAbbrev,
//     probability: p.probability,
//     confidence: p.confidence,
//     edge: p.edge
//   }));
// 
// return (
//   <div>
//     <TopPicksCards picks={topPicks} title="Top Picks" />
//     {/* rest of your table */}
//   </div>
// );
