export type OrgType = 'internal' | 'client' | 'partner' | 'fund' | 'white_label'
export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer' | 'client' | 'api'
export type ModuleType = 'real_estate' | 'quant' | 'engineering' | 'ai' | 'ops' | 'ecommerce'
export type ProjectStatus = 'draft' | 'active' | 'on_hold' | 'completed' | 'archived'
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled'
export type PriorityLevel = 'low' | 'medium' | 'high' | 'critical'
export type EventType = 'meeting' | 'inspection' | 'deadline' | 'call' | 'task' | 'auction'
export type NoteSource = 'human' | 'ai' | 'system' | 'n8n'
export type MemoType = 'estimate' | 'evaluate' | 'execute' | 'reminder' | 'deadline'
export type MemoStatus = 'pending' | 'in_progress' | 'snoozed' | 'done' | 'dismissed'

// Quant Engine types
export type QelAccountStatus = 'active' | 'challenge' | 'verification' | 'funded' | 'breached' | 'payout' | 'inactive'
export type QelStrategyStatus = 'active' | 'paused' | 'retired' | 'testing' | 'candidate'
export type QelTradeDirection = 'buy' | 'sell'
export type QelSizingMode = 'static' | 'risk_budget' | 'preset' | 'dynamic'
export type QelAccessLevel = 'admin' | 'trader' | 'analyst' | 'student' | 'viewer'
export type QelFileType = 'sqx_test' | 'sqx_wfm' | 'sqx_monte_carlo' | 'sqx_oos' | 'pdf_report' | 'csv_data' | 'code_easylanguage' | 'code_mql5' | 'other'

export interface Organization {
  id: string
  name: string
  slug: string
  type: OrgType
  parent_org_id: string | null
  legal_data: Record<string, unknown> | null
  settings: Record<string, unknown> | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  full_name: string | null
  avatar_url: string | null
  timezone: string
  preferences: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface Membership {
  id: string
  user_id: string
  organization_id: string
  role: MemberRole
  permissions: Record<string, unknown> | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  organization_id: string
  name: string
  module: ModuleType
  status: ProjectStatus
  parent_project_id: string | null
  owner_user_id: string | null
  client_contact_id: string | null
  start_date: string | null
  end_date: string | null
  budget: number | null
  visibility_scope: string
  tags: string[] | null
  meta: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  organization_id: string
  project_id: string | null
  title: string
  description: string | null
  status: TaskStatus
  priority: PriorityLevel
  assigned_to: string | null
  due_date: string | null
  entity_type: string | null
  entity_id: string | null
  created_at: string
  updated_at: string
}

export interface Event {
  id: string
  organization_id: string
  title: string
  event_type: EventType
  starts_at: string
  ends_at: string | null
  location: string | null
  entity_type: string | null
  entity_id: string | null
  attendees: Record<string, unknown>[] | null
  created_at: string
  updated_at: string
}

export interface Note {
  id: string
  organization_id: string
  author_id: string | null
  content: string
  entity_type: string | null
  entity_id: string | null
  is_pinned: boolean
  source: NoteSource
  created_at: string
  updated_at: string
}

export interface Memorandum {
  id: string
  organization_id: string
  title: string
  memo_type: MemoType
  status: MemoStatus
  priority: PriorityLevel
  description: string | null
  project_id: string | null
  task_id: string | null
  event_id: string | null
  entity_type: string | null
  entity_id: string | null
  due_date: string | null
  remind_at: string | null
  snoozed_until: string | null
  assigned_to: string | null
  created_by: string | null
  resolved_at: string | null
  resolution_note: string | null
  created_at: string
  updated_at: string
}

// ============================================
// QUANT ENGINE
// ============================================

export interface QelAccount {
  id: string
  org_id: string
  name: string
  broker: string
  server: string | null
  login: string | null
  investor_password: string | null
  account_size: number
  currency: string
  status: QelAccountStatus
  max_daily_loss_pct: number
  max_total_loss_pct: number
  profit_target_pct: number | null
  balance: number
  equity: number
  floating_pl: number
  margin_used: number
  daily_dd_pct: number
  total_dd_pct: number
  last_sync_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface QelAccountSnapshot {
  id: number
  account_id: string
  ts: string
  balance: number
  equity: number
  floating_pl: number
  margin_used: number
  daily_dd_pct: number
  total_dd_pct: number
  open_trades: number
}

export interface QelStrategy {
  id: string
  org_id: string
  strategy_id: string
  magic: number
  name: string | null
  asset: string
  asset_group: string | null
  timeframe: string
  description: string | null
  logic_summary: string | null
  logic_code: string | null
  parameters: string | null
  status: QelStrategyStatus
  test_period: string | null
  test_trades: number | null
  test_win_pct: number | null
  test_avg_win: number | null
  test_avg_loss: number | null
  test_payoff: number | null
  test_expectancy: number | null
  test_max_consec_loss: number | null
  test_worst_trade: number | null
  test_max_dd: number | null
  test_ret_dd: number | null
  test_ulcer_index: number | null
  test_mc95_dd: number | null
  test_stability: number | null
  test_exposure_pct: number | null
  test_overlap_med: number | null
  test_overlap_max: number | null
  lot_static: number | null
  lot_neutral: number | null
  lot_aggressive: number | null
  lot_conservative: number | null
  mc95_dd_scaled: number | null
  real_trades: number
  real_pl: number
  real_max_dd: number
  real_win_pct: number | null
  real_payoff: number | null
  real_expectancy: number | null
  real_profit_factor: number | null
  real_sharpe: number | null
  real_sortino: number | null
  real_calmar: number | null
  real_recovery_factor: number | null
  real_avg_duration_hours: number | null
  real_ret_dd: number
  include_in_portfolio: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface QelTrade {
  id: number
  account_id: string
  strategy_id: string | null
  ticket: number
  magic: number | null
  symbol: string
  direction: QelTradeDirection
  lots: number
  open_price: number
  close_price: number | null
  sl: number | null
  tp: number | null
  open_time: string
  close_time: string | null
  profit: number | null
  swap: number
  commission: number
  net_profit: number | null
  duration_seconds: number | null
  is_open: boolean
  mae: number | null
  mfe: number | null
  notes: string | null
  created_at: string
}

export interface QelPortfolio {
  id: string
  org_id: string
  account_id: string | null
  name: string
  sizing_mode: QelSizingMode
  equity_base: number
  max_dd_target_pct: number
  daily_dd_limit_pct: number
  operational_rd_pct: number
  safety_factor: number
  overlap_mode: string
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface QelStrategyFile {
  id: string
  strategy_id: string
  file_type: QelFileType
  file_name: string
  file_path: string
  file_size_bytes: number | null
  description: string | null
  uploaded_by: string | null
  created_at: string
}

export interface QelUserAccess {
  id: string
  user_id: string
  org_id: string
  access_level: QelAccessLevel
  can_view_strategies: boolean
  can_view_logic: boolean
  can_view_accounts: boolean
  can_view_trades: boolean
  can_view_sizing: boolean
  can_edit: boolean
  notes: string | null
  created_at: string
  updated_at: string
}
