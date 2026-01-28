// src/lib/injury-service.ts
// ============================================================
// COMPREHENSIVE NHL INJURY SYSTEM - 2-SOURCE VALIDATION
// ============================================================
//
// TWO SOURCES FOR ACCURACY:
// 1. ESPN Injuries API - official injury status
// 2. The Odds API - if player has props, they're playing
//
// NOTE: BALLDONTLIE free tier only includes players/teams, NOT injuries
// The injuries endpoint requires a paid subscription
//
// RULE: Both sources should agree when possible
// If ESPN says injured AND no props → OUT
// If ESPN says healthy OR has props → PLAYING
// If only one source available → trust that source
//
// ⚠️ NO HARDCODED PLAYER NAMES - All data from APIs dynamically
// ⚠️ ODDS API CACHED - 5 minute minimum to stay under 500/month
//
// FEATURES:
// 1. Multi-source validation (ESPN + Odds API)
// 2. Auto player importance from stats (NOT hardcoded names)
// 3. Position value (G > D > C > W)
// 4. Star concentration risk
// 5. Sportsbook validation (no props = not playing)
// ============================================================

// ============ TYPES ============

export interface PlayerInjury {
  playerId: string
  playerName: string
  team: string
  teamAbbrev: string
  position: string
  status: "OUT" | "DAY_TO_DAY" | "IR" | "LTIR" | "SUSPENDED" | "QUESTIONABLE"
  injuryType: string
  description: string
  expectedReturn?: string
  gamesOut?: number
  source: "ESPN"
  updatedAt: string
}

// Multi-source validation tracking
export interface PlayerAvailability {
  playerName: string
  normalizedName: string
  team: string
  espnStatus: "injured" | "healthy" | "unknown"
  oddsStatus: "has_props" | "no_props" | "unknown" // has_props = likely playing
  finalVerdict: "OUT" | "PLAYING" | "UNCERTAIN"
  sourcesAgree: number // How many sources agree
  injuryDetails?: PlayerInjury
  reasoning: string
}

export interface PlayerImportance {
  playerId: string
  playerName: string
  team: string
  position: string
  tier: 1 | 2 | 3 | 4 | 5
  importanceScore: number
  pointsShare: number
  toiRank: number
  ppTimeShare: number
  pkTimeShare: number
  goalsAboveExpected: number
  winProbImpact: number
  ppImpact: number
  pkImpact: number
}

export interface StarConcentration {
  tier1Count: number
  tier2Count: number
  topPlayerShare: number
  secondPlayerShare: number
  hasSecondaryStar: boolean
  concentrationMultiplier: number
  riskLevel: "low" | "medium" | "high" | "extreme"
  description: string
}

export interface TeamInjuryImpact {
  teamAbbrev: string
  injuries: PlayerInjury[]
  totalWinProbAdjustment: number
  powerPlayAdjustment: number
  penaltyKillAdjustment: number
  expectedGoalsForAdjustment: number
  expectedGoalsAgainstAdjustment: number
  goalieSituation: "starter" | "backup" | "emergency" | "unknown"
  isBackupGoalieElite: boolean
  affectedLinemates: Map<string, number>
  linePromotions: number
  defenseDisruption: number
  manGamesLost: number
  injuryCount: number
  compoundingMultiplier: number
  starConcentration: StarConcentration
  starPlayersOut: string[]
  summary: string
}

export interface ReturningPlayer {
  playerName: string
  team: string
  gamesSinceReturn: number
  rustPenalty: number
}

// ============ POSITION VALUE MULTIPLIERS ============

const POSITION_VALUE: Record<string, number> = {
  G: 1.5,
  D: 1.2,
  C: 1.1,
  LW: 1.0,
  RW: 1.0,
  F: 1.05,
}

const MAX_WIN_PROB_IMPACT: Record<string, number> = {
  G: 0.1,
  D: 0.07,
  C: 0.06,
  LW: 0.05,
  RW: 0.05,
  F: 0.05,
}

// ============ TIER THRESHOLDS ============

const TIER_THRESHOLDS = {
  1: 0.7,
  2: 0.5,
  3: 0.35,
  4: 0.2,
  5: 0.0,
}

// ============ STAR CONCENTRATION MULTIPLIERS ============
// Research: Buffalo .517→.143 without Dahlin (72% drop)
// Pittsburgh .632 without Crosby (Malkin stepped up)
// Colorado .833 without MacKinnon (Makar/Rantanen)

const STAR_CONCENTRATION_MULTIPLIERS = {
  extreme: 1.4, // Single star, no backup (Buffalo)
  high: 1.25, // Single star with decent #2
  medium: 1.0, // Two stars (Pittsburgh)
  low: 0.8, // Three+ stars (Colorado)
}

// ============ RUST FACTOR ============

const RUST_PENALTY: Record<number, number> = {
  1: 0.08,
  2: 0.06,
  3: 0.04,
  4: 0.02,
  5: 0.01,
}

// ============ COMPOUNDING ============

function calculateCompoundingMultiplier(injuryCount: number, manGamesLost: number): number {
  let multiplier = 1.0
  if (injuryCount >= 2) multiplier = 0.15
  if (injuryCount >= 3) multiplier = 0.3
  if (injuryCount >= 4) multiplier = 0.5
  if (injuryCount >= 5) multiplier = 0.75
  if (manGamesLost > 30) multiplier *= 1.1
  return Math.min(multiplier, 2.0)
}

// ============ LINEMATE DROP ============

const LINEMATE_DROP_BY_TIER: Record<number, number> = {
  1: 0.65,
  2: 0.75,
  3: 0.85,
  4: 0.95,
  5: 1.0,
}

const LINE_PROMOTION_PENALTY = 0.85

// ============ ESPN TEAM MAP ============
// This maps ESPN team IDs to NHL abbreviations - this is STABLE data (team IDs don't change)

const ESPN_TEAM_MAP: Record<string, string> = {
  "1": "BOS",
  "2": "BUF",
  "3": "CGY",
  "4": "CAR",
  "5": "CHI",
  "6": "COL",
  "7": "CBJ",
  "8": "DAL",
  "9": "DET",
  "10": "EDM",
  "11": "FLA",
  "12": "LAK",
  "13": "MIN",
  "14": "MTL",
  "15": "NSH",
  "16": "NJD",
  "17": "NYI",
  "18": "NYR",
  "19": "OTT",
  "20": "PHI",
  "21": "PIT",
  "22": "SJS",
  "23": "SEA",
  "24": "STL",
  "25": "ANA",
  "26": "TBL",
  "27": "TOR",
  "28": "UTA",
  "29": "VAN",
  "30": "VGK",
  "31": "WSH",
  "32": "WPG",
}

// ============ CACHE ============

