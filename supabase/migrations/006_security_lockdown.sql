-- 006_security_lockdown.sql
-- PROPOSTA — da rivedere e applicare a mano. Non applicata da un agente.
--
-- Chiude l'esposizione ad `anon` emersa dall'audit del 16 luglio 2026.
-- La anon key e' PUBBLICA per costruzione (sta nel bundle JS servito a ogni browser):
-- "app monoutente" NON e' una protezione. Chiunque abbia l'URL del progetto puo' fare
-- una GET su PostgREST. La difesa e' la RLS, e in questi punti non c'e' o e' scavalcata.
--
-- Continuazione diretta della 004, che il 18 aprile 2026 fece lo STESSO fix su altre 3 viste.
-- Le viste qui sotto sono nate il 29 giugno 2026 e la lezione non e' stata riapplicata.
--
-- Verificato sul DB live (sola lettura, 16 luglio 2026):
--   - v_signal_trades / v_strategy_live / v_account_strategy_live_lot NON hanno security_invoker
--     -> girano coi privilegi del creatore (postgres) e SCAVALCANO la RLS.
--   - Le tabelle sotto sono invece protette bene (org-scoped via memberships):
--     qel_trades, qel_strategies, qel_accounts, qel_portfolios, qel_portfolio_strategies.
--     => il buco sono le VISTE, non le tabelle.
--
-- ATTENZIONE alla trappola documentata: le policy sorelle in 003_quant_schema.sql scrivono
-- `SELECT org_id FROM memberships`. Quella colonna NON esiste: si chiama `organization_id`.
-- Le policy vive sul DB usano gia' `organization_id`. Copiare la 003 produce DDL che fallisce.

-- ---------------------------------------------------------------------------
-- 1) Le tre viste SECURITY DEFINER -> SECURITY INVOKER
-- ---------------------------------------------------------------------------
-- Espongono oggi ad anon: pl_per_lot per segnale, win_pct/profit_factor per magic,
-- account_id e lotto live in esecuzione. Cioe' l'edge misurato.

ALTER VIEW public.v_signal_trades SET (security_invoker = true);
ALTER VIEW public.v_strategy_live SET (security_invoker = true);
ALTER VIEW public.v_account_strategy_live_lot SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 2) Le policy con predicato costante `true`
-- ---------------------------------------------------------------------------
-- NOTA: il difetto NON e' il ruolo `public` — tutte le policy di questo DB sono TO public,
-- comprese quelle sane, perche' e' il default Supabase quando ometti TO. Il difetto e' il
-- predicato `true`. Riscrivere `TO authenticated` sarebbe un FALSO FIX.
--
-- Ironia da non perdere: le 5 policy qui sotto si chiamano "Allow all for authenticated"
-- ma sono TO public. Il NOME dichiara una restrizione che il predicato non fa.

-- 2a) qel_strategy_backtest_monthly (899 righe, org_id proprio) — oggi SELECT USING(true)
DROP POLICY IF EXISTS qel_btm_select ON public.qel_strategy_backtest_monthly;
CREATE POLICY qel_btm_select ON public.qel_strategy_backtest_monthly
  FOR SELECT
  USING (org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid()));

-- 2b) qel_strategy_variants (13 righe) — scope via strategy_id -> qel_strategies.org_id
DROP POLICY IF EXISTS qel_strategy_variants_all ON public.qel_strategy_variants;
CREATE POLICY qel_strategy_variants_all ON public.qel_strategy_variants
  FOR ALL
  USING (strategy_id IN (
    SELECT id FROM qel_strategies
    WHERE org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid())))
  WITH CHECK (strategy_id IN (
    SELECT id FROM qel_strategies
    WHERE org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid())));

-- 2c) qel_strategy_sizing (40 righe) — scope via portfolio_id -> qel_portfolios.org_id
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.qel_strategy_sizing;
CREATE POLICY qel_strategy_sizing_scoped ON public.qel_strategy_sizing
  FOR ALL
  USING (portfolio_id IN (
    SELECT id FROM qel_portfolios
    WHERE org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid())))
  WITH CHECK (portfolio_id IN (
    SELECT id FROM qel_portfolios
    WHERE org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid())));

