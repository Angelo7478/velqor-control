'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useUI } from '@/stores/ui'

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
  id: string
  magic: number | null
  name: string
  asset_group: string | null
  direction: string | null
  strategy_style: string | null
  parameters: string | null
  test_mc95_dd: number | null
  test_max_open_dd: number | null
  live_status: string | null
  real_trades: number | null
  real_profit_factor: number | null
  validation_target_trades: number | null
  validation_baseline_trades: number | null
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
  target_lots: Record<string, number> | null
  lots_applied: boolean | null
  variant_id: string | null
  deploy_magic: number | null
  qel_strategies: Strategy | null
}

type VariantInfo = { id: string; base_magic: number | null; variant_label: string | null }

type Portfolio = {
  id: string
  account_id: string
  name: string
  max_dd_target_pct: number | null
  daily_dd_limit_pct: number | null
  size_policy: string | null
}

const LEVELS = ['conservative', 'neutral', 'aggressive'] as const
const LEVEL_LABEL: Record<string, string> = { conservative: 'Conservativo', neutral: 'Neutro', aggressive: 'Aggressivo' }
const PF_FLOOR = 1.2 // PF live minimo per considerare una strategia "validata dai dati" (MASTER sez. 6.15)

// Stato validazione live di una strategia: progresso trade vs obiettivo + gate PF.
// I trade di VERSIONI PRECEDENTI (validation_baseline_trades) restano nelle statistiche
// ma non contano per la validazione della versione deployata (caso magic 6 H1 -> M15).
function validationOf(s: Strategy | null) {
  if (!s) return null
  const target = s.validation_target_trades ?? 40
  const baseline = s.validation_baseline_trades ?? 0
  const trades = Math.max(0, (s.real_trades ?? 0) - baseline)
  const pf = s.real_profit_factor // NB: con baseline > 0 il PF resta misto vecchia+nuova finche la nuova non domina il campione
  const pct = target > 0 ? Math.min(100, (trades / target) * 100) : 0
  const byData = trades >= target && pf != null && pf >= PF_FLOOR
  return { target, trades, pf, pct, byData, proven: s.live_status === 'proven', baseline }
}

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export default function SchedeContoPage() {
  const marketType = useUI((s) => s.marketType)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [strats, setStrats] = useState<PortStrat[]>([])
  const [variants, setVariants] = useState<Map<string, VariantInfo>>(new Map())
  const [liveLots, setLiveLots] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [marketType])

  async function load() {
    const supabase = createClient()
    const [accRes, pfRes, psRes, llRes, varRes] = await Promise.all([
      supabase.from('qel_accounts').select('id,name,login,server,account_size,currency,status,challenge_phase,max_daily_loss_pct,max_total_loss_pct,vps_name').eq('market_type', marketType).neq('status', 'inactive').neq('status', 'breached').order('account_size', { ascending: false }),
      supabase.from('qel_portfolios').select('id,account_id,name,max_dd_target_pct,daily_dd_limit_pct,size_policy'),
      supabase.from('qel_portfolio_strategies').select('id,portfolio_id,is_active,active_level,lot_conservative,lot_neutral,lot_aggressive,final_lots,dd_budget_allocation_pct,sizing_notes,target_lots,lots_applied,variant_id,deploy_magic,qel_strategies(id,magic,name,asset_group,direction,strategy_style,parameters,test_mc95_dd,test_max_open_dd,live_status,real_trades,real_profit_factor,validation_target_trades,validation_baseline_trades)'),
      supabase.from('v_account_strategy_live_lot').select('account_id,base_magic,last_lot'),
      supabase.from('qel_strategy_variants').select('id,base_magic,variant_label'),
    ])
    setAccounts((accRes.data as Account[]) || [])
    setPortfolios((pfRes.data as Portfolio[]) || [])
    setStrats((psRes.data as unknown as PortStrat[]) || [])
    const vm = new Map<string, VariantInfo>()
    for (const v of ((varRes.data as VariantInfo[]) || [])) vm.set(v.id, v)
    setVariants(vm)
    const ll = new Map<string, number>()
    for (const r of ((llRes.data as { account_id: string; base_magic: number; last_lot: number }[]) || [])) ll.set(`${r.account_id}:${r.base_magic}`, Number(r.last_lot))
    setLiveLots(ll)
    setLoading(false)
  }

  // Promozione manuale a proven: rimuove il haircut alla strategia OVUNQUE (globale). Conferma obbligatoria.
  async function promote(sid: string, name: string) {
    if (!window.confirm(`Promuovere "${name}" a validata (proven)?\n\nRimuove il haircut 0,7 su TUTTI i conti: la size sale alla piena.\nFallo solo se i trade live sono della versione DEPLOYATA (attenzione al caso magic 6 M15 vs H1).`)) return
    const supabase = createClient()
    const { error } = await supabase.from('qel_strategies').update({ live_status: 'proven' }).eq('id', sid)
    if (error) { alert('Errore promozione: ' + error.message); return }
    await load()
  }

  if (loading) return <div className="text-slate-500 p-4">Caricamento schede conto…</div>

  // ---- Aggregatore capitale per PATTERN (limite FTMO $400k) ----
  // FTMO conta il tetto sulle strategie tradate IDENTICHE: l'originale e ogni variante
  // sono pattern DIVERSI e contano separati. Raggruppo per (strategia, variante):
  // variant_id NULL = versione originale.
  const FTMO_CAP = 400000
  const capRows = (() => {
    const m = new Map<string, { magic: number; name: string; version: string; cap: number; accounts: string[] }>()
    for (const r of strats) {
      if (r.is_active === false) continue
      const s = r.qel_strategies; if (!s?.magic) continue
      const pf = portfolios.find(p => p.id === r.portfolio_id); if (!pf) continue
      const acc = accounts.find(a => a.id === pf.account_id); if (!acc) continue
      const key = `${s.magic}:${r.variant_id ?? 'orig'}`
      const version = r.variant_id ? (variants.get(r.variant_id)?.variant_label || 'Variante') : 'Originale'
      const e = m.get(key) || { magic: s.magic, name: s.name, version, cap: 0, accounts: [] }
      e.cap += Number(acc.account_size) || 0
      e.accounts.push(`${acc.name} (${r.deploy_magic ?? s.magic})`)
      m.set(key, e)
    }
    return [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => a.magic - b.magic || b.cap - a.cap)
  })()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Schede Conto</h1>
        <p className="text-sm text-slate-500">Composizione e sizing a 3 livelli per conto. La size <b>attiva</b> è evidenziata; le 3 colonne sono i lotti <b>attuali</b> in esecuzione. <b>Modalità</b> (badge in alto) = <span className="text-blue-700">Ridotta</span> (haircut 0,7 alle non validate) o <span className="text-amber-700">Piena</span>. Per ogni strategia una <b>barra di validazione</b> (trade live / obiettivo + PF): quando raggiunge l'obiettivo compare <b>Promuovi</b> (rimuove il haircut ovunque). Avvisi automatici: Piena con strategie non validate → valuta Ridotta; Ridotta con strategia ormai validata → puoi salire. <b>Target</b> = lotti da caricare (<span className="text-green-700">✓</span> applicati / <span className="text-amber-700">→</span> da aggiornare in MT5). Revisione mensile.</p>
      </div>

      {/* Aggregatore capitale per strategia — limite FTMO $400k */}
      {capRows.length > 0 && (
        <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <span className="font-semibold text-slate-900 text-sm">Capitale per pattern (strategia + variante) su tutti i conti</span>
            <span className="text-xs text-slate-500">limite FTMO ${ (FTMO_CAP/1000).toFixed(0) }k conteggiato sulle strategie tradate IDENTICHE: originale e ogni variante contano SEPARATE</span>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-2">Base</th><th className="px-2 py-2">Strategia</th><th className="px-2 py-2">Versione</th>
              <th className="px-2 py-2 text-right">Conti (magic)</th><th className="px-2 py-2 text-right">Capitale</th>
              <th className="px-2 py-2">Uso del limite $400k</th>
            </tr></thead>
            <tbody>
              {capRows.map(r => {
                const pct = Math.min(100, (r.cap / FTMO_CAP) * 100)
                const col = r.cap > FTMO_CAP ? 'bg-red-500' : r.cap >= 350000 ? 'bg-amber-500' : 'bg-green-500'
                return (
                  <tr key={r.key} className="border-b border-slate-50">
                    <td className="px-4 py-2 font-mono text-slate-700">{r.magic}</td>
                    <td className="px-2 py-2 text-slate-900">{r.name}</td>
                    <td className="px-2 py-2">{r.version === 'Originale'
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Originale</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700" title={r.version}>{r.version.length > 28 ? r.version.slice(0, 28) + '…' : r.version}</span>}</td>
                    <td className="px-2 py-2 text-right text-slate-600" title={r.accounts.join(', ')}>{r.accounts.length}</td>
                    <td className={`px-2 py-2 text-right font-medium ${r.cap > FTMO_CAP ? 'text-red-600' : 'text-slate-900'}`}>${(r.cap/1000).toFixed(0)}k{r.cap > FTMO_CAP && ' ⚠'}</td>
                    <td className="px-2 py-2"><div className="h-2 w-full max-w-[220px] rounded bg-slate-100 overflow-hidden"><div className={`h-full ${col}`} style={{ width: `${pct}%` }} /></div></td>
                  </tr>
                )
              })}
            </tbody>
          </table></div>
        </div>
      )}

      {accounts.map(acc => {
        const pf = portfolios.find(p => p.account_id === acc.id)
        const rows = pf ? strats.filter(s => s.portfolio_id === pf.id) : []
        const activeLevel = rows[0]?.active_level || 'neutral'
        const size = Number(acc.account_size) || 100000
        // Lotti operativi: final_lots (fonte di verità), fallback colonna livello
        const opLots = (r: PortStrat) => Number(r.final_lots) || Number((r as any)['lot_' + activeLevel]) || 0
        // MC95 aggregato ai lotti operativi (fallback dd_budget_allocation_pct se salvato)
        const aggMc95 = rows.reduce((sum, r) => {
          const computed = opLots(r) * (Number(r.qel_strategies?.test_mc95_dd) || 0) / size * 100
          return sum + (computed || Number(r.dd_budget_allocation_pct) || 0)
        }, 0)
        // worst-day floating (long) ai lotti operativi
        const worstDay = rows.reduce((sum, r) => {
          const s = r.qel_strategies
          if (!s || s.direction === 'short') return sum
          return sum + opLots(r) * (Number(s.test_max_open_dd) || 0)
        }, 0)
        // Modalità salvata del conto + advisory di validazione
        const policy: 'full' | 'reduced' = pf?.size_policy === 'full' ? 'full' : 'reduced'
        const trulyUnproven = rows.filter(r => { const v = validationOf(r.qel_strategies); return v && !v.proven && !v.byData })
        const promotable = rows.filter(r => { const v = validationOf(r.qel_strategies); return v && !v.proven && v.byData })

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
              <div className="ml-auto flex items-center gap-3">
                {rows.length > 0 && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${policy === 'full' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`} title={policy === 'full' ? 'Size Piena: haircut rimosso (tutte come validate)' : 'Size Ridotta: haircut 0,7 alle non validate (prudente)'}>Size {policy === 'full' ? 'Piena' : 'Ridotta'}</span>}
                <span className="text-xs font-medium text-blue-700">Livello attivo: {LEVEL_LABEL[activeLevel] ?? activeLevel.replace(/_/g, ' ')}</span>
              </div>
            </div>
            {/* Advisory di validazione */}
            {policy === 'full' && trulyUnproven.length > 0 && (
              <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
                ⚠ <b>Size Piena</b> ma {trulyUnproven.length}/{rows.length} strategie non ancora validate ({trulyUnproven.map(r => r.qel_strategies?.name).filter(Boolean).join(', ')}): stai dimensionando pieno su edge non ancora provati dal vivo. Valuta <b>Ridotta</b> (nel Builder), o attendi la validazione.
              </div>
            )}
            {policy === 'reduced' && promotable.length > 0 && (
              <div className="px-4 py-2 bg-green-50 border-b border-green-200 text-xs text-green-800">
                ✓ {promotable.length} strateg{promotable.length > 1 ? 'ie' : 'ia'} ha raggiunto l'obiettivo di validazione dai dati live ({promotable.map(r => { const v = validationOf(r.qel_strategies); return `${r.qel_strategies?.name} ${v?.trades}/${v?.target}` }).join(', ')}): puoi <b>promuoverla a proven</b> (bottone in tabella) e salire a Piena. Verifica prima che i trade live siano della versione deployata.
              </div>
            )}

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
                        <th className="px-2 py-2 text-right">Target (da caricare)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.sort((a, b) => (a.qel_strategies?.magic || 0) - (b.qel_strategies?.magic || 0)).map(r => {
                        const s = r.qel_strategies
                        const v = validationOf(s)
                        const variantLabel = r.variant_id ? (variants.get(r.variant_id)?.variant_label || 'Variante') : null
                        return (
                          <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                            <td className="px-4 py-2 font-mono text-slate-700" title={r.deploy_magic != null && r.deploy_magic !== s?.magic ? `base_magic ${s?.magic}` : undefined}>
                              {r.deploy_magic ?? s?.magic ?? '—'}
                              {r.deploy_magic != null && s?.magic != null && r.deploy_magic !== s.magic && <span className="text-[10px] text-slate-400 block leading-none">base {s.magic}</span>}
                            </td>
                            <td className="px-2 py-2">
                              <div className="text-slate-900">{s?.name} {variantLabel
                                ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 align-middle" title={variantLabel}>{variantLabel.length > 24 ? variantLabel.slice(0, 24) + '…' : variantLabel}</span>
                                : <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 align-middle">Originale</span>} {v?.proven
                                ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 align-middle">live ✓</span>
                                : v?.byData
                                  ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 align-middle">validata dai dati</span>
                                  : <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 align-middle">in maturazione · size ridotta</span>}
                                {v && !v.proven && v.byData && s && <button onClick={() => promote(s.id, s.name)} className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 align-middle">Promuovi</button>}</div>
                              {v && !v.proven && (
                                <div className="mt-1 flex items-center gap-2">
                                  <div className="h-1.5 w-24 rounded bg-slate-100 overflow-hidden"><div className={`h-full ${v.byData ? 'bg-amber-500' : 'bg-slate-400'}`} style={{ width: `${v.pct}%` }} /></div>
                                  <span className="text-[10px] text-slate-400">{v.trades}/{v.target} trade{v.baseline > 0 ? ` (da 0, ${v.baseline} della versione precedente esclusi)` : ''}{v.pf != null ? ` · PF ${fmt(v.pf, 2)}` : ' · no PF'}</span>
                                </div>
                              )}
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
                            <td className="px-2 py-2 text-right text-slate-500">{fmt((opLots(r) * (Number(s?.test_mc95_dd) || 0) / size * 100) || Number(r.dd_budget_allocation_pct) || null, 2)}%</td>
                            <td className="px-2 py-2 text-right">
                              {(() => {
                                const tgt = r.target_lots?.[activeLevel]
                                if (tgt == null) return <span className="text-slate-300">—</span>
                                const live = liveLots.get(`${acc.id}:${s?.magic}`)
                                const appliedLive = live != null && Math.abs(live - tgt) < 0.02
                                const applied = r.lots_applied === true || appliedLive
                                return applied
                                  ? <span className="text-green-700 font-semibold" title={appliedLive ? `live ${fmt(live, 2)} lotti` : 'segnato applicato'}>✓ {fmt(tgt, 2)}</span>
                                  : <span className="text-amber-700 font-semibold">→ {fmt(tgt, 2)}</span>
                              })()}
                            </td>
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
                  <span className="text-xs text-slate-400 ml-auto self-center">3 size salvate · attiva = {LEVEL_LABEL[activeLevel] ?? activeLevel.replace(/_/g, ' ')} · revisione mensile</span>
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
