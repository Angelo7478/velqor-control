'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelStrategy, QelPortfolio } from '@/types/database'
import {
  fmt, fmtUsd, fmtPct, plColor, groupColor, styleColor, styleLabel,
  fitnessColor, fitnessLabel, calcHealthReport, HealthReport,
} from '@/lib/quant-utils'

const STATUS_CONFIG: Record<string, { color: string; border: string; bg: string; label: string }> = {
  healthy: { color: 'text-green-700', border: 'border-green-200', bg: 'bg-green-50', label: 'Healthy' },
  warning: { color: 'text-amber-700', border: 'border-amber-200', bg: 'bg-amber-50', label: 'Warning' },
  critical: { color: 'text-red-700', border: 'border-red-200', bg: 'bg-red-50', label: 'Critical' },
  regime_mismatch: { color: 'text-violet-700', border: 'border-violet-200', bg: 'bg-violet-50', label: 'Regime' },
  insufficient_data: { color: 'text-slate-500', border: 'border-slate-200', bg: 'bg-slate-50', label: 'Early' },
}

const PENDULUM_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  base: { color: 'text-slate-500', icon: '=', label: 'Base (ridotto)' },
  recovery: { color: 'text-blue-600', icon: '↗', label: 'Recovery' },
  drawdown: { color: 'text-green-600', icon: '↑', label: 'DD → Size Up' },
}