interface InjuryCache {
  injuries: Map<string, PlayerInjury[]>
  playerImportance: Map<string, PlayerImportance>
  teamStarConcentration: Map<string, StarConcentration>
  teamImpacts: Map<string, TeamInjuryImpact>
  allInjuredNames: Set<string>
  returningPlayers: Map<string, ReturningPlayer>
  // Multi-source validation
  espnInjured: Set<string>
  playersWithProps: Set<string> // Players who have sportsbook props (likely playing)
  playerAvailability: Map<string, PlayerAvailability>
  validationSummary: {
    espnCount: number
    propsCount: number
    agreedOut: number
    agreedPlaying: number
    uncertain: number
  }
  timestamp: number
}

let injuryCache: InjuryCache = {
  injuries: new Map(),
  playerImportance: new Map(),
  teamStarConcentration: new Map(),
  teamImpacts: new Map(),
  allInjuredNames: new Set(),
  returningPlayers: new Map(),
  espnInjured: new Set(),
  playersWithProps: new Set(),
  playerAvailability: new Map(),
  validationSummary: { espnCount: 0, propsCount: 0, agreedOut: 0, agreedPlaying: 0, uncertain: 0 },
  timestamp: 0,
}

const CACHE_TTL = 7200000 // 2 hours for main injury cache

// ⚠️ ODDS API CACHE - Required per project instructions (500 requests/month limit)
const ODDS_PROPS_CACHE_MINUTES = 5
let oddsPropsCache: { data: Set<string>; timestamp: number; quotaExceededUntil?: number } | null = null

const QUOTA_LOCKOUT_MINUTES = 60 // Don't retry for 60 minutes after quota error

export function isOddsApiAvailable(): boolean {
  if (!oddsPropsCache?.quotaExceededUntil) return true
  // Check if lockout period has passed
  if (Date.now() > oddsPropsCache.quotaExceededUntil) {
    console.log("🔄 Odds API lockout period expired - will retry on next request")
    return true
  }
  const remainingMins = Math.round((oddsPropsCache.quotaExceededUntil - Date.now()) / 60000)
  console.log(`⏸️ Odds API quota exceeded - ${remainingMins} minutes until retry`)
  return false
}

export function markOddsApiQuotaExceeded(): void {
  const lockoutUntil = Date.now() + QUOTA_LOCKOUT_MINUTES * 60 * 1000
  // Update or create cache with quota exceeded timestamp
  if (oddsPropsCache) {
    oddsPropsCache.quotaExceededUntil = lockoutUntil
  } else {
    oddsPropsCache = { data: new Set<string>(), timestamp: Date.now(), quotaExceededUntil: lockoutUntil }
  }
  console.log(`⚠️ Odds API quota exceeded - blocking all calls for ${QUOTA_LOCKOUT_MINUTES} minutes`)
}

// ============ HELPERS ============

function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, "")
    .replace(/[^a-z\s-]/g, "")
    .trim()
}

function mapStatus(espnStatus: string): PlayerInjury["status"] {
  const status = espnStatus.toLowerCase()
  if (status.includes("out") || status === "o") return "OUT"
  if (status.includes("day-to-day") || status.includes("dtd") || status === "d") return "DAY_TO_DAY"
  if (status.includes("injured reserve") || (status.includes("ir") && !status.includes("lt"))) return "IR"
  if (status.includes("ltir") || status.includes("long term")) return "LTIR"
  if (status.includes("suspend")) return "SUSPENDED"
  if (status.includes("question") || status === "q") return "QUESTIONABLE"
  return "OUT"
}

// ============ SOURCE 1: ESPN INJURIES ============

async function fetchESPNInjuries(): Promise<Map<string, PlayerInjury[]>> {
  const injuries = new Map<string, PlayerInjury[]>()

  try {
    const teamsRes = await fetch("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams", {
      headers: { Accept: "application/json" },
    })

    if (!teamsRes.ok) return injuries

    const teamsData = await teamsRes.json()
    const teams = teamsData.sports?.[0]?.leagues?.[0]?.teams || []

    const batchSize = 8
    for (let i = 0; i < teams.length; i += batchSize) {
      const batch = teams.slice(i, i + batchSize)

      await Promise.all(
        batch.map(async (teamData: any) => {
          try {
            const espnId = teamData.team?.id
            const abbrev = ESPN_TEAM_MAP[espnId]
            if (!abbrev) return

            const injuryRes = await fetch(
              `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${espnId}/injuries`,
              { headers: { Accept: "application/json" } },
            )

            if (!injuryRes.ok) return

            const injuryData = await injuryRes.json()
            const teamInjuries: PlayerInjury[] = []

            for (const item of injuryData.items || []) {
              const athlete = item.athlete || {}
              const injury: PlayerInjury = {
                playerId: athlete.id || "",
                playerName: athlete.displayName || athlete.fullName || "",
                team: teamData.team?.displayName || "",
                teamAbbrev: abbrev,
                position: athlete.position?.abbreviation || "F",
                status: mapStatus(item.status || "out"),
                injuryType: item.type?.description || item.details?.type || "Undisclosed",
                description: item.longComment || item.shortComment || "",
                expectedReturn: item.details?.returnDate || undefined,
                source: "ESPN",
                updatedAt: new Date().toISOString(),
              }

              if (injury.playerName) teamInjuries.push(injury)
            }

            if (teamInjuries.length > 0) injuries.set(abbrev, teamInjuries)
          } catch (e) {}
        }),
      )

      if (i + batchSize < teams.length) await new Promise((r) => setTimeout(r, 200))
    }
  } catch (error) {
    console.error("❌ ESPN injuries fetch error:", error)
  }

  return injuries
}

// ============ SOURCE 2: THE ODDS API - WITH CACHING ============
// ⚠️ ODDS API has 500 requests/month limit - MUST CACHE

