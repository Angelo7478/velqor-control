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
  if (strategy.test_max_dd && strategy.real_max_dd) {
    const ratio = strategy.real_max_dd / strategy.test_max_dd
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

/** Pendulum state: detect drawdown phase for a strategy */
export function detectPendulumState(
  recentTrades: { net_profit: number | null }[],
  equityHigh: number,
  currentEquity: number
): { state: 'base' | 'drawdown' | 'recovery'; consecLosses: number; ddFromPeak: number; multiplier: number } {
  // Count consecutive losses from most recent
  let consecLosses = 0
  for (let i = recentTrades.length - 1; i >= 0; i--) {
    if ((recentTrades[i].net_profit ?? 0) < 0) consecLosses++
    else break
  }

  const ddFromPeak = equityHigh > 0 ? ((equityHigh - currentEquity) / equityHigh) * 100 : 0

  let state: 'base' | 'drawdown' | 'recovery' = 'base'
  let multiplier = 1.0

  if (ddFromPeak < 0.5 && consecLosses === 0) {
    // At equity high → reduce to base (Pendulum: reduce at highs)
    state = 'base'
    multiplier = 0.8
  } else if (consecLosses >= 3 || ddFromPeak > 3) {
    // In drawdown → increase (Pendulum: increase during DD)
    state = 'drawdown'
    multiplier = 1.0 + Math.min(consecLosses * 0.1, 0.3) // max 1.3x
  } else {
    state = 'recovery'
    multiplier = 1.0
  }

  return { state, consecLosses, ddFromPeak, multiplier }
}

// --- Portfolio-Level Calculations ---

export interface SizingInput {
  strategyId: string
  magic: number
  name: string
  asset: string
  assetGroup: string | null
  style: string | null
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
  avgRor: number | null
  styleBalance: Record<string, number>
  results: SizingResult[]
}

/** Main sizing engine: compute optimal lots for a portfolio */
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

  // Step 1: Calculate Kelly and raw sizing per strategy
  for (const s of strategies) {
    // Use blended metrics if enough real trades
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

    // RoR at chosen fraction
    const rorPct = (chosenFraction && winPct && payoff)
      ? calcRiskOfRuin(winPct, payoff, chosenFraction, maxDdTargetPct)
      : null

    // Fitness (with confidence)
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

    // Style tracking
    if (s.style) styleCount[s.style] = (styleCount[s.style] || 0) + 1

    results.push({
      strategyId: s.strategyId,
      kellyF,
      halfKelly,
      quarterKelly,
      rorPct,
      ddBudgetPct: 0, // calculated in step 2
      ddBudgetUsd: 0,
      recommendedLots: 0,
      currentLots: s.lotNeutral,
      lotsChangePct: null,
      fitnessScore: fitnessResult.score,
      fitnessDetails: fitnessResult.details,
      fractionMethod: kellyMode,
    })
  }

  // Step 2: Allocate DD budget proportionally to MC95 DD
  const totalMc95 = strategies.reduce((sum, s) => sum + (s.mc95DdScaled ?? s.testMc95Dd ?? 0), 0)

  for (let i = 0; i < strategies.length; i++) {
    const s = strategies[i]
    const r = results[i]
    const mc95 = s.mc95DdScaled ?? s.testMc95Dd ?? 0

    if (totalMc95 > 0 && mc95 > 0) {
      // Equal risk allocation (inverse to DD contribution)
      const equalWeight = 1 / strategies.length
      r.ddBudgetPct = equalWeight * 100
      r.ddBudgetUsd = ddBudgetUsd * equalWeight

      // Recommended lots: DD budget / MC95 per lot, floored
      r.recommendedLots = Math.floor((r.ddBudgetUsd / mc95) * 100) / 100
    }

    // RoR cap: if RoR > 5%, reduce lots iteratively
    if (r.rorPct !== null && r.rorPct > 0.05) {
      r.recommendedLots = Math.floor(r.recommendedLots * 0.9 * 100) / 100
    }

    // Min lot: 0.01
    if (r.recommendedLots < 0.01) r.recommendedLots = 0.01

    // Change %
    if (r.currentLots && r.currentLots > 0) {
      r.lotsChangePct = ((r.recommendedLots - r.currentLots) / r.currentLots) * 100
    }
  }

  // Step 3: Verify total DD fits budget
  let totalDdUsed = 0
  for (let i = 0; i < strategies.length; i++) {
    const mc95 = strategies[i].mc95DdScaled ?? strategies[i].testMc95Dd ?? 0
    totalDdUsed += results[i].recommendedLots * mc95
  }

  // If over budget, scale down proportionally
  if (totalDdUsed > ddBudgetUsd && ddBudgetUsd > 0) {
    const scaleFactor = ddBudgetUsd / totalDdUsed
    for (const r of results) {
      r.recommendedLots = Math.floor(r.recommendedLots * scaleFactor * 100) / 100
      if (r.recommendedLots < 0.01) r.recommendedLots = 0.01
    }
    // Recalculate
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

  // Avg RoR
  const rors = results.filter(r => r.rorPct !== null).map(r => r.rorPct!)
  const avgRor = rors.length > 0 ? rors.reduce((a, b) => a + b, 0) / rors.length : null

  return {
    totalDdBudgetUsedPct: ddBudgetUsd > 0 ? (totalDdUsed / ddBudgetUsd) * 100 : 0,
    totalDdBudgetUsedUsd: Math.round(totalDdUsed * 100) / 100,
    ddBudgetAvailableUsd: Math.round((ddBudgetUsd - totalDdUsed) * 100) / 100,
    strategyCount: strategies.length,
    avgRor,
    styleBalance,
    results,
  }
}

// --- Constants ---

export const FTMO_DAILY_DD_LIMIT = 5
export const FTMO_TOTAL_DD_LIMIT = 10
export const KELLY_MODES = ['half_kelly', 'quarter_kelly', 'full_kelly'] as const
export type KellyMode = typeof KELLY_MODES[number]

export const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']
