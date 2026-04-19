-- 004_security_invoker_views.sql
-- Fix Supabase linter 0010 (security_definer_view, ERROR).
-- Switch 3 Quant views from SECURITY DEFINER (Postgres default) to SECURITY INVOKER
-- so RLS policies on the underlying tables are enforced per querying user,
-- instead of per view creator.
--
-- Underlying RLS (verified 2026-04-18) filters by membership -> auth.uid() on:
--   qel_trades, qel_strategies, qel_account_snapshots, qel_accounts.
-- Angelo's current counts remain visible (org-scoped):
--   v_strategy_recent_performance = 51 rows
--   v_strategy_equity_curve       = 859 rows
--   v_strategy_daily_pnl          = 389 rows
--
-- Applied via Supabase MCP as migration `security_invoker_views_v_strategy`.

ALTER VIEW public.v_strategy_recent_performance SET (security_invoker = true);
ALTER VIEW public.v_strategy_equity_curve SET (security_invoker = true);
ALTER VIEW public.v_strategy_daily_pnl SET (security_invoker = true);

-- ROLLBACK (in case of regression):
-- ALTER VIEW public.v_strategy_recent_performance SET (security_invoker = false);
-- ALTER VIEW public.v_strategy_equity_curve SET (security_invoker = false);
-- ALTER VIEW public.v_strategy_daily_pnl SET (security_invoker = false);