async function fetchPlayersWithProps(): Promise<Set<string>> {
  if (!isOddsApiAvailable()) {
    // Return cached data if available, otherwise empty set
    return oddsPropsCache?.data || new Set<string>()
  }

  // ⚠️ CHECK CACHE FIRST - Required per project instructions
  if (
    oddsPropsCache &&
    !oddsPropsCache.quotaExceededUntil &&
    Date.now() - oddsPropsCache.timestamp < ODDS_PROPS_CACHE_MINUTES * 60 * 1000
  ) {
    console.log(
      `✅ Using cached Odds API props data (${Math.round((Date.now() - oddsPropsCache.timestamp) / 1000)}s old)`,
    )
    return oddsPropsCache.data
  }

  const playersWithProps = new Set<string>()

  const ODDS_API_KEY = process.env.ODDS_API_KEY
  if (!ODDS_API_KEY) {
    console.log("⚠️ No ODDS_API_KEY - skipping props validation")
    return playersWithProps
  }

  try {
    console.log("🔄 Odds API call: /events (props validation)") // Always log API calls!

    // First get today's events
    const eventsRes = await fetch(`https://api.the-odds-api.com/v4/sports/icehockey_nhl/events?apiKey=${ODDS_API_KEY}`)

    if (eventsRes.status === 401) {
      markOddsApiQuotaExceeded()
      // Cache empty result to prevent rapid retries, extending cache to 60 mins
      oddsPropsCache = {
        data: playersWithProps,
        timestamp: Date.now(),
        quotaExceededUntil: Date.now() + QUOTA_LOCKOUT_MINUTES * 60 * 1000,
      }
      return playersWithProps
    }

    if (!eventsRes.ok) {
      console.log(`⚠️ Odds API events error: ${eventsRes.status}`)
      oddsPropsCache = { data: playersWithProps, timestamp: Date.now() }
      return playersWithProps
    }

    const events = await eventsRes.json()
    const remaining = eventsRes.headers.get("x-requests-remaining")
    console.log(`📋 Odds API: ${events.length} events, ${remaining} credits remaining`)

    const remainingCredits = Number.parseInt(remaining || "999", 10)
    if (remainingCredits < 10) {
      console.log(`⚠️ Odds API credits very low (${remainingCredits}) - skipping per-event fetches`)
      oddsPropsCache = { data: playersWithProps, timestamp: Date.now() }
      return playersWithProps
    }

    // Filter to today's games only
    const now = new Date()
    const todayStart = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }))
    todayStart.setHours(0, 0, 0, 0)
    const tomorrowStart = new Date(todayStart)
    tomorrowStart.setDate(tomorrowStart.getDate() + 1)

    const todayEvents = events.filter((e: any) => {
      const eventTime = new Date(e.commence_time)
      return eventTime >= todayStart && eventTime < tomorrowStart
    })

    if (todayEvents.length === 0) {
      console.log("⚠️ No games today for props validation")
      oddsPropsCache = { data: playersWithProps, timestamp: Date.now() }
      return playersWithProps
    }

    // Fetch player props for up to 2 games (to save credits)
    // ⚠️ This uses additional API calls - be conservative
    const eventsToCheck = todayEvents.slice(0, 2)

    for (const event of eventsToCheck) {
      if (!isOddsApiAvailable()) {
        console.log("⏸️ Odds API quota exceeded mid-loop - stopping further requests")
        break
      }

      try {
        console.log(`🔄 Odds API call: /events/${event.id}/odds (player props)`)

        const propsRes = await fetch(
          `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events/${event.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=player_goal_scorer_anytime&bookmakers=draftkings,fanduel`,
        )

        if (propsRes.status === 401) {
          markOddsApiQuotaExceeded()
          break
        }

        if (!propsRes.ok) {
          console.log(`⚠️ Odds API props error for event ${event.id}: ${propsRes.status}`)
          continue
        }

        const propsData = await propsRes.json()

        for (const bookmaker of propsData.bookmakers || []) {
          for (const market of bookmaker.markets || []) {
            for (const outcome of market.outcomes || []) {
              const playerName = outcome.description || outcome.name
              if (playerName && playerName !== "Over" && playerName !== "Under") {
                const normalized = normalizePlayerName(playerName)
                playersWithProps.add(normalized)
              }
            }
          }
        }
      } catch (error: any) {
        console.log(`⚠️ Odds API props fetch error: ${error.message}`)
        // Continue to next event, don't fail entirely
      }
    }

    console.log(`✅ Odds API: ${playersWithProps.size} players with props`)
    oddsPropsCache = { data: playersWithProps, timestamp: Date.now() }
  } catch (error: any) {
    console.log(`❌ Odds API fetch error: ${error.message}`)
    // Cache empty result on error
    oddsPropsCache = { data: playersWithProps, timestamp: Date.now() }
  }

  return playersWithProps
}

// ============ MULTI-SOURCE VALIDATION ============
// ⚠️ NO HARDCODED PLAYER NAMES - All validation is dynamic from 2 API sources

function validatePlayerAvailability(
  normalized: string,
  espnInjured: Set<string>,
  playersWithProps: Set<string>,
  injuryDetails?: PlayerInjury,
): PlayerAvailability {
  const espnStatus: "injured" | "healthy" | "unknown" = espnInjured.has(normalized) ? "injured" : "healthy"

  // Odds API: has_props = likely playing, no_props = unknown (might just not have props listed)
  // Only mark as "no_props" if we have props data but player isn't in it
  const oddsStatus: "has_props" | "no_props" | "unknown" =
    playersWithProps.size > 0 ? (playersWithProps.has(normalized) ? "has_props" : "no_props") : "unknown"

  // 2-SOURCE VALIDATION LOGIC:
  // ESPN is the primary source for injuries
  // Odds API props are a secondary confirmation (if player has props, they're likely playing)

  let finalVerdict: "OUT" | "PLAYING" | "UNCERTAIN"
  let sourcesAgree = 0
  let reasoning = ""

  // If ESPN says injured
  if (espnStatus === "injured") {
    if (oddsStatus === "has_props") {
      // ESPN says injured but player has props - UNCERTAIN (might be game-time decision)
      finalVerdict = "UNCERTAIN"
      sourcesAgree = 0
      reasoning = `ESPN says injured but has sportsbook props - game-time decision?`
    } else {
      // ESPN says injured and no props (or unknown) - OUT
      finalVerdict = "OUT"
      sourcesAgree = oddsStatus === "no_props" ? 2 : 1
      reasoning = `ESPN: injured${oddsStatus === "no_props" ? ", no props" : ""}`
    }
  } else {
    // ESPN says healthy (not on injury list)
    if (oddsStatus === "has_props") {
      // Both agree player is available
      finalVerdict = "PLAYING"
      sourcesAgree = 2
      reasoning = `ESPN: healthy, has props`
    } else {
      // ESPN healthy but no props data - trust ESPN
      finalVerdict = "PLAYING"
      sourcesAgree = 1
      reasoning = `ESPN: healthy${oddsStatus === "no_props" ? " (no props listed)" : ""}`
    }
  }

  return {
    playerName: injuryDetails?.playerName || normalized,
    normalizedName: normalized,
    team: injuryDetails?.team || "",
    espnStatus,
    oddsStatus,
    finalVerdict,
    sourcesAgree,
    injuryDetails,
    reasoning,
  }
}

// ============ FETCH TEAM STATS ============

