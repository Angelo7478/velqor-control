'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Strat = {
  id: string
  magic: number | null
  name: string
  asset_group: string | null
  direction: string | null
  strategy_style: string | null
  status: string
  include_in_portfolio: boolean | null
  test_mc95_dd: number | null
  test_max_open_dd: number | null
  test_ret_dd: number | null
  test_profit_factor: number | null
  real_trades: number | null
  real_avg_per_lot: number | null
  real_win_pct: number | null
  real_profit_factor: number | null
}

type Account = { id: string; name: string; account_size: number | null; currency: string | null; max_daily_loss_pct: number | null; max_total_loss_pct: number | null }

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export default function PortfolioBuilderPage() {
  const [strats, setStrats] = useState<Strat[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [equity, setEquity] = useState(100000)
  const [ddBudget, setDdBudget] = useState(6) // % MC95 aggregato target
  const [acctId, setAcctId] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = createClient()
    const [sRes, aRes] = await Promise.all([
      supabase.from('qel_strategies')
        .select('id,magic,name,asset_group,direction,strategy_style,status,include_in_portfolio,test_mc95_dd,test_max_open_dd,test_ret_dd,test_profit_factor,real_trades,real_avg_per_lot,real_win_pct,real_profit_factor')
        .in('status', ['active', 'testing']).order('magic'),
      supabase.from('qel_accounts').select('id,name,account_size,currency,max_daily_loss_pct,max_total_loss_pct').eq('status', 'active').order('account_size', { ascending: false }),
    ])
    const list = (sRes.data as Strat[]) || []
    setStrats(list)
    setAccounts((aRes.data as Account[]) || [])
    setSel(new Set(list.filter(s => s.include_in_portfolio).map(s => s.id)))
    setLoading(false)
  }

  function toggle(id: string) {
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function pickAccount(id: string) {
    setAcctId(id)
    const a = accounts.find(x => x.id === id)
    if (a?.account_size) setEquity(Number(a.account_size))
  }

  // Sizing equal-risk: budget MC95 totale = ddBudget% dell'equity, diviso tra le N selezionate.
  const rows = useMemo(() => {
    const selected = strats.filter(s => sel.has(s.id) && (s.test_mc95_dd || 0) > 0)
    const budgetUsd = (ddBudget / 100) * equity
    const perStrat = selected.length > 0 ? budgetUsd / selected.length : 0
    return selected.map(s => {
      const mc95 = Number(s.test_mc95_dd) || 0
      const lots = mc95 > 0 ? perStrat / mc95 : 0
      const lotsR = Math.max(0.01, Math.round(lots * 100) / 100)
      const mc95Pct = (lotsR * mc95 / equity) * 100
      const mae = Number(s.test_max_open_dd) || 0
      const dayFloat = s.direction === 'short' ? 0 : lotsR * mae // worst-day: solo long sommano
      return { s, lots: lotsR, mc95Pct, dayFloat }
    })
  }, [strats, sel, equity, ddBudget])

  const aggMc95 = rows.reduce((sum, r) => sum + r.mc95Pct, 0)
  const worstDayPct = (rows.reduce((sum, r) => sum + r.dayFloat, 0) / equity) * 100
  const acct = accounts.find(a => a.id === acctId)

  if (loading) return <div className="text-slate-500 p-4">Caricamento…</div>

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Portfolio Builder</h1>
        <p className="text-sm text-slate-500">Seleziona le <b>strategie</b> (non i conti). Ogni strategia porta i suoi dati per-lotto: backtest (MC95) e live <b>deduplicato</b> (un campione per segnale). Il sizing si applica al conto/equity target.</p>
      </div>

      {/* Controlli target */}
      <div className="flex flex-wrap items-end gap-4 bg-white border border-slate-200 rounded-xl p-4">
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-1">Conto target</span>
          <select value={acctId} onChange={e => pickAccount(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="">— manuale —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({fmt(a.account_size, 0)} {a.currency})</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-1">Equity</span>
          <input type="number" value={equity} onChange={e => setEquity(Number(e.target.value) || 0)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-32" />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-1">Budget MC95 aggregato: <b>{ddBudget}%</b></span>
          <input type="range" min={2} max={9} step={0.5} value={ddBudget} onChange={e => setDdBudget(Number(e.target.value))} className="w-48" />
        </label>
        <div className="ml-auto text-sm flex gap-6">
          <span>MC95 aggregato <b className={aggMc95 > (acct?.max_total_loss_pct || 10) ? 'text-red-600' : 'text-slate-900'}>{fmt(aggMc95, 1)}%</b> <span className="text-xs text-slate-400">/ {fmt(acct?.max_total_loss_pct ?? 10, 0)}%</span></span>
          <span>Worst-day floating <b className={worstDayPct > (acct?.max_daily_loss_pct || 5) ? 'text-red-600' : 'text-slate-900'}>{fmt(worstDayPct, 2)}%</b> <span className="text-xs text-slate-400">/ {fmt(acct?.max_daily_loss_pct ?? 5, 0)}%</span></span>
        </div>
      </div>

      {/* Tabella strategie */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
              <th className="px-3 py-2"></th>
              <th className="px-2 py-2">Magic</th>
              <th className="px-2 py-2">Strategia</th>
              <th className="px-2 py-2">Stile</th>
              <th className="px-2 py-2 text-right">MC95/lot</th>
              <th className="px-2 py-2 text-right">Backtest R/DD · PF</th>
              <th className="px-2 py-2 text-right">Live: segnali · avg/lot · PF</th>
              <th className="px-2 py-2 text-right">Lotti</th>
              <th className="px-2 py-2 text-right">MC95 %</th>
            </tr>
          </thead>
          <tbody>
            {strats.map(s => {
              const r = rows.find(x => x.s.id === s.id)
              const on = sel.has(s.id)
              return (
                <tr key={s.id} className={`border-b border-slate-50 ${on ? '' : 'opacity-50'}`}>
                  <td className="px-3 py-2"><input type="checkbox" checked={on} onChange={() => toggle(s.id)} /></td>
                  <td className="px-2 py-2 font-mono text-slate-700">{s.magic}</td>
                  <td className="px-2 py-2 text-slate-900">{s.name} <span className={`text-xs ${s.direction === 'short' ? 'text-red-500' : 'text-slate-400'}`}>{s.direction}</span></td>
                  <td className="px-2 py-2 text-xs text-slate-500">{s.strategy_style}</td>
                  <td className="px-2 py-2 text-right text-slate-600">{fmt(s.test_mc95_dd, 0)}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{fmt(s.test_ret_dd, 1)} · {fmt(s.test_profit_factor, 2)}</td>
                  <td className="px-2 py-2 text-right text-slate-500">
                    {s.real_trades ? <>{s.real_trades} · {fmt(s.real_avg_per_lot, 1)} · {fmt(s.real_profit_factor, 2)}</> : <span className="text-slate-300">no live</span>}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold text-blue-800">{r ? fmt(r.lots, 2) : '—'}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{r ? fmt(r.mc95Pct, 2) + '%' : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Sizing equal-risk: budget MC95 = {ddBudget}% dell&apos;equity diviso tra le {rows.length} selezionate, lotti = budget / MC95-per-lotto. Il worst-day floating somma (lotti × MAE) delle sole long. Il live è deduplicato (vista v_strategy_live).</p>
    </div>
  )
}
