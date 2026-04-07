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
  include: boolean            // true = advisor recommends including this strategy
  action: 'increase' | 'decrease' | 'hold' | 'pause' | 'monitor'
  lotMultiplier: number
  suggestedLots: number
  severity: 'info' | 'warning' | 'critical'
  reason: string
  details: string[]
}

export interface AdvisorSummary {
  included: AdvisorRecommendation[]   // strategies to include
  excluded: AdvisorRecommendation[]   // strategies to exclude/pause
  portfolioHealth: 'good' | 'attention' | 'critical'
  summary: string
  totalStrategies: number
  includedCount: number
  excludedCount: number
}

export function generateSizingAdvice(inputs: AdvisorInput[]): AdvisorSummary {
  const included: AdvisorRecommendation[] = []
  const excluded: AdvisorRecommendation[] = []

  for (const s of inputs) {
    const rec: AdvisorRecommendation = {
      strategyId: s.strategyId,
      magic: s.magic,
      name: s.name,
      include: true,
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

    // === EXCLUDE decisions ===

    // Critical: DD > 2x test + negative edge + enough data → exclude
    if (s.realTrades >= 30 && ddRatio > 2 && !isOutperforming && s.fitnessScore < 30) {
      rec.include = false
      rec.action = 'pause'
      rec.lotMultiplier = 0
      rec.severity = 'critical'
      rec.reason = 'Edge compromesso — DD > 2x test, fitness critico'
      rec.details.push(`Fitness: ${fmt(s.fitnessScore, 0)}/100`, `DD ratio: ${fmt(ddRatio, 1)}x`, `P/L: $${fmt(s.realPl, 0)}`)
    }

    // === INCLUDE decisions (with sizing) ===

    // Insufficient data — include cautiously at base lots
    else if (s.realTrades < 5) {
      rec.include = true
      rec.action = 'monitor'
      rec.severity = 'info'
      rec.reason = 'Dati insufficienti — inclusa a sizing base per raccogliere dati'
      rec.details.push(`Solo ${s.realTrades} trade reali`)
    }
    // DD breach but not broken — include with reduced size
    else if (ddRatio > 2 && !isOutperforming && s.fitnessConfidence > 0.6) {
      rec.include = true
      rec.action = 'decrease'
      rec.lotMultiplier = 0.7
      rec.severity = 'critical'
      rec.reason = 'DD reale > 2x test — inclusa a sizing ridotto (-30%)'
      rec.details.push(`DD ratio: ${fmt(ddRatio, 1)}x`, `P/L: $${fmt(s.realPl, 0)}`)
    }
    // Regime mismatch — include at base (validation OOS)
    else if (s.style === 'trend_following' && !isOutperforming && s.realTrades >= 10) {
      rec.include = true
      rec.action = 'hold'
      rec.severity = 'warning'
      rec.reason = 'Regime sfavorevole — inclusa per validazione OOS'
      rec.details.push('Strategia trend con expectancy negativa', 'Non fermare: arricchisce il database')
    }
    // DD elevated + low fitness — include with reduced size
    else if (ddRatio > 1.5 && s.fitnessScore < 60) {
      rec.include = true
      rec.action = 'decrease'
      rec.lotMultiplier = 0.85
      rec.severity = 'warning'
      rec.reason = 'DD sopra soglia — inclusa a sizing ridotto (-15%)'
      rec.details.push(`Fitness: ${fmt(s.fitnessScore, 0)}/100`, `DD ratio: ${fmt(ddRatio, 1)}x`)
    }
    // Win rate drop but profitable — include, hold
    else if (winDrop > 15 && isOutperforming) {
      rec.include = true
      rec.action = 'hold'
      rec.severity = 'info'
      rec.reason = 'Win rate in calo ma P/L positivo — inclusa, monitorare'
      rec.details.push(`Win rate: ${fmt(s.realWinPct ?? 0, 1)}% (test: ${fmt(s.testWinPct ?? 0, 1)}%)`)
    }
    // Outperforming in drawdown — include with pendulum boost
    else if (isOutperforming && s.pendulumState === 'drawdown' && s.fitnessScore >= 50) {
      rec.include = true
      rec.action = 'increase'
      rec.lotMultiplier = s.pendulumMultiplier
      rec.severity = 'info'
      rec.reason = `Edge confermato in recovery — pendulum ${fmt(s.pendulumMultiplier, 2)}x`
      rec.details.push(`Fitness: ${fmt(s.fitnessScore, 0)}/100`, `DD dal picco: ${fmt(s.ddFromPeak, 1)}%`)
    }
    // High fitness + outperforming + enough data — include with boost
    else if (s.fitnessScore >= 80 && isOutperforming && s.realTrades >= 30) {
      rec.include = true
      rec.action = 'increase'
      rec.lotMultiplier = 1.1
      rec.severity = 'info'
      rec.reason = 'Fitness eccellente, edge confermato — +10%'
      rec.details.push(`Fitness: ${fmt(s.fitnessScore, 0)}/100`, `${s.realTrades} trade reali`)
    }
    // Default: include at base sizing
    else {
      rec.include = true
      rec.action = 'hold'
      rec.severity = 'info'
      rec.reason = 'Performance in linea — sizing standard'
      if (s.fitnessScore > 0) rec.details.push(`Fitness: ${fmt(s.fitnessScore, 0)}/100`)
    }

    rec.suggestedLots = Math.max(0.01, Math.round(s.currentLots * rec.lotMultiplier * 1000) / 1000)

    if (rec.include) {
      included.push(rec)
    } else {
      rec.suggestedLots = 0
      excluded.push(rec)
    }
  }

  // Sort: included by fitness desc, excluded by severity
  included.sort((a, b) => {
    const ai = inputs.find(i => i.strategyId === a.strategyId)
    const bi = inputs.find(i => i.strategyId === b.strategyId)
    return (bi?.fitnessScore ?? 0) - (ai?.fitnessScore ?? 0)
  })

  const hasWarnings = included.some(r => r.severity === 'warning') || excluded.length > 0
  const hasCritical = included.some(r => r.severity === 'critical') || excluded.some(r => r.severity === 'critical')
  const portfolioHealth = hasCritical ? 'critical' : hasWarnings ? 'attention' : 'good'
  const total = inputs.length
  const summary = excluded.length === 0
    ? `${included.length}/${total} strategie raccomandate — portafoglio in buona salute`
    : `${included.length}/${total} strategie raccomandate — ${excluded.length} escluse`

  return { included, excluded, portfolioHealth, summary, totalStrategies: total, includedCount: included.length, excludedCount: excluded.length }
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
// SIZING EFFICIENCY & EQUITY PROJECTION
// ============================================

export interface SizingEfficiency {
  currentPnl: number          // actual P/L with current lots
  optimizedPnl: number        // estimated P/L with optimal lots
  efficiencyPct: number       // currentPnl / optimizedPnl * 100
  gapPnl: number              // optimizedPnl - currentPnl
  gapPct: number              // how much more you could earn %
  avgLotRatio: number         // avg(currentLot / optimalLot)
  underSized: number          // count of strategies using < 80% of optimal
  overSized: number           // count using > 120% of optimal
}

export interface ProjectionScenario {
  label: string
  equity6m: number
  equity12m: number
  pnl6m: number
  pnl12m: number
  return6mPct: number
  return12mPct: number
  monthlyPnl: number
  maxDdEstimate: number
}

export interface EquityProjection {
  pessimistic: ProjectionScenario   // P10
  base: ProjectionScenario          // P50 median
  optimistic: ProjectionScenario    // P90
  tradesPerMonth: number
  monthsOfData: number
  dataQuality: 'low' | 'medium' | 'high'  // based on months of history
}

/**
 * Calculate sizing efficiency: how well current lots exploit the account capacity.
 * Compares actual P/L to what the P/L would have been with optimized (Kelly/HRP) lots.
 */
export function calcSizingEfficiency(
  strategies: { strategyId: string; currentLots: number; optimizedLots: number; avgTradeAtCurrentLots: number }[],
): SizingEfficiency {
  let currentPnl = 0
  let optimizedPnl = 0
  let lotRatioSum = 0
  let lotRatioCount = 0
  let underSized = 0
  let overSized = 0

  for (const s of strategies) {
    const curr = s.currentLots
    const opt = s.optimizedLots
    if (opt <= 0 || curr <= 0) continue

    const ratio = curr / opt
    lotRatioSum += ratio
    lotRatioCount++

    // Current P/L = actual avg trade * number implied
    // We use avgTrade at current lots as-is
    currentPnl += s.avgTradeAtCurrentLots

    // Optimized P/L = scale avg trade by lot ratio
    optimizedPnl += s.avgTradeAtCurrentLots * (opt / curr)

    if (ratio < 0.8) underSized++
    else if (ratio > 1.2) overSized++
  }

  const avgLotRatio = lotRatioCount > 0 ? lotRatioSum / lotRatioCount : 1
  const efficiencyPct = optimizedPnl !== 0 ? (currentPnl / optimizedPnl) * 100 : 100
  const gapPnl = optimizedPnl - currentPnl
  const gapPct = currentPnl !== 0 ? (gapPnl / Math.abs(currentPnl)) * 100 : 0

  return { currentPnl, optimizedPnl, efficiencyPct, gapPnl, gapPct, avgLotRatio, underSized, overSized }
}

/**
 * Project equity forward 6/12 months using Monte Carlo bootstrap on monthly returns.
 * Generates 3 scenarios: pessimistic (P10), base (P50), optimistic (P90).
 *
 * @param monthlyReturns Array of monthly P/L values (absolute $)
 * @param equityBase Current equity
 * @param tradesPerMonth Average trades per month
 */
export function calcEquityProjection(
  monthlyReturns: number[],
  equityBase: number,
  tradesPerMonth: number,
): EquityProjection {
  const nMonths = monthlyReturns.length
  const dataQuality: 'low' | 'medium' | 'high' = nMonths < 3 ? 'low' : nMonths < 6 ? 'medium' : 'high'

  if (nMonths === 0) {
    const empty: ProjectionScenario = {
      label: '', equity6m: equityBase, equity12m: equityBase,
      pnl6m: 0, pnl12m: 0, return6mPct: 0, return12mPct: 0,
      monthlyPnl: 0, maxDdEstimate: 0,
    }
    return {
      pessimistic: { ...empty, label: 'Pessimistico' },
      base: { ...empty, label: 'Base' },
      optimistic: { ...empty, label: 'Ottimistico' },
      tradesPerMonth, monthsOfData: 0, dataQuality,
    }
  }

  // Run 1000 MC paths of 12 months each using monthly bootstrap
  const numPaths = 1000
  const pathLength = 12

  const paths6m: number[] = []   // equity at 6 months
  const paths12m: number[] = []  // equity at 12 months
  const pathMaxDd: number[] = []

  for (let p = 0; p < numPaths; p++) {
    let equity = equityBase
    let peak = equityBase
    let maxDd = 0

    for (let m = 0; m < pathLength; m++) {
      const idx = Math.floor(Math.random() * nMonths)
      equity += monthlyReturns[idx]
      if (equity > peak) peak = equity
      const dd = peak - equity
      if (dd > maxDd) maxDd = dd

      if (m === 5) paths6m.push(equity)  // after 6 months
    }
    paths12m.push(equity)
    pathMaxDd.push(maxDd)
  }

  // Sort for percentiles
  paths6m.sort((a, b) => a - b)
  paths12m.sort((a, b) => a - b)
  pathMaxDd.sort((a, b) => a - b)

  const pct = (arr: number[], p: number) => arr[Math.floor(arr.length * p)]

  function buildScenario(label: string, percentile: number): ProjectionScenario {
    const eq6 = pct(paths6m, percentile)
    const eq12 = pct(paths12m, percentile)
    const pnl6 = eq6 - equityBase
    const pnl12 = eq12 - equityBase
    return {
      label,
      equity6m: Math.round(eq6),
      equity12m: Math.round(eq12),
      pnl6m: Math.round(pnl6),
      pnl12m: Math.round(pnl12),
      return6mPct: equityBase > 0 ? (pnl6 / equityBase) * 100 : 0,
      return12mPct: equityBase > 0 ? (pnl12 / equityBase) * 100 : 0,
      monthlyPnl: Math.round(pnl12 / 12),
      maxDdEstimate: Math.round(pct(pathMaxDd, percentile)),
    }
  }

  return {
    pessimistic: buildScenario('Pessimistico', 0.10),
    base: buildScenario('Base', 0.50),
    optimistic: buildScenario('Ottimistico', 0.90),
    tradesPerMonth,
    monthsOfData: nMonths,
    dataQuality,
  }
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

// ============================================
// Monthly Analysis Engine
// ============================================

export interface MonthlyStrategyStats {
  strategyId: string
  magic: number
  name: string
  asset: string
  family: string | null
  style: string | null
  monthlyPl: number
  monthlyTrades: number
  monthlyWinRate: number
  monthlyProfitFactor: number
  monthlyBestTrade: number
  monthlyWorstTrade: number
  prevMonthPl: number | null
  prevMonthTrades: number | null
  healthStatus: string
  fitnessScore: number
  inBestPortfolio: boolean
  commentary: string
}

export interface BestPortfolioResult {
  selected: MonthlyStrategyStats[]
  excluded: MonthlyStrategyStats[]
  totalPl: number
  avgWinRate: number
  avgProfitFactor: number
  selectionCriteria: string
}

export interface MonthlyAssetSummary {
  asset: string
  assetLabel: string
  totalPl: number
  totalTrades: number
  strategies: { name: string; magic: number; pl: number; winRate: number; trades: number }[]
  regime: 'up' | 'down' | 'range' | 'unknown'
  regimeDetail: string
  commentary: string
}

export interface MonthlyKPIs {
  totalPl: number
  totalTrades: number
  winRate: number
  maxDd: number
  maxDdPct: number
  profitFactor: number
  bestDay: { date: string; pl: number } | null
  worstDay: { date: string; pl: number } | null
  tradingDays: number
  cagr?: number
  sharpe?: number
  recoveryFactor?: number
}

export interface MonthlyTrendEntry {
  month: string
  monthLabel: string
  pl: number
  trades: number
  winRate: number
  profitFactor: number
}

/**
 * Calculate monthly stats for a single strategy from filtered trades.
 */
export function calcMonthlyStrategyStats(
  trades: { net_profit: number; close_time: string }[],
  prevTrades: { net_profit: number }[],
  strategy: { id: string; magic: number; name: string | null; asset: string; strategy_family: string | null; strategy_style: string | null; test_win_pct: number | null },
  healthStatus: string,
  fitnessScore: number,
): MonthlyStrategyStats {
  const pnls = trades.map(t => Number(t.net_profit))
  const wins = pnls.filter(p => p > 0)
  const losses = pnls.filter(p => p < 0)
  const totalPl = pnls.reduce((s, v) => s + v, 0)
  const winRate = pnls.length > 0 ? (wins.length / pnls.length) * 100 : 0
  const grossProfit = wins.reduce((s, v) => s + v, 0)
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0

  const prevPnls = prevTrades.map(t => Number(t.net_profit))
  const prevPl = prevPnls.length > 0 ? prevPnls.reduce((s, v) => s + v, 0) : null

  return {
    strategyId: strategy.id,
    magic: strategy.magic,
    name: strategy.name || `Magic ${strategy.magic}`,
    asset: strategy.asset,
    family: strategy.strategy_family,
    style: strategy.strategy_style,
    monthlyPl: Math.round(totalPl * 100) / 100,
    monthlyTrades: pnls.length,
    monthlyWinRate: Math.round(winRate * 10) / 10,
    monthlyProfitFactor: Math.round(profitFactor * 100) / 100,
    monthlyBestTrade: pnls.length > 0 ? Math.round(Math.max(...pnls) * 100) / 100 : 0,
    monthlyWorstTrade: pnls.length > 0 ? Math.round(Math.min(...pnls) * 100) / 100 : 0,
    prevMonthPl: prevPl !== null ? Math.round(prevPl * 100) / 100 : null,
    prevMonthTrades: prevPnls.length > 0 ? prevPnls.length : null,
    healthStatus,
    fitnessScore,
    inBestPortfolio: false, // set later by selectBestPortfolio
    commentary: '', // set later by generateMonthlyCommentary
  }
}

/**
 * Select best portfolio with strict criteria.
 */
export function selectBestPortfolio(
  strategies: MonthlyStrategyStats[],
  testMetrics: Map<string, { test_win_pct: number | null }>,
): BestPortfolioResult {
  const selected: MonthlyStrategyStats[] = []
  const excluded: MonthlyStrategyStats[] = []

  for (const s of strategies) {
    const test = testMetrics.get(s.strategyId)
    const testWr = test?.test_win_pct ?? null

    // Win rate check: >= 50% OR >= 90% of test win rate
    const wrOk = s.monthlyWinRate >= 50 || (testWr !== null && s.monthlyWinRate >= testWr * 0.9)

    const passes =
      s.monthlyPl > 0 &&
      s.monthlyProfitFactor >= 1.5 &&
      wrOk &&
      s.healthStatus === 'healthy' &&
      s.fitnessScore >= 50 &&
      s.monthlyTrades >= 3

    if (passes) {
      selected.push({ ...s, inBestPortfolio: true })
    } else {
      excluded.push({ ...s, inBestPortfolio: false })
    }
  }

  selected.sort((a, b) => b.monthlyPl - a.monthlyPl)
  excluded.sort((a, b) => b.monthlyPl - a.monthlyPl)

  const totalPl = selected.reduce((s, v) => s + v.monthlyPl, 0)
  const avgWinRate = selected.length > 0
    ? selected.reduce((s, v) => s + v.monthlyWinRate, 0) / selected.length : 0
  const avgProfitFactor = selected.length > 0
    ? selected.reduce((s, v) => s + v.monthlyProfitFactor, 0) / selected.length : 0

  return {
    selected,
    excluded,
    totalPl: Math.round(totalPl * 100) / 100,
    avgWinRate: Math.round(avgWinRate * 10) / 10,
    avgProfitFactor: Math.round(avgProfitFactor * 100) / 100,
    selectionCriteria: 'P/L > 0, PF ≥ 1.5, WR ≥ 50% (o ≥ 90% test), Health OK, Fitness ≥ 50, Trade ≥ 3',
  }
}

/**
 * Detect current regime for an asset from benchmark data.
 * Uses last available close vs SMA50 and SMA200.
 */
export function detectAssetRegime(
  prices: { ts: string; close_price: number }[],
): { regime: 'up' | 'down' | 'range' | 'unknown'; detail: string } {
  if (prices.length < 50) return { regime: 'unknown', detail: 'Dati insufficienti per calcolo regime' }

  const closes = prices.map(p => Number(p.close_price))
  const last = closes[closes.length - 1]

  const sma = (period: number) => {
    if (closes.length < period) return null
    const slice = closes.slice(-period)
    return slice.reduce((s, v) => s + v, 0) / period
  }

  const sma50 = sma(50)
  const sma200 = sma(200)

  if (sma50 !== null && sma200 !== null) {
    if (last > sma50 && sma50 > sma200) {
      return { regime: 'up', detail: `Uptrend — prezzo sopra SMA50 e SMA200` }
    } else if (last < sma50 && sma50 < sma200) {
      return { regime: 'down', detail: `Downtrend — prezzo sotto SMA50 e SMA200` }
    } else {
      return { regime: 'range', detail: `Range — segnali misti tra SMA50 e SMA200` }
    }
  } else if (sma50 !== null) {
    if (last > sma50) return { regime: 'up', detail: `Sopra SMA50 (SMA200 non disponibile)` }
    return { regime: 'down', detail: `Sotto SMA50 (SMA200 non disponibile)` }
  }

  return { regime: 'unknown', detail: 'Dati insufficienti per calcolo regime' }
}

/**
 * Generate per-strategy monthly commentary in Angelo's tone.
 * Rules-based, deterministic, no AI.
 */
export function generateMonthlyCommentary(s: MonthlyStrategyStats): string {
  // No trades this month
  if (s.monthlyTrades === 0) {
    return `Nessun trade nel mese. Strategia inattiva o senza segnali.`
  }

  // Critical health
  if (s.healthStatus === 'critical') {
    return `Health critica. ${fmtUsd(s.monthlyPl)} in ${s.monthlyTrades} trade. Se il trend continua, candidata alla sospensione.`
  }

  // Best portfolio + strong
  if (s.inBestPortfolio && s.monthlyProfitFactor >= 2) {
    const delta = s.prevMonthPl !== null ? ` (vs ${fmtUsd(s.prevMonthPl)} mese prec.)` : ''
    return `Edge confermato. ${fmtUsd(s.monthlyPl)} in ${s.monthlyTrades} trade, PF ${fmt(s.monthlyProfitFactor)}.${delta} Solida.`
  }

  // Best portfolio
  if (s.inBestPortfolio) {
    const delta = s.prevMonthPl !== null
      ? s.prevMonthPl < 0 ? ' Recupero vs mese precedente.' : ''
      : ''
    return `Nel Best Portfolio. ${fmtUsd(s.monthlyPl)}, WR ${fmt(s.monthlyWinRate, 1)}%, PF ${fmt(s.monthlyProfitFactor)}.${delta}`
  }

  // Too few trades
  if (s.monthlyTrades < 3) {
    return `${s.monthlyTrades} trade — campione insufficiente per valutare il mese.`
  }

  // Positive but excluded for low PF
  if (s.monthlyPl > 0 && s.monthlyProfitFactor < 1.5) {
    return `P/L positivo (${fmtUsd(s.monthlyPl)}) ma PF ${fmt(s.monthlyProfitFactor)}: edge non convincente questo mese.`
  }

  // Positive but excluded for win rate
  if (s.monthlyPl > 0 && s.monthlyWinRate < 50) {
    return `P/L positivo ma WR ${fmt(s.monthlyWinRate, 1)}% sotto soglia. Monitorare consistenza.`
  }

  // Positive but excluded for health/fitness
  if (s.monthlyPl > 0) {
    return `P/L positivo (${fmtUsd(s.monthlyPl)}) ma esclusa dal Best per health/fitness. Monitorare.`
  }

  // Negative + regime mismatch
  if (s.monthlyPl < 0 && s.healthStatus === 'regime_mismatch') {
    const label = s.style === 'trend_following' ? 'trend' : s.style === 'mean_reversion' ? 'mean reversion' : (s.style || 'n/a')
    return `Mese negativo (${fmtUsd(s.monthlyPl)}). Regime sfavorevole per ${label}. Mantenere attiva per validazione.`
  }

  // Negative with recovery vs prev month
  if (s.monthlyPl < 0 && s.prevMonthPl !== null && s.monthlyPl > s.prevMonthPl) {
    return `Negativo (${fmtUsd(s.monthlyPl)}) ma in recupero vs mese precedente (${fmtUsd(s.prevMonthPl)}). Trend in miglioramento.`
  }

  // Negative
  if (s.monthlyPl < 0) {
    return `Mese negativo: ${fmtUsd(s.monthlyPl)} su ${s.monthlyTrades} trade, WR ${fmt(s.monthlyWinRate, 1)}%. Verificare condizioni di mercato.`
  }

  // Default (zero P/L or edge cases)
  return `Operativita' normale. ${s.monthlyTrades} trade, ${fmtUsd(s.monthlyPl)}.`
}

/**
 * Generate per-asset commentary.
 */
export function generateAssetCommentary(summary: MonthlyAssetSummary): string {
  const { asset, assetLabel, totalPl, strategies, regime, regimeDetail } = summary
  const label = assetLabel || asset
  const positive = strategies.filter(s => s.pl > 0)
  const negative = strategies.filter(s => s.pl < 0)

  if (strategies.length === 0) {
    return `${label}: nessun trade nel mese.`
  }

  const regimeSuffix = regime !== 'unknown' ? ` Regime: ${regimeDetail}.` : ''

  if (negative.length === 0 && positive.length > 0) {
    return `${label}: mese favorevole. ${positive.length} ${positive.length === 1 ? 'strategia' : 'strategie'} in profitto, totale ${fmtUsd(totalPl)}.${regimeSuffix}`
  }

  if (positive.length === 0 && negative.length > 0) {
    return `${label}: mese sfavorevole. Nessuna strategia in profitto. Totale ${fmtUsd(totalPl)}.${regimeSuffix}`
  }

  // Mixed
  const best = strategies.reduce((a, b) => a.pl > b.pl ? a : b)
  const worst = strategies.reduce((a, b) => a.pl < b.pl ? a : b)
  return `${label}: misto. ${positive.length}/${strategies.length} positive. Best M${best.magic} (${fmtUsd(best.pl)}), worst M${worst.magic} (${fmtUsd(worst.pl)}).${regimeSuffix}`
}

/**
 * Generate overall portfolio summary text.
 */
export function generatePortfolioSummary(
  best: BestPortfolioResult,
  kpis: MonthlyKPIs,
  prevKpis: MonthlyKPIs | null,
  mode: 'monthly' | 'general',
  periodLabel: string,
): string {
  const parts: string[] = []

  if (mode === 'monthly') {
    const outcome = kpis.totalPl >= 0 ? 'positivo' : 'negativo'
    parts.push(`Mese ${outcome}: ${fmtUsd(kpis.totalPl)} su ${kpis.totalTrades} trade (WR ${fmt(kpis.winRate, 1)}%, PF ${fmt(kpis.profitFactor)}).`)

    if (best.selected.length > 0) {
      parts.push(`Best Portfolio: ${best.selected.length}/${best.selected.length + best.excluded.length} strategie selezionate, ${fmtUsd(best.totalPl)} aggregato.`)
    } else {
      parts.push(`Nessuna strategia soddisfa i criteri Best Portfolio questo mese.`)
    }

    if (prevKpis) {
      const delta = kpis.totalPl - prevKpis.totalPl
      const dir = delta >= 0 ? '+' : ''
      parts.push(`vs mese precedente: ${dir}${fmtUsd(delta)}.`)
    }
  } else {
    // General mode
    parts.push(`Periodo ${periodLabel}: ${fmtUsd(kpis.totalPl)} cumulativo, ${kpis.totalTrades} trade.`)

    if (kpis.cagr !== undefined) {
      parts.push(`CAGR ${fmt(kpis.cagr, 1)}%, DD max ${fmt(kpis.maxDdPct, 1)}%, Recovery ${fmt(kpis.recoveryFactor ?? 0)}.`)
    }

    if (best.selected.length > 0) {
      const top3 = best.selected.slice(0, 3).map(s => `M${s.magic}`).join(', ')
      parts.push(`Core del portafoglio: ${top3}.`)
    }
  }

  parts.push(`Dati da operativita' reale. Le performance passate non garantiscono risultati futuri.`)
  return parts.join(' ')
}

/**
 * Build monthly P/L trend from trades grouped by month.
 */
export function buildMonthlyTrend(
  trades: { net_profit: number; close_time: string }[],
): MonthlyTrendEntry[] {
  const MONTH_NAMES = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']

  const byMonth = new Map<string, number[]>()
  for (const t of trades) {
    const key = t.close_time.slice(0, 7) // YYYY-MM
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key)!.push(Number(t.net_profit))
  }

  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, pnls]) => {
      const wins = pnls.filter(p => p > 0)
      const losses = pnls.filter(p => p < 0)
      const grossProfit = wins.reduce((s, v) => s + v, 0)
      const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0))
      const [y, m] = month.split('-')
      return {
        month,
        monthLabel: `${MONTH_NAMES[parseInt(m) - 1]} ${y}`,
        pl: Math.round(pnls.reduce((s, v) => s + v, 0) * 100) / 100,
        trades: pnls.length,
        winRate: pnls.length > 0 ? Math.round((wins.length / pnls.length) * 1000) / 10 : 0,
        profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? 999 : 0,
      }
    })
}

