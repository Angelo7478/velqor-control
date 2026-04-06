'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelPortfolio } from '@/types/database'
import {
  fmt, fmtUsd, fmtPct, plColor,
  runMonteCarlo, runScenarioComparison, MCResult, ScenarioResult,
} from '@/lib/quant-utils'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import QuantNav from '../quant-nav'
import InfoTooltip from '@/components/ui/InfoTooltip'

export default function ScenariosPage() {
  const [portfolio, setPortfolio] = useState<QelPortfolio | null>(null)
  const [trades, setTrades] = useState<number[]>([])
  const [scenarios, setScenarios] = useState<ScenarioResult[]>([])
  const [fanChart, setFanChart] = useState<{ trade: number; p5: number; p25: number; p50: number; p75: number; p95: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [simulating, setSimulating] = useState(false)
  const [numTrades, setNumTrades] = useState(250)
  const [numPaths, setNumPaths] = useState(500)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const supabase = createClient()
    const { data: portfolios } = await supabase
      .from('qel_portfolios').select('*').eq('is_active', true).order('name').limit(1)

    if (!portfolios || portfolios.length === 0) { setLoading(false); return }
    const ptf = portfolios[0]
    setPortfolio(ptf)

    // Load all closed trades for this account
    if (ptf.account_id) {
      const { data: tradeData } = await supabase
        .from('qel_trades')
        .select('net_profit')
        .eq('account_id', ptf.account_id)
        .eq('is_open', false)
        .not('net_profit', 'is', null)
        .order('close_time')

      if (tradeData) {
        setTrades(tradeData.map(t => Number(t.net_profit)))
      }
    }
    setLoading(false)
  }

  function runSimulation() {
    if (trades.length === 0 || !portfolio) return
    setSimulating(true)

    // Run 3 scenarios
    const results = runScenarioComparison(
      trades, portfolio.equity_base, portfolio.max_dd_target_pct, numPaths, numTrades
    )
    setScenarios(results)

    // Fan chart from neutral scenario (p5-p95)
    const neutral = results[1]
    const chart = neutral.mc.percentiles.p50.map((_, i) => ({
      trade: i,
      p5: Math.round(neutral.mc.percentiles.p5[i]),
      p25: Math.round(neutral.mc.percentiles.p25[i]),
      p50: Math.round(neutral.mc.percentiles.p50[i]),
      p75: Math.round(neutral.mc.percentiles.p75[i]),
      p95: Math.round(neutral.mc.percentiles.p95[i]),
    }))
    // Sample every N points for performance
    const step = Math.max(1, Math.floor(chart.length / 100))
    setFanChart(chart.filter((_, i) => i % step === 0 || i === chart.length - 1))

    setSimulating(false)
  }

  if (loading) return <div className="p-8 text-slate-500">Caricamento...</div>

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Intestazione */}
      <div>
        <QuantNav />
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Simulazione Scenari</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Monte Carlo<InfoTooltip metricKey="monte_carlo" /> bootstrap — {trades.length} trade reali come base — {portfolio?.name}
        </p>
      </div>

      {/* Parametri */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Trade da simulare</label>
            <select className="text-sm border border-slate-200 rounded px-2 py-1" value={numTrades} onChange={e => setNumTrades(Number(e.target.value))}>
              <option value={100}>100 (3-4 mesi)</option>
              <option value={250}>250 (~1 anno)</option>
              <option value={500}>500 (~2 anni)</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Simulazioni</label>
            <select className="text-sm border border-slate-200 rounded px-2 py-1" value={numPaths} onChange={e => setNumPaths(Number(e.target.value))}>
              <option value={200}>200 (veloce)</option>
              <option value={500}>500 (standard)</option>
              <option value={1000}>1000 (preciso)</option>
            </select>
          </div>
          <button
            onClick={runSimulation}
            disabled={simulating || trades.length === 0}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {simulating ? 'Simulazione...' : 'Simula'}
          </button>
          <span className="text-xs text-slate-400 ml-auto">
            Base: {trades.length} trade reali dal conto {portfolio?.name}
          </span>
        </div>
      </div>

      {scenarios.length > 0 && (
        <>
          {/* Confronto 3 scenari */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {scenarios.map((s, i) => (
              <ScenarioCard key={s.name} scenario={s} highlight={i === 1} equityBase={portfolio?.equity_base || 10000} />
            ))}
          </div>

          {/* Fan Chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-1">Ventaglio Equity — Scenario Neutro (1/2 Kelly)</h3>
            <p className="text-[10px] text-slate-400 mb-3">
              {numPaths} simulazioni × {numTrades} trade. Le bande mostrano i percentili 5°/25°/50°/75°/95° dell&apos;equity.
              La banda più scura è il percorso mediano. Più è stretta, più il risultato è prevedibile.
            </p>
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={fanChart} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="trade" tick={{ fontSize: 10 }} label={{ value: 'Trade #', position: 'insideBottom', offset: -2, style: { fontSize: 10 } }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(1)}k`} />
                <Tooltip formatter={(value: unknown) => `$${Number(value).toLocaleString('it-IT')}`} labelFormatter={(l: unknown) => `Trade #${l}`} />
                <Area type="monotone" dataKey="p95" stackId="1" stroke="none" fill="#c7d2fe" fillOpacity={0.4} name="Migliore 5%" />
                <Area type="monotone" dataKey="p75" stackId="2" stroke="none" fill="#a5b4fc" fillOpacity={0.4} name="Sopra media" />
                <Area type="monotone" dataKey="p50" stackId="3" stroke="#6366f1" strokeWidth={2} fill="#818cf8" fillOpacity={0.3} name="Mediana" />
                <Area type="monotone" dataKey="p25" stackId="4" stroke="none" fill="#a5b4fc" fillOpacity={0.2} name="Sotto media" />
                <Area type="monotone" dataKey="p5" stackId="5" stroke="none" fill="#e0e7ff" fillOpacity={0.2} name="Peggiore 5%" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Spiegazione */}
          <div className="bg-indigo-50 rounded-xl border border-indigo-100 p-4 text-sm text-indigo-800">
            <p className="font-semibold mb-2">Come leggere i risultati</p>
            <ul className="space-y-1 text-xs">
              <li><strong>Rendimento mediano:</strong> il 50% delle simulazioni ha ottenuto questo risultato o meglio.</li>
              <li><strong>DD mediano:</strong> la perdita massima dal picco nella metà delle simulazioni.</li>
              <li><strong>DD peggiore (95°):</strong> nel 95% dei casi il DD non supera questo valore. Se supera il limite FTMO, rischi il conto.</li>
              <li><strong>Prob. rovina:</strong> % di simulazioni dove il DD ha toccato il limite FTMO (10%). Deve essere vicino a 0%.</li>
              <li><strong>Prob. profitto:</strong> % di simulazioni che chiudono in positivo.</li>
              <li><strong>Conservativo vs Aggressivo:</strong> dimezzando la size (conservativo) il rendimento cala del ~50% ma il DD cala molto di più. Raddoppiandola (aggressivo) il rendimento sale ma il rischio di rovina esplode.</li>
            </ul>
          </div>
        </>
      )}

      {scenarios.length === 0 && !loading && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-lg mb-2">Premi &quot;Simula&quot; per generare gli scenari</p>
          <p className="text-sm">La simulazione usa i {trades.length} trade reali come campione, li rimescola casualmente e proietta {numTrades} trade futuri.</p>
        </div>
      )}
    </div>
  )
}

