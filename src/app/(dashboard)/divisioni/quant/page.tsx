'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelStrategy, QelAccount } from '@/types/database'
import { fmt, fmtUsd, timeAgo, statusBadge, groupColor, plColor, ddBarColor, fmtAlpha, alphaColor } from '@/lib/quant-utils'
import AccountDashboard from './account-dashboard'
import InfoTooltip from '@/components/ui/InfoTooltip'

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
  const [selectedAcc, setSelectedAcc] = useState<QelAccount | null>(null)
  const [benchLoading, setBenchLoading] = useState(false)
  const [benchResult, setBenchResult] = useState<string | null>(null)

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
        await loadData()
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
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quant Engine</h1>
          <p className="text-sm text-slate-500 mt-1">
            Trading sistematico &middot; QuantEdgeLab &middot; {activeStrategies.length} strategie &middot; {syncedAccounts.length}/{accounts.length} conti sincronizzati
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/divisioni/quant/sizing"
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition"
          >
            Sizing Engine
          </a>
          <a
            href="/divisioni/quant/health"
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
          >
            Health
          </a>
          <a
            href="/divisioni/quant/scenarios"
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
          >
            Scenari
          </a>
          <a
            href="/divisioni/quant/builder"
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition"
          >
            Builder
          </a>
          <button
            onClick={refreshBenchmarks}
            disabled={benchLoading}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
          >
            {benchLoading ? 'Aggiornamento...' : 'Benchmark'}
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
