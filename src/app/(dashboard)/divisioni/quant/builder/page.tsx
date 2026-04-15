'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelStrategy, QelAccount, QelPortfolio, QelPortfolioStrategy } from '@/types/database'
import {
  fmt, fmtUsd, fmtPct, plColor, groupColor, styleColor, styleLabel,
  CHART_COLORS, PORTFOLIO_COLOR,
  buildEquityCurves, TradeForCurve, StrategyEquityCurve, CombinedCurvePoint, PortfolioStats, CurveStats,
  runSizingEngine, SizingInput, PortfolioSizingOutput, KellyMode,
  calcPortfolioMargin, PortfolioMarginResult, DEFAULT_REF_PRICES,
  calcFitnessScore, detectPendulumState,
  generateSizingAdvice, AdvisorInput, AdvisorSummary,
  calcSizingEfficiency, SizingEfficiency,
  calcEquityProjection, EquityProjection,
} from '@/lib/quant-utils'
import QuantNav from '../quant-nav'
import { VELQOR_LOGO_BASE64 } from '@/lib/velqor-logo'
import InfoTooltip from '@/components/ui/InfoTooltip'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Area, ComposedChart,
} from 'recharts'

// ============================================
// Types
// ============================================

interface StrategyRow extends QelStrategy {
  selected: boolean
  baseLots: number     // real avg lots from trades (or lot_neutral fallback)
  userLots: number     // working lots (real, then modified by optimize/manual)
  manualOverride: boolean // true if user manually changed lots
  realAvgLots: number  // actual average lots from trades on this account (0 if no trades)
  chartColor: string
  visible: boolean
  tradeCount: number
  realPnlOnAccount: number
}

interface SavedPortfolio {
  id: string
  name: string
  account_id: string | null
  equity_base: number
  strategies: { strategy_id: string; lot_override: number | null; final_lots: number | null }[]
}

// ============================================
// Component
// ============================================