-- 2d) qel_strategy_health (0 righe) — scope via portfolio_id
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.qel_strategy_health;
CREATE POLICY qel_strategy_health_scoped ON public.qel_strategy_health
  FOR ALL
  USING (portfolio_id IN (
    SELECT id FROM qel_portfolios
    WHERE org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid())))
  WITH CHECK (portfolio_id IN (
    SELECT id FROM qel_portfolios
    WHERE org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid())));

-- 2e) qel_strategy_correlations (0 righe) — NON ha strategy_id: solo portfolio_id (verificato)
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.qel_strategy_correlations;
CREATE POLICY qel_strategy_correlations_scoped ON public.qel_strategy_correlations
  FOR ALL
  USING (portfolio_id IN (
    SELECT id FROM qel_portfolios
    WHERE org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid())))
  WITH CHECK (portfolio_id IN (
    SELECT id FROM qel_portfolios
    WHERE org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid())));

-- 2f) qel_sizing_engine_runs (17 righe) — NON ha strategy_id: portfolio_id + account_id (verificato)
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.qel_sizing_engine_runs;
CREATE POLICY qel_sizing_engine_runs_scoped ON public.qel_sizing_engine_runs
  FOR ALL
  USING (portfolio_id IN (
    SELECT id FROM qel_portfolios
    WHERE org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid())))
  WITH CHECK (portfolio_id IN (
    SELECT id FROM qel_portfolios
    WHERE org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid())));

-- ---------------------------------------------------------------------------
-- 3) La RPC qel_refresh_regime eseguibile da anon
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, owner postgres, anon=X. Un POST anonimo esegue un UPDATE su tutti i
-- portfolio attivi scavalcando la RLS.
-- DIMENSIONAMENTO ONESTO: la funzione ha zero parametri e ricalcola il regime in modo
-- deterministico da qel_benchmarks (chiusa ad anon). Un estraneo NON decide il tuo regime:
-- riscrive lo stesso valore. Resta un bypass RLS non autenticato + write-amplification.
-- SICURO: l'unico chiamante e' refresh-benchmarks/index.ts:68, che gira con service-role key.
-- Il browser invoca la EDGE FUNCTION, non la RPC. Il pulsante "Aggiorna regime" continua a funzionare.

REVOKE EXECUTE ON FUNCTION public.qel_refresh_regime() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qel_refresh_regime() TO service_role;

-- ---------------------------------------------------------------------------
-- NON INCLUSO QUI, DI PROPOSITO: la famiglia `fatture` / `cont_`
-- ---------------------------------------------------------------------------
-- fatture, fatture_clienti, fatture_backup, fatture_catalogo, fatture_impostazioni,
-- cont_categorie, cont_fatture_ricevute, cont_movimenti_banca, cont_liquidazioni_iva
-- hanno policy `public_all` FOR ALL USING(true) WITH CHECK(true) + grant DELETE ad anon.
-- Sono leggibili E CANCELLABILI da chiunque. MA non appartengono a Quant: le usa un'altra
-- app Velqor, che potrebbe girare in anonimo. Chiuderle qui alla cieca la romperebbe.
-- Vanno chiuse, ma DOPO aver verificato come autentica quell'app. Deciso con Angelo.

-- ---------------------------------------------------------------------------
-- VERIFICA DOPO L'APPLICAZIONE — il criterio e' DUPLICE, non basta il primo
-- ---------------------------------------------------------------------------
-- (a) anon deve tornare VUOTO:
--     curl "https://gotbfzdgasuvfskzeycm.supabase.co/rest/v1/v_signal_trades?select=*&limit=1" \
--          -H "apikey: <ANON_KEY>"            -> attesa: []
-- (b) l'utente LOGGATO deve vedere ANCORA gli stessi numeri di prima:
--     v_signal_trades 585 · v_strategy_live 26 · v_account_strategy_live_lot 112
--     qel_strategy_backtest_monthly 899 · qel_strategy_sizing 40 · qel_strategy_variants 13
-- Il controllo (b) e' quello che dimostra che non hai rotto la macro CFD live.

-- ROLLBACK:
-- ALTER VIEW public.v_signal_trades SET (security_invoker = false);
-- ALTER VIEW public.v_strategy_live SET (security_invoker = false);
-- ALTER VIEW public.v_account_strategy_live_lot SET (security_invoker = false);
-- GRANT EXECUTE ON FUNCTION public.qel_refresh_regime() TO anon, authenticated;
-- (per le policy: DROP delle *_scoped e ricreazione con USING(true), vedi git history)
