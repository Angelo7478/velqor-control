-- ============================================
-- VELQOR QUANT ENGINE — Schema v1
-- Migration 003
-- 11 tables, 7 enums, RLS, indexes, triggers
-- ============================================

-- ENUMS
CREATE TYPE qel_account_status AS ENUM ('active','challenge','verification','funded','breached','payout','inactive');
CREATE TYPE qel_strategy_status AS ENUM ('active','paused','retired','testing','candidate');
CREATE TYPE qel_trade_direction AS ENUM ('buy','sell');
CREATE TYPE qel_sizing_mode AS ENUM ('static','risk_budget','preset','dynamic');
CREATE TYPE qel_access_level AS ENUM ('admin','trader','analyst','student','viewer');
CREATE TYPE qel_file_type AS ENUM ('sqx_test','sqx_wfm','sqx_monte_carlo','sqx_oos','pdf_report','csv_data','code_easylanguage','code_mql5','other');

-- 1. FTMO ACCOUNTS
CREATE TABLE qel_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  broker text DEFAULT 'FTMO',
  server text,
  login text,
  investor_password text,
  account_size numeric DEFAULT 100000,
  currency text DEFAULT 'USD',
  status qel_account_status DEFAULT 'active',
  max_daily_loss_pct numeric DEFAULT 5.0,
  max_total_loss_pct numeric DEFAULT 10.0,
  profit_target_pct numeric,
  balance numeric DEFAULT 0,
  equity numeric DEFAULT 0,
  floating_pl numeric DEFAULT 0,
  margin_used numeric DEFAULT 0,
  daily_dd_pct numeric DEFAULT 0,
  total_dd_pct numeric DEFAULT 0,
  last_sync_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. ACCOUNT SNAPSHOTS
CREATE TABLE qel_account_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES qel_accounts(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL DEFAULT now(),
  balance numeric NOT NULL,
  equity numeric NOT NULL,
  floating_pl numeric DEFAULT 0,
  margin_used numeric DEFAULT 0,
  daily_dd_pct numeric DEFAULT 0,
  total_dd_pct numeric DEFAULT 0,
  open_trades int DEFAULT 0
);

-- 3. STRATEGY REGISTRY
CREATE TABLE qel_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  strategy_id text NOT NULL,
  magic int NOT NULL,
  name text,
  asset text NOT NULL,
  asset_group text,
  timeframe text NOT NULL,
  description text,
  logic_summary text,
  logic_code text,
  parameters text,
  status qel_strategy_status DEFAULT 'active',
  test_period text,
  test_trades int,
  test_win_pct numeric,
  test_avg_win numeric,
  test_avg_loss numeric,
  test_payoff numeric,
  test_expectancy numeric,
  test_max_consec_loss int,
  test_worst_trade numeric,
  test_max_dd numeric,
  test_ret_dd numeric,
  test_ulcer_index numeric,
  test_mc95_dd numeric,
  test_stability numeric,
  test_exposure_pct numeric,
  test_overlap_med numeric,
  test_overlap_max numeric,
  lot_static numeric,
  lot_neutral numeric,
  lot_aggressive numeric,
  lot_conservative numeric,
  mc95_dd_scaled numeric,
  real_trades int DEFAULT 0,
  real_pl numeric DEFAULT 0,
  real_max_dd numeric DEFAULT 0,
  real_win_pct numeric,
  real_payoff numeric,
  real_expectancy numeric,
  real_profit_factor numeric,
  real_sharpe numeric,
  real_sortino numeric,
  real_calmar numeric,
  real_recovery_factor numeric,
  real_avg_duration_hours numeric,
  real_ret_dd numeric DEFAULT 0,
  include_in_portfolio boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(org_id, strategy_id)
);

-- 4. STRATEGY TEST RESULTS
CREATE TABLE qel_strategy_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid NOT NULL REFERENCES qel_strategies(id) ON DELETE CASCADE,
  test_type text NOT NULL,
  test_date date,
  period_start date,
  period_end date,
  trades int,
  win_pct numeric,
  payoff numeric,
  expectancy numeric,
  max_dd numeric,
  ret_dd numeric,
  mc95_dd numeric,
  stability numeric,
  profit_factor numeric,
  sharpe numeric,
  parameters jsonb,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- 5. STRATEGY FILES
CREATE TABLE qel_strategy_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid NOT NULL REFERENCES qel_strategies(id) ON DELETE CASCADE,
  file_type qel_file_type NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size_bytes bigint,
  description text,
  uploaded_by uuid,
  created_at timestamptz DEFAULT now()
);

-- 6. TRADES
CREATE TABLE qel_trades (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES qel_accounts(id) ON DELETE CASCADE,
  strategy_id uuid REFERENCES qel_strategies(id),
  ticket bigint NOT NULL,
  magic int,
  symbol text NOT NULL,
  direction qel_trade_direction NOT NULL,
  lots numeric NOT NULL,
  open_price numeric NOT NULL,
  close_price numeric,
  sl numeric,
  tp numeric,
  open_time timestamptz NOT NULL,
  close_time timestamptz,
  profit numeric,
  swap numeric DEFAULT 0,
  commission numeric DEFAULT 0,
  net_profit numeric,
  duration_seconds bigint,
  is_open boolean DEFAULT true,
  mae numeric,
  mfe numeric,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(account_id, ticket)
);