/**
 * Calculate daily P/L from trades for monthly KPI computation.
 */
export function calcDailyPnl(
  trades: { net_profit: number; close_time: string }[],
): { date: string; pl: number }[] {
  const byDay = new Map<string, number>()
  for (const t of trades) {
    const day = t.close_time.slice(0, 10) // YYYY-MM-DD
    byDay.set(day, (byDay.get(day) || 0) + Number(t.net_profit))
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, pl]) => ({ date, pl: Math.round(pl * 100) / 100 }))
}

/**
 * Generate trend commentary for monthly P/L trend.
 */
export function generateTrendCommentary(trend: MonthlyTrendEntry[]): string {
  if (trend.length === 0) return ''

  const posMonths = trend.filter(m => m.pl > 0).length
  const totalMonths = trend.length
  const winPct = Math.round((posMonths / totalMonths) * 100)

  const bestMonth = trend.reduce((a, b) => a.pl > b.pl ? a : b)
  const worstMonth = trend.reduce((a, b) => a.pl < b.pl ? a : b)

  let maxStreak = 0, streak = 0
  for (const m of trend) {
    if (m.pl > 0) { streak++; if (streak > maxStreak) maxStreak = streak }
    else streak = 0
  }

  const parts: string[] = []
  parts.push(`${posMonths} mesi positivi su ${totalMonths} (${winPct}%).`)
  parts.push(`Miglior mese: ${bestMonth.monthLabel} (${fmtUsd(bestMonth.pl)}). Peggior mese: ${worstMonth.monthLabel} (${fmtUsd(worstMonth.pl)}).`)
  if (maxStreak >= 2) parts.push(`Striscia positiva piu' lunga: ${maxStreak} mesi.`)

  if (trend.length >= 3) {
    const last3 = trend.slice(-3)
    const last3Pl = last3.reduce((s, v) => s + v.pl, 0)
    const allPos = last3.every(m => m.pl > 0)
    const allNeg = last3.every(m => m.pl < 0)

    if (allPos) parts.push(`Ultimi 3 mesi tutti positivi (${fmtUsd(last3Pl)}) — momentum favorevole.`)
    else if (allNeg) parts.push(`Ultimi 3 mesi tutti negativi (${fmtUsd(last3Pl)}) — fase da monitorare.`)

    if (trend.length >= 6) {
      const prev3 = trend.slice(-6, -3)
      const prev3Pl = prev3.reduce((s, v) => s + v.pl, 0)
      const delta = last3Pl - prev3Pl
      if (delta > 50) parts.push(`In miglioramento vs trimestre precedente (+${fmtUsd(delta)}).`)
      else if (delta < -50) parts.push(`In calo vs trimestre precedente (${fmtUsd(delta)}).`)
    }
  }

  return parts.join(' ')
}

