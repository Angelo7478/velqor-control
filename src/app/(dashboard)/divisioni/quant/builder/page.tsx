'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelStrategy, QelAccount, QelPortfolio, QelPortfolioStrategy } from '@/types/database'
import {
  fmt, fmtUsd, fmtPct, plColor, groupColor, styleColor, styleLabel,
  CHART_COLORS, PORTFOLIO_COLOR,
  buildEquityCurves, TradeForCurve, StrategyEquityCurve, CombinedCurvePoint, PortfolioStats, CurveStats,
} from '@/lib/quant-utils'
import QuantNav from '../quant-nav'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Area, ComposedChart,
} from 'recharts'

// ============================================
// Types
// ============================================

interface StrategyRow extends QelStrategy {
  selected: boolean
  userLots: number
  chartColor: string
  visible: boolean // visible on chart
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
  const [showCombined, setShowCombined] = useState(true)
  const [chartMode, setChartMode] = useState<'portfolio' | 'individual'>('portfolio')
  const [selectedStratForDetail, setSelectedStratForDetail] = useState<string | null>(null)

  // Lot scaling
  const [lotMultiplier, setLotMultiplier] = useState(1)

  // PTF state
  const [savedPortfolios, setSavedPortfolios] = useState<SavedPortfolio[]>([])
  const [ptfName, setPtfName] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingPtf, setLoadingPtf] = useState(false)

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
    const supabase = createClient()

    // Load strategies
    const { data: strats } = await supabase
      .from('qel_strategies')
      .select('*')
      .in('status', ['active', 'paused'])
      .order('magic')

    // Load closed trades for selected account
    const { data: tradeData } = await supabase
      .from('qel_trades')
      .select('strategy_id, net_profit, lots, close_time, symbol')
      .eq('account_id', selectedAccountId)
      .eq('is_open', false)
      .not('strategy_id', 'is', null)
      .not('close_time', 'is', null)
      .order('close_time')

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

    // Aggregate per-strategy stats from trades
    const pnlMap = new Map<string, { total: number; count: number }>()
    if (tradeData) {
      for (const t of tradeData) {
        if (!t.strategy_id) continue
        if (!pnlMap.has(t.strategy_id)) pnlMap.set(t.strategy_id, { total: 0, count: 0 })
        const e = pnlMap.get(t.strategy_id)!
        e.total += Number(t.net_profit ?? 0)
        e.count++
      }
    }

    if (strats) {
      setStrategies(strats.map((s, i) => {
        const stats = pnlMap.get(s.id)
        return {
          ...s,
          selected: s.include_in_portfolio && s.status === 'active',
          userLots: s.lot_neutral ?? s.lot_static ?? 0.01,
          chartColor: CHART_COLORS[i % CHART_COLORS.length],
          visible: true,
          tradeCount: stats?.count ?? 0,
          realPnlOnAccount: stats?.total ?? 0,
        }
      }))
    }

    if (tradeData) {
      setTrades(tradeData.map(t => ({
        strategy_id: t.strategy_id!,
        net_profit: Number(t.net_profit ?? 0),
        lots: Number(t.lots),
        close_time: t.close_time!,
        symbol: t.symbol,
      })))
    }

    setLoading(false)
  }

  // ---- Equity curves (memoized) ----
  const curveData = useMemo(() => {
    const selected = strategies.filter(s => s.selected && s.tradeCount > 0)
    if (selected.length === 0 || trades.length === 0) return null

    const stratMap = new Map<string, { magic: number; name: string; userLots: number; color: string }>()
    for (const s of selected) {
      stratMap.set(s.id, { magic: s.magic, name: s.name || `M${s.magic}`, userLots: s.userLots, color: s.chartColor })
    }

    return buildEquityCurves(trades, stratMap, equityBase)
  }, [strategies, trades, equityBase])

  // ---- Handlers ----
  function toggleStrategy(id: string) {
    setStrategies(prev => prev.map(s => s.id === id ? { ...s, selected: !s.selected } : s))
  }

  function toggleVisibility(id: string) {
    setStrategies(prev => prev.map(s => s.id === id ? { ...s, visible: !s.visible } : s))
  }

  function setLots(id: string, lots: number) {
    setStrategies(prev => prev.map(s => s.id === id ? { ...s, userLots: Math.max(0.01, lots) } : s))
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
      ? { ...s, userLots: Math.max(0.01, Math.round(s.userLots * mult * 1000) / 1000) }
      : s
    ))
    setLotMultiplier(1)
  }

  function resetLotsToDefault() {
    setStrategies(prev => prev.map(s => ({
      ...s,
      userLots: s.lot_neutral ?? s.lot_static ?? 0.01,
    })))
    setLotMultiplier(1)
  }

  /** Auto-scale lots proportional to equity base vs source account */
  function autoScaleForEquity() {
    const sourceAcc = accounts.find(a => a.id === selectedAccountId)
    if (!sourceAcc || sourceAcc.account_size === 0) return
    const ratio = equityBase / sourceAcc.account_size
    if (Math.abs(ratio - 1) < 0.01) return // already 1:1
    applyMultiplier(ratio)
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

    // Select strategies and set lots from PTF
    setStrategies(prev => prev.map(s => {
      const ps = ptf.strategies.find(p => p.strategy_id === s.id)
      if (ps) {
        return { ...s, selected: true, userLots: ps.lot_override ?? ps.final_lots ?? s.userLots, visible: true }
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
  .logo { font-size: 10px; font-weight: 700; color: #6366f1; letter-spacing: 2px; }
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
      <div class="logo">VELQOR QUANT ENGINE</div>
      <h1>Portfolio Simulation Report</h1>
      <div class="subtitle">${ptfName || 'Simulazione'} — ${acc?.name || 'N/A'} — ${dateNow}</div>
    </div>
    <div class="meta">
      <div>Equity Base: <strong>${fmtM(equityBase)}</strong></div>
      <div>Strategie: <strong>${curveData.curves.length}</strong></div>
      <div>Trade analizzati: <strong>${ps.totalTrades}</strong></div>
      <div style="margin-top:4px"><button class="no-print" onclick="window.print()" style="padding:4px 12px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-size:11px">Stampa / PDF</button></div>
    </div>
  </div>

  <!-- KPI principali -->
  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">P/L Totale</div>
      <div class="kpi-value" style="color:${plC(ps.totalPnl)}">${fmtM(ps.totalPnl)}</div>
      <div class="kpi-sub">${fmtR(returnPct, 1)}% rendimento</div>
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

  <!-- Tabella strategie -->
  <h2>Composizione Portfolio</h2>
  <table>
    <thead>
      <tr>
        <th>Magic</th>
        <th>Strategia</th>
        <th>Asset</th>
        <th>Stile</th>
        <th class="text-center">Lotti</th>
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
        return `<tr>
          <td>M${c.magic}</td>
          <td style="font-family:sans-serif;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name}</td>
          <td>${st?.asset_group || st?.asset || ''}</td>
          <td><span class="badge ${styleBadge}">${styleLabel(st?.strategy_style ?? null)}</span></td>
          <td class="text-center bold">${fmtR(c.userLots, 3)}</td>
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
        <td class="text-center">${fmtR(curveData.curves.reduce((s, c) => s + c.userLots, 0), 3)}</td>
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

  <!-- Disclaimer -->
  <div class="footer">
    <p>VELQOR Quant Engine — Report generato il ${dateNow} alle ${new Date().toLocaleTimeString('it-IT')}</p>
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
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-400 block mb-1">Equity base ($)</label>
            <input type="number" value={equityBase} onChange={e => setEquityBase(Number(e.target.value))}
              className="w-28 text-sm border border-slate-200 rounded px-2 py-1.5" />
          </div>

          {/* Lot scaling */}
          <div>
            <label className="text-[10px] uppercase text-slate-400 block mb-1">Scala lotti</label>
            <div className="flex gap-1 items-center">
              {[2, 3, 5, 10].map(m => (
                <button key={m} onClick={() => applyMultiplier(m)}
                  className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-indigo-50 hover:border-indigo-300 transition font-mono">
                  {m}x
                </button>
              ))}
              <button onClick={() => applyMultiplier(0.5)}
                className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-amber-50 hover:border-amber-300 transition font-mono">
                /2
              </button>
              {(() => {
                const sourceAcc = accounts.find(a => a.id === selectedAccountId)
                const ratio = sourceAcc && sourceAcc.account_size > 0 ? equityBase / sourceAcc.account_size : 1
                return ratio > 1.5 || ratio < 0.7 ? (
                  <button onClick={autoScaleForEquity}
                    className="px-2.5 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium">
                    Auto {fmt(ratio, 0)}x
                  </button>
                ) : null
              })()}
              <button onClick={resetLotsToDefault}
                className="px-2 py-1.5 text-xs text-slate-400 hover:text-slate-600 transition" title="Reset ai lotti originali">
                Reset
              </button>
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
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-center">Lotti</th>
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-right">Trade</th>
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-right">P/L reale</th>
              <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-right">P/L scalato</th>
            </tr>
          </thead>
          <tbody>
            {strategies.filter(s => s.status === 'active').map(s => {
              const curve = curveData?.curves.find(c => c.strategyId === s.id)
              const scaledPnl = curve?.stats.totalPnl ?? null
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
                  <td className="px-2 py-1.5">
                    {s.selected ? (
                      <div className="flex items-center gap-1 justify-center">
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={s.userLots}
                          onChange={e => setLots(s.id, parseFloat(e.target.value) || 0.01)}
                          className="w-16 text-xs text-center border border-slate-200 rounded px-1 py-1 font-mono"
                          onClick={e => e.stopPropagation()}
                        />
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
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

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

function StatBox({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-slate-400">{label}</div>
      <div className={`text-sm font-bold font-mono ${color || 'text-slate-800'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  )
}
