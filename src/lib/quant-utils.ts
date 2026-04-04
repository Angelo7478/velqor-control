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

/** Strategy fitness score: compare real vs test metrics (0-100) */
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
}): { score: number; details: Record<string, number> } {
  const { real_trades } = strategy
  // Not enough trades: neutral score
  if (real_trades < 15) return { score: 50, details: { sample: 0 } }

  let score = 100
  const details: Record<string, number> = {}

  // Win rate deviation
  if (strategy.test_win_pct && strategy.real_win_pct) {
    const deviation = ((strategy.real_win_pct - strategy.test_win_pct) / strategy.test_win_pct) * 100
    details.win_pct_dev = Math.round(deviation)
    if (deviation < -20) score -= 30
    else if (deviation < -10) score -= 15
    else if (deviation > 10) score += 5
  }

  // DD breach
  if (strategy.test_max_dd && strategy.real_max_dd) {
    const ratio = strategy.real_max_dd / strategy.test_max_dd
    details.dd_ratio = Math.round(ratio * 100) / 100
    if (ratio > 2.0) score -= 40
    else if (ratio > 1.5) score -= 25
    else if (ratio > 1.0) score -= 10
  }

  // Expectancy deviation
  if (strategy.test_expectancy && strategy.real_expectancy) {
    const deviation = ((strategy.real_expectancy - strategy.test_expectancy) / Math.abs(strategy.test_expectancy)) * 100
    details.exp_dev = Math.round(deviation)
    if (deviation < -50) score -= 25
    else if (deviation < -25) score -= 10
  }

  return { score: Math.max(0, Math.min(100, score)), details }
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

    // Fitness
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
