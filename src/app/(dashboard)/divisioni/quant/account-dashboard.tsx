'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelAccount, QelAccountSnapshot, QelTrade, QelStrategy } from '@/types/database'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { fmt, fmtUsd, plColor, ddBarColor, MONTHS } from '@/lib/quant-utils'
import InfoTooltip from '@/components/ui/InfoTooltip'

interface Props {
  account: QelAccount
  /** Optional: all accounts in the same challenge lineage (sorted by created_at).
   *  When provided with length > 1, snapshots and trades are aggregated across
   *  the entire lineage so the challenge is shown as a single continuous entity. */
  lineageAccounts?: QelAccount[]
  onClose: () => void
}

export default function AccountDashboard({ account, lineageAccounts, onClose }: Props) {
  const isLineageView = (lineageAccounts?.length || 0) > 1
  const lineageIds = isLineageView ? lineageAccounts!.map(a => a.id) : [account.id]
  // Capitale iniziale di tutta la challenge = account_size del PRIMO conto della lineage (Step 1)
  const initialAccount = isLineageView ? lineageAccounts![0] : account
  // Lineage cumulative balance = balance del conto attivo corrente (ultimo)
  // PL aggregato = balance corrente - capitale iniziale Step 1
  const [snapshots, setSnapshots] = useState<QelAccountSnapshot[]>([])
  const [trades, setTrades] = useState<QelTrade[]>([])
  const [strategies, setStrategies] = useState<QelStrategy[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMagic, setSelectedMagic] = useState<number | null>(null)
  const [equityRange, setEquityRange] = useState<string>('ALL')
  const [sortCol, setSortCol] = useState<string>('close_time')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showAllTrades, setShowAllTrades] = useState(false)

  const bal = Number(account.balance || 0)
  const eq = Number(account.equity || 0)
  // In lineage view, "size" = capitale iniziale Step 1 → mostra rendimento totale dalla challenge
  const size = Number(initialAccount.account_size)
  // PL: in lineage = balance Step corrente - balance iniziale Step 1; in single = balance - account_size
  const pl = isLineageView ? bal - Number(initialAccount.account_size) : bal - size
  const plPct = size > 0 ? (pl / size) * 100 : 0
  const floating = Number(account.floating_pl || 0)
  const histMaxDDD = Number(account.max_daily_dd_pct || 0)
  const histMaxTDD = Number(account.max_total_dd_pct || 0)
  const limitDDD = Number(account.max_daily_loss_pct || 5)
  const limitTDD = Number(account.max_total_loss_pct || 10)

  useEffect(() => {
    loadAccountData()
  }, [account.id, lineageIds.join(',')])

  async function loadAccountData() {
    setLoadingData(true)
    setError(null)
    try {
      const supabase = createClient()
      const [snapRes, tradeRes, stratRes] = await Promise.all([
        supabase.from('qel_account_snapshots').select('*').in('account_id', lineageIds).order('ts', { ascending: true }),
        supabase.from('qel_trades').select('*').in('account_id', lineageIds).order('open_time', { ascending: false }),
        supabase.from('qel_strategies').select('*').order('magic'),
      ])
      if (snapRes.error) throw snapRes.error
      if (tradeRes.error) throw tradeRes.error
      if (stratRes.error) throw stratRes.error
      setSnapshots(snapRes.data || [])
      setTrades(tradeRes.data || [])
      setStrategies(stratRes.data || [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('loadAccountData failed:', err)
      setError(msg)
    } finally {
      setLoadingData(false)
    }
  }

  // Trade stats
  const closedTrades = trades.filter(t => !t.is_open && t.close_time)
  const openTrades = trades.filter(t => t.is_open)
  const winTrades = closedTrades.filter(t => Number(t.net_profit || t.profit || 0) > 0)
  const lossTrades = closedTrades.filter(t => Number(t.net_profit || t.profit || 0) < 0)
  const totalNetPL = closedTrades.reduce((s, t) => s + Number(t.net_profit || t.profit || 0), 0)
  const winRate = closedTrades.length > 0 ? (winTrades.length / closedTrades.length) * 100 : 0
  const avgWin = winTrades.length > 0 ? winTrades.reduce((s, t) => s + Number(t.net_profit || t.profit || 0), 0) / winTrades.length : 0
  const avgLoss = lossTrades.length > 0 ? Math.abs(lossTrades.reduce((s, t) => s + Number(t.net_profit || t.profit || 0), 0) / lossTrades.length) : 0
  const bestTrade = closedTrades.length > 0 ? Math.max(...closedTrades.map(t => Number(t.net_profit || t.profit || 0))) : 0
  const worstTrade = closedTrades.length > 0 ? Math.min(...closedTrades.map(t => Number(t.net_profit || t.profit || 0))) : 0
  const avgDuration = closedTrades.filter(t => t.duration_seconds).length > 0
    ? closedTrades.filter(t => t.duration_seconds).reduce((s, t) => s + Number(t.duration_seconds || 0), 0) / closedTrades.filter(t => t.duration_seconds).length / 3600
    : 0
  const profitFactor = avgLoss > 0 && winTrades.length > 0
    ? winTrades.reduce((s, t) => s + Number(t.net_profit || t.profit || 0), 0) / Math.abs(lossTrades.reduce((s, t) => s + Number(t.net_profit || t.profit || 0), 0))
    : 0
  const totalLots = closedTrades.reduce((s, t) => s + Number(t.lots || 0), 0)

  // Trade-based equity curve (from imported trades — always available)
  const tradeEquityCurve = (() => {
    const sorted = [...closedTrades].sort((a, b) =>
      (a.close_time || a.open_time || '').localeCompare(b.close_time || b.open_time || '')
    )
    let cumPL = 0
    const points: { date: Date; equity: number; pl: number }[] = []
    if (sorted.length > 0) {
      points.push({ date: new Date(sorted[0].open_time), equity: size, pl: 0 })
    }
    sorted.forEach(t => {
      cumPL += Number(t.net_profit || t.profit || 0)
      points.push({ date: new Date(t.close_time || t.open_time), equity: size + cumPL, pl: cumPL })
    })
    return points
  })()

  // Filter by time range
  const RANGES: Record<string, number> = { '1W': 7, '2W': 14, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 }
  const filteredEquity = (() => {
    let data = tradeEquityCurve
    if (equityRange !== 'ALL' && RANGES[equityRange]) {
      const cutoff = new Date(Date.now() - RANGES[equityRange] * 86400000)
      const before = data.filter(p => p.date < cutoff)
      const after = data.filter(p => p.date >= cutoff)
      // Add last point before cutoff as starting reference
      if (before.length > 0 && after.length > 0) {
        data = [{ ...before[before.length - 1], date: cutoff }, ...after]
      } else {
        data = after
      }
    }
    // Format for chart
    const isShort = equityRange === '1W' || equityRange === '2W'
    return data.map(p => ({
      ts: isShort
        ? p.date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : p.date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }),
      equity: p.equity,
      pl: p.pl,
    }))
  })()

  // Monthly returns
  const monthlyReturns: Record<string, Record<number, number>> = {}
  closedTrades.forEach(t => {
    if (!t.close_time) return
    const d = new Date(t.close_time)
    const year = d.getFullYear().toString()
    const month = d.getMonth()
    if (!monthlyReturns[year]) monthlyReturns[year] = {}
    monthlyReturns[year][month] = (monthlyReturns[year][month] || 0) + Number(t.net_profit || t.profit || 0)
  })
  const years = Object.keys(monthlyReturns).sort()

  // Symbols distribution
  const symbolStats: Record<string, { count: number; pl: number }> = {}
  closedTrades.forEach(t => {
    if (!symbolStats[t.symbol]) symbolStats[t.symbol] = { count: 0, pl: 0 }
    symbolStats[t.symbol].count++
    symbolStats[t.symbol].pl += Number(t.net_profit || t.profit || 0)
  })

  // Strategy performance breakdown via magic number
  const strategyMap = new Map(strategies.map(s => [s.magic, s]))
  const magicNumbers = [...new Set(trades.map(t => t.magic).filter((m): m is number => m !== null && m !== 0))]

  function calcStratStats(magic: number) {
    const stratTrades = closedTrades.filter(t => t.magic === magic)
    const stratOpen = openTrades.filter(t => t.magic === magic)
    const wins = stratTrades.filter(t => Number(t.net_profit || t.profit || 0) > 0)
    const losses = stratTrades.filter(t => Number(t.net_profit || t.profit || 0) < 0)
    const totalPL = stratTrades.reduce((s, t) => s + Number(t.net_profit || t.profit || 0), 0)
    const wr = stratTrades.length > 0 ? (wins.length / stratTrades.length) * 100 : 0
    const aWin = wins.length > 0 ? wins.reduce((s, t) => s + Number(t.net_profit || t.profit || 0), 0) / wins.length : 0
    const aLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + Number(t.net_profit || t.profit || 0), 0) / losses.length) : 0
    const pf = aLoss > 0 && wins.length > 0
      ? wins.reduce((s, t) => s + Number(t.net_profit || t.profit || 0), 0) / Math.abs(losses.reduce((s, t) => s + Number(t.net_profit || t.profit || 0), 0))
      : 0
    const best = stratTrades.length > 0 ? Math.max(...stratTrades.map(t => Number(t.net_profit || t.profit || 0))) : 0
    const worst = stratTrades.length > 0 ? Math.min(...stratTrades.map(t => Number(t.net_profit || t.profit || 0))) : 0
    const durations = stratTrades.filter(t => t.duration_seconds).map(t => Number(t.duration_seconds || 0))
    const avgDur = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length / 3600 : 0
    // Equity curve per strategy
    let peak = 0, maxDD = 0, eqCurve = 0
    const eqPoints: { trade: number; equity: number }[] = []
    stratTrades.sort((a, b) => (a.close_time || '').localeCompare(b.close_time || '')).forEach((t, i) => {
      eqCurve += Number(t.net_profit || t.profit || 0)
      eqPoints.push({ trade: i + 1, equity: eqCurve })
      if (eqCurve > peak) peak = eqCurve
      const dd = peak - eqCurve
      if (dd > maxDD) maxDD = dd
    })
    const retDD = maxDD > 0 ? totalPL / maxDD : 0
    const lots = stratTrades.reduce((s, t) => s + Number(t.lots || 0), 0)
    return { total: stratTrades.length, open: stratOpen.length, wins: wins.length, losses: losses.length, totalPL, wr, aWin, aLoss, pf, best, worst, avgDur, maxDD, retDD, lots, eqPoints }
  }

  // Selected strategy detail
  const selStratStats = selectedMagic !== null ? calcStratStats(selectedMagic) : null
  const selStrategy = selectedMagic !== null ? strategyMap.get(selectedMagic) : null

  // Show strategies that have trades on this account (any status) + active ones without trades
  const accountMagics = new Set(trades.map(t => t.magic).filter((m): m is number => m !== null && m !== 0))
  const visibleStrategies = strategies.filter(s => accountMagics.has(s.magic) || s.status === 'active')
    .sort((a, b) => a.magic - b.magic)

  // Sorted & filtered trade list
  const sortedTrades = (() => {
    const list = [...closedTrades]
    list.sort((a, b) => {
      let va: any, vb: any
      switch (sortCol) {
        case 'close_time': va = a.close_time || ''; vb = b.close_time || ''; break
        case 'open_time': va = a.open_time || ''; vb = b.open_time || ''; break
        case 'symbol': va = a.symbol || ''; vb = b.symbol || ''; break
        case 'direction': va = a.direction || ''; vb = b.direction || ''; break
        case 'lots': va = Number(a.lots || 0); vb = Number(b.lots || 0); break
        case 'open_price': va = Number(a.open_price || 0); vb = Number(b.open_price || 0); break
        case 'close_price': va = Number(a.close_price || 0); vb = Number(b.close_price || 0); break
        case 'profit': va = Number(a.net_profit || a.profit || 0); vb = Number(b.net_profit || b.profit || 0); break
        case 'swap': va = Number(a.swap || 0); vb = Number(b.swap || 0); break
        case 'commission': va = Number(a.commission || 0); vb = Number(b.commission || 0); break
        case 'duration': va = Number(a.duration_seconds || 0); vb = Number(b.duration_seconds || 0); break
        case 'magic': va = Number(a.magic || 0); vb = Number(b.magic || 0); break
        default: va = a.close_time || ''; vb = b.close_time || ''
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return list
  })()

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  function sortIcon(col: string) {
    if (sortCol !== col) return '↕'
    return sortDir === 'asc' ? '↑' : '↓'
  }

  const displayTrades = showAllTrades ? sortedTrades : sortedTrades.slice(0, 100)

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="text-sm text-violet-600 hover:text-violet-800 flex items-center gap-1">
        &larr; Torna ai conti
      </button>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-red-800">Errore caricamento dati conto</p>
            <p className="text-xs text-red-600 mt-1 break-all">{error}</p>
          </div>
          <button onClick={() => loadAccountData()}
            className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors self-start sm:self-auto">
            Riprova
          </button>
        </div>
      )}

      {/* Lineage banner */}
      {isLineageView && (
        <div className="px-4 py-3 bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
              <span className="text-sm font-semibold text-violet-800">Vista Challenge Lineage</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {lineageAccounts!.map((a, i) => (
                <span key={a.id} className="flex items-center gap-1.5">
                  <span className={`px-2 py-0.5 rounded-full font-medium ${
                    a.status === 'active' ? 'bg-violet-600 text-white' :
                    a.status === 'inactive' ? 'bg-slate-200 text-slate-600' :
                    'bg-slate-100 text-slate-700'
                  }`}>
                    {a.challenge_phase || a.name.split('—')[1]?.trim() || a.name}
                  </span>
                  <span className="text-violet-600">{fmtUsd(Number(a.balance || a.account_size))}</span>
                  {i < lineageAccounts!.length - 1 && <span className="text-violet-400">→</span>}
                </span>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-violet-600 mt-1">
            Snapshot, trade ed equity curve aggregati su {lineageAccounts!.length} conti · capitale iniziale challenge: {fmtUsd(Number(initialAccount.account_size))}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
              <h2 className="text-xl font-bold text-slate-900">{isLineageView ? lineageAccounts![0].name.replace(/—.*/,'').trim() + ' (Challenge)' : account.name}</h2>
              <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">{account.status}</span>
              {isLineageView && (
                <span className="text-xs px-2 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">{account.challenge_phase} attivo</span>
              )}
            </div>
            <p className="text-sm text-slate-500 mt-1">
              {account.broker} &middot; {account.server} &middot; Login {account.login}
              {isLineageView && <span className="ml-2 text-violet-500">· {lineageAccounts!.length} fasi aggregate</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-slate-900">{fmtUsd(eq)}</p>
            <p className={`text-lg font-semibold ${plColor(pl)}`}>
              {pl >= 0 ? '+' : ''}{fmtUsd(pl)} ({plPct >= 0 ? '+' : ''}{fmt(plPct, 2)}%)
            </p>
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-lg font-bold text-slate-900">{fmtUsd(bal)}</p>
          <p className="text-xs text-slate-500">Balance</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-lg font-bold text-slate-900">{fmtUsd(eq)}</p>
          <p className="text-xs text-slate-500">Equity</p>
        </div>
        <div className={`rounded-xl border p-3 ${floating >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <p className={`text-lg font-bold ${plColor(floating)}`}>{fmtUsd(floating, 2)}</p>
          <p className="text-xs text-slate-500">Floating P/L</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-lg font-bold text-slate-900">{fmtUsd(size)}</p>
          <p className="text-xs text-slate-500">Capitale iniziale</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-lg font-bold text-slate-900">{closedTrades.length}</p>
          <p className="text-xs text-slate-500">Trade chiusi</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-lg font-bold text-slate-900">{openTrades.length}</p>
          <p className="text-xs text-slate-500">Posizioni aperte</p>
        </div>
      </div>

      {/* DD Bars — Historical Max */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Drawdown Storico — Limiti FTMO</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-600 font-medium">Max Daily Drawdown</span>
              <span className={histMaxDDD > 4 ? 'text-red-600 font-bold' : 'text-slate-700'}>{fmt(histMaxDDD, 2)}% / {limitDDD}%</span>
            </div>
            <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${ddBarColor(histMaxDDD)}`}
                style={{ width: `${Math.min((histMaxDDD / limitDDD) * 100, 100)}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>0%</span>
              <span className="text-amber-500">Warning 3%</span>
              <span className="text-red-500">Limit {limitDDD}%</span>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-600 font-medium">Max Total Drawdown</span>
              <span className={histMaxTDD > 8 ? 'text-red-600 font-bold' : 'text-slate-700'}>{fmt(histMaxTDD, 2)}% / {limitTDD}%</span>
            </div>
            <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${ddBarColor(histMaxTDD)}`}
                style={{ width: `${Math.min((histMaxTDD / limitTDD) * 100, 100)}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>0%</span>
              <span className="text-amber-500">Warning 7%</span>
              <span className="text-red-500">Limit {limitTDD}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Equity Curve */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">Equity Curve</h3>
          {filteredEquity.length >= 2 && (
            <div className="flex gap-1">
              {['1W', '2W', '1M', '3M', '6M', '1Y', 'ALL'].map(r => (
                <button key={r} onClick={() => setEquityRange(r)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${equityRange === r ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  {r === 'ALL' ? 'Tutto' : r}
                </button>
              ))}
            </div>
          )}
        </div>
        {filteredEquity.length >= 2 ? (
          <>
            {/* Summary bar */}
            <div className="flex gap-4 mb-3 text-xs">
              <span className="text-slate-500">
                {filteredEquity.length} punti
                {equityRange !== 'ALL' && ` (${equityRange})`}
              </span>
              {filteredEquity.length > 1 && (() => {
                const first = filteredEquity[0].equity
                const last = filteredEquity[filteredEquity.length - 1].equity
                const diff = last - first
                const pct = first > 0 ? (diff / first) * 100 : 0
                const min = Math.min(...filteredEquity.map(d => d.equity))
                const max = Math.max(...filteredEquity.map(d => d.equity))
                return (
                  <>
                    <span className={diff >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                      {diff >= 0 ? '+' : ''}{fmtUsd(diff)} ({pct >= 0 ? '+' : ''}{fmt(pct, 2)}%)
                    </span>
                    <span className="text-slate-400">Min {fmtUsd(min)} · Max {fmtUsd(max)}</span>
                  </>
                )
              })()}
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={filteredEquity}>
                <defs>
                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="ts" tick={{ fontSize: 10 }} stroke="#94a3b8" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8"
                  domain={[(dataMin: number) => Math.floor(dataMin * 0.998), (dataMax: number) => Math.ceil(dataMax * 1.002)]}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(val) => [fmtUsd(Number(val)), 'Equity']}
                  labelStyle={{ fontSize: 11, color: '#64748b' }}
                />
                <Area type="monotone" dataKey="equity" stroke="#7c3aed" strokeWidth={2} fill="url(#eqGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div className="h-48 flex items-center justify-center bg-slate-50 rounded-lg">
            <div className="text-center">
              <p className="text-sm text-slate-500">
                {closedTrades.length === 0
                  ? 'Importa i trade per vedere la equity curve'
                  : equityRange !== 'ALL'
                    ? 'Nessun trade nel periodo selezionato'
                    : 'Servono almeno 2 trade chiusi'}
              </p>
              {closedTrades.length === 0 && (
                <p className="text-xs text-violet-500 mt-2">Vai su Conti &rarr; Import CSV per caricare lo storico</p>
              )}
              {equityRange !== 'ALL' && closedTrades.length > 0 && (
                <button onClick={() => setEquityRange('ALL')} className="text-xs text-violet-600 hover:text-violet-800 mt-2 underline">
                  Mostra tutto il periodo
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Trading Stats */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Statistiche Trading</h3>
        {closedTrades.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-lg font-bold text-slate-900">{closedTrades.length}</p>
              <p className="text-xs text-slate-500">Trade totali</p>
            </div>
            <div className={`rounded-lg p-3 ${totalNetPL >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <p className={`text-lg font-bold ${plColor(totalNetPL)}`}>{fmtUsd(totalNetPL, 2)}</p>
              <p className="text-xs text-slate-500">P&L netto</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-lg font-bold text-green-600">{fmt(winRate, 1)}%</p>
              <p className="text-xs text-slate-500">Win Rate<InfoTooltip metricKey="win_rate" /></p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-lg font-bold text-slate-900">{fmt(profitFactor, 2)}</p>
              <p className="text-xs text-slate-500">Profit Factor<InfoTooltip metricKey="profit_factor" /></p>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <p className="text-lg font-bold text-green-600">{fmtUsd(avgWin, 2)}</p>
              <p className="text-xs text-slate-500">Avg Win ({winTrades.length})</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-lg font-bold text-red-600">-{fmtUsd(avgLoss, 2)}</p>
              <p className="text-xs text-slate-500">Avg Loss ({lossTrades.length})</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <p className="text-lg font-bold text-green-600">{fmtUsd(bestTrade, 2)}</p>
              <p className="text-xs text-slate-500">Best Trade</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-lg font-bold text-red-600">{fmtUsd(worstTrade, 2)}</p>
              <p className="text-xs text-slate-500">Worst Trade</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-lg font-bold text-slate-900">{fmt(avgDuration, 1)}h</p>
              <p className="text-xs text-slate-500">Durata media</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-lg font-bold text-slate-900">{fmt(totalLots, 2)}</p>
              <p className="text-xs text-slate-500">Lotti totali</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-lg font-bold text-slate-900">{fmt(avgLoss > 0 ? avgWin / avgLoss : 0, 2)}</p>
              <p className="text-xs text-slate-500">Payoff Ratio</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-lg font-bold text-slate-900">{fmtUsd(closedTrades.length > 0 ? totalNetPL / closedTrades.length : 0, 2)}</p>
              <p className="text-xs text-slate-500">Expectancy</p>
            </div>
          </div>
        ) : (
          <div className="h-24 flex items-center justify-center bg-slate-50 rounded-lg">
            <p className="text-sm text-slate-500">Nessun trade chiuso ancora — i dati appariranno automaticamente</p>
          </div>
        )}
      </div>

      {/* Monthly Returns */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Rendimenti Mensili</h3>
        {years.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left py-1.5 px-2 font-medium">Anno</th>
                  {MONTHS.map(m => <th key={m} className="text-center py-1.5 px-1 font-medium">{m}</th>)}
                  <th className="text-right py-1.5 px-2 font-medium">Totale</th>
                </tr>
              </thead>
              <tbody>
                {years.map(year => {
                  const yearTotal = Object.values(monthlyReturns[year]).reduce((s, v) => s + v, 0)
                  return (
                    <tr key={year} className="border-t border-slate-100">
                      <td className="py-1.5 px-2 font-medium text-slate-700">{year}</td>
                      {Array.from({ length: 12 }, (_, i) => {
                        const val = monthlyReturns[year][i]
                        if (val === undefined) return <td key={i} className="text-center py-1.5 px-1 text-slate-300">—</td>
                        const pct = size > 0 ? (val / size) * 100 : 0
                        return (
                          <td key={i} className={`text-center py-1.5 px-1 font-medium rounded ${pct >= 0 ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
                            {pct >= 0 ? '+' : ''}{fmt(pct, 1)}%
                          </td>
                        )
                      })}
                      <td className={`text-right py-1.5 px-2 font-bold ${yearTotal >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {fmtUsd(yearTotal, 0)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-24 flex items-center justify-center bg-slate-50 rounded-lg">
            <p className="text-sm text-slate-500">La griglia mensile si popola con i trade chiusi</p>
          </div>
        )}
      </div>

      {/* Symbol breakdown */}
      {Object.keys(symbolStats).length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Per strumento</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(symbolStats).sort((a, b) => b[1].count - a[1].count).map(([sym, st]) => (
              <div key={sym} className="bg-slate-50 rounded-lg p-2.5">
                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium text-slate-900">{sym}</p>
                  <span className="text-xs text-slate-400">{st.count} trade</span>
                </div>
                <p className={`text-sm font-bold ${plColor(st.pl)}`}>{fmtUsd(st.pl, 2)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strategy Performance by Magic Number */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Performance per Strategia</h3>
        {magicNumbers.length > 0 || strategies.length > 0 ? (
          <>
            {/* Strategy pills */}
            <div className="flex gap-2 flex-wrap mb-4">
              <button onClick={() => setSelectedMagic(null)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${selectedMagic === null ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                Tutte
              </button>
              {visibleStrategies.map(s => {
                const st = calcStratStats(s.magic)
                const isPaused = s.status !== 'active'
                return (
                  <button key={s.magic} onClick={() => setSelectedMagic(selectedMagic === s.magic ? null : s.magic)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 ${selectedMagic === s.magic ? 'bg-violet-600 text-white' : isPaused ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    <span>#{s.magic} {s.name || s.strategy_id}</span>
                    {isPaused && <span className={`text-[9px] ${selectedMagic === s.magic ? 'text-violet-200' : 'text-amber-500'}`}>⏸</span>}
                    {st.total > 0 && (
                      <span className={`${selectedMagic === s.magic ? 'text-violet-200' : st.totalPL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {st.total}t
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Strategy table overview */}
            {selectedMagic === null ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="text-left py-2 font-medium">Strategia</th>
                      <th className="text-center py-2 font-medium">Magic</th>
                      <th className="text-center py-2 font-medium">Stato</th>
                      <th className="text-right py-2 font-medium">Trade</th>
                      <th className="text-right py-2 font-medium">Win%</th>
                      <th className="text-right py-2 font-medium">P/L</th>
                      <th className="text-right py-2 font-medium">PF</th>
                      <th className="text-right py-2 font-medium">MaxDD</th>
                      <th className="text-right py-2 font-medium">R/DD</th>
                      <th className="text-right py-2 font-medium">Exp</th>
                      <th className="text-right py-2 font-medium">Open</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleStrategies.map(s => {
                      const st = calcStratStats(s.magic)
                      return (
                        <tr key={s.magic} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedMagic(s.magic)}>
                          <td className="py-2 font-medium text-slate-900">{s.name || s.strategy_id}</td>
                          <td className="text-center py-2 text-slate-500">#{s.magic}</td>
                          <td className="text-center py-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                              {s.status === 'active' ? 'ON' : 'OFF'}
                            </span>
                          </td>
                          <td className="text-right py-2 text-slate-700">{st.total}</td>
                          <td className="text-right py-2 text-slate-700">{st.total > 0 ? `${fmt(st.wr, 1)}%` : '—'}</td>
                          <td className={`text-right py-2 font-medium ${st.total > 0 ? plColor(st.totalPL) : 'text-slate-300'}`}>
                            {st.total > 0 ? fmtUsd(st.totalPL, 2) : '—'}
                          </td>
                          <td className="text-right py-2 text-slate-700">{st.total > 0 ? fmt(st.pf, 2) : '—'}</td>
                          <td className="text-right py-2 text-slate-700">{st.total > 0 ? fmtUsd(st.maxDD, 0) : '—'}</td>
                          <td className="text-right py-2 font-medium text-violet-700">{st.total > 0 ? fmt(st.retDD, 2) : '—'}</td>
                          <td className="text-right py-2 text-slate-600">{st.total > 0 ? fmtUsd(st.totalPL / st.total, 2) : '—'}</td>
                          <td className="text-right py-2 text-slate-500">{st.open || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : selStratStats && (
              /* Strategy detail */
              <div className="space-y-4">
                {/* Strategy header */}
                <div className="flex items-center justify-between bg-violet-50 rounded-lg p-3">
                  <div>
                    <p className="text-sm font-bold text-violet-900">
                      {selStrategy ? (selStrategy.name || selStrategy.strategy_id) : `Magic #${selectedMagic}`}
                    </p>
                    <p className="text-xs text-violet-600">
                      Magic #{selectedMagic}
                      {selStrategy && ` · ${selStrategy.asset} · ${selStrategy.timeframe} · ${selStrategy.asset_group}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xl font-bold ${plColor(selStratStats.totalPL)}`}>{fmtUsd(selStratStats.totalPL, 2)}</p>
                    <p className="text-xs text-violet-600">{selStratStats.total} trade chiusi · {selStratStats.open} aperti</p>
                  </div>
                </div>

                {selStratStats.total > 0 ? (
                  <>
                    {/* Metrics grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <p className="text-sm font-bold text-green-600">{fmt(selStratStats.wr, 1)}%</p>
                        <p className="text-[10px] text-slate-500">Win Rate</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <p className="text-sm font-bold text-slate-900">{fmt(selStratStats.pf, 2)}</p>
                        <p className="text-[10px] text-slate-500">Profit Factor</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-2.5">
                        <p className="text-sm font-bold text-green-600">{fmtUsd(selStratStats.aWin, 2)}</p>
                        <p className="text-[10px] text-slate-500">Avg Win ({selStratStats.wins})</p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-2.5">
                        <p className="text-sm font-bold text-red-600">-{fmtUsd(selStratStats.aLoss, 2)}</p>
                        <p className="text-[10px] text-slate-500">Avg Loss ({selStratStats.losses})</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <p className="text-sm font-bold text-slate-900">{fmtUsd(selStratStats.maxDD, 0)}</p>
                        <p className="text-[10px] text-slate-500">Max Drawdown</p>
                      </div>
                      <div className="bg-violet-50 rounded-lg p-2.5">
                        <p className="text-sm font-bold text-violet-700">{fmt(selStratStats.retDD, 2)}</p>
                        <p className="text-[10px] text-slate-500">Ret/DD</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-2.5">
                        <p className="text-sm font-bold text-green-600">{fmtUsd(selStratStats.best, 2)}</p>
                        <p className="text-[10px] text-slate-500">Best Trade</p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-2.5">
                        <p className="text-sm font-bold text-red-600">{fmtUsd(selStratStats.worst, 2)}</p>
                        <p className="text-[10px] text-slate-500">Worst Trade</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <p className="text-sm font-bold text-slate-900">{fmt(selStratStats.avgDur, 1)}h</p>
                        <p className="text-[10px] text-slate-500">Durata media</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <p className="text-sm font-bold text-slate-900">{fmt(selStratStats.lots, 2)}</p>
                        <p className="text-[10px] text-slate-500">Lotti totali</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <p className="text-sm font-bold text-slate-900">{selStratStats.aLoss > 0 ? fmt(selStratStats.aWin / selStratStats.aLoss, 2) : '—'}</p>
                        <p className="text-[10px] text-slate-500">Payoff</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <p className="text-sm font-bold text-slate-900">{fmtUsd(selStratStats.total > 0 ? selStratStats.totalPL / selStratStats.total : 0, 2)}</p>
                        <p className="text-[10px] text-slate-500">Expectancy</p>
                      </div>
                    </div>

                    {/* Strategy equity curve */}
                    {selStratStats.eqPoints.length >= 2 && (
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-2">Equity curve strategia</p>
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={selStratStats.eqPoints}>
                            <defs>
                              <linearGradient id="stratGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={selStratStats.totalPL >= 0 ? '#22c55e' : '#ef4444'} stopOpacity={0.15} />
                                <stop offset="95%" stopColor={selStratStats.totalPL >= 0 ? '#22c55e' : '#ef4444'} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="trade" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                            <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(val) => [`$${fmt(Number(val))}`, 'P/L']} />
                            <Area type="monotone" dataKey="equity" stroke={selStratStats.totalPL >= 0 ? '#22c55e' : '#ef4444'} strokeWidth={2} fill="url(#stratGrad)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* Test vs Real comparison if strategy exists */}
                    {selStrategy && selStrategy.test_trades && (
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-2">Test (SQX) vs Real</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-500 border-b border-slate-200">
                                <th className="text-left py-1.5 font-medium">Metrica</th>
                                <th className="text-right py-1.5 font-medium">Test</th>
                                <th className="text-right py-1.5 font-medium">Real</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {[
                                { l: 'Trades', t: selStrategy.test_trades, r: selStratStats.total },
                                { l: 'Win Rate', t: selStrategy.test_win_pct, r: selStratStats.wr, s: '%' },
                                { l: 'Payoff', t: selStrategy.test_payoff, r: selStratStats.aLoss > 0 ? selStratStats.aWin / selStratStats.aLoss : null },
                                { l: 'Max DD', t: selStrategy.test_max_dd, r: selStratStats.maxDD, p: '$' },
                                { l: 'Ret/DD', t: selStrategy.test_ret_dd, r: selStratStats.retDD },
                                { l: 'Stability', t: selStrategy.test_stability, r: null },
                              ].map((row, i) => (
                                <tr key={i}>
                                  <td className="py-1.5 text-slate-700">{row.l}</td>
                                  <td className="text-right py-1.5 text-slate-600">{row.t !== null && row.t !== undefined ? `${row.p || ''}${fmt(Number(row.t))}${row.s || ''}` : '—'}</td>
                                  <td className="text-right py-1.5 font-medium text-slate-900">{row.r !== null && row.r !== undefined ? `${row.p || ''}${fmt(Number(row.r))}${row.s || ''}` : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="h-20 flex items-center justify-center bg-slate-50 rounded-lg">
                    <p className="text-sm text-slate-500">Nessun trade chiuso per questa strategia</p>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="h-24 flex items-center justify-center bg-slate-50 rounded-lg">
            <p className="text-sm text-slate-500">Le performance per strategia appariranno quando il bridge raccoglie trade con magic number</p>
          </div>
        )}
      </div>

      {/* Open Positions */}
      {openTrades.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Posizioni Aperte ({openTrades.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="text-left py-2 font-medium">Simbolo</th>
                  <th className="text-center py-2 font-medium">Dir</th>
                  <th className="text-right py-2 font-medium">Lotti</th>
                  <th className="text-right py-2 font-medium">Prezzo</th>
                  <th className="text-right py-2 font-medium">SL</th>
                  <th className="text-right py-2 font-medium">TP</th>
                  <th className="text-right py-2 font-medium">P/L</th>
                  <th className="text-right py-2 font-medium">Magic</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {openTrades.map(t => (
                  <tr key={t.id}>
                    <td className="py-2 font-medium text-slate-900">{t.symbol}</td>
                    <td className={`text-center py-2 font-medium ${t.direction === 'buy' ? 'text-green-600' : 'text-red-600'}`}>
                      {t.direction === 'buy' ? 'BUY' : 'SELL'}
                    </td>
                    <td className="text-right py-2 text-slate-700">{fmt(t.lots, 2)}</td>
                    <td className="text-right py-2 text-slate-700">{fmt(t.open_price, 5)}</td>
                    <td className="text-right py-2 text-slate-500">{t.sl ? fmt(t.sl, 5) : '—'}</td>
                    <td className="text-right py-2 text-slate-500">{t.tp ? fmt(t.tp, 5) : '—'}</td>
                    <td className={`text-right py-2 font-medium ${plColor(Number(t.profit || 0))}`}>{fmtUsd(t.profit, 2)}</td>
                    <td className="text-right py-2 text-slate-400">#{t.magic}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Costs Analysis */}
      {closedTrades.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Analisi Costi</h3>
          {(() => {
            const totalSwap = closedTrades.reduce((s, t) => s + Number(t.swap || 0), 0)
            const totalComm = closedTrades.reduce((s, t) => s + Number(t.commission || 0), 0)
            const totalCosts = totalSwap + totalComm
            const grossPL = closedTrades.reduce((s, t) => s + Number(t.profit || 0), 0)
            const netPL = closedTrades.reduce((s, t) => s + Number(t.net_profit || t.profit || 0), 0)
            const costsPctGross = grossPL !== 0 ? Math.abs(totalCosts / grossPL) * 100 : 0
            const costsPctAccount = size > 0 ? Math.abs(totalCosts / size) * 100 : 0
            const costsPctPerTrade = closedTrades.length > 0 ? Math.abs(totalCosts / closedTrades.length) : 0
            // Per-symbol breakdown
            const costsBySymbol: Record<string, { swap: number; comm: number; trades: number; pl: number }> = {}
            closedTrades.forEach(t => {
              if (!costsBySymbol[t.symbol]) costsBySymbol[t.symbol] = { swap: 0, comm: 0, trades: 0, pl: 0 }
              costsBySymbol[t.symbol].swap += Number(t.swap || 0)
              costsBySymbol[t.symbol].comm += Number(t.commission || 0)
              costsBySymbol[t.symbol].pl += Number(t.net_profit || t.profit || 0)
              costsBySymbol[t.symbol].trades++
            })
            // Per-strategy breakdown
            const costsByStrat: Record<number, { name: string; swap: number; comm: number; trades: number; pl: number }> = {}
            closedTrades.filter(t => t.magic).forEach(t => {
              const m = t.magic!
              if (!costsByStrat[m]) {
                const s = strategyMap.get(m)
                costsByStrat[m] = { name: s ? (s.name || `#${m}`) : `#${m}`, swap: 0, comm: 0, trades: 0, pl: 0 }
              }
              costsByStrat[m].swap += Number(t.swap || 0)
              costsByStrat[m].comm += Number(t.commission || 0)
              costsByStrat[m].pl += Number(t.net_profit || t.profit || 0)
              costsByStrat[m].trades++
            })
            return (
              <>
                {/* Cost summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
                  <div className={`rounded-lg p-3 ${totalSwap < 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                    <p className={`text-lg font-bold ${plColor(totalSwap)}`}>{fmtUsd(totalSwap, 2)}</p>
                    <p className="text-xs text-slate-500">Swap totale</p>
                  </div>
                  <div className={`rounded-lg p-3 ${totalComm < 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
                    <p className={`text-lg font-bold ${plColor(totalComm)}`}>{fmtUsd(totalComm, 2)}</p>
                    <p className="text-xs text-slate-500">Commissioni totali</p>
                  </div>
                  <div className={`rounded-lg p-3 ${totalCosts < 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
                    <p className={`text-lg font-bold ${plColor(totalCosts)}`}>{fmtUsd(totalCosts, 2)}</p>
                    <p className="text-xs text-slate-500">Costi totali</p>
                  </div>
                  <div className={`rounded-lg p-3 ${costsPctGross > 20 ? 'bg-red-50' : 'bg-slate-50'}`}>
                    <p className={`text-lg font-bold ${costsPctGross > 20 ? 'text-red-600' : 'text-slate-900'}`}>{fmt(costsPctGross, 1)}%</p>
                    <p className="text-xs text-slate-500">% su Gross P/L</p>
                  </div>
                  <div className={`rounded-lg p-3 ${costsPctAccount > 2 ? 'bg-red-50' : 'bg-slate-50'}`}>
                    <p className={`text-lg font-bold ${costsPctAccount > 2 ? 'text-red-600' : 'text-slate-900'}`}>{fmt(costsPctAccount, 2)}%</p>
                    <p className="text-xs text-slate-500">% su Capitale</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-lg font-bold text-slate-900">{fmtUsd(costsPctPerTrade, 2)}</p>
                    <p className="text-xs text-slate-500">Costo medio/trade</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-lg font-bold text-slate-900">{fmtUsd(closedTrades.length > 0 ? totalSwap / closedTrades.length : 0, 2)}</p>
                    <p className="text-xs text-slate-500">Swap medio/trade</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-lg font-bold text-slate-900">{fmtUsd(closedTrades.length > 0 ? totalComm / closedTrades.length : 0, 2)}</p>
                    <p className="text-xs text-slate-500">Comm media/trade</p>
                  </div>
                </div>

                {/* Cost breakdown by symbol + strategy side by side */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-2">Per strumento</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-200">
                            <th className="text-left py-1.5 font-medium">Simbolo</th>
                            <th className="text-right py-1.5 font-medium">Trade</th>
                            <th className="text-right py-1.5 font-medium">Swap</th>
                            <th className="text-right py-1.5 font-medium">Comm</th>
                            <th className="text-right py-1.5 font-medium">Totale</th>
                            <th className="text-right py-1.5 font-medium">% P/L</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {Object.entries(costsBySymbol)
                            .sort((a, b) => (a[1].swap + a[1].comm) - (b[1].swap + b[1].comm))
                            .map(([sym, c]) => {
                              const costs = c.swap + c.comm
                              const pctPL = c.pl !== 0 ? Math.abs(costs / c.pl) * 100 : 0
                              return (
                              <tr key={sym}>
                                <td className="py-1.5 font-medium text-slate-900">{sym}</td>
                                <td className="text-right py-1.5 text-slate-500">{c.trades}</td>
                                <td className={`text-right py-1.5 ${plColor(c.swap)}`}>{fmtUsd(c.swap, 2)}</td>
                                <td className={`text-right py-1.5 ${plColor(c.comm)}`}>{fmtUsd(c.comm, 2)}</td>
                                <td className={`text-right py-1.5 font-medium ${plColor(costs)}`}>{fmtUsd(costs, 2)}</td>
                                <td className={`text-right py-1.5 ${pctPL > 30 ? 'text-red-600 font-medium' : 'text-slate-500'}`}>{fmt(pctPL, 0)}%</td>
                              </tr>
                              )
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-2">Per strategia</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-200">
                            <th className="text-left py-1.5 font-medium">Strategia</th>
                            <th className="text-right py-1.5 font-medium">Trade</th>
                            <th className="text-right py-1.5 font-medium">Swap</th>
                            <th className="text-right py-1.5 font-medium">Comm</th>
                            <th className="text-right py-1.5 font-medium">Totale</th>
                            <th className="text-right py-1.5 font-medium">% P/L</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {Object.entries(costsByStrat)
                            .sort((a, b) => (a[1].swap + a[1].comm) - (b[1].swap + b[1].comm))
                            .map(([m, c]) => {
                              const costs = c.swap + c.comm
                              const pctPL = c.pl !== 0 ? Math.abs(costs / c.pl) * 100 : 0
                              return (
                              <tr key={m}>
                                <td className="py-1.5 font-medium text-slate-900">{c.name}</td>
                                <td className="text-right py-1.5 text-slate-500">{c.trades}</td>
                                <td className={`text-right py-1.5 ${plColor(c.swap)}`}>{fmtUsd(c.swap, 2)}</td>
                                <td className={`text-right py-1.5 ${plColor(c.comm)}`}>{fmtUsd(c.comm, 2)}</td>
                                <td className={`text-right py-1.5 font-medium ${plColor(costs)}`}>{fmtUsd(costs, 2)}</td>
                                <td className={`text-right py-1.5 ${pctPL > 30 ? 'text-red-600 font-medium' : 'text-slate-500'}`}>{fmt(pctPL, 0)}%</td>
                              </tr>
                              )
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* Trade History */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">Storico Trade ({closedTrades.length})</h3>
          {closedTrades.length > 100 && (
            <button onClick={() => setShowAllTrades(!showAllTrades)}
              className="text-xs text-violet-600 hover:text-violet-800 underline">
              {showAllTrades ? 'Mostra ultimi 100' : `Mostra tutti (${closedTrades.length})`}
            </button>
          )}
        </div>
        {closedTrades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  {[
                    { key: 'close_time', label: 'Chiusura', align: 'text-left' },
                    { key: 'open_time', label: 'Apertura', align: 'text-left' },
                    { key: 'symbol', label: 'Simbolo', align: 'text-left' },
                    { key: 'direction', label: 'Dir', align: 'text-center' },
                    { key: 'lots', label: 'Lotti', align: 'text-right' },
                    { key: 'open_price', label: 'P.Apertura', align: 'text-right' },
                    { key: 'close_price', label: 'P.Chiusura', align: 'text-right' },
                    { key: 'profit', label: 'P/L Lordo', align: 'text-right' },
                    { key: 'swap', label: 'Swap', align: 'text-right' },
                    { key: 'commission', label: 'Comm', align: 'text-right' },
                    { key: 'duration', label: 'Durata', align: 'text-right' },
                    { key: 'magic', label: 'Strategia', align: 'text-left' },
                  ].map(col => (
                    <th key={col.key} onClick={() => toggleSort(col.key)}
                      className={`${col.align} py-2 font-medium cursor-pointer hover:text-violet-600 select-none whitespace-nowrap`}>
                      {col.label} <span className="text-[10px] opacity-60">{sortIcon(col.key)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayTrades.map(t => {
                  const durH = t.duration_seconds ? Number(t.duration_seconds) / 3600 : null
                  const grossPL = Number(t.profit || 0)
                  const swap = Number(t.swap || 0)
                  const comm = Number(t.commission || 0)
                  const strat = t.magic ? strategyMap.get(t.magic) : null
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="py-1.5 text-slate-600 whitespace-nowrap">
                        {t.close_time ? new Date(t.close_time).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="py-1.5 text-slate-400 whitespace-nowrap">
                        {new Date(t.open_time).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-1.5 font-medium text-slate-900">{t.symbol}</td>
                      <td className={`text-center py-1.5 font-medium ${t.direction === 'buy' ? 'text-green-600' : 'text-red-600'}`}>
                        {t.direction === 'buy' ? 'BUY' : 'SELL'}
                      </td>
                      <td className="text-right py-1.5 text-slate-700">{fmt(t.lots, 2)}</td>
                      <td className="text-right py-1.5 text-slate-600">{fmt(t.open_price, 5)}</td>
                      <td className="text-right py-1.5 text-slate-600">{t.close_price ? fmt(t.close_price, 5) : '—'}</td>
                      <td className={`text-right py-1.5 font-medium ${plColor(grossPL)}`}>{fmtUsd(grossPL, 2)}</td>
                      <td className={`text-right py-1.5 ${swap !== 0 ? plColor(swap) : 'text-slate-300'}`}>{swap !== 0 ? fmtUsd(swap, 2) : '—'}</td>
                      <td className={`text-right py-1.5 ${comm !== 0 ? plColor(comm) : 'text-slate-300'}`}>{comm !== 0 ? fmtUsd(comm, 2) : '—'}</td>
                      <td className="text-right py-1.5 text-slate-500 whitespace-nowrap">{durH !== null ? (durH < 1 ? `${Math.round(durH * 60)}m` : `${fmt(durH, 1)}h`) : '—'}</td>
                      <td className="py-1.5 text-slate-600 whitespace-nowrap">
                        {strat ? <span className="text-violet-700 font-medium">{strat.name || `#${t.magic}`}</span> : t.magic ? <span className="text-slate-400">#{t.magic}</span> : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!showAllTrades && closedTrades.length > 100 && (
              <div className="text-center mt-3">
                <button onClick={() => setShowAllTrades(true)}
                  className="text-xs text-violet-600 hover:text-violet-800 underline">
                  Carica tutti i {closedTrades.length} trade
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="h-24 flex items-center justify-center bg-slate-50 rounded-lg">
            <p className="text-sm text-slate-500">Nessun trade chiuso — lo storico si popola automaticamente dal bridge</p>
          </div>
        )}
      </div>

      {/* Info footer */}
      <div className="bg-violet-50 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-violet-700 mb-2">Info sync</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-violet-600">
          <span>Server: {account.server || '—'}</span>
          <span>Login: {account.login || '—'}</span>
          <span>Snapshot: {snapshots.length}</span>
          <span>Ultimo sync: {account.last_sync_at ? new Date(account.last_sync_at).toLocaleString('it-IT') : 'Mai'}</span>
        </div>
      </div>
    </div>
  )
}