export default function HealthPage() {
  const [portfolio, setPortfolio] = useState<QelPortfolio | null>(null)
  const [reports, setReports] = useState<HealthReport[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const supabase = createClient()

    const { data: portfolios } = await supabase
      .from('qel_portfolios').select('*').eq('is_active', true).order('name').limit(1)

    if (!portfolios || portfolios.length === 0) { setLoading(false); return }
    const ptf = portfolios[0]
    setPortfolio(ptf)

    const [stratRes, perfRes] = await Promise.all([
      supabase.from('qel_strategies').select('*').eq('include_in_portfolio', true).eq('status', 'active').order('magic'),
      ptf.account_id
        ? supabase.from('v_strategy_recent_performance').select('*').eq('account_id', ptf.account_id)
        : Promise.resolve({ data: [] }),
    ])

    // Build equity peaks from equity curve
    const { data: equityCurve } = ptf.account_id
      ? await supabase.from('v_strategy_equity_curve').select('strategy_id, cumulative_pnl').eq('account_id', ptf.account_id)
      : { data: [] }

    // Group equity curve by strategy to find peak
    // Calculate per-account equity peaks AND max DD from equity curve
    const peakMap = new Map<string, { peak: number; last: number; maxDd: number }>()
    if (equityCurve) {
      for (const row of equityCurve) {
        const sid = row.strategy_id
        const pnl = Number(row.cumulative_pnl)
        if (!peakMap.has(sid)) peakMap.set(sid, { peak: pnl, last: pnl, maxDd: 0 })
        const entry = peakMap.get(sid)!
        if (pnl > entry.peak) entry.peak = pnl
        // DD = peak - current (positive number = how much we dropped)
        const currentDd = entry.peak - pnl
        if (currentDd > entry.maxDd) entry.maxDd = currentDd
        entry.last = pnl
      }
    }

    const perfMap = new Map<string, { consecLosses: number; totalPnl: number; recentWinPct: number | null; avgTrade: number | null; totalTrades: number }>()
    if (perfRes.data) {
      for (const p of perfRes.data) {
        perfMap.set(p.strategy_id, {
          consecLosses: p.current_consec_losses ?? 0,
          totalPnl: Number(p.total_pnl ?? 0),
          recentWinPct: p.win_pct ? Number(p.win_pct) : null,
          avgTrade: p.avg_trade ? Number(p.avg_trade) : null,
          totalTrades: Number(p.total_trades ?? 0),
        })
      }
    }

    if (stratRes.data) {
      const healthReports = stratRes.data.map(s => {
        const perf = perfMap.get(s.id)
        const peaks = peakMap.get(s.id)
        // Override real_max_dd with per-account DD (not aggregate across all accounts)
        const stratWithAccountDd = peaks?.maxDd !== undefined
          ? { ...s, real_max_dd: peaks.maxDd }
          : s
        return calcHealthReport(stratWithAccountDd, {
          consecLosses: perf?.consecLosses ?? 0,
          cumulativePnl: peaks?.last ?? 0,
          equityPeak: peaks?.peak ?? 0,
          recentWinPct: perf?.recentWinPct ?? null,
          avgTrade: perf?.avgTrade ?? null,
          totalTrades: perf?.totalTrades ?? 0,
        })
      })
      setReports(healthReports)
    }

    setLoading(false)
  }

  if (loading) return <div className="p-8 text-slate-500">Caricamento...</div>

  // Summary stats
  const healthy = reports.filter(r => r.healthStatus === 'healthy').length
  const warning = reports.filter(r => r.healthStatus === 'warning').length
  const critical = reports.filter(r => r.healthStatus === 'critical').length
  const regime = reports.filter(r => r.healthStatus === 'regime_mismatch').length
  const inDD = reports.filter(r => r.pendulumState === 'drawdown').length

  // Sort: critical first, then warning, regime, healthy, insufficient
  const sortOrder: Record<string, number> = { critical: 0, warning: 1, regime_mismatch: 2, healthy: 3, insufficient_data: 4 }
  const sorted = [...reports].sort((a, b) => (sortOrder[a.healthStatus] ?? 5) - (sortOrder[b.healthStatus] ?? 5))

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <a href="/divisioni/quant" className="text-slate-400 hover:text-slate-600 text-sm">&larr; Quant</a>
          <span className="text-slate-300">|</span>
          <a href="/divisioni/quant/sizing" className="text-slate-400 hover:text-slate-600 text-sm">Sizing</a>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Strategy Health Monitor</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Coerenza test/real, pendulum sizing, alert decommissioning — {portfolio?.name}
        </p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-green-200 p-3">
          <div className="text-2xl font-bold text-green-600">{healthy}</div>
          <div className="text-[10px] uppercase text-slate-400">Healthy</div>
        </div>
        <div className="bg-white rounded-xl border border-amber-200 p-3">
          <div className="text-2xl font-bold text-amber-600">{warning}</div>
          <div className="text-[10px] uppercase text-slate-400">Warning</div>
        </div>
        <div className="bg-white rounded-xl border border-red-200 p-3">
          <div className="text-2xl font-bold text-red-600">{critical}</div>
          <div className="text-[10px] uppercase text-slate-400">Critical</div>
        </div>
        <div className="bg-white rounded-xl border border-violet-200 p-3">
          <div className="text-2xl font-bold text-violet-600">{regime}</div>
          <div className="text-[10px] uppercase text-slate-400">Regime Mismatch</div>
        </div>
        <div className="bg-white rounded-xl border border-blue-200 p-3">
          <div className="text-2xl font-bold text-blue-600">{inDD}</div>
          <div className="text-[10px] uppercase text-slate-400">In Drawdown (Pendulum ↑)</div>
        </div>
      </div>

      {/* Strategy Cards */}
      <div className="space-y-3">
        {sorted.map(r => {
          const cfg = STATUS_CONFIG[r.healthStatus] || STATUS_CONFIG.healthy
          const pdl = PENDULUM_CONFIG[r.pendulumState] || PENDULUM_CONFIG.base
          return (
            <div key={r.strategyId} className={`bg-white rounded-xl border ${cfg.border} p-4`}>
              {/* Header row */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${cfg.bg} flex items-center justify-center`}>
                    <span className={`text-lg font-bold ${cfg.color}`}>{r.healthScore}</span>
                  </div>
                  <div>
                    <div className="font-medium text-slate-800">M{r.magic} — {r.name}</div>
                    <div className="flex gap-2 mt-0.5">
                      {r.family && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{r.family}</span>}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                    </div>
                  </div>
                </div>

                {/* Pendulum indicator */}
                <div className="text-right">
                  <div className={`flex items-center gap-1 ${pdl.color}`}>
                    <span className="text-lg font-mono">{pdl.icon}</span>
                    <span className="text-sm font-bold">{r.pendulumMultiplier}x</span>
                  </div>
                  <div className="text-[10px] text-slate-400">{pdl.label}</div>
                </div>
              </div>

              {/* Metrics row */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-3 text-xs">
                <div>
                  <span className="text-slate-400">Fitness</span>
                  <div className={`font-mono font-bold ${fitnessColor(r.fitnessScore)}`}>{r.fitnessScore}%</div>
                  <div className="text-[10px] text-slate-400">conf {r.fitnessConfidence}%</div>
                </div>
                <div>
                  <span className="text-slate-400">P/L cumulato</span>
                  <div className={`font-mono font-bold ${plColor(r.cumulativePnl)}`}>{fmtUsd(r.cumulativePnl, 2)}</div>
                </div>
                <div>
                  <span className="text-slate-400">DD da peak</span>
                  <div className="font-mono font-bold text-slate-700">{fmtPct(r.ddFromPeak)}</div>
                </div>
                <div>
                  <span className="text-slate-400">Consec. Loss</span>
                  <div className={`font-mono font-bold ${r.consecLosses >= 3 ? 'text-red-600' : 'text-slate-700'}`}>{r.consecLosses}</div>
                </div>
                <div>
                  <span className="text-slate-400">Equity Peak</span>
                  <div className="font-mono font-bold text-slate-700">{fmtUsd(r.equityPeak, 2)}</div>
                </div>
                <div>
                  <span className="text-slate-400">Pendulum</span>
                  <div className={`font-mono font-bold ${pdl.color}`}>{r.pendulumMultiplier}x</div>
                </div>
              </div>

              {/* Flags */}
              {r.flags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {r.flags.map(f => (
                    <span key={f} className={`text-[10px] px-2 py-0.5 rounded-full ${
                      f.includes('breach') || f.includes('collapse') ? 'bg-red-50 text-red-600' :
                      f.includes('regime') ? 'bg-violet-50 text-violet-600' :
                      f.includes('negative') || f.includes('consec') ? 'bg-amber-50 text-amber-600' :
                      'bg-slate-50 text-slate-500'
                    }`}>
                      {f.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}

              {/* Recommendation */}
              <div className={`mt-2 px-3 py-1.5 ${cfg.bg} rounded-lg text-xs ${cfg.color}`}>
                {r.recommendation}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
