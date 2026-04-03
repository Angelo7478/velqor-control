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