/**
 * Generate comprehensive general analysis — multi-paragraph, Italian, Angelo's tone.
 * Returns array of paragraphs for structured rendering.
 */
export function generateGeneralAnalysis(
  stats: MonthlyStrategyStats[],
  assetSummaries: MonthlyAssetSummary[],
  trend: MonthlyTrendEntry[],
  kpis: MonthlyKPIs,
  best: BestPortfolioResult,
): string[] {
  const paragraphs: string[] = []

  // 1. Performance overview
  const outcome = kpis.totalPl >= 0 ? 'positivo' : 'negativo'
  let overview = `Risultato complessivo ${outcome}: ${fmtUsd(kpis.totalPl)} su ${kpis.totalTrades} trade in ${trend.length} mesi di operativita'.`
  if (kpis.cagr !== undefined) {
    overview += ` CAGR ${fmt(kpis.cagr, 1)}%, Sharpe ${fmt(kpis.sharpe ?? 0)}, Recovery Factor ${fmt(kpis.recoveryFactor ?? 0)}, DD max ${fmt(kpis.maxDdPct, 1)}% dell'equity.`
  }
  paragraphs.push(overview)

  // 2. Consistency
  if (trend.length > 0) {
    const posMonths = trend.filter(m => m.pl > 0).length
    const pct = Math.round((posMonths / trend.length) * 100)
    const bestMonth = trend.reduce((a, b) => a.pl > b.pl ? a : b)
    const worstMonth = trend.reduce((a, b) => a.pl < b.pl ? a : b)
    let maxStreak = 0, streak = 0
    for (const m of trend) {
      if (m.pl > 0) { streak++; if (streak > maxStreak) maxStreak = streak }
      else streak = 0
    }
    let consText = `Consistenza: ${posMonths} mesi positivi su ${trend.length} (${pct}%). Miglior mese: ${bestMonth.monthLabel} (${fmtUsd(bestMonth.pl)}). Peggior mese: ${worstMonth.monthLabel} (${fmtUsd(worstMonth.pl)}).`
    if (maxStreak >= 2) consText += ` Striscia positiva piu' lunga: ${maxStreak} mesi.`
    paragraphs.push(consText)
  }

  // 3. Core strategies
  const withTrades = stats.filter(s => s.monthlyTrades >= 5)
  if (withTrades.length > 0) {
    const sorted = [...withTrades].sort((a, b) => b.monthlyPl - a.monthlyPl)
    const top = sorted.slice(0, 3)
    const topPl = top.reduce((s, v) => s + v.monthlyPl, 0)
    const contrib = kpis.totalPl > 0 ? Math.round((topPl / kpis.totalPl) * 100) : 0
    const topDesc = top.map(s => `M${s.magic} ${s.name} (${fmtUsd(s.monthlyPl)})`).join(', ')
    let coreText = `Strategie core per contributo P/L: ${topDesc}.`
    if (contrib > 0 && contrib <= 100) coreText += ` Generano il ${contrib}% del risultato totale.`

    const bottom = sorted.filter(s => s.monthlyPl < -50).slice(-3).reverse()
    if (bottom.length > 0) {
      const bottomDesc = bottom.map(s => `M${s.magic} (${fmtUsd(s.monthlyPl)})`).join(', ')
      coreText += ` Strategie in difficolta': ${bottomDesc} — valutare revisione parametri se il trend negativo persiste.`
    }
    paragraphs.push(coreText)
  }

  // 4. Asset/market analysis
  if (assetSummaries.length > 0) {
    const bestAsset = assetSummaries.reduce((a, b) => a.totalPl > b.totalPl ? a : b)
    const worstAsset = assetSummaries.reduce((a, b) => a.totalPl < b.totalPl ? a : b)
    const contrib = kpis.totalPl > 0 ? Math.round((bestAsset.totalPl / kpis.totalPl) * 100) : 0

    let assetText = `Mercati: ${assetSummaries.length} sottostanti con operativita' significativa. ${bestAsset.assetLabel} il piu' forte (${fmtUsd(bestAsset.totalPl)}${contrib > 0 && contrib <= 100 ? `, ${contrib}% del totale` : ''}).`
    if (worstAsset.totalPl < 0 && worstAsset.asset !== bestAsset.asset) {
      assetText += ` ${worstAsset.assetLabel} il piu' debole (${fmtUsd(worstAsset.totalPl)}).`
    }

    const regimes = assetSummaries.filter(a => a.regime !== 'unknown')
    if (regimes.length > 0) {
      const up = regimes.filter(a => a.regime === 'up').map(a => a.assetLabel)
      const down = regimes.filter(a => a.regime === 'down').map(a => a.assetLabel)
      const range = regimes.filter(a => a.regime === 'range').map(a => a.assetLabel)
      const regParts: string[] = []
      if (up.length > 0) regParts.push(`uptrend: ${up.join(', ')}`)
      if (down.length > 0) regParts.push(`downtrend: ${down.join(', ')}`)
      if (range.length > 0) regParts.push(`range: ${range.join(', ')}`)
      assetText += ` Regimi attuali — ${regParts.join('; ')}.`
    }
    paragraphs.push(assetText)
  }

  // 5. Recent trend
  if (trend.length >= 3) {
    const last3 = trend.slice(-3)
    const last3Pl = last3.reduce((s, v) => s + v.pl, 0)

    let trendText = `Trend recente: ${last3.map(m => `${m.monthLabel} ${fmtUsd(m.pl)}`).join(', ')}.`

    const allPos = last3.every(m => m.pl > 0)
    const allNeg = last3.every(m => m.pl < 0)
    if (allPos) trendText += ' Tre mesi consecutivi positivi — momentum favorevole.'
    else if (allNeg) trendText += ' Tre mesi consecutivi negativi — situazione da monitorare attentamente.'

    if (trend.length >= 6) {
      const prev3 = trend.slice(-6, -3)
      const prev3Pl = prev3.reduce((s, v) => s + v.pl, 0)
      const delta = last3Pl - prev3Pl
      if (delta > 50) trendText += ` In miglioramento vs trimestre precedente (+${fmtUsd(delta)}).`
      else if (delta < -50) trendText += ` In calo vs trimestre precedente (${fmtUsd(delta)}).`
    }
    paragraphs.push(trendText)
  }

  // 6. Best Portfolio
  if (best.selected.length > 0) {
    const total = best.selected.length + best.excluded.length
    paragraphs.push(`Best Portfolio: ${best.selected.length} su ${total} strategie soddisfano i criteri selettivi. P/L aggregato ${fmtUsd(best.totalPl)}, WR medio ${fmt(best.avgWinRate, 1)}%, PF medio ${fmt(best.avgProfitFactor)}. Queste sono le strategie su cui costruire l'allocazione del portafoglio.`)
  } else {
    paragraphs.push(`Nessuna strategia soddisfa attualmente tutti i criteri del Best Portfolio. Necessaria revisione dei parametri o attesa di un ciclo di mercato piu' favorevole.`)
  }

  paragraphs.push(`Dati da operativita' reale — le performance passate non garantiscono risultati futuri.`)

  return paragraphs
}
