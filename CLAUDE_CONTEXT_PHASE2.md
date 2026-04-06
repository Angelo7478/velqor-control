# Velqor Control Room — PHASE 2 SNAPSHOT (2026-04-06)

> Backup di stato a fine Sprint 5 (Portfolio Builder v2 completato).
> Se serve ripristinare il contesto da qui, basta dare questo file a Claude.

---

## Cosa e' stato costruito in Phase 2

### Sprint 1 — Sizing Engine + Kelly + HRP (2026-04-04)
- Migration 004-005: strategy_style, strategy_category, strategy_family, Kelly columns, sizing tables, correlations
- Classificazione 17 strategie in 7 famiglie logiche
- quant-utils.ts: sizing engine client-side (Kelly/Half-Kelly, RoR, HRP family-aware, fitness scoring)
- Pagina /sizing con 4 tab (Strategy Grid, DD Budget, Correlazioni, Fitness Report)
- Fitness scoring istituzionale con confidence logaritmica

### Sprint 2 — Correlazioni + Family HRP (2026-04-04)
- Migration 005: strategy_family, qel_strategy_correlations
- Pearson correlation da trade reali (>= 10 giorni overlap) + family-based fallback
- HRP 2 livelli: budget tra famiglie (inverse variance) -> equi-split dentro famiglia

### Sprint 3 — Health Monitor + Pendulum (2026-04-05)
- Migration 006: qel_strategy_health, view v_strategy_equity_curve, v_strategy_recent_performance
- Pagina /health: traffic-light per strategia, pendulum context-aware, regime detection
- Pendulum: 0.85x al peak, 1.0x se outperforming, fino a 1.3x in DD se edge validato
- Regime mismatch: strategie trend in range = "fase sbagliata" non "rotta"

### Sprint 4 — Monte Carlo + Scenari (2026-04-05)
- Monte Carlo bootstrap: resample trade reali -> N equity paths con percentili
- Pagina /scenarios: confronto 3 scenari (1/4, 1/2, Full Kelly) + fan chart
- Statistiche: rendimento mediano, DD mediano/peggiore, probabilita' rovina/profitto

### Sprint 5 — Portfolio Builder v2 (2026-04-06)
- Pagina /builder (1425 righe): builder completo con equity curves
- Selettore conto sorgente + equity base personalizzabile
- Auto-scaling lotti: userLots = baseLots * (equityBase / sourceAccountSize)
- Due modalita' sizing: Proportional (lineare) vs Optimized (Kelly+HRP)
- Equity curve interattive Recharts (portfolio combinato + singole strategie)
- Save/Load PTF su qel_portfolios + Export JSON
- Report HTML completo stampabile come PDF:
  - KPI principali (P/L, Return%, Max DD, Sharpe, Recovery)
  - Metriche dettagliate (performance + rischio + alert FTMO)
  - Analisi temporale (periodo, medie mensili, proiezione annua)
  - Breakdown mensile con barre colorate
  - Grafico SVG equity curve inline (gradient, baseline, max DD marker)
  - Composizione portfolio + diversificazione stile/asset
  - Configurazione lotti copiabile

---

## Architettura attuale

### File principali
```
src/
  lib/quant-utils.ts                (~1400 righe) — Tutte le utility:
    - fmt, fmtUsd, fmtPct, plColor, groupColor, styleColor, styleLabel
    - runSizingEngine(), SizingInput, PortfolioSizingOutput, KellyMode
    - calcKelly(), calcHRPWeights(), calcRoR()
    - runMonteCarlo(), MonteCarloResult
    - calcFitnessScore(), FitnessResult
    - CHART_COLORS, PORTFOLIO_COLOR
    - buildEquityCurves(), calcCurveStats()
    - TradeForCurve, EquityCurvePoint, StrategyEquityCurve, CombinedCurvePoint
    - CurveStats, PortfolioStats

  app/(dashboard)/divisioni/quant/
    page.tsx                        (~1200 righe) — Overview dashboard
    account-dashboard.tsx           (~1800 righe) — Dashboard per conto
    quant-nav.tsx                   — Navigazione unificata
    conti/page.tsx                  — Gestione conti CRUD
    import/page.tsx                 — Import CSV/HTML
    sizing/page.tsx                 — Sizing Engine 4 tab
    health/page.tsx                 — Health Monitor
    scenarios/page.tsx              — Monte Carlo + scenari
    builder/page.tsx                (~1425 righe) — Portfolio Builder v2
```

### Database
Tabelle Phase 2 aggiunte:
- qel_strategy_sizing — sizing raccomandato per strategia/portfolio
- qel_sizing_engine_runs — audit log sizing
- v_strategy_daily_pnl — view P/L giornaliero per correlazioni

