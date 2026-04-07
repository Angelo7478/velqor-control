# Velqor Control Room — Contesto per Claude

## Cosa è
Sistema operativo centrale di Velqor. App Next.js 14 (App Router) + Tailwind CSS + Supabase.
Deploy: Vercel → control.velqor.it | Repo: github.com/Angelo7478/velqor-control

## Stack
- Next.js 14 App Router, TypeScript, Tailwind CSS, Recharts
- Supabase (PostgreSQL + Auth + RLS) — Project ID: `gotbfzdgasuvfskzeycm`
- Node: `/opt/homebrew/bin/node` | tsc: `./node_modules/.bin/tsc --noEmit`
- Git: user Angelo Pasian, pasian74@gmail.com
- L'utente parla italiano, codice/commit in inglese

## Regole critiche
- **MAI aggregare metriche $ cross-account** (10K vs 80K vs 100K hanno size diversi). Ogni pagina ha selettore conto, dati dalla view `v_strategy_recent_performance`
- **I campi `real_*` in `qel_strategies` sono aggregati** — NON usarli mai. Usare la view filtrata per account_id
- **PowerShell su VPS**: usa `;` MAI `&&`
- **Bridge**: un processo per MT5 terminal, mai multi-account

## Struttura app
```
src/
  app/(dashboard)/divisioni/quant/
    page.tsx                ← Overview: KPI, ranking, selettore conto, benchmark chart, regime
    account-dashboard.tsx   ← Dashboard conto: equity curve, DD, strategie, costi, trade
    conti/page.tsx          ← Gestione conti FTMO (CRUD)
    import/page.tsx         ← Import CSV/HTML trade
    sizing/page.tsx         ← Sizing Engine (Kelly, HRP, DD Budget, Correlazioni, Fitness)
    health/page.tsx         ← Health Monitor (traffic-light, pendulum, regime detection)
    scenarios/page.tsx      ← Monte Carlo + confronto 3 scenari
    builder/page.tsx        ← Portfolio Builder v2 (equity curves, report, save/load PTF)
    quant-nav.tsx           ← Navigazione unificata
  components/ui/InfoTooltip.tsx  ← Tooltip "?" con createPortal (responsive)
  lib/
    quant-utils.ts          ← Utility quant (~1600 righe): sizing, MC, health, benchmark, regime
    tooltip-content.ts      ← 23 metriche in italiano con formula/esempio
    supabase-browser.ts     ← Client Supabase
  types/database.ts         ← TypeScript interfaces
mt5-bridge/
  bridge.py                 ← Bridge v2.2 (auto-reconnect, heartbeat)
  launcher.py               ← Launcher v2.0 (health check, restart, Telegram)
  scheduled-sync-*.bat      ← Sync giornaliero per VPS (Windows Task Scheduler)
```

## Database — Tabelle principali
| Tabella | Scopo |
|---------|-------|
| `qel_accounts` | Conti FTMO (3: 10K, 80K, 100K) |
| `qel_account_snapshots` | Snapshot equity ogni 5 min dal bridge |
| `qel_trades` | Trade importati (787 totali) |
| `qel_strategies` | 18 strategie (magic 3-20) |
| `qel_portfolios` | Portfolio salvati dal builder |
| `qel_portfolio_strategies` | Strategie linkate a portfolio con sizing |
| `qel_strategy_sizing` | Sizing raccomandato per strategia/portfolio |
| `qel_sizing_engine_runs` | Audit log run sizing engine |
| `qel_benchmarks` | Prezzi OHLCV Yahoo Finance per 7 asset |

### Views
- `v_strategy_recent_performance` — Performance per-account con payoff, profit_factor, max_dd, recovery_factor, avg_duration_hours, avg_lots
- `v_strategy_equity_curve` — Equity curve per strategia/account
- `v_strategy_daily_pnl` — P/L giornaliero per correlazioni

### SQL Functions
- `fn_calc_kelly(win_pct, payoff)` → Kelly fraction f*
- `fn_calc_risk_of_ruin(win_pct, payoff, risk_fraction, ruin_pct)` → RoR
- `fn_recalc_strategy_stats()` → Ricalcolo stats reali aggregate

## Dati attuali (2026-04-07)
- 10K: 385 trade (48 senza magic — storico troppo vecchio per enrich)
- 80K: 361 trade (tutti con magic)
- 100K: 41 trade (1 senza magic)
- 18 strategie, 7 famiglie, 7 asset con benchmark Yahoo Finance
- Bridge: .bat per sync giornaliero via Windows Task Scheduler

## Conti FTMO
| Nome | ID | Size |
|------|-----|------|
| FTMO 10K - Storico | 759cc852-8e7b-4130-8b3c-29b13a68d659 | $10,000 |
| FTMO 80K #2 gruppo | 2d78ccfc-... | $80,000 |
| FTMO 100K #1 | (query per ID) | $100,000 |

## Edge Functions
- `fetch-benchmarks` — Yahoo Finance OHLCV per 7 asset, calcolo alpha
- `bridge-watchdog` — Monitoring bridge con dedup alert + state machine

## Completato (Phase 1-3)
- Import trade, equity curves, DD tracking, ranking strategie, bridge MT5
- Sizing Engine (Kelly/HRP), correlazioni, Health Monitor, Monte Carlo, Portfolio Builder v2
- Benchmark Alpha, regime detection, InfoTooltip, eliminazione aggregazione cross-account
- Responsive mobile, bridge reliability (v2.2 + launcher v2.0 + watchdog)

## Completato (Phase 4) — 2026-04-07
- **Margine utilizzato**: card KPI nel builder (margine richiesto, utilizzo %, libero, leva, nozionale) + colonna margine nella tabella strategie + sezione margine nel report. Costanti FTMO_MARGIN_SPECS per 7 simboli. Calcolo reattivo via useMemo.
- **Logo Velqor nel report**: logo gufo base64 embedded + rebrand "Velqor Intelligent Quant System" in header e footer del report stampabile.
- **Import WFM/MC da SQX**: seed 17 righe in qel_strategy_tests (audit storico). Nuova sezione "Test SQX" nella pagina import con parser CSV per formato Metriche SQX (17 header riconosciuti), preview tabellare, insert in qel_strategy_tests + update qel_strategies.test_*.
- **AI Sizing Advisor**: engine a regole in quant-utils (generateSizingAdvice) che combina fitness, pendulum, health, regime in 8 livelli di raccomandazione. Card nel builder con semaforo portfolio, lista raccomandazioni per strategia, bottone "Applica suggerimenti".
- **Costi per trade**: gia' coperti (net_profit usato ovunque, dashboard ha Analisi Costi completa).
- **10K trade ambigui**: skippati (35 trade senza magic, non vale l'effort).

## Prossime fasi (backlog)
- N8N automazioni (weekly optimization, sync monitor, alert Telegram)
- Rolling correlations (target fine 2026, servono piu' dati)
- Builder multi-contesto (config per future / capitale proprio / limiti DD personalizzati)
