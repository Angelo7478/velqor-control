-- 007_market_type_cascade.sql
-- APPLICATA il 16 luglio 2026 (migration Supabase `market_type_on_portfolios_and_variants`).
--
-- Prima di questa migration la compartimentazione CFD|FUTURE di queste due tabelle era una
-- proprieta' EMERGENTE, non una regola: i portfolio si scopavano perche' `selectedAccountId`
-- veniva sempre da `accounts` (filtrato), le varianti perche' `base_magic` puntava a una
-- strategia che ha `market_type`. Due coincidenze che reggevano. Il 16 luglio sono cadute
-- entrambe (PR #38: Stato Sizing e Stato Magic renderizzavano da qui e non cascatavano da nulla).
--
-- Con la colonna, ogni tabella si filtra identica: `.eq('market_type', marketType)`, un gesto
-- meccanico verificabile con un grep invece di un ragionamento a cascata.
--
-- NOTA IMPORTANTE, dall'audit del 16 luglio: questa migration NON basta da sola. Il difetto
-- principale non era la query ma il ciclo di vita dello STATO React (guardie che saltavano
-- l'update a macro vuota, interval con deps [] che catturavano marketType al mount, stato di
-- navigazione non azzerato). Quello e' chiuso nella PR #40. Le due cose sono complementari.
--
-- Backfill verificato dopo l'applicazione: 12 portfolios e 13 varianti, tutti 'cfd',
-- zero righe incoerenti col conto/strategia di appartenenza, zero orfani.

ALTER TABLE public.qel_portfolios ADD COLUMN IF NOT EXISTS market_type text;

UPDATE public.qel_portfolios p
  SET market_type = a.market_type
  FROM public.qel_accounts a
  WHERE a.id = p.account_id AND p.market_type IS NULL;

UPDATE public.qel_portfolios SET market_type = 'cfd' WHERE market_type IS NULL;

ALTER TABLE public.qel_portfolios
  ALTER COLUMN market_type SET DEFAULT 'cfd',
  ALTER COLUMN market_type SET NOT NULL;

ALTER TABLE public.qel_portfolios DROP CONSTRAINT IF EXISTS qel_portfolios_market_type_chk;
ALTER TABLE public.qel_portfolios
  ADD CONSTRAINT qel_portfolios_market_type_chk CHECK (market_type IN ('cfd','futures'));

ALTER TABLE public.qel_strategy_variants ADD COLUMN IF NOT EXISTS market_type text;

UPDATE public.qel_strategy_variants v
  SET market_type = s.market_type
  FROM public.qel_strategies s
  WHERE s.id = v.strategy_id AND v.market_type IS NULL;

UPDATE public.qel_strategy_variants SET market_type = 'cfd' WHERE market_type IS NULL;

ALTER TABLE public.qel_strategy_variants
  ALTER COLUMN market_type SET DEFAULT 'cfd',
  ALTER COLUMN market_type SET NOT NULL;

ALTER TABLE public.qel_strategy_variants DROP CONSTRAINT IF EXISTS qel_strategy_variants_market_type_chk;
ALTER TABLE public.qel_strategy_variants
  ADD CONSTRAINT qel_strategy_variants_market_type_chk CHECK (market_type IN ('cfd','futures'));

-- ROLLBACK:
-- ALTER TABLE public.qel_portfolios DROP CONSTRAINT IF EXISTS qel_portfolios_market_type_chk;
-- ALTER TABLE public.qel_portfolios DROP COLUMN IF EXISTS market_type;
-- ALTER TABLE public.qel_strategy_variants DROP CONSTRAINT IF EXISTS qel_strategy_variants_market_type_chk;
-- ALTER TABLE public.qel_strategy_variants DROP COLUMN IF EXISTS market_type;
