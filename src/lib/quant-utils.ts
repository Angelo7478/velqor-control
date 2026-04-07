// ============================================
// Velqor Quant — Shared Utilities & Sizing Engine
// ============================================

// --- Formatting ---

export function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function fmtUsd(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined) return '—'
  const v = Number(n)
  const prefix = v >= 0 ? '' : '-'
  return `${prefix}$${Math.abs(v).toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

export function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined) return '—'
  return `${fmt(n, decimals)}%`
}

export function fmtLots(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toFixed(3)
}

export function fmtAlpha(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  const v = Number(n)
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

export function alphaColor(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'text-slate-400'
  return Number(n) >= 0 ? 'text-green-600' : 'text-red-500'
}

// Asset → Yahoo Finance label mapping
export const ASSET_BENCHMARK_LABEL: Record<string, string> = {
  'US500.cash': 'S&P 500',
  'US100.cash': 'Nasdaq',
  'GER40.cash': 'DAX',
  'BTCUSD': 'Bitcoin',
  'UKOIL.cash': 'Brent',
  'USDJPY': 'USD/JPY',
  'USDCAD': 'USD/CAD',
}

// --- Benchmark vs Strategy ---

export type MarketRegime = 'up' | 'down' | 'range'

export interface BenchmarkPoint {
  date: string        // YYYY-MM-DD
  stratReturn: number // strategy cumulative return %
  benchReturn: number // buy-and-hold return %
  alpha: number       // stratReturn - benchReturn
}

export interface RegimeZone {
  startDate: string
  endDate: string
  regime: MarketRegime
}

export interface RegimeStats {
  regime: MarketRegime
  label: string
  trades: number
  winRate: number
  avgTrade: number
  totalPl: number
}

/**
 * Build dual curve: strategy cumulative return % vs benchmark buy-and-hold return %.
 * Both normalized to 0% at the start date.
 */
export function buildStrategyVsBenchmark(
  trades: { net_profit: number; close_time: string }[],
  benchmarkPrices: { ts: string; close_price: number }[],
  accountSize: number,
): BenchmarkPoint[] {
  if (trades.length === 0 || benchmarkPrices.length === 0 || accountSize <= 0) return []

  const benchStart = Number(benchmarkPrices[0].close_price)
  if (benchStart === 0) return []

  // Build date→benchmark return map
  const benchMap = new Map<string, number>()
  for (const b of benchmarkPrices) {
    benchMap.set(b.ts, (Number(b.close_price) / benchStart - 1) * 100)
  }

  // Build strategy curve with daily resolution
  const points: BenchmarkPoint[] = []
  let cumPnl = 0
  let tradeIdx = 0

  for (const b of benchmarkPrices) {
    // Add trades that closed on or before this date
    while (tradeIdx < trades.length && trades[tradeIdx].close_time.slice(0, 10) <= b.ts) {
      cumPnl += trades[tradeIdx].net_profit
      tradeIdx++
    }
    const stratReturn = (cumPnl / accountSize) * 100
    const benchReturn = benchMap.get(b.ts) || 0
    points.push({
      date: b.ts,
      stratReturn: Math.round(stratReturn * 100) / 100,
      benchReturn: Math.round(benchReturn * 100) / 100,
      alpha: Math.round((stratReturn - benchReturn) * 100) / 100,
    })
  }

  // Process remaining trades after last benchmark date
  while (tradeIdx < trades.length) {
    cumPnl += trades[tradeIdx].net_profit
    tradeIdx++
  }
  if (trades.length > 0 && points.length > 0) {
    const lastPt = points[points.length - 1]
    lastPt.stratReturn = Math.round((cumPnl / accountSize) * 100 * 100) / 100
    lastPt.alpha = Math.round((lastPt.stratReturn - lastPt.benchReturn) * 100) / 100
  }

  return points
}

/**
 * Detect market regimes from daily close prices using SMA50/SMA200 crossover.
 * Returns zones of consecutive regime (up/down/range).
 */
export function detectMarketRegimes(prices: { ts: string; close_price: number }[]): RegimeZone[] {
  if (prices.length < 50) return [] // need at least 50 days for SMA50

  const closes = prices.map(p => Number(p.close_price))

  // Calculate SMAs
  function sma(data: number[], period: number, idx: number): number | null {
    if (idx < period - 1) return null
    let sum = 0
    for (let i = idx - period + 1; i <= idx; i++) sum += data[i]
    return sum / period
  }

  const zones: RegimeZone[] = []
  let currentRegime: MarketRegime | null = null
  let zoneStart = ''

  for (let i = 0; i < closes.length; i++) {
    const sma50 = sma(closes, 50, i)
    const sma200 = sma(closes, 200, i)
    const close = closes[i]

    let regime: MarketRegime = 'range'
    if (sma50 !== null && sma200 !== null) {
      if (close > sma50 && sma50 > sma200) regime = 'up'
      else if (close < sma50 && sma50 < sma200) regime = 'down'
    } else if (sma50 !== null) {
      // Only SMA50 available (days 50-199)
      regime = close > sma50 ? 'up' : close < sma50 ? 'down' : 'range'
    }

    if (regime !== currentRegime) {
      if (currentRegime !== null && zoneStart) {
        zones[zones.length - 1].endDate = prices[i - 1].ts
      }
      currentRegime = regime
      zoneStart = prices[i].ts
      zones.push({ startDate: zoneStart, endDate: prices[i].ts, regime })
    } else {
      zones[zones.length - 1].endDate = prices[i].ts
    }
  }

  return zones
}

/**
 * Calculate strategy performance breakdown by market regime.
 */
export function calcPerRegimeStats(
  trades: { net_profit: number; close_time: string }[],
  regimes: RegimeZone[],
): RegimeStats[] {
  const labels: Record<MarketRegime, string> = { up: 'Trend Up', down: 'Trend Down', range: 'Range' }
  const buckets: Record<MarketRegime, { trades: number[]; }> = {
    up: { trades: [] }, down: { trades: [] }, range: { trades: [] },
  }

  for (const t of trades) {
    const tDate = t.close_time.slice(0, 10)
    // Find which regime this trade falls in
    let matched: MarketRegime = 'range'
    for (const z of regimes) {
      if (tDate >= z.startDate && tDate <= z.endDate) {
        matched = z.regime
        break
      }
    }
    buckets[matched].trades.push(t.net_profit)
  }

  const result: RegimeStats[] = []
  for (const regime of ['up', 'down', 'range'] as MarketRegime[]) {
    const trs = buckets[regime].trades
    if (trs.length === 0) continue
    const wins = trs.filter(p => p > 0).length
    result.push({
      regime,
      label: labels[regime],
      trades: trs.length,
      winRate: Math.round((wins / trs.length) * 1000) / 10,
      avgTrade: Math.round(trs.reduce((s, v) => s + v, 0) / trs.length * 100) / 100,
      totalPl: Math.round(trs.reduce((s, v) => s + v, 0) * 100) / 100,
    })
  }
  return result
}

export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Mai sincronizzato'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Ora'
  if (mins < 60) return `${mins}min fa`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h fa`
  return `${Math.floor(hours / 24)}g fa`
}

// --- Color helpers ---

export function plColor(n: number): string {
  if (n > 0) return 'text-green-600'
  if (n < 0) return 'text-red-600'
  return 'text-slate-500'
}

export function ddBarColor(pct: number): string {
  if (pct > 8) return 'bg-red-500'
  if (pct > 5) return 'bg-amber-500'
  if (pct > 3) return 'bg-yellow-500'
  return 'bg-green-500'
}

export function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-amber-100 text-amber-700',
    retired: 'bg-slate-100 text-slate-500',
    testing: 'bg-blue-100 text-blue-700',
    candidate: 'bg-violet-100 text-violet-700',
    inactive: 'bg-slate-100 text-slate-500',
    funded: 'bg-emerald-100 text-emerald-700',
    challenge: 'bg-blue-100 text-blue-700',
    verification: 'bg-amber-100 text-amber-700',
    breached: 'bg-red-100 text-red-700',
    payout: 'bg-green-100 text-green-700',
  }
  return colors[status] || 'bg-slate-100 text-slate-500'
}

export function groupColor(group: string | null): string {
  const colors: Record<string, string> = {
    INDICI_US: 'bg-blue-100 text-blue-700',
    SP500: 'bg-indigo-100 text-indigo-700',
    BTC: 'bg-orange-100 text-orange-700',
    DAX: 'bg-emerald-100 text-emerald-700',
    OIL: 'bg-amber-100 text-amber-700',
    FX: 'bg-cyan-100 text-cyan-700',
  }
  return colors[group || ''] || 'bg-slate-100 text-slate-500'
}