async function fetchTeamPlayerStats(teamAbbrev: string): Promise<{ players: any[]; goalies: any[]; teamStats: any }> {
  try {
    const skatersRes = await fetch(`https://api-web.nhle.com/v1/club-stats/${teamAbbrev}/now`)

    let players: any[] = []
    let goalies: any[] = []
    const teamStats: any = {}

    if (skatersRes.ok) {
      const data = await skatersRes.json()
      players = [...(data.skaters || [])]
      goalies = [...(data.goalies || [])]
      teamStats.points = players.reduce((sum, p) => sum + (p.points || 0), 0)
      teamStats.goals = players.reduce((sum, p) => sum + (p.goals || 0), 0)
    }

    return { players, goalies, teamStats }
  } catch (error) {
    console.error(`❌ NHL.com stats fetch error for ${teamAbbrev}:`, error)
    return { players: [], goalies: [], teamStats: {} }
  }
}

// ============ CALCULATE TEAM INJURY IMPACT ============

async function calculateTeamImpact(teamAbbrev: string, injuries: PlayerInjury[]): Promise<TeamInjuryImpact> {
  const { players, goalies, teamStats } = await fetchTeamPlayerStats(teamAbbrev)
  const starConcentration = calculateStarConcentration(players, teamStats)
  injuryCache.teamStarConcentration.set(teamAbbrev, starConcentration)

  const impact: TeamInjuryImpact = {
    teamAbbrev,
    injuries,
    totalWinProbAdjustment: 0,
    powerPlayAdjustment: 0,
    penaltyKillAdjustment: 0,
    expectedGoalsForAdjustment: 0,
    expectedGoalsAgainstAdjustment: 0,
    goalieSituation: "starter",
    isBackupGoalieElite: false,
    affectedLinemates: new Map(),
    linePromotions: 0,
    defenseDisruption: 0,
    manGamesLost: 0,
    injuryCount: 0,
    compoundingMultiplier: 1.0,
    starConcentration,
    starPlayersOut: [],
    summary: "",
  }

  // Filter active injuries (includes DAY_TO_DAY!)
  const activeInjuries = injuries.filter(
    (i) =>
      i.status === "OUT" ||
      i.status === "IR" ||
      i.status === "LTIR" ||
      i.status === "SUSPENDED" ||
      i.status === "DAY_TO_DAY",
  )

  if (activeInjuries.length === 0) {
    impact.summary = "No significant injuries"
    return impact
  }

  impact.injuryCount = activeInjuries.length

  let centersOut = 0,
    defensemenOut = 0,
    topPlayerInjured = false

  for (const injury of activeInjuries) {
    // Find player stats, prioritizing official NHL.com data
    const playerStats = [...players, ...goalies].find(
      (p) =>
        normalizePlayerName(`${p.firstName?.default || ""} ${p.lastName?.default || ""}`) ===
        normalizePlayerName(injury.playerName),
    )

    let importance: PlayerImportance

    if (injury.position === "G") {
      // Use playerStats if found, otherwise create a placeholder for goalie importance
      importance = await calculateGoalieImportance(
        playerStats || {
          playerId: injury.playerId,
          firstName: { default: injury.playerName.split(" ")[0] },
          lastName: { default: injury.playerName.split(" ").slice(1).join(" ") },
          gamesPlayed: 30, // Assume some games played if not found
          savePctg: 0.91, // Assume average save percentage
          team: teamAbbrev,
        },
        goalies,
      )

      // Determine goalie situation
      if (playerStats?.playerId) {
        if (importance.toiRank === 1) {
          impact.goalieSituation = "starter"
        } else {
          impact.goalieSituation = "backup"
          const backup = goalies.find((g) => g.playerId !== playerStats?.playerId)
          if (backup && (backup.savePctg || backup.savePercentage || 0) >= 0.913) {
            impact.isBackupGoalieElite = true
            importance.winProbImpact *= 0.5 // Elite backup is less impactful than starter
          }
        }
      } else {
        // If goalie stats not found, assume backup situation with no elite indicator
        impact.goalieSituation = "backup"
      }
    } else {
      // Use playerStats if found, otherwise create a placeholder for player importance
      importance = await calculatePlayerImportance(
        playerStats || {
          playerId: injury.playerId,
          firstName: { default: injury.playerName.split(" ")[0] },
          lastName: { default: injury.playerName.split(" ").slice(1).join(" ") },
          positionCode: injury.position,
          gamesPlayed: 40, // Assume some games played
          points: 20, // Assume average points
          avgToi: 900, // Assume average TOI
          team: teamAbbrev,
        },
        teamStats,
        players,
      )

      if (injury.position === "C") centersOut++
      if (injury.position === "D") defensemenOut++
      if (importance.tier === 1) topPlayerInjured = true
    }

    // IMPORTANT: Only cache player importance for players found in team stats (or with placeholder data if needed)
    if (importance.playerId) {
      injuryCache.playerImportance.set(importance.playerId, importance)
    }

    impact.totalWinProbAdjustment += importance.winProbImpact
    impact.powerPlayAdjustment += importance.ppImpact
    impact.penaltyKillAdjustment += importance.pkImpact

    if (importance.tier <= 2) impact.starPlayersOut.push(`${injury.playerName} (T${importance.tier})`)

    // Affected linemates calculation - consider top 4 players skating with the injured player
    if (importance.tier <= 3 && playerStats?.avgToi) {
      const linemateDropRate = LINEMATE_DROP_BY_TIER[importance.tier]
      players
        .filter((p) => p.playerId !== playerStats.playerId && (p.avgToi || 0) > 0)
        .sort((a, b) => (b.avgToi || 0) - (a.avgToi || 0)) // Sort by TOI to get most relevant linemates
        .slice(0, 4) // Consider up to 4 linemates
        .forEach((p) => {
          const name = `${p.firstName?.default || ""} ${p.lastName?.default || ""}`.trim()
          // Apply a compounding effect if multiple linemates are affected
          impact.affectedLinemates.set(name, (impact.affectedLinemates.get(name) || 1.0) * linemateDropRate)
        })
    }

    impact.manGamesLost += 5 // Simple assumption of 5 games lost per injury
  }

  // Adjustments based on specific positions out
  if (centersOut >= 1) {
    impact.linePromotions += centersOut * 3
    impact.expectedGoalsForAdjustment -= 0.15 * centersOut
  }
  if (defensemenOut >= 1) {
    impact.defenseDisruption = Math.min(defensemenOut * 0.3, 1.0)
    impact.expectedGoalsAgainstAdjustment += 0.2 * defensemenOut
  }

  impact.compoundingMultiplier = calculateCompoundingMultiplier(impact.injuryCount, impact.manGamesLost)

  // APPLY STAR CONCENTRATION MULTIPLIER!
  let concentrationMultiplier = 1.0
  if (impact.starPlayersOut.length > 0 || topPlayerInjured) {
    concentrationMultiplier = starConcentration.concentrationMultiplier
  }

  impact.totalWinProbAdjustment *= impact.compoundingMultiplier * concentrationMultiplier
  impact.powerPlayAdjustment *= impact.compoundingMultiplier
  impact.penaltyKillAdjustment *= impact.compoundingMultiplier

  // Clamp adjustment values to reasonable bounds
  impact.totalWinProbAdjustment = Math.max(-0.3, Math.min(0.3, impact.totalWinProbAdjustment))
  impact.powerPlayAdjustment = Math.max(-0.15, Math.min(0.15, impact.powerPlayAdjustment))
  impact.penaltyKillAdjustment = Math.max(-0.1, Math.min(0.1, impact.penaltyKillAdjustment))
  impact.expectedGoalsForAdjustment = Math.max(-0.5, Math.min(0.5, impact.expectedGoalsForAdjustment))
  impact.expectedGoalsAgainstAdjustment = Math.max(-0.5, Math.min(0.5, impact.expectedGoalsAgainstAdjustment))

  const parts: string[] = []
  if (impact.starPlayersOut.length > 0) parts.push(`Out: ${impact.starPlayersOut.join(", ")}`)
  if (impact.goalieSituation === "backup") parts.push(impact.isBackupGoalieElite ? "Elite backup" : "Backup goalie")
  if (starConcentration.riskLevel === "extreme" || starConcentration.riskLevel === "high") {
    parts.push(`⚠️ ${starConcentration.riskLevel.toUpperCase()} star dependency (${starConcentration.description})`)
  }
  if (impact.compoundingMultiplier > 1.1) parts.push(`${impact.injuryCount} injuries compounding`)
  impact.summary = parts.join(" | ") || "Minor injuries only"

  return impact
}

