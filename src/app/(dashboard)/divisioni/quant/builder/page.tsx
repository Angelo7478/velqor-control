'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelStrategy } from '@/types/database'
import {
  fmt, fmtUsd, fmtPct, plColor, groupColor, styleColor, styleLabel,
  calcKelly, calcHalfKelly, runSizingEngine, SizingInput, PortfolioSizingOutput,
  KellyMode,
} from '@/lib/quant-utils'

interface StrategyWithCosts extends QelStrategy {
  avgCost: number
  avgGrossProfit: number
  netExpectancy: number  // test - costs (theoretical)
  realAvgTrade: number   // actual avg from 10K account
  realPnl10k: number     // total real P/L on 10K
  trades10k: number
  selected: boolean
}

type AccountType = 'ftmo' | 'funded' | 'personal'

export default function BuilderPage() {
  const [strategies, setStrategies] = useState<StrategyWithCosts[]>([])
  const [loading, setLoading] = useState(true)
  const [output, setOutput] = useState<PortfolioSizingOutput | null>(null)

  // Account config
  const [accountType, setAccountType] = useState<AccountType>('ftmo')
  const [capital, setCapital] = useState(10000)
  const [maxDdPct, setMaxDdPct] = useState(10)
  const [dailyDdPct, setDailyDdPct] = useState(5)
  const [safetyFactor, setSafetyFactor] = useState(0.5)
  const [kellyMode, setKellyMode] = useState<KellyMode>('half_kelly')

  useEffect(() => { loadStrategies() }, [])

  async function loadStrategies() {
    const supabase = createClient()

    const { data: strats } = await supabase
      .from('qel_strategies')
      .select('*')
      .in('status', ['active', 'paused'])
      .order('magic')

    // Get cost data from 10K account
    const { data: costData } = await supabase
      .from('qel_trades')
      .select('strategy_id, swap, commission, profit, net_profit')
      .eq('account_id', '759cc852-8e7b-4130-8b3c-29b13a68d659')
      .eq('is_open', false)
      .not('strategy_id', 'is', null)

    // Aggregate costs + real performance per strategy
    const costMap = new Map<string, { totalCost: number; totalGross: number; totalNet: number; count: number }>()
    if (costData) {
      for (const t of costData) {
        if (!t.strategy_id) continue
        if (!costMap.has(t.strategy_id)) costMap.set(t.strategy_id, { totalCost: 0, totalGross: 0, totalNet: 0, count: 0 })
        const c = costMap.get(t.strategy_id)!
        c.totalCost += Math.abs(Number(t.swap ?? 0)) + Math.abs(Number(t.commission ?? 0))
        c.totalGross += Number(t.profit ?? 0)
        c.totalNet += Number(t.net_profit ?? 0)
        c.count++
      }
    }

    if (strats) {
      setStrategies(strats.map(s => {
        const costs = costMap.get(s.id)
        const avgCost = costs && costs.count > 0 ? costs.totalCost / costs.count : 0
        const avgGross = costs && costs.count > 0 ? costs.totalGross / costs.count : 0
        const realAvg = costs && costs.count > 0 ? costs.totalNet / costs.count : 0
        const realPnl = costs?.totalNet ?? 0
        const testExp = s.test_expectancy ?? 0
        return {
          ...s,
          avgCost,
          avgGrossProfit: avgGross,
          netExpectancy: testExp - avgCost,
          realAvgTrade: realAvg,
          realPnl10k: realPnl,
          trades10k: costs?.count ?? 0,
          selected: s.include_in_portfolio && s.status === 'active',
        }
      }))
    }
    setLoading(false)
  }

  function toggleStrategy(id: string) {
    setStrategies(prev => prev.map(s => s.id === id ? { ...s, selected: !s.selected } : s))
    setOutput(null)
  }

  function selectAll() {
    setStrategies(prev => prev.map(s => s.status === 'active' ? { ...s, selected: true } : s))
    setOutput(null)
  }

  function selectNone() {
    setStrategies(prev => prev.map(s => ({ ...s, selected: false })))
    setOutput(null)
  }

  function selectProfitable() {
    // Use REAL P/L data, not theoretical. If no real data, use net expectancy
    setStrategies(prev => prev.map(s => ({
      ...s,
      selected: s.status === 'active' && (
        s.trades10k >= 10 ? s.realPnl10k > 0 : s.netExpectancy > 0
      ),
    })))
    setOutput(null)
  }

  function applyPreset(type: AccountType) {
    setAccountType(type)
    if (type === 'ftmo') { setCapital(10000); setMaxDdPct(10); setDailyDdPct(5); setSafetyFactor(0.5) }
    else if (type === 'funded') { setCapital(100000); setMaxDdPct(10); setDailyDdPct(5); setSafetyFactor(0.5) }
    else { setCapital(10000); setMaxDdPct(20); setDailyDdPct(100); setSafetyFactor(0.7) }
  }

  function optimize() {
    const selected = strategies.filter(s => s.selected)
    if (selected.length === 0) return

    const inputs: SizingInput[] = selected.map(s => ({
      strategyId: s.id,
      magic: s.magic,
      name: s.name || `Magic ${s.magic}`,
      asset: s.asset,
      assetGroup: s.asset_group,
      style: s.strategy_style,
      family: s.strategy_family,
      testWinPct: s.test_win_pct,
      testPayoff: s.test_payoff,
      testMc95Dd: s.test_mc95_dd,
      mc95DdScaled: s.mc95_dd_scaled,
      testExpectancy: s.test_expectancy,
      testMaxDd: s.test_max_dd,
      realTrades: s.real_trades,
      realWinPct: s.real_win_pct,
      realPayoff: s.real_payoff,
      realMaxDd: s.real_max_dd,
      realExpectancy: s.real_expectancy,
      realPl: s.real_pl,
      lotNeutral: s.lot_neutral,
      overlapMed: s.test_overlap_med,
    }))

    const result = runSizingEngine(inputs, capital, maxDdPct, safetyFactor, kellyMode)
    setOutput(result)
  }

  if (loading) return <div className="p-8 text-slate-500">Caricamento...</div>

  const selected = strategies.filter(s => s.selected)
  const ddBudget = capital * (maxDdPct / 100) * safetyFactor
  const families = new Set(selected.map(s => s.strategy_family).filter(Boolean))

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Intestazione */}
      <div>
        <div className="flex items-center gap-2">
          <a href="/divisioni/quant" className="text-slate-400 hover:text-slate-600 text-sm">&larr; Quant</a>
          <span className="text-slate-300">|</span>
          <a href="/divisioni/quant/sizing" className="text-slate-400 hover:text-slate-600 text-sm">Sizing</a>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Portfolio Builder</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Seleziona strategie, configura il conto, genera il sizing ottimale
        </p>
      </div>

      {/* Config conto */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Configurazione Conto</h3>
        <div className="flex flex-wrap gap-4 items-end">
          {/* Preset */}
          <div>
            <label className="text-[10px] uppercase text-slate-400 block mb-1">Tipo conto</label>
            <div className="flex gap-1">
              {([
                { key: 'ftmo', label: 'FTMO' },
                { key: 'funded', label: 'Funded 100K' },
                { key: 'personal', label: 'Capitale proprio' },
              ] as { key: AccountType; label: string }[]).map(t => (
                <button
                  key={t.key}
                  onClick={() => applyPreset(t.key)}
                  className={`px-3 py-1.5 text-xs rounded-lg border ${accountType === t.key ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-400 block mb-1">Capitale ($)</label>
            <input type="number" value={capital} onChange={e => setCapital(Number(e.target.value))}
              className="w-28 text-sm border border-slate-200 rounded px-2 py-1.5" />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-400 block mb-1">Max DD (%)</label>
            <input type="number" value={maxDdPct} onChange={e => setMaxDdPct(Number(e.target.value))}
              className="w-20 text-sm border border-slate-200 rounded px-2 py-1.5" />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-400 block mb-1">Daily DD (%)</label>
            <input type="number" value={dailyDdPct} onChange={e => setDailyDdPct(Number(e.target.value))}
              className="w-20 text-sm border border-slate-200 rounded px-2 py-1.5" />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-400 block mb-1">Safety</label>
            <input type="range" min="0.3" max="1.0" step="0.1" value={safetyFactor}
              onChange={e => setSafetyFactor(parseFloat(e.target.value))} className="w-20" />
            <span className="text-xs ml-1">{fmt(safetyFactor, 1)}</span>
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-400 block mb-1">Kelly</label>
            <select value={kellyMode} onChange={e => setKellyMode(e.target.value as KellyMode)}
              className="text-sm border border-slate-200 rounded px-2 py-1.5">
              <option value="half_kelly">1/2 Kelly</option>
              <option value="quarter_kelly">1/4 Kelly</option>
              <option value="full_kelly">Full Kelly</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100">
          <span className="text-xs text-slate-500">DD Budget: <strong className="text-slate-700">{fmtUsd(ddBudget)}</strong></span>
          <span className="text-xs text-slate-500">Selezionate: <strong className="text-slate-700">{selected.length}</strong></span>
          <span className="text-xs text-slate-500">Famiglie: <strong className="text-slate-700">{families.size}</strong></span>
          <div className="ml-auto flex gap-2">
            <button onClick={selectAll} className="text-xs text-indigo-600 hover:underline">Tutte</button>
            <button onClick={selectProfitable} className="text-xs text-green-600 hover:underline">Solo profittevoli</button>
            <button onClick={selectNone} className="text-xs text-slate-400 hover:underline">Nessuna</button>
          </div>
        </div>
      </div>

      {/* Tabella strategie */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left">
              <th className="px-3 py-2 w-8"></th>
              <th className="px-3 py-2 text-[10px] uppercase text-slate-400">Magic</th>
              <th className="px-3 py-2 text-[10px] uppercase text-slate-400">Strategia</th>
              <th className="px-3 py-2 text-[10px] uppercase text-slate-400">Asset</th>
              <th className="px-3 py-2 text-[10px] uppercase text-slate-400">Famiglia</th>
              <th className="px-3 py-2 text-[10px] uppercase text-slate-400 text-right">Exp. Test</th>
              <th className="px-3 py-2 text-[10px] uppercase text-slate-400 text-right">Costo/trade</th>
              <th className="px-3 py-2 text-[10px] uppercase text-slate-400 text-right">Media reale</th>
              <th className="px-3 py-2 text-[10px] uppercase text-slate-400 text-right">P/L 10K</th>
              <th className="px-3 py-2 text-[10px] uppercase text-slate-400 text-right">Trade</th>
            </tr>
          </thead>
          <tbody>
            {strategies.filter(s => s.status === 'active').map(s => {
              return (
                <tr key={s.id} className={`border-b border-slate-50 ${s.selected ? 'bg-indigo-50/30' : 'opacity-60'} hover:bg-slate-50 cursor-pointer`}
                  onClick={() => toggleStrategy(s.id)}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={s.selected} readOnly
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600" />
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-600">{s.magic}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{s.name}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${groupColor(s.asset_group)}`}>{s.asset_group}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{s.strategy_family || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-500">{fmtUsd(s.test_expectancy, 2)}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-400">{s.avgCost > 0 ? `-${fmt(s.avgCost, 2)}` : '—'}</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold ${plColor(s.realAvgTrade)}`}>
                    {s.trades10k > 0 ? fmtUsd(s.realAvgTrade, 2) : '—'}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono font-bold ${plColor(s.realPnl10k)}`}>
                    {s.trades10k > 0 ? fmtUsd(s.realPnl10k, 0) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-500">{s.trades10k || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Proiezione selezionate */}
      {selected.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Riepilogo selezione</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <div className="text-[10px] uppercase text-slate-400">Strategie</div>
              <div className="text-xl font-bold text-slate-800">{selected.length}</div>
              <div className="text-[10px] text-slate-400">{families.size} famiglie</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-400">P/L reale combinato (10K)</div>
              <div className={`text-xl font-bold ${plColor(selected.reduce((s, x) => s + x.realPnl10k, 0))}`}>
                {fmtUsd(selected.reduce((s, x) => s + x.realPnl10k, 0))}
              </div>
              <div className="text-[10px] text-slate-400">{selected.reduce((s, x) => s + x.trades10k, 0)} trade totali</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-400">Media reale per trade</div>
              {(() => {
                const totalTrades = selected.reduce((s, x) => s + x.trades10k, 0)
                const totalPnl = selected.reduce((s, x) => s + x.realPnl10k, 0)
                const avg = totalTrades > 0 ? totalPnl / totalTrades : 0
                return <div className={`text-xl font-bold ${plColor(avg)}`}>{fmtUsd(avg, 2)}</div>
              })()}
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-400">In perdita (reale)</div>
              <div className="text-xl font-bold text-red-600">
                {selected.filter(s => s.trades10k >= 10 && s.realPnl10k < 0).length}
              </div>
              <div className="text-[10px] text-slate-400">con &ge;10 trade</div>
            </div>
          </div>

          {/* Mini bar per strategia */}
          <div className="space-y-1">
            {selected
              .filter(s => s.trades10k > 0)
              .sort((a, b) => b.realPnl10k - a.realPnl10k)
              .map(s => {
                const maxAbs = Math.max(...selected.filter(x => x.trades10k > 0).map(x => Math.abs(x.realPnl10k)), 1)
                const pct = (s.realPnl10k / maxAbs) * 50
                return (
                  <div key={s.id} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-slate-500 w-6">M{s.magic}</span>
                    <div className="flex-1 h-4 relative">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-200" />
                      {s.realPnl10k >= 0 ? (
                        <div className="absolute top-0 h-full bg-green-400 rounded-r" style={{ left: '50%', width: `${Math.abs(pct)}%` }} />
                      ) : (
                        <div className="absolute top-0 h-full bg-red-400 rounded-l" style={{ right: '50%', width: `${Math.abs(pct)}%` }} />
                      )}
                    </div>
                    <span className={`text-[10px] font-mono w-14 text-right ${plColor(s.realPnl10k)}`}>{fmtUsd(s.realPnl10k, 0)}</span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Bottone ottimizza */}
      <div className="flex items-center gap-3">
        <button onClick={optimize} disabled={selected.length === 0}
          className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
          Genera Sizing per {selected.length} strategie
        </button>
        {output && <span className="text-xs text-slate-400">Budget {fmtUsd(ddBudget)} | {output.familyCount} famiglie | DD usato {fmtPct(output.totalDdBudgetUsedPct)}</span>}
      </div>

      {/* Risultati */}
      {output && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Configurazione Generata</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-left">Magic</th>
                  <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-left">Strategia</th>
                  <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-left">Famiglia</th>
                  <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-right">HRP %</th>
                  <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-right">DD Budget</th>
                  <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-right font-bold">Lotti</th>
                  <th className="px-2 py-2 text-[10px] uppercase text-slate-400 text-right">RoR %</th>
                </tr>
              </thead>
              <tbody>
                {output.results.map((r, i) => {
                  const s = selected[i]
                  return (
                    <tr key={r.strategyId} className="border-b border-slate-50">
                      <td className="px-2 py-2 font-mono text-slate-600">{s?.magic}</td>
                      <td className="px-2 py-2 text-slate-800">{s?.name}</td>
                      <td className="px-2 py-2 text-xs text-slate-500">{r.family}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-600">{fmtPct(r.ddBudgetPct)}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-600">{fmtUsd(r.ddBudgetUsd)}</td>
                      <td className="px-2 py-2 text-right font-mono font-bold text-indigo-700">{fmt(r.recommendedLots, 3)}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-500">{r.rorPct !== null ? fmtPct(r.rorPct * 100, 3) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-bold">
                  <td colSpan={4} className="px-2 py-2 text-sm text-slate-700">Totale DD Budget usato</td>
                  <td className="px-2 py-2 text-right font-mono text-slate-700">{fmtUsd(output.totalDdBudgetUsedUsd)}</td>
                  <td className="px-2 py-2 text-right font-mono text-indigo-700">{fmtPct(output.totalDdBudgetUsedPct)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Family allocation */}
          {output.familyBalance && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Allocazione per famiglia</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(output.familyBalance).sort(([,a],[,b]) => b.weight - a.weight).map(([fam, data]) => (
                  <div key={fam} className="bg-slate-50 rounded-lg px-3 py-1.5 text-xs">
                    <span className="font-medium text-slate-700">{fam}</span>
                    <span className="text-slate-400 ml-1">{fmt(data.weight, 1)}% ({data.strategies} strat.)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