export function styleColor(style: string | null): string {
  const colors: Record<string, string> = {
    mean_reversion: 'bg-indigo-100 text-indigo-700',
    trend_following: 'bg-emerald-100 text-emerald-700',
    seasonal: 'bg-amber-100 text-amber-700',
    breakout: 'bg-rose-100 text-rose-700',
    hybrid: 'bg-slate-100 text-slate-600',
  }
  return colors[style || ''] || 'bg-slate-100 text-slate-500'
}

export function styleLabel(style: string | null): string {
  const labels: Record<string, string> = {
    mean_reversion: 'Mean Rev',
    trend_following: 'Trend',
    seasonal: 'Seasonal',
    breakout: 'Breakout',
    hybrid: 'Hybrid',
  }
  return labels[style || ''] || style || '—'
}

export function fitnessColor(score: number): string {
  if (score >= 70) return 'text-green-600'
  if (score >= 40) return 'text-amber-600'
  return 'text-red-600'
}

export function fitnessLabel(score: number): string {
  if (score >= 70) return 'Healthy'
  if (score >= 40) return 'Warning'
  return 'Critical'
}

// --- Sizing Calculations (Pure functions) ---

/** Kelly criterion: f* = W - (1-W)/R */
export function calcKelly(winPct: number, payoff: number): number | null {
  if (!payoff || payoff === 0 || !winPct) return null
  const w = winPct / 100
  return w - (1 - w) / payoff
}

/** Half-Kelly: f divided by 2 */
export function calcHalfKelly(winPct: number, payoff: number): number | null {
  const k = calcKelly(winPct, payoff)
  return k !== null ? k / 2 : null
}

/** Quarter-Kelly: f divided by 4 */
export function calcQuarterKelly(winPct: number, payoff: number): number | null {
  const k = calcKelly(winPct, payoff)
  return k !== null ? k / 4 : null
}

/** Risk of Ruin adapted for prop firm (G = ruin_pct, not 100%) */
export function calcRiskOfRuin(winPct: number, payoff: number, riskFraction: number, ruinPct = 10): number | null {
  if (!winPct || !payoff || !riskFraction || riskFraction === 0) return null
  const w = winPct / 100
  const l = 1 - w
  if (w === 0) return 1
  if (l === 0) return 0
  const a = l / w
  let units = ruinPct / (riskFraction * 100)
  if (units < 1) units = 1
  return Math.pow(a, units)
}

/** Convert Kelly fraction to lots given account equity and DD per lot */
export function kellyToLots(kellyF: number, equity: number, ddPerLot: number): number {
  if (!ddPerLot || ddPerLot === 0) return 0
  const rawLots = (kellyF * equity) / ddPerLot
  return Math.floor(rawLots * 100) / 100 // floor to 0.01
}

/** Volatility-adjusted lots: scale by target vol / strategy vol */
export function volAdjustedLots(baseLots: number, strategyVol: number, targetVol: number): number {
  if (!strategyVol || strategyVol === 0) return baseLots
  return Math.floor((baseLots * targetVol / strategyVol) * 100) / 100
}

/**
 * Strategy fitness score (0-100%)
 *
 * Institutional approach: score starts at 100% and applies graduated
 * deductions based on how real performance deviates from backtest.
 * Accounts for sample size (slow strategies with few trades get a
 * confidence-weighted score, NOT a flat penalty).
 *
 * Thresholds are calibrated for prop firm CFD trading with
 * 6-12 month track records and ~10-100 trades per strategy.
 *
 * Components (weights):
 * - Win rate consistency:  25% weight
 * - DD containment:        30% weight (most critical for prop firm)
 * - Expectancy consistency: 25% weight
 * - Payoff stability:      10% weight
 * - Sample confidence:     10% weight (bonus for large samples)
 */
export function calcFitnessScore(strategy: {
  test_win_pct: number | null
  test_payoff: number | null
  test_max_dd: number | null
  test_expectancy: number | null
  real_win_pct: number | null
  real_payoff: number | null
  real_max_dd: number | null
  real_expectancy: number | null
  real_trades: number
  // Lot normalization: test DD was at test_lot, real DD at avg_real_lot
  test_lot?: number | null
  avg_real_lot?: number | null
}): { score: number; details: Record<string, number>; confidence: number } {
  const { real_trades } = strategy
  const details: Record<string, number> = {}

  // No real trades at all: no data to judge
  if (real_trades === 0) return { score: 0, details: { no_data: 1 }, confidence: 0 }

  // Sample confidence: logarithmic curve, reaches ~80% at 15 trades, ~95% at 50
  const confidence = Math.min(Math.log(real_trades + 1) / Math.log(60), 1.0)
  details.confidence = Math.round(confidence * 100)
  details.real_trades = real_trades

  let componentScore = 0
  let componentWeightUsed = 0

  // --- Win rate consistency (25%) ---
  if (strategy.test_win_pct && strategy.real_win_pct) {
    const deviation = ((strategy.real_win_pct - strategy.test_win_pct) / strategy.test_win_pct) * 100
    details.win_pct_dev = Math.round(deviation * 10) / 10

    let winScore: number
    if (Math.abs(deviation) <= 5) winScore = 100       // within 5%: perfect
    else if (Math.abs(deviation) <= 10) winScore = 85   // within 10%: good
    else if (Math.abs(deviation) <= 15) winScore = 70   // within 15%: acceptable
    else if (Math.abs(deviation) <= 25) winScore = 45   // within 25%: concerning
    else if (deviation < -25) winScore = 20             // over 25% worse: problem
    else winScore = 90                                  // over 25% better: good but suspicious

    componentScore += winScore * 0.25
    componentWeightUsed += 0.25
  }

  // --- DD containment (30%) — Most critical for FTMO ---
  // NORMALIZE DD by lot size: test DD was at test_lot, real DD at avg_real_lot
  if (strategy.test_max_dd && strategy.real_max_dd) {
    let normalizedTestDd = strategy.test_max_dd
    if (strategy.test_lot && strategy.avg_real_lot && strategy.test_lot > 0) {
      normalizedTestDd = strategy.test_max_dd * (strategy.avg_real_lot / strategy.test_lot)
    }
    const ratio = normalizedTestDd > 0 ? strategy.real_max_dd / normalizedTestDd : 1
    details.dd_ratio = Math.round(ratio * 100) / 100

    let ddScore: number
    if (ratio <= 0.5) ddScore = 100       // real DD < half test: excellent
    else if (ratio <= 0.8) ddScore = 95   // real DD under test: great
    else if (ratio <= 1.0) ddScore = 85   // at test level: good
    else if (ratio <= 1.3) ddScore = 65   // 30% over: watch closely
    else if (ratio <= 1.5) ddScore = 40   // 50% over: concerning
    else if (ratio <= 2.0) ddScore = 20   // double: near suspension
    else ddScore = 5                      // over 2x: suspend

    componentScore += ddScore * 0.30
    componentWeightUsed += 0.30
  }

  // --- Expectancy consistency (25%) ---
  if (strategy.test_expectancy && strategy.real_expectancy) {
    const deviation = ((strategy.real_expectancy - strategy.test_expectancy) / Math.abs(strategy.test_expectancy)) * 100
    details.exp_dev = Math.round(deviation * 10) / 10

    let expScore: number
    if (deviation >= -10) expScore = 95   // at or above test: great
    else if (deviation >= -25) expScore = 75
    else if (deviation >= -50) expScore = 50
    else if (deviation >= -75) expScore = 25
    else expScore = 10                    // lost most edge

    componentScore += expScore * 0.25
    componentWeightUsed += 0.25
  }

  // --- Payoff stability (10%) ---
  if (strategy.test_payoff && strategy.real_payoff) {
    const deviation = ((strategy.real_payoff - strategy.test_payoff) / strategy.test_payoff) * 100
    details.payoff_dev = Math.round(deviation * 10) / 10

    let payoffScore: number
    if (Math.abs(deviation) <= 15) payoffScore = 95
    else if (Math.abs(deviation) <= 30) payoffScore = 75
    else if (deviation < -30) payoffScore = 40
    else payoffScore = 85 // better payoff is fine

    componentScore += payoffScore * 0.10
    componentWeightUsed += 0.10
  }

  // --- Sample confidence bonus (10%) ---
  const sampleScore = confidence * 100
  componentScore += sampleScore * 0.10
  componentWeightUsed += 0.10

  // Normalize if not all components available
  let rawScore = componentWeightUsed > 0 ? componentScore / componentWeightUsed : 50

  // Apply confidence weighting: blend raw score with neutral (60%) based on confidence
  // At 1 trade: mostly neutral. At 50+ trades: fully trust the score.
  const neutralScore = 60
  const finalScore = Math.round(rawScore * confidence + neutralScore * (1 - confidence))

  return { score: Math.max(0, Math.min(100, finalScore)), details, confidence: Math.round(confidence * 100) }
}

