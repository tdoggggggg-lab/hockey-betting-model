import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const propType = searchParams.get('type') || 'anytime_goalscorer';
  
  console.log('Fetching player props, type:', propType);
  
  // Return sample goalscorer data
  return NextResponse.json(getSampleGoalscorerProps());
}

function getSampleGoalscorerProps() {
  const sampleProps = [
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
      odds: 105,
      bookmaker: 'DraftKings',
      opponent: 'Boston Bruins',
      gameTime: '5:00 PM',
    },
    {
      playerId: '8479325',
      playerName: 'David Pastrnak',
      team: 'Boston Bruins',
      teamAbbrev: 'BOS',
      propType: 'anytime_goalscorer',
      odds: 110,
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
      odds: 175,
      bookmaker: 'BetMGM',
      opponent: 'Edmonton Oilers',
      gameTime: '5:00 PM',
    },
    {
      playerId: '8478483',
      playerName: 'Cole Caufield',
      team: 'Montreal Canadiens',
      teamAbbrev: 'MTL',
      propType: 'anytime_goalscorer',
      odds: 120,
      bookmaker: 'DraftKings',
      opponent: 'Chicago Blackhawks',
      gameTime: '5:00 PM',
    },
    {
      playerId: '8478439',
      playerName: 'Connor Bedard',
      team: 'Chicago Blackhawks',
      teamAbbrev: 'CHI',
      propType: 'anytime_goalscorer',
      odds: 145,
      bookmaker: 'DraftKings',
      opponent: 'Montreal Canadiens',
      gameTime: '5:00 PM',
    },
    {
      playerId: '8480069',
      playerName: 'Nick Suzuki',
      team: 'Montreal Canadiens',
      teamAbbrev: 'MTL',
      propType: 'anytime_goalscorer',
      odds: 165,
      bookmaker: 'FanDuel',
      opponent: 'Chicago Blackhawks',
      gameTime: '5:00 PM',
    },
    {
      playerId: '8479337',
      playerName: 'Zach Hyman',
      team: 'Edmonton Oilers',
      teamAbbrev: 'EDM',
      propType: 'anytime_goalscorer',
      odds: 185,
      bookmaker: 'FanDuel',
      opponent: 'Boston Bruins',
      gameTime: '5:00 PM',
    },
  ];
  
  return {
    props: sampleProps,
    lastUpdated: new Date().toISOString(),
    gamesCount: 10,
  };
}
