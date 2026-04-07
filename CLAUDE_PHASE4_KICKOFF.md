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

## Stato Phase 4 (completata 2026-04-07)

### Priorita' ALTA — COMPLETATE
1. **Margine utilizzato** ✅ — Card KPI (5 metriche + barra progresso), colonna tabella, sezione report. FTMO_MARGIN_SPECS per 7 simboli. Tassi leva da validare vs margine reale bridge.
2. **Costi per trade** ✅ — Gia' coperti: net_profit usato ovunque, dashboard ha Analisi Costi completa per simbolo/strategia.
3. **Logo Velqor nel report** ✅ — Logo gufo base64 200px in header + mini-logo footer. Rebrand "Velqor Intelligent Quant System".

### Priorita' MEDIA — COMPLETATE
4. **Import dati WFM/MC da SQX** ✅ — Seed 17 righe qel_strategy_tests. Nuova sezione "Test SQX" nella pagina import con toggle Trade/Test, parser CSV 17 header, preview, insert audit + update strategies.
5. **10K trade ambigui** — SKIP (35 trade senza magic, distribuzione: 29 US500 buy, 5 USDCAD buy, 1 USDJPY buy. Non vale l'effort di assegnazione).

### Priorita' BASSA — PARZIALE
6. **AI Sizing Advisor** ✅ — Engine a regole (generateSizingAdvice) con 8 livelli: monitor/decrease/hold/increase basati su fitness+pendulum+health+regime. Card nel builder con semaforo, raccomandazioni per strategia, "Applica suggerimenti".
7. **N8N automazioni** — BACKLOG (richiede infrastruttura esterna)
8. **Rolling correlations** — BACKLOG (target fine 2026, dati insufficienti)
9. **Builder multi-contesto** — BACKLOG (per transizione CFD → future)

## File chiave
- `src/lib/quant-utils.ts` (~1800 righe) — tutte le utility quant (margine, advisor, sizing, MC, health)
- `src/lib/velqor-logo.ts` — logo gufo base64 per report
- `src/lib/tooltip-content.ts` — 26 metriche in italiano
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