-- 7. PORTFOLIOS
CREATE TABLE qel_portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  account_id uuid REFERENCES qel_accounts(id),
  name text NOT NULL,
  sizing_mode qel_sizing_mode DEFAULT 'static',
  equity_base numeric DEFAULT 100000,
  max_dd_target_pct numeric DEFAULT 10.0,
  daily_dd_limit_pct numeric DEFAULT 5.0,
  operational_rd_pct numeric DEFAULT 1.5,
  safety_factor numeric DEFAULT 1.0,
  overlap_mode text DEFAULT 'Med',
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 8. PORTFOLIO-STRATEGY ALLOCATION
CREATE TABLE qel_portfolio_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES qel_portfolios(id) ON DELETE CASCADE,
  strategy_id uuid NOT NULL REFERENCES qel_strategies(id),
  is_active boolean DEFAULT true,
  lot_override numeric,
  lot_suggested numeric,
  sizing_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(portfolio_id, strategy_id)
);

-- 9. BENCHMARKS
CREATE TABLE qel_benchmarks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol text NOT NULL,
  ts date NOT NULL,
  open_price numeric,
  high numeric,
  low numeric,
  close_price numeric,
  volume bigint,
  created_at timestamptz DEFAULT now(),
  UNIQUE(symbol, ts)
);

-- 10. USER ACCESS CONTROL
CREATE TABLE qel_user_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id),
  access_level qel_access_level DEFAULT 'viewer',
  can_view_strategies boolean DEFAULT true,
  can_view_logic boolean DEFAULT false,
  can_view_accounts boolean DEFAULT false,
  can_view_trades boolean DEFAULT true,
  can_view_sizing boolean DEFAULT false,
  can_edit boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, org_id)
);

-- 11. BACKUP LOG
CREATE TABLE qel_backup_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  backup_type text NOT NULL,
  file_path text,
  file_size_bytes bigint,
  status text DEFAULT 'completed',
  tables_backed_up text[],
  rows_total bigint,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  notes text
);

-- INDEXES
CREATE INDEX idx_qel_accounts_org ON qel_accounts(org_id);
CREATE INDEX idx_qel_snapshots_account ON qel_account_snapshots(account_id, ts DESC);
CREATE INDEX idx_qel_strategies_org ON qel_strategies(org_id);
CREATE INDEX idx_qel_strategies_magic ON qel_strategies(magic);
CREATE INDEX idx_qel_trades_account ON qel_trades(account_id, close_time DESC);
CREATE INDEX idx_qel_trades_magic ON qel_trades(magic);
CREATE INDEX idx_qel_trades_strategy ON qel_trades(strategy_id);
CREATE INDEX idx_qel_trades_open ON qel_trades(is_open) WHERE is_open = true;
CREATE INDEX idx_qel_benchmarks_symbol ON qel_benchmarks(symbol, ts DESC);
CREATE INDEX idx_qel_files_strategy ON qel_strategy_files(strategy_id);
CREATE INDEX idx_qel_tests_strategy ON qel_strategy_tests(strategy_id);
CREATE INDEX idx_qel_ptf_strats ON qel_portfolio_strategies(portfolio_id);

-- TRIGGERS
CREATE TRIGGER set_updated_at_qel_accounts BEFORE UPDATE ON qel_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_qel_strategies BEFORE UPDATE ON qel_strategies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_qel_portfolios BEFORE UPDATE ON qel_portfolios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_qel_ptf_strats BEFORE UPDATE ON qel_portfolio_strategies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_qel_access BEFORE UPDATE ON qel_user_access
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE qel_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE qel_account_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE qel_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE qel_strategy_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE qel_strategy_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE qel_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE qel_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE qel_portfolio_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE qel_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE qel_user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE qel_backup_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY qel_accounts_policy ON qel_accounts FOR ALL USING (
  org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
);
CREATE POLICY qel_snapshots_policy ON qel_account_snapshots FOR ALL USING (
  account_id IN (SELECT id FROM qel_accounts WHERE org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid()))
);
CREATE POLICY qel_strategies_policy ON qel_strategies FOR ALL USING (
  org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
);
CREATE POLICY qel_tests_policy ON qel_strategy_tests FOR ALL USING (
  strategy_id IN (SELECT id FROM qel_strategies WHERE org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid()))
);
CREATE POLICY qel_files_policy ON qel_strategy_files FOR ALL USING (
  strategy_id IN (SELECT id FROM qel_strategies WHERE org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid()))
);
CREATE POLICY qel_trades_policy ON qel_trades FOR ALL USING (
  account_id IN (SELECT id FROM qel_accounts WHERE org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid()))
);
CREATE POLICY qel_portfolios_policy ON qel_portfolios FOR ALL USING (
  org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())
);
CREATE POLICY qel_ptf_strats_policy ON qel_portfolio_strategies FOR ALL USING (
  portfolio_id IN (SELECT id FROM qel_portfolios WHERE org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid()))
);
CREATE POLICY qel_benchmarks_policy ON qel_benchmarks FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY qel_benchmarks_insert ON qel_benchmarks FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY qel_access_policy ON qel_user_access FOR ALL USING (
  user_id = auth.uid() OR org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid() AND role IN ('owner','admin'))
);
CREATE POLICY qel_backup_policy ON qel_backup_log FOR ALL USING (
  EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid() AND role IN ('owner','admin'))
);