/**
 * Pendulum state: context-aware size multiplier.
 *
 * The pure Pendulum Effect says: reduce at highs, increase in DD.
 * But that's too defensive for strategies that are outperforming.
 *
 * Context-aware approach:
 * - At peak + outperforming → 1.0x (KEEP full size, edge is strong)
 * - At peak + underperforming → 0.8x (defensive, DD likely)
 * - In drawdown + validated edge → 1.2-1.3x (mean reversion bet)
 * - In drawdown + unvalidated → 1.0x (don't increase on broken strategy)
 *
 * The `isOutperforming` flag comes from the health report:
 * true if real expectancy > 0 AND real P/L > 0
 */
export function detectPendulumState(
  consecLosses: number,
  cumulativePnl: number,
  equityPeak: number,
  isOutperforming: boolean = false,
): { state: 'base' | 'drawdown' | 'recovery'; ddFromPeak: number; multiplier: number } {
  const ddFromPeak = equityPeak > 0 ? ((equityPeak - cumulativePnl) / equityPeak) * 100 : 0

  let state: 'base' | 'drawdown' | 'recovery' = 'base'
  let multiplier = 1.0

  if (ddFromPeak < 1 && consecLosses === 0) {
    // At or near equity high
    state = 'base'
    if (isOutperforming) {
      multiplier = 1.0 // Edge is working → keep full size
    } else {
      multiplier = 0.85 // Underperforming at peak → slight reduction
    }
  } else if (consecLosses >= 3 || ddFromPeak > 5) {
    // In significant drawdown
    state = 'drawdown'
    if (isOutperforming) {
      // Edge is validated but in temporary DD → increase (pendulum)
      multiplier = 1.0 + Math.min(consecLosses * 0.1, 0.3) // max 1.3x
    } else {
      // Edge not validated → don't increase on potentially broken strategy
      multiplier = 1.0
    }
  } else if (ddFromPeak > 1) {
    state = 'recovery'
    multiplier = 1.0 + Math.min(ddFromPeak / 15, 0.1) // gentle increase, max 1.1x
  } else {
    state = 'base'
    multiplier = 1.0
  }

  return { state, ddFromPeak: Math.round(ddFromPeak * 100) / 100, multiplier: Math.round(multiplier * 100) / 100 }
}

/**
 * Full health report for a strategy.
 * Combines: fitness score + pendulum state + decommissioning check.
 *
 * Decommissioning thresholds:
 * - SUSPEND: real DD > 2x test DD AND confidence > 60%
 * - WARNING: real DD > 1.5x test DD OR win rate deviation > 25%
 * - REGIME: strategy may be in wrong market regime (not broken)
 */
export interface HealthReport {
  strategyId: string
  magic: number
  name: string
  family: string | null

  // Fitness
  fitnessScore: number
  fitnessConfidence: number

  // Pendulum
  pendulumState: 'base' | 'drawdown' | 'recovery'
  pendulumMultiplier: number
  consecLosses: number
  ddFromPeak: number
  cumulativePnl: number
  equityPeak: number

  // Health status
  healthScore: number
  healthStatus: 'healthy' | 'warning' | 'critical' | 'regime_mismatch' | 'insufficient_data'
  recommendation: string
  flags: string[]
}

export function calcHealthReport(strategy: {
  id: string
  magic: number
  name: string | null
  strategy_family: string | null
  strategy_style: string | null
  test_win_pct: number | null
  test_payoff: number | null
  test_max_dd: number | null
  test_expectancy: number | null
  test_max_consec_loss: number | null
  lot_static: number | null
  real_trades: number
  real_win_pct: number | null
  real_payoff: number | null
  real_max_dd: number
  real_expectancy: number | null
  real_pl: number
}, liveData: {
  avgRealLot: number | null
  consecLosses: number
  cumulativePnl: number
  equityPeak: number
  recentWinPct: number | null
  avgTrade: number | null
  totalTrades: number
}): HealthReport {
  const flags: string[] = []

  // 1. Fitness score (with lot normalization for DD)
  const fitness = calcFitnessScore({
    test_win_pct: strategy.test_win_pct,
    test_payoff: strategy.test_payoff,
    test_max_dd: strategy.test_max_dd,
    test_expectancy: strategy.test_expectancy,
    real_win_pct: strategy.real_win_pct,
    real_payoff: strategy.real_payoff,
    real_max_dd: strategy.real_max_dd,
    real_expectancy: strategy.real_expectancy,
    real_trades: strategy.real_trades,
    test_lot: strategy.lot_static,
    avg_real_lot: liveData.avgRealLot,
  })

  // 2. Determine if strategy is outperforming (for pendulum context)
  const isOutperforming = (
    strategy.real_pl > 0 &&
    (strategy.real_expectancy === null || strategy.real_expectancy >= 0) &&
    (strategy.real_win_pct === null || strategy.test_win_pct === null ||
     strategy.real_win_pct >= strategy.test_win_pct * 0.85) // within 15% of test
  )

  // 3. Pendulum (context-aware)
  const pendulum = detectPendulumState(
    liveData.consecLosses,
    liveData.cumulativePnl,
    liveData.equityPeak,
    isOutperforming,
  )

  // 4. Health assessment with outperformance bonus
  let healthScore = fitness.score
  let healthStatus: HealthReport['healthStatus'] = 'healthy'
  let recommendation = 'Operativa normale'

  // Insufficient data
  if (strategy.real_trades < 5) {
    healthStatus = 'insufficient_data'
    recommendation = 'Dati insufficienti — monitorare'
    flags.push('early_stage')
  } else {
    // Check outperformance first — this can OVERRIDE DD concerns
    const wrBetter = strategy.test_win_pct && strategy.real_win_pct !== null
      ? strategy.real_win_pct > strategy.test_win_pct
      : false
    const expBetter = strategy.test_expectancy && strategy.real_expectancy !== null
      ? strategy.real_expectancy > strategy.test_expectancy
      : false
    const plPositive = strategy.real_pl > 0

    if (wrBetter && plPositive) {
      flags.push('outperforming')
      healthScore = Math.max(healthScore, 65) // minimum 65 if outperforming
    }

    // DD breach check — NORMALIZED by lot size
    let normalizedTestDd = strategy.test_max_dd ?? 0
    if (strategy.lot_static && liveData.avgRealLot && strategy.lot_static > 0) {
      normalizedTestDd = (strategy.test_max_dd ?? 0) * (liveData.avgRealLot / strategy.lot_static)
    }

    if (normalizedTestDd > 0 && strategy.real_max_dd > normalizedTestDd * 2 && fitness.confidence > 60) {
      if (isOutperforming) {
        // Outperforming but DD high → warning, not critical (DD may be from sizing, not broken edge)
        healthScore = Math.min(healthScore, 50)
        healthStatus = 'warning'
        flags.push('dd_elevated')
        recommendation = 'DD elevato ma P/L positivo. Verificare se il DD è da sizing diversa.'
      } else {
        healthScore = Math.min(healthScore, 25)
        healthStatus = 'critical'
        flags.push('dd_breach_2x')
        recommendation = 'DD reale > 2x test con P/L negativo. Candidata alla sospensione.'
      }
    } else if (normalizedTestDd > 0 && strategy.real_max_dd > normalizedTestDd * 1.5) {
      if (isOutperforming) {
        flags.push('dd_above_test')
      } else {
        healthScore = Math.min(healthScore, 45)
        healthStatus = 'warning'
        flags.push('dd_breach_1_5x')
      }
    }

    // Win rate change (not "collapse" — could be improvement)
    if (strategy.test_win_pct && strategy.real_win_pct !== null) {
      const wrDev = ((strategy.real_win_pct - strategy.test_win_pct) / strategy.test_win_pct) * 100
      if (wrDev < -30 && fitness.confidence > 50 && !isOutperforming) {
        flags.push('win_rate_drop')
        if (healthStatus === 'healthy') healthStatus = 'warning'
      } else if (wrDev > 15) {
        flags.push('win_rate_improved')
      }
    }

    // Expectancy negative
    if (strategy.real_expectancy !== null && strategy.real_expectancy < 0 && strategy.real_trades >= 15) {
      flags.push('negative_expectancy')
      if (healthStatus === 'healthy') healthStatus = 'warning'
      recommendation = 'Expectancy negativa. Monitorare.'
    }

    // Regime mismatch (trend strategies with negative expectancy)
    if (strategy.strategy_style === 'trend_following' && strategy.real_expectancy !== null && strategy.real_expectancy < 0) {
      healthStatus = 'regime_mismatch'
      recommendation = 'Regime mismatch — strategia trend in mercato laterale. Mantenere attiva per validazione.'
      flags.push('regime_mismatch')
    }

    // Consecutive losses alert
    if (liveData.consecLosses >= 5) {
      flags.push('high_consec_losses')
      if (healthStatus === 'healthy') healthStatus = 'warning'
    }

    // Strong performance summary
    if (healthStatus === 'healthy' && isOutperforming) {
      recommendation = 'Edge attivo e confermato. Performance superiori ai test.'
    } else if (healthStatus === 'healthy') {
      recommendation = 'Performance in linea con i test. Continuare.'
    }
  }

  return {
    strategyId: strategy.id,
    magic: strategy.magic,
    name: strategy.name || `Magic ${strategy.magic}`,
    family: strategy.strategy_family,
    fitnessScore: fitness.score,
    fitnessConfidence: fitness.confidence,
    pendulumState: pendulum.state,
    pendulumMultiplier: pendulum.multiplier,
    consecLosses: liveData.consecLosses,
    ddFromPeak: pendulum.ddFromPeak,
    cumulativePnl: liveData.cumulativePnl,
    equityPeak: liveData.equityPeak,
    healthScore,
    healthStatus,
    recommendation,
    flags,
  }
}

