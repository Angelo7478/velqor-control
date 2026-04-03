-- =====================================================
-- VELQOR CONTROL ROOM — Core Schema Migration
-- Backbone V1 — Tabelle Core + Memoranda
-- =====================================================

-- =====================================================
-- 1. ENUMS
-- =====================================================

CREATE TYPE org_type AS ENUM ('internal', 'client', 'partner', 'fund', 'white_label');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member', 'viewer', 'client', 'api');
CREATE TYPE module_type AS ENUM ('real_estate', 'quant', 'engineering', 'ai', 'ops', 'ecommerce');
CREATE TYPE project_status AS ENUM ('draft', 'active', 'on_hold', 'completed', 'archived');
CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'blocked', 'done', 'cancelled');
CREATE TYPE priority_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE event_type AS ENUM ('meeting', 'inspection', 'deadline', 'call', 'task', 'auction');
CREATE TYPE note_source AS ENUM ('human', 'ai', 'system', 'n8n');
CREATE TYPE ai_source_type AS ENUM ('certain', 'auto_extracted', 'ai_inference', 'to_validate');
CREATE TYPE memo_type AS ENUM ('estimate', 'evaluate', 'execute', 'reminder', 'deadline');
CREATE TYPE memo_status AS ENUM ('pending', 'in_progress', 'snoozed', 'done', 'dismissed');

-- =====================================================
-- 2. TRIGGER FUNCTION — auto updated_at
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 3. CORE TABLES
-- =====================================================

-- 3.1 organizations
CREATE TABLE organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text UNIQUE NOT NULL,
  type            org_type NOT NULL,
  parent_org_id   uuid REFERENCES organizations(id),
  legal_data      jsonb,
  settings        jsonb,
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.2 users
CREATE TABLE users (
  id          uuid PRIMARY KEY REFERENCES auth.users(id),
  full_name   text,
  avatar_url  text,
  timezone    text DEFAULT 'Europe/Rome',
  preferences jsonb,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.3 memberships
CREATE TABLE memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  role            member_role NOT NULL,
  permissions     jsonb,
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.4 projects
CREATE TABLE projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  name              text NOT NULL,
  module            module_type NOT NULL,
  status            project_status NOT NULL DEFAULT 'draft',
  parent_project_id uuid REFERENCES projects(id),
  owner_user_id     uuid REFERENCES users(id),
  client_contact_id uuid,
  start_date        date,
  end_date          date,
  budget            numeric,
  visibility_scope  text DEFAULT 'org',
  tags              jsonb,
  meta              jsonb,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.5 tasks
CREATE TABLE tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id      uuid REFERENCES projects(id),
  title           text NOT NULL,
  description     text,
  status          task_status NOT NULL DEFAULT 'todo',
  priority        priority_level DEFAULT 'medium',
  assigned_to     uuid REFERENCES users(id),
  due_date        timestamptz,
  entity_type     text,
  entity_id       uuid,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.6 events
CREATE TABLE events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  title           text NOT NULL,
  event_type      event_type NOT NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz,
  location        text,
  entity_type     text,
  entity_id       uuid,
  attendees       jsonb,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.7 notes
CREATE TABLE notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  author_id       uuid REFERENCES users(id),
  content         text NOT NULL,
  entity_type     text,
  entity_id       uuid,
  is_pinned       boolean DEFAULT false,
  source          note_source DEFAULT 'human',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.8 memoranda (NEW — sistema stima/valuta/esegui)
CREATE TABLE memoranda (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  title           text NOT NULL,
  memo_type       memo_type NOT NULL,
  status          memo_status NOT NULL DEFAULT 'pending',
  priority        priority_level DEFAULT 'medium',
  description     text,
  project_id      uuid REFERENCES projects(id),
  task_id         uuid REFERENCES tasks(id),
  event_id        uuid REFERENCES events(id),
  entity_type     text,
  entity_id       uuid,
  due_date        date,
  remind_at       timestamptz,
  snoozed_until   timestamptz,
  assigned_to     uuid REFERENCES users(id),
  created_by      uuid REFERENCES users(id),
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON memoranda
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3.9 audit_logs (IMMUTABILE — solo INSERT)
CREATE TABLE audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_id        uuid REFERENCES users(id),
  action          text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       uuid,
  changes         jsonb,
  ip_address      text,
  user_agent      text,
  created_at      timestamptz DEFAULT now()
);

-- =====================================================
-- 4. ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE memoranda ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "users_read_own" ON users FOR SELECT USING (id = auth.uid());
CREATE POLICY "users_update_own" ON users FOR UPDATE USING (id = auth.uid());

-- Memberships: users see their own
CREATE POLICY "memberships_read_own" ON memberships FOR SELECT USING (user_id = auth.uid());

-- Organizations: visible to members
CREATE POLICY "org_select" ON organizations FOR SELECT USING (
  id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);

-- Org-scoped tables: SELECT, INSERT, UPDATE
-- projects
CREATE POLICY "projects_select" ON projects FOR SELECT USING (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);
CREATE POLICY "projects_insert" ON projects FOR INSERT WITH CHECK (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);
CREATE POLICY "projects_update" ON projects FOR UPDATE USING (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);

-- tasks
CREATE POLICY "tasks_select" ON tasks FOR SELECT USING (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);
CREATE POLICY "tasks_insert" ON tasks FOR INSERT WITH CHECK (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);
CREATE POLICY "tasks_update" ON tasks FOR UPDATE USING (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);

-- events
CREATE POLICY "events_select" ON events FOR SELECT USING (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);
CREATE POLICY "events_insert" ON events FOR INSERT WITH CHECK (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);
CREATE POLICY "events_update" ON events FOR UPDATE USING (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);

-- notes
CREATE POLICY "notes_select" ON notes FOR SELECT USING (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);
CREATE POLICY "notes_insert" ON notes FOR INSERT WITH CHECK (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);

-- memoranda
CREATE POLICY "memoranda_select" ON memoranda FOR SELECT USING (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);
CREATE POLICY "memoranda_insert" ON memoranda FOR INSERT WITH CHECK (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);
CREATE POLICY "memoranda_update" ON memoranda FOR UPDATE USING (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);

-- audit_logs: insert only (anyone authenticated), no update/delete
CREATE POLICY "audit_insert" ON audit_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "audit_select" ON audit_logs FOR SELECT USING (
  organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = true)
);

-- =====================================================
-- 5. INDEXES
-- =====================================================

CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_org ON memberships(organization_id);
CREATE INDEX idx_projects_org ON projects(organization_id);
CREATE INDEX idx_projects_module ON projects(module);
CREATE INDEX idx_projects_parent ON projects(parent_project_id);
CREATE INDEX idx_tasks_org ON tasks(organization_id);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_events_org ON events(organization_id);
CREATE INDEX idx_events_starts ON events(starts_at);
CREATE INDEX idx_notes_entity ON notes(entity_type, entity_id);
CREATE INDEX idx_memoranda_org ON memoranda(organization_id);
CREATE INDEX idx_memoranda_type ON memoranda(memo_type);
CREATE INDEX idx_memoranda_status ON memoranda(status);
CREATE INDEX idx_memoranda_due ON memoranda(due_date);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
