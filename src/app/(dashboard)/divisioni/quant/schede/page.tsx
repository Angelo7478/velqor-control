'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import QuantNav from '../quant-nav'

type Strat = {
  id: string
  magic: number | null
  name: string | null
  asset: string | null
  timeframe: string | null
  direction: string | null
  status: string | null
  test_period: string | null
  test_trades: number | null
  test_win_pct: number | null
  test_profit_factor: number | null
  test_max_dd: number | null
  test_ret_dd: number | null
  test_mc95_dd: number | null
  test_sharpe: number | null
  notes: string | null
}
type TestRow = {
  id: string
  strategy_id: string
  test_type: string
  test_date: string | null
  period_start: string | null
  period_end: string | null
  trades: number | null
  win_pct: number | null
  max_dd: number | null
  ret_dd: number | null
  mc95_dd: number | null
  profit_factor: number | null
  sharpe: number | null
  parameters: Record<string, unknown> | null
  notes: string | null
}
type FileRow = {
  id: string
  strategy_id: string
  file_type: string
  file_name: string
  file_path: string
  description: string | null
}

function fmt(n: number | null | undefined, d = 0): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: d })
}

function testBadge(t: string): string {
  switch (t) {
    case 'backtest': return 'bg-blue-100 text-blue-700'
    case 'wfm': return 'bg-violet-100 text-violet-700'
    case 'monte_carlo': return 'bg-emerald-100 text-emerald-700'
    case 'spp': return 'bg-amber-100 text-amber-700'
    case 'live_review': return 'bg-rose-100 text-rose-700'
    default: return 'bg-slate-100 text-slate-600'
  }
}

function fileIcon(t: string): string {
  if (t.startsWith('code')) return '📄'
  if (t === 'pdf_report') return '📕'
  if (t.startsWith('sqx_monte')) return '🎲'
  if (t.startsWith('sqx_wfm')) return '🔁'
  if (t.startsWith('sqx_spp')) return '📐'
  if (t.startsWith('sqx')) return '📊'
  if (t === 'csv_data') return '📈'
  if (t === 'set_file') return '⚙️'
  return '📎'
}