// ============ PUBLIC API ============

export async function refreshInjuryCache(): Promise<void> {
  console.log("🔄 Refreshing injury cache with 2-SOURCE VALIDATION...")
  console.log("⚠️ NO HARDCODED PLAYERS - All data from APIs dynamically")
  console.log("ℹ️ BALLDONTLIE injuries skipped (requires paid subscription)")
  const startTime = Date.now()

  // STEP 1: Fetch from both sources in parallel
  const [espnInjuries, playersWithProps] = await Promise.all([
    fetchESPNInjuries(),
    fetchPlayersWithProps(), // Now with caching!
  ])

  // STEP 2: Build ESPN injured set from the injuries map
  const espnInjured = new Set<string>()
  for (const [, teamInjuries] of espnInjuries) {
    for (const injury of teamInjuries) {
      if (
        injury.status === "OUT" ||
        injury.status === "IR" ||
        injury.status === "LTIR" ||
        injury.status === "DAY_TO_DAY" ||
        injury.status === "SUSPENDED"
      ) {
        espnInjured.add(normalizePlayerName(injury.playerName))
      }
    }
  }

  // ⚠️ NO HARDCODED LTIR PLAYERS - ESPN tracks these automatically

  console.log(`📊 Sources: ESPN=${espnInjured.size} injured, Props=${playersWithProps.size} players with props`)

  // STEP 3: Validate each potentially injured player (from ESPN only now)
  const allPlayersToCheck = new Set([...espnInjured])
  const playerAvailability = new Map<string, PlayerAvailability>()
  const allInjuredNames = new Set<string>()

  let agreedOut = 0
  let agreedPlaying = 0
  let uncertain = 0

  for (const playerName of allPlayersToCheck) {
    // Find injury details if available
    let injuryDetails: PlayerInjury | undefined
    for (const [, teamInjuries] of espnInjuries) {
      const found = teamInjuries.find((i) => normalizePlayerName(i.playerName) === playerName)
      if (found) {
        injuryDetails = found
        break
      }
    }

    const availability = validatePlayerAvailability(playerName, espnInjured, playersWithProps, injuryDetails)
    playerAvailability.set(playerName, availability)

    if (availability.finalVerdict === "OUT") {
      allInjuredNames.add(playerName)
      agreedOut++
    } else if (availability.finalVerdict === "PLAYING") {
      agreedPlaying++
    } else {
      // UNCERTAIN - be conservative, treat as potentially out
      allInjuredNames.add(playerName)
      uncertain++
    }
  }

  // STEP 4: Calculate team impacts with validated injuries
  const teamImpacts = new Map<string, TeamInjuryImpact>()

  for (const [teamAbbrev, teamInjuries] of espnInjuries) {
    // Filter to only include players who passed validation as OUT or UNCERTAIN
    const validatedInjuries = teamInjuries.filter((injury) =>
      allInjuredNames.has(normalizePlayerName(injury.playerName)),
    )

    const impact = await calculateTeamImpact(teamAbbrev, validatedInjuries)
    teamImpacts.set(teamAbbrev, impact)
  }

  // Update cache
  injuryCache = {
    ...injuryCache,
    injuries: espnInjuries,
    allInjuredNames,
    espnInjured,
    playersWithProps,
    playerAvailability,
    teamImpacts, // Update teamImpacts
    validationSummary: {
      espnCount: espnInjured.size,
      propsCount: playersWithProps.size,
      agreedOut,
      agreedPlaying,
      uncertain,
    },
    timestamp: Date.now(),
  }

  const elapsed = Date.now() - startTime
  console.log(`✅ Injury cache refreshed in ${elapsed}ms`)
  console.log(`📊 Validation: ${agreedOut} OUT, ${agreedPlaying} playing, ${uncertain} uncertain`)
}

export async function getTeamInjuryImpact(teamAbbrev: string): Promise<TeamInjuryImpact | null> {
  // Check cache validity and refresh if needed
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) {
    await refreshInjuryCache()
  }
  return injuryCache.teamImpacts.get(teamAbbrev) || null
}

export async function getAllInjuries(): Promise<Map<string, PlayerInjury[]>> {
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) await refreshInjuryCache()
  return injuryCache.injuries
}

export async function isPlayerInjured(playerName: string): Promise<boolean> {
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) await refreshInjuryCache()
  return injuryCache.allInjuredNames.has(normalizePlayerName(playerName))
}

export async function getInjuredPlayerNames(): Promise<Set<string>> {
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) {
    await refreshInjuryCache()
  }
  return injuryCache.allInjuredNames
}

export async function getPlayerAvailability(playerName: string): Promise<PlayerAvailability | null> {
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) await refreshInjuryCache()
  return injuryCache.playerAvailability.get(normalizePlayerName(playerName)) || null
}

