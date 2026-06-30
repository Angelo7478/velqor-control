'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

type Strat = {
  id: string; magic: number | null; name: string; asset: string | null; asset_group: string | null
  direction: string | null; strategy_style: string | null; status: string; include_in_portfolio: boolean | null
  test_mc95_dd: number | null; test_max_open_dd: number | null; test_ret_dd: number | null; test_profit_factor: number | null
  real_trades: number | null; real_avg_per_lot: number | null; real_win_pct: number | null; real_profit_factor: number | null
}
type Account = { id: string; name: string; account_size: number | null; currency: string | null; max_daily_loss_pct: number | null; max_total_loss_pct: number | null }
type Signal = { base_magic: number; sig_time: string; pl_per_lot: number }

const LEVELS = { conservative: 3.5, neutral: 6, aggressive: 9 } as const
type Level = keyof typeof LEVELS
const LEVEL_LABEL: Record<Level, string> = { conservative: 'Conservativo', neutral: 'Neutro', aggressive: 'Aggressivo' }
// fattore di rischio per il cap di correlazione (le US-equity contano come un cluster)
const RISK_FACTOR = (g: string | null): string => (g === 'INDICI_US' || g === 'SP500' || g === 'GER40') ? 'EQUITY' : (g || 'ALTRO')

// Peso qualita: robustezza (test ret/DD, cap 10) x fattore live.
// Pesa di piu le strategie robuste E con buoni risultati live, non solo nei test;
// le 0-live prendono un haircut prudenziale (0.7). Niente Kelly/HRP (scartati dai dati).
function qualityWeight(s: Strat): number {
  const robust = Math.min(Number(s.test_ret_dd) || 1, 10)
  const trades = Number(s.real_trades) || 0
  const pf = Number(s.real_profit_factor) || 0
  let live = 0.7
  if (trades >= 50 && pf >= 1.5) live = 1.15
  else if (trades >= 30 && pf >= 1.2) live = 1.0
  else if (trades >= 10) live = 0.85
  return robust * live
}

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export default function PortfolioBuilderPage() {
  const [strats, setStrats] = useState<Strat[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [signals, setSignals] = useState<Signal[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [equity, setEquity] = useState(100000)
  const [level, setLevel] = useState<Level>('neutral')
  const [acctId, setAcctId] = useState('')
  const [ptfName, setPtfName] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = createClient()
    const [sRes, aRes, sigRes] = await Promise.all([
      supabase.from('qel_strategies')
        .select('id,magic,name,asset,asset_group,direction,strategy_style,status,include_in_portfolio,test_mc95_dd,test_max_open_dd,test_ret_dd,test_profit_factor,real_trades,real_avg_per_lot,real_win_pct,real_profit_factor')
        .in('status', ['active', 'testing']).order('magic'),
      supabase.from('qel_accounts').select('id,name,account_size,currency,max_daily_loss_pct,max_total_loss_pct').eq('status', 'active').order('account_size', { ascending: false }),
      supabase.from('v_signal_trades').select('base_magic,sig_time,pl_per_lot').order('sig_time'),
    ])
    const list = (sRes.data as Strat[]) || []
    setStrats(list)
    setAccounts((aRes.data as Account[]) || [])
    setSignals((sigRes.data as Signal[]) || [])
    setSel(new Set(list.filter(s => s.include_in_portfolio).map(s => s.id)))
    setLoading(false)
  }

  function toggle(id: string) { setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  function pickAccount(id: string) { setAcctId(id); const a = accounts.find(x => x.id === id); if (a?.account_size) setEquity(Number(a.account_size)) }

  // ---- Sizing istituzionale: budget MC95 = livello% equity, equal-risk tra le selezionate ----
  const ddBudget = LEVELS[level]
  const sizing = useMemo(() => {
    const selected = strats.filter(s => sel.has(s.id) && (s.test_mc95_dd || 0) > 0)
    const budgetUsd = (ddBudget / 100) * equity
    const wTot = selected.reduce((a, s) => a + qualityWeight(s), 0) || 1
    const rows = selected.map(s => {
      const mc95 = Number(s.test_mc95_dd) || 0
      const w = qualityWeight(s)
      const budgetStrat = budgetUsd * w / wTot
      const lots = Math.max(0.01, Math.round((budgetStrat / mc95) * 100) / 100)
      const mc95Pct = (lots * mc95 / equity) * 100
      const mae = Number(s.test_max_open_dd) || 0
      const dayFloat = s.direction === 'short' ? 0 : lots * mae
      return { s, lots, mc95Pct, dayFloat, w }
    })
    return { rows, lotsById: new Map(rows.map(r => [r.s.id, r.lots])) }
  }, [strats, sel, equity, ddBudget])

  const aggMc95 = sizing.rows.reduce((a, r) => a + r.mc95Pct, 0)
  const worstDayPct = (sizing.rows.reduce((a, r) => a + r.dayFloat, 0) / equity) * 100
  const acct = accounts.find(a => a.id === acctId)
  const maxTot = acct?.max_total_loss_pct ?? 10
  const maxDay = acct?.max_daily_loss_pct ?? 5

  // ---- Simulazione: curva equity LIVE (segnali deduplicati) scalata ai lotti scelti ----
  const sim = useMemo(() => {
    const magics = new Map<number, number>()
    for (const r of sizing.rows) if (r.s.magic != null) magics.set(r.s.magic, r.lots)
    const pts = signals.filter(g => magics.has(g.base_magic))
    if (pts.length === 0) return null
    let cum = 0, peak = 0, maxDd = 0
    const byDay = new Map<string, number>()
    const curve: { t: string; eq: number }[] = []
    for (const g of pts) {
      const pnl = g.pl_per_lot * (magics.get(g.base_magic) || 0)
      cum += pnl
      peak = Math.max(peak, cum)
      maxDd = Math.max(maxDd, peak - cum)
      const day = g.sig_time.slice(0, 10)
      byDay.set(day, (byDay.get(day) || 0) + pnl)
      curve.push({ t: g.sig_time.slice(0, 10), eq: Math.round(cum) })
    }
    const days = [...byDay.values()]
    const wins = days.filter(d => d > 0).length
    const worstDay = Math.min(0, ...days)
    const first = pts[0].sig_time, last = pts[pts.length - 1].sig_time
    const months = Math.max(1, (Date.parse(last) - Date.parse(first)) / (1000 * 60 * 60 * 24 * 30.44))
    // downsample curve a ~120 punti per il grafico
    const step = Math.max(1, Math.floor(curve.length / 120))
    const chart = curve.filter((_, i) => i % step === 0 || i === curve.length - 1)
    return {
      net: cum, maxDd, retDd: maxDd > 0 ? cum / maxDd : 0,
      dayWinPct: days.length ? (wins / days.length) * 100 : 0, worstDay,
      tradingDays: days.length, months, monthlyPct: (cum / months / equity) * 100, chart,
    }
  }, [signals, sizing, equity])

  // ---- Confronto metriche tra i 3 livelli (scalano linearmente col budget) ----
  const levelCompare = useMemo(() => {
    if (!sim) return null
    return (Object.keys(LEVELS) as Level[]).map(l => {
      const ratio = LEVELS[l] / ddBudget
      return { l, mc95: LEVELS[l], monthly: sim.monthlyPct * ratio, annual: sim.monthlyPct * 12 * ratio, worstDay: worstDayPct * ratio, retDd: sim.retDd }
    })
  }, [sim, ddBudget, worstDayPct])

  // ---- Export config JSON ----
  function exportConfig() {
    const cfg = {
      portfolio: ptfName || 'ptf', equity, level, ddBudget,
      account: acct?.name || null,
      aggregate: { mc95_pct: Number(aggMc95.toFixed(2)), worst_day_pct: Number(worstDayPct.toFixed(2)) },
      simulation: sim ? { net_per_lot_scaled: Math.round(sim.net), max_dd: Math.round(sim.maxDd), ret_dd: Number(sim.retDd.toFixed(2)), monthly_pct: Number(sim.monthlyPct.toFixed(2)) } : null,
      strategies: sizing.rows.map(r => ({ magic: r.s.magic, name: r.s.name, lots: r.lots, mc95_pct: Number(r.mc95Pct.toFixed(2)) })),
    }
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `ptf_${ptfName || 'config'}_${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href)
  }

  // ---- Salva PTF (qel_portfolios + composizione coi 3 livelli) ----
  async function savePTF() {
    if (sizing.rows.length === 0 || !ptfName.trim()) { setMsg('Dai un nome e seleziona almeno una strategia'); return }
    setMsg('Salvataggio…')
    const supabase = createClient()
    const orgId = acct ? (await supabase.from('qel_accounts').select('org_id').eq('id', acct.id).single()).data?.org_id
      : (await supabase.from('qel_strategies').select('org_id').limit(1).single()).data?.org_id
    const { data: ptf } = await supabase.from('qel_portfolios').insert({
      org_id: orgId, account_id: acctId || null, name: ptfName.trim(), sizing_mode: 'risk_budget',
      equity_base: equity, max_dd_target_pct: ddBudget, daily_dd_limit_pct: maxDay, safety_factor: 1.0, is_active: true,
    }).select('id').single()
    if (ptf) {
      // 3 livelli per ogni strategia (pesati per qualita+live, stessa logica del pannello)
      const wTot = sizing.rows.reduce((a, r) => a + r.w, 0) || 1
      const rows = sizing.rows.map(r => {
        const mc95 = Number(r.s.test_mc95_dd) || 1
        const perL = (l: number) => Math.max(0.01, Math.round(((l / 100) * equity * r.w / wTot / mc95) * 100) / 100)
        return {
          portfolio_id: ptf.id, strategy_id: r.s.id, is_active: true, active_level: level,
          lot_conservative: perL(LEVELS.conservative), lot_neutral: perL(LEVELS.neutral), lot_aggressive: perL(LEVELS.aggressive),
          final_lots: r.lots, lot_suggested: r.lots, dd_budget_allocation_pct: Number(r.mc95Pct.toFixed(2)),
        }
      })
      await supabase.from('qel_portfolio_strategies').insert(rows)
      setMsg(`Salvato "${ptfName}" (${rows.length} strategie, livello ${LEVEL_LABEL[level]})`)
      setPtfName('')
    } else setMsg('Errore salvataggio')
  }

  if (loading) return <div className="text-slate-500 p-4">Caricamento…</div>

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Portfolio Builder</h1>
        <p className="text-sm text-slate-500">Selezioni <b>strategie</b>, sizing istituzionale a 3 livelli, simulazione su live deduplicato (10K/80K storici inclusi), export e salvataggio PTF.</p>
      </div>

      {/* Controlli */}
      <div className="flex flex-wrap items-end gap-4 bg-white border border-slate-200 rounded-xl p-4">
        <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Conto target</span>
          <select value={acctId} onChange={e => pickAccount(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="">— manuale —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({fmt(a.account_size, 0)} {a.currency})</option>)}
          </select></label>
        <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Equity</span>
          <input type="number" value={equity} onChange={e => setEquity(Number(e.target.value) || 0)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-32" /></label>
        <div className="text-sm"><span className="block text-xs text-slate-500 mb-1">Livello rischio</span>
          <div className="flex gap-1">{(Object.keys(LEVELS) as Level[]).map(l => (
            <button key={l} onClick={() => setLevel(l)} className={`px-3 py-1.5 text-sm rounded-lg border ${level === l ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>{LEVEL_LABEL[l]}</button>
          ))}</div></div>
        <div className="ml-auto text-sm flex gap-6">
          <span>MC95 aggregato <b className={aggMc95 > maxTot ? 'text-red-600' : 'text-slate-900'}>{fmt(aggMc95, 1)}%</b> <span className="text-xs text-slate-400">/ {fmt(maxTot, 0)}%</span></span>
          <span>Worst-day <b className={worstDayPct > maxDay ? 'text-red-600' : 'text-slate-900'}>{fmt(worstDayPct, 2)}%</b> <span className="text-xs text-slate-400">/ {fmt(maxDay, 0)}%</span></span>
        </div>
      </div>

      {/* Simulazione */}
      {sim && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm mb-3">
            <span className="font-semibold text-slate-900">Simulazione (live deduplicato, scalato ai lotti)</span>
            <span>Net <b className={sim.net >= 0 ? 'text-green-700' : 'text-red-600'}>{fmt(sim.net, 0)}</b></span>
            <span>Max DD <b>{fmt(sim.maxDd, 0)}</b></span>
            <span>Return/DD <b>{fmt(sim.retDd, 2)}</b></span>
            <span>Giorni positivi <b>{fmt(sim.dayWinPct, 0)}%</b></span>
            <span>Worst-day reale <b className="text-red-600">{fmt(sim.worstDay, 0)}</b></span>
            <span>~ Mensile <b>{fmt(sim.monthlyPct, 2)}%</b></span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={sim.chart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="eq" stroke="#2563eb" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Confronto livelli di sizing */}
      {levelCompare && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-slate-900 mb-2">Confronto livelli di sizing (le metriche scalano col budget; Return/DD invariato)</div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-200">
              <th className="px-2 py-1">Livello</th><th className="px-2 py-1 text-right">MC95 budget</th>
              <th className="px-2 py-1 text-right">~ Mensile</th><th className="px-2 py-1 text-right">~ Annuo</th>
              <th className="px-2 py-1 text-right">Worst-day</th><th className="px-2 py-1 text-right">Return/DD</th>
            </tr></thead>
            <tbody>
              {levelCompare.map(r => (
                <tr key={r.l} className={`border-b border-slate-50 ${r.l === level ? 'bg-blue-50' : ''}`}>
                  <td className="px-2 py-1 font-medium text-slate-800">{LEVEL_LABEL[r.l]}{r.l === level && <span className="text-xs text-blue-600"> (attivo)</span>}</td>
                  <td className="px-2 py-1 text-right">{fmt(r.mc95, 1)}%</td>
                  <td className="px-2 py-1 text-right font-semibold text-slate-900">{fmt(r.monthly, 2)}%</td>
                  <td className="px-2 py-1 text-right">{fmt(r.annual, 1)}%</td>
                  <td className="px-2 py-1 text-right text-red-600">{fmt(r.worstDay, 2)}%</td>
                  <td className="px-2 py-1 text-right">{fmt(r.retDd, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-400 mt-2">Mensile/worst-day dalla simulazione live deduplicata, scalati al budget del livello. Il DD reale combinato e circa 1/4 della somma MC95 (decorrelazione): per le challenge si puo salire sopra l&apos;aggressivo sfruttando quel cuscino.</p>
        </div>
      )}

      {/* Azioni */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl p-4">
        <input value={ptfName} onChange={e => setPtfName(e.target.value)} placeholder="Nome PTF" className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        <button onClick={savePTF} className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">Salva PTF</button>
        <button onClick={exportConfig} className="px-4 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Esporta file</button>
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
      </div>

      {/* Tabella */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            <th className="px-3 py-2"></th><th className="px-2 py-2">Magic</th><th className="px-2 py-2">Strategia</th>
            <th className="px-2 py-2">Fattore</th><th className="px-2 py-2 text-right">MC95/lot</th>
            <th className="px-2 py-2 text-right">Backtest R/DD·PF</th><th className="px-2 py-2 text-right">Live: segnali·avg/lot·PF</th>
            <th className="px-2 py-2 text-right">Lotti ({LEVEL_LABEL[level]})</th><th className="px-2 py-2 text-right">MC95 %</th>
          </tr></thead>
          <tbody>
            {strats.map(s => {
              const r = sizing.rows.find(x => x.s.id === s.id); const on = sel.has(s.id)
              return (
                <tr key={s.id} className={`border-b border-slate-50 ${on ? '' : 'opacity-50'}`}>
                  <td className="px-3 py-2"><input type="checkbox" checked={on} onChange={() => toggle(s.id)} /></td>
                  <td className="px-2 py-2 font-mono text-slate-700">{s.magic}</td>
                  <td className="px-2 py-2 text-slate-900">{s.name} <span className={`text-xs ${s.direction === 'short' ? 'text-red-500' : 'text-slate-400'}`}>{s.direction}</span></td>
                  <td className="px-2 py-2 text-xs text-slate-500">{RISK_FACTOR(s.asset_group)}</td>
                  <td className="px-2 py-2 text-right text-slate-600">{fmt(s.test_mc95_dd, 0)}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{fmt(s.test_ret_dd, 1)} · {fmt(s.test_profit_factor, 2)}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{s.real_trades ? <>{s.real_trades} · {fmt(s.real_avg_per_lot, 1)} · {fmt(s.real_profit_factor, 2)}</> : <span className="text-slate-300">no live</span>}</td>
                  <td className="px-2 py-2 text-right font-semibold text-blue-800">{r ? fmt(r.lots, 2) : '—'}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{r ? fmt(r.mc95Pct, 2) + '%' : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Sizing quality-weighted: budget MC95 = {ddBudget}% equity distribuito per peso qualita (robustezza test ret/DD × fattore live: premia chi ha dato anche dal vivo, haircut 0,7 alle 0-live), non equal-risk. Niente Kelly/HRP (scartati dai dati). Worst-day floating = somma (lotti × MAE) delle long (le US-equity correlate sommano = conservativo). Live deduplicato (un campione per segnale, vista v_signal_trades), include il track record storico 10K/80K.</p>
    </div>
  )
}
