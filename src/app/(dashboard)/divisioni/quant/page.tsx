'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelStrategy, QelAccount } from '@/types/database'

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtUsd(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined) return '—'
  const v = Number(n)
  const prefix = v >= 0 ? '' : '-'
  return `${prefix}$${Math.abs(v).toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Mai sincronizzato'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Ora'
  if (mins < 60) return `${mins}min fa`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h fa`
  return `${Math.floor(hours / 24)}g fa`
}

function statusBadge(status: string) {
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

function groupColor(group: string | null) {
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

type Tab = 'overview' | 'strategies' | 'accounts'
type StrategyView = 'list' | 'detail'

export default function QuantPage() {
  const [strategies, setStrategies] = useState<QelStrategy[]>([])
  const [accounts, setAccounts] = useState<QelAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')
  const [stratView, setStratView] = useState<StrategyView>('list')
  const [selectedStrat, setSelectedStrat] = useState<QelStrategy | null>(null)
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [expandedAcc, setExpandedAcc] = useState<string | null>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const supabase = createClient()
    const [stratRes, accRes] = await Promise.all([
      supabase.from('qel_strategies').select('*').order('magic'),
      supabase.from('qel_accounts').select('*').order('name'),
    ])
    setStrategies(stratRes.data || [])
    setAccounts(accRes.data || [])
    setLoading(false)
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
  const avgDD = syncedAccounts.length > 0 ? syncedAccounts.reduce((s, a) => s + Number(a.total_dd_pct || 0), 0) / syncedAccounts.length : 0

  const tabs = [
    { key: 'overview' as const, label: 'Overview' },
    { key: 'strategies' as const, label: `Strategie (${strategies.length})` },
    { key: 'accounts' as const, label: `Conti (${accounts.length})` },
  ]

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Quant Engine</h1>
        <p className="text-sm text-slate-500 mt-1">
          Trading sistematico &middot; QuantEdgeLab &middot; {activeStrategies.length} strategie &middot; {syncedAccounts.length}/{accounts.length} conti sincronizzati
        </p>
      </div>

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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
              <p className="text-2xl font-bold text-slate-900">{fmt(avgDD, 1)}%</p>
              <p className="text-sm text-slate-500">DD medio</p>
              <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                <div className={`h-full rounded-full ${ddBarColor(avgDD)}`} style={{ width: `${Math.min(avgDD * 10, 100)}%` }} />
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
                const ddd = Number(acc.daily_dd_pct || 0)
                const tdd = Number(acc.total_dd_pct || 0)
                const maxDdd = Number(acc.max_daily_loss_pct || 5)
                const maxTdd = Number(acc.max_total_loss_pct || 10)
                const margin = Number(acc.margin_used || 0)

                return (
                  <div key={acc.id}
                    className={`rounded-xl border transition-all ${synced ? 'border-slate-200 hover:border-slate-300 cursor-pointer' : 'border-dashed border-slate-300 bg-slate-50'}`}
                    onClick={() => synced && setExpandedAcc(isExpanded ? null : acc.id)}>

                    {/* Header row — always visible */}
                    <div className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        {synced && <div className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />}
                        <p className="text-sm font-semibold text-slate-900 truncate">{acc.name}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${statusBadge(acc.status)}`}>{acc.status}</span>
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

                        {/* DD Bars */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-slate-500 font-medium">Daily DD</span>
                              <span className={ddd > 4 ? 'text-red-600 font-bold' : 'text-slate-600'}>{fmt(ddd, 2)}% / {maxDdd}%</span>
                            </div>
                            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${ddBarColor(ddd)}`}
                                style={{ width: `${Math.min((ddd / maxDdd) * 100, 100)}%` }} />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">Limite FTMO: {maxDdd}%</p>
                          </div>
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-slate-500 font-medium">Total DD</span>
                              <span className={tdd > 8 ? 'text-red-600 font-bold' : 'text-slate-600'}>{fmt(tdd, 2)}% / {maxTdd}%</span>
                            </div>
                            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${ddBarColor(tdd)}`}
                                style={{ width: `${Math.min((tdd / maxTdd) * 100, 100)}%` }} />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">Limite FTMO: {maxTdd}%</p>
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

          {/* Top Strategies by Ret/DD */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Top strategie per Ret/DD</h3>
            <div className="space-y-2">
              {[...activeStrategies].sort((a, b) => Number(b.test_ret_dd || 0) - Number(a.test_ret_dd || 0)).slice(0, 6).map(s => (
                <div key={s.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 cursor-pointer"
                  onClick={() => { setTab('strategies'); setSelectedStrat(s); setStratView('detail') }}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${groupColor(s.asset_group)}`}>{s.asset_group}</span>
                    <span className="text-sm font-medium text-slate-900">{s.name}</span>
                    <span className="text-xs text-slate-400">#{s.magic}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    {s.real_trades > 0 && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${Number(s.real_pl) >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        LIVE {fmtUsd(s.real_pl)}
                      </span>
                    )}
                    <span className="text-slate-500">Win {fmt(s.test_win_pct, 1)}%</span>
                    <span className="font-bold text-violet-700">{fmt(s.test_ret_dd, 2)} R/DD</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
          <button onClick={() => { setStratView('list'); setSelectedStrat(null) }}
            className="text-sm text-violet-600 hover:text-violet-800 flex items-center gap-1">
            &larr; Torna alla lista
          </button>

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
                  {[
                    { label: 'Trades', test: selectedStrat.test_trades, real: selectedStrat.real_trades || null, suffix: '' },
                    { label: 'Win Rate', test: selectedStrat.test_win_pct, real: selectedStrat.real_win_pct, suffix: '%' },
                    { label: 'Payoff', test: selectedStrat.test_payoff, real: selectedStrat.real_payoff, suffix: '' },
                    { label: 'Expectancy', test: selectedStrat.test_expectancy, real: selectedStrat.real_expectancy, suffix: '', prefix: '$' },
                    { label: 'Max DD', test: selectedStrat.test_max_dd, real: selectedStrat.real_max_dd || null, suffix: '', prefix: '$' },
                    { label: 'Profit Factor', test: null, real: selectedStrat.real_profit_factor, suffix: '' },
                    { label: 'Recovery Factor', test: null, real: selectedStrat.real_recovery_factor, suffix: '' },
                    { label: 'Ret/DD', test: selectedStrat.test_ret_dd, real: selectedStrat.real_ret_dd || null, suffix: '', highlight: true },
                  ].map((row, i) => {
                    const testVal = row.test !== null && row.test !== undefined ? Number(row.test) : null
                    const realVal = row.real !== null && row.real !== undefined && Number(row.real) !== 0 ? Number(row.real) : null
                    const delta = testVal !== null && realVal !== null ? realVal - testVal : null
                    return (
                      <tr key={i} className={row.highlight ? 'bg-violet-50' : ''}>
                        <td className={`py-2 ${row.highlight ? 'font-semibold text-violet-700' : 'text-slate-700'}`}>{row.label}</td>
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

      {/* ===== ACCOUNTS ===== */}
      {tab === 'accounts' && (
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
              const ddd = Number(acc.daily_dd_pct || 0)
              const tdd = Number(acc.total_dd_pct || 0)
              const maxDdd = Number(acc.max_daily_loss_pct || 5)
              const maxTdd = Number(acc.max_total_loss_pct || 10)

              return (
                <div key={acc.id} className={`bg-white rounded-xl border p-4 ${synced ? 'border-slate-200' : 'border-dashed border-slate-300'}`}>
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      {synced && <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />}
                      <div>
                        <p className="font-semibold text-slate-900">{acc.name}</p>
                        <p className="text-xs text-slate-400">{acc.broker} &middot; {acc.currency} &middot; {fmtUsd(size)}</p>
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

                      {/* DD indicators */}
                      <div className="space-y-2">
                        <div>
                          <div className="flex justify-between text-[10px] mb-0.5">
                            <span className="text-slate-500">Daily DD</span>
                            <span className={ddd > 4 ? 'text-red-600 font-medium' : 'text-slate-600'}>{fmt(ddd, 1)}% / {maxDdd}%</span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${ddBarColor(ddd)}`}
                              style={{ width: `${Math.min((ddd / maxDdd) * 100, 100)}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-[10px] mb-0.5">
                            <span className="text-slate-500">Total DD</span>
                            <span className={tdd > 8 ? 'text-red-600 font-medium' : 'text-slate-600'}>{fmt(tdd, 1)}% / {maxTdd}%</span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${ddBarColor(tdd)}`}
                              style={{ width: `${Math.min((tdd / maxTdd) * 100, 100)}%` }} />
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
