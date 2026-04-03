-- =====================================================
-- SEED: Organizzazione Velqor + User Angelo + Membership
-- =====================================================
-- NOTA: Sostituire AUTH_USER_ID con l'UUID reale di Angelo in auth.users

-- 1. Organizzazione Velqor
INSERT INTO organizations (id, name, slug, type, legal_data, is_active)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Velqor SRLS',
  'velqor',
  'internal',
  '{"piva": "", "sede": "Nord Italia", "pec": ""}',
  true
);

-- 2. User Angelo (AGGIORNARE con il vero auth.users.id)
-- Eseguire prima: SELECT id, email FROM auth.users WHERE email = 'pasian74@gmail.com';
-- Poi sostituire il placeholder sotto:

-- INSERT INTO users (id, full_name, timezone)
-- VALUES ('INSERIRE_AUTH_USER_ID_QUI', 'Angelo Pasian', 'Europe/Rome');

-- 3. Membership Angelo = owner
-- INSERT INTO memberships (user_id, organization_id, role, is_active)
-- VALUES ('INSERIRE_AUTH_USER_ID_QUI', 'a0000000-0000-0000-0000-000000000001', 'owner', true);
