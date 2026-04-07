# Velqor Quant — Phase 4 Kickoff

## Istruzioni per Claude
Leggi questi file per avere il contesto completo:
1. `CLAUDE_CONTEXT.md` — contesto principale aggiornato (include Phase 1-3)
2. Le userMemories contengono profilo Angelo, visione Velqor, infrastruttura

## Cosa e' stato completato

### Phase 1 — Dashboard & Import
Import trade, equity curves, DD tracking, ranking strategie, bridge MT5

### Phase 2 — Institutional Sizing & Portfolio Analysis
Sizing Engine (Kelly/HRP), correlazioni, Health Monitor, Monte Carlo, Portfolio Builder v2, Bridge Reliability

### Phase 3 — Data Completion + Benchmark + Regime (completata 2026-04-07)
1. Import 360 trade 80K + enrich magic (bridge VPS)
2. InfoTooltip — 23 metriche IT con formula/esempio, createPortal responsive
3. Benchmark Alpha — Edge Function Yahoo Finance, colonna ranking, bottone on-demand
4. **Eliminazione aggregazione cross-account** — REGOLA CRITICA: mai mischiare metriche $ tra conti diversi. Ogni pagina ha selettore conto, dati dalla view `v_strategy_recent_performance`
5. Grafico duale strategia vs buy-and-hold + regime detection (SMA50/SMA200)
6. Tabella performance per regime di mercato
7. Health page fixata con selettore conto diretto
8. Responsive: tooltip portal, header mobile, griglie adattive

## Regole critiche stabilite
- **MAI aggregare metriche $ cross-account** (10K vs 80K vs 100K hanno size diversi)
- **PowerShell su VPS**: usa `;` MAI `&&`
- **Bridge**: un processo per MT5 terminal, mai multi-account
- I campi `real_*` in `qel_strategies` sono aggregati — NON usarli mai. Usare `v_strategy_recent_performance` filtrata per account_id

## Dati attuali
- 10K: 385 trade (48 senza magic — troppo vecchi per MT5 history)
- 80K: 361 trade (tutti con magic)
- 100K: 41 trade (1 senza magic)
- 18 strategie, 7 famiglie, 7 asset con benchmark Yahoo Finance
- Bridge: .bat per sync giornaliero via Windows Task Scheduler

## Cosa fare in Phase 4

### Priorita' ALTA
1. **Margine utilizzato** — Estrarre dato margine dai trade, visualizzare uso margine nel builder
2. **Costi per trade** — Spread + commissioni + swap → expectancy netta nel builder e overview
3. **Logo Velqor nel report** — "Velqor Intelligent Quant System" + logo come timbro

### Priorita' MEDIA
4. **Import dati WFM/MC da SQX** — Popolare qel_strategy_tests con risultati Walk Forward Matrix
5. **10K trade ambigui** — 48 trade senza magic, valutare assegnazione manuale per (symbol, direction, timeframe)

### Priorita' BASSA / Lungo termine
6. **AI Sizing Advisor** — Suggerimenti automatici basati su regime + fitness
7. **N8N automazioni** — Weekly optimization + sync monitor + alert Telegram
8. **Rolling correlations** — Quando dati sufficienti (target fine 2026)
9. **Builder multi-contesto** — Config per future / capitale proprio / limiti DD personalizzati

## File chiave
- `src/lib/quant-utils.ts` (~1600 righe) — tutte le utility quant
- `src/lib/tooltip-content.ts` — 23 metriche in italiano
- `src/components/ui/InfoTooltip.tsx` — componente tooltip con createPortal
- `src/app/(dashboard)/divisioni/quant/page.tsx` — overview con selettore conto + benchmark chart
- `src/app/(dashboard)/divisioni/quant/builder/page.tsx` — builder con stats per-conto
- `mt5-bridge/bridge.py` — bridge v2.2
- `mt5-bridge/scheduled-sync-*.bat` — sync giornaliero per VPS

## Note operative
- L'utente parla italiano, codice/commit in inglese
- Node: `/opt/homebrew/bin/node`, tsc: `./node_modules/.bin/tsc --noEmit`
- Deploy: git push → Vercel auto-deploy → control.velqor.it
- Supabase project: `gotbfzdgasuvfskzeycm` (MCP: execute_sql)
