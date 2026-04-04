'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelStrategy, QelPortfolio, QelPortfolioStrategy, QelAccount } from '@/types/database'
import {
  fmt, fmtUsd, fmtPct, fmtLots, plColor, ddBarColor, statusBadge,
  groupColor, styleColor, styleLabel, fitnessColor, fitnessLabel,
  calcKelly, calcHalfKelly, calcRiskOfRuin, calcFitnessScore,
  runSizingEngine, SizingInput, PortfolioSizingOutput, KellyMode, KELLY_MODES,
  FTMO_DAILY_DD_LIMIT, FTMO_TOTAL_DD_LIMIT,
} from '@/lib/quant-utils'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts'

type Tab = 'grid' | 'dd_budget' | 'fitness'

interface StrategyRow extends QelStrategy {
  ps?: QelPortfolioStrategy
}

export default function SizingPage() {
  const [portfolios, setPortfolios] = useState<QelPortfolio[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState<QelPortfolio | null>(null)
  const [account, setAccount] = useState<QelAccount | null>(null)
  const [strategies, setStrategies] = useState<StrategyRow[]>([])
  const [output, setOutput] = useState<PortfolioSizingOutput | null>(null)
  const [tab, setTab] = useState<Tab>('grid')
  const [kellyMode, setKellyMode] = useState<KellyMode>('half_kelly')
  const [safetyFactor, setSafetyFactor] = useState(0.5)
  const [loading, setLoading] = useState(true)
  const [optimizing, setOptimizing] = useState(false)
  const [lastRun, setLastRun] = useState<string | null>(null)

  useEffect(() => { loadPortfolios() }, [])
  useEffect(() => { if (selectedPortfolio) loadPortfolioData(selectedPortfolio) }, [selectedPortfolio])

  async function loadPortfolios() {
    const supabase = createClient()
    const { data } = await supabase.from('qel_portfolios').select('*').eq('is_active', true).order('name')
    if (data && data.length > 0) {
      setPortfolios(data)
      setSelectedPortfolio(data[0])
    }
    setLoading(false)
  }

  async function loadPortfolioData(portfolio: QelPortfolio) {
    const supabase = createClient()
    setLoading(true)

    const [accRes, psRes, stratRes] = await Promise.all([
      portfolio.account_id
        ? supabase.from('qel_accounts').select('*').eq('id', portfolio.account_id).single()
        : Promise.resolve({ data: null }),
      supabase.from('qel_portfolio_strategies').select('*').eq('portfolio_id', portfolio.id),
      supabase.from('qel_strategies').select('*').order('magic'),
    ])

    if (accRes.data) setAccount(accRes.data)

    const psMap = new Map<string, QelPortfolioStrategy>()
    if (psRes.data) {
      for (const ps of psRes.data) psMap.set(ps.strategy_id, ps)
    }

    if (stratRes.data) {
      const linked = stratRes.data
        .filter(s => psMap.has(s.id))
        .map(s => ({ ...s, ps: psMap.get(s.id) }))
      setStrategies(linked)
    }

    setSafetyFactor(portfolio.safety_factor || 0.5)
    setKellyMode((portfolio.kelly_fraction_mode as KellyMode) || 'half_kelly')
    setLastRun(portfolio.last_optimization_at || null)
    setLoading(false)
  }

  function runOptimization() {
    if (!selectedPortfolio || strategies.length === 0) return
    setOptimizing(true)

    const inputs: SizingInput[] = strategies.map(s => ({
      strategyId: s.id,
      magic: s.magic,
      name: s.name || `Magic ${s.magic}`,
      asset: s.asset,
      assetGroup: s.asset_group,
      style: s.strategy_style,
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

    const result = runSizingEngine(
      inputs,
      selectedPortfolio.equity_base,
      selectedPortfolio.max_dd_target_pct,
      safetyFactor,
      kellyMode
    )

    setOutput(result)
    setOptimizing(false)
    setLastRun(new Date().toISOString())

    // Save run to DB
    saveRun(result)
  }

  async function saveRun(result: PortfolioSizingOutput) {
    if (!selectedPortfolio) return
    const supabase = createClient()
    await supabase.from('qel_sizing_engine_runs').insert({
      portfolio_id: selectedPortfolio.id,
      account_id: selectedPortfolio.account_id,
      run_type: 'manual',
      input_params: { kellyMode, safetyFactor, equityBase: selectedPortfolio.equity_base },
      output_summary: {
        ddBudgetUsedPct: result.totalDdBudgetUsedPct,
        ddBudgetUsedUsd: result.totalDdBudgetUsedUsd,
        strategyCount: result.strategyCount,
        avgRor: result.avgRor,
        styleBalance: result.styleBalance,
      },
      strategy_results: result.results,
    })

    // Update portfolio timestamp
    await supabase.from('qel_portfolios').update({
      last_optimization_at: new Date().toISOString(),
      optimization_result: { kellyMode, safetyFactor, ...result },
    }).eq('id', selectedPortfolio.id)
  }

  if (loading) {
    return <div className="p-8 text-slate-500">Caricamento...</div>
  }

  const ddBudgetUsd = selectedPortfolio
    ? selectedPortfolio.equity_base * (selectedPortfolio.max_dd_target_pct / 100) * safetyFactor
    : 0

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <a href="/divisioni/quant" className="text-slate-400 hover:text-slate-600 text-sm">&larr; Quant</a>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Sizing Engine</h1>
          <p className="text-sm text-slate-500 mt-0.5">Position sizing istituzionale — Kelly / Half-Kelly / Risk of Ruin</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Portfolio selector */}
          <select
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white"
            value={selectedPortfolio?.id || ''}
            onChange={e => {
              const p = portfolios.find(p => p.id === e.target.value)
              if (p) setSelectedPortfolio(p)
            }}
          >
            {portfolios.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={runOptimization}
            disabled={optimizing || strategies.length === 0}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {optimizing ? 'Calcolo...' : 'Ottimizza'}
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <KPI label="Equity Base" value={fmtUsd(selectedPortfolio?.equity_base)} />
        <KPI label="DD Budget" value={fmtUsd(ddBudgetUsd)} sub={`${fmtPct(selectedPortfolio?.max_dd_target_pct)} x ${fmt(safetyFactor, 1)} SF`} />
        <KPI
          label="DD Usato"
          value={output ? fmtUsd(output.totalDdBudgetUsedUsd) : '—'}
          sub={output ? fmtPct(output.totalDdBudgetUsedPct) : '—'}
          color={output && output.totalDdBudgetUsedPct > 90 ? 'text-red-600' : output && output.totalDdBudgetUsedPct > 70 ? 'text-amber-600' : 'text-green-600'}
        />
        <KPI label="Strategie" value={`${strategies.length}`} />
        <KPI label="Kelly Mode" value={kellyMode === 'half_kelly' ? 'Half' : kellyMode === 'quarter_kelly' ? '1/4' : 'Full'} />
        <KPI label="RoR Medio" value={output?.avgRor !== null && output?.avgRor !== undefined ? fmtPct(output.avgRor * 100, 4) : '—'} />
      </div>

      {/* Parameters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Kelly Mode</label>
            <select
              className="text-sm border border-slate-200 rounded px-2 py-1"
              value={kellyMode}
              onChange={e => setKellyMode(e.target.value as KellyMode)}
            >
              <option value="half_kelly">Half Kelly (1/2)</option>
              <option value="quarter_kelly">Quarter Kelly (1/4)</option>
              <option value="full_kelly">Full Kelly</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Safety Factor</label>
            <input
              type="range" min="0.3" max="1.0" step="0.1"
              value={safetyFactor}
              onChange={e => setSafetyFactor(parseFloat(e.target.value))}
              className="w-24"
            />
            <span className="text-sm font-mono text-slate-700">{fmt(safetyFactor, 1)}</span>
          </div>
          {lastRun && (
            <span className="text-xs text-slate-400 ml-auto">
              Ultimo run: {new Date(lastRun).toLocaleString('it-IT')}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {([
          { key: 'grid', label: 'Strategy Grid' },
          { key: 'dd_budget', label: 'DD Budget' },
          { key: 'fitness', label: 'Fitness Report' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-sm rounded-md transition ${
              tab === t.key ? 'bg-white text-slate-900 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'grid' && <StrategyGrid strategies={strategies} output={output} />}
      {tab === 'dd_budget' && <DDBudget strategies={strategies} output={output} ddBudgetUsd={ddBudgetUsd} />}
      {tab === 'fitness' && <FitnessReport strategies={strategies} output={output} />}
    </div>
  )
}

// --- KPI Card ---

function KPI({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">{label}</div>
      <div className={`text-lg font-bold ${color || 'text-slate-900'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

// --- Strategy Grid Tab ---

function StrategyGrid({ strategies, output }: { strategies: StrategyRow[]; output: PortfolioSizingOutput | null }) {
  const resultMap = new Map<string, (typeof output)extends null ? never : NonNullable<typeof output>['results'][0]>()
  if (output) {
    for (const r of output.results) resultMap.set(r.strategyId, r)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left">
            <th className="px-3 py-2 text-[10px] uppercase text-slate-400 font-medium">Magic</th>
            <th className="px-3 py-2 text-[10px] uppercase text-slate-400 font-medium">Strategia</th>
            <th className="px-3 py-2 text-[10px] uppercase text-slate-400 font-medium">Asset</th>
            <th className="px-3 py-2 text-[10px] uppercase text-slate-400 font-medium">Style</th>
            <th className="px-3 py-2 text-[10px] uppercase text-slate-400 font-medium text-right">Kelly f*</th>
            <th className="px-3 py-2 text-[10px] uppercase text-slate-400 font-medium text-right">Chosen f</th>
            <th className="px-3 py-2 text-[10px] uppercase text-slate-400 font-medium text-right">RoR %</th>
            <th className="px-3 py-2 text-[10px] uppercase text-slate-400 font-medium text-right">Recommended</th>
            <th className="px-3 py-2 text-[10px] uppercase text-slate-400 font-medium text-right">Current</th>
            <th className="px-3 py-2 text-[10px] uppercase text-slate-400 font-medium text-right">Change</th>
            <th className="px-3 py-2 text-[10px] uppercase text-slate-400 font-medium text-right">Fitness</th>
          </tr>
        </thead>
        <tbody>
          {strategies.map(s => {
            const r = resultMap.get(s.id)
            const kellyF = s.test_kelly ?? calcKelly(s.test_win_pct ?? 0, s.test_payoff ?? 0)
            return (
              <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-slate-600">{s.magic}</td>
                <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{s.name}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${groupColor(s.asset_group)}`}>
                    {s.asset_group}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${styleColor(s.strategy_style)}`}>
                    {styleLabel(s.strategy_style)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-700">{kellyF !== null ? fmt(kellyF, 4) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-700">{r ? fmt(r.halfKelly, 4) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-600">{r?.rorPct !== null && r?.rorPct !== undefined ? fmtPct(r.rorPct * 100, 4) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-indigo-700">{r ? fmtLots(r.recommendedLots) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-500">{r ? fmtLots(r.currentLots) : fmtLots(s.lot_neutral)}</td>
                <td className="px-3 py-2 text-right">
                  {r?.lotsChangePct !== null && r?.lotsChangePct !== undefined ? (
                    <span className={`font-mono text-xs ${r.lotsChangePct > 0 ? 'text-green-600' : r.lotsChangePct < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                      {r.lotsChangePct > 0 ? '+' : ''}{fmt(r.lotsChangePct, 1)}%
                    </span>
                  ) : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {r ? (
                    <span className={`font-mono text-xs font-bold ${fitnessColor(r.fitnessScore)}`}>
                      {r.fitnessScore}
                    </span>
                  ) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// --- DD Budget Tab ---

function DDBudget({ strategies, output, ddBudgetUsd }: { strategies: StrategyRow[]; output: PortfolioSizingOutput | null; ddBudgetUsd: number }) {
  if (!output) {
    return <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400">Clicca &quot;Ottimizza&quot; per calcolare il DD Budget</div>
  }

  // Waterfall chart data
  const chartData = strategies.map((s, i) => {
    const r = output.results[i]
    const mc95 = s.mc95_dd_scaled ?? s.test_mc95_dd ?? 0
    const ddContrib = r ? r.recommendedLots * mc95 : 0
    return {
      name: `M${s.magic}`,
      fullName: s.name,
      dd: Math.round(ddContrib * 100) / 100,
      group: s.asset_group,
    }
  }).sort((a, b) => b.dd - a.dd)

  // Style balance for pie
  const stylePie = Object.entries(output.styleBalance).map(([name, pct]) => ({
    name: styleLabel(name),
    value: pct,
    style: name,
  }))

  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#64748b']

  return (
    <div className="space-y-4">
      {/* DD Waterfall */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">DD Budget Allocation (Waterfall)</h3>
        <div className="text-xs text-slate-400 mb-2">
          Budget: {fmtUsd(ddBudgetUsd)} | Usato: {fmtUsd(output.totalDdBudgetUsedUsd)} ({fmtPct(output.totalDdBudgetUsedPct)}) | Disponibile: {fmtUsd(output.ddBudgetAvailableUsd)}
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              formatter={(value: unknown) => [`$${Number(value).toFixed(2)}`, 'DD Contribution']}
              labelFormatter={(label: unknown) => {
                const labelStr = String(label)
                const item = chartData.find(d => d.name === labelStr)
                return item?.fullName || labelStr
              }}
            />
            <Bar dataKey="dd" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, idx) => {
                const colorMap: Record<string, string> = {
                  SP500: '#6366f1', INDICI_US: '#3b82f6', BTC: '#f97316',
                  DAX: '#10b981', OIL: '#f59e0b', FX: '#06b6d4',
                }
                return <Cell key={idx} fill={colorMap[entry.group || ''] || '#94a3b8'} />
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {/* Budget bar */}
        <div className="mt-3">
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                output.totalDdBudgetUsedPct > 90 ? 'bg-red-500' : output.totalDdBudgetUsedPct > 70 ? 'bg-amber-500' : 'bg-indigo-500'
              }`}
              style={{ width: `${Math.min(output.totalDdBudgetUsedPct, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Style Balance */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Style Balance (target 50/50)</h3>
        <div className="flex items-center gap-6">
          <div className="w-40 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stylePie}
                  cx="50%" cy="50%"
                  innerRadius={35} outerRadius={60}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {stylePie.map((entry, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: unknown) => `${value}%`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {stylePie.map((entry, idx) => (
              <div key={entry.name} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                <span className="text-sm text-slate-700">{entry.name}: <strong>{entry.value}%</strong></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Fitness Report Tab ---

function FitnessReport({ strategies, output }: { strategies: StrategyRow[]; output: PortfolioSizingOutput | null }) {
  const fitnessData = strategies.map((s, i) => {
    const r = output?.results[i]
    const fitness = r
      ? { score: r.fitnessScore, details: r.fitnessDetails }
      : calcFitnessScore({
          test_win_pct: s.test_win_pct,
          test_payoff: s.test_payoff,
          test_max_dd: s.test_max_dd,
          test_expectancy: s.test_expectancy,
          real_win_pct: s.real_win_pct,
          real_payoff: s.real_payoff,
          real_max_dd: s.real_max_dd,
          real_expectancy: s.real_expectancy,
          real_trades: s.real_trades,
        })
    return { strategy: s, ...fitness }
  }).sort((a, b) => a.score - b.score)

  return (
    <div className="space-y-3">
      {fitnessData.map(({ strategy: s, score, details }) => (
        <div
          key={s.id}
          className={`bg-white rounded-xl border p-4 ${
            score >= 70 ? 'border-green-200' : score >= 40 ? 'border-amber-200' : 'border-red-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${
                score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500'
              }`} />
              <div>
                <span className="font-medium text-slate-800">M{s.magic} — {s.name}</span>
                <div className="flex gap-2 mt-0.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${groupColor(s.asset_group)}`}>{s.asset_group}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${styleColor(s.strategy_style)}`}>{styleLabel(s.strategy_style)}</span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className={`text-2xl font-bold ${fitnessColor(score)}`}>{score}</div>
              <div className={`text-xs ${fitnessColor(score)}`}>{fitnessLabel(score)}</div>
            </div>
          </div>

          {/* Metrics comparison */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
            <MetricCompare label="Win %" test={s.test_win_pct} real={s.real_win_pct} suffix="%" />
            <MetricCompare label="Max DD" test={s.test_max_dd} real={s.real_max_dd} prefix="$" invert />
            <MetricCompare label="Expectancy" test={s.test_expectancy} real={s.real_expectancy} prefix="$" />
            <div>
              <span className="text-slate-400">Trade (real)</span>
              <div className="font-mono font-bold text-slate-700 mt-0.5">{s.real_trades}</div>
              {s.real_trades < 30 && <div className="text-[10px] text-amber-500">Sample basso</div>}
            </div>
          </div>

          {/* Alert */}
          {score < 40 && s.real_trades >= 30 && (
            <div className="mt-2 px-3 py-1.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
              Candidata alla sospensione: performance reali significativamente sotto i test.
              {details.dd_ratio && details.dd_ratio > 1.5 && ` DD reale ${fmt(details.dd_ratio, 1)}x il test.`}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// --- Metric Compare helper ---

function MetricCompare({ label, test, real, prefix, suffix, invert }: {
  label: string; test: number | null; real: number | null; prefix?: string; suffix?: string; invert?: boolean
}) {
  const deviation = test && real ? ((real - test) / Math.abs(test)) * 100 : null
  const isGood = invert ? (deviation !== null && deviation < 0) : (deviation !== null && deviation > 0)

  return (
    <div>
      <span className="text-slate-400">{label}</span>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className="font-mono text-slate-500">{prefix}{fmt(test)}{suffix}</span>
        <span className="text-slate-300">/</span>
        <span className={`font-mono font-bold ${deviation !== null ? (isGood ? 'text-green-600' : 'text-red-600') : 'text-slate-700'}`}>
          {prefix}{fmt(real)}{suffix}
        </span>
      </div>
      {deviation !== null && (
        <div className={`text-[10px] ${isGood ? 'text-green-500' : 'text-red-500'}`}>
          {deviation > 0 ? '+' : ''}{fmt(deviation, 1)}%
        </div>
      )}
    </div>
  )
}
