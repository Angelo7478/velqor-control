'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelStrategy, QelPortfolio } from '@/types/database'
import {
  fmt, fmtUsd, fmtPct, plColor, groupColor, styleColor, styleLabel,
  fitnessColor, calcHealthReport, HealthReport,
} from '@/lib/quant-utils'

// --- Italian labels ---

const STATUS_IT: Record<string, { label: string; emoji: string; color: string; border: string; bg: string; desc: string }> = {
  healthy:           { label: 'In forma',       emoji: '🟢', color: 'text-green-700',  border: 'border-green-200',  bg: 'bg-green-50',  desc: 'La strategia funziona come previsto dai test' },
  warning:           { label: 'Attenzione',     emoji: '🟡', color: 'text-amber-700',  border: 'border-amber-200',  bg: 'bg-amber-50',  desc: 'Qualche parametro devia dai test. Da monitorare' },
  critical:          { label: 'Critica',        emoji: '🔴', color: 'text-red-700',    border: 'border-red-200',    bg: 'bg-red-50',    desc: 'Forte deviazione. Valutare se sospendere' },
  regime_mismatch:   { label: 'Fase sbagliata', emoji: '🟣', color: 'text-violet-700', border: 'border-violet-200', bg: 'bg-violet-50', desc: 'Strategia non rotta — il mercato è in una fase avversa' },
  insufficient_data: { label: 'Pochi dati',     emoji: '⚪', color: 'text-slate-500',  border: 'border-slate-200',  bg: 'bg-slate-50',  desc: 'Troppo presto per valutare. Servono più trade' },
}

const PENDULUM_IT: Record<string, { label: string; emoji: string; color: string; desc: string }> = {
  base:     { label: 'Stabile',     emoji: '⚖️', color: 'text-slate-600',  desc: 'Size normale — la strategia è in equilibrio' },
  recovery: { label: 'Recupero',    emoji: '↗️', color: 'text-blue-600',   desc: 'Leggero aumento size — sta uscendo dal drawdown' },
  drawdown: { label: 'In discesa',  emoji: '📈', color: 'text-green-600',  desc: 'Size aumentata — il rimbalzo statistico è probabile' },
}

const FLAG_IT: Record<string, { label: string; color: string }> = {
  outperforming:       { label: '✅ Meglio dei test',               color: 'bg-green-50 text-green-700' },
  win_rate_improved:   { label: '📈 Win rate migliorato',           color: 'bg-green-50 text-green-700' },
  dd_above_test:       { label: '📊 DD sopra test (ma in profitto)', color: 'bg-blue-50 text-blue-600' },
  dd_elevated:         { label: '⚠️ DD elevato — verificare sizing', color: 'bg-amber-50 text-amber-600' },
  dd_breach_2x:        { label: '🔴 DD doppio rispetto al test',    color: 'bg-red-50 text-red-600' },
  dd_breach_1_5x:      { label: '🟡 DD 50% sopra test',             color: 'bg-amber-50 text-amber-600' },
  win_rate_drop:       { label: '📉 Win rate calato',               color: 'bg-amber-50 text-amber-600' },
  negative_expectancy: { label: '⚠️ Guadagno medio negativo',       color: 'bg-amber-50 text-amber-600' },
  regime_mismatch:     { label: '🟣 Mercato in fase avversa',       color: 'bg-violet-50 text-violet-600' },
  high_consec_losses:  { label: '🔻 Molte perdite consecutive',     color: 'bg-red-50 text-red-600' },
  early_stage:         { label: '🕐 Fase iniziale',                 color: 'bg-slate-50 text-slate-500' },
}

// Extended report with per-account performance
interface HealthCardData extends HealthReport {
  recentWinPct: number | null
  avgTrade: number | null
  totalTrades: number
  totalPnl: number
}