// --- Portfolio-Level Calculations ---

export interface SizingInput {
  strategyId: string
  magic: number
  name: string
  asset: string
  assetGroup: string | null
  style: string | null
  family: string | null
  testWinPct: number | null
  testPayoff: number | null
  testMc95Dd: number | null
  mc95DdScaled: number | null
  testExpectancy: number | null
  testMaxDd: number | null
  realTrades: number
  realWinPct: number | null
  realPayoff: number | null
  realMaxDd: number
  realExpectancy: number | null
  realPl: number
  lotNeutral: number | null
  overlapMed: number | null
}

export interface SizingResult {
  strategyId: string
  kellyF: number | null
  halfKelly: number | null
  quarterKelly: number | null
  rorPct: number | null
  ddBudgetPct: number
  ddBudgetUsd: number
  hrpWeight: number | null
  family: string | null
  recommendedLots: number
  currentLots: number | null
  lotsChangePct: number | null
  fitnessScore: number
  fitnessDetails: Record<string, number>
  fractionMethod: string
}

export interface PortfolioSizingOutput {
  totalDdBudgetUsedPct: number
  totalDdBudgetUsedUsd: number
  ddBudgetAvailableUsd: number
  strategyCount: number
  familyCount: number
  avgRor: number | null
  styleBalance: Record<string, number>
  familyBalance: Record<string, { weight: number; strategies: number }>
  results: SizingResult[]
}

/**
 * Main sizing engine v2: family-aware HRP + Kelly sizing.
 *
 * Flow:
 * 1. Per-strategy: Kelly/Half-Kelly, RoR, fitness
 * 2. HRP: allocate DD budget across FAMILIES (inverse variance),
 *    then split equally within each family
 * 3. Convert budget to lots via MC95 DD
 * 4. RoR cap + FTMO budget constraint
 */
export function runSizingEngine(
  strategies: SizingInput[],
  equityBase: number,
  maxDdTargetPct: number,
  safetyFactor: number,
  kellyMode: 'half_kelly' | 'quarter_kelly' | 'full_kelly' = 'half_kelly'
): PortfolioSizingOutput {
  const ddBudgetUsd = equityBase * (maxDdTargetPct / 100) * safetyFactor
  const results: SizingResult[] = []
  const styleCount: Record<string, number> = {}

  // Step 1: Calculate Kelly and fitness per strategy
  for (const s of strategies) {
    const useReal = s.realTrades >= 30
    const winPct = useReal ? (s.realWinPct ?? s.testWinPct) : s.testWinPct
    const payoff = useReal ? (s.realPayoff ?? s.testPayoff) : s.testPayoff

    const kellyF = winPct && payoff ? calcKelly(winPct, payoff) : null
    const halfKelly = winPct && payoff ? calcHalfKelly(winPct, payoff) : null
    const quarterKelly = winPct && payoff ? calcQuarterKelly(winPct, payoff) : null

    let chosenFraction: number | null = null
    if (kellyMode === 'half_kelly') chosenFraction = halfKelly
    else if (kellyMode === 'quarter_kelly') chosenFraction = quarterKelly
    else chosenFraction = kellyF

    const rorPct = (chosenFraction && winPct && payoff)
      ? calcRiskOfRuin(winPct, payoff, chosenFraction, maxDdTargetPct)
      : null

    const fitnessResult = calcFitnessScore({
      test_win_pct: s.testWinPct,
      test_payoff: s.testPayoff,
      test_max_dd: s.testMaxDd,
      test_expectancy: s.testExpectancy,
      real_win_pct: s.realWinPct,
      real_payoff: s.realPayoff,
      real_max_dd: s.realMaxDd,
      real_expectancy: s.realExpectancy,
      real_trades: s.realTrades,
    })

    if (s.style) styleCount[s.style] = (styleCount[s.style] || 0) + 1

    results.push({
      strategyId: s.strategyId,
      kellyF,
      halfKelly,
      quarterKelly,
      rorPct,
      ddBudgetPct: 0,
      ddBudgetUsd: 0,
      hrpWeight: null,
      family: s.family,
      recommendedLots: 0,
      currentLots: s.lotNeutral,
      lotsChangePct: null,
      fitnessScore: fitnessResult.score,
      fitnessDetails: fitnessResult.details,
      fractionMethod: kellyMode,
    })
  }

  // Step 2: HRP family-aware DD budget allocation
  const hrpWeights = calcHRPWeights(
    strategies.map(s => ({
      id: s.strategyId,
      family: s.family,
      mc95Dd: s.mc95DdScaled ?? s.testMc95Dd ?? 0,
    }))
  )

  const familyBalance: Record<string, { weight: number; strategies: number }> = {}

  for (let i = 0; i < strategies.length; i++) {
    const s = strategies[i]
    const r = results[i]
    const mc95 = s.mc95DdScaled ?? s.testMc95Dd ?? 0
    const hrpW = hrpWeights.get(s.strategyId) || (1 / strategies.length)

    r.hrpWeight = hrpW
    r.ddBudgetPct = hrpW * 100
    r.ddBudgetUsd = ddBudgetUsd * hrpW

    // Track family balance
    const fam = s.family || `solo_${s.magic}`
    if (!familyBalance[fam]) familyBalance[fam] = { weight: 0, strategies: 0 }
    familyBalance[fam].weight += hrpW * 100
    familyBalance[fam].strategies++

    // Lots from DD budget
    if (mc95 > 0) {
      r.recommendedLots = Math.floor((r.ddBudgetUsd / mc95) * 100) / 100
    }

    // RoR cap
    if (r.rorPct !== null && r.rorPct > 0.05) {
      r.recommendedLots = Math.floor(r.recommendedLots * 0.9 * 100) / 100
    }

    // Min lot
    if (r.recommendedLots < 0.01) r.recommendedLots = 0.01

    // Change %
    if (r.currentLots && r.currentLots > 0) {
      r.lotsChangePct = ((r.recommendedLots - r.currentLots) / r.currentLots) * 100
    }
  }

  // Round family weights
  for (const fam of Object.keys(familyBalance)) {
    familyBalance[fam].weight = Math.round(familyBalance[fam].weight * 10) / 10
  }

  // Step 3: Verify total DD fits budget
  let totalDdUsed = 0
  for (let i = 0; i < strategies.length; i++) {
    const mc95 = strategies[i].mc95DdScaled ?? strategies[i].testMc95Dd ?? 0
    totalDdUsed += results[i].recommendedLots * mc95
  }

  if (totalDdUsed > ddBudgetUsd && ddBudgetUsd > 0) {
    const scaleFactor = ddBudgetUsd / totalDdUsed
    for (const r of results) {
      r.recommendedLots = Math.floor(r.recommendedLots * scaleFactor * 100) / 100
      if (r.recommendedLots < 0.01) r.recommendedLots = 0.01
    }
    totalDdUsed = 0
    for (let i = 0; i < strategies.length; i++) {
      const mc95 = strategies[i].mc95DdScaled ?? strategies[i].testMc95Dd ?? 0
      totalDdUsed += results[i].recommendedLots * mc95
    }
  }

  // Style balance
  const totalStrats = strategies.length
  const styleBalance: Record<string, number> = {}
  for (const [style, count] of Object.entries(styleCount)) {
    styleBalance[style] = Math.round((count / totalStrats) * 100)
  }

  // Count unique families
  const uniqueFamilies = new Set(strategies.map(s => s.family || `solo_${s.magic}`))

  // Avg RoR
  const rors = results.filter(r => r.rorPct !== null).map(r => r.rorPct!)
  const avgRor = rors.length > 0 ? rors.reduce((a, b) => a + b, 0) / rors.length : null

  return {
    totalDdBudgetUsedPct: ddBudgetUsd > 0 ? (totalDdUsed / ddBudgetUsd) * 100 : 0,
    totalDdBudgetUsedUsd: Math.round(totalDdUsed * 100) / 100,
    ddBudgetAvailableUsd: Math.round((ddBudgetUsd - totalDdUsed) * 100) / 100,
    strategyCount: strategies.length,
    familyCount: uniqueFamilies.size,
    avgRor,
    styleBalance,
    familyBalance,
    results,
  }
}