export default function BuilderPage() {
  const [strategies, setStrategies] = useState<StrategyRow[]>([])
  const [trades, setTrades] = useState<TradeForCurve[]>([])
  const [accounts, setAccounts] = useState<QelAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [equityBase, setEquityBase] = useState(10000)
  const [sourceAccountSize, setSourceAccountSize] = useState(10000) // equity of the account trades come from
  const [showCombined, setShowCombined] = useState(true)
  const [chartMode, setChartMode] = useState<'portfolio' | 'individual'>('portfolio')
  const [selectedStratForDetail, setSelectedStratForDetail] = useState<string | null>(null)

  // Sizing engine
  const [sizingMode, setSizingMode] = useState<'proportional' | 'optimized'>('proportional')
  const [kellyMode, setKellyMode] = useState<KellyMode>('half_kelly')
  const [maxDdPct, setMaxDdPct] = useState(10)
  const [safetyFactor, setSafetyFactor] = useState(0.5)
  const [sizingOutput, setSizingOutput] = useState<PortfolioSizingOutput | null>(null)

  // v4 rolling windows: null = all time, number = days to look back.
  // The window filters the per-strategy aggregates (tradeCount, P/L, avgLots,
  // Kelly inputs) so sizing reflects the recent regime instead of lifetime
  // averages. Thresholds: 30 = aggressive recency, 90 = quarterly, 120 = mid,
  // null = institutional baseline.
  const [windowDays, setWindowDays] = useState<number | null>(null)

  // PTF state
  const [savedPortfolios, setSavedPortfolios] = useState<SavedPortfolio[]>([])
  const [ptfName, setPtfName] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingPtf, setLoadingPtf] = useState(false)

  // Margin
  const [refPrices, setRefPrices] = useState<Map<string, number>>(new Map())

  // ---- Load data ----
  useEffect(() => { loadAccounts() }, [])

  async function loadAccounts() {
    const supabase = createClient()
    const { data } = await supabase
      .from('qel_accounts')
      .select('*')
      .in('status', ['active', 'funded', 'challenge', 'verification'])
      .order('name')
    if (data) {
      setAccounts(data)
      if (data.length > 0) {
        setSelectedAccountId(data[0].id)
        setEquityBase(data[0].account_size)
      }
    }
  }

  useEffect(() => {
    if (selectedAccountId) loadData()
  }, [selectedAccountId])

  async function loadData() {
    setLoading(true)
    // Clear stale data immediately to prevent mismatched state
    setTrades([])
    setRefPrices(new Map())

    const supabase = createClient()

    // Load strategies
    const { data: strats, error: stratsErr } = await supabase
      .from('qel_strategies')
      .select('*')
      .in('status', ['active', 'paused'])
      .order('magic')

    if (stratsErr) console.error('[Builder] strategies query error:', stratsErr)

    // Load closed trades for selected account
    const { data: tradeData, error: tradesErr } = await supabase
      .from('qel_trades')
      .select('strategy_id, net_profit, lots, close_time, symbol, open_price')
      .eq('account_id', selectedAccountId)
      .eq('is_open', false)
      .not('strategy_id', 'is', null)
      .not('close_time', 'is', null)
      .order('close_time')

    if (tradesErr) console.error('[Builder] trades query error:', tradesErr)

    // Load saved portfolios
    const { data: ptfs } = await supabase
      .from('qel_portfolios')
      .select('id, name, account_id, equity_base')
      .order('name')

    const ptfList: SavedPortfolio[] = []
    if (ptfs) {
      for (const p of ptfs) {
        const { data: ps } = await supabase
          .from('qel_portfolio_strategies')
          .select('strategy_id, lot_override, final_lots')
          .eq('portfolio_id', p.id)
        ptfList.push({ ...p, strategies: ps || [] })
      }
    }
    setSavedPortfolios(ptfList)

    // Aggregate per-strategy stats from trades (P/L, count, avg lots)
    const stratStats = new Map<string, { total: number; count: number; lotsSum: number }>()
    const tradeRows = tradeData ?? []
    for (const t of tradeRows) {
      if (!t.strategy_id) continue
      if (!stratStats.has(t.strategy_id)) stratStats.set(t.strategy_id, { total: 0, count: 0, lotsSum: 0 })
      const e = stratStats.get(t.strategy_id)!
      e.total += Number(t.net_profit ?? 0)
      e.count++
      e.lotsSum += Number(t.lots ?? 0)
    }

    // Remember source account size for auto-scaling
    const srcAcc = accounts.find(a => a.id === selectedAccountId)
    const srcSize = srcAcc?.account_size || 10000
    setSourceAccountSize(srcSize)

    // Log loaded data for debugging
    const totalLoadedTrades = tradeRows.length
    const strategiesWithTrades = [...stratStats.entries()].map(([id, s]) => ({ id, count: s.count, pnl: Math.round(s.total) }))
    const totalPnl = strategiesWithTrades.reduce((s, x) => s + x.pnl, 0)
    console.log(`[Builder] Account ${srcAcc?.name}: ${totalLoadedTrades} trades loaded, ${strategiesWithTrades.length} strategies with trades, P/L $${totalPnl}`, strategiesWithTrades)

    if (strats) {
      setStrategies(strats.map((s, i) => {
        const stats = stratStats.get(s.id)
        // Use real avg lots from trades on this account (best source of truth)
        const realAvg = stats && stats.count > 0 ? stats.lotsSum / stats.count : 0
        // baseLots: real avg lots if available, else lot_neutral scaled to target equity
        const dbLots = s.lot_neutral ?? s.lot_static ?? 0.01
        const base = realAvg > 0 ? realAvg : dbLots
        return {
          ...s,
          selected: s.include_in_portfolio && s.status === 'active',
          baseLots: base,
          userLots: Math.max(0.01, Math.round(base * 1000) / 1000),
          manualOverride: false,
          realAvgLots: realAvg,
          chartColor: CHART_COLORS[i % CHART_COLORS.length],
          visible: true,
          tradeCount: stats?.count ?? 0,
          realPnlOnAccount: stats?.total ?? 0,
        }
      }))
    }

    // Always update trades (empty array if query failed — prevents stale data)
    setTrades(tradeRows.map(t => ({
      strategy_id: t.strategy_id!,
      net_profit: Number(t.net_profit ?? 0),
      lots: Number(t.lots),
      close_time: t.close_time!,
      symbol: t.symbol,
      open_price: t.open_price != null ? Number(t.open_price) : undefined,
    })))

    // Build reference prices per symbol (avg open_price from trades)
    const priceAgg = new Map<string, { sum: number; count: number }>()
    for (const t of tradeRows) {
      if (t.open_price == null || Number(t.open_price) <= 0) continue
      const sym = t.symbol
      if (!priceAgg.has(sym)) priceAgg.set(sym, { sum: 0, count: 0 })
      const e = priceAgg.get(sym)!
      e.sum += Number(t.open_price)
      e.count++
    }
    const priceMap = new Map<string, number>()
    for (const [sym, agg] of priceAgg) {
      priceMap.set(sym, agg.count > 0 ? agg.sum / agg.count : (DEFAULT_REF_PRICES[sym] ?? 0))
    }
    setRefPrices(priceMap)

    setLoading(false)
  }

  // ---- Auto-scale lots when equityBase changes ----
  useEffect(() => {
    if (sourceAccountSize === 0 || strategies.length === 0) return
    const scale = equityBase / sourceAccountSize
    setStrategies(prev => prev.map(s => {
      if (s.manualOverride) return s // don't touch manually overridden lots
      // Scale from baseLots (real avg or lot_neutral) proportionally to equity change
      return { ...s, userLots: Math.max(0.01, Math.round(s.baseLots * scale * 1000) / 1000) }
    }))
  }, [equityBase, sourceAccountSize])

  // ---- v4 rolling window: trades filtered by time ----
  // When windowDays is null the full trade history is used (baseline).
  // When set to N, only trades with close_time in the last N days survive.
  // All downstream calculations (tradeCount, realPnlOnAccount, realAvgLots,
  // calcPerAccountStats for Kelly, equity curves, margin) derive from this.
  const effectiveTrades = useMemo(() => {
    if (windowDays == null) return trades
    const cutoffMs = Date.now() - windowDays * 86_400_000
    return trades.filter(t => {
      const ts = Date.parse(t.close_time)
      return Number.isFinite(ts) && ts >= cutoffMs
    })
  }, [trades, windowDays])

  // Rebuild per-strategy aggregates whenever the window changes.
  // Keeps tradeCount / realPnlOnAccount / realAvgLots in sync with the
  // currently active window so the table columns and the sizing engine
  // always agree on "what counts as real data right now".
  useEffect(() => {
    if (trades.length === 0 && windowDays == null) return
    const stratStats = new Map<string, { total: number; count: number; lotsSum: number }>()
    for (const t of effectiveTrades) {
      if (!t.strategy_id) continue
      if (!stratStats.has(t.strategy_id)) stratStats.set(t.strategy_id, { total: 0, count: 0, lotsSum: 0 })
      const e = stratStats.get(t.strategy_id)!
      e.total += Number(t.net_profit ?? 0)
      e.count++
      e.lotsSum += Number(t.lots ?? 0)
    }
    setStrategies(prev => prev.map(s => {
      const stats = stratStats.get(s.id)
      const realAvg = stats && stats.count > 0 ? stats.lotsSum / stats.count : 0
      return {
        ...s,
        realAvgLots: realAvg,
        tradeCount: stats?.count ?? 0,
        realPnlOnAccount: stats?.total ?? 0,
      }
    }))
  }, [effectiveTrades, windowDays])

  // ---- Equity curves (memoized) ----
  const curveData = useMemo(() => {
    const selected = strategies.filter(s => s.selected && s.tradeCount > 0)
    if (selected.length === 0 || effectiveTrades.length === 0) return null

    const stratMap = new Map<string, { magic: number; name: string; userLots: number; color: string }>()
    for (const s of selected) {
      stratMap.set(s.id, { magic: s.magic, name: s.name || `M${s.magic}`, userLots: s.userLots, color: s.chartColor })
    }

    return buildEquityCurves(effectiveTrades, stratMap, equityBase)
  }, [strategies, effectiveTrades, equityBase])

  // ---- Margin calculation (memoized) ----
  const marginData = useMemo<PortfolioMarginResult | null>(() => {
    const selected = strategies.filter(s => s.selected)
    if (selected.length === 0) return null

    const inputs = selected.map(s => ({
      symbol: s.asset,
      lots: s.userLots,
      refPrice: refPrices.get(s.asset) ?? DEFAULT_REF_PRICES[s.asset] ?? 0,
    }))

    return calcPortfolioMargin(inputs, equityBase)
  }, [strategies, equityBase, refPrices])

  // ---- Sizing Advisor (memoized) — analyzes ALL active strategies independently ----
  const advisorData = useMemo<AdvisorSummary | null>(() => {
    const active = strategies.filter(s => s.status === 'active')
    if (active.length === 0 || effectiveTrades.length === 0) return null

    const inputs: AdvisorInput[] = active.map(s => {
      // Compute per-strategy stats from trades (v4: windowed)
      const stratTrades = effectiveTrades.filter(t => t.strategy_id === s.id)
      const wins = stratTrades.filter(t => t.net_profit > 0)
      const losses = stratTrades.filter(t => t.net_profit <= 0)
      const totalPl = stratTrades.reduce((sum, t) => sum + t.net_profit, 0)
      const realWinPct = stratTrades.length > 0 ? (wins.length / stratTrades.length) * 100 : null
      const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.net_profit, 0) / wins.length : 0
      const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.net_profit, 0) / losses.length) : 0
      const realPayoff = avgLoss > 0 ? avgWin / avgLoss : null
      const realExpectancy = stratTrades.length > 0 ? totalPl / stratTrades.length : null

      // Max DD from equity curve
      let peak = 0, maxDd = 0, cumPnl = 0
      for (const t of stratTrades) {
        cumPnl += t.net_profit
        if (cumPnl > peak) peak = cumPnl
        const dd = peak - cumPnl
        if (dd > maxDd) maxDd = dd
      }

      // Consecutive losses (from end of trade series)
      let consecLosses = 0
      for (let i = stratTrades.length - 1; i >= 0; i--) {
        if (stratTrades[i].net_profit <= 0) consecLosses++
        else break
      }

      // DD from peak
      const ddFromPeak = peak > 0 ? ((peak - cumPnl) / peak) * 100 : 0

      // Fitness
      const fitness = calcFitnessScore({
        test_win_pct: s.test_win_pct, test_payoff: s.test_payoff,
        test_max_dd: s.test_max_dd, test_expectancy: s.test_expectancy,
        real_win_pct: realWinPct, real_payoff: realPayoff,
        real_max_dd: maxDd, real_expectancy: realExpectancy,
        real_trades: stratTrades.length,
      })

      // Pendulum
      const isOutperforming = (realExpectancy ?? 0) >= 0 && totalPl > 0
      const pendulum = detectPendulumState(consecLosses, cumPnl, peak, isOutperforming)

      return {
        strategyId: s.id,
        magic: s.magic,
        name: s.name || `M${s.magic}`,
        style: s.strategy_style,
        fitnessScore: fitness.score,
        fitnessConfidence: fitness.confidence,
        realTrades: stratTrades.length,
        realWinPct,
        testWinPct: s.test_win_pct,
        realExpectancy,
        testExpectancy: s.test_expectancy,
        realPl: totalPl,
        realMaxDd: maxDd,
        testMaxDd: s.test_max_dd,
        consecLosses,
        ddFromPeak,
        pendulumMultiplier: pendulum.multiplier,
        pendulumState: pendulum.state,
        currentLots: s.userLots,
      }
    })

    return generateSizingAdvice(inputs)
  }, [strategies, effectiveTrades])

  // ---- Sizing Efficiency + Equity Projection (memoized) ----
  const projectionData = useMemo<{ efficiency: SizingEfficiency; projection: EquityProjection } | null>(() => {
    const selected = strategies.filter(s => s.selected && s.tradeCount > 0)
    if (selected.length === 0 || effectiveTrades.length === 0) return null

    // Build monthly P/L from combined portfolio trades, scaled to builder lots
    // Pre-compute lot scale per strategy (same logic as buildEquityCurves)
    const lotScaleMap = new Map<string, number>()
    for (const s of selected) {
      const stratTrades = effectiveTrades.filter(t => t.strategy_id === s.id)
      const avgLots = stratTrades.length > 0
        ? stratTrades.reduce((sum, t) => sum + t.lots, 0) / stratTrades.length
        : 0
      lotScaleMap.set(s.id, avgLots > 0 ? s.userLots / avgLots : 1)
    }

    const monthlyPnl = new Map<string, number>()
    let totalTradeCount = 0
    for (const t of effectiveTrades) {
      if (!selected.some(s => s.id === t.strategy_id)) continue
      const scale = lotScaleMap.get(t.strategy_id) ?? 1
      const ym = t.close_time.slice(0, 7) // YYYY-MM
      monthlyPnl.set(ym, (monthlyPnl.get(ym) || 0) + t.net_profit * scale)
      totalTradeCount++
    }
    const monthlyReturns = [...monthlyPnl.values()]
    const monthsOfData = monthlyReturns.length
    const tradesPerMonth = monthsOfData > 0 ? totalTradeCount / monthsOfData : 0

    // Sizing efficiency: compare REAL avg lots from trades vs optimized lots
    const effInputs = selected.map(s => {
      const stratTrades = trades.filter(t => t.strategy_id === s.id)
      const totalPl = stratTrades.reduce((sum, t) => sum + t.net_profit, 0)
      // Real average lots from actual trade data
      const realAvgLots = stratTrades.length > 0
        ? stratTrades.reduce((sum, t) => sum + t.lots, 0) / stratTrades.length
        : s.baseLots
      // Optimized lots from Kelly/HRP engine
      const optLots = sizingOutput?.results.find(r => r.strategyId === s.id)?.recommendedLots ?? s.userLots
      // Max DD from real trades (at real lots)
      let peak = 0, maxDd = 0, cumPl = 0
      for (const t of stratTrades) {
        cumPl += t.net_profit
        if (cumPl > peak) peak = cumPl
        const dd = peak - cumPl
        if (dd > maxDd) maxDd = dd
      }
      return {
        strategyId: s.id,
        magic: s.magic,
        name: s.name || 'M' + s.magic,
        realAvgLots,
        optimizedLots: optLots,
        realPnl: totalPl,
        trades: stratTrades.length,
        realMaxDd: maxDd,
      }
    })

    // Portfolio max DD at builder lots (from equity curves)
    const portfolioMaxDd = curveData?.portfolioStats?.maxDd ?? 0
    const efficiency = calcSizingEfficiency(effInputs, portfolioMaxDd, equityBase)
    const projection = calcEquityProjection(monthlyReturns, equityBase, tradesPerMonth)

    return { efficiency, projection }
  }, [strategies, effectiveTrades, equityBase, sizingOutput, curveData])

  // ---- Apply advisor portfolio: select/deselect strategies + set lots ----
  function applyAdvisorPortfolio() {
    if (!advisorData) return
    const includedIds = new Set(advisorData.included.map(r => r.strategyId))
    setStrategies(prev => prev.map(s => {
      const inc = advisorData.included.find(r => r.strategyId === s.id)
      if (inc) {
        // Include: select + set suggested lots
        return { ...s, selected: true, userLots: inc.suggestedLots, manualOverride: true }
      }
      const exc = advisorData.excluded.find(r => r.strategyId === s.id)
      if (exc) {
        // Exclude: deselect
        return { ...s, selected: false }
      }
      // Not analyzed (e.g. paused) — leave unchanged
      return s
    }))
  }

  // ---- Handlers ----
  function toggleStrategy(id: string) {
    setStrategies(prev => prev.map(s => s.id === id ? { ...s, selected: !s.selected } : s))
  }

  function toggleVisibility(id: string) {
    setStrategies(prev => prev.map(s => s.id === id ? { ...s, visible: !s.visible } : s))
  }

  function setLots(id: string, lots: number) {
    setStrategies(prev => prev.map(s => s.id === id ? { ...s, userLots: Math.max(0.01, lots), manualOverride: true } : s))
  }

  function selectAll() {
    setStrategies(prev => prev.map(s => s.status === 'active' ? { ...s, selected: true } : s))
  }
  function selectNone() {
    setStrategies(prev => prev.map(s => ({ ...s, selected: false })))
  }
  function selectProfitable() {
    setStrategies(prev => prev.map(s => ({
      ...s,
      selected: s.status === 'active' && s.tradeCount >= 5 && s.realPnlOnAccount > 0,
    })))
  }

  function handleAccountChange(accId: string) {
    setSelectedAccountId(accId)
    const acc = accounts.find(a => a.id === accId)
    if (acc) setEquityBase(acc.account_size)
  }

  function applyMultiplier(mult: number) {
    setStrategies(prev => prev.map(s => s.selected
      ? { ...s, userLots: Math.max(0.01, Math.round(s.userLots * mult * 1000) / 1000), manualOverride: true }
      : s
    ))
  }

  function resetLotsToDefault() {
    const scale = sourceAccountSize > 0 ? equityBase / sourceAccountSize : 1
    setStrategies(prev => prev.map(s => ({
      ...s,
      userLots: Math.max(0.01, Math.round(s.baseLots * scale * 1000) / 1000),
      manualOverride: false,
    })))
    setSizingMode('proportional')
    setSizingOutput(null)
  }

  /**
   * Compute per-account strategy stats from the loaded trades.
   * CRITICAL: never mix dollar metrics across different account sizes.
   */
  function calcPerAccountStats(stratId: string) {
    // v4: use effectiveTrades so rolling windows propagate into Kelly inputs
    const stratTrades = effectiveTrades.filter(t => t.strategy_id === stratId)
    if (stratTrades.length === 0) return null
    const wins = stratTrades.filter(t => t.net_profit > 0)
    const losses = stratTrades.filter(t => t.net_profit <= 0)
    const winPct = (wins.length / stratTrades.length) * 100
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.net_profit, 0) / wins.length : 0
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.net_profit, 0) / losses.length) : 0
    const payoff = avgLoss > 0 ? avgWin / avgLoss : null
    const expectancy = stratTrades.reduce((s, t) => s + t.net_profit, 0) / stratTrades.length
    const totalPl = stratTrades.reduce((s, t) => s + t.net_profit, 0)

    // Max DD from trade sequence
    let peak = 0, maxDd = 0, cumPl = 0
    for (const t of stratTrades) {
      cumPl += t.net_profit
      if (cumPl > peak) peak = cumPl
      const dd = peak - cumPl
      if (dd > maxDd) maxDd = dd
    }

    return { trades: stratTrades.length, winPct, payoff, expectancy, maxDd, totalPl, hasLosses: losses.length > 0 }
  }

  /** Run sizing engine: Kelly + HRP + DD budget → optimal lots */
  function optimizeLots() {
    const selected = strategies.filter(s => s.selected)
    if (selected.length === 0) return

    // Use per-account stats (from loaded trades) instead of aggregated real_* fields
    const inputs: SizingInput[] = selected.map(s => {
      const acctStats = calcPerAccountStats(s.id)
      return {
        strategyId: s.id,
        magic: s.magic,
        name: s.name || `M${s.magic}`,
        asset: s.asset,
        assetGroup: s.asset_group,
        style: s.strategy_style,
        family: s.strategy_family,
        testWinPct: s.test_win_pct,
        testPayoff: s.test_payoff,
        testMc95Dd: s.test_mc95_dd,
        mc95DdScaled: s.mc95_dd_scaled,
        testExpectancy: s.test_expectancy,
        testMaxDd: s.test_max_dd,
        // Per-account stats override aggregated values
        realTrades: acctStats?.trades ?? 0,
        realWinPct: acctStats?.winPct ?? null,
        realPayoff: acctStats?.payoff ?? null,
        realMaxDd: acctStats?.maxDd ?? 0,
        realExpectancy: acctStats?.expectancy ?? null,
        realPl: acctStats?.totalPl ?? 0,
        realHasLosses: acctStats?.hasLosses ?? false,
        lotNeutral: s.lot_neutral,
        overlapMed: s.test_overlap_med,
      }
    })

    const result = runSizingEngine(inputs, equityBase, maxDdPct, safetyFactor, kellyMode)
    setSizingOutput(result)
    setSizingMode('optimized')

    // Apply optimized lots to strategies
    const lotsMap = new Map(result.results.map(r => [r.strategyId, r.recommendedLots]))
    setStrategies(prev => prev.map(s => {
      const optLots = lotsMap.get(s.id)
      if (optLots !== undefined && s.selected) {
        return { ...s, userLots: optLots, manualOverride: true }
      }
      return s
    }))
  }

  // ---- Save PTF ----
  async function savePTF() {
    const selected = strategies.filter(s => s.selected)
    if (selected.length === 0 || !ptfName.trim()) return
    setSaving(true)

    const supabase = createClient()
    const acc = accounts.find(a => a.id === selectedAccountId)

    const { data: ptf, error } = await supabase
      .from('qel_portfolios')
      .insert({
        org_id: acc?.org_id || strategies[0]?.org_id || '',
        account_id: selectedAccountId || null,
        name: ptfName.trim(),
        sizing_mode: 'preset',
        equity_base: equityBase,
        max_dd_target_pct: 10,
        daily_dd_limit_pct: 5,
        operational_rd_pct: 0,
        safety_factor: 0.5,
        is_active: true,
      })
      .select()
      .single()

    if (ptf) {
      const rows = selected.map(s => ({
        portfolio_id: ptf.id,
        strategy_id: s.id,
        is_active: true,
        lot_override: s.userLots,
        final_lots: s.userLots,
      }))
      await supabase.from('qel_portfolio_strategies').insert(rows)

      setSavedPortfolios(prev => [...prev, {
        id: ptf.id,
        name: ptf.name,
        account_id: ptf.account_id,
        equity_base: ptf.equity_base,
        strategies: rows.map(r => ({ strategy_id: r.strategy_id, lot_override: r.lot_override, final_lots: r.final_lots })),
      }])
      setPtfName('')
    }
    setSaving(false)
  }

  // ---- Load PTF ----
  async function loadPTF(ptf: SavedPortfolio) {
    setLoadingPtf(true)

    // Select strategies and set lots from PTF (these are manual overrides)
    setStrategies(prev => prev.map(s => {
      const ps = ptf.strategies.find(p => p.strategy_id === s.id)
      if (ps) {
        const lots = ps.lot_override ?? ps.final_lots ?? s.userLots
        return { ...s, selected: true, userLots: lots, manualOverride: true, visible: true }
      }
      return { ...s, selected: false }
    }))

    if (ptf.equity_base) setEquityBase(ptf.equity_base)
    if (ptf.account_id && ptf.account_id !== selectedAccountId) {
      setSelectedAccountId(ptf.account_id)
    }

    setLoadingPtf(false)
  }

  // ---- Delete PTF ----
  async function deletePTF(ptfId: string) {
    const supabase = createClient()
    await supabase.from('qel_portfolio_strategies').delete().eq('portfolio_id', ptfId)
    await supabase.from('qel_portfolios').delete().eq('id', ptfId)
    setSavedPortfolios(prev => prev.filter(p => p.id !== ptfId))
  }

  // ---- Export config ----
  function exportConfig() {
    const selected = strategies.filter(s => s.selected)
    const config = selected.map(s => ({
      magic: s.magic,
      name: s.name,
      asset: s.asset,
      lots: s.userLots,
      family: s.strategy_family,
    }))
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ptf_${ptfName || 'config'}_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ---- Generate full report ----
  function generateReport() {
    if (!curveData || curveData.curves.length === 0) return
    const acc = accounts.find(a => a.id === selectedAccountId)
    const ps = curveData.portfolioStats
    const returnPct = equityBase > 0 ? (ps.totalPnl / equityBase) * 100 : 0
    const dateNow = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })

    // Real P/L = raw sum of net_profit from trades (not scaled by builder lots)
    const selected = strategies.filter(s => s.selected && s.tradeCount > 0)
    const realTotalPnl = selected.reduce((sum, s) => sum + s.realPnlOnAccount, 0)
    const realReturnPct = equityBase > 0 ? (realTotalPnl / equityBase) * 100 : 0

    // Group by style and family
    const byStyle: Record<string, { count: number; pnl: number }> = {}
    const byFamily: Record<string, { count: number; pnl: number; lots: number }> = {}
    const byAsset: Record<string, { count: number; pnl: number }> = {}
    for (const c of curveData.curves) {
      const strat = strategies.find(s => s.id === c.strategyId)
      const style = strat?.strategy_style || 'other'
      const family = strat?.strategy_family || `solo_M${c.magic}`
      const asset = strat?.asset_group || strat?.asset || 'other'
      if (!byStyle[style]) byStyle[style] = { count: 0, pnl: 0 }
      byStyle[style].count++
      byStyle[style].pnl += c.stats.totalPnl
      if (!byFamily[family]) byFamily[family] = { count: 0, pnl: 0, lots: 0 }
      byFamily[family].count++
      byFamily[family].pnl += c.stats.totalPnl
      byFamily[family].lots += c.userLots
      if (!byAsset[asset]) byAsset[asset] = { count: 0, pnl: 0 }
      byAsset[asset].count++
      byAsset[asset].pnl += c.stats.totalPnl
    }

    const fmtR = (n: number, d = 2) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
    const fmtM = (n: number) => { const p = n >= 0 ? '' : '-'; return `${p}$${Math.abs(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` }
    const plC = (n: number) => n > 0 ? '#16a34a' : n < 0 ? '#dc2626' : '#475569'

    // --- Temporal analysis ---
    const allDates = curveData.combined.map(p => p.closeTime).sort()
    const firstDate = allDates[0] || ''
    const lastDate = allDates[allDates.length - 1] || ''
    const firstD = new Date(firstDate)
    const lastD = new Date(lastDate)
    const durationDays = Math.max(1, Math.round((lastD.getTime() - firstD.getTime()) / 86400000))
    const durationMonths = Math.max(0.1, durationDays / 30.44)

    const pnlPerMonth = ps.totalPnl / durationMonths
    const pnlPerMonthPct = returnPct / durationMonths
    const tradesPerMonth = ps.totalTrades / durationMonths
    const annualizedReturn = pnlPerMonthPct * 12
    const annualizedPnl = pnlPerMonth * 12

    // Monthly breakdown
    const monthlyPnl = new Map<string, number>()
    for (const p of curveData.combined) {
      const key = p.closeTime.slice(0, 7) // YYYY-MM
      monthlyPnl.set(key, (monthlyPnl.get(key) || 0) + (p.pnl || 0))
    }
    const monthlyEntries = [...monthlyPnl.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const bestMonth = monthlyEntries.length > 0 ? monthlyEntries.reduce((best, e) => e[1] > best[1] ? e : best) : null
    const worstMonth = monthlyEntries.length > 0 ? monthlyEntries.reduce((worst, e) => e[1] < worst[1] ? e : worst) : null
    const profitableMonths = monthlyEntries.filter(e => e[1] > 0).length
    const totalMonths = monthlyEntries.length

    const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
    const fmtMonthLabel = (ym: string) => {
      const [y, m] = ym.split('-')
      const mNames = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
      return `${mNames[parseInt(m) - 1]} ${y}`
    }

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>VELQOR Quant — Portfolio Report</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; font-size: 11px; line-height: 1.5; background: #fff; }
  .page { max-width: 800px; margin: 0 auto; padding: 20px; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 2px; }
  h2 { font-size: 14px; font-weight: 600; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; color: #334155; }
  h3 { font-size: 12px; font-weight: 600; margin: 12px 0 6px; color: #475569; }
  .subtitle { color: #64748b; font-size: 12px; margin-bottom: 15px; }
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
  .logo-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .logo-img { width: 40px; height: 40px; object-fit: contain; }
  .logo-text { font-size: 14px; font-weight: 800; color: #0f172a; letter-spacing: 3px; }
  .logo-sub { font-size: 9px; font-weight: 500; color: #6366f1; letter-spacing: 1.5px; text-transform: uppercase; }
  .meta { text-align: right; color: #94a3b8; font-size: 10px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px; }
  .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; }
  .kpi-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; }
  .kpi-value { font-size: 16px; font-weight: 700; font-family: 'SF Mono', Monaco, monospace; margin-top: 2px; }
  .kpi-sub { font-size: 9px; color: #94a3b8; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 10px; }
  th { background: #f8fafc; text-align: left; padding: 6px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; border-bottom: 2px solid #e2e8f0; }
  td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; font-family: 'SF Mono', Monaco, monospace; }
  tr:hover { background: #f8fafc; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .bold { font-weight: 700; }
  .positive { color: #16a34a; }
  .negative { color: #dc2626; }
  .neutral { color: #475569; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 9px; font-weight: 500; }
  .badge-mr { background: #eef2ff; color: #4338ca; }
  .badge-tf { background: #ecfdf5; color: #059669; }
  .badge-se { background: #fffbeb; color: #b45309; }
  .badge-hy { background: #f8fafc; color: #475569; }
  .section-risk { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; margin: 12px 0; }
  .section-note { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px; margin: 12px 0; }
  .bar-container { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
  .bar-label { width: 60px; font-size: 10px; font-family: monospace; color: #64748b; }
  .bar-track { flex: 1; height: 14px; background: #f1f5f9; border-radius: 4px; position: relative; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; }
  .bar-value { width: 55px; text-align: right; font-size: 10px; font-family: monospace; font-weight: 600; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 9px; text-align: center; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
  @media print { .no-print { display: none; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header-row">
    <div>
      <div class="logo-row">
        <img src="data:image/png;base64,${VELQOR_LOGO_BASE64}" class="logo-img" />
        <div>
          <div class="logo-text">VELQOR</div>
          <div class="logo-sub">Intelligent Quant System</div>
        </div>
      </div>
      <h1>Portfolio Simulation Report</h1>
      <div class="subtitle">${ptfName || 'Simulazione'} — ${acc?.name || 'N/A'} — ${dateNow}</div>
    </div>
    <div class="meta">
      <div>Equity Base: <strong>${fmtM(equityBase)}</strong></div>
      <div>Sizing: <strong>${sizingMode === 'optimized' ? `${kellyMode === 'half_kelly' ? '½ Kelly' : kellyMode === 'quarter_kelly' ? '¼ Kelly' : 'Full Kelly'} + HRP` : `Proporzionale (${fmtR(equityBase / sourceAccountSize, 0)}x)`}</strong></div>
      ${sizingMode === 'optimized' ? `<div>DD Budget: <strong>${fmtM(equityBase * maxDdPct / 100 * safetyFactor)}</strong> (${fmtR(maxDdPct * safetyFactor, 0)}%)</div>` : ''}
      <div>Strategie: <strong>${curveData.curves.length}</strong> | Trade: <strong>${ps.totalTrades}</strong></div>
      <div style="margin-top:4px"><button class="no-print" onclick="window.print()" style="padding:4px 12px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-size:11px">Stampa / PDF</button></div>
    </div>
  </div>

  <!-- KPI principali -->
  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">P/L Reale (netto)</div>
      <div class="kpi-value" style="color:${plC(realTotalPnl)}">${fmtM(realTotalPnl)}</div>
      <div class="kpi-sub">${fmtR(realReturnPct, 1)}% rendimento | Scalato: ${fmtM(ps.totalPnl)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Max Drawdown</div>
      <div class="kpi-value" style="color:#dc2626">${fmtM(ps.maxDd)}</div>
      <div class="kpi-sub">${fmtR(ps.maxDdPct, 1)}% dell'equity</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Profit Factor</div>
      <div class="kpi-value" style="color:${ps.profitFactor >= 1 ? '#16a34a' : '#dc2626'}">${fmtR(ps.profitFactor, 2)}</div>
      <div class="kpi-sub">Win Rate ${fmtR(ps.winRate, 1)}%</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Sharpe Ratio</div>
      <div class="kpi-value" style="color:${ps.sharpe >= 0.5 ? '#16a34a' : ps.sharpe >= 0 ? '#b45309' : '#dc2626'}">${fmtR(ps.sharpe, 2)}</div>
      <div class="kpi-sub">Recovery ${fmtR(ps.recoveryFactor, 2)}</div>
    </div>
  </div>

  <!-- Metriche dettagliate -->
  <div class="grid-2">
    <div>
      <h3>Performance</h3>
      <table>
        <tr><td>Trade totali</td><td class="text-right bold">${ps.totalTrades}</td></tr>
        <tr><td>Media per trade</td><td class="text-right" style="color:${plC(ps.avgTrade)}">${fmtM(ps.avgTrade)}</td></tr>
        <tr><td>Media vincite</td><td class="text-right positive">${fmtM(ps.avgWin)}</td></tr>
        <tr><td>Media perdite</td><td class="text-right negative">${fmtM(ps.avgLoss)}</td></tr>
        <tr><td>Best trade</td><td class="text-right positive">${fmtM(ps.bestTrade)}</td></tr>
        <tr><td>Worst trade</td><td class="text-right negative">${fmtM(ps.worstTrade)}</td></tr>
      </table>
    </div>
    <div>
      <h3>Rischio</h3>
      <table>
        <tr><td>Max Drawdown $</td><td class="text-right negative">${fmtM(ps.maxDd)}</td></tr>
        <tr><td>Max Drawdown %</td><td class="text-right negative">${fmtR(ps.maxDdPct, 2)}%</td></tr>
        <tr><td>Max perdite consecutive</td><td class="text-right bold">${ps.maxConsecLoss}</td></tr>
        <tr><td>Recovery Factor</td><td class="text-right">${fmtR(ps.recoveryFactor, 2)}</td></tr>
        <tr><td>DD vs FTMO Limit (10%)</td><td class="text-right bold ${ps.maxDdPct > 8 ? 'negative' : ps.maxDdPct > 5 ? 'neutral' : 'positive'}">${fmtR(ps.maxDdPct, 1)}% / 10%</td></tr>
        <tr><td>Margine sicurezza</td><td class="text-right ${10 - ps.maxDdPct > 2 ? 'positive' : 'negative'}">${fmtR(10 - ps.maxDdPct, 1)}%</td></tr>
      </table>
    </div>
  </div>

  ${ps.maxDdPct > 8 ? `
  <div class="section-risk">
    <strong>ATTENZIONE:</strong> Il Max Drawdown simulato (${fmtR(ps.maxDdPct, 1)}%) supera l'80% del limite FTMO.
    Considerare di ridurre i lotti o rimuovere strategie ad alto rischio.
  </div>` : ps.maxDdPct > 5 ? `
  <div class="section-note">
    <strong>NOTA:</strong> Il Max Drawdown simulato (${fmtR(ps.maxDdPct, 1)}%) utilizza oltre il 50% del budget DD FTMO.
    Monitorare attentamente durante operatività live.
  </div>` : ''}

  <!-- Utilizzo Margine -->
  ${marginData ? `
  <h2>Utilizzo Margine</h2>
  <div class="kpi-grid" style="grid-template-columns: repeat(3, 1fr)">
    <div class="kpi">
      <div class="kpi-label">Margine Richiesto</div>
      <div class="kpi-value">${fmtM(marginData.totalMarginRequired)}</div>
      <div class="kpi-sub">${fmtR(marginData.marginUtilizationPct, 1)}% dell'equity</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Margine Libero</div>
      <div class="kpi-value" style="color:#16a34a">${fmtM(marginData.freeMargin)}</div>
      <div class="kpi-sub">${fmtR(marginData.freeMarginPct, 1)}%</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Leva Effettiva</div>
      <div class="kpi-value">1:${fmtR(marginData.leverageEffective, 1)}</div>
      <div class="kpi-sub">Nozionale ${fmtM(marginData.totalNotional)}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Strategia</th>
        <th>Simbolo</th>
        <th class="text-center">Lotti</th>
        <th class="text-right">Nozionale</th>
        <th class="text-right">Margine</th>
        <th class="text-right">Leva</th>
      </tr>
    </thead>
    <tbody>
      ${marginData.perStrategy.map((m, i) => {
        const st = strategies.filter(s => s.selected)[i]
        return `<tr>
          <td>${st ? `M${st.magic} ${st.name || ''}` : '—'}</td>
          <td>${m.symbol}</td>
          <td class="text-center bold">${fmtR(m.lots, 3)}</td>
          <td class="text-right">${fmtM(m.notionalValue)}</td>
          <td class="text-right bold">${fmtM(m.marginRequired)}</td>
          <td class="text-right">1:${m.leverageRatio}</td>
        </tr>`
      }).join('')}
    </tbody>
    <tfoot>
      <tr style="border-top:2px solid #e2e8f0;font-weight:700">
        <td colspan="3">TOTALE</td>
        <td class="text-right">${fmtM(marginData.totalNotional)}</td>
        <td class="text-right">${fmtM(marginData.totalMarginRequired)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
  ` : ''}

  <!-- Analisi temporale -->
  <h2>Analisi Temporale</h2>
  <div class="grid-2">
    <div>
      <h3>Periodo</h3>
      <table>
        <tr><td>Primo trade</td><td class="text-right bold">${fmtDate(firstDate)}</td></tr>
        <tr><td>Ultimo trade</td><td class="text-right bold">${fmtDate(lastDate)}</td></tr>
        <tr><td>Durata</td><td class="text-right">${Math.round(durationMonths * 10) / 10} mesi (${durationDays} giorni)</td></tr>
        <tr><td>Trade/mese</td><td class="text-right">${fmtR(tradesPerMonth, 1)}</td></tr>
      </table>
    </div>
    <div>
      <h3>Proiezione</h3>
      <table>
        <tr><td>P/L medio mensile</td><td class="text-right bold" style="color:${plC(pnlPerMonth)}">${fmtM(pnlPerMonth)}</td></tr>
        <tr><td>Rendimento mensile</td><td class="text-right" style="color:${plC(pnlPerMonthPct)}">${fmtR(pnlPerMonthPct, 2)}%</td></tr>
        <tr><td style="color:#6366f1;font-weight:600">Proiezione annua</td><td class="text-right bold" style="color:${plC(annualizedPnl)}">${fmtM(annualizedPnl)} (${fmtR(annualizedReturn, 1)}%)</td></tr>
        <tr><td>Mesi profittevoli</td><td class="text-right">${profitableMonths}/${totalMonths} (${fmtR(totalMonths > 0 ? (profitableMonths/totalMonths)*100 : 0, 0)}%)</td></tr>
      </table>
    </div>
  </div>

  <h3>Breakdown Mensile</h3>
  <table>
    <thead>
      <tr><th>Mese</th><th class="text-right">P/L</th><th class="text-right">Cumulativo</th><th style="width:50%">Barra</th></tr>
    </thead>
    <tbody>
    ${(() => {
      let cumPnl = 0
      const maxAbsMonth = Math.max(...monthlyEntries.map(e => Math.abs(e[1])), 1)
      return monthlyEntries.map(([ym, pnl]) => {
        cumPnl += pnl
        const barPct = (Math.abs(pnl) / maxAbsMonth) * 100
        return `<tr>
          <td style="font-family:sans-serif">${fmtMonthLabel(ym)}</td>
          <td class="text-right bold" style="color:${plC(pnl)}">${fmtM(pnl)}</td>
          <td class="text-right" style="color:${plC(cumPnl)}">${fmtM(cumPnl)}</td>
          <td><div style="display:flex;align-items:center;gap:4px"><div style="width:${barPct}%;height:12px;background:${pnl >= 0 ? '#22c55e' : '#ef4444'};border-radius:3px;min-width:2px"></div></div></td>
        </tr>`
      }).join('')
    })()}
    </tbody>
    ${bestMonth ? `<tfoot><tr style="border-top:2px solid #e2e8f0;font-size:10px;color:#64748b">
      <td colspan="4">Miglior mese: <strong style="color:#16a34a">${fmtMonthLabel(bestMonth[0])} ${fmtM(bestMonth[1])}</strong> | Peggior mese: <strong style="color:#dc2626">${worstMonth ? `${fmtMonthLabel(worstMonth[0])} ${fmtM(worstMonth[1])}` : '—'}</strong></td>
    </tr></tfoot>` : ''}
  </table>

  <!-- Equity Curve Chart -->
  <h2>Equity Curve</h2>
  ${(() => {
    try {
      const pts = curveData.combined
      if (!pts || pts.length < 2) return '<p style="color:#94a3b8;font-style:italic">Dati insufficienti per il grafico</p>'
      const w = 750, h = 220, pad = 50
      const equities = pts.map(p => p.equity)
      // Safe min/max (no spread to avoid stack overflow on large arrays)
      let minEq = equityBase, maxEq = equityBase
      for (const eq of equities) { if (eq < minEq) minEq = eq; if (eq > maxEq) maxEq = eq }
      minEq *= 0.998; maxEq *= 1.002
      const rangeEq = maxEq - minEq || 1
      const xScale = (i: number) => pad + (i / (pts.length - 1)) * (w - pad * 2)
      const yScale = (v: number) => h - pad - ((v - minEq) / rangeEq) * (h - pad * 2)
      // Build SVG path for portfolio equity
      const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.equity).toFixed(1)}`).join(' ')
      // Area fill path
      const areaD = pathD + ` L${xScale(pts.length - 1).toFixed(1)},${yScale(minEq).toFixed(1)} L${xScale(0).toFixed(1)},${yScale(minEq).toFixed(1)} Z`
      // Baseline
      const baseY = yScale(equityBase)
      // Y axis ticks
      const yTicks = 5
      const yLabelsArr = Array.from({length: yTicks}, (_, i) => minEq + (rangeEq * i / (yTicks - 1)))
      // X axis labels (pick ~6 dates)
      const xTicks = Math.min(6, pts.length)
      const xLabelsArr = Array.from({length: xTicks}, (_, i) => {
        const idx = Math.round(i * (pts.length - 1) / (xTicks - 1))
        return { x: xScale(idx), label: pts[idx]?.date?.slice(5) || '' }
      })
      // Peak and max DD point
      let peak = equityBase, maxDdIdx = 0, maxDdVal = 0
      pts.forEach((p, i) => { if (p.equity > peak) peak = p.equity; const dd = peak - p.equity; if (dd > maxDdVal) { maxDdVal = dd; maxDdIdx = i } })
      const ddPtEquity = pts[maxDdIdx]?.equity ?? equityBase
      const endEquity = pts[pts.length - 1]?.equity ?? equityBase

      return `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="220" viewBox="0 0 ${w} ${h}" style="max-width:100%;background:#fafbfc;border:1px solid #e2e8f0;border-radius:8px;display:block;margin:8px 0">
      <defs>
        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6366f1" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="#6366f1" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${yLabelsArr.map(v => `<line x1="${pad}" y1="${yScale(v).toFixed(1)}" x2="${w - pad}" y2="${yScale(v).toFixed(1)}" stroke="#f1f5f9" stroke-width="1"/>`).join('\n      ')}
      <line x1="${pad}" y1="${baseY.toFixed(1)}" x2="${w - pad}" y2="${baseY.toFixed(1)}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4"/>
      <path d="${areaD}" fill="url(#eqGrad)"/>
      <path d="${pathD}" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${xScale(maxDdIdx).toFixed(1)}" cy="${yScale(ddPtEquity).toFixed(1)}" r="4" fill="#ef4444" stroke="#fff" stroke-width="1"/>
      <text x="${(xScale(maxDdIdx) + 8).toFixed(1)}" y="${(yScale(ddPtEquity) - 6).toFixed(1)}" font-size="9" fill="#ef4444" font-weight="600">Max DD ${fmtM(-maxDdVal)}</text>
      ${yLabelsArr.map(v => `<text x="${pad - 6}" y="${yScale(v).toFixed(1)}" text-anchor="end" font-size="8" fill="#94a3b8" dominant-baseline="middle">${v >= 1000 ? '$' + (v/1000).toFixed(1) + 'k' : '$' + Math.round(v)}</text>`).join('\n      ')}
      ${xLabelsArr.map(t => `<text x="${t.x.toFixed(1)}" y="${h - 10}" text-anchor="middle" font-size="8" fill="#94a3b8">${t.label}</text>`).join('\n      ')}
      <text x="${(pad + 4).toFixed(1)}" y="${(yScale(equityBase) - 8).toFixed(1)}" font-size="8" fill="#94a3b8">Base ${fmtM(equityBase)}</text>
      <text x="${(xScale(pts.length - 1) - 4).toFixed(1)}" y="${(yScale(endEquity) - 8).toFixed(1)}" text-anchor="end" font-size="10" font-weight="700" fill="${plC(ps.totalPnl)}">${fmtM(endEquity)}</text>
    </svg>`
    } catch (e) {
      return '<p style="color:#ef4444;font-size:10px">Errore nella generazione del grafico equity curve.</p>'
    }
  })()}

  <!-- Tabella strategie -->
  <h2>Composizione Portfolio</h2>
  <table>
    <thead>
      <tr>
        <th>Magic</th>
        <th>Strategia</th>
        <th>Asset</th>
        <th>Stile</th>
        <th class="text-center">Lotti Reali</th>
        <th class="text-center">Lotti Builder</th>
        <th class="text-right">Trade</th>
        <th class="text-right">P/L</th>
        <th class="text-right">Win Rate</th>
        <th class="text-right">PF</th>
        <th class="text-right">Max DD</th>
        <th class="text-right">Sharpe</th>
      </tr>
    </thead>
    <tbody>
      ${curveData.curves.sort((a, b) => b.stats.totalPnl - a.stats.totalPnl).map(c => {
        const st = strategies.find(s => s.id === c.strategyId)
        const styleBadge = st?.strategy_style === 'mean_reversion' ? 'badge-mr' : st?.strategy_style === 'trend_following' ? 'badge-tf' : st?.strategy_style === 'seasonal' ? 'badge-se' : 'badge-hy'
        const realLots = st?.realAvgLots ?? 0
        return `<tr>
          <td>M${c.magic}</td>
          <td style="font-family:sans-serif;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name}</td>
          <td>${st?.asset_group || st?.asset || ''}</td>
          <td><span class="badge ${styleBadge}">${styleLabel(st?.strategy_style ?? null)}</span></td>
          <td class="text-center bold">${realLots > 0 ? fmtR(realLots, 2) : '\u2014'}</td>
          <td class="text-center" style="color:#4f46e5">${fmtR(c.userLots, 3)}</td>
          <td class="text-right">${c.stats.totalTrades}</td>
          <td class="text-right bold" style="color:${plC(c.stats.totalPnl)}">${fmtM(c.stats.totalPnl)}</td>
          <td class="text-right">${fmtR(c.stats.winRate, 1)}%</td>
          <td class="text-right">${fmtR(c.stats.profitFactor, 2)}</td>
          <td class="text-right negative">${fmtM(c.stats.maxDd)}</td>
          <td class="text-right">${fmtR(c.stats.sharpe, 2)}</td>
        </tr>`
      }).join('')}
    </tbody>
    <tfoot>
      <tr style="border-top:2px solid #e2e8f0;font-weight:700">
        <td colspan="4">TOTALE</td>
        <td class="text-center">${fmtR(strategies.filter(s => s.selected).reduce((s, st) => s + st.realAvgLots, 0), 2)}</td>
        <td class="text-center" style="color:#4f46e5">${fmtR(curveData.curves.reduce((s, c) => s + c.userLots, 0), 3)}</td>
        <td class="text-right">${ps.totalTrades}</td>
        <td class="text-right" style="color:${plC(ps.totalPnl)}">${fmtM(ps.totalPnl)}</td>
        <td class="text-right">${fmtR(ps.winRate, 1)}%</td>
        <td class="text-right">${fmtR(ps.profitFactor, 2)}</td>
        <td class="text-right negative">${fmtM(ps.maxDd)}</td>
        <td class="text-right">${fmtR(ps.sharpe, 2)}</td>
      </tr>
    </tfoot>
  </table>

  <!-- P/L per strategia (barre) -->
  <h2>Contributo P/L per Strategia</h2>
  ${curveData.curves.sort((a, b) => b.stats.totalPnl - a.stats.totalPnl).map(c => {
    const maxAbs = Math.max(...curveData.curves.map(x => Math.abs(x.stats.totalPnl)), 1)
    const pct = Math.abs(c.stats.totalPnl / maxAbs) * 100
    return `<div class="bar-container">
      <div class="bar-label">M${c.magic}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${c.stats.totalPnl >= 0 ? '#22c55e' : '#ef4444'}"></div>
      </div>
      <div class="bar-value" style="color:${plC(c.stats.totalPnl)}">${fmtM(c.stats.totalPnl)}</div>
    </div>`
  }).join('')}

  <!-- Analisi composizione -->
  <h2>Analisi Composizione</h2>
  <div class="grid-2">
    <div>
      <h3>Per Stile</h3>
      <table>
        <tr><th>Stile</th><th class="text-right">Strat.</th><th class="text-right">P/L</th><th class="text-right">Peso</th></tr>
        ${Object.entries(byStyle).sort(([,a],[,b]) => b.pnl - a.pnl).map(([style, data]) =>
          `<tr><td>${styleLabel(style)}</td><td class="text-right">${data.count}</td><td class="text-right" style="color:${plC(data.pnl)}">${fmtM(data.pnl)}</td><td class="text-right">${fmtR((data.count / curveData.curves.length) * 100, 0)}%</td></tr>`
        ).join('')}
      </table>
    </div>
    <div>
      <h3>Per Asset</h3>
      <table>
        <tr><th>Asset</th><th class="text-right">Strat.</th><th class="text-right">P/L</th><th class="text-right">Peso</th></tr>
        ${Object.entries(byAsset).sort(([,a],[,b]) => b.pnl - a.pnl).map(([asset, data]) =>
          `<tr><td>${asset}</td><td class="text-right">${data.count}</td><td class="text-right" style="color:${plC(data.pnl)}">${fmtM(data.pnl)}</td><td class="text-right">${fmtR((data.count / curveData.curves.length) * 100, 0)}%</td></tr>`
        ).join('')}
      </table>
    </div>
  </div>

  <h3>Per Famiglia</h3>
  <table>
    <tr><th>Famiglia</th><th class="text-right">Strat.</th><th class="text-right">Lotti tot.</th><th class="text-right">P/L</th></tr>
    ${Object.entries(byFamily).sort(([,a],[,b]) => b.pnl - a.pnl).map(([fam, data]) =>
      `<tr><td>${fam}</td><td class="text-right">${data.count}</td><td class="text-right">${fmtR(data.lots, 3)}</td><td class="text-right" style="color:${plC(data.pnl)}">${fmtM(data.pnl)}</td></tr>`
    ).join('')}
  </table>

  <!-- Configurazione lotti (per copia/incolla) -->
  <h2>Configurazione Lotti</h2>
  <div class="section-note" style="font-family:monospace;font-size:10px;white-space:pre-wrap;line-height:1.8">
${curveData.curves.sort((a, b) => a.magic - b.magic).map(c => `Magic ${String(c.magic).padStart(2)} | ${c.name.padEnd(30)} | ${String(fmtR(c.userLots, 3)).padStart(6)} lotti | ${c.stats.totalTrades} trade`).join('\n')}</div>

  <!-- Proiezione & Efficienza -->
  ${projectionData ? `
  <h2>Sizing Reale vs Ottimale</h2>
  <div class="grid-2" style="margin-bottom:12px">
    <div>
      <h3 style="color:#4f46e5">Il tuo sizing (reale dai trade)</h3>
      <table>
        <tr><td>P/L reale</td><td class="text-right bold" style="color:${plC(projectionData.efficiency.currentPnl)}">${fmtM(projectionData.efficiency.currentPnl)}</td></tr>
        <tr><td>Max DD reale</td><td class="text-right bold negative">${fmtM(-projectionData.efficiency.realDdEstimate)}</td></tr>
        <tr><td>DD % equity</td><td class="text-right negative">${fmtR(projectionData.efficiency.realDdPct, 1)}%</td></tr>
        <tr><td>Rapporto lotti vs ottimale</td><td class="text-right bold">${fmtR(projectionData.efficiency.avgLotRatio, 1)}x</td></tr>
      </table>
    </div>
    <div>
      <h3 style="color:#16a34a">Sizing ottimale (Kelly/HRP)</h3>
      <table>
        <tr><td>P/L stimato</td><td class="text-right bold" style="color:${plC(projectionData.efficiency.optimizedPnl)}">${fmtM(projectionData.efficiency.optimizedPnl)}</td></tr>
        <tr><td>Max DD stimato</td><td class="text-right bold negative">${fmtM(-projectionData.efficiency.optDdEstimate)}</td></tr>
        <tr><td>DD % equity</td><td class="text-right negative">${fmtR(projectionData.efficiency.optDdPct, 1)}%</td></tr>
        <tr><td>Rischio relativo</td><td class="text-right">${fmtR(projectionData.efficiency.riskMultiplier, 1)}x meno rischio</td></tr>
      </table>
    </div>
  </div>
  ${projectionData.efficiency.realDdPct > 5 ? '<div class="section-risk"><strong>' + (projectionData.efficiency.realDdPct > 8 ? 'ATTENZIONE' : 'NOTA') + ':</strong> Con il tuo sizing reale il DD storico è ' + fmtR(projectionData.efficiency.realDdPct, 1) + '% dell\'equity. ' + (projectionData.efficiency.realDdPct > 8 ? 'Vicino al limite FTMO 10%!' : 'Monitorare il budget DD.') + ' Il sizing ottimale ridurrebbe il rischio di ' + fmtR(projectionData.efficiency.riskMultiplier, 1) + 'x.</div>' : ''}
  <div>
      <h3>Dettaglio per Strategia</h3>
      <table>
        <tr><th>Strategia</th><th class="text-right">Lotti Reali</th><th class="text-right">Lotti Ottim.</th><th class="text-right">Rapporto</th><th class="text-right">P/L Reale</th><th class="text-right">P/L Stimato</th></tr>
        ${projectionData.efficiency.perStrategy.map(s =>
          '<tr><td>M' + s.magic + ' ' + s.name + '</td><td class="text-right">' + fmtR(s.realAvgLots, 3) + '</td><td class="text-right" style="color:#4f46e5">' + fmtR(s.optimizedLots, 3) + '</td><td class="text-right"><span style="padding:1px 4px;border-radius:4px;font-size:9px;background:' + (s.ratio >= 0.8 && s.ratio <= 1.2 ? '#dcfce7;color:#16a34a' : s.ratio < 0.8 ? '#fee2e2;color:#dc2626' : '#fef3c7;color:#b45309') + '">' + fmtR(s.ratio * 100, 0) + '%</span></td><td class="text-right" style="color:' + plC(s.realPnl) + '">' + fmtM(s.realPnl) + '</td><td class="text-right" style="color:' + plC(s.estimatedPnl) + '">' + fmtM(s.estimatedPnl) + '</td></tr>'
        ).join('')}
      </table>
    </div>
    <div>
      <h3>Proiezione Monte Carlo (${projectionData.projection.monthsOfData} mesi dati)</h3>
      <table>
        <tr><th>Scenario</th><th class="text-right">P/L 6M</th><th class="text-right">P/L 12M</th><th class="text-right">Equity 12M</th><th class="text-right">Rend.</th></tr>
        ${[projectionData.projection.optimistic, projectionData.projection.base, projectionData.projection.pessimistic].map((s, i) =>
          `<tr${i === 1 ? ' style="background:#eef2ff;font-weight:600"' : ''}>
            <td>${i === 0 ? '\u{1F7E2}' : i === 1 ? '\u{1F535}' : '\u{1F534}'} ${s.label}</td>
            <td class="text-right" style="color:${plC(s.pnl6m)}">${fmtM(s.pnl6m)}</td>
            <td class="text-right bold" style="color:${plC(s.pnl12m)}">${fmtM(s.pnl12m)}</td>
            <td class="text-right bold">${fmtM(s.equity12m)}</td>
            <td class="text-right" style="color:${plC(s.return12mPct)}">${fmtR(s.return12mPct, 1)}%</td>
          </tr>`
        ).join('')}
      </table>
    </div>
  </div>

  <!-- Projection Chart -->
  ${(() => {
    try {
    const p = projectionData.projection
    const scenarios = [p.optimistic, p.base, p.pessimistic]
    const cw = 750, ch = 200, cpad = 55
    const mos = [0,1,2,3,4,5,6,7,8,9,10,11,12]
    const pts = scenarios.map(s => mos.map(m => {
      if (m === 0) return equityBase
      if (m <= 6) return equityBase + (s.pnl6m / 6) * m
      return s.equity6m + ((s.equity12m - s.equity6m) / 6) * (m - 6)
    }))
    let minV = equityBase, maxV = equityBase
    for (const arr of pts) for (const v of arr) { if (v < minV) minV = v; if (v > maxV) maxV = v }
    minV *= 0.98; maxV *= 1.02
    const rV = maxV - minV || 1
    const xS = (m: number) => cpad + (m / 12) * (cw - cpad * 2)
    const yS = (v: number) => ch - cpad - ((v - minV) / rV) * (ch - cpad * 2)
    const pth = (arr: number[]) => arr.map((v, i) => (i === 0 ? 'M' : 'L') + xS(i).toFixed(1) + ',' + yS(v).toFixed(1)).join(' ')
    const aD = pth(pts[0]) + pts[2].slice().reverse().map((v, i) => 'L' + xS(12-i).toFixed(1) + ',' + yS(v).toFixed(1)).join('') + ' Z'
    const yTk = Array.from({length:5}, (_,i) => minV + (rV*i/4))
    const clr = ['#22c55e','#6366f1','#ef4444']
    const lbl = ['Ottimistico','Base','Pessimistico']
    const gridLines = yTk.map(v => '<line x1="'+cpad+'" y1="'+yS(v).toFixed(1)+'" x2="'+(cw-cpad)+'" y2="'+yS(v).toFixed(1)+'" stroke="#f1f5f9" stroke-width="1"/>').join('\n')
    const baseLine = '<line x1="'+cpad+'" y1="'+yS(equityBase).toFixed(1)+'" x2="'+(cw-cpad)+'" y2="'+yS(equityBase).toFixed(1)+'" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4"/>'
    const area = '<path d="'+aD+'" fill="#6366f1" fill-opacity="0.08"/>'
    const curves = pts.map((arr,i) => '<path d="'+pth(arr)+'" fill="none" stroke="'+clr[i]+'" stroke-width="'+(i===1?2.5:1.5)+'" stroke-linejoin="round"'+(i!==1?' stroke-dasharray="6,3"':'')+'/>').join('\n')
    const yLabels = yTk.map(v => '<text x="'+(cpad-6)+'" y="'+yS(v).toFixed(1)+'" text-anchor="end" font-size="8" fill="#94a3b8" dominant-baseline="middle">'+(v>=1000?'$'+(v/1000).toFixed(1)+'k':'$'+Math.round(v))+'</text>').join('\n')
    const xLabels = mos.filter(m=>m%3===0).map(m => '<text x="'+xS(m).toFixed(1)+'" y="'+(ch-10)+'" text-anchor="middle" font-size="8" fill="#94a3b8">'+(m===0?'Oggi':m+'M')+'</text>').join('\n')
    const midLine = '<line x1="'+xS(6).toFixed(1)+'" y1="'+cpad+'" x2="'+xS(6).toFixed(1)+'" y2="'+(ch-cpad)+'" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3"/><text x="'+xS(6).toFixed(1)+'" y="'+(cpad-6)+'" text-anchor="middle" font-size="8" fill="#94a3b8">6M</text>'
    const endLabels = scenarios.map((s,i) => '<text x="'+(cw-cpad+4).toFixed(1)+'" y="'+yS(pts[i][12]).toFixed(1)+'" font-size="9" fill="'+clr[i]+'" font-weight="'+(i===1?700:500)+'" dominant-baseline="middle">'+(s.equity12m/1000).toFixed(1)+'k</text>').join('\n')
    const legend = lbl.map((l,i) => '<circle cx="'+(cpad+10+i*100)+'" cy="'+(cpad-8)+'" r="3" fill="'+clr[i]+'"/><text x="'+(cpad+16+i*100)+'" y="'+(cpad-8)+'" font-size="8" fill="#64748b" dominant-baseline="middle">'+l+'</text>').join('\n')
    return '<svg xmlns="http://www.w3.org/2000/svg" width="750" height="200" viewBox="0 0 '+cw+' '+ch+'" style="max-width:100%;background:#fafbfc;border:1px solid #e2e8f0;border-radius:8px;display:block;margin:8px 0">\n'+gridLines+'\n'+baseLine+'\n'+area+'\n'+curves+'\n'+yLabels+'\n'+xLabels+'\n'+midLine+'\n'+endLabels+'\n'+legend+'\n</svg>'
    } catch(e) { return '<p style="color:#94a3b8;font-style:italic">Grafico proiezione non disponibile</p>' }
  })()}

  ` : ''}

  <!-- Disclaimer -->
  <div class="footer">
    <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:4px">
      <img src="data:image/png;base64,${VELQOR_LOGO_BASE64}" style="width:16px;height:16px;object-fit:contain;opacity:0.5" />
      <span style="font-weight:600;letter-spacing:1px;color:#64748b">VELQOR INTELLIGENT QUANT SYSTEM</span>
    </div>
    <p>Report generato il ${dateNow} alle ${new Date().toLocaleTimeString('it-IT')}</p>
    <p style="margin-top:4px">Simulazione basata su trade storici con scaling proporzionale ai lotti configurati. Le performance passate non garantiscono risultati futuri. I dati di drawdown si riferiscono alla serie di trade chiusi e non includono il floating P/L intraday.</p>
  </div>

</div>
</body>
</html>`

    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  // ---- Render ----
  if (loading) return <div className="p-8 text-slate-500">Caricamento...</div>

  const selected = strategies.filter(s => s.selected)
  const visibleOnChart = strategies.filter(s => s.selected && s.visible)

  // Account data summary (for diagnostics and user info)
  const strategiesWithTrades = strategies.filter(s => s.tradeCount > 0)
  const loadedTradeCount = strategiesWithTrades.reduce((s, st) => s + st.tradeCount, 0)
  const loadedRealPnl = strategiesWithTrades.reduce((s, st) => s + st.realPnlOnAccount, 0)

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <QuantNav />
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Portfolio Builder v2</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Seleziona strategie, regola i lotti, visualizza equity curve, salva come PTF
        </p>
      </div>

      {/* Top bar: Account + Equity + PTF */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="text-[10px] uppercase text-slate-400 block mb-1">Conto</label>
            <select
              value={selectedAccountId}
              onChange={e => handleAccountChange(e.target.value)}
              className="text-sm border border-slate-200 rounded px-2 py-1.5 min-w-[200px]"
            >
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({fmtUsd(a.account_size)})</option>
              ))}
            </select>
            <div className="text-[10px] text-slate-400 mt-1 font-mono">
              {loadedTradeCount} trade | {strategiesWithTrades.length} strategie | P/L {fmtUsd(loadedRealPnl)}
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-400 block mb-1">Equity base ($)</label>
            <input type="number" value={equityBase} onChange={e => setEquityBase(Number(e.target.value))}
              className="w-28 text-sm border border-slate-200 rounded px-2 py-1.5" />
          </div>

          {/* Sizing mode */}
          <div>
            <label className="text-[10px] uppercase text-slate-400 block mb-1">Sizing</label>
            <div className="flex gap-1 items-center">
              <button
                onClick={resetLotsToDefault}
                className={`px-2.5 py-1.5 text-xs rounded-lg border transition ${sizingMode === 'proportional' ? 'bg-slate-100 border-slate-300 text-slate-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                Proporzionale {sourceAccountSize > 0 ? `(${fmt(equityBase / sourceAccountSize, 0)}x)` : ''}
              </button>
              <button
                onClick={optimizeLots}
                disabled={strategies.filter(s => s.selected).length === 0}
                className={`px-2.5 py-1.5 text-xs rounded-lg border transition ${sizingMode === 'optimized' ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-indigo-300 text-indigo-600 hover:bg-indigo-50'} disabled:opacity-50`}
              >
                Ottimizza (Kelly+HRP)
              </button>
            </div>
          </div>

          {/* Sizing params (show when optimized) */}
          {sizingMode === 'optimized' && (
            <>
              <div>
                <label className="text-[10px] uppercase text-slate-400 block mb-1">Kelly</label>
                <select value={kellyMode} onChange={e => { setKellyMode(e.target.value as KellyMode); setTimeout(optimizeLots, 50) }}
                  className="text-xs border border-slate-200 rounded px-2 py-1.5">
                  <option value="half_kelly">1/2 Kelly</option>
                  <option value="quarter_kelly">1/4 Kelly</option>
                  <option value="full_kelly">Full Kelly</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-400 block mb-1">Max DD %</label>
                <input type="number" value={maxDdPct} onChange={e => { setMaxDdPct(Number(e.target.value)) }}
                  className="w-16 text-xs border border-slate-200 rounded px-2 py-1.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-400 block mb-1">Safety</label>
                <div className="flex items-center gap-1">
                  <input type="range" min="0.3" max="1.0" step="0.1" value={safetyFactor}
                    onChange={e => setSafetyFactor(parseFloat(e.target.value))} className="w-16" />
                  <span className="text-xs font-mono">{fmt(safetyFactor, 1)}</span>
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-400 block mb-1" title="Finestra temporale per calcolare stats reali (Kelly, P/L, trade count). Rolling = cattura regime shift, All = tutto lo storico.">Finestra</label>
                <div className="flex gap-0.5">
                  {([
                    { label: 'All', value: null },
                    { label: '120g', value: 120 },
                    { label: '90g', value: 90 },
                    { label: '30g', value: 30 },
                  ] as const).map(opt => (
                    <button
                      key={opt.label}
                      onClick={() => { setWindowDays(opt.value); if (sizingMode === 'optimized') setTimeout(optimizeLots, 50) }}
                      className={`px-2 py-1.5 text-[11px] rounded border font-mono transition ${
                        windowDays === opt.value
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'border-slate-200 text-slate-500 hover:bg-indigo-50 hover:border-indigo-300'
                      }`}
                      title={opt.value == null ? 'Tutto lo storico' : `Ultimi ${opt.value} giorni`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Quick lot adjust */}
          <div>
            <label className="text-[10px] uppercase text-slate-400 block mb-1">Regola</label>
            <div className="flex gap-1">
              {[2, 0.5].map(m => (
                <button key={m} onClick={() => applyMultiplier(m)}
                  className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-indigo-50 hover:border-indigo-300 transition font-mono">
                  {m > 1 ? `${m}x` : `/${Math.round(1/m)}`}
                </button>
              ))}
            </div>
          </div>

          {/* Load PTF */}
          {savedPortfolios.length > 0 && (
            <div>
              <label className="text-[10px] uppercase text-slate-400 block mb-1">Carica PTF</label>
              <div className="flex gap-1 flex-wrap">
                {savedPortfolios.map(p => (
                  <div key={p.id} className="flex items-center gap-0.5">
                    <button
                      onClick={() => loadPTF(p)}
                      className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-l-lg hover:bg-indigo-50 hover:border-indigo-300 transition"
                    >
                      {p.name}
                    </button>
                    <button
                      onClick={() => deletePTF(p.id)}
                      className="px-1.5 py-1.5 text-xs border border-slate-200 rounded-r-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition"
                      title="Elimina"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick selectors */}
          <div className="ml-auto flex gap-2 items-end">
            <button onClick={selectAll} className="text-xs text-indigo-600 hover:underline">Tutte</button>
            <button onClick={selectProfitable} className="text-xs text-green-600 hover:underline">Profittevoli</button>
            <button onClick={selectNone} className="text-xs text-slate-400 hover:underline">Nessuna</button>
          </div>
        </div>
      </div>

      {/* v4: Rolling-window banner — makes it impossible to forget which cut is active */}
      {windowDays != null && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-amber-600 font-semibold">⏱ Finestra rolling attiva:</span>
            <span className="font-mono text-amber-800">ultimi {windowDays} giorni</span>
            <span className="text-amber-500">·</span>
            <span className="text-amber-700">
              {effectiveTrades.length} trade su {trades.length} totali
              {trades.length > 0 && ` (${Math.round((effectiveTrades.length / trades.length) * 100)}%)`}
            </span>
          </div>
          <button
            onClick={() => { setWindowDays(null); if (sizingMode === 'optimized') setTimeout(optimizeLots, 50) }}
            className="text-amber-600 hover:text-amber-800 underline"
          >
            Torna a tutto lo storico
          </button>
        </div>
      )}

      {/* Strategy table with lot inputs */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left">
              <th className="px-2 py-2 w-8"></th>
              <th className="px-2 py-2 w-6"></th>
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400">Magic</th>
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400">Strategia</th>
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400">Asset</th>
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400">Stile</th>
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-center">Lotti Reali</th>
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-center">Lotti Builder</th>
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-right">Trade</th>
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-right">P/L reale</th>
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-right">P/L scalato</th>
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-right">Margine</th>
            </tr>
          </thead>
          <tbody>
            {strategies.filter(s => s.status === 'active').map(s => {
              const curve = curveData?.curves.find(c => c.strategyId === s.id)
              const scaledPnl = curve?.stats.totalPnl ?? null
              const sizingRes = sizingOutput?.results.find(r => r.strategyId === s.id) ?? null
              const skipReasonLabel = sizingRes?.skipReason === 'negative_real_pl'
                ? 'Esclusa: P/L reale negativo sul sample — nessuna allocazione finché non torna positiva'
                : sizingRes?.skipReason
                  ? `Esclusa: ${sizingRes.skipReason}`
                  : null
              const warningsText = sizingRes?.sizingWarnings?.length
                ? sizingRes.sizingWarnings.join('\n')
                : null
              return (
                <tr key={s.id} className={`border-b border-slate-50 ${s.selected ? 'bg-indigo-50/30' : 'opacity-50'} hover:bg-slate-50`}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={s.selected} onChange={() => toggleStrategy(s.id)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 cursor-pointer" />
                  </td>
                  <td className="px-1 py-1.5">
                    {s.selected && (
                      <button
                        onClick={() => toggleVisibility(s.id)}
                        className="w-4 h-4 rounded-full border-2 transition-all"
                        style={{
                          borderColor: s.chartColor,
                          backgroundColor: s.visible ? s.chartColor : 'transparent',
                        }}
                        title={s.visible ? 'Nascondi dal grafico' : 'Mostra nel grafico'}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-slate-600 text-xs">{s.magic}</td>
                  <td className="px-2 py-1.5 font-medium text-slate-800 text-xs max-w-[180px] truncate">{s.name}</td>
                  <td className="px-2 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${groupColor(s.asset_group)}`}>{s.asset_group}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${styleColor(s.strategy_style)}`}>{styleLabel(s.strategy_style)}</span>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {s.realAvgLots > 0 ? (
                      <span className="text-xs font-mono font-semibold text-slate-700">{fmt(s.realAvgLots, 2)}</span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {s.selected ? (
                      <div className="flex items-center gap-1 justify-center">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={s.userLots}
                          onChange={e => setLots(s.id, parseFloat(e.target.value) || 0.01)}
                          className={`w-16 text-xs text-center border rounded px-1 py-1 font-mono ${
                            skipReasonLabel
                              ? 'border-red-300 bg-red-50 text-red-700'
                              : warningsText
                                ? 'border-amber-300 bg-amber-50'
                                : 'border-slate-200'
                          }`}
                          onClick={e => e.stopPropagation()}
                        />
                        {skipReasonLabel && (
                          <span
                            className="text-xs cursor-help"
                            title={skipReasonLabel}
                          >🚫</span>
                        )}
                        {!skipReasonLabel && warningsText && (
                          <span
                            className="text-xs cursor-help"
                            title={warningsText}
                          >⚠️</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 text-center block">{fmt(s.lot_neutral ?? s.lot_static, 3)}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-slate-500 text-xs">{s.tradeCount || '—'}</td>
                  <td className={`px-2 py-1.5 text-right font-mono text-xs font-bold ${plColor(s.realPnlOnAccount)}`}>
                    {s.tradeCount > 0 ? fmtUsd(s.realPnlOnAccount) : '—'}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono text-xs font-bold ${scaledPnl !== null ? plColor(scaledPnl) : 'text-slate-400'}`}>
                    {scaledPnl !== null ? fmtUsd(scaledPnl) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs">
                    {s.selected && marginData ? (() => {
                      const m = marginData.perStrategy.find(x => x.symbol === s.asset && Math.abs(x.lots - s.userLots) < 0.001)
                      return m ? (
                        <div>
                          <span className="text-slate-700">{fmtUsd(m.marginRequired)}</span>
                          <div className="text-[9px] text-slate-400">1:{m.leverageRatio}</div>
                        </div>
                      ) : <span className="text-slate-400">—</span>
                    })() : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Margin utilization */}
      {marginData && strategies.some(s => s.selected) && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Utilizzo Margine</h3>
            <InfoTooltip metricKey="margin_utilization" />
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              marginData.marginUtilizationPct > 80 ? 'bg-red-100 text-red-700' :
              marginData.marginUtilizationPct > 50 ? 'bg-amber-100 text-amber-700' :
              'bg-green-100 text-green-700'
            }`}>
              {marginData.marginUtilizationPct > 80 ? 'ALTO' :
               marginData.marginUtilizationPct > 50 ? 'MODERATO' : 'OK'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            <div>
              <div className="text-[10px] uppercase text-slate-400">Margine Richiesto</div>
              <div className="text-sm font-bold font-mono text-slate-800">{fmtUsd(marginData.totalMarginRequired)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-400">Utilizzo %</div>
              <div className={`text-sm font-bold font-mono ${
                marginData.marginUtilizationPct > 80 ? 'text-red-600' :
                marginData.marginUtilizationPct > 50 ? 'text-amber-600' : 'text-green-600'
              }`}>
                {fmtPct(marginData.marginUtilizationPct, 1)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-400">Margine Libero</div>
              <div className="text-sm font-bold font-mono text-green-600">{fmtUsd(marginData.freeMargin)}</div>
              <div className="text-[10px] text-slate-400">{fmtPct(marginData.freeMarginPct, 1)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-400">Leva Effettiva</div>
              <div className="text-sm font-bold font-mono text-slate-700">1:{fmt(marginData.leverageEffective, 1)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-400">Valore Nozionale</div>
              <div className="text-sm font-bold font-mono text-slate-700">{fmtUsd(marginData.totalNotional)}</div>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                marginData.marginUtilizationPct > 80 ? 'bg-red-500' :
                marginData.marginUtilizationPct > 50 ? 'bg-amber-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(100, marginData.marginUtilizationPct)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>
      )}

      {/* Sizing Advisor — independent portfolio suggestion */}
      {advisorData && (advisorData.included.length > 0 || advisorData.excluded.length > 0) && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-700">Sizing Advisor</h3>
              <InfoTooltip metricKey="sizing_advisor" />
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                advisorData.portfolioHealth === 'critical' ? 'bg-red-100 text-red-700' :
                advisorData.portfolioHealth === 'attention' ? 'bg-amber-100 text-amber-700' :
                'bg-green-100 text-green-700'
              }`}>
                {advisorData.portfolioHealth === 'critical' ? 'CRITICO' :
                 advisorData.portfolioHealth === 'attention' ? 'ATTENZIONE' : 'OK'}
              </span>
            </div>
            <button onClick={applyAdvisorPortfolio}
              className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium">
              Applica portafoglio advisor
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-3">{advisorData.summary}</p>

          {/* Included strategies */}
          <div className="mb-3">
            <div className="text-[10px] uppercase text-green-600 font-semibold mb-1.5">Raccomandate ({advisorData.includedCount})</div>
            <div className="space-y-1">
              {advisorData.included.map(r => (
                <div key={r.strategyId} className={`flex items-start gap-2 p-2 rounded-lg text-xs ${
                  r.severity === 'critical' ? 'bg-red-50' :
                  r.severity === 'warning' ? 'bg-amber-50' : 'bg-green-50/50'
                }`}>
                  <span className="text-sm leading-none mt-0.5">
                    {r.action === 'increase' ? '\u2191' :
                     r.action === 'decrease' ? '\u2193' :
                     r.action === 'monitor' ? '\u25CB' : '\u2713'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-500">M{r.magic}</span>
                      <span className="font-medium text-slate-700 truncate">{r.name}</span>
                      <span className="text-[10px] font-mono text-slate-400">{fmt(r.suggestedLots, 3)} lotti</span>
                      {r.lotMultiplier !== 1.0 && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          r.lotMultiplier > 1 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {r.lotMultiplier > 1 ? '+' : ''}{fmt((r.lotMultiplier - 1) * 100, 0)}%
                        </span>
                      )}
                    </div>
                    <p className="text-slate-500 mt-0.5">{r.reason}</p>
                    {r.details.length > 0 && (
                      <p className="text-[10px] text-slate-400 mt-0.5">{r.details.join(' \u00B7 ')}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Excluded strategies */}
          {advisorData.excluded.length > 0 && (
            <div>
              <div className="text-[10px] uppercase text-red-600 font-semibold mb-1.5">Escluse ({advisorData.excludedCount})</div>
              <div className="space-y-1">
                {advisorData.excluded.map(r => (
                  <div key={r.strategyId} className="flex items-start gap-2 p-2 rounded-lg text-xs bg-red-50/50">
                    <span className="text-sm leading-none mt-0.5 text-red-400">{'\u2717'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-400">M{r.magic}</span>
                        <span className="font-medium text-slate-500 truncate">{r.name}</span>
                      </div>
                      <p className="text-red-500 mt-0.5">{r.reason}</p>
                      {r.details.length > 0 && (
                        <p className="text-[10px] text-slate-400 mt-0.5">{r.details.join(' \u00B7 ')}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Projection & Sizing Efficiency */}
      {projectionData && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Proiezione & Efficienza Sizing</h3>

          {/* Sizing comparison: Real vs Optimized */}
          <div className="grid grid-cols-2 gap-4 mb-3">
            {/* Your sizing */}
            <div className="bg-slate-50 rounded-lg p-3 border-l-4 border-indigo-400">
              <div className="text-[10px] uppercase text-indigo-500 tracking-wide font-semibold mb-1">Il tuo sizing (reale)</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-slate-400">P/L</div>
                  <div className={`text-lg font-bold font-mono ${projectionData.efficiency.currentPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmtUsd(projectionData.efficiency.currentPnl)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Max DD</div>
                  <div className="text-lg font-bold font-mono text-red-600">
                    {fmtUsd(-projectionData.efficiency.realDdEstimate)}
                  </div>
                  <div className="text-[10px] text-red-500">{fmtPct(projectionData.efficiency.realDdPct, 1)} dell'equity</div>
                </div>
              </div>
            </div>
            {/* Optimized sizing */}
            <div className="bg-slate-50 rounded-lg p-3 border-l-4 border-green-400">
              <div className="text-[10px] uppercase text-green-600 tracking-wide font-semibold mb-1">Sizing ottimale (Kelly/HRP)</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-slate-400">P/L stimato</div>
                  <div className={`text-lg font-bold font-mono ${projectionData.efficiency.optimizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmtUsd(projectionData.efficiency.optimizedPnl)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Max DD stimato</div>
                  <div className="text-lg font-bold font-mono text-red-600">
                    {fmtUsd(-projectionData.efficiency.optDdEstimate)}
                  </div>
                  <div className="text-[10px] text-red-500">{fmtPct(projectionData.efficiency.optDdPct, 1)} dell'equity</div>
                </div>
              </div>
            </div>
          </div>

          {/* Tradeoff summary */}
          <div className={`text-xs p-2.5 rounded-lg mb-3 ${
            projectionData.efficiency.realDdPct > 8 ? 'bg-red-50 text-red-700' :
            projectionData.efficiency.realDdPct > 5 ? 'bg-amber-50 text-amber-700' :
            'bg-blue-50 text-blue-700'
          }`}>
            {projectionData.efficiency.avgLotRatio > 1.2 ? (
              <>Il tuo sizing reale è <strong>{fmt(projectionData.efficiency.avgLotRatio, 1)}x</strong> quello ottimale.
              Rendi <strong>{fmtUsd(projectionData.efficiency.currentPnl - projectionData.efficiency.optimizedPnl)}</strong> in più
              ma rischi <strong>{fmt(projectionData.efficiency.riskMultiplier, 1)}x</strong> più DD.
              {projectionData.efficiency.realDdPct > 8 && ' FTMO limit 10% — margine ridotto!'}
              {projectionData.efficiency.realDdPct > 5 && projectionData.efficiency.realDdPct <= 8 && ' Attenzione al budget DD.'}
              </>
            ) : projectionData.efficiency.avgLotRatio < 0.8 ? (
              <>Il tuo sizing reale è solo il <strong>{fmt(projectionData.efficiency.avgLotRatio * 100, 0)}%</strong> dell'ottimale.
              Stai lasciando <strong>{fmtUsd(Math.abs(projectionData.efficiency.gapPnl))}</strong> sul tavolo con rischio contenuto.</>
            ) : (
              <>Il tuo sizing è allineato all'ottimale. Buon bilanciamento rischio/rendimento.</>
            )}
          </div>

          {/* Per-strategy sizing comparison table */}
          {projectionData.efficiency.perStrategy.length > 0 && (
            <div className="mb-4">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-100">
                      <th className="text-left py-1.5 pr-2">Strategia</th>
                      <th className="text-right py-1.5 px-2">Lotti Reali</th>
                      <th className="text-right py-1.5 px-2">Lotti Ottim.</th>
                      <th className="text-right py-1.5 px-2">Rapporto</th>
                      <th className="text-right py-1.5 px-2">P/L Reale</th>
                      <th className="text-right py-1.5 pl-2">P/L Stimato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectionData.efficiency.perStrategy.map(s => (
                      <tr key={s.strategyId} className="border-b border-slate-50">
                        <td className="py-1.5 pr-2">
                          <span className="font-mono text-slate-400 mr-1">M{s.magic}</span>
                          <span className="text-slate-700">{s.name}</span>
                        </td>
                        <td className="text-right py-1.5 px-2 font-mono font-medium">{fmt(s.realAvgLots, 3)}</td>
                        <td className="text-right py-1.5 px-2 font-mono text-indigo-600">{fmt(s.optimizedLots, 3)}</td>
                        <td className="text-right py-1.5 px-2">
                          <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                            s.ratio >= 0.8 && s.ratio <= 1.2 ? 'bg-green-100 text-green-700' :
                            s.ratio < 0.8 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {fmt(s.ratio * 100, 0)}%
                          </span>
                        </td>
                        <td className={`text-right py-1.5 px-2 font-mono ${s.realPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {fmtUsd(s.realPnl)}
                        </td>
                        <td className={`text-right py-1.5 pl-2 font-mono ${s.estimatedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {fmtUsd(s.estimatedPnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Projection table */}
          <div className="border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-600">Proiezione Equity</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                projectionData.projection.dataQuality === 'high' ? 'bg-green-100 text-green-700' :
                projectionData.projection.dataQuality === 'medium' ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-700'
              }`}>
                {projectionData.projection.monthsOfData} mesi di dati
                {projectionData.projection.dataQuality === 'low' && ' — bassa affidabilità'}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-100">
                    <th className="text-left py-1.5 pr-3">Scenario</th>
                    <th className="text-right py-1.5 px-2">P/L 6M</th>
                    <th className="text-right py-1.5 px-2">Equity 6M</th>
                    <th className="text-right py-1.5 px-2">P/L 12M</th>
                    <th className="text-right py-1.5 px-2">Equity 12M</th>
                    <th className="text-right py-1.5 px-2">Rend. 12M</th>
                    <th className="text-right py-1.5 pl-2">Max DD Est.</th>
                  </tr>
                </thead>
                <tbody>
                  {[projectionData.projection.optimistic, projectionData.projection.base, projectionData.projection.pessimistic].map((s, i) => (
                    <tr key={s.label} className={`border-b border-slate-50 ${i === 1 ? 'bg-indigo-50/30 font-medium' : ''}`}>
                      <td className="py-1.5 pr-3">
                        <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${
                          i === 0 ? 'bg-green-500' : i === 1 ? 'bg-indigo-500' : 'bg-red-500'
                        }`} />
                        {s.label}
                      </td>
                      <td className={`text-right py-1.5 px-2 font-mono ${s.pnl6m >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {fmtUsd(s.pnl6m)}
                      </td>
                      <td className="text-right py-1.5 px-2 font-mono text-slate-700">
                        {fmtUsd(s.equity6m)}
                      </td>
                      <td className={`text-right py-1.5 px-2 font-mono font-semibold ${s.pnl12m >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {fmtUsd(s.pnl12m)}
                      </td>
                      <td className="text-right py-1.5 px-2 font-mono text-slate-700 font-semibold">
                        {fmtUsd(s.equity12m)}
                      </td>
                      <td className={`text-right py-1.5 px-2 font-mono ${s.return12mPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {fmtPct(s.return12mPct, 1)}
                      </td>
                      <td className="text-right py-1.5 pl-2 font-mono text-red-500">
                        {fmtUsd(-s.maxDdEstimate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400">
              <span>{fmt(projectionData.projection.tradesPerMonth, 1)} trade/mese</span>
              <span>MC bootstrap su {projectionData.projection.monthsOfData} mesi storici × 1000 path</span>
            </div>
          </div>
        </div>
      )}

      {/* Chart section */}
      {curveData && curveData.curves.length > 0 && (
        <>
          {/* Chart controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1">
              <button
                onClick={() => setChartMode('portfolio')}
                className={`px-3 py-1.5 text-xs rounded-lg border transition ${chartMode === 'portfolio' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                Portfolio
              </button>
              <button
                onClick={() => setChartMode('individual')}
                className={`px-3 py-1.5 text-xs rounded-lg border transition ${chartMode === 'individual' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                Singole strategie
              </button>
            </div>
            {chartMode === 'portfolio' && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" checked={showCombined} onChange={e => setShowCombined(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-slate-800" />
                Portfolio combinato
              </label>
            )}
            <span className="text-[10px] text-slate-400 ml-auto">
              {curveData.combined.length} trade | {curveData.curves.length} strategie
            </span>
          </div>

          {/* Main chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            {chartMode === 'portfolio' ? (
              <PortfolioChart
                combined={curveData.combined}
                curves={curveData.curves}
                visible={visibleOnChart}
                showCombined={showCombined}
                equityBase={equityBase}
              />
            ) : (
              <IndividualCharts
                curves={curveData.curves}
                visible={visibleOnChart}
                equityBase={equityBase}
                selectedStrat={selectedStratForDetail}
                onSelectStrat={setSelectedStratForDetail}
              />
            )}
          </div>

          {/* Sizing summary (when optimized) */}
          {sizingOutput && sizingMode === 'optimized' && (
            <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-indigo-800">Sizing Engine — {kellyMode === 'half_kelly' ? '½ Kelly' : kellyMode === 'quarter_kelly' ? '¼ Kelly' : 'Full Kelly'}</h3>
                <span className="text-[10px] bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">
                  DD Budget: {fmtUsd(equityBase * maxDdPct / 100 * safetyFactor)} ({fmtPct(maxDdPct * safetyFactor)})
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-[10px] uppercase text-indigo-400">DD Budget usato</div>
                  <div className={`text-sm font-bold font-mono ${sizingOutput.totalDdBudgetUsedPct > 90 ? 'text-red-600' : sizingOutput.totalDdBudgetUsedPct > 70 ? 'text-amber-600' : 'text-indigo-700'}`}>
                    {fmtPct(sizingOutput.totalDdBudgetUsedPct)}
                  </div>
                  <div className="text-[10px] text-indigo-400">{fmtUsd(sizingOutput.totalDdBudgetUsedUsd)} / {fmtUsd(equityBase * maxDdPct / 100 * safetyFactor)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-indigo-400">Strategie</div>
                  <div className="text-sm font-bold font-mono text-indigo-700">{sizingOutput.strategyCount}</div>
                  <div className="text-[10px] text-indigo-400">{sizingOutput.familyCount} famiglie</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-indigo-400">RoR medio</div>
                  <div className="text-sm font-bold font-mono text-indigo-700">{sizingOutput.avgRor !== null ? fmtPct(sizingOutput.avgRor * 100, 3) : '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-indigo-400">Stile</div>
                  <div className="flex gap-1 flex-wrap mt-0.5">
                    {Object.entries(sizingOutput.styleBalance).map(([s, pct]) => (
                      <span key={s} className={`text-[10px] px-1.5 py-0.5 rounded-full ${styleColor(s)}`}>{styleLabel(s)} {pct}%</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stats panels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Portfolio stats */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Portfolio Combinato</h3>
              <StatsGrid stats={curveData.portfolioStats} equityBase={equityBase} />
            </div>

            {/* Per-strategy stats */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Per Strategia</h3>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {curveData.curves
                  .sort((a, b) => b.stats.totalPnl - a.stats.totalPnl)
                  .map(c => (
                    <div key={c.strategyId} className="flex items-center gap-2 text-xs">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                      <span className="font-mono text-slate-500 w-6">M{c.magic}</span>
                      <span className="text-slate-700 flex-1 truncate">{c.name}</span>
                      <span className="font-mono text-slate-400 w-10 text-right">{c.userLots}</span>
                      <span className={`font-mono font-bold w-16 text-right ${plColor(c.stats.totalPnl)}`}>
                        {fmtUsd(c.stats.totalPnl)}
                      </span>
                      <span className="font-mono text-slate-400 w-10 text-right">{fmtPct(c.stats.winRate, 0)}</span>
                      <span className="font-mono text-red-400 w-14 text-right">DD {fmtUsd(c.stats.maxDd)}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* P/L bar chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">P/L per strategia (scalato)</h3>
            <div className="space-y-1">
              {curveData.curves
                .sort((a, b) => b.stats.totalPnl - a.stats.totalPnl)
                .map(c => {
                  const maxAbs = Math.max(...curveData.curves.map(x => Math.abs(x.stats.totalPnl)), 1)
                  const pct = (c.stats.totalPnl / maxAbs) * 50
                  return (
                    <div key={c.strategyId} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                      <span className="text-[10px] font-mono text-slate-500 w-8">M{c.magic}</span>
                      <div className="flex-1 h-5 relative">
                        <div className="absolute inset-y-0 left-1/2 w-px bg-slate-200" />
                        {c.stats.totalPnl >= 0 ? (
                          <div className="absolute top-0 h-full rounded-r" style={{ left: '50%', width: `${Math.abs(pct)}%`, backgroundColor: c.color }} />
                        ) : (
                          <div className="absolute top-0 h-full rounded-l opacity-70" style={{ right: '50%', width: `${Math.abs(pct)}%`, backgroundColor: c.color }} />
                        )}
                      </div>
                      <span className={`text-[10px] font-mono w-16 text-right font-bold ${plColor(c.stats.totalPnl)}`}>
                        {fmtUsd(c.stats.totalPnl)}
                      </span>
                    </div>
                  )
                })}
            </div>
          </div>

          {/* Save PTF section */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Salva / Esporta</h3>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-[10px] uppercase text-slate-400 block mb-1">Nome PTF</label>
                <input
                  type="text"
                  value={ptfName}
                  onChange={e => setPtfName(e.target.value)}
                  placeholder="es. FTMO 10K Aggressive"
                  className="text-sm border border-slate-200 rounded px-2 py-1.5 w-60"
                />
              </div>
              <button
                onClick={savePTF}
                disabled={saving || !ptfName.trim() || selected.length === 0}
                className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {saving ? 'Salvataggio...' : `Salva PTF (${selected.length} strat.)`}
              </button>
              <button
                onClick={generateReport}
                disabled={!curveData || curveData.curves.length === 0}
                className="px-4 py-1.5 bg-slate-800 text-white text-xs font-medium rounded-lg hover:bg-slate-900 disabled:opacity-50 transition"
              >
                Report completo
              </button>
              <button
                onClick={exportConfig}
                disabled={selected.length === 0}
                className="px-4 py-1.5 border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition"
              >
                Esporta JSON
              </button>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {selected.length > 0 && (!curveData || curveData.curves.length === 0) && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <p className="text-slate-500 text-sm">Nessun trade per le strategie selezionate su questo conto.</p>
          <p className="text-slate-400 text-xs mt-1">Prova a selezionare un conto diverso.</p>
        </div>
      )}
    </div>
  )
}

// ============================================
// Portfolio Chart — All strategies overlaid
// ============================================

function PortfolioChart({ combined, curves, visible, showCombined, equityBase }: {
  combined: CombinedCurvePoint[]
  curves: StrategyEquityCurve[]
  visible: StrategyRow[] | { strategyId: string; chartColor: string }[]
  showCombined: boolean
  equityBase: number
}) {
  if (combined.length === 0) return null

  // Thin the data for rendering if too many points
  const maxPoints = 800
  const step = combined.length > maxPoints ? Math.ceil(combined.length / maxPoints) : 1
  const data = step === 1 ? combined : combined.filter((_, i) => i % step === 0 || i === combined.length - 1)

  const visibleIds = new Set((visible as { strategyId?: string; id?: string }[]).map(v => ('strategyId' in v ? v.strategyId : (v as StrategyRow).id)))

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickFormatter={(v: string) => v.slice(5)}
          interval={Math.max(Math.floor(data.length / 10), 1)}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
          domain={['auto', 'auto']}
        />
        <Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
          formatter={(value: unknown, name: unknown) => {
            const v = Number(value ?? 0)
            const n = String(name ?? '')
            const curve = curves.find(c => `eq_${c.strategyId}` === n)
            const label = curve ? `M${curve.magic} ${curve.name}` : n === 'equity' ? 'Portfolio' : n
            return [fmtUsd(v), label]
          }}
          labelFormatter={(label: unknown) => String(label ?? '')}
        />
        <ReferenceLine y={equityBase} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} />

        {/* Per-strategy equity lines */}
        {curves.map(c => (
          visibleIds.has(c.strategyId) && (
            <Line
              key={c.strategyId}
              type="monotone"
              dataKey={`eq_${c.strategyId}`}
              stroke={c.color}
              strokeWidth={1.5}
              dot={false}
              opacity={0.7}
              name={`eq_${c.strategyId}`}
            />
          )
        ))}

        {/* Combined portfolio line */}
        {showCombined && (
          <Line
            type="monotone"
            dataKey="equity"
            stroke={PORTFOLIO_COLOR}
            strokeWidth={2.5}
            dot={false}
            name="equity"
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}

// ============================================
// Individual Charts — One chart per strategy
// ============================================

function IndividualCharts({ curves, visible, equityBase, selectedStrat, onSelectStrat }: {
  curves: StrategyEquityCurve[]
  visible: StrategyRow[] | { strategyId: string }[]
  equityBase: number
  selectedStrat: string | null
  onSelectStrat: (id: string | null) => void
}) {
  const visibleIds = new Set((visible as { strategyId?: string; id?: string }[]).map(v => ('strategyId' in v ? v.strategyId : (v as StrategyRow).id)))
  const visibleCurves = curves.filter(c => visibleIds.has(c.strategyId))

  // If a strategy is selected for detail, show it large
  if (selectedStrat) {
    const curve = curves.find(c => c.strategyId === selectedStrat)
    if (curve) {
      return (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => onSelectStrat(null)} className="text-xs text-indigo-600 hover:underline">&larr; Torna alla griglia</button>
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: curve.color }} />
            <span className="text-sm font-semibold text-slate-800">M{curve.magic} — {curve.name}</span>
            <span className="text-xs text-slate-400 ml-auto">{curve.userLots} lotti | {curve.stats.totalTrades} trade</span>
          </div>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={curve.points} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: string) => v.slice(5)}
                interval={Math.max(Math.floor(curve.points.length / 10), 1)} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                formatter={(v: unknown) => [fmtUsd(Number(v ?? 0)), 'Equity']} />
              <ReferenceLine y={equityBase} stroke="#94a3b8" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="equity" stroke={curve.color} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-3">
            <StatsGrid stats={curve.stats} equityBase={equityBase} />
          </div>
        </div>
      )
    }
  }

  // Grid of small charts
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {visibleCurves.map(c => (
        <div
          key={c.strategyId}
          className="border border-slate-100 rounded-lg p-3 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition"
          onClick={() => onSelectStrat(c.strategyId)}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
            <span className="text-xs font-semibold text-slate-700">M{c.magic}</span>
            <span className="text-[10px] text-slate-400 truncate flex-1">{c.name}</span>
            <span className={`text-[10px] font-mono font-bold ${plColor(c.stats.totalPnl)}`}>{fmtUsd(c.stats.totalPnl)}</span>
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={c.points}>
              <Line type="monotone" dataKey="equity" stroke={c.color} strokeWidth={1.5} dot={false} />
              <ReferenceLine y={equityBase} stroke="#e2e8f0" strokeDasharray="2 2" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>{c.stats.totalTrades} trade</span>
            <span>WR {fmtPct(c.stats.winRate, 0)}</span>
            <span>DD {fmtUsd(c.stats.maxDd)}</span>
            <span>PF {fmt(c.stats.profitFactor, 1)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================
// Stats Grid
// ============================================

function StatsGrid({ stats, equityBase }: { stats: CurveStats | PortfolioStats; equityBase: number }) {
  const isPortfolio = 'strategyCount' in stats
  const returnPct = equityBase > 0 ? (stats.totalPnl / equityBase) * 100 : 0

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
      <StatBox label="P/L Totale" value={fmtUsd(stats.totalPnl)} color={plColor(stats.totalPnl)} />
      <StatBox label="Rendimento" value={fmtPct(returnPct)} color={plColor(returnPct)} />
      <StatBox label="Trade" value={String(stats.totalTrades)} />
      <StatBox label="Win Rate" value={fmtPct(stats.winRate, 1)} />
      <StatBox label="Max DD" value={fmtUsd(stats.maxDd)} color="text-red-600" sub={fmtPct(stats.maxDdPct)} />
      <StatBox label="Profit Factor" value={fmt(stats.profitFactor, 2)} color={stats.profitFactor >= 1 ? 'text-green-600' : 'text-red-600'} />
      <StatBox label="Sharpe" value={fmt(stats.sharpe, 2)} color={stats.sharpe >= 0.5 ? 'text-green-600' : stats.sharpe >= 0 ? 'text-amber-600' : 'text-red-600'} />
      <StatBox label="Recovery" value={fmt(stats.recoveryFactor, 2)} />
      <StatBox label="Avg Trade" value={fmtUsd(stats.avgTrade, 2)} color={plColor(stats.avgTrade)} />
      <StatBox label="Avg Win" value={fmtUsd(stats.avgWin, 2)} color="text-green-600" />
      <StatBox label="Avg Loss" value={fmtUsd(stats.avgLoss, 2)} color="text-red-600" />
      <StatBox label="Max Consec Loss" value={String(stats.maxConsecLoss)} color={stats.maxConsecLoss >= 5 ? 'text-red-600' : 'text-slate-700'} />
      {isPortfolio && <StatBox label="Strategie" value={String((stats as PortfolioStats).strategyCount)} />}
    </div>
  )
}

const STAT_TOOLTIPS: Record<string, import('@/lib/tooltip-content').TooltipKey> = {
  'Win Rate': 'win_rate', 'Max DD': 'max_dd', 'Profit Factor': 'profit_factor',
  'Sharpe': 'sharpe', 'Recovery': 'recovery_factor', 'Avg Trade': 'expectancy',
}

function StatBox({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  const tip = STAT_TOOLTIPS[label]
  return (
    <div>
      <div className="text-[10px] uppercase text-slate-400">{label}{tip && <InfoTooltip metricKey={tip} />}</div>
      <div className={`text-sm font-bold font-mono ${color || 'text-slate-800'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  )
}
