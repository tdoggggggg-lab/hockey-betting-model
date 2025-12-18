import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'icehockey_nhl';

interface PlayerProp {
  playerId: string;
  playerName: string;
  team: string;
  teamAbbrev: string;
  propType: 'anytime_goalscorer' | 'first_goalscorer' | 'last_goalscorer' | 'shots' | 'points' | 'assists';
  line?: number;
  overOdds?: number;
  underOdds?: number;
  odds?: number; // For yes/no props like anytime goalscorer
  bookmaker: string;
  opponent?: string;
  gameTime?: string;
}

interface PropsResponse {
  props: PlayerProp[];
  lastUpdated: string;
  gamesCount: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const propType = searchParams.get('type') || 'anytime_goalscorer';
  
  console.log('Fetching player props, type:', propType);
  
  const apiKey = process.env.ODDS_API_KEY;
  
  if (!apiKey) {
    console.log('No ODDS_API_KEY, returning sample data');
    return NextResponse.json(getSampleGoalscorerProps());
  }
  
  try {
    // The Odds API player props endpoint
    // Note: Player props require a paid plan on The Odds API
    // Free tier only includes game odds, not player props
    const marketsMap: Record<string, string> = {
      'anytime_goalscorer': 'player_goal_scorer_anytime',
      'first_goalscorer': 'player_goal_scorer_first',
      'shots': 'player_shots_on_goal',
      'points': 'player_points',
      'assists': 'player_assists',
    };
    
    const market = marketsMap[propType] || 'player_goal_scorer_anytime';
    
    const params = new URLSearchParams({
      apiKey,
      regions: 'us',
      markets: market,
      oddsFormat: 'american',
    });
    
    const response = await fetch(
      `${ODDS_API_BASE}/sports/${SPORT_KEY}/events?${params}`,
      { next: { revalidate: 300 } }
    );
    
    if (!response.ok) {
      console.log('Odds API returned:', response.status);
      // Fall back to sample data if API fails or doesn't support player props
      return NextResponse.json(getSampleGoalscorerProps());
    }
    
    const data = await response.json();
    
    // Process the response
    const props = processPlayerProps(data, propType);
    
    if (props.length === 0) {
      // No props available from API, use sample data
      return NextResponse.json(getSampleGoalscorerProps());
    }
    
    return NextResponse.json({
      props,
      lastUpdated: new Date().toISOString(),
      gamesCount: data.length || 0,
    });
    
  } catch (error) {
    console.error('Error fetching player props:', error);
    return NextResponse.json(getSampleGoalscorerProps());
  }
}

function processPlayerProps(data: any[], propType: string): PlayerProp[] {
  const props: PlayerProp[] = [];
  
  // Process would go here if we had access to player props API
  // For now, return empty to trigger sample data
  
  return props;
}

function getSampleGoalscorerProps(): PropsResponse {
  // Sample data based on today's games
  // In production, this would come from the API or be calculated from player stats
  const sampleProps: PlayerProp[] = [
    // Edmonton Oilers players
    {
      playerId: '8478402',
      playerName: 'Connor McDavid',
      team: 'Edmonton Oilers',
      teamAbbrev: 'EDM',
      propType: 'anytime_goalscorer',
      odds: -110,
      bookmaker: 'DraftKings',
      opponent: 'Boston Bruins',
      gameTime: '5:00 PM',
    },
    {
      playerId: '8477934',
      playerName: 'Leon Draisaitl',
      team: 'Edmonton Oilers',
      teamAbbrev: 'EDM',
      propType: 'anytime_goalscorer',
      odds: +105,
      bookmaker: 'DraftKings',
      opponent: 'Boston Bruins',
      gameTime: '5:00 PM',
    },
    {
      playerId: '8479337',
      playerName: 'Zach Hyman',
      team: 'Edmonton Oilers',
      teamAbbrev: 'EDM',
      propType: 'anytime_goalscorer',
      odds: +185,
      bookmaker: 'FanDuel',
      opponent: 'Boston Bruins',
      gameTime: '5:00 PM',
    },
    // Boston Bruins players
    {
      playerId: '8479325',
      playerName: 'David Pastrnak',
      team: 'Boston Bruins',
      teamAbbrev: 'BOS',
      propType: 'anytime_goalscorer',
      odds: +110,
      bookmaker: 'DraftKings',
      opponent: 'Edmonton Oilers',
      gameTime: '5:00 PM',
    },
    {
      playerId: '8470638',
      playerName: 'Brad Marchand',
      team: 'Boston Bruins',
      teamAbbrev: 'BOS',
      propType: 'anytime_goalscorer',
      odds: +175,
      bookmaker: 'BetMGM',
      opponent: 'Edmonton Oilers',
      gameTime: '5:00 PM',
    },
    {
      playerId: '8477956',
      playerName: 'Charlie Coyle',
      team: 'Boston Bruins',
      teamAbbrev: 'BOS',
      propType: 'anytime_goalscorer',
      odds: +280,
      bookmaker: 'FanDuel',
      opponent: 'Edmonton Oilers',
      gameTime: '5:00 PM',
    },
    // Montreal Canadiens players
    {
      playerId: '8478483',
      playerName: 'Cole Caufield',
      team: 'Montreal Canadiens',
      teamAbbrev: 'MTL',
      propType: 'anytime_goalscorer',
      odds: +120,
      bookmaker: 'DraftKings',
      opponent: 'Chicago Blackhawks',
      gameTime: '5:00 PM',
    },
    {
      playerId: '8480069',
      playerName: 'Nick Suzuki',
      team: 'Montreal Canadiens',
      teamAbbrev: 'MTL',
      propType: 'anytime_goalscorer',
      odds: +165,
      bookmaker: 'FanDuel',
      opponent: 'Chicago Blackhawks',
      gameTime: '5:00 PM',
    },
    {
      playerId: '8477492',
      playerName: 'Juraj Slafkovsky',
      team: 'Montreal Canadiens',
      teamAbbrev: 'MTL',
      propType: 'anytime_goalscorer',
      odds: +210,
      bookmaker: 'BetMGM',
      opponent: 'Chicago Blackhawks',
      gameTime: '5:00 PM',
    },
    // Chicago Blackhawks players
    {
      playerId: '8478439',
      playerName: 'Connor Bedard',
      team: 'Chicago Blackhawks',
      teamAbbrev: 'CHI',
      propType: 'anytime_goalscorer',
      odds: +145,
      bookmaker: 'DraftKings',
      opponent: 'Montreal Canadiens',
      gameTime: '5:00 PM',
    },
    {
      playerId: '8480797',
      playerName: 'Philipp Kurashev',
      team: 'Chicago Blackhawks',
      teamAbbrev: 'CHI',
      propType: 'anytime_goalscorer',
      odds: +320,
      bookmaker: 'FanDuel',
      opponent: 'Montreal Canadiens',
      gameTime: '5:00 PM',
    },
    {
      playerId: '8477444',
      playerName: 'Tyler Bertuzzi',
      team: 'Chicago Blackhawks',
      teamAbbrev: 'CHI',
      propType: 'anytime_goalscorer',
      odds: +260,
      bookmaker: 'BetMGM',
      opponent: 'Montreal Canadiens',
      gameTime: '5:00 PM',
    },
  ];
  
  return {
    props: sampleProps,
    lastUpdated: new Date().toISOString(),
    gamesCount: 10,
  };
}
