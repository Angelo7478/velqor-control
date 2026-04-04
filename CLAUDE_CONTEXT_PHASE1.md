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
    divisioni/ai/             ← Overview AI (placeholder)
    memorandum/               ← Sistema stima/valuta/esegui
    progetti/                 ← Progetti + task
    calendario/               ← Calendario eventi
  types/database.ts           ← TypeScript interfaces per tutte le tabelle
  lib/supabase-browser.ts     ← Client Supabase
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

## Cosa resta da fare
- [ ] ~108 trade senza magic (SP500/USDCAD/USDJPY ambigui) → bridge enrich da VPS
- [ ] Analisi dati avanzata (correlazioni, drawdown underwater, distribuzione P/L, ecc.)
- [ ] Aggiornare bridge sulla VPS (nuova versione con DD storico)
- [ ] Import secondo CSV 360 trade per 100K (hung prima del fix, utente deve riprovare)

## File di riferimento
- `/Users/angelopasian/Downloads/QEL_MASTER.xlsx` — Registry strategie con metriche test
- `mt5-bridge/GUIDA_VPS.md` — Guida completa setup/aggiornamento VPS

## Note importanti
- Il bridge legge con investor password (read-only, no trade)
- FTMO limiti: 5% daily DD, 10% total DD
- Le strategie sono tutte automatiche (QuantEdgeLab / SQX)
- I dati real nelle qel_strategies (real_trades, real_pl, real_ret_dd) vanno ricalcolati periodicamente
- L'utente parla italiano, il codice/commit sono in inglese