export function getValidationSummary() {
  return {
    ...injuryCache.validationSummary,
    cacheAge: Date.now() - injuryCache.timestamp,
    cacheValid: Date.now() - injuryCache.timestamp < CACHE_TTL,
    oddsPropsCacheAge: oddsPropsCache ? Math.round((Date.now() - oddsPropsCache.timestamp) / 1000) : null,
    playersCount: oddsPropsCache?.data.size || 0,
    // Add quota status to summary
    oddsApiQuotaExceeded: oddsPropsCache?.quotaExceededUntil ? oddsPropsCache.quotaExceededUntil > Date.now() : false,
    oddsApiQuotaLockoutRemainingSeconds: oddsPropsCache?.quotaExceededUntil
      ? Math.max(0, Math.round((oddsPropsCache.quotaExceededUntil - Date.now()) / 1000))
      : 0,
    // Note: BALLDONTLIE free tier only provides players/teams, not injuries
    balldontlieNote: "Injuries endpoint requires paid subscription - using ESPN + Odds API only",
  }
}

export function getTeamStarConcentration(teamAbbrev: string): StarConcentration | null {
  return injuryCache.teamStarConcentration.get(teamAbbrev) || null
}

// ============ GAME PREDICTION ADJUSTMENTS ============

export interface GamePredictionAdjustments {
  homeWinProbAdjustment: number
  awayWinProbAdjustment: number
  homePPAdjustment: number
  awayPPAdjustment: number
  homePKAdjustment: number
  awayPKAdjustment: number
  expectedTotalAdjustment: number
  homeInjurySummary: string
  awayInjurySummary: string
  homeStarsOut: string[]
  awayStarsOut: string[]
  homeGoalieSituation: string
  awayGoalieSituation: string
  homeStarConcentration: StarConcentration | null
  awayStarConcentration: StarConcentration | null
  compoundingWarning: string
}

export async function getGamePredictionAdjustments(
  homeTeam: string,
  awayTeam: string,
  isHomeB2B = false,
  isAwayB2B = false,
): Promise<GamePredictionAdjustments> {
  // Ensure cache is fresh before getting impacts
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) {
    await refreshInjuryCache()
  }

  const homeImpact = await getTeamInjuryImpact(homeTeam)
  const awayImpact = await getTeamInjuryImpact(awayTeam)

  let homeAdj = homeImpact?.totalWinProbAdjustment || 0
  let awayAdj = awayImpact?.totalWinProbAdjustment || 0

  // B2B + Injuries compound MULTIPLICATIVELY
  if (isHomeB2B && homeImpact && homeImpact.injuryCount > 0) {
    const b2bPenalty = 0.05 // Fixed penalty for B2B
    // Adjust calculation to be more multiplicative
    const currentImpact = 1 + homeAdj
    const b2bFactor = 1 - b2bPenalty
    homeAdj = currentImpact * b2bFactor - 1
  }
  if (isAwayB2B && awayImpact && awayImpact.injuryCount > 0) {
    const b2bPenalty = 0.05 // Fixed penalty for B2B
    const currentImpact = 1 + awayAdj
    const b2bFactor = 1 - b2bPenalty
    awayAdj = currentImpact * b2bFactor - 1
  }

  const warnings: string[] = []
  if (homeImpact?.starConcentration?.riskLevel === "extreme") warnings.push(`${homeTeam}: EXTREME star dependency`)
  if (awayImpact?.starConcentration?.riskLevel === "extreme") warnings.push(`${awayTeam}: EXTREME star dependency`)

  return {
    homeWinProbAdjustment: homeAdj,
    awayWinProbAdjustment: awayAdj,
    homePPAdjustment: homeImpact?.powerPlayAdjustment || 0,
    awayPPAdjustment: awayImpact?.powerPlayAdjustment || 0,
    homePKAdjustment: homeImpact?.penaltyKillAdjustment || 0,
    awayPKAdjustment: awayImpact?.penaltyKillAdjustment || 0,
    expectedTotalAdjustment:
      (homeImpact?.expectedGoalsForAdjustment || 0) +
      (awayImpact?.expectedGoalsForAdjustment || 0) +
      (homeImpact?.expectedGoalsAgainstAdjustment || 0) +
      (awayImpact?.expectedGoalsAgainstAdjustment || 0),
    homeInjurySummary: homeImpact?.summary || "Healthy",
    awayInjurySummary: awayImpact?.summary || "Healthy",
    homeStarsOut: homeImpact?.starPlayersOut || [],
    awayStarsOut: awayImpact?.starPlayersOut || [],
    homeGoalieSituation: homeImpact?.goalieSituation || "unknown",
    awayGoalieSituation: awayImpact?.goalieSituation || "unknown",
    homeStarConcentration: homeImpact?.starConcentration || null,
    awayStarConcentration: awayImpact?.starConcentration || null,
    compoundingWarning: warnings.join(" | "),
  }
}

// ============ PLAYER PROPS ADJUSTMENTS ============

export interface PlayerPropsAdjustment {
  productionMultiplier: number
  rustPenalty: number
  isInjured: boolean
  reason: string
}

export async function getPlayerPropsAdjustment(playerName: string, teamAbbrev: string): Promise<PlayerPropsAdjustment> {
  if (Date.now() - injuryCache.timestamp > CACHE_TTL) await refreshInjuryCache()

  const normalizedName = normalizePlayerName(playerName)

  if (injuryCache.allInjuredNames.has(normalizedName)) {
    return { productionMultiplier: 0, rustPenalty: 0, isInjured: true, reason: "Player is OUT" }
  }

  let multiplier = 1.0
  let rustPenalty = 0
  const reasons: string[] = []

  const returning = injuryCache.returningPlayers.get(normalizedName)
  if (returning && returning.gamesSinceReturn <= 5) {
    rustPenalty = RUST_PENALTY[returning.gamesSinceReturn] || 0
    reasons.push(`Rust game ${returning.gamesSinceReturn} (-${Math.round(rustPenalty * 100)}%)`)
  }

  const impact = injuryCache.teamImpacts.get(teamAbbrev)
  if (impact) {
    const linemateMultiplier = impact.affectedLinemates.get(playerName)
    if (linemateMultiplier && linemateMultiplier < 1.0) {
      multiplier *= linemateMultiplier
      reasons.push(`Linemate injured (-${Math.round((1 - linemateMultiplier) * 100)}%)`)
    }
    // Line shuffling penalty should be applied if there are significant injuries or line promotions
    if (impact.linePromotions > 0 || impact.injuryCount > 1) {
      multiplier *= LINE_PROMOTION_PENALTY
      reasons.push(`Line shuffling (-${Math.round((1 - LINE_PROMOTION_PENALTY) * 100)}%)`)
    }
  }

  // Apply rust penalty last to avoid over-penalizing
  multiplier *= 1 - rustPenalty
  return { productionMultiplier: multiplier, rustPenalty, isInjured: false, reason: reasons.join(", ") || "" }
}

