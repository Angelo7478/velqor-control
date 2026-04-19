'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelStrategy, QelAccount, QelBenchmark } from '@/types/database'
import {
  fmt, fmtUsd, fmtPct, plColor, groupColor, styleColor, styleLabel,
  calcFitnessScore, calcHealthReport, HealthReport,
  MonthlyStrategyStats, BestPortfolioResult, MonthlyAssetSummary, MonthlyKPIs, MonthlyTrendEntry,
  calcMonthlyStrategyStats, selectBestPortfolio, detectAssetRegime,
  generateMonthlyCommentary, generateAssetCommentary, generatePortfolioSummary,
  buildMonthlyTrend, calcDailyPnl, generateTrendCommentary, generateGeneralAnalysis,
  buildPublicStyleBreakdown, generatePublicAssetNarrative, generatePublicStyleNarrative,
  generatePublicSummary, PublicStyleBreakdown,
  ASSET_BENCHMARK_LABEL,
} from '@/lib/quant-utils'
import { VELQOR_LOGO_BASE64 } from '@/lib/velqor-logo'
import { myfxbookUrlFor } from '@/lib/myfxbook'
import QuantNav from '../quant-nav'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'

// ============================================
// Types
// ============================================

type ReportMode = 'monthly' | 'general'

interface TradeRow {
  strategy_id: string | null
  net_profit: number
  close_time: string
  lots: number
  symbol: string
}

// ============================================
// Helpers
// ============================================

function getMonthRange(yyyy_mm: string): { start: string; end: string } {
  const [y, m] = yyyy_mm.split('-').map(Number)
  const start = `${yyyy_mm}-01T00:00:00`
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  const end = `${nextMonth}-01T00:00:00`
  return { start, end }
}

function getPrevMonth(yyyy_mm: string): string {
  const [y, m] = yyyy_mm.split('-').map(Number)
  if (m === 1) return `${y - 1}-12`
  return `${y}-${String(m - 1).padStart(2, '0')}`
}