export default function HealthPage() {
  const [portfolio, setPortfolio] = useState<QelPortfolio | null>(null)
  const [cards, setCards] = useState<HealthCardData[]>([])
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

    const { data: equityCurve } = ptf.account_id
      ? await supabase.from('v_strategy_equity_curve').select('strategy_id, cumulative_pnl').eq('account_id', ptf.account_id)
      : { data: [] }

    // Per-account equity peaks + max DD
    const peakMap = new Map<string, { peak: number; last: number; maxDd: number }>()
    if (equityCurve) {
      for (const row of equityCurve) {
        const sid = row.strategy_id
        const pnl = Number(row.cumulative_pnl)
        if (!peakMap.has(sid)) peakMap.set(sid, { peak: pnl, last: pnl, maxDd: 0 })
        const entry = peakMap.get(sid)!
        if (pnl > entry.peak) entry.peak = pnl
        const currentDd = entry.peak - pnl
        if (currentDd > entry.maxDd) entry.maxDd = currentDd
        entry.last = pnl
      }
    }

    // Per-account performance
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

    // Calculate average lot per strategy on this account (for DD normalization)
    const avgLotMap = new Map<string, number>()
    if (ptf.account_id) {
      const { data: lotAvgs } = await supabase
        .from('qel_trades')
        .select('strategy_id, lots')
        .eq('account_id', ptf.account_id)
        .eq('is_open', false)
        .not('strategy_id', 'is', null)
      if (lotAvgs) {
        const sums = new Map<string, { total: number; count: number }>()
        for (const row of lotAvgs) {
          if (!row.strategy_id) continue
          if (!sums.has(row.strategy_id)) sums.set(row.strategy_id, { total: 0, count: 0 })
          const s = sums.get(row.strategy_id)!
          s.total += Number(row.lots)
          s.count++
        }
        for (const [sid, s] of sums) {
          avgLotMap.set(sid, s.total / s.count)
        }
      }
    }

    if (stratRes.data) {
      const result: HealthCardData[] = stratRes.data.map(s => {
        const perf = perfMap.get(s.id)
        const peaks = peakMap.get(s.id)

        // Use PER-ACCOUNT data instead of global aggregates
        const stratOverride = {
          ...s,
          real_max_dd: peaks?.maxDd ?? 0,
          real_win_pct: perf?.recentWinPct ?? s.real_win_pct,
          real_expectancy: perf?.avgTrade ?? s.real_expectancy,
          real_pl: perf?.totalPnl ?? s.real_pl,
        }

        const report = calcHealthReport(stratOverride, {
          avgRealLot: avgLotMap.get(s.id) ?? null,
          consecLosses: perf?.consecLosses ?? 0,
          cumulativePnl: peaks?.last ?? 0,
          equityPeak: peaks?.peak ?? 0,
          recentWinPct: perf?.recentWinPct ?? null,
          avgTrade: perf?.avgTrade ?? null,
          totalTrades: perf?.totalTrades ?? 0,
        })

        return {
          ...report,
          recentWinPct: perf?.recentWinPct ?? null,
          avgTrade: perf?.avgTrade ?? null,
          totalTrades: perf?.totalTrades ?? 0,
          totalPnl: perf?.totalPnl ?? 0,
        }
      })

      setCards(result)
    }

    setLoading(false)
  }

  if (loading) return <div className="p-8 text-slate-500">Caricamento...</div>

  const healthy = cards.filter(r => r.healthStatus === 'healthy').length
  const warning = cards.filter(r => r.healthStatus === 'warning').length
  const critical = cards.filter(r => r.healthStatus === 'critical').length
  const regime = cards.filter(r => r.healthStatus === 'regime_mismatch').length
  const early = cards.filter(r => r.healthStatus === 'insufficient_data').length

  const sortOrder: Record<string, number> = { critical: 0, warning: 1, regime_mismatch: 2, healthy: 3, insufficient_data: 4 }
  const sorted = [...cards].sort((a, b) => (sortOrder[a.healthStatus] ?? 5) - (sortOrder[b.healthStatus] ?? 5))

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Intestazione */}
      <div>
        <div className="flex items-center gap-2">
          <a href="/divisioni/quant" className="text-slate-400 hover:text-slate-600 text-sm">&larr; Quant</a>
          <span className="text-slate-300">|</span>
          <a href="/divisioni/quant/sizing" className="text-slate-400 hover:text-slate-600 text-sm">Sizing</a>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Monitor Salute Strategie</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Confronto test/reale per conto, pendulum, segnali di allarme — {portfolio?.name}
        </p>
      </div>

      {/* Riepilogo */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <SummaryBox emoji="🟢" count={healthy} label="In forma" border="border-green-200" color="text-green-600" />
        <SummaryBox emoji="🟡" count={warning} label="Attenzione" border="border-amber-200" color="text-amber-600" />
        <SummaryBox emoji="🔴" count={critical} label="Critiche" border="border-red-200" color="text-red-600" />
        <SummaryBox emoji="🟣" count={regime} label="Fase sbagliata" border="border-violet-200" color="text-violet-600" />
        <SummaryBox emoji="⚪" count={early} label="Pochi dati" border="border-slate-200" color="text-slate-500" />
      </div>

      {/* Card strategie */}
      <div className="space-y-3">
        {sorted.map(card => <StrategyCard key={card.strategyId} card={card} />)}
      </div>
    </div>
  )
}

// --- Componenti ---

