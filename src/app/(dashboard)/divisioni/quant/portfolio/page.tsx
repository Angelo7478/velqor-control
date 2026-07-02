'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { detectMarketRegimes4Q, regimeMultiplier, REGIME_4Q_LABELS, type MarketRegime4Q } from '@/lib/quant-utils'
import { buildReportHtml, type ReportTrade } from '@/lib/quant-report'

type Strat = {
  id: string; magic: number | null; name: string; asset: string | null; asset_group: string | null
  direction: string | null; strategy_style: string | null; status: string; include_in_portfolio: boolean | null
  test_mc95_dd: number | null; test_max_open_dd: number | null; test_ret_dd: number | null; test_profit_factor: number | null
  real_trades: number | null; real_avg_per_lot: number | null; real_win_pct: number | null; real_profit_factor: number | null
  live_status: string | null; regime_gated: boolean | null
}
type Account = { id: string; name: string; account_size: number | null; currency: string | null; max_daily_loss_pct: number | null; max_total_loss_pct: number | null }
type Signal = { base_magic: number; sig_time: string; pl_per_lot: number }
type BtMonth = { magic: number; month: string; pl_per_lot: number; n_trades: number }

// Cuscino di decorrelazione misurato sul book attuale (PTF_SIM, block-bootstrap): DD reale ~1/4 dell'aritmetico.
// E un RIFERIMENTO, non licenza per sovra-sizzare; rivedere se cambia la composizione del portafoglio.
const DECORR = 0.26
// Costanti da Fase 1 (PTF_SIM/potenziale_reale.py, dati del book attuale — RICALCOLARE se cambia la composizione):
// DD reale al 99° percentile / MC95 aritmetico (bootstrap 20gg 2021-2026 incl. orso 2022).
const DD99_RATIO = 0.293
// Worst-day floating REALE / aritmetico: la decorrelazione TEMPORALE (3=lun, 6=mar disgiunte) taglia il daily.
const TEMPORAL_FLOOR = 0.58
// Un unico modello di livelli (%MC95): 3 operativi + 2 di valutazione (Challenge/Spinto sfondano il 10%).
// Guida SIA le size in tabella SIA la Scheda PDF; il selettore evidenzia il rosso oltre il limite del conto.
const RISK_LEVELS = [
  { key: 'conservative', name: 'Conservativo', mc95: 3.5 },
  { key: 'neutral', name: 'Neutro', mc95: 6 },
  { key: 'aggressive', name: 'Aggressivo', mc95: 9 },
  { key: 'challenge', name: 'Challenge', mc95: 12 },
  { key: 'spinto', name: 'Spinto', mc95: 15 },
  // Livello operativo REALISTICO (scelto da Angelo 2 lug 2026): DD99 reale + margine 30% ~= 21,3% aritmetico ~3,5x neutro.
  // Da usare con la guardia VIX (advisory in pannello, azione manuale). DD99 reale ~6%, worst-day reale ~3%: sotto i limiti.
  { key: 'reale30', name: 'Reale DD99+30%', mc95: 21.3 },
] as const

// Overlay VIX term structure (soglie DERIVATE dal backtest, PTF_SIM/vix_overlay.py). ratio = ^VIX/^VIX3M.
// Advisory: dial suggerito sul cluster LONG (short tenuti pieni). Azione MANUALE (Angelo spegne gli EA a mano).
function vixState(ratio: number | null): { label: string; longDial: number; color: string; cadence: string } {
  if (ratio == null) return { label: 'n/d', longDial: 1, color: 'slate', cadence: '—' }
  if (ratio >= 1.03) return { label: 'STRESS (backwardation)', longDial: 0, color: 'red', cadence: 'intraday' }
  if (ratio >= 0.98) return { label: 'Allarme alto', longDial: 0.33, color: 'orange', cadence: 'giornaliera' }
  if (ratio >= 0.97) return { label: 'Allarme', longDial: 0.66, color: 'amber', cadence: 'ogni 2 giorni' }
  return { label: 'Contango (calma)', longDial: 1, color: 'green', cadence: 'settimanale' }
}
type Level = typeof RISK_LEVELS[number]['key']
const levelInfo = (k: string) => RISK_LEVELS.find(l => l.key === k) ?? RISK_LEVELS[1]
// Tabella di valutazione: i 5 livelli + i punti REALISTICI (sizing sul DD reale, non sull'aritmetico).
// Reale DD99+margine = punti raccomandati da Fase 1 (richiedono l'overlay VIX come guardia dinamica prima del live).
const EVAL_LEVELS = [
  ...RISK_LEVELS.map(l => ({ name: l.name, mc95: l.mc95 })),
  { name: 'Reale DD99 nudo', mc95: 30.4 }, // 'Reale DD99+30%' e' gia' in RISK_LEVELS (key reale30)
]
// Cap per singola strategia: nessuna oltre questa quota del MC95 aggregato (trim, NO redistribuzione).
// Evita la concentrazione su una sola strategia (es. magic 3). Tunabile.
const MAX_SINGLE_SHARE = 0.35
// fattore di rischio per il cap di correlazione (le US-equity contano come un cluster)
const RISK_FACTOR = (g: string | null): string => (g === 'INDICI_US' || g === 'SP500' || g === 'GER40') ? 'EQUITY' : (g || 'ALTRO')

