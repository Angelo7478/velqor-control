-- 005_market_type.sql — applicata via MCP il 16 luglio 2026 (questo file e' documentazione).
--
-- Discriminante macro CFD | FUTURE per la Control Room: prima dell'apertura del filone
-- futures (Darwinex Zero Futures su MT5) serve poter separare i due mondi.
--
-- Perche' su ENTRAMBE le tabelle e non solo sui conti: piu' pagine interrogano
-- qel_strategies senza passare dai conti (schede, health, monthly, overview); con il
-- discriminante solo su qel_accounts servirebbe un join via qel_portfolios, fragile.
-- E una strategia ha un asset singolo (US100.cash vs NQ): la riga E' mono-mercato.
--
-- Perche' additivo e sicuro: ADD COLUMN con DEFAULT non volatile e' O(1) su PG11+
-- (nessun rewrite di tabella, nessun lock lungo). NOT NULL DEFAULT 'cfd' => tutte le
-- righe esistenti diventano 'cfd' da sole: nessun backfill, nessuna riga scoperta.
-- Verificato dopo l'apply: 18 conti + 30 strategie a 'cfd', zero null.
--
-- Perche' text + CHECK e non enum: ALTER TYPE ... ADD VALUE non convive bene con le
-- transazioni, e un domani potrebbero servire altri valori (crypto, equity...).
--
-- ATTENZIONE — market_type NON e' catalog:
--   catalog     = il BROKER   ('ftmo' | 'darwinex')
--   market_type = il MERCATO  ('cfd'  | 'futures')
-- Darwinex ha SIA conti CFD SIA conti futures, quindi i due assi sono ortogonali.
--
-- Vincolo operativo collegato: le strategie futures devono avere magic in un range
-- distinto (le Darwinex-CFD occupano 100-106). idx_qel_strategies_magic NON e' unique
-- e tutta la cascata client-side della Control Room e' magic-keyed.

ALTER TABLE public.qel_accounts
  ADD COLUMN IF NOT EXISTS market_type text NOT NULL DEFAULT 'cfd'
    CONSTRAINT qel_accounts_market_type_chk CHECK (market_type IN ('cfd','futures'));

ALTER TABLE public.qel_strategies
  ADD COLUMN IF NOT EXISTS market_type text NOT NULL DEFAULT 'cfd'
    CONSTRAINT qel_strategies_market_type_chk CHECK (market_type IN ('cfd','futures'));

CREATE INDEX IF NOT EXISTS idx_qel_accounts_market_type   ON public.qel_accounts(market_type);
CREATE INDEX IF NOT EXISTS idx_qel_strategies_market_type ON public.qel_strategies(market_type);

COMMENT ON COLUMN public.qel_accounts.market_type IS
  'Macro mercato: cfd (FTMO, Darwinex-CFD) | futures (CME via Darwinex). Default cfd = tutto lo storico.';
COMMENT ON COLUMN public.qel_strategies.market_type IS
  'Macro mercato della strategia, derivato dall''asset (US100.cash -> cfd, NQ -> futures). Diverso da catalog, che e'' il broker.';

-- ROLLBACK:
--   ALTER TABLE public.qel_accounts   DROP COLUMN market_type;
--   ALTER TABLE public.qel_strategies DROP COLUMN market_type;
