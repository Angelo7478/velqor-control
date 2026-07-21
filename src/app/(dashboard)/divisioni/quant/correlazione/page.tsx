'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useUI } from '@/stores/ui'

type Account = { id: string; name: string; login: string | null; account_size: number | null; status: string }
type Strat = { magic: number; name: string; asset: string | null; direction: string | null; strategy_style: string | null; status: string | null; include_in_portfolio: boolean | null }
type Profile = { magic: number; trades: number; dal: string; al: string; durata_media_h: number | null; durata_max_h: number | null; avg_per_lot: number | null; win_pct: number | null; profit_factor: number | null; worst_mae: number | null; ora_tipica: number | null; pct_long: number | null; trades_per_month: number | null }
type Overlap = { magic_a: number; magic_b: number; overlap_pct: number; ore_insieme: number }
type Correl = { magic_a: number; magic_b: number; corr_daily: number | null }
type Live = { magic: number; signals: number; avg_per_lot: number | null; win_pct: number | null; profit_factor: number | null; first_signal: string | null; last_signal: string | null }
type PortRow = { portfolio_id: string; strategy_id: string; qel_strategies: { magic: number | null } | null }
type Port = { id: string; account_id: string }

// Soglie: la scala termica e' la stessa per overlap e correlazione, cosi' i due pannelli
// si leggono con lo stesso colpo d'occhio. Verde = indipendenti, rosso = stesso rischio.
function heat(v: number | null, hi: number, mid: number): string {
  if (v == null) return 'bg-slate-50 text-slate-300'
  const a = Math.abs(v)
  if (a >= hi) return 'bg-red-100 text-red-800 font-semibold'
  if (a >= mid) return 'bg-amber-100 text-amber-800'
  if (a >= mid / 2) return 'bg-yellow-50 text-yellow-700'
  return 'bg-green-50 text-green-700'
}

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export default function CorrelazionePage() {
  const marketType = useUI((s) => s.marketType)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accId, setAccId] = useState<string>('')
  const [strats, setStrats] = useState<Strat[]>([])
  const [prof, setProf] = useState<Map<number, Profile>>(new Map())
  const [ov, setOv] = useState<Overlap[]>([])
  const [cr, setCr] = useState<Correl[]>([])
  const [live, setLive] = useState<Map<number, Live>>(new Map())
  const [portMagics, setPortMagics] = useState<Map<string, number[]>>(new Map())
  const [ports, setPorts] = useState<Port[]>([])
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState<'overlap' | 'corr'>('overlap')

  // Il reset di accId deve restare sincrono: una load cancellata non lo scrive, e un toggle
  // andata-e-ritorno riscriverebbe lo stesso id -> bail-out di React -> niente ricarica.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setAccId('')
    load(() => cancelled)
    return () => { cancelled = true }
  }, [marketType])

  async function load(isStale: () => boolean) {
    try {
      const supabase = createClient()
      const [accRes, stRes, pfRes, ovRes, crRes, lvRes, psRes, poRes] = await Promise.all([
        // solo conti ATTIVI: gli storici confondono e non hanno un book vivo da confrontare
        supabase.from('qel_accounts').select('id,name,login,account_size,status')
          .eq('market_type', marketType).eq('status', 'active').order('account_size', { ascending: false }),
        supabase.from('qel_strategies').select('magic,name,asset,direction,strategy_style,status,include_in_portfolio')
          .eq('market_type', marketType).order('magic'),
        supabase.from('v_bt_profile').select('*'),
        supabase.from('v_bt_overlap').select('magic_a,magic_b,overlap_pct,ore_insieme'),
        supabase.from('v_bt_correlation').select('magic_a,magic_b,corr_daily'),
        // per STRATEGIA, non per base_magic: la 30 gira col magic 3 e con base_magic risulterebbe a zero
        supabase.from('v_strategy_live_by_id').select('magic,signals,avg_per_lot,win_pct,profit_factor,first_signal,last_signal'),
        supabase.from('qel_portfolio_strategies').select('portfolio_id,strategy_id,qel_strategies(magic)'),
        supabase.from('qel_portfolios').select('id,account_id').eq('is_active', true),
      ])
      if (isStale()) return
      const accs = (accRes.data as Account[]) || []
      setAccounts(accs)
      setAccId(accs[0]?.id ?? '')
      setStrats((stRes.data as Strat[]) || [])
      const pm = new Map<number, Profile>()
      for (const p of ((pfRes.data as Profile[]) || [])) pm.set(Number(p.magic), p)
      setProf(pm)
      setOv((ovRes.data as Overlap[]) || [])
      setCr((crRes.data as Correl[]) || [])
      const lm = new Map<number, Live>()
      for (const l of ((lvRes.data as Live[]) || [])) lm.set(Number(l.magic), l)
      setLive(lm)
      setPorts((poRes.data as Port[]) || [])
      const map = new Map<string, number[]>()
      for (const r of ((psRes.data as unknown as PortRow[]) || [])) {
        const m = r.qel_strategies?.magic
        if (m == null) continue
        const arr = map.get(r.portfolio_id) || []
        arr.push(Number(m)); map.set(r.portfolio_id, arr)
      }
      setPortMagics(map)
    } finally {
      if (!isStale()) setLoading(false)
    }
  }

  // I magic del conto selezionato = quelli dei suoi portfolio attivi
  const magics = useMemo(() => {
    const pIds = ports.filter(p => p.account_id === accId).map(p => p.id)
    const set = new Set<number>()
    for (const p of pIds) for (const m of (portMagics.get(p) || [])) set.add(m)
    return [...set].sort((a, b) => a - b)
  }, [accId, ports, portMagics])

  const nameOf = (m: number) => strats.find(s => s.magic === m)?.name ?? `magic ${m}`
  const ovOf = (a: number, b: number) => ov.find(x => (x.magic_a === a && x.magic_b === b) || (x.magic_a === b && x.magic_b === a))?.overlap_pct ?? null
  const crOf = (a: number, b: number) => cr.find(x => (x.magic_a === a && x.magic_b === b) || (x.magic_a === b && x.magic_b === a))?.corr_daily ?? null

  // Le coppie che meritano attenzione: overlap alto = stesso rischio con due nomi
  const duplicati = useMemo(() => {
    const out: { a: number; b: number; ovl: number; corr: number | null }[] = []
    for (let i = 0; i < magics.length; i++)
      for (let j = i + 1; j < magics.length; j++) {
        const o = ovOf(magics[i], magics[j])
        if (o != null && o >= 25) out.push({ a: magics[i], b: magics[j], ovl: o, corr: crOf(magics[i], magics[j]) })
      }
    return out.sort((x, y) => y.ovl - x.ovl)
  }, [magics, ov, cr])

  const acc = accounts.find(a => a.id === accId)

  if (loading) return <p className="text-slate-500">Caricamento…</p>

  if (!accounts.length) return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Correlazione &amp; Overlap</h1>
      <p className="text-slate-500">Nessun conto attivo in questa macro.</p>
    </div>
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Correlazione &amp; Overlap</h1>
        <p className="text-sm text-slate-500 mt-1">
          Quanto le strategie di un conto si somigliano <b>davvero</b>. La matrice di correlazione dice come si muovono i
          rendimenti; l&apos;<b>overlap</b> dice quante ore stanno in mercato <b>insieme</b> — ed è quest&apos;ultimo a
          decidere. Due strategie possono avere correlazione ~0 e aprire sempre negli stessi momenti: stesso rischio,
          due nomi. Dati dai <b>tradelist di backtest</b> (per-trade), confrontati col <b>live</b> dove c&apos;è campione.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-600">Conto</label>
        <select value={accId} onChange={e => setAccId(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white">
          {accounts.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}{a.account_size ? ` · ${(Number(a.account_size) / 1000).toFixed(0)}k` : ''}
            </option>
          ))}
        </select>
        <div className="flex rounded-lg overflow-hidden border border-slate-200">
          {(['overlap', 'corr'] as const).map(v => (
            <button key={v} onClick={() => setVista(v)}
              className={`px-3 py-1.5 text-sm ${vista === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {v === 'overlap' ? 'Overlap posizioni' : 'Correlazione rendimenti'}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">{magics.length} strategie nel book di {acc?.name ?? '—'}</span>
      </div>

      {!magics.length ? (
        <p className="text-slate-500 text-sm">Questo conto non ha un portafoglio attivo con strategie.</p>
      ) : (
        <>
          {/* MATRICE TERMICA */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 overflow-x-auto">
            <h2 className="font-semibold text-slate-900 mb-1">
              {vista === 'overlap' ? 'Ore in mercato insieme (% del tempo della più piccola)' : 'Correlazione dei rendimenti giornalieri'}
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              {vista === 'overlap'
                ? 'Verde sotto il 12% · giallo fino al 25% · ambra fino al 30% · rosso oltre: da trattare come una strategia sola per il rischio.'
                : 'Verde sotto 0,17 · ambra da 0,35 · rosso da 0,6 (duplicato). Fra 0,35 e 0,6 guarda sempre anche l\'overlap.'}
            </p>
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="p-1.5 text-left text-slate-400 font-normal sticky left-0 bg-white">magic</th>
                  {magics.map(m => <th key={m} className="p-1.5 text-slate-600 font-mono w-14">{m}</th>)}
                </tr>
              </thead>
              <tbody>
                {magics.map(a => (
                  <tr key={a}>
                    <th className="p-1.5 text-left font-mono text-slate-600 sticky left-0 bg-white whitespace-nowrap"
                        title={nameOf(a)}>{a} <span className="text-slate-400 font-sans">{nameOf(a).slice(0, 18)}</span></th>
                    {magics.map(b => {
                      if (a === b) return <td key={b} className="p-1.5 text-center bg-slate-900/5 text-slate-300">—</td>
                      const v = vista === 'overlap' ? ovOf(a, b) : crOf(a, b)
                      const cls = vista === 'overlap' ? heat(v, 30, 25) : heat(v, 0.6, 0.35)
                      return (
                        <td key={b} className={`p-1.5 text-center ${cls}`}
                            title={`${nameOf(a)} × ${nameOf(b)}`}>
                          {v == null ? '—' : vista === 'overlap' ? `${fmt(v, 0)}%` : fmt(v, 2)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* COPPIE SOSPETTE */}
          {duplicati.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <h2 className="font-semibold text-amber-900 mb-2">Coppie da guardare — stanno in mercato insieme</h2>
              <div className="space-y-1.5">
                {duplicati.map(d => (
                  <div key={`${d.a}-${d.b}`} className="text-sm text-amber-900">
                    <b>{d.a}</b> {nameOf(d.a)} <span className="text-amber-500">×</span> <b>{d.b}</b> {nameOf(d.b)}
                    {' — '}insieme il <b>{fmt(d.ovl, 0)}%</b> del tempo
                    {d.corr != null && <span className="text-amber-700"> · correlazione rendimenti {fmt(d.corr, 2)}</span>}
                    {d.corr != null && Math.abs(d.corr) < 0.2 && d.ovl >= 30 &&
                      <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 align-middle">
                        correlazione bassa ma stesso trade
                      </span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CONFRONTO BACKTEST vs LIVE */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 overflow-x-auto">
            <h2 className="font-semibold text-slate-900 mb-1">Backtest contro live — siamo allineati?</h2>
            <p className="text-xs text-slate-500 mb-3">
              La <b>frequenza</b> si giudica subito (contare eventi richiede pochi dati): se il live opera molto più del
              test, di solito è un EA fuori spec, non un edge diverso. L&apos;<b>edge</b> per operazione richiede invece
              decine di segnali: sotto i 20 la colonna resta grigia perché sarebbe rumore.
            </p>
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-2 py-2 text-left">magic</th>
                  <th className="px-2 py-2 text-left">strategia</th>
                  <th className="px-2 py-2 text-right">trade test</th>
                  <th className="px-2 py-2 text-right">op/mese test</th>
                  <th className="px-2 py-2 text-right">op/mese live</th>
                  <th className="px-2 py-2 text-right">rapporto</th>
                  <th className="px-2 py-2 text-right">€/lotto test</th>
                  <th className="px-2 py-2 text-right">€/lotto live</th>
                  <th className="px-2 py-2 text-right">edge %</th>
                  <th className="px-2 py-2 text-right">durata media</th>
                </tr>
              </thead>
              <tbody>
                {magics.map(m => {
                  const p = prof.get(m); const l = live.get(m)
                  let liveMese: number | null = null
                  if (l?.first_signal && l?.last_signal && l.signals) {
                    const gg = (new Date(l.last_signal).getTime() - new Date(l.first_signal).getTime()) / 86400000
                    liveMese = l.signals / Math.max(gg / 30.44, 0.5)
                  }
                  // Sotto 4 segnali il rapporto non e' un giudizio ma rumore: un rosso su un trade
                  // solo fa spegnere strategie sane. Stessa disciplina della colonna edge.
                  const nFreq = (l?.signals ?? 0) >= 4
                  const rap = nFreq && liveMese != null && p?.trades_per_month ? liveMese / Number(p.trades_per_month) : null
                  const edgePct = l?.avg_per_lot != null && p?.avg_per_lot ? (Number(l.avg_per_lot) / Number(p.avg_per_lot)) * 100 : null
                  const nSuff = (l?.signals ?? 0) >= 20
                  return (
                    <tr key={m} className="border-b border-slate-50">
                      <td className="px-2 py-2 font-mono text-slate-700">{m}</td>
                      <td className="px-2 py-2 text-slate-800">{nameOf(m)}</td>
                      <td className="px-2 py-2 text-right text-slate-600">{p?.trades ?? '—'}</td>
                      <td className="px-2 py-2 text-right text-slate-600">{fmt(p?.trades_per_month, 1)}</td>
                      <td className="px-2 py-2 text-right text-slate-600">{liveMese == null ? '—' : fmt(liveMese, 1)}</td>
                      <td className={`px-2 py-2 text-right ${rap == null ? 'text-slate-300' : rap > 1.5 || rap < 0.5 ? 'text-red-700 font-semibold' : 'text-green-700'}`}
                          title={rap == null && (l?.signals ?? 0) > 0 ? `solo ${l?.signals} segnale/i: sotto 4 non si giudica` : undefined}>
                        {rap == null ? (l?.signals ? 'poco campione' : '—') : `${fmt(rap, 2)}×`}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-600">{fmt(p?.avg_per_lot, 1)}</td>
                      <td className="px-2 py-2 text-right text-slate-600">{l?.avg_per_lot == null ? '—' : fmt(l.avg_per_lot, 1)}</td>
                      <td className={`px-2 py-2 text-right ${!nSuff ? 'text-slate-300' : edgePct == null ? 'text-slate-300' : edgePct < 80 ? 'text-red-700 font-semibold' : edgePct > 120 ? 'text-blue-700' : 'text-green-700'}`}
                          title={nSuff ? undefined : `campione ${l?.signals ?? 0} segnali: sotto 20 non si giudica`}>
                        {!nSuff ? 'poco campione' : edgePct == null ? '—' : `${fmt(edgePct, 0)}%`}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-500">{p?.durata_media_h == null ? '—' : `${fmt(p.durata_media_h, 1)}h`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
