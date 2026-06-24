'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import QuantNav from '../quant-nav'

type Variant = {
  id: string
  strategy_id: string
  base_magic: number
  variant_label: string
  deploy_magic: number | null
  entry_hour: number | null
  atr_tp_coef: number | null
  est_net: number | null
  est_pf: number | null
  est_mc95_dd: number | null
  result_source: string | null
  status: string | null
  assigned_account_id: string | null
  notes: string | null
}
type Account = { id: string; name: string; status: string }
type Strat = { id: string; magic: number | null; name: string | null }

function fmt(n: number | null | undefined, d = 0): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: d })
}
function statusBadge(s: string | null): string {
  switch (s) {
    case 'active': return 'bg-green-100 text-green-700'
    case 'proposed': return 'bg-amber-100 text-amber-700'
    case 'retired': return 'bg-slate-100 text-slate-500'
    default: return 'bg-slate-100 text-slate-500'
  }
}

export default function StatoMagicPage() {
  const [variants, setVariants] = useState<Variant[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [strats, setStrats] = useState<Strat[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = createClient()
    const [v, a, s] = await Promise.all([
      supabase.from('qel_strategy_variants').select('*').order('base_magic').order('deploy_magic'),
      supabase.from('qel_accounts').select('id, name, status'),
      supabase.from('qel_strategies').select('id, magic, name'),
    ])
    setVariants((v.data as Variant[]) || [])
    setAccounts((a.data as Account[]) || [])
    setStrats((s.data as Strat[]) || [])
    setLoading(false)
  }

  if (loading) return <p className="text-slate-500 p-4">Caricamento...</p>

  const accById: Record<string, Account> = {}
  accounts.forEach(a => { accById[a.id] = a })
  const stratByMagic: Record<number, Strat> = {}
  strats.forEach(s => { if (s.magic != null) stratByMagic[s.magic] = s })

  // raggruppa per base_magic
  const groups: Record<number, Variant[]> = {}
  variants.forEach(v => { (groups[v.base_magic] = groups[v.base_magic] || []).push(v) })

  // flag compliance: stessa config identica (magic+ora+ATR) su piu conti attivi
  function isDuplicateConfig(v: Variant, list: Variant[]): boolean {
    if (v.status !== 'active') return false
    return list.some(o =>
      o.id !== v.id && o.status === 'active' &&
      o.deploy_magic === v.deploy_magic && o.entry_hour === v.entry_hour && Number(o.atr_tp_coef) === Number(v.atr_tp_coef)
    )
  }

  const baseMagics = Object.keys(groups).map(Number).sort((a, b) => a - b)

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <QuantNav />
        <div className="mt-1">
          <h1 className="text-2xl font-bold text-slate-900">Stato Magic & Varianti</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Mappa magic→conto e catalogo varianti (ora ingresso, ATR TP) per la differenziazione compliance FTMO. Il magic è interno all&apos;EA: la differenziazione reale dei trade è su ora/ATR.
          </p>
        </div>
      </div>

      {baseMagics.length === 0 && (
        <div className="bg-slate-50 rounded-xl border border-dashed border-slate-300 p-8 text-center">
          <p className="text-sm text-slate-500">Nessuna variante in catalogo.</p>
        </div>
      )}

      {baseMagics.map(bm => {
        const list = groups[bm]
        const strat = stratByMagic[bm]
        return (
          <div key={bm} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">#{bm} · {strat?.name || 'strategia'}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 text-left bg-slate-50">
                  <th className="font-medium px-3 py-1.5">Variante</th>
                  <th className="font-medium px-3 py-1.5 text-right">Magic</th>
                  <th className="font-medium px-3 py-1.5 text-right">Ora</th>
                  <th className="font-medium px-3 py-1.5 text-right">ATR TP</th>
                  <th className="font-medium px-3 py-1.5">Conto</th>
                  <th className="font-medium px-3 py-1.5 text-right">MC95 stim.</th>
                  <th className="font-medium px-3 py-1.5">Fonte</th>
                  <th className="font-medium px-3 py-1.5">Stato</th>
                </tr></thead>
                <tbody>
                  {list.map(v => {
                    const dup = isDuplicateConfig(v, list)
                    const acc = v.assigned_account_id ? accById[v.assigned_account_id] : null
                    return (
                      <tr key={v.id} className={`border-t border-slate-100 ${dup ? 'bg-red-50' : ''}`}>
                        <td className="px-3 py-1.5 text-slate-700">
                          {v.variant_label}
                          {dup && <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-red-200 text-red-700" title="Config identica su piu conti attivi: rischio compliance FTMO">⚠ dup</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-700">{v.deploy_magic ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-600">{v.entry_hour ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-600">{v.atr_tp_coef != null ? fmt(v.atr_tp_coef, 1) : '—'}</td>
                        <td className="px-3 py-1.5 text-slate-600">{acc ? acc.name : <span className="text-slate-300">non assegnata</span>}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-600">{v.est_mc95_dd != null ? `$${fmt(v.est_mc95_dd)}` : '—'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{v.result_source || '—'}</td>
                        <td className="px-3 py-1.5"><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusBadge(v.status)}`}>{v.status || '—'}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
        <p className="text-[11px] text-slate-600">
          <span className="font-semibold">Compliance FTMO:</span> FTMO rileva il copy confrontando il pattern dei trade (orario, prezzo, size), non il magic. La riga <span className="px-1 rounded bg-red-100 text-red-700">⚠ dup</span> segnala config identiche (stesso magic, ora e ATR) su più conti attivi: vanno differenziate su ATR e/o ora.
        </p>
        <p className="text-[10px] text-slate-400 mt-2">Fonte: qel_strategy_variants. I risultati stimati si popolano dai backtest SQX delle varianti.</p>
      </div>
    </div>
  )
}
