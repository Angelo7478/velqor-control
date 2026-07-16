'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useUI } from '@/stores/ui'

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
type Account = { id: string; name: string; status: string; account_size: number | null }
type Strat = { id: string; magic: number | null; name: string | null }
type Portfolio = { id: string; account_id: string }
type Deploy = {
  id: string
  portfolio_id: string
  is_active: boolean | null
  final_lots: number | null
  variant_id: string | null
  deploy_magic: number | null
  qel_strategies: { magic: number | null; name: string | null } | null
}

function fmt(n: number | null | undefined, d = 0): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: d })
}
function statusBadge(s: string | null): string {
  switch (s) {
    case 'active': return 'bg-green-100 text-green-700'
    case 'assigned': return 'bg-blue-100 text-blue-700'
    case 'tested': return 'bg-violet-100 text-violet-700'
    case 'proposed': return 'bg-amber-100 text-amber-700'
    case 'superseded': return 'bg-slate-100 text-slate-400 line-through'
    case 'retired': return 'bg-slate-100 text-slate-500'
    default: return 'bg-slate-100 text-slate-500'
  }
}

export default function StatoMagicPage() {
  const marketType = useUI((s) => s.marketType)
  const [variants, setVariants] = useState<Variant[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [strats, setStrats] = useState<Strat[]>([])
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [deploys, setDeploys] = useState<Deploy[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    load(() => cancelled)
    return () => { cancelled = true }
  }, [marketType])

  async function load(isCancelled: () => boolean) {
    setLoading(true)
    try {
      const supabase = createClient()
      const [v, a, s, pf, dp] = await Promise.all([
        supabase.from('qel_strategy_variants').select('*').order('base_magic').order('deploy_magic'),
        supabase.from('qel_accounts').select('id, name, status, account_size').eq('market_type', marketType),
        supabase.from('qel_strategies').select('id, magic, name').eq('market_type', marketType),
        supabase.from('qel_portfolios').select('id, account_id'),
        supabase.from('qel_portfolio_strategies').select('id,portfolio_id,is_active,final_lots,variant_id,deploy_magic,qel_strategies(magic,name)'),
      ])
      if (isCancelled()) return
      setVariants((v.data as Variant[]) || [])
      setAccounts((a.data as Account[]) || [])
      setStrats((s.data as Strat[]) || [])
      setPortfolios((pf.data as Portfolio[]) || [])
      setDeploys((dp.data as unknown as Deploy[]) || [])
    } finally {
      // Solo il load ancora vivo puo' spegnere il gate: un load superato lascia
      // il controllo a quello che lo ha rimpiazzato.
      if (!isCancelled()) setLoading(false)
    }
  }

  if (loading) return <p className="text-slate-500 p-4">Caricamento...</p>

  const accById: Record<string, Account> = {}
  accounts.forEach(a => { accById[a.id] = a })
  const stratByMagic: Record<number, Strat> = {}
  strats.forEach(s => { if (s.magic != null) stratByMagic[s.magic] = s })

  // Cascata sul macro: qel_strategy_variants non ha market_type, ma il suo base_magic punta a
  // una strategia che ce l'ha. Senza questo filtro il catalogo renderizzava TUTTE le varianti
  // -> su FUTURE comparivano quelle FTMO. Le strategie sono gia' filtrate: basta tenere le
  // varianti il cui base_magic esiste nel set corrente.
  const macroVariants = variants.filter(v => stratByMagic[v.base_magic] != null)

  // raggruppa per base_magic
  const groups: Record<number, Variant[]> = {}
  macroVariants.forEach(v => { (groups[v.base_magic] = groups[v.base_magic] || []).push(v) })

  // flag compliance: stessa config identica (magic+ora+ATR) su piu conti attivi
  function isDuplicateConfig(v: Variant, list: Variant[]): boolean {
    if (v.status !== 'active') return false
    return list.some(o =>
      o.id !== v.id && o.status === 'active' &&
      o.deploy_magic === v.deploy_magic && o.entry_hour === v.entry_hour && Number(o.atr_tp_coef) === Number(v.atr_tp_coef)
    )
  }

  const baseMagics = Object.keys(groups).map(Number).sort((a, b) => a - b)

  // ---- Deploy reale per conto (fonte: qel_portfolio_strategies) ----
  const varById: Record<string, Variant> = {}
  variants.forEach(v => { varById[v.id] = v })
  const pfById: Record<string, Portfolio> = {}
  portfolios.forEach(p => { pfById[p.id] = p })
  type DeployRow = { base: number; stratName: string; accName: string; accSize: number; deployMagic: number | null; version: string; variantId: string | null; lots: number | null }
  const deployRows: DeployRow[] = []
  for (const d of deploys) {
    if (d.is_active === false || d.deploy_magic == null) continue
    const pf = pfById[d.portfolio_id]; if (!pf) continue
    const acc = accById[pf.account_id]; if (!acc || acc.status === 'inactive' || acc.status === 'breached') continue
    const base = d.qel_strategies?.magic; if (base == null) continue
    deployRows.push({
      base, stratName: d.qel_strategies?.name || '',
      accName: acc.name, accSize: Number(acc.account_size) || 0,
      deployMagic: d.deploy_magic,
      version: d.variant_id ? (varById[d.variant_id]?.variant_label || 'variante') : 'Originale',
      variantId: d.variant_id, lots: d.final_lots,
    })
  }
  deployRows.sort((a, b) => a.base - b.base || (a.deployMagic || 0) - (b.deployMagic || 0))
  // capitale per pattern (stessa versione = stesso pattern)
  const patternCap: Record<string, { cap: number; n: number }> = {}
  for (const r of deployRows) {
    const k = `${r.base}:${r.variantId ?? 'orig'}`
    patternCap[k] = { cap: (patternCap[k]?.cap || 0) + r.accSize, n: (patternCap[k]?.n || 0) + 1 }
  }
  const deployBases = [...new Set(deployRows.map(r => r.base))]

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <div className="mt-1">
          <h1 className="text-2xl font-bold text-slate-900">Stato Magic & Varianti</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Mappa magic→conto e catalogo varianti (ora ingresso, ATR TP) per la differenziazione compliance FTMO. Il magic è interno all&apos;EA: la differenziazione reale dei trade è su ora/ATR.
          </p>
        </div>
      </div>

      {/* Deploy reale per conto — fonte di verità qel_portfolio_strategies */}
      {deployRows.length > 0 && (
        <div className="bg-white rounded-xl border-2 border-blue-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">Deploy REALE per conto</span>
            <span className="text-xs text-slate-500">cosa gira adesso su ogni conto (fonte: composizione portafogli) · stessa versione su più conti = stesso pattern FTMO</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400 text-left bg-slate-50">
                <th className="font-medium px-3 py-1.5">Base</th>
                <th className="font-medium px-3 py-1.5">Strategia</th>
                <th className="font-medium px-3 py-1.5">Conto</th>
                <th className="font-medium px-3 py-1.5 text-right">Magic deploy</th>
                <th className="font-medium px-3 py-1.5">Versione</th>
                <th className="font-medium px-3 py-1.5 text-right">Lotti</th>
                <th className="font-medium px-3 py-1.5 text-right">Pattern condiviso</th>
              </tr></thead>
              <tbody>
                {deployBases.map(base => deployRows.filter(r => r.base === base).map((r, i, arr) => {
                  const pc = patternCap[`${r.base}:${r.variantId ?? 'orig'}`]
                  const capK = pc ? pc.cap / 1000 : 0
                  const capCls = pc && pc.cap >= 400000 ? 'text-red-600 font-semibold' : pc && pc.cap >= 350000 ? 'text-amber-600 font-semibold' : 'text-slate-500'
                  return (
                    <tr key={`${r.base}-${r.accName}-${r.deployMagic}`} className={`border-t ${i === 0 ? 'border-slate-200' : 'border-slate-50'}`}>
                      <td className="px-3 py-1.5 font-mono text-slate-700">{i === 0 ? r.base : ''}</td>
                      <td className="px-3 py-1.5 text-slate-700">{i === 0 ? r.stratName : ''}</td>
                      <td className="px-3 py-1.5 text-slate-600">{r.accName}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold text-slate-800">{r.deployMagic}</td>
                      <td className="px-3 py-1.5">{r.version === 'Originale'
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Originale</span>
                        : <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700" title={r.version}>{r.version.length > 26 ? r.version.slice(0, 26) + '…' : r.version}</span>}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-700">{r.lots != null ? Number(r.lots).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                      <td className={`px-3 py-1.5 text-right ${capCls}`} title={`capitale combinato dei conti con questa versione vs tetto FTMO $400k`}>{pc && pc.n > 1 ? `${pc.n} conti · $${capK.toFixed(0)}k${pc.cap >= 350000 ? ' ⚠' : ''}` : '—'}</td>
                    </tr>
                  )
                }))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h2 className="text-sm font-semibold text-slate-500 pt-2">Catalogo varianti</h2>

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
        <p className="text-[10px] text-slate-400 mt-2">Fonti: deploy reale da qel_portfolio_strategies (variant_id + deploy_magic, aggiornata a ogni configurazione conto); catalogo da qel_strategy_variants (le righe barrate sono assegnazioni superate). Il capitale per pattern conta i conti che girano la STESSA versione: ambra da $350k, rosso oltre $400k.</p>
      </div>
    </div>
  )
}