function SummaryBox({ emoji, count, label, border, color }: { emoji: string; count: number; label: string; border: string; color: string }) {
  return (
    <div className={`bg-white rounded-xl border ${border} p-3`}>
      <div className="flex items-center gap-2">
        <span className="text-lg">{emoji}</span>
        <span className={`text-2xl font-bold ${color}`}>{count}</span>
      </div>
      <div className="text-[10px] uppercase text-slate-400 mt-0.5">{label}</div>
    </div>
  )
}

function StrategyCard({ card }: { card: HealthCardData }) {
  const cfg = STATUS_IT[card.healthStatus] || STATUS_IT.healthy
  const pdl = PENDULUM_IT[card.pendulumState] || PENDULUM_IT.base

  return (
    <div className={`bg-white rounded-xl border ${cfg.border} p-4`}>
      {/* Riga superiore: nome + stato + pendulum */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {/* Score circolare */}
          <div className="relative w-12 h-12">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
              <path className="text-slate-100" stroke="currentColor" strokeWidth="3" fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <path
                className={card.healthScore >= 70 ? 'text-green-500' : card.healthScore >= 40 ? 'text-amber-500' : 'text-red-500'}
                stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round"
                strokeDasharray={`${card.healthScore}, 100`}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${fitnessColor(card.healthScore)}`}>
              {card.healthScore}%
            </span>
          </div>
          <div>
            <div className="font-semibold text-slate-800">M{card.magic} — {card.name}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${styleColor(card.family?.includes('RSI2') ? 'mean_reversion' : card.family?.includes('TREND') ? 'trend_following' : 'seasonal')}`}>
                {card.family || '—'}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.color}`}>
                {cfg.emoji} {cfg.label}
              </span>
            </div>
          </div>
        </div>

        {/* Pendulum */}
        <div className="text-right bg-slate-50 rounded-lg px-3 py-1.5">
          <div className={`flex items-center gap-1 justify-end ${pdl.color}`}>
            <span>{pdl.emoji}</span>
            <span className="text-lg font-bold">{card.pendulumMultiplier}x</span>
          </div>
          <div className="text-[10px] text-slate-400">{pdl.label}</div>
        </div>
      </div>

      {/* Performance reale su questo conto */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-3">
        <MetricBox
          label="P/L totale"
          value={fmtUsd(card.totalPnl, 2)}
          valueColor={plColor(card.totalPnl)}
          sub={`${card.totalTrades} trade`}
        />
        <MetricBox
          label="Win rate"
          value={card.recentWinPct !== null ? `${fmt(card.recentWinPct, 1)}%` : '—'}
          valueColor={card.recentWinPct !== null && card.recentWinPct >= 55 ? 'text-green-600' : 'text-slate-700'}
        />
        <MetricBox
          label="Media per trade"
          value={card.avgTrade !== null ? fmtUsd(card.avgTrade, 2) : '—'}
          valueColor={card.avgTrade !== null ? plColor(card.avgTrade) : 'text-slate-500'}
        />
        <MetricBox
          label="Perdite consecutive"
          value={String(card.consecLosses)}
          valueColor={card.consecLosses >= 3 ? 'text-red-600' : 'text-slate-700'}
        />
        <MetricBox
          label="Distanza dal massimo"
          value={fmtPct(card.ddFromPeak)}
          valueColor={card.ddFromPeak > 5 ? 'text-red-600' : card.ddFromPeak > 2 ? 'text-amber-600' : 'text-slate-700'}
        />
        <MetricBox
          label="Coerenza test"
          value={`${card.fitnessScore}%`}
          valueColor={fitnessColor(card.fitnessScore)}
          sub={`affidabilità ${card.fitnessConfidence}%`}
        />
      </div>

      {/* Segnali (flags) */}
      {card.flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {card.flags.map(f => {
            const flagCfg = FLAG_IT[f] || { label: f.replace(/_/g, ' '), color: 'bg-slate-50 text-slate-500' }
            return (
              <span key={f} className={`text-[11px] px-2 py-0.5 rounded-full ${flagCfg.color}`}>
                {flagCfg.label}
              </span>
            )
          })}
        </div>
      )}

      {/* Raccomandazione */}
      <div className={`mt-3 px-3 py-2 ${cfg.bg} rounded-lg text-sm ${cfg.color} flex items-start gap-2`}>
        <span className="text-base mt-0.5">{cfg.emoji}</span>
        <div>
          <div className="font-medium">{card.recommendation}</div>
          <div className="text-[11px] opacity-75 mt-0.5">{cfg.desc}</div>
        </div>
      </div>
    </div>
  )
}

function MetricBox({ label, value, valueColor, sub }: { label: string; value: string; valueColor: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] text-slate-400 uppercase">{label}</div>
      <div className={`font-mono font-bold text-sm mt-0.5 ${valueColor}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  )
}
