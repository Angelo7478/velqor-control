'use client'

import { useEffect, useRef, useState } from 'react'
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

// Campione live DEDUPLICATO per segnale (vista v_strategy_live_by_id), chiave = magic DELLA STRATEGIA.
// Non base_magic: la magic 30 gira sul terminale col magic 3, e per base_magic risulterebbe a zero
// pur avendo 20 trade correttamente attribuiti (sdoppiamento per broker).
type LiveStats = { signals: number; profit_factor: number | null; avg_per_lot: number | null; first_signal: string | null; last_signal: string | null }

// Profilo del backtest per-lotto (vista v_strategy_test_profile), chiave = magic.
type TestProfile = { test_avg_per_trade: number | null; test_trades_per_month: number | null; months_to_validate: number | null; target_signals: number | null }

// CONFORMITA' LIVE-vs-TEST. Due assi, perche' rispondono a domande diverse e maturano a velocita' diverse.
//
// (a) FREQUENZA — quante operazioni al mese contro quelle attese. Contare eventi e' un processo di
//     Poisson: si giudica con POCHI dati. 15 segnali quando ne attendevi 3 e' gia' significativo.
//     E' il rilevatore di EA fuori spec: filtro orario spento, EOD mancante, giorni non filtrati.
//     E' il controllo che avrebbe beccato la magic 25 (lunedi 01:05) il primo giorno.
//
// (b) EDGE — P/L per lotto per operazione contro quello atteso. Matura LENTAMENTE: serve il target
//     completo (~100 operazioni) prima di dire qualcosa. La banda +/-20% e' il criterio di Duff:
//     dentro e' varianza normale, fuori — e sempre nello stesso verso — e' overfit o decadimento.
//     Sotto soglia si tace: un rosso su cinque trade non e' un allarme, e' rumore, e spegnerebbe
//     strategie sane.
const EDGE_BAND = 0.20        // tolleranza sul percorso atteso
const FREQ_BAND = 0.50        // la frequenza tollera piu' rumore (conteggi piccoli)
const MIN_N_EDGE = 0.5        // frazione del target sotto la quale l'edge non si giudica

type Conformity = {
  freqRatio: number | null; freqState: 'ok' | 'alta' | 'bassa' | 'muto'
  edgeRatio: number | null; edgeState: 'ok' | 'sotto' | 'sopra' | 'muto'
  months: number | null
}

function conformityOf(live: LiveStats | undefined, prof: TestProfile | undefined, target: number): Conformity {
  const out: Conformity = { freqRatio: null, freqState: 'muto', edgeRatio: null, edgeState: 'muto', months: prof?.months_to_validate ?? null }
  if (!live || !prof || !live.signals) return out

  // Frequenza: segnali al mese osservati vs attesi. Minimo mezzo mese di finestra per non
  // dividere per un intervallo troppo corto (2 segnali in un giorno darebbero 60/mese).
  if (live.first_signal && live.last_signal && prof.test_trades_per_month) {
    const giorni = (new Date(live.last_signal).getTime() - new Date(live.first_signal).getTime()) / 86400000
    const mesi = Math.max(giorni / 30.44, 0.5)
    const osservati = live.signals / mesi
    const attesi = Number(prof.test_trades_per_month)
    if (attesi > 0 && live.signals >= 4) {
      out.freqRatio = osservati / attesi
      out.freqState = out.freqRatio > 1 + FREQ_BAND ? 'alta' : out.freqRatio < 1 - FREQ_BAND ? 'bassa' : 'ok'
    }
  }

  // Edge: solo con meta' del campione bersaglio, altrimenti resta muto.
  const atteso = Number(prof.test_avg_per_trade ?? 0)
  if (live.avg_per_lot != null && atteso !== 0 && live.signals >= Math.max(20, target * MIN_N_EDGE)) {
    out.edgeRatio = Number(live.avg_per_lot) / atteso
    out.edgeState = out.edgeRatio < 1 - EDGE_BAND ? 'sotto' : out.edgeRatio > 1 + EDGE_BAND ? 'sopra' : 'ok'
  }
  return out
}

