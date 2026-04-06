# Velqor Control Room — Contesto per Claude

## Cosa è
Sistema operativo centrale di Velqor. App Next.js 14 (App Router) + Tailwind CSS + Supabase.
Deploy: Vercel → control.velqor.it
Repo: github.com/Angelo7478/velqor-control

## Supabase
- Project ID: `gotbfzdgasuvfskzeycm`
- Org ID: `a0000000-0000-0000-0000-000000000001`
- Accesso: Supabase MCP tool con `execute_sql`

## Stack
- Next.js 14 App Router, TypeScript, Tailwind CSS
- Supabase (PostgreSQL + Auth + RLS)
- Recharts per grafici
- Node: `/opt/homebrew/bin/node` (Homebrew Mac)
- Git: user Angelo Pasian, pasian74@gmail.com

## Struttura app
```
src/
  app/(dashboard)/
    divisioni/quant/          ← Divisione Quant (COMPLETATA)
      page.tsx                ← Overview: KPI, ranking strategie, conti, distribuzione
      account-dashboard.tsx   ← Dashboard conto: equity curve, DD, strategie, costi, trade
      conti/page.tsx          ← Gestione conti FTMO (CRUD)
      import/page.tsx         ← Import CSV/HTML trade da FTMO
    divisioni/real-estate/    ← Overview RE (placeholder)
    divisioni/quant/
      sizing/page.tsx         ← Sizing Engine (Kelly, HRP, DD Budget, Correlazioni, Fitness)
      health/page.tsx         ← Health Monitor (salute strategie, pendulum, regime detection)
      scenarios/page.tsx      ← Monte Carlo + confronto 3 scenari
    divisioni/ai/             ← Overview AI (placeholder)
    memorandum/               ← Sistema stima/valuta/esegui
    progetti/                 ← Progetti + task
    calendario/               ← Calendario eventi
  types/database.ts           ← TypeScript interfaces per tutte le tabelle
  lib/supabase-browser.ts     ← Client Supabase
  lib/quant-utils.ts          ← Utility condivise + Sizing Engine + Monte Carlo
mt5-bridge/
  bridge.py                   ← Bridge Python MT5→Supabase (gira su VPS Windows)
  config.py                   ← Config base
  config_local.py             ← Config locale (NON su GitHub)
  GUIDA_VPS.md                ← Guida setup/aggiornamento VPS
```

## Database — Tabelle Quant
| Tabella | Scopo |
|---------|-------|
| `qel_accounts` | Conti FTMO (3 conti: 10K, 80K, 100K) |
| `qel_account_snapshots` | Snapshot equity ogni 5 min dal bridge |
| `qel_trades` | Trade importati (784 totali tra tutti i conti) |
| `qel_strategies` | 18 strategie (magic 3-20) |
| `qel_sizing_rules` | Regole sizing per strategia |

### Colonne chiave qel_accounts
`balance, equity, floating_pl, margin_used, account_size, equity_peak, max_total_dd_pct, max_daily_dd_pct, daily_dd_pct, total_dd_pct, max_daily_loss_pct (5%), max_total_loss_pct (10%)`

### Colonne chiave qel_trades
`account_id, symbol, direction, lots, open_time, close_time, open_price, close_price, profit, swap, commission, net_profit, magic, strategy_id, duration_seconds, is_open, position_id`

## Conti FTMO attivi
| Nome | ID | Size | Balance | Trade | Max DD |
|------|-----|------|---------|-------|--------|
| FTMO 10K - Storico | 759cc852-... | $10,000 | $10,719 | 384 | 3.21% |
| FTMO 80K #2 gruppo | 2d78ccfc-... | $80,000 | $84,417 | 361 | 3.53% |
| FTMO 100K #1 | (query per ID) | $100,000 | $107,376 | 40 | 3.44% |

## Strategie (18 totali, magic 3-20)
| Magic | Nome | Simbolo | Dir | Status |
|-------|------|---------|-----|--------|
| 3 | NQ H1 Long Monday | US100.cash | buy | active |
| 4 | BTC Long EMA ADX | BTCUSD | buy | active |
| 5 | BTC Short SuperTrend | BTCUSD | sell | active |
| 6 | NQ Short Tuesday | US100.cash | sell | active |
| 7 | SP500 RSI2 StdDev | US500.cash | buy | active |
| 8 | SP500 RSI2 BB | US500.cash | buy | active |
| 9 | SP500 RSI2 KC | US500.cash | buy | active |
| 10 | SP500 RSI2 ADX | US500.cash | buy | active |
| 11 | SP500 RSI2 ATR | US500.cash | buy | active |
| 12 | DAX RSI2 SuperTrend | GER40.cash | buy | active |
| 13 | OIL Long Thursday BB | UKOIL.cash | buy | active |
| 14 | OIL Short BullsPower | UKOIL.cash | sell | paused |
| 15 | DAX RSI2 H3 | GER40.cash | buy | paused |
| 16 | USDJPY RSI2 CCI Long | USDJPY | buy | active |
| 17 | USDJPY RSI2 CCI v2 | USDJPY | buy | active |
| 18 | DAX RSI2 Smoothed MA | GER40.cash | buy | active |
| 19 | USDCAD RSI2 CCI | USDCAD | buy | active |
| 20 | USDCAD RSI2 Keltner | USDCAD | buy | active |