// --- Correlation & HRP ---

export interface DailyPnl {
  strategyId: string
  date: string
  pnl: number
}

export interface CorrelationEntry {
  strategyAId: string
  strategyBId: string
  correlation: number
  sampleDays: number
}

/**
 * Compute Pearson correlation between two P/L series.
 * Only uses overlapping dates. Returns null if < 5 overlapping days.
 */
export function pearsonCorrelation(seriesA: Map<string, number>, seriesB: Map<string, number>): { corr: number | null; overlap: number } {
  const commonDates: string[] = []
  for (const date of seriesA.keys()) {
    if (seriesB.has(date)) commonDates.push(date)
  }

  if (commonDates.length < 5) return { corr: null, overlap: commonDates.length }

  const a = commonDates.map(d => seriesA.get(d)!)
  const b = commonDates.map(d => seriesB.get(d)!)
  const n = a.length

  const meanA = a.reduce((s, v) => s + v, 0) / n
  const meanB = b.reduce((s, v) => s + v, 0) / n

  let cov = 0, varA = 0, varB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }

  const denom = Math.sqrt(varA * varB)
  if (denom === 0) return { corr: 0, overlap: n }

  return { corr: Math.round((cov / denom) * 10000) / 10000, overlap: n }
}

/**
 * Build pairwise correlation matrix from daily P/L data.
 * Uses statistical correlation where enough data, family-based
 * assumptions where not.
 *
 * Family assumptions:
 * - Same family (e.g. RSI2_SP500 variants): 0.75
 * - Same style, different family: 0.30
 * - Different style: -0.10
 */
export function buildCorrelationMatrix(
  dailyPnl: DailyPnl[],
  strategies: { id: string; family: string | null; style: string | null }[],
  minOverlap = 10
): CorrelationEntry[] {
  // Build per-strategy date->pnl maps
  const seriesMap = new Map<string, Map<string, number>>()
  for (const dp of dailyPnl) {
    if (!seriesMap.has(dp.strategyId)) seriesMap.set(dp.strategyId, new Map())
    const m = seriesMap.get(dp.strategyId)!
    m.set(dp.date, (m.get(dp.date) ?? 0) + dp.pnl)
  }

  const results: CorrelationEntry[] = []
  const stratMap = new Map(strategies.map(s => [s.id, s]))

  for (let i = 0; i < strategies.length; i++) {
    for (let j = i + 1; j < strategies.length; j++) {
      const a = strategies[i]
      const b = strategies[j]
      const seriesA = seriesMap.get(a.id)
      const seriesB = seriesMap.get(b.id)

      let corr: number
      let sampleDays: number

      if (seriesA && seriesB) {
        const result = pearsonCorrelation(seriesA, seriesB)
        if (result.corr !== null && result.overlap >= minOverlap) {
          corr = result.corr
          sampleDays = result.overlap
        } else {
          // Fallback to family-based assumption
          corr = assumedCorrelation(a.family, a.style, b.family, b.style)
          sampleDays = result.overlap
        }
      } else {
        corr = assumedCorrelation(a.family, a.style, b.family, b.style)
        sampleDays = 0
      }

      results.push({ strategyAId: a.id, strategyBId: b.id, correlation: corr, sampleDays })
    }
  }

  return results
}

/** Family-based correlation assumption when insufficient data */
function assumedCorrelation(familyA: string | null, styleA: string | null, familyB: string | null, styleB: string | null): number {
  // Same family = highly correlated (same edge, same asset)
  if (familyA && familyB && familyA === familyB) return 0.75
  // Same style, different family = moderate positive
  if (styleA && styleB && styleA === styleB) return 0.30
  // Mean reversion vs trend following = negatively correlated
  if ((styleA === 'mean_reversion' && styleB === 'trend_following') ||
      (styleA === 'trend_following' && styleB === 'mean_reversion')) return -0.15
  // Seasonal vs others = low correlation
  if (styleA === 'seasonal' || styleB === 'seasonal') return 0.10
  // Default
  return 0.20
}

/**
 * Family-aware HRP (Hierarchical Risk Parity).
 *
 * Simplified 2-level approach:
 * Level 1: Allocate budget across FAMILIES inversely proportional to
 *          family aggregate variance (sum of MC95 DDs)
 * Level 2: Within each family, allocate equally among active strategies
 *
 * This ensures RSI2_SP500 (5 variants) gets ~1 family allocation,
 * not 5x a single-strategy family.
 */
export function calcHRPWeights(
  strategies: { id: string; family: string | null; mc95Dd: number }[]
): Map<string, number> {
  // Group by family
  const families = new Map<string, { ids: string[]; totalMc95: number }>()
  for (const s of strategies) {
    const fam = s.family || `solo_${s.id}`
    if (!families.has(fam)) families.set(fam, { ids: [], totalMc95: 0 })
    const f = families.get(fam)!
    f.ids.push(s.id)
    f.totalMc95 += s.mc95Dd
  }

  // Level 1: Inverse-variance across families
  // Use 1/totalMc95 as proxy for inverse variance
  let totalInvVar = 0
  const familyWeights = new Map<string, number>()
  for (const [fam, data] of families) {
    const invVar = data.totalMc95 > 0 ? 1 / data.totalMc95 : 0
    familyWeights.set(fam, invVar)
    totalInvVar += invVar
  }

  // Normalize family weights
  if (totalInvVar > 0) {
    for (const [fam, w] of familyWeights) {
      familyWeights.set(fam, w / totalInvVar)
    }
  }

  // Level 2: Equal weight within each family
  const weights = new Map<string, number>()
  for (const [fam, data] of families) {
    const familyWeight = familyWeights.get(fam) || 0
    const perStrategy = data.ids.length > 0 ? familyWeight / data.ids.length : 0
    for (const id of data.ids) {
      weights.set(id, Math.round(perStrategy * 10000) / 10000)
    }
  }

  return weights
}

// --- Constants ---

export const FTMO_DAILY_DD_LIMIT = 5
export const FTMO_TOTAL_DD_LIMIT = 10
export const KELLY_MODES = ['half_kelly', 'quarter_kelly', 'full_kelly'] as const
export type KellyMode = typeof KELLY_MODES[number]

export const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

// --- Margin Specs (FTMO CFD) ---

export interface FtmoMarginSpec {
  symbol: string
  assetClass: 'forex' | 'index' | 'commodity' | 'crypto'
  leverageRatio: number   // e.g. 100 for 1:100
  marginPct: number       // e.g. 0.01 for 1%
  contractSize: number    // units per 1.0 lot
  contractCurrency: 'USD' | 'EUR'
}