export function trackReturningPlayer(playerName: string, team: string): void {
  const normalized = normalizePlayerName(playerName)
  const existing = injuryCache.returningPlayers.get(normalized)
  if (existing) {
    existing.gamesSinceReturn++
    if (existing.gamesSinceReturn > 5) {
      // Remove player from returning list after 5 games to avoid long-term impact
      injuryCache.returningPlayers.delete(normalized)
    } else {
      existing.rustPenalty = RUST_PENALTY[existing.gamesSinceReturn] || 0
    }
  } else {
    // Add player with initial rust penalty for game 1
    injuryCache.returningPlayers.set(normalized, {
      playerName,
      team,
      gamesSinceReturn: 1,
      rustPenalty: RUST_PENALTY[1],
    })
  }
}

export function getCacheStatus() {
  const totalInjuries = Array.from(injuryCache.injuries.values()).reduce((sum, arr) => sum + arr.length, 0)
  const starPlayersOut: string[] = []
  for (const impact of injuryCache.teamImpacts.values()) starPlayersOut.push(...impact.starPlayersOut)
  const teamsWithHighConcentration: string[] = []
  for (const [team, conc] of injuryCache.teamStarConcentration) {
    if (conc.riskLevel === "extreme" || conc.riskLevel === "high")
      teamsWithHighConcentration.push(`${team} (${conc.riskLevel})`)
  }

  // Build validation details for each injured player
  const validationDetails: Record<string, { espn: string; props: string; verdict: string; reason: string }> = {}
  for (const [name, availability] of injuryCache.playerAvailability) {
    validationDetails[name] = {
      espn: availability.espnStatus,
      props: availability.oddsStatus,
      verdict: availability.finalVerdict,
      reason: availability.reasoning,
    }
  }

  return {
    lastUpdate: new Date(injuryCache.timestamp).toISOString(),
    teamsWithInjuries: injuryCache.injuries.size,
    totalInjuries,
    starPlayersOut,
    filteredFromProps: Array.from(injuryCache.allInjuredNames),
    playersReturning: Array.from(injuryCache.returningPlayers.values()).map(
      (p) => `${p.playerName} (game ${p.gamesSinceReturn})`,
    ),
    teamsWithHighConcentration,
    // 3-source validation summary
    threeSourceValidation: {
      espnInjuredCount: injuryCache.validationSummary.espnCount,
      // Removed BALLDONTLIE count
      // balldontlieInjuredCount: injuryCache.validationSummary.balldontlieCount,
      playersWithPropsCount: injuryCache.validationSummary.propsCount,
      agreedOut: injuryCache.validationSummary.agreedOut,
      agreedPlaying: injuryCache.validationSummary.agreedPlaying,
      uncertainDefaultedOut: injuryCache.validationSummary.uncertain,
      finalInjuredCount: injuryCache.allInjuredNames.size,
      validationDetails,
    },
    // Odds API cache status
    oddsPropsCache: {
      cached: oddsPropsCache !== null,
      ageSeconds: oddsPropsCache ? Math.round((Date.now() - oddsPropsCache.timestamp) / 1000) : null,
      playersCount: oddsPropsCache?.data.size || 0,
    },
    // Add quota status to summary
    oddsApiQuotaExceeded: oddsPropsCache?.quotaExceededUntil ? oddsPropsCache.quotaExceededUntil > Date.now() : false,
    oddsApiQuotaLockoutRemainingSeconds: oddsPropsCache?.quotaExceededUntil
      ? Math.max(0, Math.round((oddsPropsCache.quotaExceededUntil - Date.now()) / 1000))
      : 0,
    // Add BALLDONTLIE quota status to summary
    // Removed BALLDONTLIE specific checks
    // balldontlieApiUnavailable: balldontlieCache?.quotaExceededUntil ? balldontlieCache.quotaExceededUntil > Date.now() : false,
    // balldontlieApiLockoutRemainingSeconds: balldontlieCache?.quotaExceededUntil ? Math.max(0, Math.round((balldontlieCache.quotaExceededUntil - Date.now()) / 1000)) : 0,
    // balldontlieCacheAgeSeconds: balldontlieCache ? Math.round((Date.now() - balldontlieCache.timestamp) / 1000) : null,
    // balldontliePlayersCount: balldontlieCache?.data.size || 0,
  }
}

// ============ STAR CONCENTRATION AND IMPORTANCE CALCULATION ============

function calculateStarConcentration(players: any[], teamStats: any): StarConcentration {
  if (!players || players.length === 0) {
    return {
      tier1Count: 0,
      tier2Count: 0,
      topPlayerShare: 0,
      secondPlayerShare: 0,
      hasSecondaryStar: false,
      concentrationMultiplier: 1.0,
      riskLevel: "low",
      description: "No player data available",
    }
  }

  // Sort players by points to determine impact
  const sortedByPoints = [...players].sort((a, b) => (b.points || 0) - (a.points || 0))
  const totalTeamPoints = teamStats?.points || sortedByPoints.reduce((sum, p) => sum + (p.points || 0), 0) || 1

  const topPlayer = sortedByPoints[0]
  const secondPlayer = sortedByPoints.length > 1 ? sortedByPoints[1] : null

  const topPlayerShare = (topPlayer?.points || 0) / totalTeamPoints
  const secondPlayerShare = secondPlayer ? (secondPlayer.points || 0) / totalTeamPoints : 0

  // Count tier 1 and tier 2 players (players contributing significantly to team points)
  let tier1Count = 0
  let tier2Count = 0

  for (const player of sortedByPoints) {
    const share = (player.points || 0) / totalTeamPoints
    if (share >= 0.2)
      tier1Count++ // Top 20% of points contribution
    else if (share >= 0.15) tier2Count++ // Next 15% of points contribution
  }

  const hasSecondaryStar = secondPlayerShare >= 0.15

  // Determine risk level and multiplier based on star concentration
  let riskLevel: "low" | "medium" | "high" | "extreme"
  let concentrationMultiplier: number
  let description: string

  if (tier1Count === 1 && !hasSecondaryStar) {
    riskLevel = "extreme"
    concentrationMultiplier = STAR_CONCENTRATION_MULTIPLIERS.extreme
    description = `Single star (${Math.round(topPlayerShare * 100)}% of points), no backup`
  } else if (tier1Count === 1 && hasSecondaryStar) {
    riskLevel = "high"
    concentrationMultiplier = STAR_CONCENTRATION_MULTIPLIERS.high
    description = `Single star with decent #2 (${Math.round(secondPlayerShare * 100)}%)`
  } else if (tier1Count >= 2) {
    // Two or more tier 1 stars
    riskLevel = "medium"
    concentrationMultiplier = STAR_CONCENTRATION_MULTIPLIERS.medium
    description = `Multiple stars (${tier1Count} tier 1, ${tier2Count} tier 2 contributors)`
  } else {
    // Lower concentration of stars
    riskLevel = "low"
    concentrationMultiplier = STAR_CONCENTRATION_MULTIPLIERS.low
    description = `Balanced scoring (${tier1Count + tier2Count} contributors)`
  }

  return {
    tier1Count,
    tier2Count,
    topPlayerShare,
    secondPlayerShare,
    hasSecondaryStar,
    concentrationMultiplier,
    riskLevel,
    description,
  }
}