## Bridge MT5
- Gira su VPS Windows con MT5
- Sync ogni 5 min (balance, equity, DD, posizioni aperte, trade chiusi)
- Calcola e salva: equity_peak, max_total_dd_pct, max_daily_dd_pct
- Comandi: `python bridge.py once|loop|enrich`
- Aggiornamento VPS: vedi GUIDA_VPS.md sezione "Aggiornare il Bridge"

## Cosa è stato fatto (Phase 1 Quant)
- [x] Import CSV/HTML con normalizzazione header (BOM, NBSP, duplicati)
- [x] Equity curve dai trade con selettore temporale (1W-ALL)
- [x] DD storico calcolato da trade (peak-to-trough), non snapshot
- [x] Analisi costi (swap/commissioni) con breakdown per simbolo e strategia + % su P/L e capitale
- [x] Ranking strategie basato su performance reale (min 15 trade) con consistenza vs test
- [x] Strategie paused visibili se hanno trade
- [x] Tabella trade sortabile con 12 colonne
- [x] Bridge enrich per magic number da MT5
- [x] Auto-assign magic da logica strategia (per 10K e 80K)
- [x] Rendimenti mensili, statistiche trading, distribuzione per strumento

## Phase 2 — Institutional Sizing & Portfolio Analysis (dal 2026-04-04)

### Sprint 1 — Sizing Engine + Kelly + HRP
- [x] Migration 004-005: strategy_style/category/family, Kelly, portfolio params, sizing tables, correlations
- [x] Classificazione 17 strategie in 7 famiglie: RSI2_SP500(5), RSI2_DAX(2), RSI2_FX_JPY(2), RSI2_FX_CAD(2), BTC_TREND(2), NQ_SEASONAL(2), OIL_SEASONAL(2)
- [x] Portfolio FTMO 10K (ID: b32e16ca-...) con 17 strategie (M14 riattivata)
- [x] `quant-utils.ts` — Sizing engine: Kelly/Half-Kelly, RoR, HRP family-aware, correlazioni (Pearson + family-based), fitness scoring con confidence logaritmica e normalizzazione DD per lotti
- [x] `/divisioni/quant/sizing` — 4 tab: Strategy Grid, DD Budget (barre HTML), Correlazioni (heatmap + allocazione famiglie), Fitness Report (per-conto)

### Sprint 2 — Correlazioni + Family HRP
- [x] Migration 005: strategy_family, qel_strategy_correlations, HRP columns
- [x] Pearson correlation dove >= 10 giorni overlap, family-based dove insufficiente
- [x] HRP 2 livelli: budget tra famiglie (inverse variance) → equi-split dentro famiglia

### Sprint 3 — Health Monitor + Pendulum
- [x] Migration 006: qel_strategy_health, v_strategy_equity_curve, v_strategy_recent_performance
- [x] `/divisioni/quant/health` — Traffic-light per strategia, pendulum context-aware, regime detection
- [x] Pendulum: 0.85x al peak (se underperforming), 1.0x (se outperforming), fino a 1.3x in DD (se edge validato)
- [x] Regime mismatch: strategie trend con expectancy negativa → "fase sbagliata" non "rotta"
- [x] Dati per-conto: DD, win rate, expectancy filtrati per account_id, DD normalizzato per lotti

### Sprint 4 — Monte Carlo + Scenari
- [x] Monte Carlo bootstrap: resample trade reali → N equity paths con percentili 5/25/50/75/95
- [x] `/divisioni/quant/scenarios` — Confronto 3 scenari (1/4 Kelly, 1/2 Kelly, Full Kelly) + fan chart
- [x] Statistiche: rendimento mediano, DD mediano/peggiore, probabilità rovina, probabilità profitto

### Nuove tabelle Phase 2
| Tabella | Scopo |
|---------|-------|
| `qel_strategy_sizing` | Sizing raccomandato per strategia/portfolio (Kelly, vol, HRP, DD budget) |
| `qel_sizing_engine_runs` | Audit log di ogni run del sizing engine |
| `v_strategy_daily_pnl` | View: P/L giornaliero per strategia (base per correlazioni) |