export const FTMO_MARGIN_SPECS: Record<string, FtmoMarginSpec> = {
  'USDCAD':     { symbol: 'USDCAD',     assetClass: 'forex',     leverageRatio: 100, marginPct: 0.01,  contractSize: 100_000, contractCurrency: 'USD' },
  'USDJPY':     { symbol: 'USDJPY',     assetClass: 'forex',     leverageRatio: 100, marginPct: 0.01,  contractSize: 100_000, contractCurrency: 'USD' },
  'GER40.cash': { symbol: 'GER40.cash', assetClass: 'index',     leverageRatio: 20,  marginPct: 0.05,  contractSize: 1,       contractCurrency: 'EUR' },
  'US500.cash': { symbol: 'US500.cash', assetClass: 'index',     leverageRatio: 20,  marginPct: 0.05,  contractSize: 1,       contractCurrency: 'USD' },
  'US100.cash': { symbol: 'US100.cash', assetClass: 'index',     leverageRatio: 20,  marginPct: 0.05,  contractSize: 1,       contractCurrency: 'USD' },
  'UKOIL.cash': { symbol: 'UKOIL.cash', assetClass: 'commodity', leverageRatio: 10,  marginPct: 0.10,  contractSize: 100,     contractCurrency: 'USD' },
  'BTCUSD':     { symbol: 'BTCUSD',     assetClass: 'crypto',    leverageRatio: 2,   marginPct: 0.50,  contractSize: 1,       contractCurrency: 'USD' },
}

// Fallback prices when no trade data is available
export const DEFAULT_REF_PRICES: Record<string, number> = {
  'GER40.cash': 23000,
  'US500.cash': 5800,
  'US100.cash': 20000,
  'BTCUSD': 85000,
  'UKOIL.cash': 70,
  'USDCAD': 1.38,
  'USDJPY': 150,
}

export interface MarginCalcResult {
  symbol: string
  lots: number
  refPrice: number
  notionalValue: number
  marginRequired: number
  marginPct: number
  leverageRatio: number
}

export interface PortfolioMarginResult {
  perStrategy: MarginCalcResult[]
  totalNotional: number
  totalMarginRequired: number
  marginUtilizationPct: number
  freeMargin: number
  freeMarginPct: number
  leverageEffective: number
}

export function calcMarginForPosition(
  symbol: string,
  lots: number,
  refPrice: number,
  eurUsdRate = 1.08
): MarginCalcResult | null {
  const spec = FTMO_MARGIN_SPECS[symbol]
  if (!spec || lots <= 0 || refPrice <= 0) return null

  let notionalValue: number
  if (spec.assetClass === 'forex') {
    // Forex: notional = lots × contract size (in base currency)
    notionalValue = lots * spec.contractSize
  } else {
    // Index / commodity / crypto: notional = lots × contractSize × price
    notionalValue = lots * spec.contractSize * refPrice
  }

  // Convert EUR-denominated notional to USD
  if (spec.contractCurrency === 'EUR') {
    notionalValue *= eurUsdRate
  }

  const marginRequired = notionalValue * spec.marginPct

  return {
    symbol,
    lots,
    refPrice,
    notionalValue: Math.round(notionalValue * 100) / 100,
    marginRequired: Math.round(marginRequired * 100) / 100,
    marginPct: spec.marginPct,
    leverageRatio: spec.leverageRatio,
  }
}

export function calcPortfolioMargin(
  strategies: { symbol: string; lots: number; refPrice: number }[],
  equityBase: number,
  eurUsdRate = 1.08
): PortfolioMarginResult {
  const perStrategy: MarginCalcResult[] = []
  for (const s of strategies) {
    const result = calcMarginForPosition(s.symbol, s.lots, s.refPrice, eurUsdRate)
    if (result) perStrategy.push(result)
  }

  const totalNotional = perStrategy.reduce((sum, m) => sum + m.notionalValue, 0)
  const totalMarginRequired = perStrategy.reduce((sum, m) => sum + m.marginRequired, 0)
  const marginUtilizationPct = equityBase > 0 ? (totalMarginRequired / equityBase) * 100 : 0
  const freeMargin = equityBase - totalMarginRequired
  const freeMarginPct = equityBase > 0 ? (freeMargin / equityBase) * 100 : 0
  const leverageEffective = equityBase > 0 ? totalNotional / equityBase : 0

  return {
    perStrategy,
    totalNotional: Math.round(totalNotional * 100) / 100,
    totalMarginRequired: Math.round(totalMarginRequired * 100) / 100,
    marginUtilizationPct: Math.round(marginUtilizationPct * 100) / 100,
    freeMargin: Math.round(freeMargin * 100) / 100,
    freeMarginPct: Math.round(freeMarginPct * 100) / 100,
    leverageEffective: Math.round(leverageEffective * 100) / 100,
  }
}

// --- AI Sizing Advisor ---

export interface AdvisorInput {
  strategyId: string
  magic: number
  name: string
  style: string | null
  // Fitness
  fitnessScore: number
  fitnessConfidence: number
  // Health-like signals
  realTrades: number
  realWinPct: number | null
  testWinPct: number | null
  realExpectancy: number | null
  testExpectancy: number | null
  realPl: number
  realMaxDd: number | null
  testMaxDd: number | null
  // Pendulum inputs
  consecLosses: number
  ddFromPeak: number
  pendulumMultiplier: number
  pendulumState: string
  // Current lot
  currentLots: number
}

export interface AdvisorRecommendation {
  strategyId: string
  magic: number
  name: string
  action: 'increase' | 'decrease' | 'hold' | 'pause' | 'monitor'
  lotMultiplier: number
  suggestedLots: number
  severity: 'info' | 'warning' | 'critical'
  reason: string
  details: string[]
}

export interface AdvisorSummary {
  recommendations: AdvisorRecommendation[]
  portfolioHealth: 'good' | 'attention' | 'critical'
  summary: string
  totalStrategies: number
  healthyCount: number
  warningCount: number
  criticalCount: number
}

export function generateSizingAdvice(inputs: AdvisorInput[]): AdvisorSummary {
  const recommendations: AdvisorRecommendation[] = []
  let healthyCount = 0
  let warningCount = 0
  let criticalCount = 0

  for (const s of inputs) {
    const rec: AdvisorRecommendation = {
      strategyId: s.strategyId,
      magic: s.magic,
      name: s.name,
      action: 'hold',
      lotMultiplier: 1.0,
      suggestedLots: s.currentLots,
      severity: 'info',
      reason: '',
      details: [],
    }

    const isOutperforming = (s.realExpectancy ?? 0) >= 0 && s.realPl > 0
    const testDd = s.testMaxDd ?? 0
    const realDd = s.realMaxDd ?? 0
    const ddRatio = testDd > 0 ? realDd / testDd : 0
    const winDrop = (s.testWinPct && s.realWinPct != null)
      ? s.testWinPct - s.realWinPct
      : 0

    // Priority 1: Insufficient data
    if (s.realTrades < 5) {
      rec.action = 'monitor'
      rec.severity = 'info'
      rec.reason = 'Dati insufficienti — mantenere sizing attuale e raccogliere dati'
      rec.details.push(`Solo ${s.realTrades} trade reali`)
      healthyCount++
    }
    // Priority 2: Critical — DD breach + negative edge
    else if (ddRatio > 2 && !isOutperforming && s.fitnessConfidence > 0.6) {
      rec.action = 'decrease'
      rec.lotMultiplier = 0.7
      rec.severity = 'critical'
      rec.reason = 'DD reale > 2x test con edge negativo — ridurre del 30%'
      rec.details.push(`DD ratio: ${fmt(ddRatio, 1)}x`, `P/L: $${fmt(s.realPl, 0)}`)
      criticalCount++
    }
    // Priority 3: Regime mismatch (trend strategy underperforming)
    else if (s.style === 'trend_following' && !isOutperforming && s.realTrades >= 10) {
      rec.action = 'hold'
      rec.severity = 'warning'
      rec.reason = 'Possibile regime sfavorevole — mantenere per validazione OOS'
      rec.details.push('Strategia trend con expectancy negativa', 'Non fermare: arricchisce il database')
      warningCount++
    }
    // Priority 4: Warning — DD elevated
    else if (ddRatio > 1.5 && s.fitnessScore < 60) {
      rec.action = 'decrease'
      rec.lotMultiplier = 0.85
      rec.severity = 'warning'
      rec.reason = 'DD sopra soglia con fitness basso — ridurre del 15%'
      rec.details.push(`Fitness: ${fmt(s.fitnessScore, 0)}/100`, `DD ratio: ${fmt(ddRatio, 1)}x`)
      warningCount++
    }
    // Priority 5: Warning — Win rate drop but still profitable
    else if (winDrop > 15 && isOutperforming) {
      rec.action = 'hold'
      rec.severity = 'info'
      rec.reason = 'Win rate in calo ma P/L positivo — monitorare'
      rec.details.push(`Win rate: ${fmt(s.realWinPct ?? 0, 1)}% (test: ${fmt(s.testWinPct ?? 0, 1)}%)`)
      healthyCount++
    }
    // Priority 6: Healthy + outperforming + pendulum recovery/drawdown
    else if (isOutperforming && s.pendulumState === 'drawdown' && s.fitnessScore >= 50) {
      rec.action = 'increase'
      rec.lotMultiplier = s.pendulumMultiplier
      rec.severity = 'info'
      rec.reason = `Edge confermato in fase recovery — pendulum ${fmt(s.pendulumMultiplier, 2)}x`
      rec.details.push(`Fitness: ${fmt(s.fitnessScore, 0)}/100`, `DD dal picco: ${fmt(s.ddFromPeak, 1)}%`)
      healthyCount++
    }
    // Priority 7: Healthy + high fitness
    else if (s.fitnessScore >= 80 && isOutperforming && s.realTrades >= 30) {
      rec.action = 'increase'
      rec.lotMultiplier = 1.1
      rec.severity = 'info'
      rec.reason = 'Fitness eccellente e edge confermato — margine per +10%'
      rec.details.push(`Fitness: ${fmt(s.fitnessScore, 0)}/100`, `${s.realTrades} trade reali`)
      healthyCount++
    }
    // Default: Hold
    else {
      rec.action = 'hold'
      rec.severity = 'info'
      rec.reason = 'Performance in linea — sizing ottimale'
      if (s.fitnessScore > 0) rec.details.push(`Fitness: ${fmt(s.fitnessScore, 0)}/100`)
      healthyCount++
    }

    rec.suggestedLots = Math.max(0.01, Math.round(s.currentLots * rec.lotMultiplier * 1000) / 1000)
    recommendations.push(rec)
  }

  const portfolioHealth = criticalCount > 0 ? 'critical' : warningCount > 0 ? 'attention' : 'good'
  const total = inputs.length
  const summary = portfolioHealth === 'good'
    ? `${total} strategie analizzate — portafoglio in buona salute`
    : portfolioHealth === 'attention'
    ? `${total} strategie analizzate — ${warningCount} richiedono attenzione`
    : `${total} strategie analizzate — ${criticalCount} in stato critico`

  return { recommendations, portfolioHealth, summary, totalStrategies: total, healthyCount, warningCount, criticalCount }
}