async function calculateGoalieImportance(playerStats: any, goalies: any[]): Promise<PlayerImportance> {
  const firstName = playerStats?.firstName?.default || playerStats?.firstName || ""
  const lastName = playerStats?.lastName?.default || playerStats?.lastName || ""
  const playerName = `${firstName} ${lastName}`.trim()

  // Sort goalies by games played to determine rank
  const sortedGoalies = [...goalies].sort((a, b) => (b.gamesPlayed || 0) - (a.gamesPlayed || 0))
  const toiRank = sortedGoalies.findIndex((g) => g.playerId === playerStats?.playerId) + 1

  // Calculate save percentage difference from league average (0.905)
  const savePct = playerStats?.savePctg || playerStats?.savePercentage || 0.905
  const savePctAboveAvg = savePct - 0.905

  // Starter goalies are more impactful
  const isStarter = toiRank === 1
  const gamesPlayed = playerStats?.gamesPlayed || 1 // Avoid division by zero

  // Calculate importance score based on performance and starter status
  let importanceScore = 0.5 // Base score
  if (isStarter) importanceScore += 0.3 // Starter bonus
  if (savePctAboveAvg > 0.01) importanceScore += 0.2 // Above average save percentage bonus
  if (gamesPlayed > 30) importanceScore += 0.1 // High games played bonus

  importanceScore = Math.min(1.0, importanceScore) // Cap at 1.0

  // Determine tier based on importance score thresholds
  let tier: 1 | 2 | 3 | 4 | 5
  if (importanceScore >= TIER_THRESHOLDS[1]) tier = 1
  else if (importanceScore >= TIER_THRESHOLDS[2]) tier = 2
  else if (importanceScore >= TIER_THRESHOLDS[3]) tier = 3
  else if (importanceScore >= TIER_THRESHOLDS[4]) tier = 4
  else tier = 5

  // Calculate win probability impact
  const maxImpact = MAX_WIN_PROB_IMPACT["G"]
  const winProbImpact = -(importanceScore * maxImpact * POSITION_VALUE["G"]) // Negative impact as injury reduces win prob

  return {
    playerId: playerStats?.playerId || "",
    playerName,
    team: playerStats?.team || "",
    position: "G",
    tier,
    importanceScore,
    pointsShare: 0, // Goalies don't typically have "points share" in the same way skaters do
    toiRank,
    ppTimeShare: 0, // Not relevant for goalies
    pkTimeShare: 0, // Not relevant for goalies
    goalsAboveExpected: savePctAboveAvg * gamesPlayed * 30, // Rough estimate of goals saved above league average
    winProbImpact,
    ppImpact: 0, // Not directly relevant for goalies
    pkImpact: winProbImpact * 0.3, // Goalies can affect PK performance indirectly
  }
}

async function calculatePlayerImportance(playerStats: any, teamStats: any, players: any[]): Promise<PlayerImportance> {
  const firstName = playerStats?.firstName?.default || playerStats?.firstName || ""
  const lastName = playerStats?.lastName?.default || playerStats?.lastName || ""
  const playerName = `${firstName} ${lastName}`.trim()
  const position = playerStats?.positionCode || "F"

  // Calculate total team points, fallback to sum of player points if teamStats.points is not available
  const totalTeamPoints = teamStats?.points || players.reduce((sum, p) => sum + (p.points || 0), 0) || 1
  const playerPoints = playerStats?.points || 0
  const pointsShare = totalTeamPoints > 0 ? playerPoints / totalTeamPoints : 0 // Prevent division by zero

  // Sort players by TOI to get rank
  const sortedByToi = [...players].sort((a, b) => (b.avgToi || 0) - (a.avgToi || 0))
  const toiRank = sortedByToi.findIndex((p) => p.playerId === playerStats?.playerId) + 1

  // Calculate PP and PK shares (estimate if not available)
  // These are rough estimations and could be improved with more detailed stats
  const ppTimeShare = playerStats?.powerPlayPoints ? (playerStats.powerPlayPoints / (playerPoints || 1)) * 0.3 : 0.1
  const pkTimeShare = position === "D" || position === "C" ? 0.15 : 0.05 // Higher for D/C

  // Goals above expected (simplified calculation)
  const gamesPlayed = playerStats?.gamesPlayed || 1 // Avoid division by zero
  const goalsPerGame = (playerStats?.goals || 0) / gamesPlayed
  const expectedGoalsPerGame = 0.15 // Approximate league average goals per skater per game
  const goalsAboveExpected = (goalsPerGame - expectedGoalsPerGame) * gamesPlayed

  // Calculate importance score
  let importanceScore = pointsShare * 2 // Base score from points share (weighted)
  if (toiRank <= 6) importanceScore += 0.15 // Bonus for top 6 TOI (forward or defense)
  if (position === "C") importanceScore += 0.05 // Slight bonus for centers
  if (position === "D") importanceScore += 0.1 // Higher bonus for defensemen due to role

  importanceScore = Math.min(1.0, importanceScore) // Cap importance score at 1.0

  // Determine tier based on importance score thresholds
  let tier: 1 | 2 | 3 | 4 | 5
  if (importanceScore >= TIER_THRESHOLDS[1]) tier = 1
  else if (importanceScore >= TIER_THRESHOLDS[2]) tier = 2
  else if (importanceScore >= TIER_THRESHOLDS[3]) tier = 3
  else if (importanceScore >= TIER_THRESHOLDS[4]) tier = 4
  else tier = 5

  // Calculate impacts
  const positionValue = POSITION_VALUE[position] || 1.0
  const maxImpact = MAX_WIN_PROB_IMPACT[position] || 0.05 // Max win prob impact for the position
  const winProbImpact = -(importanceScore * maxImpact * positionValue) // Negative impact as injury reduces win prob
  const ppImpact = -(ppTimeShare * importanceScore * 0.1) // Impact on power play (negative when injured)
  const pkImpact = -(pkTimeShare * importanceScore * 0.05) // Impact on penalty kill (negative when injured)

  return {
    playerId: playerStats?.playerId || "",
    playerName,
    team: playerStats?.team || "",
    position,
    tier,
    importanceScore,
    pointsShare,
    toiRank,
    ppTimeShare,
    pkTimeShare,
    goalsAboveExpected,
    winProbImpact,
    ppImpact,
    pkImpact,
  }
}
