'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelStrategy, QelAccount } from '@/types/database'
import {
  fmt, fmtUsd, fmtPct, timeAgo, statusBadge, groupColor, plColor, ddBarColor, fmtAlpha, alphaColor,
  buildStrategyVsBenchmark, detectMarketRegimes, calcPerRegimeStats,
  detectMarketRegimes4Q, calcPerRegimeStats4Q, analyzeRegimeCoherence,
  BenchmarkPoint, RegimeZone, RegimeStats, RegimeZone4Q, RegimeStats4Q, RegimeCoherenceResult,
  REGIME_4Q_LABELS, REGIME_4Q_COLORS, REGIME_4Q_BG,
  ASSET_BENCHMARK_LABEL,
} from '@/lib/quant-utils'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts'
import AccountDashboard from './account-dashboard'
import InfoTooltip from '@/components/ui/InfoTooltip'
import { VELQOR_LOGO_BASE64 } from '@/lib/velqor-logo'

type Tab = 'overview' | 'strategies' | 'accounts'
type StrategyView = 'list' | 'detail'

export default function QuantPage() {
  const [strategies, setStrategies] = useState<QelStrategy[]>([])
  const [baseStrategies, setBaseStrategies] = useState<QelStrategy[]>([])
  const [accounts, setAccounts] = useState<QelAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')
  const [stratView, setStratView] = useState<StrategyView>('list')
  const [selectedStrat, setSelectedStrat] = useState<QelStrategy | null>(null)
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [expandedAcc, setExpandedAcc] = useState<string | null>(null)
  const [selectedAcc, setSelectedAcc] = useState<QelAccount | null>(null)
  const [benchLoading, setBenchLoading] = useState(false)
  const [benchResult, setBenchResult] = useState<string | null>(null)
  const [stratBenchData, setStratBenchData] = useState<BenchmarkPoint[]>([])
  const [stratRegimes, setStratRegimes] = useState<RegimeZone[]>([])
  const [stratRegimeStats, setStratRegimeStats] = useState<RegimeStats[]>([])
  const [stratRegimes4Q, setStratRegimes4Q] = useState<RegimeZone4Q[]>([])
  const [stratRegimeStats4Q, setStratRegimeStats4Q] = useState<RegimeStats4Q[]>([])
  const [regimeCoherence, setRegimeCoherence] = useState<RegimeCoherenceResult | null>(null)
  const [chartLoading, setChartLoading] = useState(false)

  useEffect(() => { loadInitial() }, [])
  useEffect(() => { if (selectedAccountId) loadAccountPerf() }, [selectedAccountId])
  useEffect(() => { if (selectedStrat && selectedAccountId) loadStratBenchmark(selectedStrat) }, [selectedStrat, selectedAccountId])

  // Sync selectedStrat when strategies updates (e.g. after account switch)
  // Without this, selectedStrat keeps stale real_* from the previous account
  useEffect(() => {
    if (!selectedStrat) return
    const updated = strategies.find(s => s.id === selectedStrat.id)
    if (!updated) return
    // Only sync if real data actually changed — prevents infinite loop
    if (updated.real_trades !== selectedStrat.real_trades ||
        Number(updated.real_pl) !== Number(selectedStrat.real_pl) ||
        Number(updated.real_max_dd) !== Number(selectedStrat.real_max_dd)) {
      setSelectedStrat(updated)
    }
  }, [strategies])

  async function loadInitial() {
    const supabase = createClient()
    const [stratRes, accRes] = await Promise.all([
      supabase.from('qel_strategies').select('*').order('magic'),
      supabase.from('qel_accounts').select('*').order('name'),
    ])
    setBaseStrategies(stratRes.data || [])
    setStrategies(stratRes.data || [])
    setAccounts(accRes.data || [])
    if (accRes.data && accRes.data.length > 0) {
      setSelectedAccountId(accRes.data[0].id)
    }
    setLoading(false)
  }

  /** Load per-account performance and OVERRIDE real_* fields */
  async function loadAccountPerf() {
    const supabase = createClient()
    const { data: perfData } = await supabase
      .from('v_strategy_recent_performance')
      .select('*')
      .eq('account_id', selectedAccountId)

    const perfMap = new Map(perfData?.map(p => [p.strategy_id, p]) || [])

    // Merge per-account data into strategies, replacing aggregated real_* fields
    setStrategies(baseStrategies.map(s => {
      const p = perfMap.get(s.id)
      if (!p) {
        // No trades on this account → zero out all real metrics
        return { ...s, real_trades: 0, real_pl: 0, real_win_pct: null, real_payoff: null, real_expectancy: null, real_max_dd: 0, real_profit_factor: null, real_recovery_factor: null, real_ret_dd: 0, real_avg_duration_hours: null }
      }
      const retDd = p.max_dd > 0 ? Number(p.total_pnl) / p.max_dd : 0
      return {
        ...s,
        real_trades: p.total_trades,
        real_pl: Number(p.total_pnl),
        real_win_pct: Number(p.win_pct),
        real_payoff: Number(p.payoff),
        real_expectancy: Number(p.avg_trade),
        real_max_dd: Number(p.max_dd),
        real_profit_factor: Number(p.profit_factor),
        real_recovery_factor: Number(p.recovery_factor),
        real_ret_dd: retDd,
        real_avg_duration_hours: Number(p.avg_duration_hours),
      }
    }))
  }

  async function loadData() {
    await loadInitial()
  }

  /** Load strategy trades + benchmark data for the dual chart */
  async function loadStratBenchmark(strat: QelStrategy) {
    setChartLoading(true)
    setStratBenchData([])
    setStratRegimes([])
    setStratRegimeStats([])
    setStratRegimes4Q([])
    setStratRegimeStats4Q([])
    setRegimeCoherence(null)

    const supabase = createClient()
    const acc = accounts.find(a => a.id === selectedAccountId)
    const accSize = Number(acc?.account_size || 10000)

    // Load trades for this strategy on this account
    const { data: trades } = await supabase
      .from('qel_trades')
      .select('net_profit, close_time')
      .eq('account_id', selectedAccountId)
      .eq('strategy_id', strat.id)
      .eq('is_open', false)
      .not('close_time', 'is', null)
      .order('close_time')

    if (!trades || trades.length === 0) { setChartLoading(false); return }

    const firstDate = trades[0].close_time.slice(0, 10)
    const lastDate = trades[trades.length - 1].close_time.slice(0, 10)

    // Load benchmark data with OHLC for this asset (extra history for SMA200 + ATR)
    const extraStart = new Date(firstDate)
    extraStart.setDate(extraStart.getDate() - 250) // 250 days before for SMA200

    const { data: benchFull } = await supabase
      .from('qel_benchmarks')
      .select('ts, close_price, high, low')
      .eq('symbol', strat.asset)
      .gte('ts', extraStart.toISOString().slice(0, 10))
      .lte('ts', lastDate)
      .order('ts')

    if (!benchFull || benchFull.length === 0) { setChartLoading(false); return }

    const tradePnls = trades.map(t => ({ net_profit: Number(t.net_profit), close_time: t.close_time }))

    // Legacy 3-regime detection (for backward compat with chart)
    const regimes = detectMarketRegimes(benchFull)
    setStratRegimes(regimes)

    // 4-Quadrant regime detection (Direction + Volatility)
    const regimes4Q = detectMarketRegimes4Q(benchFull)
    setStratRegimes4Q(regimes4Q)

    // Build dual curve only for the trading period
    const benchTradingPeriod = benchFull.filter(b => b.ts >= firstDate)
    const dualCurve = buildStrategyVsBenchmark(tradePnls, benchTradingPeriod, accSize)
    setStratBenchData(dualCurve)

    // Legacy regime stats (kept for export)
    const regimeStats = calcPerRegimeStats(tradePnls, regimes)
    setStratRegimeStats(regimeStats)

    // 4Q regime stats
    const stats4Q = calcPerRegimeStats4Q(tradePnls, regimes4Q)
    setStratRegimeStats4Q(stats4Q)

    // Coherence analysis
    if (stats4Q.length > 0) {
      const coherence = analyzeRegimeCoherence(strat.strategy_style, stats4Q)
      setRegimeCoherence(coherence)
    }

    setChartLoading(false)
  }

  /** Export strategy detail as printable HTML report */
  function exportStrategy() {
    if (!selectedStrat) return
    const s = selectedStrat
    const acc = accounts.find(a => a.id === selectedAccountId)
    const accName = acc?.name || 'Conto'
    const dateNow = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })
    const fmtR = (n: number | null | undefined, d = 2) => n !== null && n !== undefined ? Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'
    const fmtM = (n: number) => { const p = n >= 0 ? '' : '-'; return `${p}$${Math.abs(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` }
    const plC = (n: number) => n > 0 ? '#16a34a' : n < 0 ? '#dc2626' : '#475569'

    // Style labels
    const styleLabels: Record<string, string> = {
      mean_reversion: 'Mean Reversion', trend_following: 'Trend Following',
      breakout: 'Breakout', seasonal: 'Seasonal', hybrid: 'Hybrid',
    }

    // Build SVG chart
    let chartSvg = ''
    if (stratBenchData.length > 1) {
      const w = 750, h = 240, pad = 45, padR = 20, padTop = 20
      const vals = stratBenchData.map(d => [d.stratReturn, d.benchReturn]).flat()
      const minV = Math.min(...vals) - 0.5
      const maxV = Math.max(...vals) + 0.5
      const scX = (i: number) => pad + (i / (stratBenchData.length - 1)) * (w - pad - padR)
      const scY = (v: number) => h - pad - ((v - minV) / (maxV - minV)) * (h - pad - padTop)

      // 4Q Regime zones
      const zoneRects = stratRegimes4Q
        .filter(z => z.startDate >= stratBenchData[0]?.date)
        .map(z => {
          const i1 = stratBenchData.findIndex(d => d.date >= z.startDate)
          const i2 = stratBenchData.findIndex(d => d.date > z.endDate)
          const x1 = i1 >= 0 ? scX(i1) : pad
          const x2 = i2 >= 0 ? scX(i2) : w - padR
          const fill = REGIME_4Q_COLORS[z.regime]
          return `<rect x="${x1}" y="${padTop}" width="${Math.max(0, x2 - x1)}" height="${h - pad - padTop}" fill="${fill}" opacity="0.07" rx="2" />`
        }).join('')

      // Grid lines + Y-axis labels
      const ySteps = 6
      const yGridLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
        const v = minV + (maxV - minV) * (i / ySteps)
        const y = scY(v)
        return `<line x1="${pad}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#f1f5f9" />
                <text x="${pad - 6}" y="${y}" font-size="9" fill="#94a3b8" text-anchor="end" dominant-baseline="middle">${v > 0 ? '+' : ''}${v.toFixed(1)}%</text>`
      }).join('')

      // Zero line
      const zeroY = scY(0)
      const zeroLine = `<line x1="${pad}" y1="${zeroY}" x2="${w - padR}" y2="${zeroY}" stroke="#cbd5e1" stroke-width="1" />`

      // Strategy line with area fill
      const stratPts = stratBenchData.map((d, i) => `${scX(i).toFixed(1)},${scY(d.stratReturn).toFixed(1)}`).join(' ')
      const stratAreaPts = `${scX(0).toFixed(1)},${scY(0).toFixed(1)} ${stratPts} ${scX(stratBenchData.length - 1).toFixed(1)},${scY(0).toFixed(1)}`
      // Benchmark line
      const benchPts = stratBenchData.map((d, i) => `${scX(i).toFixed(1)},${scY(d.benchReturn).toFixed(1)}`).join(' ')

      // X-axis labels
      const xInterval = Math.max(1, Math.floor(stratBenchData.length / 8))
      const xLabels = stratBenchData.filter((_, i) => i % xInterval === 0).map((d, idx) =>
        `<text x="${scX(idx * xInterval)}" y="${h - 8}" font-size="9" fill="#94a3b8" text-anchor="middle">${d.date.slice(2, 7).replace('-', '/')}</text>`
      ).join('')

      // Final values
      const lastStrat = stratBenchData[stratBenchData.length - 1]
      const finalLabels = `
        <text x="${w - padR + 4}" y="${scY(lastStrat.stratReturn)}" font-size="9" fill="#7c3aed" font-weight="600" dominant-baseline="middle">${lastStrat.stratReturn > 0 ? '+' : ''}${lastStrat.stratReturn.toFixed(1)}%</text>
        <text x="${w - padR + 4}" y="${scY(lastStrat.benchReturn)}" font-size="9" fill="#94a3b8" dominant-baseline="middle">${lastStrat.benchReturn > 0 ? '+' : ''}${lastStrat.benchReturn.toFixed(1)}%</text>`

      chartSvg = `
        <div style="background:#fafbfc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 12px 8px;margin:8px 0 14px">
          <svg viewBox="0 0 ${w} ${h}" style="width:100%">
            ${yGridLabels}
            ${zoneRects}
            ${zeroLine}
            ${xLabels}
            <polygon points="${stratAreaPts}" fill="#7c3aed" opacity="0.06" />
            <polyline points="${benchPts}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6 3" />
            <polyline points="${stratPts}" fill="none" stroke="#7c3aed" stroke-width="2.5" />
            ${finalLabels}
          </svg>
          <div style="display:flex;gap:14px;justify-content:center;font-size:9px;color:#64748b;margin-top:6px;padding-top:6px;border-top:1px solid #f1f5f9;flex-wrap:wrap">
            <span style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:2.5px;background:#7c3aed;border-radius:1px"></span>Strategia</span>
            <span style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:1.5px;background:#94a3b8;border-radius:1px;border-top:1px dashed #94a3b8"></span>Buy &amp; Hold</span>
            <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;background:#22c55e15;border:1px solid #22c55e40;border-radius:2px"></span>Bull Vol</span>
            <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;background:#0d948815;border:1px solid #0d948840;border-radius:2px"></span>Bull Quiet</span>
            <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;background:#ef444415;border:1px solid #ef444440;border-radius:2px"></span>Bear Vol</span>
            <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;background:#f9731615;border:1px solid #f9731640;border-radius:2px"></span>Bear Quiet</span>
          </div>
          <div style="text-align:center;font-size:8px;color:#cbd5e1;margin-top:4px">Direzione: SMA(34)/SMA(144) &middot; Volatilità: ATR(13)/ATR(55)</div>
        </div>`
    }

    // 4Q Regime table
    const regimeRows = stratRegimeStats4Q.map(rs => {
      const dotColor = REGIME_4Q_COLORS[rs.regime]
      return `
      <tr>
        <td><span style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;background:${dotColor}20;border:1.5px solid ${dotColor}60"></span>${rs.label}</td>
        <td class="r">${rs.trades}</td>
        <td class="r">${fmtR(rs.winRate, 1)}%</td>
        <td class="r" style="color:${plC(rs.avgTrade)}">${fmtM(rs.avgTrade)}</td>
        <td class="r bold" style="color:${plC(rs.totalPl)}">${fmtM(rs.totalPl)}</td>
      </tr>`
    }).join('')

    // Coherence section for export
    const coherenceHtml = regimeCoherence ? `
      <div style="margin-top:14px;padding:12px 16px;border-radius:10px;border:1px solid ${
        regimeCoherence.verdict === 'coherent' ? '#bbf7d0' : regimeCoherence.verdict === 'mixed' ? '#fde68a' : '#fecaca'
      };background:${
        regimeCoherence.verdict === 'coherent' ? '#f0fdf4' : regimeCoherence.verdict === 'mixed' ? '#fffbeb' : '#fef2f2'
      }">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:11px;font-weight:700;color:#334155">Analisi Coerenza Strategia–Regime</span>
          <span style="font-size:10px;font-weight:600;padding:2px 10px;border-radius:20px;background:${
            regimeCoherence.verdict === 'coherent' ? '#dcfce7' : regimeCoherence.verdict === 'mixed' ? '#fef3c7' : '#fee2e2'
          };color:${
            regimeCoherence.verdict === 'coherent' ? '#15803d' : regimeCoherence.verdict === 'mixed' ? '#b45309' : '#dc2626'
          }">${regimeCoherence.verdict === 'coherent' ? '✓ Coerente' : regimeCoherence.verdict === 'mixed' ? '~ Mista' : '✗ Incoerente'} ${regimeCoherence.score}/100</span>
        </div>
        ${regimeCoherence.insights.map(ins => `<div style="font-size:10px;color:#475569;margin-bottom:3px;line-height:1.5">${ins}</div>`).join('')}
      </div>` : ''

    // Test vs Real rows
    const tvr = [
      { label: 'Trades', test: s.test_trades, real: s.real_trades },
      { label: 'Win Rate', test: s.test_win_pct, real: s.real_win_pct, suffix: '%' },
      { label: 'Payoff', test: s.test_payoff, real: s.real_payoff },
      { label: 'Expectancy', test: s.test_expectancy, real: s.real_expectancy, prefix: '$' },
      { label: 'Max DD', test: s.test_max_dd, real: s.real_max_dd, prefix: '$' },
      { label: 'Profit Factor', test: null, real: s.real_profit_factor },
      { label: 'Recovery Factor', test: null, real: s.real_recovery_factor },
      { label: 'Return/DD', test: s.test_ret_dd, real: s.real_ret_dd, highlight: true },
    ]
    const tvrRows = tvr.map(r => {
      const t = r.test !== null && r.test !== undefined ? Number(r.test) : null
      const rv = r.real !== null && r.real !== undefined && Number(r.real) !== 0 ? Number(r.real) : null
      const delta = t !== null && rv !== null ? rv - t : null
      const pre = (r as { prefix?: string }).prefix || ''
      const suf = (r as { suffix?: string }).suffix || ''
      const hl = (r as { highlight?: boolean }).highlight
      return `
        <tr${hl ? ' class="hl"' : ''}>
          <td${hl ? ' class="bold"' : ''}>${r.label}</td>
          <td class="r dim">${t !== null ? `${pre}${fmtR(t)}${suf}` : '—'}</td>
          <td class="r bold">${rv !== null ? `${pre}${fmtR(rv)}${suf}` : '<span class="dim">—</span>'}</td>
          <td class="r" style="font-size:10px;color:${delta !== null ? plC(delta) : '#cbd5e1'}">${delta !== null ? `${delta >= 0 ? '+' : ''}${fmtR(delta)}${suf}` : '—'}</td>
        </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>VELQOR Quant — ${s.name}</title>
<style>
  @page { size: A4; margin: 14mm 16mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; color: #1e293b; background: #fff; max-width: 780px; margin: 0 auto; padding: 24px; font-size: 12px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h2 { font-size: 11px; font-weight: 700; color: #7c3aed; text-transform: uppercase; letter-spacing: 0.8px; margin: 22px 0 10px; padding-bottom: 5px; border-bottom: 2px solid #f1f5f9; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; padding: 8px 10px; color: #94a3b8; font-weight: 600; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e2e8f0; }
  td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; }
  .r { text-align: right; }
  .bold { font-weight: 700; }
  .dim { color: #94a3b8; }
  .hl { background: #f5f3ff; }
  .hl td { border-bottom-color: #ede9fe; }

  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 16px 20px; background: linear-gradient(135deg, #0f0a1a 0%, #1e1533 100%); border-radius: 12px; color: #fff; }
  .header-left { display: flex; align-items: center; gap: 14px; }
  .header-info h1 { font-size: 18px; font-weight: 800; letter-spacing: -0.3px; }
  .header-meta { font-size: 10px; color: #a5a0b8; margin-top: 3px; }
  .header-badge { display: inline-block; font-size: 9px; padding: 2px 8px; border-radius: 4px; background: rgba(124,58,237,0.25); color: #c4b5fd; font-weight: 600; margin-right: 6px; }
  .pl-box { text-align: right; padding: 10px 18px; border-radius: 10px; }

  .info-strip { display: flex; gap: 0; margin-bottom: 18px; border-radius: 10px; overflow: hidden; border: 1px solid #e2e8f0; }
  .info-cell { flex: 1; padding: 10px 14px; background: #fafbfc; border-right: 1px solid #e2e8f0; }
  .info-cell:last-child { border-right: none; }
  .info-label { font-size: 9px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
  .info-value { font-size: 14px; font-weight: 700; color: #1e293b; margin-top: 2px; }

  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0 16px; }
  .kpi { background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 8px; padding: 10px 8px; text-align: center; }
  .kpi-value { font-size: 15px; font-weight: 700; color: #1e293b; }
  .kpi-label { font-size: 8px; color: #94a3b8; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.3px; }
  .kpi-hl { background: #f5f3ff; border-color: #ede9fe; }
  .kpi-hl .kpi-value { color: #7c3aed; }

  .sizing-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0; }
  .sizing-cell { border-radius: 8px; padding: 12px 8px; text-align: center; }
  .sizing-value { font-size: 16px; font-weight: 800; }
  .sizing-label { font-size: 8px; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.3px; }

  .footer { margin-top: 24px; padding-top: 10px; border-top: 2px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
  .footer-logo { display: flex; align-items: center; gap: 8px; }

  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media print { body { padding: 0; } .header { -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>

  <!-- HEADER -->
  <div class="header">
    <div class="header-left">
      <img src="data:image/png;base64,${VELQOR_LOGO_BASE64}" style="height:40px;filter:brightness(1.1)" alt="Velqor" />
      <div class="header-info">
        <h1>${s.name || s.strategy_id}</h1>
        <div class="header-meta">
          <span class="header-badge">${styleLabels[s.strategy_style || ''] || s.strategy_style || ''}</span>
          Magic #${s.magic} &middot; ${s.asset} &middot; ${s.timeframe} &middot; ${accName}
        </div>
      </div>
    </div>
    ${s.real_trades > 0 ? `
    <div class="pl-box" style="background:${Number(s.real_pl) >= 0 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'}">
      <div style="font-size:24px;font-weight:800;color:${Number(s.real_pl) >= 0 ? '#4ade80' : '#f87171'};letter-spacing:-0.5px">${fmtM(Number(s.real_pl))}</div>
      <div style="font-size:10px;color:#a5a0b8;margin-top:2px">${s.real_trades} trade live</div>
    </div>` : ''}
  </div>

  ${s.logic_summary ? `
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:11px">
    <span style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Logica</span>
    <div style="margin-top:3px;color:#334155">${s.logic_summary}</div>
    ${s.parameters ? `<div style="color:#94a3b8;font-size:10px;margin-top:2px">Parametri: ${s.parameters}</div>` : ''}
  </div>` : ''}

  <!-- KEY METRICS STRIP -->
  <div class="info-strip">
    <div class="info-cell"><div class="info-label">Win Rate</div><div class="info-value">${fmtR(s.real_win_pct ?? s.test_win_pct, 1)}%</div></div>
    <div class="info-cell"><div class="info-label">Payoff</div><div class="info-value">${fmtR(s.real_payoff ?? s.test_payoff)}</div></div>
    <div class="info-cell"><div class="info-label">Profit Factor</div><div class="info-value">${fmtR(s.real_profit_factor)}</div></div>
    <div class="info-cell"><div class="info-label">Max DD</div><div class="info-value" style="color:${plC(-(s.real_max_dd || 0))}">${fmtM(Number(s.real_max_dd || s.test_max_dd || 0))}</div></div>
    <div class="info-cell"><div class="info-label">Ret/DD</div><div class="info-value" style="color:#7c3aed">${fmtR(s.real_ret_dd ?? s.test_ret_dd)}</div></div>
  </div>

  ${chartSvg ? `
  <h2>Strategia vs ${ASSET_BENCHMARK_LABEL[s.asset] || s.asset} (Buy &amp; Hold)</h2>
  ${chartSvg}` : ''}

  <!-- REGIME + TEST VS REAL side by side -->
  <div class="two-col">
    ${regimeRows ? `
    <div>
      <h2>Performance per Regime (4Q)</h2>
      <table>
        <thead><tr><th>Regime</th><th class="r">Trade</th><th class="r">Win Rate</th><th class="r">Avg</th><th class="r">P/L</th></tr></thead>
        <tbody>${regimeRows}</tbody>
      </table>
      <div style="font-size:8px;color:#cbd5e1;margin-top:4px">Dir: SMA(34)/SMA(144) &middot; Vol: ATR(13)/ATR(55)</div>
    </div>` : '<div></div>'}

    <div>
      <h2>Test vs Real</h2>
      <table>
        <thead><tr><th>Metrica</th><th class="r">Test</th><th class="r">Real</th><th class="r">Delta</th></tr></thead>
        <tbody>${tvrRows}</tbody>
      </table>
    </div>
  </div>

  ${coherenceHtml}

  <h2>Metriche Backtest (SQX)</h2>
  <div class="kpi-grid">
    ${[
      { label: 'Trades', value: s.test_trades },
      { label: 'Win Rate', value: `${fmtR(s.test_win_pct, 1)}%` },
      { label: 'Payoff', value: fmtR(s.test_payoff) },
      { label: 'Expectancy', value: `$${fmtR(s.test_expectancy)}` },
      { label: 'Max Consec Loss', value: s.test_max_consec_loss },
      { label: 'Worst Trade', value: `$${fmtR(s.test_worst_trade)}` },
      { label: 'Max DD', value: `$${fmtR(s.test_max_dd)}` },
      { label: 'MC 95% DD', value: `$${fmtR(s.test_mc95_dd)}` },
      { label: 'Return/DD', value: fmtR(s.test_ret_dd), hl: true },
      { label: 'Stability R\u00B2', value: fmtR(s.test_stability), hl: true },
      { label: 'Ulcer Index', value: `${fmtR(s.test_ulcer_index)}%` },
      { label: 'Exposure', value: `${fmtR(s.test_exposure_pct, 1)}%` },
    ].map(m => `
      <div class="kpi${(m as { hl?: boolean }).hl ? ' kpi-hl' : ''}">
        <div class="kpi-value">${m.value ?? '—'}</div>
        <div class="kpi-label">${m.label}</div>
      </div>`).join('')}
  </div>

  <h2>Sizing (per 10K equity)</h2>
  <div class="sizing-grid">
    <div class="sizing-cell" style="background:#f8fafc;border:1px solid #e2e8f0">
      <div class="sizing-value" style="color:#475569">${s.lot_static ?? '—'}</div>
      <div class="sizing-label" style="color:#94a3b8">Lot Test</div>
    </div>
    <div class="sizing-cell" style="background:#f0fdf4;border:1px solid #bbf7d0">
      <div class="sizing-value" style="color:#16a34a">${s.lot_neutral ?? '—'}</div>
      <div class="sizing-label" style="color:#4ade80">Neutrale</div>
    </div>
    <div class="sizing-cell" style="background:#fffbeb;border:1px solid #fde68a">
      <div class="sizing-value" style="color:#d97706">${s.lot_aggressive ?? '—'}</div>
      <div class="sizing-label" style="color:#fbbf24">Aggressivo</div>
    </div>
    <div class="sizing-cell" style="background:#eff6ff;border:1px solid #bfdbfe">
      <div class="sizing-value" style="color:#2563eb">${s.lot_conservative ?? '—'}</div>
      <div class="sizing-label" style="color:#60a5fa">Conservativo</div>
    </div>
  </div>

  ${s.real_avg_duration_hours ? `<div style="font-size:10px;color:#64748b;margin-top:8px">Durata media trade: <strong>${fmtR(s.real_avg_duration_hours, 1)} ore</strong></div>` : ''}
  ${s.notes ? `<div style="font-size:10px;color:#94a3b8;margin-top:4px">Note: ${s.notes}</div>` : ''}

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-logo">
      <img src="data:image/png;base64,${VELQOR_LOGO_BASE64}" style="height:18px;opacity:0.4" alt="" />
      <span style="font-size:9px;color:#cbd5e1;font-weight:600;letter-spacing:1px">VELQOR QUANT</span>
    </div>
    <div style="font-size:9px;color:#cbd5e1">${dateNow} &middot; Confidenziale</div>
  </div>
</body>
</html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
  }

  async function refreshBenchmarks() {
    setBenchLoading(true)
    setBenchResult(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`https://gotbfzdgasuvfskzeycm.supabase.co/functions/v1/fetch-benchmarks`, {
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json()
      if (json.success) {
        setBenchResult(`Benchmark aggiornati: ${json.benchmarks?.reduce((s: number, b: { rows: number }) => s + b.rows, 0)} prezzi, ${json.alpha?.length} strategie`)
        // Reload strategies without resetting account selector
        const supabase = createClient()
        const { data: strats } = await supabase.from('qel_strategies').select('*').order('magic')
        if (strats) {
          setBaseStrategies(strats)
          // Re-apply per-account data
          await loadAccountPerf()
        }
      } else {
        setBenchResult(`Errore: ${json.error}`)
      }
    } catch (err) {
      setBenchResult(`Errore: ${err instanceof Error ? err.message : 'rete'}`)
    }
    setBenchLoading(false)
  }

  if (loading) return <p className="text-slate-500 p-4">Caricamento...</p>

  const activeStrategies = strategies.filter(s => s.status === 'active')
  const syncedAccounts = accounts.filter(a => a.last_sync_at !== null)
  const configuredAccounts = accounts.filter(a => a.login && a.investor_password && a.server)
  const activeAccounts = accounts.filter(a => a.status === 'active' || a.status === 'funded' || a.status === 'challenge' || a.status === 'verification')
  const inactiveAccounts = accounts.filter(a => a.status === 'inactive')
  const groups = [...new Set(strategies.map(s => s.asset_group).filter(Boolean))] as string[]
  const filteredStrategies = groupFilter === 'all' ? strategies : strategies.filter(s => s.asset_group === groupFilter)

  // Real KPIs from synced data
  const totalEquity = syncedAccounts.reduce((s, a) => s + Number(a.equity || 0), 0)
  const totalBalance = syncedAccounts.reduce((s, a) => s + Number(a.balance || 0), 0)
  const totalSize = syncedAccounts.reduce((s, a) => s + Number(a.account_size || 0), 0)
  const totalPL = totalBalance - totalSize
  const totalPLpct = totalSize > 0 ? (totalPL / totalSize) * 100 : 0
  const totalFloating = syncedAccounts.reduce((s, a) => s + Number(a.floating_pl || 0), 0)
  const maxDD = syncedAccounts.length > 0 ? Math.max(...syncedAccounts.map(a => Number(a.max_total_dd_pct || 0))) : 0

  const tabs = [
    { key: 'overview' as const, label: 'Overview' },
    { key: 'strategies' as const, label: `Strategie (${strategies.length})` },
    { key: 'accounts' as const, label: `Conti (${accounts.length})` },
  ]

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-0">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Quant Engine</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Trading sistematico &middot; QuantEdgeLab &middot; {activeStrategies.length} strategie
          </p>
          <select
            className="mt-2 text-sm border border-violet-200 rounded-lg px-3 py-2 bg-violet-50 text-violet-700 font-medium w-full sm:w-auto"
            value={selectedAccountId}
            onChange={e => setSelectedAccountId(e.target.value)}
          >
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name} (${Number(a.account_size).toLocaleString()})</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/divisioni/quant/sizing"
            className="px-3 py-2 bg-indigo-600 text-white text-xs sm:text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
            Sizing
          </a>
          <a href="/divisioni/quant/health"
            className="px-3 py-2 bg-white border border-slate-200 text-slate-700 text-xs sm:text-sm font-medium rounded-lg hover:bg-slate-50 transition">
            Health
          </a>
          <a href="/divisioni/quant/scenarios"
            className="px-3 py-2 bg-white border border-slate-200 text-slate-700 text-xs sm:text-sm font-medium rounded-lg hover:bg-slate-50 transition">
            Scenari
          </a>
          <a href="/divisioni/quant/builder"
            className="px-3 py-2 bg-white border border-slate-200 text-slate-700 text-xs sm:text-sm font-medium rounded-lg hover:bg-slate-50 transition">
            Builder
          </a>
          <button onClick={refreshBenchmarks} disabled={benchLoading}
            className="px-3 py-2 bg-white border border-slate-200 text-slate-700 text-xs sm:text-sm font-medium rounded-lg hover:bg-slate-50 transition disabled:opacity-50">
            {benchLoading ? '...' : 'Benchmark'}
          </button>
        </div>
      </div>
      {benchResult && (
        <div className="mb-4 p-3 bg-violet-50 border border-violet-200 rounded-lg text-sm text-violet-700">
          {benchResult}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 rounded-lg p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setStratView('list'); setSelectedStrat(null) }}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== OVERVIEW ===== */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* KPI row 1: Money */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-2xl font-bold text-slate-900">{fmtUsd(totalEquity)}</p>
              <p className="text-sm text-slate-500">Equity totale</p>
              {totalFloating !== 0 && (
                <p className={`text-xs mt-1 ${plColor(totalFloating)}`}>Floating: {fmtUsd(totalFloating, 2)}</p>
              )}
            </div>
            <div className={`rounded-xl border p-4 ${totalPL >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <p className={`text-2xl font-bold ${plColor(totalPL)}`}>{fmtUsd(totalPL)}</p>
              <p className="text-sm text-slate-500">P&L totale</p>
              <p className={`text-xs mt-1 font-medium ${plColor(totalPLpct)}`}>{totalPLpct >= 0 ? '+' : ''}{fmt(totalPLpct, 1)}%</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className={`text-2xl font-bold ${maxDD > 4 ? 'text-red-600' : maxDD > 3 ? 'text-amber-600' : 'text-slate-900'}`}>{fmt(maxDD, 1)}%</p>
              <p className="text-sm text-slate-500">Max DD (storico)<InfoTooltip metricKey="max_dd" /></p>
              <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                <div className={`h-full rounded-full ${ddBarColor(maxDD)}`} style={{ width: `${Math.min(maxDD * 10, 100)}%` }} />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${syncedAccounts.length > 0 ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
                <p className="text-2xl font-bold text-slate-900">{syncedAccounts.length}/{activeAccounts.length}</p>
              </div>
              <p className="text-sm text-slate-500">Conti live</p>
              <p className="text-xs text-slate-400 mt-1">{configuredAccounts.length} configurati</p>
            </div>
          </div>

          {/* Conti FTMO live */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-semibold text-slate-700">Conti FTMO</h3>
              <a href="/divisioni/quant/conti" className="text-xs text-violet-600 hover:text-violet-800">Gestisci &rarr;</a>
            </div>
            <div className="space-y-3">
              {activeAccounts.map(acc => {
                const synced = !!acc.last_sync_at
                const isExpanded = expandedAcc === acc.id
                const bal = Number(acc.balance || 0)
                const eq = Number(acc.equity || 0)
                const size = Number(acc.account_size)
                const pl = bal - size
                const plPct = size > 0 ? (pl / size) * 100 : 0
                const floating = Number(acc.floating_pl || 0)
                const histMaxDDD = Number(acc.max_daily_dd_pct || 0)
                const histMaxTDD = Number(acc.max_total_dd_pct || 0)
                const limitDDD = Number(acc.max_daily_loss_pct || 5)
                const limitTDD = Number(acc.max_total_loss_pct || 10)
                const margin = Number(acc.margin_used || 0)

                // Bridge status
                const syncMinutes = acc.last_sync_at ? (Date.now() - new Date(acc.last_sync_at).getTime()) / 60000 : Infinity
                const bridgeOnline = syncMinutes < 10
                const bridgeWarning = syncMinutes >= 10 && syncMinutes < 60
                const bridgeColor = bridgeOnline ? 'bg-green-500' : bridgeWarning ? 'bg-amber-500' : synced ? 'bg-red-500' : 'bg-slate-300'
                const bridgeLabel = bridgeOnline ? 'Bridge online' : bridgeWarning ? `Sync ${Math.round(syncMinutes)}m fa` : synced ? `Offline ${Math.round(syncMinutes / 60)}h` : 'Non configurato'

                return (
                  <div key={acc.id}
                    className={`rounded-xl border transition-all ${synced ? 'border-slate-200 hover:border-slate-300 cursor-pointer' : 'border-dashed border-slate-300 bg-slate-50'}`}
                    onClick={() => synced && setExpandedAcc(isExpanded ? null : acc.id)}>

                    {/* Header row — always visible */}
                    <div className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="relative shrink-0" title={bridgeLabel}>
                          <div className={`w-2.5 h-2.5 rounded-full ${bridgeColor}`} />
                          {bridgeOnline && <div className={`absolute inset-0 w-2.5 h-2.5 rounded-full ${bridgeColor} animate-ping opacity-50`} />}
                        </div>
                        <p className="text-sm font-semibold text-slate-900 truncate">{acc.name}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${statusBadge(acc.status)}`}>{acc.status}</span>
                        <span className={`text-[10px] shrink-0 ${bridgeOnline ? 'text-green-600' : bridgeWarning ? 'text-amber-600' : 'text-red-500'}`}>{bridgeLabel}</span>
                      </div>
                      {synced ? (
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-base font-bold text-slate-900">{fmtUsd(bal)}</p>
                            <p className={`text-xs font-medium ${plColor(pl)}`}>
                              {pl >= 0 ? '+' : ''}{fmtUsd(pl)} ({plPct >= 0 ? '+' : ''}{fmt(plPct, 1)}%)
                            </p>
                          </div>
                          <svg className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      ) : (
                        <a href="/divisioni/quant/conti" onClick={e => e.stopPropagation()}
                          className="text-xs text-violet-600 hover:text-violet-800 shrink-0">
                          Configura &rarr;
                        </a>
                      )}
                    </div>

                    {/* Expanded detail */}
                    {synced && isExpanded && (
                      <div className="px-3 pb-3 border-t border-slate-100 pt-3 space-y-3" onClick={e => e.stopPropagation()}>
                        {/* Balance / Equity / Floating / Margin */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div className="bg-slate-50 rounded-lg p-2.5">
                            <p className="text-sm font-bold text-slate-800">{fmtUsd(bal)}</p>
                            <p className="text-[10px] text-slate-500">Balance</p>
                          </div>
                          <div className="bg-slate-50 rounded-lg p-2.5">
                            <p className="text-sm font-bold text-slate-800">{fmtUsd(eq)}</p>
                            <p className="text-[10px] text-slate-500">Equity</p>
                          </div>
                          <div className={`rounded-lg p-2.5 ${floating >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                            <p className={`text-sm font-bold ${plColor(floating)}`}>{fmtUsd(floating, 2)}</p>
                            <p className="text-[10px] text-slate-500">Floating P/L</p>
                          </div>
                          <div className="bg-slate-50 rounded-lg p-2.5">
                            <p className="text-sm font-bold text-slate-800">{fmtUsd(margin, 2)}</p>
                            <p className="text-[10px] text-slate-500">Margine</p>
                          </div>
                        </div>

                        {/* P&L summary */}
                        <div className={`rounded-lg p-3 ${pl >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-xs text-slate-500">Profit/Loss dal capitale iniziale</p>
                              <p className="text-[10px] text-slate-400">Capitale: {fmtUsd(size)}</p>
                            </div>
                            <div className="text-right">
                              <p className={`text-lg font-bold ${plColor(pl)}`}>{pl >= 0 ? '+' : ''}{fmtUsd(pl)}</p>
                              <p className={`text-xs font-medium ${plColor(plPct)}`}>{plPct >= 0 ? '+' : ''}{fmt(plPct, 2)}%</p>
                            </div>
                          </div>
                        </div>

                        {/* DD Bars — Historical Max */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-slate-500 font-medium">Max Daily DD</span>
                              <span className={histMaxDDD > 4 ? 'text-red-600 font-bold' : 'text-slate-600'}>{fmt(histMaxDDD, 2)}% / {limitDDD}%</span>
                            </div>
                            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${ddBarColor(histMaxDDD)}`}
                                style={{ width: `${Math.min((histMaxDDD / limitDDD) * 100, 100)}%` }} />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">Limite FTMO: {limitDDD}%</p>
                          </div>
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-slate-500 font-medium">Max Total DD</span>
                              <span className={histMaxTDD > 8 ? 'text-red-600 font-bold' : 'text-slate-600'}>{fmt(histMaxTDD, 2)}% / {limitTDD}%</span>
                            </div>
                            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${ddBarColor(histMaxTDD)}`}
                                style={{ width: `${Math.min((histMaxTDD / limitTDD) * 100, 100)}%` }} />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">Limite FTMO: {limitTDD}%</p>
                          </div>
                        </div>

                        {/* Footer info */}
                        <div className="flex justify-between items-center text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                          <span>Server: {acc.server || '—'} &middot; Login: {acc.login || '—'}</span>
                          <span>Sync: {timeAgo(acc.last_sync_at)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {inactiveAccounts.length > 0 && (
              <p className="text-xs text-slate-400 mt-3">{inactiveAccounts.length} conti da inizializzare</p>
            )}
          </div>

          {/* Strategy Distribution */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Distribuzione per asset</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {groups.map(g => {
                const count = strategies.filter(s => s.asset_group === g).length
                const active = strategies.filter(s => s.asset_group === g && s.status === 'active').length
                return (
                  <div key={g} className={`rounded-lg p-3 ${groupColor(g)}`}>
                    <p className="text-lg font-bold">{active}/{count}</p>
                    <p className="text-xs font-medium">{g}</p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Strategy Ranking — Real Performance (validated) */}
          {(() => {
            const MIN_REAL_TRADES = 15
            const validated = strategies
              .filter(s => (s.real_trades || 0) >= MIN_REAL_TRADES && s.test_trades)
              .map(s => {
                const realRDD = Number(s.real_ret_dd || 0)
                const testRDD = Number(s.test_ret_dd || 0)
                const realWR = s.real_trades > 0 ? null : null // calc from trades if needed
                const testWR = Number(s.test_win_pct || 0)
                // Consistency: how close real is to test (1.0 = perfect, >1 = outperforming)
                const consistency = testRDD > 0 ? realRDD / testRDD : 0
                return { ...s, realRDD, testRDD, consistency }
              })
              .sort((a, b) => b.realRDD - a.realRDD)
            const earlyStage = strategies
              .filter(s => (s.real_trades || 0) > 0 && (s.real_trades || 0) < MIN_REAL_TRADES)
              .sort((a, b) => (b.real_trades || 0) - (a.real_trades || 0))

            return (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-700">Ranking Strategie — Performance Reale</h3>
                  <span className="text-[10px] text-slate-400">Min {MIN_REAL_TRADES} trade reali per validazione</span>
                </div>
                {validated.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-200">
                          <th className="text-left py-2 font-medium">#</th>
                          <th className="text-left py-2 font-medium">Strategia</th>
                          <th className="text-center py-2 font-medium">Stato</th>
                          <th className="text-right py-2 font-medium">Trade</th>
                          <th className="text-right py-2 font-medium">P/L Real</th>
                          <th className="text-right py-2 font-medium">R/DD Real<InfoTooltip metricKey="return_dd" /></th>
                          <th className="text-right py-2 font-medium">R/DD Test</th>
                          <th className="text-right py-2 font-medium">Alpha<InfoTooltip metricKey="alpha" /></th>
                          <th className="text-center py-2 font-medium">Consistenza</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {validated.map((s, i) => {
                          const consColor = s.consistency >= 1 ? 'text-green-700 bg-green-50' : s.consistency >= 0.5 ? 'text-amber-700 bg-amber-50' : s.consistency >= 0 ? 'text-orange-700 bg-orange-50' : 'text-red-700 bg-red-50'
                          const consLabel = s.consistency >= 1.5 ? 'Outperform' : s.consistency >= 0.8 ? 'Confermata' : s.consistency >= 0.3 ? 'Sotto test' : s.consistency >= 0 ? 'Debole' : 'Invertita'
                          return (
                            <tr key={s.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => { setTab('strategies'); setSelectedStrat(s); setStratView('detail') }}>
                              <td className="py-2 font-bold text-slate-400">{i + 1}</td>
                              <td className="py-2">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${groupColor(s.asset_group)}`}>{s.asset_group}</span>
                                  <span className="font-medium text-slate-900">{s.name}</span>
                                </div>
                              </td>
                              <td className="text-center py-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {s.status === 'active' ? 'ON' : 'OFF'}
                                </span>
                              </td>
                              <td className="text-right py-2 text-slate-700">{s.real_trades}<span className="text-slate-400">/{s.test_trades}</span></td>
                              <td className={`text-right py-2 font-medium ${plColor(Number(s.real_pl || 0))}`}>{fmtUsd(s.real_pl)}</td>
                              <td className={`text-right py-2 font-bold ${s.realRDD > 0 ? 'text-violet-700' : 'text-red-600'}`}>{fmt(s.realRDD, 2)}</td>
                              <td className="text-right py-2 text-slate-500">{fmt(s.testRDD, 2)}</td>
                              <td className={`text-right py-2 font-medium ${alphaColor(s.alpha_vs_benchmark)}`}>{fmtAlpha(s.alpha_vs_benchmark)}</td>
                              <td className="text-center py-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${consColor}`}>{consLabel}</span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Nessuna strategia con {MIN_REAL_TRADES}+ trade reali ancora</p>
                )}
                {earlyStage.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-[10px] text-slate-400 mb-2">In validazione (pochi trade reali)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {earlyStage.map(s => (
                        <span key={s.id} className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-slate-50 text-slate-500 border border-slate-200">
                          #{s.magic} {s.name} <span className="text-slate-400">{s.real_trades}t</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* ===== STRATEGIES LIST ===== */}
      {tab === 'strategies' && stratView === 'list' && (
        <div className="space-y-4">
          {/* Filter pills */}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setGroupFilter('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${groupFilter === 'all' ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              Tutti ({strategies.length})
            </button>
            {groups.map(g => (
              <button key={g} onClick={() => setGroupFilter(g)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${groupFilter === g ? 'bg-violet-600 text-white' : `${groupColor(g)} hover:opacity-80`}`}>
                {g} ({strategies.filter(s => s.asset_group === g).length})
              </button>
            ))}
          </div>

          {/* Strategy table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="hidden lg:grid lg:grid-cols-12 gap-2 px-4 py-2 bg-slate-50 text-xs font-medium text-slate-500">
              <span className="col-span-3">Strategia</span>
              <span className="text-center">Asset</span>
              <span className="text-center">TF</span>
              <span className="text-right">Trades</span>
              <span className="text-right">Win%</span>
              <span className="text-right">Ret/DD</span>
              <span className="text-right">Stab.</span>
              <span className="text-right">Real P&L</span>
              <span className="text-right">Real Trades</span>
              <span className="text-right">Real R/DD</span>
            </div>
            <div className="divide-y divide-slate-100">
              {filteredStrategies.map(s => {
                const hasReal = s.real_trades > 0
                return (
                  <button key={s.id} onClick={() => { setSelectedStrat(s); setStratView('detail') }}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors">
                    {/* Mobile */}
                    <div className="lg:hidden">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${statusBadge(s.status)}`}>{s.status}</span>
                            <span className="font-medium text-slate-900">{s.name || s.strategy_id}</span>
                          </div>
                          <div className="flex gap-2 mt-1">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${groupColor(s.asset_group)}`}>{s.asset_group}</span>
                            <span className="text-xs text-slate-400">{s.asset} {s.timeframe}</span>
                            {hasReal && <span className="text-xs text-green-600">{s.real_trades} live</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-violet-700">{fmt(s.test_ret_dd, 2)} R/DD</p>
                          {hasReal && <p className={`text-xs font-medium ${plColor(Number(s.real_pl))}`}>{fmtUsd(s.real_pl, 2)}</p>}
                        </div>
                      </div>
                    </div>
                    {/* Desktop */}
                    <div className="hidden lg:grid lg:grid-cols-12 gap-2 items-center">
                      <div className="col-span-3 flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${statusBadge(s.status)}`}>{s.status}</span>
                        <div>
                          <p className="text-sm font-medium text-slate-900">{s.name || s.strategy_id}</p>
                          <p className="text-xs text-slate-400">#{s.magic} &middot; {s.strategy_id}</p>
                        </div>
                      </div>
                      <span className={`text-xs text-center px-1.5 py-0.5 rounded ${groupColor(s.asset_group)}`}>{s.asset_group}</span>
                      <span className="text-xs text-center text-slate-600">{s.timeframe}</span>
                      <span className="text-sm text-right text-slate-700">{s.test_trades ?? '—'}</span>
                      <span className="text-sm text-right text-slate-700">{fmt(s.test_win_pct, 1)}%</span>
                      <span className="text-sm text-right font-bold text-violet-700">{fmt(s.test_ret_dd, 2)}</span>
                      <span className="text-sm text-right text-slate-700">{fmt(s.test_stability, 2)}</span>
                      <span className={`text-sm text-right font-medium ${hasReal ? plColor(Number(s.real_pl)) : 'text-slate-300'}`}>
                        {hasReal ? fmtUsd(s.real_pl, 0) : '—'}
                      </span>
                      <span className={`text-sm text-right ${hasReal ? 'text-slate-700' : 'text-slate-300'}`}>
                        {hasReal ? s.real_trades : '—'}
                      </span>
                      <span className={`text-sm text-right font-medium ${hasReal ? 'text-violet-700' : 'text-slate-300'}`}>
                        {hasReal ? fmt(s.real_ret_dd, 2) : '—'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== STRATEGY DETAIL ===== */}
      {tab === 'strategies' && stratView === 'detail' && selectedStrat && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button onClick={() => { setStratView('list'); setSelectedStrat(null) }}
              className="text-sm text-violet-600 hover:text-violet-800 flex items-center gap-1">
              &larr; Torna alla lista
            </button>
            <button onClick={exportStrategy}
              className="text-xs px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200 transition-colors flex items-center gap-1.5"
              title="Esporta scheda strategia">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              Esporta
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{selectedStrat.name || selectedStrat.strategy_id}</h2>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded ${statusBadge(selectedStrat.status)}`}>{selectedStrat.status}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${groupColor(selectedStrat.asset_group)}`}>{selectedStrat.asset_group}</span>
                  <span className="text-sm text-slate-500">Magic #{selectedStrat.magic} &middot; {selectedStrat.asset} &middot; {selectedStrat.timeframe}</span>
                </div>
              </div>
              {selectedStrat.real_trades > 0 && (
                <div className={`text-right px-4 py-2 rounded-lg ${Number(selectedStrat.real_pl) >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                  <p className={`text-xl font-bold ${plColor(Number(selectedStrat.real_pl))}`}>{fmtUsd(selectedStrat.real_pl, 2)}</p>
                  <p className="text-xs text-slate-500">{selectedStrat.real_trades} trade live</p>
                </div>
              )}
            </div>

            {/* Logic */}
            {selectedStrat.logic_summary && (
              <div className="bg-slate-50 rounded-lg p-3 mb-6">
                <p className="text-xs font-medium text-slate-500 mb-1">Logica</p>
                <p className="text-sm text-slate-800">{selectedStrat.logic_summary}</p>
                {selectedStrat.parameters && (
                  <p className="text-xs text-slate-500 mt-1">Parametri: {selectedStrat.parameters}</p>
                )}
              </div>
            )}

            {/* Benchmark Chart: Strategy vs Underlying */}
            {stratBenchData.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-slate-700 mb-2">
                  Strategia vs {ASSET_BENCHMARK_LABEL[selectedStrat.asset] || selectedStrat.asset} (Buy &amp; Hold)
                  <InfoTooltip metricKey="alpha" />
                </h3>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={stratBenchData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="alphaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94a3b8"
                        tickFormatter={v => v.slice(5)} interval={Math.max(1, Math.floor(stratBenchData.length / 8))} />
                      <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8"
                        tickFormatter={v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
                        domain={['auto', 'auto']} />
                      <Tooltip
                        contentStyle={{ fontSize: 11, borderRadius: 8 }}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        formatter={(v: any, name: any) => [
                          `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}%`,
                          name === 'stratReturn' ? 'Strategia' : name === 'benchReturn' ? 'Buy & Hold' : 'Alpha',
                        ]}
                      />
                      {/* 4-Quadrant regime background zones */}
                      {stratRegimes4Q.filter(z => z.startDate >= stratBenchData[0]?.date).map((z, i) => (
                        <ReferenceArea key={i} x1={z.startDate} x2={z.endDate}
                          fill={REGIME_4Q_COLORS[z.regime]}
                          fillOpacity={0.06} />
                      ))}
                      <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="benchReturn" stroke="#94a3b8" strokeWidth={1.5}
                        strokeDasharray="6 3" dot={false} name="benchReturn" />
                      <Line type="monotone" dataKey="stratReturn" stroke="#7c3aed" strokeWidth={2}
                        dot={false} name="stratReturn" />
                    </ComposedChart>
                  </ResponsiveContainer>

                  {/* Legend — 4 Quadrant Regime */}
                  <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-slate-500 justify-center">
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-violet-600 inline-block"></span> Strategia</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-400 inline-block border-dashed"></span> Buy &amp; Hold</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 inline-block rounded-sm" style={{ background: '#22c55e20', border: '1px solid #22c55e50' }}></span> Bull Vol</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 inline-block rounded-sm" style={{ background: '#0d948820', border: '1px solid #0d948850' }}></span> Bull Quiet</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 inline-block rounded-sm" style={{ background: '#ef444420', border: '1px solid #ef444450' }}></span> Bear Vol</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 inline-block rounded-sm" style={{ background: '#f9731620', border: '1px solid #f9731650' }}></span> Bear Quiet</span>
                  </div>
                  <div className="text-[9px] text-slate-400 text-center mt-1">
                    Direzione: SMA(34)/SMA(144) · Volatilità: ATR(13)/ATR(55) · Ispirato a StatOasis
                  </div>
                </div>

                {/* 4-Quadrant Regime Performance Table */}
                {stratRegimeStats4Q.length > 0 && (
                  <div className="mt-3 bg-white rounded-xl border border-slate-200 p-4">
                    <h4 className="text-xs font-semibold text-slate-600 mb-2">Performance per Regime di Mercato <span className="text-slate-400 font-normal">(4 Quadranti)</span></h4>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400 border-b border-slate-200">
                          <th className="text-left py-1.5">Regime</th>
                          <th className="text-right py-1.5">Trade</th>
                          <th className="text-right py-1.5">Win Rate</th>
                          <th className="text-right py-1.5">Media trade</th>
                          <th className="text-right py-1.5">P/L</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {stratRegimeStats4Q.map(rs => (
                          <tr key={rs.regime}>
                            <td className="py-1.5 font-medium">
                              <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style={{ background: REGIME_4Q_BG[rs.regime], border: `1.5px solid ${REGIME_4Q_COLORS[rs.regime]}60` }}></span>
                              {rs.label}
                            </td>
                            <td className="text-right py-1.5">{rs.trades}</td>
                            <td className="text-right py-1.5">{fmtPct(rs.winRate, 1)}</td>
                            <td className={`text-right py-1.5 ${plColor(rs.avgTrade)}`}>{fmtUsd(rs.avgTrade, 2)}</td>
                            <td className={`text-right py-1.5 font-medium ${plColor(rs.totalPl)}`}>{fmtUsd(rs.totalPl)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Regime Coherence Analysis */}
                {regimeCoherence && (
                  <div className={`mt-3 rounded-xl border p-4 ${
                    regimeCoherence.verdict === 'coherent' ? 'bg-green-50/50 border-green-200' :
                    regimeCoherence.verdict === 'mixed' ? 'bg-amber-50/50 border-amber-200' :
                    'bg-red-50/50 border-red-200'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold text-slate-600">
                        Analisi Coerenza Strategia–Regime
                      </h4>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        regimeCoherence.verdict === 'coherent' ? 'bg-green-100 text-green-700' :
                        regimeCoherence.verdict === 'mixed' ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {regimeCoherence.verdict === 'coherent' ? '✓ Coerente' :
                         regimeCoherence.verdict === 'mixed' ? '~ Mista' : '✗ Incoerente'}
                        {' '}{regimeCoherence.score}/100
                      </span>
                    </div>
                    <div className="space-y-1">
                      {regimeCoherence.insights.map((insight, i) => (
                        <p key={i} className="text-[11px] text-slate-600 leading-relaxed">{insight}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {chartLoading && <p className="text-xs text-violet-500 animate-pulse mb-4">Caricamento benchmark...</p>}

            {/* Test vs Real Comparison */}
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Test vs Real</h3>
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-200">
                    <th className="text-left py-2 font-medium">Metrica</th>
                    <th className="text-right py-2 font-medium">Test (SQX)</th>
                    <th className="text-right py-2 font-medium">Real (Live)</th>
                    <th className="text-right py-2 font-medium">Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {([
                    { label: 'Trades', test: selectedStrat.test_trades, real: selectedStrat.real_trades || null, suffix: '' },
                    { label: 'Win Rate', test: selectedStrat.test_win_pct, real: selectedStrat.real_win_pct, suffix: '%', tip: 'win_rate' },
                    { label: 'Payoff', test: selectedStrat.test_payoff, real: selectedStrat.real_payoff, suffix: '', tip: 'payoff' },
                    { label: 'Expectancy', test: selectedStrat.test_expectancy, real: selectedStrat.real_expectancy, suffix: '', prefix: '$', tip: 'expectancy' },
                    { label: 'Max DD', test: selectedStrat.test_max_dd, real: selectedStrat.real_max_dd || null, suffix: '', prefix: '$', tip: 'max_dd' },
                    { label: 'Profit Factor', test: null, real: selectedStrat.real_profit_factor, suffix: '', tip: 'profit_factor' },
                    { label: 'Recovery Factor', test: null, real: selectedStrat.real_recovery_factor, suffix: '', tip: 'recovery_factor' },
                    { label: 'Ret/DD', test: selectedStrat.test_ret_dd, real: selectedStrat.real_ret_dd || null, suffix: '', highlight: true, tip: 'return_dd' },
                  ] as { label: string; test: number | null; real: number | null; suffix: string; prefix?: string; highlight?: boolean; tip?: string }[]).map((row, i) => {
                    const testVal = row.test !== null && row.test !== undefined ? Number(row.test) : null
                    const realVal = row.real !== null && row.real !== undefined && Number(row.real) !== 0 ? Number(row.real) : null
                    const delta = testVal !== null && realVal !== null ? realVal - testVal : null
                    return (
                      <tr key={i} className={row.highlight ? 'bg-violet-50' : ''}>
                        <td className={`py-2 ${row.highlight ? 'font-semibold text-violet-700' : 'text-slate-700'}`}>
                          {row.label}{row.tip && <InfoTooltip metricKey={row.tip as import('@/lib/tooltip-content').TooltipKey} />}
                        </td>
                        <td className="text-right py-2 text-slate-600">
                          {testVal !== null ? `${row.prefix || ''}${fmt(testVal)}${row.suffix}` : '—'}
                        </td>
                        <td className={`text-right py-2 font-medium ${realVal !== null ? 'text-slate-900' : 'text-slate-300'}`}>
                          {realVal !== null ? `${row.prefix || ''}${fmt(realVal)}${row.suffix}` : '—'}
                        </td>
                        <td className={`text-right py-2 text-xs ${delta !== null ? plColor(delta) : 'text-slate-300'}`}>
                          {delta !== null ? `${delta >= 0 ? '+' : ''}${fmt(delta)}${row.suffix}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Test Metrics Full Grid */}
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Metriche Test dettagliate (SQX)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
              {[
                { label: 'Trades', value: selectedStrat.test_trades?.toString() || '—' },
                { label: 'Win Rate', value: `${fmt(selectedStrat.test_win_pct, 1)}%` },
                { label: 'Avg Win', value: `$${fmt(selectedStrat.test_avg_win)}` },
                { label: 'Avg Loss', value: `$${fmt(selectedStrat.test_avg_loss)}` },
                { label: 'Payoff', value: fmt(selectedStrat.test_payoff) },
                { label: 'Expectancy', value: `$${fmt(selectedStrat.test_expectancy)}` },
                { label: 'Max Consec Loss', value: selectedStrat.test_max_consec_loss?.toString() || '—' },
                { label: 'Worst Trade', value: `$${fmt(selectedStrat.test_worst_trade)}` },
                { label: 'Max Drawdown', value: `$${fmt(selectedStrat.test_max_dd)}` },
                { label: 'Return/DD', value: fmt(selectedStrat.test_ret_dd), highlight: true },
                { label: 'Ulcer Index', value: `${fmt(selectedStrat.test_ulcer_index)}%` },
                { label: 'MC 95% DD', value: `$${fmt(selectedStrat.test_mc95_dd)}` },
                { label: 'Stability (R\u00B2)', value: fmt(selectedStrat.test_stability), highlight: true },
                { label: 'Exposure %', value: `${fmt(selectedStrat.test_exposure_pct, 1)}%` },
              ].map((m, i) => (
                <div key={i} className={`rounded-lg p-3 ${m.highlight ? 'bg-violet-50 border border-violet-200' : 'bg-slate-50'}`}>
                  <p className={`text-lg font-bold ${m.highlight ? 'text-violet-700' : 'text-slate-800'}`}>{m.value}</p>
                  <p className="text-xs text-slate-500">{m.label}</p>
                </div>
              ))}
            </div>

            {/* Sizing */}
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Sizing (per 10K equity)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-lg font-bold text-slate-800">{selectedStrat.lot_static}</p>
                <p className="text-xs text-slate-500">Lot Test</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3">
                <p className="text-lg font-bold text-green-700">{selectedStrat.lot_neutral}</p>
                <p className="text-xs text-green-600">Neutrale</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-lg font-bold text-amber-700">{selectedStrat.lot_aggressive}</p>
                <p className="text-xs text-amber-600">Aggressivo</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-lg font-bold text-blue-700">{selectedStrat.lot_conservative}</p>
                <p className="text-xs text-blue-600">Conservativo</p>
              </div>
            </div>

            {selectedStrat.real_avg_duration_hours && (
              <div className="bg-slate-50 rounded-lg p-3 mb-6">
                <p className="text-sm text-slate-600">Durata media trade: <span className="font-bold">{fmt(selectedStrat.real_avg_duration_hours, 1)} ore</span></p>
              </div>
            )}

            {selectedStrat.notes && (
              <div className="border-t border-slate-200 pt-4">
                <p className="text-xs text-slate-400">Note: {selectedStrat.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== ACCOUNT DETAIL (MyFXBook-style) ===== */}
      {tab === 'accounts' && selectedAcc && (
        <AccountDashboard account={selectedAcc} onClose={() => setSelectedAcc(null)} />
      )}

      {/* ===== ACCOUNTS LIST ===== */}
      {tab === 'accounts' && !selectedAcc && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-slate-700">Conti attivi ({activeAccounts.length})</h3>
            <a href="/divisioni/quant/conti" className="text-xs text-violet-600 hover:text-violet-800 font-medium">
              Configura credenziali &rarr;
            </a>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {activeAccounts.map(acc => {
              const synced = !!acc.last_sync_at
              const bal = Number(acc.balance || 0)
              const eq = Number(acc.equity || 0)
              const size = Number(acc.account_size)
              const pl = bal - size
              const plPct = size > 0 ? (pl / size) * 100 : 0
              const floating = Number(acc.floating_pl || 0)
              const histMaxDDD = Number(acc.max_daily_dd_pct || 0)
              const histMaxTDD = Number(acc.max_total_dd_pct || 0)
              const limitDDD = Number(acc.max_daily_loss_pct || 5)
              const limitTDD = Number(acc.max_total_loss_pct || 10)

              const syncMin = acc.last_sync_at ? (Date.now() - new Date(acc.last_sync_at).getTime()) / 60000 : Infinity
              const bOnline = syncMin < 10
              const bWarn = syncMin >= 10 && syncMin < 60
              const bColor = bOnline ? 'bg-green-500' : bWarn ? 'bg-amber-500' : synced ? 'bg-red-500' : 'bg-slate-300'
              const bText = bOnline ? 'Online' : bWarn ? `${Math.round(syncMin)}m fa` : synced ? `Offline` : ''

              return (
                <div key={acc.id} onClick={() => synced && setSelectedAcc(acc)}
                  className={`bg-white rounded-xl border p-4 transition-all ${synced ? 'border-slate-200 hover:border-violet-300 hover:shadow-md cursor-pointer' : 'border-dashed border-slate-300'}`}>
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <div className="relative shrink-0">
                        <div className={`w-2.5 h-2.5 rounded-full ${bColor}`} />
                        {bOnline && <div className={`absolute inset-0 w-2.5 h-2.5 rounded-full ${bColor} animate-ping opacity-50`} />}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">{acc.name}</p>
                        <p className="text-xs text-slate-400">{acc.broker} &middot; {acc.currency} &middot; {fmtUsd(size)} &middot; <span className={bOnline ? 'text-green-600' : bWarn ? 'text-amber-600' : 'text-red-500'}>{bText}</span></p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded ${statusBadge(acc.status)}`}>{acc.status}</span>
                  </div>

                  {synced ? (
                    <>
                      {/* Balance / Equity / Floating */}
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="bg-slate-50 rounded-lg p-2">
                          <p className="text-sm font-bold text-slate-800">{fmtUsd(bal)}</p>
                          <p className="text-[10px] text-slate-500">Balance</p>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2">
                          <p className="text-sm font-bold text-slate-800">{fmtUsd(eq)}</p>
                          <p className="text-[10px] text-slate-500">Equity</p>
                        </div>
                        <div className={`rounded-lg p-2 ${floating >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                          <p className={`text-sm font-bold ${plColor(floating)}`}>{fmtUsd(floating, 2)}</p>
                          <p className="text-[10px] text-slate-500">Floating</p>
                        </div>
                      </div>

                      {/* P&L */}
                      <div className={`rounded-lg p-2 mb-3 ${pl >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-slate-500">Profit/Loss</span>
                          <span className={`text-sm font-bold ${plColor(pl)}`}>
                            {pl >= 0 ? '+' : ''}{fmtUsd(pl)} ({plPct >= 0 ? '+' : ''}{fmt(plPct, 1)}%)
                          </span>
                        </div>
                      </div>

                      {/* DD indicators — Historical Max */}
                      <div className="space-y-2">
                        <div>
                          <div className="flex justify-between text-[10px] mb-0.5">
                            <span className="text-slate-500">Max Daily DD</span>
                            <span className={histMaxDDD > 4 ? 'text-red-600 font-medium' : 'text-slate-600'}>{fmt(histMaxDDD, 1)}% / {limitDDD}%</span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${ddBarColor(histMaxDDD)}`}
                              style={{ width: `${Math.min((histMaxDDD / limitDDD) * 100, 100)}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-[10px] mb-0.5">
                            <span className="text-slate-500">Max Total DD</span>
                            <span className={histMaxTDD > 8 ? 'text-red-600 font-medium' : 'text-slate-600'}>{fmt(histMaxTDD, 1)}% / {limitTDD}%</span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${ddBarColor(histMaxTDD)}`}
                              style={{ width: `${Math.min((histMaxTDD / limitTDD) * 100, 100)}%` }} />
                          </div>
                        </div>
                      </div>

                      <p className="text-[10px] text-slate-400 mt-2">Sync: {timeAgo(acc.last_sync_at)}</p>
                    </>
                  ) : (
                    <a href="/divisioni/quant/conti" className="block bg-amber-50 rounded-lg p-3 hover:bg-amber-100 transition-colors">
                      <p className="text-xs text-amber-700 font-medium">Configura login e password investor MT5 per attivare il monitoraggio &rarr;</p>
                    </a>
                  )}
                </div>
              )
            })}
          </div>

          {inactiveAccounts.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-slate-700 mt-6">Da inizializzare ({inactiveAccounts.length})</h3>
              <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
                {inactiveAccounts.map(acc => (
                  <div key={acc.id} className="px-4 py-3 flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{acc.name}</p>
                      <p className="text-xs text-slate-400">{acc.broker} &middot; {fmtUsd(Number(acc.account_size))}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded ${statusBadge(acc.status)}`}>{acc.status}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