Colonne aggiunte:
- qel_strategies: strategy_style, strategy_category, strategy_family, point_value, test_kelly, test_optimal_f, test_sharpe/sortino/calmar, real_kelly, real_optimal_f, benchmark, alpha
- qel_portfolios: kelly_fraction_mode, correlation_lookback_days, vol_target, style_balance_target, deleverage_threshold, last_optimization_at, optimization_result
- qel_portfolio_strategies: kelly_lots, vol_adjusted_lots, hrp_lots, final_lots, dd_budget_allocation_pct, weight, risk_contribution_pct

SQL Functions:
- fn_calc_kelly(win_pct, payoff)
- fn_calc_risk_of_ruin(win_pct, payoff, risk_fraction, ruin_pct)

### Infrastruttura
- Deploy: Vercel auto-deploy su push a main
- Bridge: Python su VPS Windows, sync ogni 5 min
- VPS: PowerShell (usa `;` MAI `&&`)
- Comandi VPS: cd C:\mt5-bridge; python launcher.py --vps NOME
- Account: 10k_ftmo, 80k_ftmo, "100k ftmo Angelo"

### Famiglie strategia (7 cluster logici)
1. RSI2_SP500 (5 varianti: StdDev, BB, KC, ADX, ATR — magic 7-11)
2. RSI2_DAX (3 varianti: SuperTrend, H3, Smoothed MA — magic 12, 15, 18)
3. RSI2_FX_JPY (2 varianti: CCI Long, CCI v2 — magic 16-17)
4. RSI2_FX_CAD (2 varianti: CCI, Keltner — magic 19-20)
5. BTC_TREND (2 strategie: EMA ADX Long, SuperTrend Short — magic 4-5)
6. NQ_SEASONAL (2 pattern: Long Monday, Short Tuesday — magic 3, 6)
7. OIL_SEASONAL (2 pattern: Long Thursday BB, Short BullsPower — magic 13-14)

---

## Stato operativo conti (al 2026-04-06)

| Conto | Size | Balance | Trade DB | Bridge |
|-------|------|---------|----------|--------|
| FTMO 10K - Storico | $10,000 | ~$10,719 | 384 | online |
| FTMO 80K #2 gruppo | $80,000 | ~$84,417 | 361 | online |
| FTMO 100K #1 | $100,000 | ~$107,376 | 40 | da verificare |

---

## Cosa resta da fare (Sprint 6+)

### Priorita' alta
- ~108 trade senza magic number (bridge enrich da VPS)
- Import secondo CSV 360 trade per conto 100K
- Benchmark: confronto strategia vs buy-and-hold (Yahoo Finance per alpha)
- Tooltip didattici (?) su metriche tecniche

### Priorita' media
- Margine utilizzato nel builder
- Import dati WFM/MC da SQX -> qel_strategy_tests
- Costi per trade: spread + commissioni + swap -> expectancy netta
- Grafica report: logo Velqor + "Velqor Intelligent Quant System"
- Rolling correlations (target fine 2026)

### Priorita' bassa / lungo termine
- AI Sizing Advisor
- N8N: weekly optimization + sync monitor + alert Telegram
- Aggiornare bridge VPS (DD storico)
- Portfolio Builder multi-contesto (future, capitale proprio)
- Confronto con fase di mercato (regime volatilita', trend, range)

---

## Git history Phase 2 (ultimi 20 commit)
```
e60bf49 fix: SVG equity curve chart in report
387325b feat: report with temporal analysis, monthly breakdown, equity curve SVG
8f670ac feat: integrate sizing engine into Builder — optimize lots with Kelly+HRP
b970c2d feat: auto-scale lots proportional to equity base
460fd8b feat: lot scaling controls for Builder
b1f5ad0 feat: Builder v2 — equity curves, lot customization, PTF save/load, full report
d0ae19f feat: bridge v2.1 + bridge status indicators on dashboard
dca3377 feat: unified quant navigation bar across all pages
e67758d fix: builder shows real P/L instead of theoretical
d4cc56f feat: Sprint 5 — Portfolio Builder with cost analysis
684919e docs: update context with Sprint 1-4 completed
c88ac75 fix: DD Budget crash — replace Recharts with pure HTML bars
5837fba docs: update CLAUDE_CONTEXT.md with Phase 2 pages and files
f6e0a5d fix: sizing page crashes and stale data
04b8d03 feat: Sprint 4 — Monte Carlo simulation & scenario comparison
dee53a0 fix: normalize DD comparison by lot size
52a7e4b improve: health monitor v2 — Italian UI, per-account data
a499c09 fix: context-aware health scoring and per-account DD filtering
50af84b feat: Sprint 3 — health monitoring, pendulum sizing, regime detection
52f69d8 feat: Sprint 2 — correlations, family clustering & HRP sizing
```

## Nota per Claude
- L'utente parla italiano, il codice e i commit sono in inglese
- PowerShell su VPS: usa `;` NEVER `&&`
- Node path: /opt/homebrew/bin/node (Homebrew Mac)
- tsc: ./node_modules/.bin/tsc --noEmit (NON npx tsc)
- Phase 1 backup: CLAUDE_CONTEXT_PHASE1.md