// --- Monte Carlo Simulation ---

export interface MCPath {
  equity: number[] // equity at each step (trade)
  maxDd: number    // max drawdown in $
  maxDdPct: number // max drawdown in %
  finalPnl: number
  finalPct: number
}

export interface MCResult {
  paths: MCPath[]
  percentiles: {
    p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[]
  }
  stats: {
    medianReturn: number
    medianReturnPct: number
    medianMaxDd: number
    medianMaxDdPct: number
    worstDd: number
    worstDdPct: number
    probRuin: number // probability of hitting max DD limit
    probProfit: number
  }
}

/**
 * Monte Carlo bootstrap simulation.
 *
 * Takes real trade P/L data, resamples with replacement to create
 * N simulated equity paths of M trades each.
 * Returns percentile bands for fan chart + risk statistics.
 *
 * @param trades Array of net_profit values from real trades
 * @param equityBase Starting capital
 * @param numPaths Number of simulation paths (default 500)
 * @param pathLength Number of trades per path (default: same as input)
 * @param ruinPct Max DD % that triggers "ruin" (default: 10 for FTMO)
 * @param lotMultiplier Scale factor for trade P/L (for scenario comparison)
 */
export function runMonteCarlo(
  trades: number[],
  equityBase: number,
  numPaths = 500,
  pathLength?: number,
  ruinPct = 10,
  lotMultiplier = 1.0,
): MCResult {
  const len = pathLength || trades.length
  if (trades.length === 0) {
    return emptyMCResult(len)
  }

  const ruinUsd = equityBase * ruinPct / 100
  const paths: MCPath[] = []

  for (let p = 0; p < numPaths; p++) {
    const equity: number[] = [equityBase]
    let peak = equityBase
    let maxDd = 0

    for (let t = 0; t < len; t++) {
      // Bootstrap: random trade from historical data
      const idx = Math.floor(Math.random() * trades.length)
      const pnl = trades[idx] * lotMultiplier
      const newEquity = equity[equity.length - 1] + pnl
      equity.push(newEquity)

      if (newEquity > peak) peak = newEquity
      const dd = peak - newEquity
      if (dd > maxDd) maxDd = dd
    }

    const finalPnl = equity[equity.length - 1] - equityBase
    paths.push({
      equity,
      maxDd,
      maxDdPct: equityBase > 0 ? (maxDd / equityBase) * 100 : 0,
      finalPnl,
      finalPct: equityBase > 0 ? (finalPnl / equityBase) * 100 : 0,
    })
  }

  // Calculate percentile bands at each step
  const p5: number[] = [], p25: number[] = [], p50: number[] = [], p75: number[] = [], p95: number[] = []
  for (let t = 0; t <= len; t++) {
    const values = paths.map(p => p.equity[t]).sort((a, b) => a - b)
    p5.push(values[Math.floor(numPaths * 0.05)])
    p25.push(values[Math.floor(numPaths * 0.25)])
    p50.push(values[Math.floor(numPaths * 0.50)])
    p75.push(values[Math.floor(numPaths * 0.75)])
    p95.push(values[Math.floor(numPaths * 0.95)])
  }

  // Stats
  const finalPnls = paths.map(p => p.finalPnl).sort((a, b) => a - b)
  const maxDds = paths.map(p => p.maxDd).sort((a, b) => a - b)
  const maxDdPcts = paths.map(p => p.maxDdPct).sort((a, b) => a - b)

  return {
    paths,
    percentiles: { p5, p25, p50, p75, p95 },
    stats: {
      medianReturn: finalPnls[Math.floor(numPaths * 0.5)],
      medianReturnPct: equityBase > 0 ? (finalPnls[Math.floor(numPaths * 0.5)] / equityBase) * 100 : 0,
      medianMaxDd: maxDds[Math.floor(numPaths * 0.5)],
      medianMaxDdPct: maxDdPcts[Math.floor(numPaths * 0.5)],
      worstDd: maxDds[Math.floor(numPaths * 0.95)],
      worstDdPct: maxDdPcts[Math.floor(numPaths * 0.95)],
      probRuin: paths.filter(p => p.maxDdPct >= ruinPct).length / numPaths,
      probProfit: paths.filter(p => p.finalPnl > 0).length / numPaths,
    },
  }
}

function emptyMCResult(len: number): MCResult {
  const zeros = Array(len + 1).fill(0)
  return {
    paths: [],
    percentiles: { p5: zeros, p25: zeros, p50: zeros, p75: zeros, p95: zeros },
    stats: { medianReturn: 0, medianReturnPct: 0, medianMaxDd: 0, medianMaxDdPct: 0, worstDd: 0, worstDdPct: 0, probRuin: 0, probProfit: 0 },
  }
}

// --- Scenario Comparison ---

export interface ScenarioResult {
  name: string
  kellyMode: KellyMode
  lotMultiplier: number
  mc: MCResult
}

/**
 * Compare 3 scenarios: Conservative (1/4 Kelly), Neutral (1/2 Kelly), Aggressive (full Kelly).
 * Runs MC simulation for each with different lot multipliers.
 */
export function runScenarioComparison(
  trades: number[],
  equityBase: number,
  ruinPct = 10,
  numPaths = 500,
  pathLength?: number,
): ScenarioResult[] {
  return [
    {
      name: 'Conservativo (1/4 Kelly)',
      kellyMode: 'quarter_kelly' as KellyMode,
      lotMultiplier: 0.5,
      mc: runMonteCarlo(trades, equityBase, numPaths, pathLength, ruinPct, 0.5),
    },
    {
      name: 'Neutro (1/2 Kelly)',
      kellyMode: 'half_kelly' as KellyMode,
      lotMultiplier: 1.0,
      mc: runMonteCarlo(trades, equityBase, numPaths, pathLength, ruinPct, 1.0),
    },
    {
      name: 'Aggressivo (Full Kelly)',
      kellyMode: 'full_kelly' as KellyMode,
      lotMultiplier: 2.0,
      mc: runMonteCarlo(trades, equityBase, numPaths, pathLength, ruinPct, 2.0),
    },
  ]
}