// Peso di DISTRIBUZIONE = robustezza (test ret/DD, cap 10). Model B (2 lug 2026): il fattore live NON entra
// piu' nella distribuzione. La PIENA distribuisce il budget per robustezza; la RIDOTTA applica un haircut
// ASSOLUTO 0,7 alle strategie non-proven SENZA redistribuire (→ totale piu' basso, la provata non si gonfia).
// Cosi' "Ridotta" e' davvero meno rischio, non "tutto sulla provata". Niente Kelly/HRP (scartati dai dati).
function robustBase(s: Strat): number {
  return Math.min(Number(s.test_ret_dd) || 1, 10)
}

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export default function PortfolioBuilderPage() {
  const [strats, setStrats] = useState<Strat[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [signals, setSignals] = useState<Signal[]>([])
  const [backtestMonthly, setBacktestMonthly] = useState<BtMonth[]>([])
  const [acctComp, setAcctComp] = useState<Map<string, Set<string>>>(new Map())
  const [acctPolicy, setAcctPolicy] = useState<Map<string, 'reduced' | 'full'>>(new Map())
  const [vix, setVix] = useState<{ ratio: number; ts: string; vix: number; vix3m: number } | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [equity, setEquity] = useState(100000)
  const [level, setLevel] = useState<Level>('neutral')
  // Asse modalità (ortogonale al livello): reduced = haircut 0,7 alle 0-live (operativa prudente);
  // full = tutte trattate come proven (size "a regime"). Salvata per conto in qel_portfolios.size_policy.
  const [sizeMode, setSizeMode] = useState<'reduced' | 'full'>('reduced')
  // Interessi composti nella scheda: off = additivo su base fissa (prop); on = reinveste (conto reale, size cresce con l'equity).
  const [compounding, setCompounding] = useState(false)
  const [acctId, setAcctId] = useState('')
  const [ptfName, setPtfName] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [regimeBySym, setRegimeBySym] = useState<Map<string, MarketRegime4Q>>(new Map())
  const [applyRegime, setApplyRegime] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = createClient()
    const [sRes, aRes, sigRes, pfRes, psRes, btmRes] = await Promise.all([
      supabase.from('qel_strategies')
        .select('id,magic,name,asset,asset_group,direction,strategy_style,status,include_in_portfolio,test_mc95_dd,test_max_open_dd,test_ret_dd,test_profit_factor,real_trades,real_avg_per_lot,real_win_pct,real_profit_factor,live_status,regime_gated')
        .in('status', ['active', 'testing']).order('magic'),
      supabase.from('qel_accounts').select('id,name,account_size,currency,max_daily_loss_pct,max_total_loss_pct').eq('status', 'active').order('account_size', { ascending: false }),
      supabase.from('v_signal_trades').select('base_magic,sig_time,pl_per_lot').order('sig_time'),
      supabase.from('qel_portfolios').select('id,account_id,size_policy'),
      supabase.from('qel_portfolio_strategies').select('portfolio_id,strategy_id'),
      supabase.from('qel_strategy_backtest_monthly').select('magic,month,pl_per_lot,n_trades').order('month'),
    ])
    const list = (sRes.data as Strat[]) || []
    setStrats(list)
    setAccounts((aRes.data as Account[]) || [])
    setSignals((sigRes.data as Signal[]) || [])
    setBacktestMonthly((btmRes.data as BtMonth[]) || [])
    // VIX term structure (advisory overlay): ultima riga
    const vRes = await supabase.from('qel_vix_term').select('ts,vix,vix3m,ratio').order('ts', { ascending: false }).limit(1)
    const vr = ((vRes.data as { ts: string; vix: number; vix3m: number; ratio: number }[]) || [])[0]
    if (vr) setVix({ ratio: Number(vr.ratio), ts: vr.ts, vix: Number(vr.vix), vix3m: Number(vr.vix3m) })
    // composizione salvata per conto (per caricarla quando si seleziona il conto)
    const pfAcc = new Map<string, string>()
    const pol = new Map<string, 'reduced' | 'full'>()
    for (const p of ((pfRes.data as { id: string; account_id: string | null; size_policy: string | null }[]) || [])) {
      if (p.account_id) { pfAcc.set(p.id, p.account_id); pol.set(p.account_id, p.size_policy === 'full' ? 'full' : 'reduced') }
    }
    const comp = new Map<string, Set<string>>()
    for (const r of ((psRes.data as { portfolio_id: string; strategy_id: string }[]) || [])) {
      const acc = pfAcc.get(r.portfolio_id); if (!acc) continue
      if (!comp.has(acc)) comp.set(acc, new Set())
      comp.get(acc)!.add(r.strategy_id)
    }
    setAcctComp(comp)
    setAcctPolicy(pol)
    setSel(new Set(list.filter(s => s.include_in_portfolio).map(s => s.id)))
    // Regime corrente per sottostante: ultimi ~220 bar daily per simbolo (evita il cap 1000 righe Supabase)
    const symbols = [...new Set(list.map(s => s.asset).filter(Boolean) as string[])]
    const bRes = await Promise.all(symbols.map(sym =>
      supabase.from('qel_benchmarks').select('symbol,ts,high,low,close_price').eq('symbol', sym).order('ts', { ascending: false }).limit(220)
    ))
    const rmap = new Map<string, MarketRegime4Q>()
    bRes.forEach((r, i) => {
      const pts = (((r.data as { ts: string; high: number | null; low: number | null; close_price: number }[]) || [])).slice().reverse()
      const zones = detectMarketRegimes4Q(pts)
      if (zones.length) rmap.set(symbols[i], zones[zones.length - 1].regime)
    })
    setRegimeBySym(rmap)
    setLoading(false)
  }

  function toggle(id: string) { setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  function pickAccount(id: string) {
    setAcctId(id)
    const a = accounts.find(x => x.id === id); if (a?.account_size) setEquity(Number(a.account_size))
    const comp = acctComp.get(id) // carica la composizione salvata del conto, se c'e
    if (comp && comp.size > 0) setSel(new Set(comp))
    const pol = acctPolicy.get(id); if (pol) setSizeMode(pol) // carica la modalità salvata del conto
  }

  // ---- Sizing istituzionale: budget MC95 = livello% equity, equal-risk tra le selezionate ----
  const ddBudget = levelInfo(level).mc95
  const levelName = levelInfo(level).name
  // Peso di distribuzione = robustezza × regime (se attivo). Gate regime -> 0 (OFF).
  const distWeight = (s: Strat): number => {
    const base = robustBase(s)
    if (!applyRegime) return base
    const m = regimeMultiplier(s.strategy_style, regimeBySym.get(s.asset || '') || null)
    if (s.regime_gated && m < 1) return 0
    return base * m
  }
  // Model B: allocazione robust-share del budget; in Ridotta haircut ASSOLUTO 0,7 alle non-proven (no redistribuzione);
  // poi cap per singola strategia (trim, no redistribuzione). Ritorna lotti per id. Condiviso da sizing e perLevelLots.
  const modelBLots = (selected: Strat[], levelPct: number, reduced: boolean): Map<string, number> => {
    const budgetUsd = (levelPct / 100) * equity
    const wTot = selected.reduce((a, s) => a + distWeight(s), 0) || 1
    const prelim = selected.map(s => {
      const mc95 = Number(s.test_mc95_dd) || 0
      const w = distWeight(s)
      const fullLots = (w === 0 || mc95 === 0) ? 0 : Math.max(0.01, Math.round((budgetUsd * w / wTot / mc95) * 100) / 100)
      const haircut = (reduced && s.live_status !== 'proven') ? 0.7 : 1
      const lots = w === 0 ? 0 : Math.max(0.01, Math.round((fullLots * haircut) * 100) / 100)
      return { s, mc95, lots }
    })
    const agg = prelim.reduce((a, r) => a + r.lots * r.mc95 / equity * 100, 0)
    const capPct = MAX_SINGLE_SHARE * agg
    const out = new Map<string, number>()
    for (const r of prelim) {
      let lots = r.lots
      if (r.mc95 > 0 && capPct > 0 && (lots * r.mc95 / equity * 100) > capPct) {
        lots = Math.max(0.01, Math.round((capPct / 100 * equity / r.mc95) * 100) / 100)
      }
      out.set(r.s.id, lots)
    }
    return out
  }

  const sizing = useMemo(() => {
    const selected = strats.filter(s => sel.has(s.id) && (s.test_mc95_dd || 0) > 0)
    // reduced=true -> Ridotta (operativa prudente); reduced=false -> Piena (a regime)
    const build = (reduced: boolean) => {
      const lotsMap = modelBLots(selected, ddBudget, reduced)
      return selected.map(s => {
        const mc95 = Number(s.test_mc95_dd) || 0
        const lots = lotsMap.get(s.id) || 0
        const mc95Pct = (lots * mc95 / equity) * 100
        const mae = Number(s.test_max_open_dd) || 0
        const dayFloat = s.direction === 'short' ? 0 : lots * mae
        return { s, lots, mc95Pct, dayFloat, w: distWeight(s) }
      })
    }
    return { rows: build(true), regimeRows: build(false) }
  }, [strats, sel, equity, ddBudget, applyRegime, regimeBySym])

  // opRows = size OPERATIVA della modalità scelta; cmpRows = l'altra modalità (colonna di confronto).
  type SizeRow = { s: Strat; lots: number; mc95Pct: number; dayFloat: number; w: number }
  const opRows: SizeRow[] = sizeMode === 'full' ? sizing.regimeRows : sizing.rows
  const cmpRows: SizeRow[] = sizeMode === 'full' ? sizing.rows : sizing.regimeRows
  const cmpById = new Map(cmpRows.map(r => [r.s.id, r]))
  const modeName = sizeMode === 'full' ? 'Piena' : 'Ridotta'
  const otherModeName = sizeMode === 'full' ? 'Ridotta' : 'Piena'

  const aggMc95 = opRows.reduce((a, r) => a + r.mc95Pct, 0)
  const worstDayPct = (opRows.reduce((a, r) => a + r.dayFloat, 0) / equity) * 100
  const acct = accounts.find(a => a.id === acctId)
  const maxTot = acct?.max_total_loss_pct ?? 10
  const maxDay = acct?.max_daily_loss_pct ?? 5

  // ---- Simulazione: curva equity LIVE (segnali deduplicati) scalata ai lotti scelti ----
  const sim = useMemo(() => {
    const magics = new Map<number, number>()
    for (const r of opRows) if (r.s.magic != null) magics.set(r.s.magic, r.lots)
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
  }, [signals, sizing, sizeMode, equity])

  // ---- Finestra a BOOK PIENO: mese da cui TUTTE le strategie selezionate hanno dati ----
  // Toglie il "rodaggio" (2021: solo 3-4 strategie su 6) che abbassava la media mensile artificialmente.
  const fullBookStart = useMemo(() => {
    const magics = [...new Set(opRows.map(r => r.s.magic).filter((m): m is number => m != null))]
    let start = ''
    for (const mag of magics) {
      let earliest = ''
      for (const m of backtestMonthly) if (m.magic === mag && (earliest === '' || m.month < earliest)) earliest = m.month
      if (earliest && (start === '' || earliest > start)) start = earliest
    }
    return start
  }, [opRows, backtestMonthly])

  // ---- Backtest combinato (media mensile REALE = solo finestra book-pieno; il report body la ricalcola sui trade virtuali) ----
  const btSim = useMemo(() => {
    const monthsSet = new Set<string>(); let net = 0
    for (const r of opRows) {
      if (r.s.magic == null) continue
      for (const m of backtestMonthly) if (m.magic === r.s.magic && m.month >= fullBookStart) { monthsSet.add(m.month); net += m.pl_per_lot * r.lots }
    }
    const months = monthsSet.size || 1
    return { net, months, monthlyPct: net / (equity * months) * 100 }
  }, [sizing, sizeMode, backtestMonthly, equity, fullBookStart])

  // ---- Confronto livelli + valutazione limiti (ddopen daily, MC95 totale). Scalano col budget ----
  // Mensile/annuo dal BACKTEST combinato (btSim), coerente col corpo della scheda; non dalla sim live.
  const levelCompare = useMemo(() => {
    if (ddBudget <= 0 || backtestMonthly.length === 0) return null
    return EVAL_LEVELS.map(L => {
      const ratio = L.mc95 / ddBudget
      const daily = worstDayPct * ratio                 // worst-day floating ARITMETICO (tutte insieme)
      const dailyReal = daily * TEMPORAL_FLOOR           // worst-day REALE (decorrelazione temporale: 3=lun, 6=mar)
      const ddReal = L.mc95 * DD99_RATIO                 // DD totale REALE al 99° pct (bootstrap)
      const monthly = btSim.monthlyPct * ratio
      const mult = L.mc95 / 6                             // moltiplicatore vs neutro (6% aritmetico)
      const mesiChallenge = monthly > 0 ? 10 / monthly : 0  // mesi per +10% (target challenge)
      return {
        name: L.name, arith: L.mc95, real: L.mc95 * DECORR, daily, dailyReal, ddReal, mult, mesiChallenge,
        monthly, annual: monthly * 12,
        overTot: L.mc95 > maxTot, overReal: ddReal > maxTot, overDayReal: dailyReal > maxDay,
      }
    })
  }, [btSim, backtestMonthly, ddBudget, worstDayPct, maxTot, maxDay])

  // ---- Scheda PDF ricca: backtest combinato delle strategie, scalato ai lotti operativi ----
  // Lotti per livello (%MC95) nella modalità scelta (Model B: robust-share + haircut assoluto in Ridotta + cap).
  // asIfProven=true -> Piena (nessun haircut). Condivisa con savePTF per i 3 livelli base.
  function perLevelLots(r: { s: Strat }, levelPct: number, asIfProven: boolean): number {
    const selected = strats.filter(s => sel.has(s.id) && (Number(s.test_mc95_dd) || 0) > 0)
    return modelBLots(selected, levelPct, !asIfProven).get(r.s.id) ?? 0
  }
  const styleLbl = (st?: string | null) =>
    st === 'seasonal' ? 'Seasonal' : st === 'mean_reversion' ? 'Mean Reversion'
    : st === 'trend_following' ? 'Trend Following' : st === 'breakout' ? 'Breakout' : 'Altro'
  const symCls = (sym: string) =>
    /US100|US500/.test(sym) ? 'Indici USA'
    : /GER40/.test(sym) ? 'Indici Europa'
    : sym === 'BTCUSD' ? 'Crypto'
    : sym === 'XAUUSD' ? 'Metalli'
    : /USD(JPY|CAD)|EURUSD/.test(sym) ? 'Forex'
    : /UKOIL|USOIL/.test(sym) ? 'Energia'
    : sym
  // Trade virtuali per strategia-per-mese ai lotti operativi. Solo finestra book-pieno (media reale).
  // Se compounding: i $ di ogni mese scalano col fattore di equity cumulata (reinvestimento, conto reale).
  function buildVirtualTrades(): ReportTrade[] {
    const raw: { month: string; pl: number; r: SizeRow }[] = []
    for (const r of opRows) {
      if (r.s.magic == null || r.lots === 0) continue
      for (const m of backtestMonthly) if (m.magic === r.s.magic && m.month >= fullBookStart) {
        raw.push({ month: m.month, pl: m.pl_per_lot * r.lots, r })
      }
    }
    const factor = new Map<string, number>()
    if (compounding) {
      const monthTot = new Map<string, number>()
      for (const x of raw) monthTot.set(x.month, (monthTot.get(x.month) || 0) + x.pl)
      let eq = equity
      for (const mo of [...monthTot.keys()].sort()) { factor.set(mo, eq / equity); eq += (monthTot.get(mo) || 0) * (eq / equity) }
    }
    // nTrades: i trade reali di quella strategia in quel mese (da qel_strategy_backtest_monthly.n_trades)
    const ntByKey = new Map<string, number>()
    for (const m of backtestMonthly) ntByKey.set(m.magic + '|' + m.month, m.n_trades || 0)
    return raw.map(x => ({
      d: x.month + '-15', pl: x.pl * (compounding ? (factor.get(x.month) || 1) : 1),
      type: styleLbl(x.r.s.strategy_style), cls: symCls(x.r.s.asset || ''),
      strat: x.r.s.name, lots: x.r.lots, sid: String(x.r.s.magic),
      nTrades: ntByKey.get(x.r.s.magic + '|' + x.month) || 0,
    }))
  }
  // Box intro: composizione (strategie scelte, size operativa della modalità + colonna dell'altra modalità).
  function introHtml(levelName: string): string {
    let anyDiff = false
    const body = opRows.map(r => {
      const contrib = backtestMonthly.filter(m => m.magic === r.s.magic).reduce((a, m) => a + m.pl_per_lot, 0) * r.lots
      const lotsCell = r.lots === 0 ? '<span style="color:#d97706">OFF</span>' : r.lots.toFixed(2)
      const dir = r.s.direction ? ` <span style="color:${r.s.direction === 'short' ? '#dc2626' : '#94a3b8'};font-size:10px">${r.s.direction}</span>` : ''
      const other = cmpById.get(r.s.id)
      if (other && Math.abs(other.lots - r.lots) > 0.005) anyDiff = true
      const otherCell = (r.lots === 0 || !other) ? '<span style="color:#cbd5e1">—</span>'
        : `<span style="color:${other.lots > r.lots ? '#059669' : '#94a3b8'}">${other.lots.toFixed(2)}</span>`
      return `<tr><td style="padding:2px 6px;font-family:monospace;color:#64748b">${r.s.magic ?? ''}</td><td style="padding:2px 6px">${r.s.name}${dir}</td><td style="padding:2px 6px;color:#64748b">${RISK_FACTOR(r.s.asset_group)}</td><td style="padding:2px 6px;text-align:right;font-weight:600">${lotsCell}</td><td style="padding:2px 6px;text-align:right">${otherCell}</td><td style="padding:2px 6px;text-align:right">${r.mc95Pct.toFixed(2)}%</td><td style="padding:2px 6px;text-align:right;color:${contrib >= 0 ? '#16a34a' : '#dc2626'}">${contrib < 0 ? '-' : ''}$${Math.abs(Math.round(contrib)).toLocaleString('it-IT')}</td></tr>`
    }).join('')
    const table = `<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:11px;color:#1e293b"><thead><tr style="text-align:left;color:#64748b;border-bottom:1px solid #ddd6fe"><th style="padding:2px 6px">Magic</th><th style="padding:2px 6px">Strategia</th><th style="padding:2px 6px">Fattore</th><th style="padding:2px 6px;text-align:right">Lotti (${modeName})</th><th style="padding:2px 6px;text-align:right">${otherModeName}</th><th style="padding:2px 6px;text-align:right">MC95%</th><th style="padding:2px 6px;text-align:right">Contributo</th></tr></thead><tbody>${body}</tbody><tfoot><tr style="border-top:1px solid #ddd6fe;font-weight:600"><td style="padding:3px 6px" colspan="5">${opRows.length} strategie</td><td style="padding:3px 6px;text-align:right">${aggMc95.toFixed(1)}%</td><td style="padding:3px 6px;text-align:right;color:${btSim.net >= 0 ? '#16a34a' : '#dc2626'}">${btSim.net < 0 ? '-' : ''}$${Math.abs(Math.round(btSim.net)).toLocaleString('it-IT')}</td></tr></tfoot></table>`
    const modeNote = anyDiff
      ? `<div style="margin-top:8px;font-size:10.5px;color:#64748b"><b>Modalità operativa: ${modeName}.</b> ${sizeMode === 'reduced'
        ? 'Size RIDOTTA: haircut prudenziale (0,7) alle strategie senza storico live consistente — finché un edge non prova di reggere dal vivo (slippage, regime, costi reali) non gli si affida capitale pieno. La colonna "Piena" è la size-obiettivo quando matureranno (promozione a validate).'
        : 'Size PIENA: haircut rimosso, tutte le strategie trattate come validate. La colonna "Ridotta" è la size prudenziale operativa di default. Usare la Piena solo su strategie con validazione live sufficiente.'}</div>`
      : ''
    const windowNote = `<div style="margin-top:6px;font-size:10.5px;color:#64748b"><b>Conteggi = trade reali</b> del backtest; le statistiche (expectancy, VaR, PF, Sharpe, mensile) sono a base <b>mensile</b> (P/L aggregato per strategia-mese, 1 lotto). Media mensile sulla <b>finestra a book pieno</b> (da ${fullBookStart || '—'}, quando tutte le strategie selezionate sono attive): esclude il rodaggio iniziale che abbassava la media. ${compounding ? '<b>Interessi composti ON</b>: i rendimenti reinvestono e la size cresce con l\'equity (conto reale).' : '<b>Interessi composti OFF</b>: additivo su base fissa (prop: pagato sul profitto, size fissa).'}</div>`
    return `<b>Sizing ${modeName} · livello ${levelName} — ${ddBudget}% di MC95${compounding ? ' · composti' : ''}.</b> Backtest combinato delle strategie selezionate, scalati ai lotti operativi (costi broker reali già inclusi nei trade-list). <b>Composizione del portafoglio:</b>${table}${modeNote}${windowNote}`
  }
  // Tabella 5-livelli (riuso della memo levelCompare) + spiegazione probabilità-DD (aritmetico/reale/storico).
  function levelCompareTableHtml(): string {
    if (!levelCompare) return ''
    const ddNote = `<b>Drawdown: due metri.</b> <b>MC95 aritmetico (${ddBudget}%)</b> = tetto paranoico che assume che TUTTE le strategie perdano insieme (correlazione=1): mai osservato. <b>DD reale al 99° percentile</b> = drawdown effettivo del portafoglio (bootstrap 20gg su 2021-2026 incl. orso 2022), ~${(DD99_RATIO * 100).toFixed(0)}% dell'aritmetico. Il <b>worst-day reale</b> tiene conto della decorrelazione TEMPORALE (magic 3 lavora lunedì, 6 martedì → non vanno in DD lo stesso giorno): ~${(TEMPORAL_FLOOR * 100).toFixed(0)}% del worst-day aritmetico. Sizing operativo consigliato: DD99 reale + margine, con overlay VIX come guardia dinamica.<br><br>`
    const body = levelCompare.map(r => {
      const hl = r.name === levelName ? ' style="background:#eef2ff;font-weight:600"' : ''
      return `<tr${hl}><td style="padding:2px 6px">${r.name}</td><td style="padding:2px 6px;text-align:right;color:#94a3b8">${r.arith.toFixed(1)}%</td><td style="padding:2px 6px;text-align:right">${r.ddReal.toFixed(1)}%${r.overReal ? ' &#9888;' : ''}</td><td style="padding:2px 6px;text-align:right">${r.dailyReal.toFixed(2)}%${r.overDayReal ? ' &#9888;' : ''}</td><td style="padding:2px 6px;text-align:right">${r.mult.toFixed(1)}×</td><td style="padding:2px 6px;text-align:right">${r.monthly.toFixed(2)}%</td><td style="padding:2px 6px;text-align:right">${r.mesiChallenge.toFixed(1)}</td></tr>`
    }).join('')
    return `${ddNote}Livelli di sizing. MC95 aritmetico = riferimento paranoico; DD99 reale e worst-day reale = i numeri veri; il simbolo di allerta segnala oltre il limite del conto. Livello attivo evidenziato.<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:11px"><thead><tr style="text-align:left;color:#64748b;border-bottom:1px solid #e2e8f0"><th style="padding:2px 6px">Livello</th><th style="padding:2px 6px;text-align:right">MC95 aritm.</th><th style="padding:2px 6px;text-align:right">DD99 reale</th><th style="padding:2px 6px;text-align:right">Worst-day reale</th><th style="padding:2px 6px;text-align:right">×neutro</th><th style="padding:2px 6px;text-align:right">~ Mensile</th><th style="padding:2px 6px;text-align:right">Mesi/challenge</th></tr></thead><tbody>${body}</tbody></table>`
  }
  function exportScheda() {
    const trades = buildVirtualTrades()
    if (trades.length === 0) { setMsg('Nessun dato backtest per le strategie selezionate'); return }
    const selMagics = opRows.map(r => r.s.magic).filter((m): m is number => m != null)
    const have = new Set(backtestMonthly.map(m => m.magic))
    const missing = selMagics.filter(m => !have.has(m))
    const curr: 'EUR' | 'USD' = acct?.currency === 'EUR' ? 'EUR' : 'USD'
    const html = buildReportHtml(trades, {
      title: `Scheda Portafoglio — ${ptfName || 'PTF'} (${levelName} · ${modeName})`,
      subtitle: `${fmt(equity, 0)} ${curr} · sizing ${modeName} · livello ${levelName} (${ddBudget}% MC95) · backtest combinato`,
      metaRight: [
        `Equity: ${fmt(equity, 0)} ${curr}`,
        `Modalità: ${modeName}`,
        `Livello: ${levelName} (${ddBudget}% MC95)`,
        `Strategie: ${selMagics.length}`,
        acct ? `Conto: ${acct.name}` : 'Sizing manuale',
      ],
      currency: curr, base: equity, swap: 0, comm: 0,
      isPublic: false, badge: 'INTERNO',
      intro: introHtml(levelName),
      groupNote: levelCompareTableHtml(),
      costNote: false, hideCostAnalysis: true,
      sampleNoun: 'mese', glossary: true,
    })
    const win = window.open('', '_blank')
    if (!win) { setMsg('Abilita i popup per esportare la scheda.'); return }
    win.document.write(html); win.document.close()
    setMsg(missing.length ? `Scheda ${modeName}/${levelName} aperta — attenzione: nessun backtest per magic ${missing.join(', ')} (escluse)` : `Scheda ${modeName}/${levelName} aperta in un nuovo tab`)
  }

  // ---- Export config JSON ----
  function exportConfig() {
    const cfg = {
      portfolio: ptfName || 'ptf', equity, level, ddBudget, size_mode: sizeMode,
      account: acct?.name || null,
      aggregate: { mc95_pct: Number(aggMc95.toFixed(2)), worst_day_pct: Number(worstDayPct.toFixed(2)) },
      simulation: sim ? { net_per_lot_scaled: Math.round(sim.net), max_dd: Math.round(sim.maxDd), ret_dd: Number(sim.retDd.toFixed(2)), monthly_pct: Number(sim.monthlyPct.toFixed(2)) } : null,
      strategies: opRows.map(r => ({ magic: r.s.magic, name: r.s.name, lots: r.lots, mc95_pct: Number(r.mc95Pct.toFixed(2)) })),
    }
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `ptf_${ptfName || 'config'}_${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href)
  }

  // ---- Salva PTF (qel_portfolios + composizione coi 3 livelli, modalità piena/ridotta) ----
  async function savePTF() {
    if (opRows.length === 0 || !ptfName.trim()) { setMsg('Dai un nome e seleziona almeno una strategia'); return }
    setMsg('Salvataggio…')
    const supabase = createClient()
    const asIfProven = sizeMode === 'full'
    const redById = new Map(sizing.rows.map(r => [r.s.id, r.lots]))
    const fullById = new Map(sizing.regimeRows.map(r => [r.s.id, r.lots]))
    const orgId = acct ? (await supabase.from('qel_accounts').select('org_id').eq('id', acct.id).single()).data?.org_id
      : (await supabase.from('qel_strategies').select('org_id').limit(1).single()).data?.org_id
    const { data: ptf } = await supabase.from('qel_portfolios').insert({
      org_id: orgId, account_id: acctId || null, name: ptfName.trim(), sizing_mode: 'risk_budget', size_policy: sizeMode,
      equity_base: equity, max_dd_target_pct: ddBudget, daily_dd_limit_pct: maxDay, safety_factor: 1.0, is_active: true,
    }).select('id').single()
    if (ptf) {
      // 3 lotti base (3,5/6/9%) nella modalità scelta; final_lots = livello selezionato; target_lots = entrambe le modalità
      const rows = opRows.map(r => ({
        portfolio_id: ptf.id, strategy_id: r.s.id, is_active: true, active_level: level,
        lot_conservative: perLevelLots(r, 3.5, asIfProven), lot_neutral: perLevelLots(r, 6, asIfProven), lot_aggressive: perLevelLots(r, 9, asIfProven),
        final_lots: r.lots, lot_suggested: r.lots, dd_budget_allocation_pct: Number(r.mc95Pct.toFixed(2)),
        target_lots: { reduced: redById.get(r.s.id) ?? null, full: fullById.get(r.s.id) ?? null },
      }))
      await supabase.from('qel_portfolio_strategies').insert(rows)
      const overWarn = aggMc95 > maxTot ? ` ⚠ MC95 aggregato ${fmt(aggMc95, 1)}% oltre il limite ${fmt(maxTot, 0)}% del conto` : ''
      setMsg(`Salvato "${ptfName}" (${rows.length} strategie, ${modeName}, livello ${levelName})${overWarn}`)
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
        <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Livello rischio (guida size + scheda)</span>
          <select value={level} onChange={e => setLevel(e.target.value as Level)} className={`border rounded-lg px-2 py-1.5 text-sm ${aggMc95 * DD99_RATIO > maxTot ? 'border-red-400 text-red-600' : 'border-slate-300'}`}>
            {RISK_LEVELS.map(l => <option key={l.key} value={l.key}>{l.name} ({l.mc95}%){l.mc95 * DD99_RATIO > maxTot ? ' — DD reale oltre limite' : ''}</option>)}
          </select></label>
        <div className="text-sm"><span className="block text-xs text-slate-500 mb-1" title="Ridotta = haircut 0,7 alle 0-live (prudente). Piena = tutte come proven.">Modalità size</span>
          <div className="flex gap-1">
            {(['reduced', 'full'] as const).map(m => (
              <button key={m} onClick={() => setSizeMode(m)} className={`px-3 py-1.5 text-sm rounded-lg border ${sizeMode === m ? (m === 'full' ? 'bg-amber-500 text-white border-amber-500' : 'bg-blue-600 text-white border-blue-600') : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>{m === 'full' ? 'Piena' : 'Ridotta'}</button>
            ))}
          </div></div>
        <div className="ml-auto text-sm flex gap-6">
          <span title="Tetto paranoico (correlazione=1)">MC95 aritm. <b className="text-slate-400">{fmt(aggMc95, 1)}%</b></span>
          <span title="Drawdown reale al 99° pct (bootstrap) — il numero vero">DD99 reale <b className={aggMc95 * DD99_RATIO > maxTot ? 'text-red-600' : 'text-slate-900'}>{fmt(aggMc95 * DD99_RATIO, 1)}%</b> <span className="text-xs text-slate-400">/ {fmt(maxTot, 0)}%</span></span>
          <span title="Worst-day reale (decorrelazione temporale)">Worst-day <b className={worstDayPct * TEMPORAL_FLOOR > maxDay ? 'text-red-600' : 'text-slate-900'}>{fmt(worstDayPct * TEMPORAL_FLOOR, 2)}%</b> <span className="text-xs text-slate-400">/ {fmt(maxDay, 0)}%</span></span>
        </div>
      </div>

      {/* Overlay VIX term structure (advisory — azione manuale) */}
      {vix && (() => {
        const vs = vixState(vix.ratio)
        const c = { green: 'bg-green-50 border-green-200 text-green-800', amber: 'bg-amber-50 border-amber-200 text-amber-800', orange: 'bg-orange-50 border-orange-200 text-orange-800', red: 'bg-red-50 border-red-300 text-red-800', slate: 'bg-slate-50 border-slate-200 text-slate-600' }[vs.color]
        return (
          <div className={`flex flex-wrap items-center gap-x-6 gap-y-1 border rounded-xl p-3 text-sm ${c}`}>
            <span className="font-semibold">Guardia crash VIX: {vs.label}</span>
            <span>ratio ^VIX/^VIX3M <b>{fmt(vix.ratio, 3)}</b> <span className="text-xs opacity-70">(VIX {fmt(vix.vix, 1)} / VIX3M {fmt(vix.vix3m, 1)})</span></span>
            <span>Size LONG suggerita <b>{(vs.longDial * 100).toFixed(0)}%</b> <span className="text-xs opacity-70">(short pieni)</span></span>
            <span className="text-xs opacity-70">controllo {vs.cadence} · ultimo dato {vix.ts}</span>
            {vs.longDial < 1 && <span className="text-xs font-medium">⚠ Backwardation: valuta di ridurre/spegnere i LONG a mano (gli short guadagnano nei selloff)</span>}
          </div>
        )
      })()}

      {/* Regime di mercato (analisi mensile) */}
      {regimeBySym.size > 0 && (
        <div className="flex flex-wrap items-center gap-4 bg-white border border-slate-200 rounded-xl p-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={applyRegime} onChange={e => setApplyRegime(e.target.checked)} />
            <span className="font-medium text-slate-800">Adatta i pesi al regime</span>
            <span className="text-xs text-slate-400">(mensile: +15% stili favoriti dal regime, −20% sfavoriti)</span>
          </label>
          <div className="flex flex-wrap gap-2 text-xs">
            {[...regimeBySym.entries()].filter(([sym]) => strats.some(s => sel.has(s.id) && s.asset === sym)).map(([sym, reg]) => (
              <span key={sym} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600">{sym}: <b className="text-slate-800">{REGIME_4Q_LABELS[reg]}</b></span>
            ))}
          </div>
        </div>
      )}

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

      {/* Confronto livelli + valutazione limiti */}
      {levelCompare && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-slate-900 mb-2">Curva di sizing — rischio reale vs paranoico (su 100k = {fmt(equity, 0)})</div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-200">
              <th className="px-2 py-1">Livello</th>
              <th className="px-2 py-1 text-right">MC95 aritm.<br /><span className="text-slate-300 font-normal">(paranoico)</span></th>
              <th className="px-2 py-1 text-right">DD99 reale<span className="text-slate-300"> /{fmt(maxTot, 0)}</span></th>
              <th className="px-2 py-1 text-right">Worst-day reale<span className="text-slate-300"> /{fmt(maxDay, 0)}</span></th>
              <th className="px-2 py-1 text-right">×neutro</th>
              <th className="px-2 py-1 text-right">~ Mensile</th>
              <th className="px-2 py-1 text-right">Mesi/challenge</th>
            </tr></thead>
            <tbody>
              {levelCompare.map(r => (
                <tr key={r.name} className={`border-b border-slate-50 ${r.name === levelName ? 'bg-blue-50' : ''}`}>
                  <td className="px-2 py-1 font-medium text-slate-800">{r.name}{r.name === levelName && <span className="text-xs text-blue-600"> (attivo)</span>}</td>
                  <td className="px-2 py-1 text-right text-slate-400">{fmt(r.arith, 1)}%</td>
                  <td className={`px-2 py-1 text-right font-medium ${r.overReal ? 'text-red-600' : 'text-slate-900'}`}>{fmt(r.ddReal, 1)}%{r.overReal && ' ⚠'}</td>
                  <td className={`px-2 py-1 text-right ${r.overDayReal ? 'text-red-600' : 'text-slate-600'}`}>{fmt(r.dailyReal, 2)}%{r.overDayReal && ' ⚠'}</td>
                  <td className="px-2 py-1 text-right text-slate-500">{fmt(r.mult, 1)}×</td>
                  <td className="px-2 py-1 text-right font-semibold text-slate-900">{fmt(r.monthly, 2)}%</td>
                  <td className="px-2 py-1 text-right">{fmt(r.mesiChallenge, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-400 mt-2"><b>MC95 aritmetico</b> = tetto paranoico (assume che TUTTE correlino insieme — mai avvenuto), mostrato solo come riferimento. <b>DD99 reale</b> = drawdown effettivo al 99° percentile (bootstrap 2021-2026 incl. 2022) ≈ {fmt(DD99_RATIO * 100, 0)}% dell'aritmetico. <b>Worst-day reale</b> = floating tenendo conto della decorrelazione temporale (magic 3 lun, 6 mar disgiunte) ≈ {fmt(TEMPORAL_FLOOR * 100, 0)}% dell'aritmetico. <b>Raccomandato</b>: <i>Reale DD99+30%</i> (~3,5× neutro) — DD99 reale ~6%, worst-day ~3%, entrambi sotto i limiti. ⚠ = oltre il limite del conto. <b>Richiede l'overlay VIX (in arrivo) come guardia dinamica prima del live sui livelli alti.</b> Costanti dal book attuale (PTF_SIM/potenziale_reale.py) — ricalcolare se cambia la composizione.</p>
        </div>
      )}

      {/* Azioni */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl p-4">
        <input value={ptfName} onChange={e => setPtfName(e.target.value)} placeholder="Nome PTF" className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        <button onClick={savePTF} className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">Salva PTF</button>
        <button onClick={exportConfig} className="px-4 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Esporta file</button>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setCompounding(c => !c)} title="Interessi composti nella scheda: OFF = additivo (prop) · ON = reinveste, size cresce con l'equity (conto reale)" className={`px-3 py-1.5 text-sm rounded-lg border ${compounding ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>Composti: {compounding ? 'ON' : 'OFF'}</button>
          <select value={level} onChange={e => setLevel(e.target.value as Level)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" title="Livello rischio (guida size in tabella e scheda)">
            {RISK_LEVELS.map(l => <option key={l.key} value={l.key}>{l.name} ({l.mc95}%)</option>)}
          </select>
          <button onClick={() => exportScheda()} className="px-4 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700">Scheda PDF</button>
        </div>
        {msg && <span className="text-sm text-slate-500 w-full">{msg}</span>}
      </div>

      {/* Tabella */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            <th className="px-3 py-2"></th><th className="px-2 py-2">Magic</th><th className="px-2 py-2">Strategia</th>
            <th className="px-2 py-2">Fattore</th><th className="px-2 py-2 text-right">MC95/lot</th>
            <th className="px-2 py-2 text-right">Backtest R/DD·PF</th><th className="px-2 py-2 text-right">Live: segnali·avg/lot·PF</th>
            <th className="px-2 py-2 text-right" title={`Size operativa (${modeName}) al livello ${levelName}`}>Lotti ({modeName})</th>
            <th className="px-2 py-2 text-right" title={sizeMode === 'full' ? "Size Ridotta: haircut 0,7 alle 0-live (operativa prudente)" : "Size Piena: se tutte fossero live-proven (obiettivo quando le 0-live maturano)"}>{otherModeName}</th>
            <th className="px-2 py-2 text-right">MC95 %</th>
          </tr></thead>
          <tbody>
            {strats.map(s => {
              const r = opRows.find(x => x.s.id === s.id); const on = sel.has(s.id)
              return (
                <tr key={s.id} className={`border-b border-slate-50 ${on ? '' : 'opacity-50'}`}>
                  <td className="px-3 py-2"><input type="checkbox" checked={on} onChange={() => toggle(s.id)} /></td>
                  <td className="px-2 py-2 font-mono text-slate-700">{s.magic}</td>
                  <td className="px-2 py-2 text-slate-900">{s.name} <span className={`text-xs ${s.direction === 'short' ? 'text-red-500' : 'text-slate-400'}`}>{s.direction}</span></td>
                  <td className="px-2 py-2 text-xs text-slate-500">{RISK_FACTOR(s.asset_group)}</td>
                  <td className="px-2 py-2 text-right text-slate-600">{fmt(s.test_mc95_dd, 0)}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{fmt(s.test_ret_dd, 1)} · {fmt(s.test_profit_factor, 2)}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{s.real_trades ? <>{s.real_trades} · {fmt(s.real_avg_per_lot, 1)} · {fmt(s.real_profit_factor, 2)}</> : <span className="text-slate-300">no live</span>}</td>
                  <td className={`px-2 py-2 text-right font-semibold ${sizeMode === 'full' ? 'text-amber-700' : 'text-blue-800'}`}>{r ? (r.lots === 0 ? <span className="text-amber-600" title="spenta dal gate regime (sfavorevole)">OFF</span> : fmt(r.lots, 2)) : '—'}</td>
                  <td className="px-2 py-2 text-right" title={`Size ${otherModeName} (confronto)`}>
                    {r && r.lots > 0 ? (() => {
                      const oc = cmpById.get(s.id)
                      if (!oc) return <span className="text-slate-300">—</span>
                      const cls = oc.lots > r.lots ? 'text-emerald-600' : 'text-slate-400'
                      return <span className={cls}>{fmt(oc.lots, 2)}</span>
                    })() : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-500">{r ? fmt(r.mc95Pct, 2) + '%' : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Sizing per <b>robustezza</b> (Model B): budget MC95 = {ddBudget}% equity distribuito per ret/DD test (non equal-risk, niente Kelly/HRP). In <b>Ridotta</b> le non-provate prendono un haircut assoluto 0,7 senza redistribuire (totale più basso, la provata non si gonfia); in <b>Piena</b> tutte a target. Cap per singola strategia al {fmt(MAX_SINGLE_SHARE * 100, 0)}% del MC95 (niente concentrazione). Worst-day floating = somma (lotti × MAE) delle long. Live deduplicato (un campione per segnale), include lo storico 10K/80K.</p>
      <p className="text-xs text-slate-400"><b>Modalità operativa: {modeName}.</b> {sizeMode === 'reduced'
        ? <>La size operativa applica il haircut 0,7 alle strategie senza storico live (building/0-live): finché un edge non ha provato di reggere dal vivo — slippage, regime, costi reali (cfr. magic 12 breakeven live) — non gli si affida capitale pieno. La colonna <b>Piena</b> mostra la size-obiettivo quando matureranno (validazione live → promozione). Il 0,7 premia la prova sul campo e lascia crescere la size <i>man mano che la strategia se la guadagna</i>.</>
        : <>Size PIENA: haircut rimosso, tutte le strategie trattate come validate (size-obiettivo). La colonna <b>Ridotta</b> è la size prudenziale operativa di default. Usare la Piena solo dove la validazione live è sufficiente (vedi Schede Conto: avviso se strategie non ancora validate).</>}
        {' '}La scelta si salva col PTF (<b>size_policy</b>) e si aggancia al conto. Sistema di sizing invariato: cambia quale delle due size è operativa.</p>
    </div>
  )
}
