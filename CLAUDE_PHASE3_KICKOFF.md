# Velqor Quant — Phase 3 Kickoff

## Istruzioni per Claude
Leggi questi file per avere il contesto completo:
1. `CLAUDE_CONTEXT.md` — contesto principale aggiornato
2. `CLAUDE_CONTEXT_PHASE2.md` — snapshot Phase 2 (Sprint 1-5 completati)

## Cosa e' stato completato

### Phase 1 — Dashboard & Import
Import trade, equity curves, DD tracking, ranking strategie, bridge MT5

### Phase 2 — Institutional Sizing & Portfolio Analysis (Sprint 1-6)
1. **Sizing Engine** — Kelly/HRP, fitness scoring, DD budget
2. **Correlazioni** — Pearson + family-based, HRP 2 livelli
3. **Health Monitor** — Semaforo strategie, Pendulum, regime detection
4. **Monte Carlo** — Bootstrap, 3 scenari Kelly, fan chart
5. **Portfolio Builder v2** — Equity curves, auto-scaling lotti, report HTML completo con grafico SVG
6. **Bridge Reliability** — Auto-reconnect, heartbeat monitoring, Telegram alerts, pg_cron watchdog

### Pagine attive
- `/divisioni/quant` — Overview dashboard
- `/divisioni/quant/conti` — Gestione conti CRUD
- `/divisioni/quant/import` — Import CSV/HTML trade
- `/divisioni/quant/sizing` — Sizing Engine (4 tab)
- `/divisioni/quant/health` — Health Monitor
- `/divisioni/quant/scenarios` — Monte Carlo + scenari
- `/divisioni/quant/builder` — Portfolio Builder v2

### File chiave
- `src/lib/quant-utils.ts` (~1400 righe) — tutte le utility quant
- `src/app/(dashboard)/divisioni/quant/builder/page.tsx` (~1425 righe) — builder
- `mt5-bridge/bridge.py` — bridge v2.2 con auto-reconnect
- `mt5-bridge/launcher.py` — launcher v2.0 con heartbeat + Telegram

## Cosa fare in Phase 3

### Priorita' ALTA — Da fare subito
1. **~108 trade senza magic number** — Lanciare `python bridge.py --mt5-path "..." enrich` sulla VPS 10K per assegnare i magic number ai trade importati da CSV
2. **Import CSV 360 trade per 100K** — Il conto 100K ha solo 40 trade nel DB, mancano ~360 trade storici da importare
3. **Benchmark vs buy-and-hold** — Confronto strategia vs sottostante (Yahoo Finance) per calcolare alpha reale. Aggiungere colonna nella tabella strategie e nel builder
4. **Tooltip didattici** — Pulsanti "?" su metriche tecniche con spiegazione + esempio numerico. Componente InfoTooltip riutilizzabile

### Priorita' MEDIA
5. **Margine utilizzato** — Estrarre e visualizzare uso margine nel builder
6. **Costi per trade** — Spread + commissioni + swap → expectancy netta
7. **Grafica report** — Logo Velqor + "Velqor Intelligent Quant System" nel report PDF
8. **Import dati WFM/MC da SQX** — Popolare qel_strategy_tests con risultati backtest

### Priorita' BASSA / Lungo termine
9. **AI Sizing Advisor** — Suggerimenti automatici basati su regime + fitness
10. **N8N automazioni** — Weekly optimization + alert Telegram
11. **Rolling correlations** — Quando ci saranno abbastanza dati (target fine 2026)
12. **Builder multi-contesto** — Config per future / capitale proprio

## Dati di riferimento
- 3 conti FTMO attivi: 10K ($10,719), 80K ($84,417), 100K ($107,376)
- 18 strategie (magic 3-20), 7 famiglie logiche
- ~787 trade nel DB
- Bridge v2.2 attivo su tutte le VPS con auto-reconnect + Telegram alerts

## Note operative
- L'utente parla italiano, codice/commit in inglese
- PowerShell su VPS: usa `;` MAI `&&`
- Node: `/opt/homebrew/bin/node` (Homebrew Mac), tsc: `./node_modules/.bin/tsc --noEmit`
- Deploy: git push → Vercel auto-deploy
- Supabase MCP: `execute_sql` per query
