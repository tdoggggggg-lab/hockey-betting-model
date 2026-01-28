# 🚨 PROJECT INSTRUCTIONS - READ FIRST EVERY CHAT

## ⚠️ SCOPE OF CHANGES RULE
**CRITICAL: Only change what is specifically requested.**
- Do NOT "fix" or "improve" unrelated code
- Do NOT remove features that weren't discussed
- If a fix requires touching other code, ASK FIRST
- List exactly what you're changing BEFORE doing it

---

## 🚨 CRITICAL RULES - VERIFY BEFORE WRITING ANY CODE

### 1. NO HARDCODING
Search the code for hardcoded lists before proceeding:
- ❌ `const knownPlayers = ['connor mcdavid', ...]` 
- ❌ `const injuredPlayers = new Set(['...'])`
- ❌ `if (playerName === 'specific name')`
- ✅ All data must come from APIs dynamically

### 2. TWO-SOURCE VALIDATION (For Injuries & Goalie Starters)
Use 2-source validation for uncertain/changing data:
- **Source 1:** ESPN API (injuries)
- **Source 2:** Odds API props (if player has props = likely playing)

**When to use multi-source validation:**
| Data Type | Sources Needed | Reason |
|-----------|----------------|--------|
| Player names/teams | 1 (NHL API) | Reliable, factual |
| Player stats | 1 (NHL API) | Official source |
| **Injuries** | 2 sources | Changes fast, unreliable |
| **Goalie starters** | 2 sources | Not official until game time |

**Validation Logic:**
```typescript
// If ESPN says injured AND no props exist → OUT
// If ESPN says injured BUT has props → Trust sportsbooks (PLAYING)
// If ESPN doesn't list them → Check if they have props
```

### 3. API BUDGET MANAGEMENT

#### BallDontLie API (FREE TIER)
```
Available Endpoints: Teams, Players ONLY
Rate Limit: 5 requests/minute
NO ACCESS TO: Games, Standings, Box Scores, Player Injuries, Player Season Stats
```
**Usage:** Only use for team/player lookup if needed. NOT for injuries.

#### The Odds API (500 requests/month)
```typescript
// REQUIRED: Cache all responses for 5+ minutes
const ODDS_CACHE_MINUTES = 5;
let oddsCache: { data: any; timestamp: number } | null = null;

async function fetchOddsWithCache() {
  if (oddsCache && Date.now() - oddsCache.timestamp < ODDS_CACHE_MINUTES * 60 * 1000) {
    console.log('Using cached odds');
    return oddsCache.data;
  }
  
  console.log('Odds API call: /events'); // Always log!
  const data = await fetch(...);
  oddsCache = { data, timestamp: Date.now() };
  return data;
}
```

#### ESPN API (FREE, no key)
```
Base URL: https://site.api.espn.com/apis/site/v2/sports/hockey/nhl
Endpoints:
- GET /injuries (all injuries)
- GET /teams/{id}/injuries (team injuries)
- GET /scoreboard
No rate limits documented, but use responsibly.
```

#### NHL Official API (FREE, no key)
```
Base URL: https://api-web.nhle.com/v1
Endpoints:
- GET /standings/now
- GET /schedule/now
- GET /roster/{team}/current
- GET /player/{id}/landing
```

### 4. STATS-BASED PLAYER IMPORTANCE
Never hardcode "elite" players:
```typescript
// ❌ WRONG
const elitePlayers = ['mcdavid', 'mackinnon'];

// ✅ RIGHT - Calculate from stats
const pointsShare = playerPoints / teamTotalPoints;
const isElite = pointsShare >= 0.15;
```

---

## 🏥 INJURY DETECTION SYSTEM (2-SOURCE)

### Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    INJURY VALIDATION                        │
├─────────────────────────────────────────────────────────────┤
│  Source 1: ESPN API          → "injured" or not listed     │
│  Source 2: Odds API Props    → "has_props" or "no_props"   │
├─────────────────────────────────────────────────────────────┤
│  LOGIC:                                                     │
│  - ESPN says injured + no props  → OUT                      │
│  - ESPN says injured + has props → PLAYING (trust books)   │
│  - Not in ESPN + has props       → PLAYING                  │
│  - Not in ESPN + no props        → Check roster, cautious   │
└─────────────────────────────────────────────────────────────┘
```

### Implementation
```typescript
async function getValidatedInjuries(playersWithProps: Set<string>): Promise<Set<string>> {
  const espnInjured = await fetchESPNInjuries();
  const validatedOut = new Set<string>();
  
  for (const player of espnInjured) {
    // If sportsbooks have props for this player, trust them - player is likely playing
    if (playersWithProps.has(player)) {
      console.log(`${player}: ESPN says injured but has props - PLAYING`);
      continue;
    }
    // ESPN says injured AND no props - definitely OUT
    validatedOut.add(player);
    console.log(`${player}: ESPN injured + no props - OUT`);
  }
  
  return validatedOut;
}
```

---

## 🎯 PROJECT VISION

Build a fully automatic NHL prediction system that:
- Predicts game outcomes and player props
- Automatically detects injuries from ESPN + validates with Odds API
- Displays real-time betting lines alongside model predictions
- Calculates edge (value) when model disagrees with Vegas
- Requires ZERO manual intervention once deployed
- **Works forever without code changes** (stats-based, not name-based)

---

## ⚠️ IMPORTANT RULES

### NEVER Do These:
1. ❌ Hardcode player names for tier/importance
2. ❌ Hardcode injury lists
3. ❌ Call Odds API without caching
4. ❌ Call Odds API in loops
5. ❌ Use BallDontLie for injuries (not available on free tier)
6. ❌ Change code that wasn't discussed

### ALWAYS Do These:
1. ✅ Calculate player importance from current stats
2. ✅ Validate injuries with ESPN + Odds API props
3. ✅ Cache Odds API responses (5+ minutes)
4. ✅ Log Odds API calls for budget tracking
5. ✅ ASK before changing unrelated code
6. ✅ List changes before making them

---

## 🔑 ENVIRONMENT VARIABLES (Vercel)

```
ODDS_API_KEY=554cc95c542841c872715cd3b533f200
BALLDONTLIE_API_KEY=1b3356ae-abd2-4a95-b6e6-2c4e97e8c232
```

**API Summary:**
| API | Free Tier Limits | Use For |
|-----|------------------|---------|
| Odds API | 500 req/month | Props odds, injury validation |
| BallDontLie | Teams + Players only, 5 req/min | Team/player lookup only |
| ESPN | Unlimited (be responsible) | Injuries, scoreboard |
| NHL Official | Unlimited | Rosters, stats, schedule |

---

## 📋 BEFORE EVERY CODE CHANGE

Ask yourself:
- [ ] Am I hardcoding any player names or lists?
- [ ] Am I caching Odds API calls?
- [ ] Am I using ESPN + Odds API for injury validation?
- [ ] Will this work with completely different players in 5 years?
- [ ] Am I ONLY changing what was requested?