export default function SchedeStrategiePage() {
  const [strats, setStrats] = useState<Strat[]>([])
  const [tests, setTests] = useState<TestRow[]>([])
  const [files, setFiles] = useState<FileRow[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = createClient()
    const [s, t, f] = await Promise.all([
      supabase.from('qel_strategies').select('id, magic, name, asset, timeframe, direction, status, test_period, test_trades, test_win_pct, test_profit_factor, test_max_dd, test_ret_dd, test_mc95_dd, test_sharpe, notes').order('magic'),
      supabase.from('qel_strategy_tests').select('*').order('test_date', { ascending: false }),
      supabase.from('qel_strategy_files').select('id, strategy_id, file_type, file_name, file_path, description').order('file_type'),
    ])
    const ss = (s.data as Strat[]) || []
    setStrats(ss)
    setTests((t.data as TestRow[]) || [])
    setFiles((f.data as FileRow[]) || [])
    // default: prima strategia con dei test
    const withTests = new Set(((t.data as TestRow[]) || []).map(r => r.strategy_id))
    setSel(ss.find(x => withTests.has(x.id))?.id || ss[0]?.id || null)
    setLoading(false)
  }

  if (loading) return <p className="text-slate-500 p-4">Caricamento...</p>

  const testCount: Record<string, number> = {}
  tests.forEach(t => { testCount[t.strategy_id] = (testCount[t.strategy_id] || 0) + 1 })
  const s = strats.find(x => x.id === sel) || null
  const sTests = tests.filter(t => t.strategy_id === sel)
  const sFiles = files.filter(f => f.strategy_id === sel)

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <QuantNav />
        <div className="mt-1">
          <h1 className="text-2xl font-bold text-slate-900">Schede Strategie</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Archivio Strategy Intelligence: parametri, test (backtest, WFM, Monte Carlo, SPP, live) e file su Drive per ogni strategia.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* lista strategie */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden h-fit">
          {strats.map(x => (
            <button
              key={x.id}
              onClick={() => setSel(x.id)}
              className={`w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-slate-50 transition-colors ${sel === x.id ? 'bg-violet-50' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">#{x.magic} {x.name}</span>
                {testCount[x.id] ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">{testCount[x.id]}</span>
                ) : (
                  <span className="text-[10px] text-slate-300">—</span>
                )}
              </div>
              <span className="text-[11px] text-slate-400">{x.asset} · {x.timeframe} · {x.direction}</span>
            </button>
          ))}
        </div>

        {/* dettaglio scheda */}
        <div className="space-y-4">
          {!s && <p className="text-slate-500">Seleziona una strategia.</p>}
          {s && (
            <>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">#{s.magic} · {s.name}</h2>
                    <p className="text-xs text-slate-400">{s.asset} · {s.timeframe} · {s.direction} · stato {s.status}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                  {[
                    { l: 'Profit Factor', v: fmt(s.test_profit_factor, 2) },
                    { l: 'Max DD', v: s.test_max_dd != null ? `$${fmt(s.test_max_dd)}` : '—' },
                    { l: 'Ret/DD', v: fmt(s.test_ret_dd, 1) },
                    { l: 'MC95 DD', v: s.test_mc95_dd != null ? `$${fmt(s.test_mc95_dd)}` : '—' },
                    { l: 'Sharpe', v: fmt(s.test_sharpe, 2) },
                    { l: 'Trade', v: fmt(s.test_trades) },
                    { l: 'Win %', v: s.test_win_pct != null ? `${fmt(s.test_win_pct, 1)}%` : '—' },
                  ].map((k, i) => (
                    <div key={i} className="bg-slate-50 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-slate-400 uppercase">{k.l}</p>
                      <p className="text-sm font-bold text-slate-800">{k.v}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">Periodo test: {s.test_period || '—'}</p>
                {s.notes && <p className="text-xs text-slate-500 mt-2 bg-amber-50 rounded-lg p-2">{s.notes}</p>}
              </div>

              {/* test */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2 border-b border-slate-100"><h3 className="text-sm font-semibold text-slate-700">Test ({sTests.length})</h3></div>
                {sTests.length === 0 && <p className="text-sm text-slate-400 p-4">Nessun test registrato.</p>}
                {sTests.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="text-slate-400 text-left bg-slate-50">
                        <th className="font-medium px-3 py-1.5">Tipo</th>
                        <th className="font-medium px-3 py-1.5">Data</th>
                        <th className="font-medium px-3 py-1.5">Periodo</th>
                        <th className="font-medium px-3 py-1.5 text-right">Trade</th>
                        <th className="font-medium px-3 py-1.5 text-right">PF</th>
                        <th className="font-medium px-3 py-1.5 text-right">Max DD</th>
                        <th className="font-medium px-3 py-1.5 text-right">MC95</th>
                        <th className="font-medium px-3 py-1.5">Note</th>
                      </tr></thead>
                      <tbody>
                        {sTests.map(t => (
                          <tr key={t.id} className="border-t border-slate-100 align-top">
                            <td className="px-3 py-1.5"><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${testBadge(t.test_type)}`}>{t.test_type}</span></td>
                            <td className="px-3 py-1.5 text-slate-500">{t.test_date || '—'}</td>
                            <td className="px-3 py-1.5 text-slate-500">{t.period_start && t.period_end ? `${t.period_start} → ${t.period_end}` : '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-slate-600">{fmt(t.trades)}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-slate-600">{fmt(t.profit_factor, 2)}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-slate-600">{t.max_dd != null ? `$${fmt(t.max_dd)}` : '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono font-semibold text-slate-800">{t.mc95_dd != null ? `$${fmt(t.mc95_dd)}` : '—'}</td>
                            <td className="px-3 py-1.5 text-slate-500 max-w-[260px]">{t.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* file */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2 border-b border-slate-100"><h3 className="text-sm font-semibold text-slate-700">File su Drive ({sFiles.length})</h3></div>
                {sFiles.length === 0 && <p className="text-sm text-slate-400 p-4">Nessun file indicizzato.</p>}
                <div className="divide-y divide-slate-100">
                  {sFiles.map(f => (
                    <div key={f.id} className="px-4 py-2 flex items-start gap-2">
                      <span>{fileIcon(f.file_type)}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-700 truncate">{f.file_name}</p>
                        <p className="text-[10px] text-slate-400">{f.file_type}{f.description ? ` · ${f.description}` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