const LEVELS = ['conservative', 'neutral', 'aggressive'] as const
const LEVEL_LABEL: Record<string, string> = { conservative: 'Conservativo', neutral: 'Neutro', aggressive: 'Aggressivo' }
const PF_FLOOR = 1.2 // PF live minimo per considerare una strategia "validata dai dati" (MASTER sez. 6.15)

// Stato validazione live di una strategia: progresso segnali vs obiettivo + gate PF.
// I segnali di VERSIONI PRECEDENTI (validation_baseline_trades) restano nelle statistiche
// ma non contano per la validazione della versione deployata (caso magic 6 H1 -> M15).
//
// UNITA': si conta per SEGNALE (v_strategy_live), non per trade-conto. La stessa strategia su
// N conti prende lo STESSO segnale, quindi i campi grezzi qel_strategies.real_* contano N volte
// un solo evento di mercato e gonfiano il campione 3-4x (magic 23: 48 grezzi vs 15 segnali).
// L'obiettivo e' calcolato dal backtest a 1 lotto, che e' un flusso di SEGNALI: leggere il grezzo
// significava confrontare due unita' diverse e far sembrare pronta una strategia al terzo dei dati.
// Fallback ai campi grezzi solo se la vista non ha la riga (strategia 0-live): li' i due valori
// coincidono comunque, perche' senza segnali non c'e' nulla da deduplicare.
function validationOf(s: Strategy | null, live?: LiveStats) {
  if (!s) return null
  const target = s.validation_target_trades ?? 40
  const baseline = s.validation_baseline_trades ?? 0
  const signals = live?.signals ?? s.real_trades ?? 0
  const trades = Math.max(0, signals - baseline)
  const pf = live?.profit_factor ?? s.real_profit_factor // NB: con baseline > 0 il PF resta misto vecchia+nuova finche la nuova non domina il campione
  const pct = target > 0 ? Math.min(100, (trades / target) * 100) : 0
  const byData = trades >= target && pf != null && pf >= PF_FLOOR
  return { target, trades, pf, pct, byData, proven: s.live_status === 'proven', baseline, deduped: live != null }
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
  const [liveStats, setLiveStats] = useState<Map<number, LiveStats>>(new Map())
  const [testProf, setTestProf] = useState<Map<number, TestProfile>>(new Map())
  const [loading, setLoading] = useState(true)
  const reqIdRef = useRef(0)

  // Lo splash sta qui e non dentro load(): load() e' condivisa con promote(), che deve
  // aggiornare in place senza far sparire la pagina.
  useEffect(() => { setLoading(true); load() }, [marketType])

  async function load() {
    const my = ++reqIdRef.current
    const supabase = createClient()
    try {
      const [accRes, pfRes, psRes, llRes, varRes, lsRes, tpRes] = await Promise.all([
        supabase.from('qel_accounts').select('id,name,login,server,account_size,currency,status,challenge_phase,max_daily_loss_pct,max_total_loss_pct,vps_name').eq('market_type', marketType).neq('status', 'inactive').neq('status', 'breached').order('account_size', { ascending: false }),
        supabase.from('qel_portfolios').select('id,account_id,name,max_dd_target_pct,daily_dd_limit_pct,size_policy'),
        supabase.from('qel_portfolio_strategies').select('id,portfolio_id,is_active,active_level,lot_conservative,lot_neutral,lot_aggressive,final_lots,dd_budget_allocation_pct,sizing_notes,target_lots,lots_applied,variant_id,deploy_magic,qel_strategies(id,magic,name,asset_group,direction,strategy_style,parameters,test_mc95_dd,test_max_open_dd,live_status,real_trades,real_profit_factor,validation_target_trades,validation_baseline_trades)'),
        supabase.from('v_account_strategy_live_lot').select('account_id,base_magic,last_lot'),
        supabase.from('qel_strategy_variants').select('id,base_magic,variant_label'),
        supabase.from('v_strategy_live_by_id').select('magic,signals,profit_factor,avg_per_lot,first_signal,last_signal'),
        supabase.from('v_strategy_test_profile').select('magic,test_avg_per_trade,test_trades_per_month,months_to_validate,target_signals'),
      ])
      // Risposta di una macro gia' abbandonata: scartare, o atterra dopo la piu' recente.
      if (my !== reqIdRef.current) return
      setAccounts((accRes.data as Account[]) || [])
      setPortfolios((pfRes.data as Portfolio[]) || [])
      setStrats((psRes.data as unknown as PortStrat[]) || [])
      const vm = new Map<string, VariantInfo>()
      for (const v of ((varRes.data as VariantInfo[]) || [])) vm.set(v.id, v)
      setVariants(vm)
      const ll = new Map<string, number>()
      for (const r of ((llRes.data as { account_id: string; base_magic: number; last_lot: number }[]) || [])) ll.set(`${r.account_id}:${r.base_magic}`, Number(r.last_lot))
      setLiveLots(ll)
      const ls = new Map<number, LiveStats>()
      for (const r of ((lsRes.data as { magic: number; signals: number; profit_factor: number | null; avg_per_lot: number | null; first_signal: string | null; last_signal: string | null }[]) || [])) {
        ls.set(Number(r.magic), {
          signals: Number(r.signals),
          profit_factor: r.profit_factor == null ? null : Number(r.profit_factor),
          avg_per_lot: r.avg_per_lot == null ? null : Number(r.avg_per_lot),
          first_signal: r.first_signal, last_signal: r.last_signal,
        })
      }
      setLiveStats(ls)
      const tp = new Map<number, TestProfile>()
      for (const r of ((tpRes.data as (TestProfile & { magic: number })[]) || [])) tp.set(Number(r.magic), r)
      setTestProf(tp)
    } finally {
      if (my === reqIdRef.current) setLoading(false)
    }
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
        <p className="text-sm text-slate-500">Composizione e sizing a 3 livelli per conto. La size <b>attiva</b> è evidenziata; le 3 colonne sono i lotti <b>attuali</b> in esecuzione. <b>Modalità</b> (badge in alto) = <span className="text-blue-700">Ridotta</span> (haircut 0,7 alle non validate) o <span className="text-amber-700">Piena</span>. Per ogni strategia una <b>barra di validazione</b> (<b>segnali</b> live / obiettivo + PF): quando raggiunge l'obiettivo compare <b>Promuovi</b> (rimuove il haircut ovunque). I segnali sono <b>deduplicati</b>: la stessa strategia su piu&#39; conti prende lo stesso segnale e conta <b>una volta</b>, come l&#39;obiettivo, che viene dal backtest a 1 lotto. L&#39;obiettivo e i <b>mesi stimati</b> escono dalla stessa formula: quanto tempo serve per distinguere l&#39;edge dal rumore al 95% — un edge forte si dimostra in fretta, uno sottile ci mette anni. I badge di <b>conformita&#39;</b> confrontano il live col backtest: <span className="text-red-700">freq</span> (opera piu&#39;/meno del previsto — spia di EA fuori spec, affidabile subito) e <span className="text-red-700">edge</span> (rende meno/piu&#39; dell&#39;atteso, banda ±20%, mostrato solo a meta&#39; obiettivo raggiunto: sotto, sarebbe rumore). Avvisi automatici: Piena con strategie non validate → valuta Ridotta; Ridotta con strategia ormai validata → puoi salire. <b>Target</b> = lotti da caricare (<span className="text-green-700">✓</span> applicati / <span className="text-amber-700">→</span> da aggiornare in MT5). Revisione mensile.</p>
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
        const trulyUnproven = rows.filter(r => { const v = validationOf(r.qel_strategies, liveStats.get(Number(r.qel_strategies?.magic))); return v && !v.proven && !v.byData })
        const promotable = rows.filter(r => { const v = validationOf(r.qel_strategies, liveStats.get(Number(r.qel_strategies?.magic))); return v && !v.proven && v.byData })

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
                ✓ {promotable.length} strateg{promotable.length > 1 ? 'ie' : 'ia'} ha raggiunto l'obiettivo di validazione dai dati live ({promotable.map(r => { const v = validationOf(r.qel_strategies, liveStats.get(Number(r.qel_strategies?.magic))); return `${r.qel_strategies?.name} ${v?.trades}/${v?.target}` }).join(', ')}): puoi <b>promuoverla a proven</b> (bottone in tabella) e salire a Piena. Verifica prima che i trade live siano della versione deployata.
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
                        const v = validationOf(s, liveStats.get(Number(s?.magic)))
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
                                {v && !v.proven && v.byData && s && <button onClick={() => promote(s.id, s.name)} className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 align-middle">Promuovi</button>}
                                {(() => {
                                  const c = conformityOf(liveStats.get(Number(s?.magic)), testProf.get(Number(s?.magic)), v?.target ?? 40)
                                  const badge = (txt: string, cls: string, tip: string) =>
                                    <span key={txt} className={`ml-1 text-[10px] px-1.5 py-0.5 rounded align-middle ${cls}`} title={tip}>{txt}</span>
                                  const out = []
                                  if (c.freqState === 'alta') out.push(badge(`freq ${fmt(c.freqRatio, 1)}×`, 'bg-red-100 text-red-700',
                                    `Opera ${fmt(c.freqRatio, 1)} volte piu' del backtest. Prima causa: EA fuori spec (filtro orario/giorni spento, EOD mancante). Seconda: regime che genera piu' segnali. Da verificare sugli input .mq5.`))
                                  if (c.freqState === 'bassa') out.push(badge(`freq ${fmt(c.freqRatio, 1)}×`, 'bg-amber-100 text-amber-800',
                                    `Opera meno del backtest: filtro troppo stretto, oppure regime sfavorevole al suo stile.`))
                                  if (c.edgeState === 'sotto') out.push(badge(`edge ${fmt(c.edgeRatio! * 100, 0)}%`, 'bg-red-100 text-red-700',
                                    `Rende il ${fmt(c.edgeRatio! * 100, 0)}% di quanto atteso dal backtest, su campione sufficiente. Fuori dalla banda ±20%: overfit o edge in decadimento.`))
                                  if (c.edgeState === 'sopra') out.push(badge(`edge ${fmt(c.edgeRatio! * 100, 0)}%`, 'bg-blue-100 text-blue-700',
                                    `Rende piu' del backtest. Non e' una buona notizia di per se': spesso e' regime favorevole, e rientrera' verso la media.`))
                                  if (c.edgeState === 'ok' && c.freqState === 'ok') out.push(badge('in linea', 'bg-green-100 text-green-700', 'Frequenza ed edge dentro la banda attesa dal backtest.'))
                                  return out
                                })()}</div>
                              {v && !v.proven && (
                                <div className="mt-1 flex items-center gap-2">
                                  <div className="h-1.5 w-24 rounded bg-slate-100 overflow-hidden"><div className={`h-full ${v.byData ? 'bg-amber-500' : 'bg-slate-400'}`} style={{ width: `${v.pct}%` }} /></div>
                                  <span className="text-[10px] text-slate-400">{v.trades}/{v.target} segnali{v.baseline > 0 ? ` (da 0, ${v.baseline} della versione precedente esclusi)` : ''}{v.pf != null ? ` · PF ${fmt(v.pf, 2)}` : ' · no PF'}{(() => {
                                    const c = conformityOf(liveStats.get(Number(s?.magic)), testProf.get(Number(s?.magic)), v.target)
                                    return c.months ? ` · ~${fmt(c.months, 0)} mesi` : ''
                                  })()}</span>
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
