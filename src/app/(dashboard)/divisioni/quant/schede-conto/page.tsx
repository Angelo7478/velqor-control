'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Account = {
  id: string
  name: string
  login: string | null
  server: string | null
  account_size: number | null
  currency: string | null
  status: string
  challenge_phase: string | null
  max_daily_loss_pct: number | null
  max_total_loss_pct: number | null
  vps_name: string | null
}

type Strategy = {
  magic: number | null
  name: string
  asset_group: string | null
  direction: string | null
  strategy_style: string | null
  parameters: string | null
  test_mc95_dd: number | null
  test_max_open_dd: number | null
}

type PortStrat = {
  id: string
  portfolio_id: string
  is_active: boolean | null
  active_level: string | null
  lot_conservative: number | null
  lot_neutral: number | null
  lot_aggressive: number | null
  final_lots: number | null
  dd_budget_allocation_pct: number | null
  sizing_notes: string | null
  qel_strategies: Strategy | null
}

type Portfolio = {
  id: string
  account_id: string
  name: string
  max_dd_target_pct: number | null
  daily_dd_limit_pct: number | null
}

const LEVELS = ['conservative', 'neutral', 'aggressive'] as const
const LEVEL_LABEL: Record<string, string> = { conservative: 'Conservativo', neutral: 'Neutro', aggressive: 'Aggressivo' }

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export default function SchedeContoPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [strats, setStrats] = useState<PortStrat[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = createClient()
    const [accRes, pfRes, psRes] = await Promise.all([
      supabase.from('qel_accounts').select('id,name,login,server,account_size,currency,status,challenge_phase,max_daily_loss_pct,max_total_loss_pct,vps_name').neq('status', 'inactive').neq('status', 'breached').order('account_size', { ascending: false }),
      supabase.from('qel_portfolios').select('id,account_id,name,max_dd_target_pct,daily_dd_limit_pct'),
      supabase.from('qel_portfolio_strategies').select('id,portfolio_id,is_active,active_level,lot_conservative,lot_neutral,lot_aggressive,final_lots,dd_budget_allocation_pct,sizing_notes,qel_strategies(magic,name,asset_group,direction,strategy_style,parameters,test_mc95_dd,test_max_open_dd)'),
    ])
    setAccounts((accRes.data as Account[]) || [])
    setPortfolios((pfRes.data as Portfolio[]) || [])
    setStrats((psRes.data as unknown as PortStrat[]) || [])
    setLoading(false)
  }

  if (loading) return <div className="text-slate-500 p-4">Caricamento schede conto…</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Schede Conto</h1>
        <p className="text-sm text-slate-500">Composizione e sizing a 3 livelli per conto. La size <b>attiva</b> è evidenziata. Revisione mensile.</p>
      </div>

      {accounts.map(acc => {
        const pf = portfolios.find(p => p.account_id === acc.id)
        const rows = pf ? strats.filter(s => s.portfolio_id === pf.id) : []
        const activeLevel = rows[0]?.active_level || 'neutral'
        // MC95 aggregato al livello attivo
        const aggMc95 = rows.reduce((sum, r) => sum + (Number(r.dd_budget_allocation_pct) || 0), 0)
        // worst-day floating (long) al livello attivo
        const worstDay = rows.reduce((sum, r) => {
          const s = r.qel_strategies
          if (!s || s.direction === 'short') return sum
          const lot = Number((r as any)['lot_' + activeLevel]) || 0
          const mae = Number(s.test_max_open_dd) || 0
          return sum + lot * mae
        }, 0)
        const size = Number(acc.account_size) || 100000

        return (
          <div key={acc.id} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            {/* Header conto */}
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-x-6 gap-y-1">
              <div>
                <span className="font-semibold text-slate-900">{acc.name}</span>
                <span className="ml-2 text-xs text-slate-500">{acc.login} · {acc.server}</span>
              </div>
              <span className="text-sm text-slate-600">{fmt(acc.account_size, 0)} {acc.currency} · {acc.challenge_phase || '—'}</span>
              <span className="text-xs text-slate-500">Limiti: daily {fmt(acc.max_daily_loss_pct, 0)}% · totale {fmt(acc.max_total_loss_pct, 0)}%</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${acc.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>{acc.status}</span>
              <span className="ml-auto text-xs font-medium text-blue-700">Livello attivo: {LEVEL_LABEL[activeLevel]}</span>
            </div>

            {rows.length === 0 ? (
              <div className="p-4 text-sm text-slate-400">Nessuna composizione definita per questo conto.</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                        <th className="px-4 py-2">Magic</th>
                        <th className="px-2 py-2">Strategia</th>
                        <th className="px-2 py-2">Dir</th>
                        <th className="px-2 py-2 text-right">MC95/lot</th>
                        {LEVELS.map(l => (
                          <th key={l} className={`px-2 py-2 text-right ${l === activeLevel ? 'text-blue-700 font-semibold' : ''}`}>{LEVEL_LABEL[l]}</th>
                        ))}
                        <th className="px-2 py-2 text-right">MC95 %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.sort((a, b) => (a.qel_strategies?.magic || 0) - (b.qel_strategies?.magic || 0)).map(r => {
                        const s = r.qel_strategies
                        return (
                          <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                            <td className="px-4 py-2 font-mono text-slate-700">{s?.magic ?? '—'}</td>
                            <td className="px-2 py-2">
                              <div className="text-slate-900">{s?.name}</div>
                              <div className="text-xs text-slate-400">{s?.parameters}</div>
                            </td>
                            <td className="px-2 py-2"><span className={`text-xs ${s?.direction === 'short' ? 'text-red-600' : 'text-slate-600'}`}>{s?.direction}</span></td>
                            <td className="px-2 py-2 text-right text-slate-600">{fmt(s?.test_mc95_dd, 0)}</td>
                            {LEVELS.map(l => {
                              const v = Number((r as any)['lot_' + l])
                              const active = l === activeLevel
                              return (
                                <td key={l} className={`px-2 py-2 text-right ${active ? 'bg-blue-50 font-semibold text-blue-800' : 'text-slate-500'}`}>{fmt(v, 2)}</td>
                              )
                            })}
                            <td className="px-2 py-2 text-right text-slate-500">{fmt(r.dd_budget_allocation_pct, 2)}%</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Footer aggregati */}
                <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-x-8 gap-y-1 text-sm">
                  <span>MC95 aggregato <b>{fmt(aggMc95, 1)}%</b> <span className="text-xs text-slate-400">/ totale {fmt(acc.max_total_loss_pct, 0)}%</span></span>
                  <span>Worst-day floating <b>{fmt((worstDay / size) * 100, 2)}%</b> <span className="text-xs text-slate-400">/ daily {fmt(acc.max_daily_loss_pct, 0)}%</span></span>
                  <span className="text-xs text-slate-400 ml-auto self-center">3 size salvate · attiva = {LEVEL_LABEL[activeLevel]} · revisione mensile</span>
                </div>
              </>
            )}
          </div>
        )
      })}
      {accounts.length === 0 && <div className="text-slate-400">Nessun conto attivo.</div>}
    </div>
  )
}