function getMonthOptions(): { value: string; label: string }[] {
  const MONTH_NAMES = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
  const now = new Date()
  const options: { value: string; label: string }[] = []
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    options.push({ value: val, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` })
  }
  return options
}

function fmtDateIT(d: string): string {
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ============================================
// Component
// ============================================

export default function MonthlyPage() {
  const [accounts, setAccounts] = useState<QelAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [strategies, setStrategies] = useState<QelStrategy[]>([])
  const [mode, setMode] = useState<ReportMode>('monthly')
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
  })
  const [loading, setLoading] = useState(true)

  // Data
  const [monthTrades, setMonthTrades] = useState<TradeRow[]>([])
  const [prevMonthTrades, setPrevMonthTrades] = useState<TradeRow[]>([])
  const [allTrades, setAllTrades] = useState<TradeRow[]>([])
  const [snapshots, setSnapshots] = useState<{ ts: string; equity: number }[]>([])
  const [benchmarks, setBenchmarks] = useState<Map<string, { ts: string; close_price: number }[]>>(new Map())
  const [perfData, setPerfData] = useState<Map<string, Record<string, unknown>>>(new Map())

  const monthOptions = useMemo(() => getMonthOptions(), [])

  // ---- Load accounts ----
  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const { data } = await supabase
        .from('qel_accounts')
        .select('*')
        .in('status', ['active', 'funded', 'challenge', 'verification'])
        .order('name')
      if (data && data.length > 0) {
        setAccounts(data)
        setSelectedAccountId(data[0].id)
      }
    }
    init()
  }, [])

  // ---- Load data when account/month/mode changes ----
  useEffect(() => {
    if (selectedAccountId) loadData()
  }, [selectedAccountId, selectedMonth, mode])

  async function loadData() {
    setLoading(true)
    const supabase = createClient()
    const { start, end } = getMonthRange(selectedMonth)
    const prev = getPrevMonth(selectedMonth)
    const { start: prevStart, end: prevEnd } = getMonthRange(prev)
    const acc = accounts.find(a => a.id === selectedAccountId)

    // Parallel queries
    const queries = [
      // 1. Current month trades
      supabase.from('qel_trades').select('strategy_id, net_profit, close_time, lots, symbol')
        .eq('account_id', selectedAccountId).eq('is_open', false)
        .not('strategy_id', 'is', null).not('close_time', 'is', null)
        .gte('close_time', start).lt('close_time', end).order('close_time'),
      // 2. Previous month trades
      supabase.from('qel_trades').select('strategy_id, net_profit, close_time, lots, symbol')
        .eq('account_id', selectedAccountId).eq('is_open', false)
        .not('strategy_id', 'is', null).not('close_time', 'is', null)
        .gte('close_time', prevStart).lt('close_time', prevEnd).order('close_time'),
      // 3. Strategies
      supabase.from('qel_strategies').select('*').order('magic'),
      // 4. Snapshots for equity curve
      supabase.from('qel_account_snapshots').select('ts, equity')
        .eq('account_id', selectedAccountId)
        .gte('ts', mode === 'monthly' ? start : '2020-01-01')
        .lt('ts', end).order('ts'),
      // 5. Benchmarks (3 months lookback for regime)
      supabase.from('qel_benchmarks').select('symbol, ts, close_price')
        .gte('ts', new Date(new Date(start).getTime() - 250 * 86400000).toISOString().slice(0, 10))
        .lte('ts', end.slice(0, 10)).order('ts'),
      // 6. Per-account performance
      supabase.from('v_strategy_recent_performance').select('*')
        .eq('account_id', selectedAccountId),
    ]

    // For general mode, also load all trades
    if (mode === 'general') {
      queries.push(
        supabase.from('qel_trades').select('strategy_id, net_profit, close_time, lots, symbol')
          .eq('account_id', selectedAccountId).eq('is_open', false)
          .not('strategy_id', 'is', null).not('close_time', 'is', null)
          .order('close_time')
      )
    }

    const results = await Promise.all(queries)

    setMonthTrades((results[0].data || []) as TradeRow[])
    setPrevMonthTrades((results[1].data || []) as TradeRow[])
    setStrategies(results[2].data || [])

    const snapData = (results[3].data || []).map((s: Record<string, unknown>) => ({
      ts: s.ts as string,
      equity: Number(s.equity),
    }))
    setSnapshots(snapData)

    // Group benchmarks by symbol
    const benchMap = new Map<string, { ts: string; close_price: number }[]>()
    for (const b of (results[4].data || []) as QelBenchmark[]) {
      if (!benchMap.has(b.symbol)) benchMap.set(b.symbol, [])
      benchMap.get(b.symbol)!.push({ ts: b.ts, close_price: Number(b.close_price) })
    }
    setBenchmarks(benchMap)

    // Performance map
    const pMap = new Map<string, Record<string, unknown>>()
    for (const p of (results[5].data || [])) {
      pMap.set(p.strategy_id as string, p)
    }
    setPerfData(pMap)

    if (mode === 'general' && results[6]) {
      setAllTrades((results[6].data || []) as TradeRow[])
    }

    setLoading(false)
  }

  // ---- Computed data ----

  const tradesToAnalyze = mode === 'monthly' ? monthTrades : allTrades

  // Strategy stats with health
  const strategyStats = useMemo((): MonthlyStrategyStats[] => {
    if (strategies.length === 0) return []

    return strategies
      .filter(s => s.status === 'active' || s.status === 'paused')
      .map(s => {
        const trades = tradesToAnalyze.filter(t => t.strategy_id === s.id)
        const prev = prevMonthTrades.filter(t => t.strategy_id === s.id)
        const perf = perfData.get(s.id)

        // Calc health using existing engine
        const avgRealLot = perf ? Number(perf.avg_lots ?? 0) : null
        const totalPnl = perf ? Number(perf.total_pnl ?? 0) : 0
        const totalTrades = perf ? Number(perf.total_trades ?? 0) : 0

        // Calculate consecutive losses from trade data
        let consecLosses = 0
        const allStratTrades = tradesToAnalyze.filter(t => t.strategy_id === s.id)
        for (let i = allStratTrades.length - 1; i >= 0; i--) {
          if (Number(allStratTrades[i].net_profit) < 0) consecLosses++
          else break
        }

        // Calculate equity peak from cumulative P/L
        let peak = 0, cumPnl = 0
        for (const t of allStratTrades) {
          cumPnl += Number(t.net_profit)
          if (cumPnl > peak) peak = cumPnl
        }

        const healthReport = calcHealthReport(
          {
            id: s.id, magic: s.magic, name: s.name,
            strategy_family: s.strategy_family, strategy_style: s.strategy_style,
            test_win_pct: s.test_win_pct, test_payoff: s.test_payoff,
            test_max_dd: s.test_max_dd, test_expectancy: s.test_expectancy,
            test_max_consec_loss: s.test_max_consec_loss, lot_static: s.lot_static,
            real_trades: totalTrades, real_win_pct: perf ? Number(perf.win_pct ?? null) : null,
            real_payoff: perf ? Number(perf.payoff ?? null) : null,
            real_max_dd: perf ? Number(perf.max_dd ?? 0) : 0,
            real_expectancy: null, real_pl: totalPnl,
          },
          {
            avgRealLot: avgRealLot, consecLosses, cumulativePnl: cumPnl,
            equityPeak: peak, recentWinPct: perf ? Number(perf.win_pct ?? null) : null,
            avgTrade: null, totalTrades,
          }
        )

        return calcMonthlyStrategyStats(
          trades, prev, s,
          healthReport.healthStatus, healthReport.fitnessScore,
        )
      })
      .sort((a, b) => b.monthlyPl - a.monthlyPl)
  }, [strategies, tradesToAnalyze, prevMonthTrades, perfData])

  // Best portfolio
  const bestPortfolio = useMemo((): BestPortfolioResult => {
    const testMap = new Map(strategies.map(s => [s.id, { test_win_pct: s.test_win_pct }]))
    return selectBestPortfolio(strategyStats, testMap)
  }, [strategyStats, strategies])

  // Merge commentary and best portfolio flag into stats
  const enrichedStats = useMemo((): MonthlyStrategyStats[] => {
    const bestIds = new Set(bestPortfolio.selected.map(s => s.strategyId))
    return strategyStats.map(s => {
      const enriched = { ...s, inBestPortfolio: bestIds.has(s.strategyId) }
      enriched.commentary = generateMonthlyCommentary(enriched)
      return enriched
    })
  }, [strategyStats, bestPortfolio])

  // Asset summaries
  const assetSummaries = useMemo((): MonthlyAssetSummary[] => {
    const byAsset = new Map<string, MonthlyAssetSummary>()
    for (const s of enrichedStats) {
      if (s.monthlyTrades === 0) continue
      const asset = s.asset
      if (!byAsset.has(asset)) {
        const benchData = benchmarks.get(asset) || []
        const { regime, detail } = detectAssetRegime(benchData)
        byAsset.set(asset, {
          asset,
          assetLabel: ASSET_BENCHMARK_LABEL[asset] || asset,
          totalPl: 0, totalTrades: 0,
          strategies: [], regime, regimeDetail: detail, commentary: '',
        })
      }
      const a = byAsset.get(asset)!
      a.totalPl += s.monthlyPl
      a.totalTrades += s.monthlyTrades
      a.strategies.push({ name: s.name, magic: s.magic, pl: s.monthlyPl, winRate: s.monthlyWinRate, trades: s.monthlyTrades })
    }
    // Round and generate commentary
    const summaries = [...byAsset.values()]
      .map(a => {
        a.totalPl = Math.round(a.totalPl * 100) / 100
        a.commentary = generateAssetCommentary(a)
        return a
      })
      .filter(a => a.totalTrades >= (mode === 'general' ? 5 : 2))
      .sort((a, b) => b.totalPl - a.totalPl)
    return summaries
  }, [enrichedStats, benchmarks, mode])

  // Monthly KPIs
  const kpis = useMemo((): MonthlyKPIs => {
    const trades = tradesToAnalyze
    const pnls = trades.map(t => Number(t.net_profit))
    const totalPl = pnls.reduce((s, v) => s + v, 0)
    const wins = pnls.filter(p => p > 0)
    const winRate = pnls.length > 0 ? (wins.length / pnls.length) * 100 : 0
    const grossProfit = wins.reduce((s, v) => s + v, 0)
    const grossLoss = Math.abs(pnls.filter(p => p < 0).reduce((s, v) => s + v, 0))
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0

    // Max DD from equity curve
    const acc = accounts.find(a => a.id === selectedAccountId)
    const equityBase = acc?.account_size || 10000
    let peak = equityBase, maxDd = 0
    let cumEq = equityBase
    for (const p of pnls) {
      cumEq += p
      if (cumEq > peak) peak = cumEq
      const dd = peak - cumEq
      if (dd > maxDd) maxDd = dd
    }
    const maxDdPct = equityBase > 0 ? (maxDd / equityBase) * 100 : 0

    // Daily P/L for best/worst day
    const daily = calcDailyPnl(trades)
    const bestDay = daily.length > 0 ? daily.reduce((a, b) => a.pl > b.pl ? a : b) : null
    const worstDay = daily.length > 0 ? daily.reduce((a, b) => a.pl < b.pl ? a : b) : null

    // For general mode: CAGR, Sharpe, Recovery
    let cagr: number | undefined
    let sharpe: number | undefined
    let recoveryFactor: number | undefined
    if (mode === 'general' && trades.length > 0) {
      const allDates = trades.map(t => t.close_time).sort()
      const firstDate = new Date(allDates[0])
      const lastDate = new Date(allDates[allDates.length - 1])
      const years = Math.max(0.1, (lastDate.getTime() - firstDate.getTime()) / (365.25 * 86400000))
      const totalReturn = totalPl / equityBase
      cagr = (Math.pow(1 + totalReturn, 1 / years) - 1) * 100

      // Sharpe
      const mean = pnls.length > 0 ? totalPl / pnls.length : 0
      const variance = pnls.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / Math.max(pnls.length, 1)
      const std = Math.sqrt(variance)
      sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0

      recoveryFactor = maxDd > 0 ? totalPl / maxDd : 0
    }

    return {
      totalPl: Math.round(totalPl * 100) / 100,
      totalTrades: pnls.length,
      winRate: Math.round(winRate * 10) / 10,
      maxDd: Math.round(maxDd * 100) / 100,
      maxDdPct: Math.round(maxDdPct * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      bestDay: bestDay && bestDay.pl !== 0 ? { date: bestDay.date, pl: bestDay.pl } : null,
      worstDay: worstDay && worstDay.pl !== 0 ? { date: worstDay.date, pl: worstDay.pl } : null,
      tradingDays: daily.length,
      cagr: cagr !== undefined ? Math.round(cagr * 10) / 10 : undefined,
      sharpe: sharpe !== undefined ? Math.round(sharpe * 100) / 100 : undefined,
      recoveryFactor: recoveryFactor !== undefined ? Math.round(recoveryFactor * 100) / 100 : undefined,
    }
  }, [tradesToAnalyze, accounts, selectedAccountId, mode])

  // Previous month KPIs (for comparison)
  const prevKpis = useMemo((): MonthlyKPIs | null => {
    if (prevMonthTrades.length === 0) return null
    const pnls = prevMonthTrades.map(t => Number(t.net_profit))
    const totalPl = pnls.reduce((s, v) => s + v, 0)
    const wins = pnls.filter(p => p > 0)
    const winRate = pnls.length > 0 ? (wins.length / pnls.length) * 100 : 0
    const grossProfit = wins.reduce((s, v) => s + v, 0)
    const grossLoss = Math.abs(pnls.filter(p => p < 0).reduce((s, v) => s + v, 0))
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0
    return {
      totalPl: Math.round(totalPl * 100) / 100,
      totalTrades: pnls.length,
      winRate: Math.round(winRate * 10) / 10,
      maxDd: 0, maxDdPct: 0,
      profitFactor: Math.round(profitFactor * 100) / 100,
      bestDay: null, worstDay: null, tradingDays: 0,
    }
  }, [prevMonthTrades])

  // Monthly trend (general mode)
  const monthlyTrend = useMemo((): MonthlyTrendEntry[] => {
    if (mode !== 'general') return []
    return buildMonthlyTrend(allTrades)
  }, [allTrades, mode])

  // Portfolio summary text
  const summaryText = useMemo(() => {
    const monthLabel = monthOptions.find(o => o.value === selectedMonth)?.label || selectedMonth
    const periodLabel = mode === 'monthly' ? monthLabel : `inizio — ${monthLabel}`
    return generatePortfolioSummary(bestPortfolio, kpis, prevKpis, mode, periodLabel)
  }, [bestPortfolio, kpis, prevKpis, mode, selectedMonth])

  // Trend commentary (general mode)
  const trendCommentary = useMemo(() => {
    if (mode !== 'general' || monthlyTrend.length === 0) return ''
    return generateTrendCommentary(monthlyTrend)
  }, [mode, monthlyTrend])

  // Multi-paragraph general analysis
  const generalAnalysis = useMemo((): string[] => {
    if (mode !== 'general') return []
    return generateGeneralAnalysis(enrichedStats, assetSummaries, monthlyTrend, kpis, bestPortfolio)
  }, [mode, enrichedStats, assetSummaries, monthlyTrend, kpis, bestPortfolio])

  // Public report data
  const styleBreakdown = useMemo((): PublicStyleBreakdown[] => {
    return buildPublicStyleBreakdown(enrichedStats)
  }, [enrichedStats])

  const publicSummary = useMemo((): string[] => {
    const monthLabel = monthOptions.find(o => o.value === selectedMonth)?.label || selectedMonth
    const periodLabel = mode === 'monthly' ? monthLabel : `inizio — ${monthLabel}`
    return generatePublicSummary(kpis, assetSummaries, styleBreakdown, monthlyTrend, mode, periodLabel)
  }, [kpis, assetSummaries, styleBreakdown, monthlyTrend, mode, selectedMonth])

  // Equity curve chart data
  const equityChartData = useMemo(() => {
    if (snapshots.length === 0) return []
    // Downsample to max 200 points for chart performance
    const step = Math.max(1, Math.floor(snapshots.length / 200))
    return snapshots.filter((_, i) => i % step === 0 || i === snapshots.length - 1).map(s => ({
      ts: s.ts.slice(0, mode === 'monthly' ? 10 : 7),
      equity: Math.round(s.equity * 100) / 100,
    }))
  }, [snapshots, mode])

  // ---- Report PDF ----

  function openReport() {
    const acc = accounts.find(a => a.id === selectedAccountId)
    const dateNow = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })
    const monthLabel = monthOptions.find(o => o.value === selectedMonth)?.label || selectedMonth
    const title = mode === 'monthly' ? 'Monthly Performance Report' : 'Cumulative Performance Report'
    const accLogin = acc?.login ? ` · MT5 #${acc.login}` : ''
    const subtitle = mode === 'monthly'
      ? `${monthLabel} — ${acc?.name || 'N/A'}${accLogin} — ${dateNow}`
      : `Dall\'inizio a ${monthLabel} — ${acc?.name || 'N/A'}${accLogin} — ${dateNow}`
    const myfxbookUrl = myfxbookUrlFor(acc?.login)

    const fmtR = (n: number, d = 2) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
    const fmtM = (n: number) => { const p = n >= 0 ? '' : '-'; return `${p}$${Math.abs(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` }
    const plC = (n: number) => n > 0 ? '#16a34a' : n < 0 ? '#dc2626' : '#475569'

    // Build strategy rows — only strategies with trades in the period
    const activeStats = enrichedStats.filter(s => s.monthlyTrades > 0)
    const stratRows = activeStats.map(s => `
      <tr${s.inBestPortfolio ? ' style="border-left:3px solid #16a34a"' : ''}>
        <td class="bold">M${s.magic}</td>
        <td>${s.name}</td>
        <td>${s.asset}</td>
        <td class="text-right" style="color:${plC(s.monthlyPl)};font-weight:700">${fmtM(s.monthlyPl)}</td>
        <td class="text-center">${s.monthlyTrades}</td>
        <td class="text-right">${fmtR(s.monthlyWinRate, 1)}%</td>
        <td class="text-right">${s.monthlyProfitFactor < 900 ? fmtR(s.monthlyProfitFactor) : '—'}</td>
        <td class="text-center">${s.inBestPortfolio ? '<span style="color:#16a34a;font-weight:700">BEST</span>' : ''}</td>
        <td style="font-size:9px;color:#64748b;max-width:200px">${s.commentary}</td>
      </tr>`).join('')

    // Build asset rows
    const assetRows = assetSummaries.map(a => `
      <div style="margin:8px 0;padding:10px;background:#f8fafc;border-radius:8px;border-left:3px solid ${a.totalPl >= 0 ? '#16a34a' : '#dc2626'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <strong>${a.assetLabel}</strong>
          <span style="color:${plC(a.totalPl)};font-weight:700;font-family:monospace">${fmtM(a.totalPl)}</span>
        </div>
        <div style="font-size:10px;color:#475569">${a.commentary}</div>
      </div>`).join('')

    // Build monthly trend table (general mode)
    let trendSection = ''
    if (mode === 'general' && monthlyTrend.length > 0) {
      const trendRows = monthlyTrend.map(m => `
        <tr>
          <td class="bold">${m.monthLabel}</td>
          <td class="text-right" style="color:${plC(m.pl)};font-weight:700">${fmtM(m.pl)}</td>
          <td class="text-center">${m.trades}</td>
          <td class="text-right">${fmtR(m.winRate, 1)}%</td>
          <td class="text-right">${m.profitFactor < 900 ? fmtR(m.profitFactor) : '—'}</td>
          <td>
            <div style="display:flex;align-items:center;gap:4px">
              <div style="width:${Math.min(100, Math.abs(m.pl) / Math.max(...monthlyTrend.map(x => Math.abs(x.pl)), 1) * 100)}px;height:12px;background:${m.pl >= 0 ? '#16a34a' : '#dc2626'};border-radius:3px"></div>
            </div>
          </td>
        </tr>`).join('')

      trendSection = `
        <h2>Trend Mensile</h2>
        <table>
          <thead><tr><th>Mese</th><th class="text-right">P/L</th><th class="text-center">Trade</th><th class="text-right">WR</th><th class="text-right">PF</th><th></th></tr></thead>
          <tbody>${trendRows}</tbody>
        </table>
        ${trendCommentary ? `<div style="font-size:10px;color:#475569;margin:8px 0;padding:10px;background:#f8fafc;border-radius:6px;line-height:1.6">${trendCommentary}</div>` : ''}`
    }

    // Extra KPIs for general mode
    const extraKpis = mode === 'general' ? `
      <div class="kpi">
        <div class="kpi-label">CAGR</div>
        <div class="kpi-value" style="color:${plC(kpis.cagr || 0)}">${fmtR(kpis.cagr || 0, 1)}%</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Sharpe</div>
        <div class="kpi-value" style="color:${(kpis.sharpe || 0) >= 0.5 ? '#16a34a' : '#b45309'}">${fmtR(kpis.sharpe || 0)}</div>
      </div>` : ''

    // Build equity SVG
    let equitySvg = ''
    if (equityChartData.length > 1) {
      const w = 700, h = 200, pad = 30
      const eqVals = equityChartData.map(d => d.equity)
      const minEq = Math.min(...eqVals) * 0.999
      const maxEq = Math.max(...eqVals) * 1.001
      const scaleX = (i: number) => pad + (i / (equityChartData.length - 1)) * (w - 2 * pad)
      const scaleY = (v: number) => h - pad - ((v - minEq) / (maxEq - minEq)) * (h - 2 * pad)
      const points = equityChartData.map((d, i) => `${scaleX(i).toFixed(1)},${scaleY(d.equity).toFixed(1)}`).join(' ')
      const areaPoints = `${scaleX(0).toFixed(1)},${(h - pad).toFixed(1)} ${points} ${scaleX(equityChartData.length - 1).toFixed(1)},${(h - pad).toFixed(1)}`
      equitySvg = `
        <svg viewBox="0 0 ${w} ${h}" style="width:100%;max-height:200px">
          <polygon points="${areaPoints}" fill="#6366f120" />
          <polyline points="${points}" fill="none" stroke="#6366f1" stroke-width="1.5" />
          <text x="${pad}" y="${h - 8}" font-size="9" fill="#94a3b8">${equityChartData[0].ts}</text>
          <text x="${w - pad}" y="${h - 8}" font-size="9" fill="#94a3b8" text-anchor="end">${equityChartData[equityChartData.length - 1].ts}</text>
          <text x="${pad - 4}" y="${scaleY(maxEq) + 4}" font-size="9" fill="#94a3b8" text-anchor="end">${fmtM(maxEq)}</text>
          <text x="${pad - 4}" y="${scaleY(minEq) + 4}" font-size="9" fill="#94a3b8" text-anchor="end">${fmtM(minEq)}</text>
        </svg>`
    }

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>VELQOR Quant — ${title}</title>
<style>
  /* Margin 0 on @page suppresses Chrome's print header (title+date) and footer (URL+page). */
  @page { size: A4; margin: 0; }
  @media print { body { margin: 14mm 12mm; } }
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
  .kpi-grid { display: grid; grid-template-columns: repeat(${mode === 'general' ? 3 : 4}, 1fr); gap: 10px; margin-bottom: 15px; }
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
  .best-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; margin: 15px 0; }
  .best-title { font-size: 13px; font-weight: 700; color: #16a34a; margin-bottom: 8px; }
  .summary-box { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px; margin: 15px 0; font-size: 11px; line-height: 1.6; color: #334155; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 9px; text-align: center; }
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
      <h1>${title}</h1>
      <div class="subtitle">${acc?.name || 'N/A'}${accLogin}</div>
      <div class="subtitle" style="margin-top:-8px;font-size:11px;color:#94a3b8">${mode === 'monthly' ? `${monthLabel} — ${dateNow}` : `Dall'inizio a ${monthLabel} — ${dateNow}`}</div>
      ${myfxbookUrl ? `<div style="margin-top:8px"><a href="${myfxbookUrl}" target="_blank" style="display:inline-block;background:#eef2ff;color:#4338ca;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;text-decoration:none;border:1px solid #c7d2fe">🔗 Verifica il track record live su myfxbook →</a></div>` : ''}
    </div>
    <div class="meta">
      <div>Account: <strong>${acc?.name || 'N/A'}</strong></div>
      <div>Size: <strong>${fmtM(acc?.account_size || 0)}</strong></div>
      <div>Strategie analizzate: <strong>${enrichedStats.length}</strong></div>
      <div style="margin-top:4px"><button class="no-print" onclick="window.print()" style="padding:4px 12px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-size:11px">Stampa / PDF</button></div>
    </div>
  </div>

  <!-- KPI -->
  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">P/L ${mode === 'monthly' ? 'Mese' : 'Totale'}</div>
      <div class="kpi-value" style="color:${plC(kpis.totalPl)}">${fmtM(kpis.totalPl)}</div>
      <div class="kpi-sub">${kpis.tradingDays} giorni di trading</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Trade / Win Rate</div>
      <div class="kpi-value">${kpis.totalTrades}</div>
      <div class="kpi-sub">WR ${fmtR(kpis.winRate, 1)}%</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Max Drawdown</div>
      <div class="kpi-value" style="color:#dc2626">${fmtM(kpis.maxDd)}</div>
      <div class="kpi-sub">${fmtR(kpis.maxDdPct, 1)}% dell'equity</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Profit Factor</div>
      <div class="kpi-value" style="color:${kpis.profitFactor >= 1 ? '#16a34a' : '#dc2626'}">${fmtR(kpis.profitFactor)}</div>
      ${kpis.bestDay ? `<div class="kpi-sub">Best day: ${fmtM(kpis.bestDay.pl)}</div>` : ''}
    </div>
    ${extraKpis}
  </div>

  ${prevKpis && mode === 'monthly' ? `
  <div style="font-size:10px;color:#64748b;margin-bottom:12px">
    vs mese precedente: <span style="color:${plC(kpis.totalPl - prevKpis.totalPl)};font-weight:600">${kpis.totalPl - prevKpis.totalPl >= 0 ? '+' : ''}${fmtM(kpis.totalPl - prevKpis.totalPl)}</span>
    (${prevKpis.totalTrades} trade, WR ${fmtR(prevKpis.winRate, 1)}%)
  </div>` : ''}

  <!-- Best Portfolio -->
  ${bestPortfolio.selected.length > 0 ? `
  <div class="best-box">
    <div class="best-title">BEST PORTFOLIO — ${bestPortfolio.selected.length} Strategie</div>
    <div style="display:flex;gap:15px;margin-bottom:8px;font-size:10px">
      <div>P/L: <strong style="color:${plC(bestPortfolio.totalPl)}">${fmtM(bestPortfolio.totalPl)}</strong></div>
      <div>WR medio: <strong>${fmtR(bestPortfolio.avgWinRate, 1)}%</strong></div>
      <div>PF medio: <strong>${fmtR(bestPortfolio.avgProfitFactor)}</strong></div>
    </div>
    <div style="font-size:9px;color:#64748b">Criteri: ${bestPortfolio.selectionCriteria}</div>
    <div style="margin-top:6px;font-size:10px">
      ${bestPortfolio.selected.map(s => `<span style="display:inline-block;padding:2px 8px;background:#dcfce7;border-radius:10px;margin:2px;font-size:10px;font-weight:500">M${s.magic} ${s.name} (${fmtM(s.monthlyPl)})</span>`).join('')}
    </div>
  </div>` : `
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin:15px 0;font-size:11px;color:#991b1b">
    Nessuna strategia soddisfa i criteri del Best Portfolio questo mese.
  </div>`}

  ${trendSection}

  <!-- Ranking Strategie -->
  <h2>Ranking Strategie</h2>
  <table>
    <thead>
      <tr>
        <th>Magic</th><th>Nome</th><th>Asset</th>
        <th class="text-right">P/L</th><th class="text-center">Trade</th>
        <th class="text-right">WR</th><th class="text-right">PF</th>
        <th class="text-center">Best</th><th>Commento</th>
      </tr>
    </thead>
    <tbody>${stratRows}</tbody>
  </table>

  <!-- Analisi Asset -->
  <h2>Analisi per Asset</h2>
  ${assetRows}

  <!-- Equity Curve -->
  ${equitySvg ? `
  <h2>Equity Curve</h2>
  ${equitySvg}` : ''}

  <!-- Summary / Analysis -->
  ${mode === 'general' && generalAnalysis.length > 0
    ? `<h2>Analisi Generale</h2><div class="summary-box">${generalAnalysis.map(p => `<p style="margin-bottom:8px">${p}</p>`).join('')}</div>`
    : `<div class="summary-box">${summaryText}</div>`
  }

  <!-- Footer -->
  <div class="footer">
    <div>Generato il ${dateNow} — Velqor Intelligent Quant System</div>
    <div style="margin-top:4px">Dati da operativita' reale. Le performance passate non garantiscono risultati futuri.</div>
  </div>

</div>
</body>
</html>`

    const w = window.open('', '_blank')
    if (w) {
      w.document.write(html)
      w.document.close()
    }
  }

  // ---- Public Report PDF ----

  function openPublicReport() {
    const acc = accounts.find(a => a.id === selectedAccountId)
    const dateNow = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })
    const monthLbl = monthOptions.find(o => o.value === selectedMonth)?.label || selectedMonth
    const title = mode === 'monthly' ? 'Performance Report' : 'Cumulative Performance Report'
    const accLogin = acc?.login ? ` · MT5 #${acc.login}` : ''
    const subtitle = mode === 'monthly'
      ? `${monthLbl}${accLogin} — ${dateNow}`
      : `Dall\'inizio a ${monthLbl}${accLogin} — ${dateNow}`
    const myfxbookUrl = myfxbookUrlFor(acc?.login)

    const fmtR = (n: number, d = 2) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
    const fmtM = (n: number) => { const p = n >= 0 ? '' : '-'; return `${p}$${Math.abs(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` }
    const plC = (n: number) => n > 0 ? '#16a34a' : n < 0 ? '#dc2626' : '#475569'

    // Asset narrative cards (no strategy names/magic)
    const assetCards = assetSummaries.map(a => {
      const narrative = generatePublicAssetNarrative(a, mode)
      const regimeIcon = a.regime === 'up' ? '&#9650;' : a.regime === 'down' ? '&#9660;' : a.regime === 'range' ? '&#9644;' : ''
      const regimeColor = a.regime === 'up' ? '#16a34a' : a.regime === 'down' ? '#dc2626' : '#b45309'
      return `
        <div style="background:#f8fafc;border-radius:10px;padding:14px;border-left:4px solid ${plC(a.totalPl)}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="font-weight:700;font-size:13px">${a.assetLabel}</div>
            <div style="display:flex;align-items:center;gap:8px">
              ${a.regime !== 'unknown' ? `<span style="font-size:10px;color:${regimeColor}">${regimeIcon} ${a.regime.toUpperCase()}</span>` : ''}
              <span style="font-weight:700;font-family:monospace;color:${plC(a.totalPl)}">${fmtM(a.totalPl)}</span>
            </div>
          </div>
          <div style="font-size:10px;color:#64748b;margin-bottom:4px">${a.totalTrades} operazioni</div>
          <div style="font-size:11px;color:#334155;line-height:1.6">${narrative}</div>
        </div>`
    }).join('')

    // Style breakdown cards (no individual strategy details)
    const styleCards = styleBreakdown.map(s => {
      const narrative = generatePublicStyleNarrative(s, kpis.totalPl)
      const styleIcons: Record<string, string> = {
        mean_reversion: '&#8634;', trend_following: '&#8599;', seasonal: '&#9681;',
        breakout: '&#9889;', hybrid: '&#8727;',
      }
      return `
        <div style="background:#f8fafc;border-radius:10px;padding:14px;border-left:4px solid ${plC(s.totalPl)}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="font-weight:700;font-size:13px">${styleIcons[s.style] || ''} ${s.styleLabel}</div>
            <span style="font-weight:700;font-family:monospace;color:${plC(s.totalPl)}">${fmtM(s.totalPl)}</span>
          </div>
          <div style="font-size:10px;color:#64748b;margin-bottom:4px">${s.count} strategie — ${s.totalTrades} operazioni — WR ${fmtR(s.winRate, 1)}%</div>
          <div style="font-size:11px;color:#334155;line-height:1.6">${narrative}</div>
        </div>`
    }).join('')

    // Monthly trend table (general mode only, no strategy details)
    let trendSection = ''
    if (mode === 'general' && monthlyTrend.length > 0) {
      const trendRows = monthlyTrend.map(m => `
        <tr>
          <td class="bold">${m.monthLabel}</td>
          <td class="text-right" style="color:${plC(m.pl)};font-weight:700">${fmtM(m.pl)}</td>
          <td class="text-center">${m.trades}</td>
          <td class="text-right">${fmtR(m.winRate, 1)}%</td>
          <td>
            <div style="display:flex;align-items:center;gap:4px">
              <div style="width:${Math.min(100, Math.abs(m.pl) / Math.max(...monthlyTrend.map(x => Math.abs(x.pl)), 1) * 100)}px;height:12px;background:${m.pl >= 0 ? '#16a34a' : '#dc2626'};border-radius:3px"></div>
            </div>
          </td>
        </tr>`).join('')

      trendSection = `
        <h2>Andamento Mensile</h2>
        <table>
          <thead><tr><th>Mese</th><th class="text-right">Risultato</th><th class="text-center">Operazioni</th><th class="text-right">Win Rate</th><th></th></tr></thead>
          <tbody>${trendRows}</tbody>
        </table>
        ${trendCommentary ? `<div style="font-size:10px;color:#475569;margin:8px 0;padding:10px;background:#f8fafc;border-radius:6px;line-height:1.6">${trendCommentary}</div>` : ''}`
    }

    // Equity SVG
    let equitySvg = ''
    if (equityChartData.length > 1) {
      const w = 700, h = 200, pad = 30
      const eqVals = equityChartData.map(d => d.equity)
      const minEq = Math.min(...eqVals) * 0.999
      const maxEq = Math.max(...eqVals) * 1.001
      const scaleX = (i: number) => pad + (i / (equityChartData.length - 1)) * (w - 2 * pad)
      const scaleY = (v: number) => h - pad - ((v - minEq) / (maxEq - minEq)) * (h - 2 * pad)
      const points = equityChartData.map((d, i) => `${scaleX(i).toFixed(1)},${scaleY(d.equity).toFixed(1)}`).join(' ')
      const areaPoints = `${scaleX(0).toFixed(1)},${(h - pad).toFixed(1)} ${points} ${scaleX(equityChartData.length - 1).toFixed(1)},${(h - pad).toFixed(1)}`
      equitySvg = `
        <svg viewBox="0 0 ${w} ${h}" style="width:100%;max-height:200px">
          <polygon points="${areaPoints}" fill="#6366f120" />
          <polyline points="${points}" fill="none" stroke="#6366f1" stroke-width="1.5" />
          <text x="${pad}" y="${h - 8}" font-size="9" fill="#94a3b8">${equityChartData[0].ts}</text>
          <text x="${w - pad}" y="${h - 8}" font-size="9" fill="#94a3b8" text-anchor="end">${equityChartData[equityChartData.length - 1].ts}</text>
        </svg>`
    }

    // Public summary paragraphs
    const summaryHtml = publicSummary.map(p => `<p style="margin-bottom:8px">${p}</p>`).join('')

    // Extra KPIs for general mode
    const extraKpis = mode === 'general' ? `
      <div class="kpi">
        <div class="kpi-label">CAGR</div>
        <div class="kpi-value" style="color:${plC(kpis.cagr || 0)}">${fmtR(kpis.cagr || 0, 1)}%</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Sharpe Ratio</div>
        <div class="kpi-value" style="color:${(kpis.sharpe || 0) >= 0.5 ? '#16a34a' : '#b45309'}">${fmtR(kpis.sharpe || 0)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Recovery Factor</div>
        <div class="kpi-value">${fmtR(kpis.recoveryFactor || 0)}</div>
      </div>` : ''

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>VELQOR Quant — ${title}</title>
<style>
  /* Margin 0 on @page suppresses Chrome's print header (title+date) and footer (URL+page). */
  @page { size: A4; margin: 0; }
  @media print { body { margin: 14mm 12mm; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; font-size: 11px; line-height: 1.6; background: #fff; }
  .page { max-width: 800px; margin: 0 auto; padding: 20px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 2px; }
  h2 { font-size: 14px; font-weight: 600; margin: 24px 0 10px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; color: #334155; }
  .subtitle { color: #64748b; font-size: 12px; margin-bottom: 20px; }
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
  .logo-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .logo-img { width: 40px; height: 40px; object-fit: contain; }
  .logo-text { font-size: 14px; font-weight: 800; color: #0f172a; letter-spacing: 3px; }
  .logo-sub { font-size: 9px; font-weight: 500; color: #6366f1; letter-spacing: 1.5px; text-transform: uppercase; }
  .meta { text-align: right; color: #94a3b8; font-size: 10px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(${mode === 'general' ? 3 : 4}, 1fr); gap: 10px; margin-bottom: 20px; }
  .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; }
  .kpi-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; }
  .kpi-value { font-size: 18px; font-weight: 700; font-family: 'SF Mono', Monaco, monospace; margin-top: 2px; }
  .kpi-sub { font-size: 9px; color: #94a3b8; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 10px; }
  th { background: #f8fafc; text-align: left; padding: 6px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; border-bottom: 2px solid #e2e8f0; }
  td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; font-family: 'SF Mono', Monaco, monospace; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .bold { font-weight: 700; }
  .cards-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 15px; }
  .summary-box { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; padding: 16px; margin: 20px 0; font-size: 11px; line-height: 1.7; color: #334155; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 9px; text-align: center; }
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
      <h1>${title}</h1>
      <div class="subtitle">${acc?.name || 'Portafoglio'}${accLogin}</div>
      <div class="subtitle" style="margin-top:-8px;font-size:11px;color:#94a3b8">${mode === 'monthly' ? `${monthLbl} — ${dateNow}` : `Dall'inizio a ${monthLbl} — ${dateNow}`}</div>
      ${myfxbookUrl ? `<div style="margin-top:8px"><a href="${myfxbookUrl}" target="_blank" style="display:inline-block;background:#eef2ff;color:#4338ca;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;text-decoration:none;border:1px solid #c7d2fe">🔗 Verifica il track record live su myfxbook →</a></div>` : ''}
    </div>
    <div class="meta">
      <div>Portafoglio Sistematico</div>
      <div>${assetSummaries.length} sottostanti — ${styleBreakdown.length} famiglie</div>
      <div style="margin-top:4px"><button class="no-print" onclick="window.print()" style="padding:4px 12px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-size:11px">Stampa / PDF</button></div>
    </div>
  </div>

  <!-- KPI -->
  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Risultato ${mode === 'monthly' ? 'Mese' : 'Cumulativo'}</div>
      <div class="kpi-value" style="color:${plC(kpis.totalPl)}">${fmtM(kpis.totalPl)}</div>
      <div class="kpi-sub">${kpis.totalTrades} operazioni</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Win Rate</div>
      <div class="kpi-value">${fmtR(kpis.winRate, 1)}%</div>
      <div class="kpi-sub">${kpis.tradingDays} giorni di trading</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Max Drawdown</div>
      <div class="kpi-value" style="color:#dc2626">${fmtR(kpis.maxDdPct, 1)}%</div>
      <div class="kpi-sub">${fmtM(kpis.maxDd)} assoluto</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Profit Factor</div>
      <div class="kpi-value" style="color:${kpis.profitFactor >= 1 ? '#16a34a' : '#dc2626'}">${fmtR(kpis.profitFactor)}</div>
    </div>
    ${extraKpis}
  </div>

  <!-- Approcci Operativi -->
  <h2>Approcci Operativi</h2>
  <div class="cards-grid">${styleCards}</div>

  ${trendSection}

  <!-- Analisi per Sottostante -->
  <h2>Analisi per Sottostante</h2>
  <div class="cards-grid">${assetCards}</div>

  <!-- Equity Curve -->
  ${equitySvg ? `
  <h2>Equity Curve</h2>
  ${equitySvg}` : ''}

  <!-- Summary -->
  <h2>Sintesi</h2>
  <div class="summary-box">${summaryHtml}</div>

  <!-- Footer -->
  <div class="footer">
    <div>Generato il ${dateNow} — Velqor Intelligent Quant System</div>
    <div style="margin-top:4px">I risultati derivano da operativita' reale su conti live. Le performance passate non costituiscono garanzia di risultati futuri.</div>
  </div>

</div>
</body>
</html>`

    const pw = window.open('', '_blank')
    if (pw) {
      pw.document.write(html)
      pw.document.close()
    }
  }

  // ============================================
  // Render
  // ============================================

  const acc = accounts.find(a => a.id === selectedAccountId)
  const monthLabel = monthOptions.find(o => o.value === selectedMonth)?.label || selectedMonth

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <QuantNav />

      {/* Title + Controls */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Analisi {mode === 'monthly' ? 'Mensile' : 'Generale'}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {mode === 'monthly'
              ? `Performance e Best Portfolio — ${monthLabel}`
              : `Report cumulativo dall'inizio a ${monthLabel}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Mode toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              onClick={() => setMode('monthly')}
              className={`px-3 py-1.5 text-sm font-medium transition ${mode === 'monthly' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >Mensile</button>
            <button
              onClick={() => setMode('general')}
              className={`px-3 py-1.5 text-sm font-medium transition ${mode === 'general' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >Generale</button>
          </div>
          {/* Account selector */}
          <select
            value={selectedAccountId}
            onChange={e => setSelectedAccountId(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {/* Month selector */}
          {mode === 'monthly' && (
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
            >
              {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {/* Report buttons */}
          <button
            onClick={openReport}
            disabled={loading || enrichedStats.length === 0}
            className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Report Interno
          </button>
          <button
            onClick={openPublicReport}
            disabled={loading || enrichedStats.length === 0}
            className="bg-slate-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Report Pubblico
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-slate-400">Caricamento dati...</div>
      ) : (
        <>
          {/* KPI Grid */}
          <div className={`grid ${mode === 'general' ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 md:grid-cols-4'} gap-3 mb-6`}>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide">P/L {mode === 'monthly' ? 'Mese' : 'Totale'}</div>
              <div className={`text-2xl font-bold font-mono mt-1 ${kpis.totalPl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUsd(kpis.totalPl)}</div>
              <div className="text-xs text-slate-400 mt-1">{kpis.tradingDays} giorni</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide">Trade / WR</div>
              <div className="text-2xl font-bold font-mono mt-1">{kpis.totalTrades}</div>
              <div className="text-xs text-slate-400 mt-1">Win Rate {fmt(kpis.winRate, 1)}%</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide">Max DD</div>
              <div className="text-2xl font-bold font-mono mt-1 text-red-600">{fmtUsd(kpis.maxDd)}</div>
              <div className="text-xs text-slate-400 mt-1">{fmt(kpis.maxDdPct, 1)}%</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide">Profit Factor</div>
              <div className={`text-2xl font-bold font-mono mt-1 ${kpis.profitFactor >= 1 ? 'text-green-600' : 'text-red-600'}`}>{fmt(kpis.profitFactor)}</div>
              {kpis.bestDay && <div className="text-xs text-slate-400 mt-1">Best: {fmtUsd(kpis.bestDay.pl)}</div>}
            </div>
            {mode === 'general' && (
              <>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-400 uppercase tracking-wide">CAGR</div>
                  <div className={`text-2xl font-bold font-mono mt-1 ${(kpis.cagr || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(kpis.cagr || 0, 1)}%</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs text-slate-400 uppercase tracking-wide">Sharpe</div>
                  <div className={`text-2xl font-bold font-mono mt-1 ${(kpis.sharpe || 0) >= 0.5 ? 'text-green-600' : 'text-amber-600'}`}>{fmt(kpis.sharpe || 0)}</div>
                </div>
              </>
            )}
          </div>

          {/* Prev month comparison */}
          {prevKpis && mode === 'monthly' && (
            <div className="text-sm text-slate-500 mb-4">
              vs mese precedente:{' '}
              <span className={`font-semibold ${kpis.totalPl - prevKpis.totalPl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {kpis.totalPl - prevKpis.totalPl >= 0 ? '+' : ''}{fmtUsd(kpis.totalPl - prevKpis.totalPl)}
              </span>
              {' '}({prevKpis.totalTrades} trade, WR {fmt(prevKpis.winRate, 1)}%)
            </div>
          )}

          {/* Best Portfolio */}
          {bestPortfolio.selected.length > 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
              <div className="text-green-700 font-bold text-sm mb-2">BEST PORTFOLIO — {bestPortfolio.selected.length} Strategie</div>
              <div className="flex flex-wrap gap-4 text-sm mb-3">
                <div>P/L: <span className={`font-bold ${bestPortfolio.totalPl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUsd(bestPortfolio.totalPl)}</span></div>
                <div>WR medio: <span className="font-bold">{fmt(bestPortfolio.avgWinRate, 1)}%</span></div>
                <div>PF medio: <span className="font-bold">{fmt(bestPortfolio.avgProfitFactor)}</span></div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {bestPortfolio.selected.map(s => (
                  <span key={s.strategyId} className="inline-block bg-green-100 text-green-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                    M{s.magic} {s.name} ({fmtUsd(s.monthlyPl)})
                  </span>
                ))}
              </div>
              <div className="text-xs text-slate-500">Criteri: {bestPortfolio.selectionCriteria}</div>
            </div>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-800">
              Nessuna strategia soddisfa i criteri del Best Portfolio {mode === 'monthly' ? 'questo mese' : 'nel periodo'}.
            </div>
          )}

          {/* Monthly Trend (general mode) */}
          {mode === 'general' && monthlyTrend.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-3">Trend Mensile</h2>
              <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4" style={{ height: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyTrend} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}`} />
                    <Tooltip formatter={(v) => [`$${Number(v).toLocaleString('it-IT')}`, 'P/L']} />
                    <Bar dataKey="pl" radius={[4, 4, 0, 0]}>
                      {monthlyTrend.map((entry, i) => (
                        <Cell key={i} fill={entry.pl >= 0 ? '#16a34a' : '#dc2626'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Trend table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-200">
                      <th className="text-left py-2 px-3 text-xs text-slate-400 uppercase">Mese</th>
                      <th className="text-right py-2 px-3 text-xs text-slate-400 uppercase">P/L</th>
                      <th className="text-center py-2 px-3 text-xs text-slate-400 uppercase">Trade</th>
                      <th className="text-right py-2 px-3 text-xs text-slate-400 uppercase">WR</th>
                      <th className="text-right py-2 px-3 text-xs text-slate-400 uppercase">PF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyTrend.map(m => (
                      <tr key={m.month} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 px-3 font-medium">{m.monthLabel}</td>
                        <td className={`py-2 px-3 text-right font-mono font-bold ${m.pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUsd(m.pl)}</td>
                        <td className="py-2 px-3 text-center">{m.trades}</td>
                        <td className="py-2 px-3 text-right">{fmt(m.winRate, 1)}%</td>
                        <td className="py-2 px-3 text-right">{m.profitFactor < 900 ? fmt(m.profitFactor) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {trendCommentary && (
                <div className="mt-3 text-sm text-slate-600 bg-slate-50 rounded-lg p-3 leading-relaxed">{trendCommentary}</div>
              )}
            </div>
          )}

          {/* Strategy Ranking */}
          <h2 className="text-lg font-semibold text-slate-800 mb-3">Ranking Strategie</h2>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left py-2 px-2 text-xs text-slate-400 uppercase">Magic</th>
                  <th className="text-left py-2 px-2 text-xs text-slate-400 uppercase">Nome</th>
                  <th className="text-left py-2 px-2 text-xs text-slate-400 uppercase">Asset</th>
                  <th className="text-right py-2 px-2 text-xs text-slate-400 uppercase">P/L</th>
                  <th className="text-center py-2 px-2 text-xs text-slate-400 uppercase">Trade</th>
                  <th className="text-right py-2 px-2 text-xs text-slate-400 uppercase">WR</th>
                  <th className="text-right py-2 px-2 text-xs text-slate-400 uppercase">PF</th>
                  <th className="text-center py-2 px-2 text-xs text-slate-400 uppercase">Health</th>
                  <th className="text-left py-2 px-2 text-xs text-slate-400 uppercase">Commento</th>
                </tr>
              </thead>
              <tbody>
                {enrichedStats.filter(s => s.monthlyTrades > 0).map(s => (
                  <tr
                    key={s.strategyId}
                    className={`border-b border-slate-100 hover:bg-slate-50 ${s.inBestPortfolio ? 'border-l-[3px] border-l-green-500 bg-green-50/30' : ''}`}
                  >
                    <td className="py-2 px-2 font-bold text-slate-700">M{s.magic}</td>
                    <td className="py-2 px-2">{s.name}</td>
                    <td className="py-2 px-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded ${groupColor(s.asset)}`}>{s.asset}</span>
                    </td>
                    <td className={`py-2 px-2 text-right font-mono font-bold ${s.monthlyPl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {fmtUsd(s.monthlyPl)}
                    </td>
                    <td className="py-2 px-2 text-center">{s.monthlyTrades}</td>
                    <td className="py-2 px-2 text-right">{s.monthlyTrades > 0 ? `${fmt(s.monthlyWinRate, 1)}%` : '—'}</td>
                    <td className="py-2 px-2 text-right">{s.monthlyTrades > 0 && s.monthlyProfitFactor < 900 ? fmt(s.monthlyProfitFactor) : '—'}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                        s.healthStatus === 'healthy' ? 'bg-green-500' :
                        s.healthStatus === 'warning' ? 'bg-amber-500' :
                        s.healthStatus === 'critical' ? 'bg-red-500' :
                        s.healthStatus === 'regime_mismatch' ? 'bg-purple-500' :
                        'bg-slate-300'
                      }`} title={s.healthStatus} />
                    </td>
                    <td className="py-2 px-2 text-xs text-slate-500 max-w-xs">{s.commentary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Asset Analysis */}
          <h2 className="text-lg font-semibold text-slate-800 mb-3">Analisi per Asset</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            {assetSummaries.map(a => (
              <div
                key={a.asset}
                className={`bg-white rounded-xl border p-4 ${a.totalPl >= 0 ? 'border-l-[3px] border-l-green-500' : 'border-l-[3px] border-l-red-500'} border-slate-200`}
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-slate-800">{a.assetLabel}</span>
                  <span className={`font-bold font-mono ${a.totalPl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUsd(a.totalPl)}</span>
                </div>
                <div className="text-xs text-slate-500 mb-2">{a.totalTrades} trade — Regime: {a.regimeDetail}</div>
                <div className="text-sm text-slate-600">{a.commentary}</div>
              </div>
            ))}
          </div>

          {/* Equity Curve */}
          {equityChartData.length > 1 && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-3">Equity Curve</h2>
              <div className="bg-white rounded-xl border border-slate-200 p-4" style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityChartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="ts" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v.toLocaleString()}`} domain={['auto', 'auto']} />
                    <Tooltip formatter={(v) => [`$${Number(v).toLocaleString('it-IT', { minimumFractionDigits: 2 })}`, 'Equity']} />
                    <Area type="monotone" dataKey="equity" stroke="#6366f1" fill="#6366f120" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Summary / Analysis */}
          {mode === 'general' && generalAnalysis.length > 0 ? (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
              <h3 className="text-sm font-semibold text-slate-800 mb-3 uppercase tracking-wide">Analisi Generale</h3>
              {generalAnalysis.map((p, i) => (
                <p key={i} className="text-sm text-slate-700 leading-relaxed mb-2 last:mb-0">{p}</p>
              ))}
            </div>
          ) : (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
              <div className="text-sm text-slate-700 leading-relaxed">{summaryText}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
