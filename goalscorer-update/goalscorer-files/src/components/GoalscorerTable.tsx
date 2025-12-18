'use client';

import { useState, useEffect } from 'react';

interface PlayerProp {
  playerId: string;
  playerName: string;
  team: string;
  teamAbbrev: string;
  propType: string;
  line?: number;
  overOdds?: number;
  underOdds?: number;
  odds?: number;
  bookmaker: string;
  opponent?: string;
  gameTime?: string;
}

interface PropsData {
  props: PlayerProp[];
  lastUpdated: string;
  gamesCount: number;
}

// Team colors for badges
const teamColors: Record<string, string> = {
  'EDM': '#FF4C00',
  'BOS': '#FFB81C',
  'MTL': '#AF1E2D',
  'CHI': '#CF0A2C',
  'TOR': '#00205B',
  'NYR': '#0038A8',
  'COL': '#6F263D',
  'VGK': '#B4975A',
  'FLA': '#041E42',
  'DAL': '#006847',
  'CAR': '#CC0000',
  'NJD': '#CE1126',
  'WPG': '#041E42',
  'VAN': '#00205B',
  'LAK': '#111111',
  'MIN': '#154734',
  'TBL': '#002868',
  'SEA': '#99D9D9',
  'OTT': '#C52032',
  'PIT': '#FCB514',
  'WSH': '#C8102E',
  'CGY': '#D2001C',
  'STL': '#002F87',
  'DET': '#CE1126',
  'PHI': '#F74902',
  'BUF': '#002654',
  'ANA': '#F47A38',
  'NSH': '#FFB81C',
  'CBJ': '#002654',
  'SJS': '#006D75',
  'ARI': '#8C2633',
  'UTA': '#6CACE4',
};

export default function GoalscorerTable() {
  const [propsData, setPropsData] = useState<PropsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'odds' | 'team' | 'name'>('odds');
  const [filterTeam, setFilterTeam] = useState<string>('all');

  useEffect(() => {
    async function fetchProps() {
      try {
        setLoading(true);
        const response = await fetch('/api/props?type=anytime_goalscorer');
        
        if (!response.ok) {
          throw new Error('Failed to fetch props');
        }
        
        const data = await response.json();
        setPropsData(data);
      } catch (err) {
        console.error('Error fetching props:', err);
        setError('Failed to load player props');
      } finally {
        setLoading(false);
      }
    }
    
    fetchProps();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
        <p className="text-slate-400">Loading player props...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4">⚠️</div>
        <h3 className="text-xl font-medium text-red-400">{error}</h3>
      </div>
    );
  }

  const props = propsData?.props || [];
  
  // Get unique teams for filter
  const teams = [...new Set(props.map(p => p.teamAbbrev))].sort();
  
  // Filter and sort props
  let filteredProps = filterTeam === 'all' 
    ? props 
    : props.filter(p => p.teamAbbrev === filterTeam);
  
  if (sortBy === 'odds') {
    filteredProps = [...filteredProps].sort((a, b) => (a.odds || 0) - (b.odds || 0));
  } else if (sortBy === 'team') {
    filteredProps = [...filteredProps].sort((a, b) => a.teamAbbrev.localeCompare(b.teamAbbrev));
  } else {
    filteredProps = [...filteredProps].sort((a, b) => a.playerName.localeCompare(b.playerName));
  }

  const formatOdds = (odds: number | undefined) => {
    if (!odds) return '-';
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  return (
    <div className="px-4">
      {/* Header with filters */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Anytime Goalscorer</h2>
          <p className="text-slate-400 text-sm">Player must score at least one goal in the game</p>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Team Filter */}
          <select
            value={filterTeam}
            onChange={(e) => setFilterTeam(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="all">All Teams</option>
            {teams.map(team => (
              <option key={team} value={team}>{team}</option>
            ))}
          </select>
          
          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="odds">Sort by Odds</option>
            <option value="team">Sort by Team</option>
            <option value="name">Sort by Name</option>
          </select>
        </div>
      </div>

      {/* Props Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredProps.map((prop, index) => (
          <div 
            key={`${prop.playerId}-${index}`}
            className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                {/* Team Badge */}
                <div 
                  className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ 
                    backgroundColor: teamColors[prop.teamAbbrev] || '#374151',
                    color: 'white'
                  }}
                >
                  {prop.teamAbbrev}
                </div>
                <div>
                  <h3 className="font-semibold text-white">{prop.playerName}</h3>
                  <p className="text-slate-400 text-sm">{prop.team}</p>
                </div>
              </div>
              
              {/* Odds Box */}
              <div className={`px-4 py-2 rounded-lg border ${
                prop.odds && prop.odds < 0 
                  ? 'border-emerald-500 bg-emerald-500/10' 
                  : 'border-slate-700 bg-slate-800/50'
              }`}>
                <span className={`text-lg font-bold ${
                  prop.odds && prop.odds > 0 ? 'text-emerald-400' : 'text-blue-400'
                }`}>
                  {formatOdds(prop.odds)}
                </span>
              </div>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <div className="text-slate-500">
                vs {prop.opponent} • {prop.gameTime}
              </div>
              <div className="text-slate-500">
                {prop.bookmaker}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredProps.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-4">🏒</div>
          <h3 className="text-lg font-medium text-slate-400">No goalscorer props available</h3>
          <p className="text-slate-500 text-sm mt-2">Check back closer to game time</p>
        </div>
      )}

      {/* Info Box */}
      <div className="mt-8 p-4 bg-slate-900/50 border border-slate-800 rounded-xl">
        <div className="flex items-start gap-3">
          <span className="text-2xl">💡</span>
          <div>
            <h3 className="font-semibold text-white mb-1">About Goalscorer Props</h3>
            <p className="text-slate-400 text-sm">
              Anytime goalscorer bets win if the selected player scores at least one goal during the game, 
              including overtime and shootout goals. Odds shown are from various sportsbooks — 
              negative odds indicate the favorite to score.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