// --- Scenario Card ---

function ScenarioCard({ scenario, highlight, equityBase }: { scenario: ScenarioResult; highlight: boolean; equityBase: number }) {
  const { mc, name } = scenario
  const s = mc.stats

  const borderColor = highlight ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-200'
  const ruinColor = s.probRuin > 0.1 ? 'text-red-600' : s.probRuin > 0.02 ? 'text-amber-600' : 'text-green-600'

  return (
    <div className={`bg-white rounded-xl border ${borderColor} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">{name}</h3>
        {highlight && <span className="text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full">Raccomandato</span>}
      </div>

      <div className="space-y-2">
        <MetricRow label="Rendimento mediano" value={fmtUsd(s.medianReturn)} sub={fmtPct(s.medianReturnPct)} color={plColor(s.medianReturn)} />
        <MetricRow label="DD mediano" value={fmtUsd(s.medianMaxDd)} sub={fmtPct(s.medianMaxDdPct)} color="text-slate-700" />
        <MetricRow label="DD peggiore (95°)" value={fmtUsd(s.worstDd)} sub={fmtPct(s.worstDdPct)} color={s.worstDdPct > 8 ? 'text-red-600' : 'text-amber-600'} />

        <div className="border-t border-slate-100 pt-2 mt-2">
          <MetricRow label="Probabilità rovina" value={fmtPct(s.probRuin * 100)} color={ruinColor} />
          <MetricRow label="Probabilità profitto" value={fmtPct(s.probProfit * 100)} color={s.probProfit > 0.7 ? 'text-green-600' : 'text-amber-600'} />
        </div>

        {/* Visual DD bar vs limit */}
        <div className="mt-2">
          <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
            <span>DD 95° vs limite FTMO</span>
            <span>{fmt(s.worstDdPct, 1)}% / 10%</span>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${s.worstDdPct > 10 ? 'bg-red-500' : s.worstDdPct > 8 ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min(s.worstDdPct * 10, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricRow({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="text-right">
        <span className={`font-mono font-bold text-sm ${color}`}>{value}</span>
        {sub && <span className="text-[10px] text-slate-400 ml-1">{sub}</span>}
      </div>
    </div>
  )
}
