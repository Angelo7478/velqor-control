'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import QuantNav from '../quant-nav'

type Sizing = {
  portfolio_id: string
  strategy_id: string
  current_lots: number | null
  recommended_lots: number | null
  lots_change_pct: number | null
  status: string | null
  dd_budget_usd: number | null
  dd_budget_pct: number | null
  correlation_cluster: string | null
  created_at: string
}
type Portfolio = {
  id: string
  account_id: string
  name: string
  equity_base: number | null
  optimization_result: Record<string, unknown> | null
  last_optimization_at: string | null
}
type Account = { id: string; name: string; account_size: number | null; currency: string | null; status: string }
type Strat = { id: string; magic: number | null; name: string | null }

function fmtLots(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// Spia per-conto. Classi Tailwind letterali (no costruzione dinamica, sennò il purge le rimuove).
function spia(status: string | null): { dot: string; badge: string; label: string } {
  const s = (status || '').toUpperCase()
  if (s.includes('RIDURRE') || s.includes('STOP') || s.includes('BREACH'))
    return { dot: 'bg-red-500', badge: 'bg-red-100 text-red-700', label: status || 'Ridurre' }
  if (s.includes('RIDUCI') || s.includes('ATTENZIONE') || s.includes('WARN'))
    return { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700', label: status || 'Attenzione' }
  if (s.includes('OK'))
    return { dot: 'bg-green-500', badge: 'bg-green-100 text-green-700', label: status || 'OK' }
  return { dot: 'bg-slate-300', badge: 'bg-slate-100 text-slate-500', label: status || 'n/d' }
}

function stratBadge(status: string | null): string {
  const s = (status || '').toLowerCase()
  if (s === 'ok') return 'bg-green-100 text-green-700'
  if (s === 'riduci') return 'bg-amber-100 text-amber-700'
  if (s === 'stop') return 'bg-red-100 text-red-700'
  if (s === 'incrementa') return 'bg-blue-100 text-blue-700'
  return 'bg-slate-100 text-slate-500'
}

export default function SizingStatusPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [sizing, setSizing] = useState<Sizing[]>([])
  const [strats, setStrats] = useState<Strat[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)

  useEffect(() => { load() }, [])
  useEffect(() => { const i = setInterval(load, 60000); return () => clearInterval(i) }, [])

  async function load() {
    const supabase = createClient()
    const [p, a, s, st] = await Promise.all([
      supabase.from('qel_portfolios').select('id, account_id, name, equity_base, optimization_result, last_optimization_at').eq('is_active', true),
      supabase.from('qel_accounts').select('id, name, account_size, currency, status'),
      supabase.from('qel_strategy_sizing').select('portfolio_id, strategy_id, current_lots, recommended_lots, lots_change_pct, status, dd_budget_usd, dd_budget_pct, correlation_cluster, created_at').order('created_at', { ascending: false }),
      supabase.from('qel_strategies').select('id, magic, name'),
    ])
    setPortfolios((p.data as Portfolio[]) || [])
    setAccounts((a.data as Account[]) || [])
    setSizing((s.data as Sizing[]) || [])
    setStrats((st.data as Strat[]) || [])
    setLoading(false)
  }

  async function refreshBenchmarks() {
    setRefreshing(true); setRefreshMsg(null)
    const supabase = createClient()
    const { data, error } = await supabase.functions.invoke('refresh-benchmarks')
    if (error) {
      setRefreshMsg('Errore aggiornamento: ' + error.message)
    } else {
      const reg = (data as { regime?: string } | null)?.regime
      setRefreshMsg(`Benchmark aggiornati · regime: ${reg ?? '—'}`)
      await load()
    }
    setRefreshing(false)
  }

  if (loading) return <p className="text-slate-500 p-4">Caricamento...</p>

  const accById: Record<string, Account> = {}
  accounts.forEach(a => { accById[a.id] = a })
  const stratById: Record<string, Strat> = {}
  strats.forEach(s => { stratById[s.id] = s })

  // Tieni solo l'ultima riga per (portfolio, strategia) — sizing è già ordinato per created_at desc
  const latest: Record<string, Sizing> = {}
  for (const row of sizing) {
    const k = `${row.portfolio_id}|${row.strategy_id}`
    if (!latest[k]) latest[k] = row
  }
  const byPortfolio: Record<string, Sizing[]> = {}
  for (const row of Object.values(latest)) {
    if (!byPortfolio[row.portfolio_id]) byPortfolio[row.portfolio_id] = []
    byPortfolio[row.portfolio_id].push(row)
  }

  const shown = portfolios.filter(p => p.optimization_result || (byPortfolio[p.id] && byPortfolio[p.id].length))

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <QuantNav />
        <div className="mt-1 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Stato Position Sizing</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Spia per conto: rischio MC95 aggregato attuale vs consigliato, modulato dal regime dei sottostanti. {shown.length} portafogli monitorati.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={refreshBenchmarks}
              disabled={refreshing}
              className="px-3 py-2 text-sm rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              title="Scarica i prezzi aggiornati (Yahoo) e ricalcola il regime di mercato"
            >
              {refreshing ? 'Aggiornamento…' : '↻ Aggiorna regime'}
            </button>
            {refreshMsg && <span className="text-[11px] text-slate-500 max-w-[280px] text-right">{refreshMsg}</span>}
          </div>
        </div>
      </div>

      {shown.length === 0 && (
        <div className="bg-slate-50 rounded-xl border border-dashed border-slate-300 p-8 text-center">
          <p className="text-sm text-slate-500">Nessuna run di sizing registrata. Lancia un calcolo dall&apos;engine di sizing.</p>
        </div>
      )}

      <div className="space-y-3">
        {shown.map(p => {
          const acc = accById[p.account_id]
          const opt = (p.optimization_result || {}) as Record<string, unknown>
          const sp = spia(typeof opt.status === 'string' ? opt.status : null)
          const rows = (byPortfolio[p.id] || []).slice().sort((a, b) => (Number(b.dd_budget_pct) || 0) - (Number(a.dd_budget_pct) || 0))
          const curr = opt.mc95_current_pct as number | undefined
          const rec = opt.mc95_recommended_pct as number | undefined
          const target = opt.mc95_target_operativo_pct as number | undefined
          return (
            <div key={p.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3.5 h-3.5 rounded-full ${sp.dot}`} title={`Sizing: ${sp.label}`} />
                    <div>
                      <p className="font-semibold text-slate-900">{acc?.name || p.name}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-slate-400">
                        <span>Capitale: <span className="text-slate-600">{acc ? `${Number(acc.account_size).toLocaleString('it-IT')} ${acc.currency || ''}` : '—'}</span></span>
                        {typeof opt.regime === 'string' && <span>Regime: <span className="text-slate-600">{opt.regime}</span></span>}
                        {typeof opt.model === 'string' && <span>Modello: <span className="text-slate-600">{opt.model}</span></span>}
                      </div>
                    </div>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded ${sp.badge}`}>{sp.label}</span>
                </div>

                {(curr !== undefined || rec !== undefined) && (
                  <div className="flex flex-wrap gap-6 mt-3 pt-3 border-t border-slate-100">
                    <div>
                      <p className="text-[10px] text-slate-400">MC95 attuale</p>
                      <p className={`text-sm font-semibold ${Number(curr) >= 9 ? 'text-red-600' : Number(curr) >= 7 ? 'text-amber-600' : 'text-slate-700'}`}>{curr ?? '—'}%</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400">Consigliato</p>
                      <p className="text-sm font-semibold text-green-700">{rec ?? '—'}%</p>
                    </div>
                    {target !== undefined && (
                      <div>
                        <p className="text-[10px] text-slate-400">Target operativo</p>
                        <p className="text-sm font-semibold text-slate-700">{target}%</p>
                      </div>
                    )}
                    {typeof opt.azione === 'string' && (
                      <div className="flex-1 min-w-[180px]">
                        <p className="text-[10px] text-slate-400">Azione</p>
                        <p className="text-sm text-slate-700">{opt.azione}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {rows.length > 0 && (
                <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 text-left">
                        <th className="font-medium pb-1">Strategia</th>
                        <th className="font-medium pb-1 text-right">Attuale</th>
                        <th className="font-medium pb-1 text-right">Consigliato</th>
                        <th className="font-medium pb-1 text-right">Var</th>
                        <th className="font-medium pb-1 text-right">MC95</th>
                        <th className="font-medium pb-1 text-right">Stato</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => {
                        const s = stratById[r.strategy_id]
                        const chg = r.lots_change_pct
                        return (
                          <tr key={r.strategy_id} className="border-t border-slate-100">
                            <td className="py-1.5 text-slate-700">
                              {s ? <>#{s.magic} <span className="text-slate-500">{s.name}</span></> : '—'}
                              {r.correlation_cluster && <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-slate-200 text-slate-500">{r.correlation_cluster}</span>}
                            </td>
                            <td className="py-1.5 text-right font-mono text-slate-600">{fmtLots(r.current_lots)}</td>
                            <td className="py-1.5 text-right font-mono font-semibold text-slate-800">{fmtLots(r.recommended_lots)}</td>
                            <td className={`py-1.5 text-right font-mono ${Number(chg) < 0 ? 'text-red-600' : Number(chg) > 0 ? 'text-green-600' : 'text-slate-400'}`}>
                              {chg === null || chg === undefined ? '—' : `${chg > 0 ? '+' : ''}${chg}%`}
                            </td>
                            <td className="py-1.5 text-right text-slate-500">{r.dd_budget_pct != null ? `${r.dd_budget_pct}%` : '—'}</td>
                            <td className="py-1.5 text-right"><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${stratBadge(r.status)}`}>{r.status || '—'}</span></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {p.last_optimization_at && (
                    <p className="text-[10px] text-slate-400 mt-2">
                      Ultimo calcolo: {new Date(p.last_optimization_at).toLocaleString('it-IT')}
                      {typeof opt.as_of === 'string' ? ` · regime as-of ${opt.as_of}` : ''}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Legenda spia sizing</h3>
        <div className="space-y-1 text-[11px] text-slate-600">
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-green-500" /> OK — entro il budget di rischio</div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Attenzione — vicino al limite operativo</div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-red-500" /> Ridurre — rischio MC95 al limite FTMO, lotti da tagliare</div>
        </div>
        <p className="text-[10px] text-slate-400 mt-2">Fonte: qel_portfolios.optimization_result e qel_strategy_sizing. Modello risk_budget = DD budget / MC95, modulato dal regime 4Q dei sottostanti.</p>
      </div>
    </div>
  )
}