// ============================================
// BUILDER V2 — Equity Curves & Portfolio Builder
// ============================================

/** 18 distinguishable chart colors */
export const CHART_COLORS = [
  '#6366f1', // indigo
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#3b82f6', // blue
  '#84cc16', // lime
  '#e11d48', // rose
  '#0ea5e9', // sky
  '#a855f7', // purple
  '#10b981', // emerald
  '#d946ef', // fuchsia
  '#eab308', // yellow
  '#64748b', // slate
]

/** Combined portfolio line color */
export const PORTFOLIO_COLOR = '#1e293b' // slate-800

export interface TradeForCurve {
  strategy_id: string
  net_profit: number
  lots: number
  close_time: string
  symbol: string
  open_price?: number
}

export interface EquityCurvePoint {
  date: string           // YYYY-MM-DD
  tradeIndex: number     // sequential trade #
  closeTime: string      // full ISO timestamp
  pnl: number            // scaled P/L for this trade
  cumPnl: number         // cumulative P/L
  equity: number         // equityBase + cumPnl
}

export interface StrategyEquityCurve {
  strategyId: string
  magic: number
  name: string
  color: string
  userLots: number       // user-chosen lot size
  originalAvgLots: number
  points: EquityCurvePoint[]
  stats: CurveStats
}

export interface CurveStats {
  totalPnl: number
  totalTrades: number
  winRate: number
  avgTrade: number
  maxDd: number
  maxDdPct: number
  profitFactor: number
  sharpe: number         // annualized (approx: avg/std * sqrt(252))
  bestTrade: number
  worstTrade: number
  avgWin: number
  avgLoss: number
  maxConsecLoss: number
  recoveryFactor: number // totalPnl / maxDd
}

export interface CombinedCurvePoint {
  date: string
  closeTime: string
  equity: number
  pnl: number
  // Per-strategy values for tooltip
  [key: string]: number | string
}

export interface PortfolioStats extends CurveStats {
  strategyCount: number
  correlationAvg: number | null
}

/**
 * Build equity curves for multiple strategies with custom lot sizing.
 *
 * Scales each trade's P/L by (userLots / originalLots) to simulate
 * what would have happened at the user's chosen lot size.
 *
 * @param trades All closed trades sorted by close_time
 * @param strategies Map of strategy_id -> { magic, name, userLots }
 * @param equityBase Starting capital (for equity line)
 */
export function buildEquityCurves(
  trades: TradeForCurve[],
  strategies: Map<string, { magic: number; name: string; userLots: number; color: string }>,
  equityBase: number,
): { curves: StrategyEquityCurve[]; combined: CombinedCurvePoint[]; portfolioStats: PortfolioStats } {
  // Group trades by strategy
  const tradesByStrategy = new Map<string, TradeForCurve[]>()
  for (const t of trades) {
    if (!strategies.has(t.strategy_id)) continue
    if (!tradesByStrategy.has(t.strategy_id)) tradesByStrategy.set(t.strategy_id, [])
    tradesByStrategy.get(t.strategy_id)!.push(t)
  }

  const curves: StrategyEquityCurve[] = []

  for (const [stratId, config] of strategies) {
    const stratTrades = tradesByStrategy.get(stratId) || []
    if (stratTrades.length === 0) continue

    // Calculate average lot size for this strategy
    const avgLots = stratTrades.reduce((s, t) => s + t.lots, 0) / stratTrades.length
    const lotScale = avgLots > 0 ? config.userLots / avgLots : 1

    const points: EquityCurvePoint[] = []
    let cumPnl = 0

    for (let i = 0; i < stratTrades.length; i++) {
      const t = stratTrades[i]
      const scaledPnl = t.net_profit * lotScale
      cumPnl += scaledPnl
      points.push({
        date: t.close_time.slice(0, 10),
        tradeIndex: i + 1,
        closeTime: t.close_time,
        pnl: Math.round(scaledPnl * 100) / 100,
        cumPnl: Math.round(cumPnl * 100) / 100,
        equity: Math.round((equityBase + cumPnl) * 100) / 100,
      })
    }

    const stats = calcCurveStats(points.map(p => p.pnl), equityBase)

    curves.push({
      strategyId: stratId,
      magic: config.magic,
      name: config.name,
      color: config.color,
      userLots: config.userLots,
      originalAvgLots: Math.round(avgLots * 1000) / 1000,
      points,
      stats,
    })
  }

  // Build combined equity curve — merge all trades chronologically
  const allScaledTrades: { closeTime: string; date: string; pnl: number; stratId: string }[] = []
  for (const curve of curves) {
    for (const p of curve.points) {
      allScaledTrades.push({ closeTime: p.closeTime, date: p.date, pnl: p.pnl, stratId: curve.strategyId })
    }
  }
  allScaledTrades.sort((a, b) => a.closeTime.localeCompare(b.closeTime))

  // Track per-strategy cumulative for combined chart
  const stratCum = new Map<string, number>()
  for (const c of curves) stratCum.set(c.strategyId, 0)

  const combined: CombinedCurvePoint[] = []
  let portfolioCum = 0

  for (const t of allScaledTrades) {
    portfolioCum += t.pnl
    stratCum.set(t.stratId, (stratCum.get(t.stratId) || 0) + t.pnl)

    const point: CombinedCurvePoint = {
      date: t.date,
      closeTime: t.closeTime,
      equity: Math.round((equityBase + portfolioCum) * 100) / 100,
      pnl: Math.round(t.pnl * 100) / 100,
    }
    // Add per-strategy cumulative equity for multi-line chart
    for (const c of curves) {
      point[`eq_${c.strategyId}`] = Math.round((equityBase + (stratCum.get(c.strategyId) || 0)) * 100) / 100
    }
    combined.push(point)
  }

  const portfolioStats: PortfolioStats = {
    ...calcCurveStats(allScaledTrades.map(t => t.pnl), equityBase),
    strategyCount: curves.length,
    correlationAvg: null, // can be computed separately
  }

  return { curves, combined, portfolioStats }
}

/**
 * Calculate statistics for an equity curve from a series of P/L values.
 */
export function calcCurveStats(pnls: number[], equityBase: number): CurveStats {
  if (pnls.length === 0) {
    return { totalPnl: 0, totalTrades: 0, winRate: 0, avgTrade: 0, maxDd: 0, maxDdPct: 0, profitFactor: 0, sharpe: 0, bestTrade: 0, worstTrade: 0, avgWin: 0, avgLoss: 0, maxConsecLoss: 0, recoveryFactor: 0 }
  }

  const totalPnl = pnls.reduce((s, v) => s + v, 0)
  const wins = pnls.filter(p => p > 0)
  const losses = pnls.filter(p => p < 0)
  const winRate = (wins.length / pnls.length) * 100
  const avgTrade = totalPnl / pnls.length

  // Max DD
  let peak = equityBase
  let maxDd = 0
  let equity = equityBase
  for (const pnl of pnls) {
    equity += pnl
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDd) maxDd = dd
  }
  const maxDdPct = equityBase > 0 ? (maxDd / equityBase) * 100 : 0

  // Profit factor
  const grossProfit = wins.reduce((s, v) => s + v, 0)
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0

  // Sharpe (annualized approx)
  const mean = avgTrade
  const variance = pnls.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / pnls.length
  const std = Math.sqrt(variance)
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0

  // Max consecutive losses
  let maxConsec = 0, currentConsec = 0
  for (const pnl of pnls) {
    if (pnl < 0) { currentConsec++; maxConsec = Math.max(maxConsec, currentConsec) }
    else { currentConsec = 0 }
  }

  const avgWin = wins.length > 0 ? wins.reduce((s, v) => s + v, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((s, v) => s + v, 0) / losses.length : 0

  return {
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalTrades: pnls.length,
    winRate: Math.round(winRate * 10) / 10,
    avgTrade: Math.round(avgTrade * 100) / 100,
    maxDd: Math.round(maxDd * 100) / 100,
    maxDdPct: Math.round(maxDdPct * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    sharpe: Math.round(sharpe * 100) / 100,
    bestTrade: Math.round(Math.max(...pnls, 0) * 100) / 100,
    worstTrade: Math.round(Math.min(...pnls, 0) * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    maxConsecLoss: maxConsec,
    recoveryFactor: maxDd > 0 ? Math.round((totalPnl / maxDd) * 100) / 100 : 0,
  }
}
