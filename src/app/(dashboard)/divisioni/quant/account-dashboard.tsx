'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelAccount, QelAccountSnapshot, QelTrade, QelStrategy } from '@/types/database'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtUsd(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined) return '—'
  const v = Number(n)
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

function plColor(n: number): string {
  if (n > 0) return 'text-green-600'
  if (n < 0) return 'text-red-600'
  return 'text-slate-500'
}

function ddBarColor(pct: number): string {
  if (pct > 8) return 'bg-red-500'
  if (pct > 5) return 'bg-amber-500'
  if (pct > 3) return 'bg-yellow-500'
  return 'bg-green-500'
}

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

interface Props {
  account: QelAccount
  onClose: () => void
}

export default function AccountDashboard({ account, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<QelAccountSnapshot[]>([])
  const [trades, setTrades] = useState<QelTrade[]>([])
  const [strategies, setStrategies] = useState<QelStrategy[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [selectedMagic, setSelectedMagic] = useState<number | null>(null)

  const bal = Number(account.balance || 0)
  const eq = Number(account.equity || 0)
  const size = Number(account.account_size)
  const pl = bal - size
  const plPct = size > 0 ? (pl / size) * 100 : 0
  const floating = Number(account.floating_pl || 0)
  const ddd = Number(account.daily_dd_pct || 0)
  const tdd = Number(account.total_dd_pct || 0)
  const maxDdd = Number(account.max_daily_loss_pct || 5)
  const maxTdd = Number(account.max_total_loss_pct || 10)

  useEffect(() => {
    loadAccountData()
  }, [account.id])

  async function loadAccountData() {
    setLoadingData(true)
    const supabase = createClient()
    const [snapRes, tradeRes, stratRes] = await Promise.all([
      supabase.from('qel_account_snapshots').select('*').eq('account_id', account.id).order('ts', { ascending: true }),
      supabase.from('qel_trades').select('*').eq('account_id', account.id).order('open_time', { ascending: false }),
      supabase.from('qel_strategies').select('*').order('magic'),
    ])
    setSnapshots(snapRes.data || [])
    setTrades(tradeRes.data || [])
    setStrategies(stratRes.data || [])
    setLoadingData(false)
  }

  // Equity curve data
  const equityData = snapshots.map(s => ({
    ts: new Date(s.ts).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    equity: Number(s.equity),
    balance: Number(s.balance),
    dd: Number(s.total_dd_pct),
  }))

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

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="text-sm text-violet-600 hover:text-violet-800 flex items-center gap-1">
        &larr; Torna ai conti
      </button>

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
              <h2 className="text-xl font-bold text-slate-900">{account.name}</h2>
              <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">{account.status}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">{account.broker} &middot; {account.server} &middot; Login {account.login}</p>
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

      {/* DD Bars */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Drawdown — Limiti FTMO</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-600 font-medium">Daily Drawdown</span>
              <span className={ddd > 4 ? 'text-red-600 font-bold' : 'text-slate-700'}>{fmt(ddd, 2)}% / {maxDdd}%</span>
            </div>
            <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${ddBarColor(ddd)}`}
                style={{ width: `${Math.min((ddd / maxDdd) * 100, 100)}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>0%</span>
              <span className="text-amber-500">Warning 3%</span>
              <span className="text-red-500">Limit {maxDdd}%</span>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-600 font-medium">Total Drawdown</span>
              <span className={tdd > 8 ? 'text-red-600 font-bold' : 'text-slate-700'}>{fmt(tdd, 2)}% / {maxTdd}%</span>
            </div>
            <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${ddBarColor(tdd)}`}
                style={{ width: `${Math.min((tdd / maxTdd) * 100, 100)}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>0%</span>
              <span className="text-amber-500">Warning 7%</span>
              <span className="text-red-500">Limit {maxTdd}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Equity Curve */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Equity Curve</h3>
        {equityData.length >= 2 ? (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={equityData}>
              <defs>
                <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="ts" tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" domain={['dataMin - 500', 'dataMax + 500']} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                formatter={(val) => [`$${fmt(Number(val))}`, '']}
              />
              <Area type="monotone" dataKey="equity" stroke="#7c3aed" strokeWidth={2} fill="url(#eqGrad)" name="Equity" />
              <Line type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Balance" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-48 flex items-center justify-center bg-slate-50 rounded-lg">
            <div className="text-center">
              <p className="text-sm text-slate-500">Il grafico si popola con i dati del bridge</p>
              <p className="text-xs text-slate-400 mt-1">{equityData.length} snapshot raccolti — servono almeno 2 punti</p>
              <p className="text-xs text-violet-500 mt-2">Il bridge sincronizza ogni 5 minuti</p>
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
              <p className="text-xs text-slate-500">Win Rate</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-lg font-bold text-slate-900">{fmt(profitFactor, 2)}</p>
              <p className="text-xs text-slate-500">Profit Factor</p>
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
              {strategies.filter(s => s.status === 'active').map(s => {
                const st = calcStratStats(s.magic)
                return (
                  <button key={s.magic} onClick={() => setSelectedMagic(selectedMagic === s.magic ? null : s.magic)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 ${selectedMagic === s.magic ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    <span>#{s.magic} {s.name || s.strategy_id}</span>
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
                      <th className="text-right py-2 font-medium">Trade</th>
                      <th className="text-right py-2 font-medium">Win%</th>
                      <th className="text-right py-2 font-medium">P/L</th>
                      <th className="text-right py-2 font-medium">PF</th>
                      <th className="text-right py-2 font-medium">MaxDD</th>
                      <th className="text-right py-2 font-medium">R/DD</th>
                      <th className="text-right py-2 font-medium">Open</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {strategies.filter(s => s.status === 'active').map(s => {
                      const st = calcStratStats(s.magic)
                      return (
                        <tr key={s.magic} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedMagic(s.magic)}>
                          <td className="py-2 font-medium text-slate-900">{s.name || s.strategy_id}</td>
                          <td className="text-center py-2 text-slate-500">#{s.magic}</td>
                          <td className="text-right py-2 text-slate-700">{st.total}</td>
                          <td className="text-right py-2 text-slate-700">{st.total > 0 ? `${fmt(st.wr, 1)}%` : '—'}</td>
                          <td className={`text-right py-2 font-medium ${st.total > 0 ? plColor(st.totalPL) : 'text-slate-300'}`}>
                            {st.total > 0 ? fmtUsd(st.totalPL, 2) : '—'}
                          </td>
                          <td className="text-right py-2 text-slate-700">{st.total > 0 ? fmt(st.pf, 2) : '—'}</td>
                          <td className="text-right py-2 text-slate-700">{st.total > 0 ? fmtUsd(st.maxDD, 0) : '—'}</td>
                          <td className="text-right py-2 font-medium text-violet-700">{st.total > 0 ? fmt(st.retDD, 2) : '—'}</td>
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

      {/* Trade History */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Storico Trade</h3>
        {closedTrades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="text-left py-2 font-medium">Data</th>
                  <th className="text-left py-2 font-medium">Simbolo</th>
                  <th className="text-center py-2 font-medium">Dir</th>
                  <th className="text-right py-2 font-medium">Lotti</th>
                  <th className="text-right py-2 font-medium">Apertura</th>
                  <th className="text-right py-2 font-medium">Chiusura</th>
                  <th className="text-right py-2 font-medium">P/L</th>
                  <th className="text-right py-2 font-medium">Durata</th>
                  <th className="text-right py-2 font-medium">Magic</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {closedTrades.slice(0, 50).map(t => {
                  const durH = t.duration_seconds ? Number(t.duration_seconds) / 3600 : null
                  const netPL = Number(t.net_profit || t.profit || 0)
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="py-2 text-slate-600">
                        {t.close_time ? new Date(t.close_time).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'}
                      </td>
                      <td className="py-2 font-medium text-slate-900">{t.symbol}</td>
                      <td className={`text-center py-2 font-medium ${t.direction === 'buy' ? 'text-green-600' : 'text-red-600'}`}>
                        {t.direction === 'buy' ? 'B' : 'S'}
                      </td>
                      <td className="text-right py-2 text-slate-700">{fmt(t.lots, 2)}</td>
                      <td className="text-right py-2 text-slate-600">{fmt(t.open_price, 2)}</td>
                      <td className="text-right py-2 text-slate-600">{t.close_price ? fmt(t.close_price, 2) : '—'}</td>
                      <td className={`text-right py-2 font-medium ${plColor(netPL)}`}>{fmtUsd(netPL, 2)}</td>
                      <td className="text-right py-2 text-slate-500">{durH !== null ? `${fmt(durH, 1)}h` : '—'}</td>
                      <td className="text-right py-2 text-slate-400">#{t.magic}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {closedTrades.length > 50 && (
              <p className="text-xs text-slate-400 mt-2 text-center">Mostrati 50 di {closedTrades.length} trade</p>
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