### Nuove colonne Phase 2
- `qel_strategies`: strategy_style, strategy_category, point_value, test_kelly, test_optimal_f, test_sharpe/sortino/calmar, real_kelly, real_optimal_f, benchmark/alpha
- `qel_portfolios`: kelly_fraction_mode, correlation_lookback_days, vol_target, style_balance_target, deleverage_threshold, last_optimization_at, optimization_result
- `qel_portfolio_strategies`: kelly_lots, vol_adjusted_lots, hrp_lots, final_lots, dd_budget_allocation_pct, weight, risk_contribution_pct

### SQL Functions
- `fn_calc_kelly(win_pct, payoff)` → Kelly fraction f*
- `fn_calc_risk_of_ruin(win_pct, payoff, risk_fraction, ruin_pct)` → RoR adattato prop firm

### Sizing Engine Flow
1. Seleziona portfolio → carica strategie linkate
2. Calcola Kelly/Half-Kelly per ogni strategia (blend test+real se real_trades ≥ 30)
3. Alloca DD budget equamente tra strategie
4. Converte frazioni in lotti: `lots = dd_budget / mc95_dd_scaled`
5. Cap RoR: se > 5%, riduci lotti del 10%
6. Verifica: somma DD ≤ budget → se over, scala proporzionalmente
7. Salva run in `qel_sizing_engine_runs`

### Sprint 5 — Portfolio Builder v2
- [x] `/divisioni/quant/builder` — Builder completo (1425 righe)
- [x] Selettore conto sorgente + equity base personalizzabile
- [x] Auto-scaling lotti: `userLots = baseLots × (equityBase / sourceAccountSize)`
- [x] Due modalità: Proportional (scaling lineare) vs Optimized (Kelly+HRP dal sizing engine)
- [x] Equity curve interattive per strategia (Recharts) + portfolio combinato
- [x] Save/Load PTF su qel_portfolios + Export JSON
- [x] Report HTML completo stampabile:
  - KPI, metriche dettagliate, alert FTMO
  - Analisi temporale + proiezione annua
  - Breakdown mensile con barre
  - Grafico SVG equity curve inline
  - Composizione portfolio + diversificazione stile/asset
  - Configurazione lotti copiabile

### Struttura Phase 2 (aggiornata)
```
src/
  lib/quant-utils.ts              ← Utility condivise + Sizing + MC + Health + Builder (~1400 righe)
  app/(dashboard)/divisioni/quant/
    page.tsx                      ← Overview: KPI, ranking, conti, distribuzione
    account-dashboard.tsx         ← Dashboard conto: equity, DD, strategie, costi, trade
    quant-nav.tsx                 ← Navigazione unificata tutte le pagine
    conti/page.tsx                ← Gestione conti FTMO (CRUD)
    import/page.tsx               ← Import CSV/HTML trade
    sizing/page.tsx               ← Sizing Engine (4 tab: Grid, DD Budget, Correlazioni, Fitness)
    health/page.tsx               ← Health Monitor (traffic-light, pendulum, regime)
    scenarios/page.tsx            ← Monte Carlo + 3 scenari + fan chart
    builder/page.tsx              ← Portfolio Builder v2 (equity curves, report, PTF)
```

### Cosa resta (Sprint 6+)
- [ ] ~108 trade senza magic → bridge enrich da VPS
- [ ] Import secondo CSV 360 trade per 100K
- [ ] Benchmark: confronto strategia vs buy-and-hold sottostante (alpha via Yahoo Finance)
- [ ] Tooltip didattici (?) su metriche tecniche — componente InfoTooltip
- [ ] Margine utilizzato nel builder
- [ ] Import dati WFM/MC da SQX → popolare qel_strategy_tests
- [ ] Costi per trade: spread + commissioni + swap → expectancy netta
- [ ] Grafica report: logo Velqor + "Velqor Intelligent Quant System"
- [ ] AI Sizing Advisor
- [ ] N8N: weekly optimization + sync monitor + alert Telegram
- [ ] Aggiornare bridge VPS (nuova versione con DD storico)
- [ ] Rolling correlations (target fine 2026 con dati sufficienti)
- [ ] Portfolio Builder multi-contesto: config per future/capitale proprio

## File di riferimento
- `/Users/angelopasian/Downloads/QEL_MASTER.xlsx` — Registry strategie con metriche test
- `mt5-bridge/GUIDA_VPS.md` — Guida completa setup/aggiornamento VPS
- `CLAUDE_CONTEXT_PHASE1.md` — Snapshot Phase 1 (backup)

## Note importanti
- Il bridge legge con investor password (read-only, no trade)
- FTMO limiti: 5% daily DD, 10% total DD
- Le strategie sono tutte automatiche (QuantEdgeLab / SQX)
- I dati real nelle qel_strategies (real_trades, real_pl, real_ret_dd) vanno ricalcolati periodicamente
- L'utente parla italiano, il codice/commit sono in inglese
- Phase 1 backup: CLAUDE_CONTEXT_PHASE1.md
