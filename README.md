# HockeyEdge 🏒

AI-powered hockey betting predictions with live odds comparison for NHL, 4 Nations Face-Off, and Olympic hockey.

## Features

- **Game Predictions**: ML model using expected goals (xG), possession metrics, and historical data
- **Live Odds**: Real-time odds comparison from 40+ sportsbooks via The Odds API
- **Player Props**: Individual player performance predictions
- **Futures**: Stanley Cup, conference, and award predictions

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Styling**: Tailwind CSS
- **Deployment**: Vercel
- **Odds Data**: The Odds API (free tier)
- **Stats Data**: NHL Web API

## Getting Started

1. Clone the repository
2. Copy `.env.example` to `.env.local` and add your API keys
3. Install dependencies: `npm install`
4. Run development server: `npm run dev`
5. Open [http://localhost:3000](http://localhost:3000)

## API Keys

### The Odds API (Required for live odds)
1. Go to [https://the-odds-api.com/](https://the-odds-api.com/)
2. Sign up for a free account (500 requests/month)
3. Copy your API key to `ODDS_API_KEY` in `.env.local`

## Deployment

This project is configured for Vercel deployment. Just connect your GitHub repo to Vercel.

## Disclaimer

This site is for informational and entertainment purposes only. We do not accept wagers or facilitate gambling. Please gamble responsibly.

## License

MIT
