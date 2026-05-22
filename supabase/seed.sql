-- supabase/seed.sql
-- V1 seed data: 3 demo users + 6 demo topics. Idempotent (ON CONFLICT clauses).
-- Runs automatically on `supabase db reset` (local).
--
-- These are placeholder rows so the app boots into a usable demo state. Replace
-- with your real users and real topics as you build out your pilot domain.
--
-- IMPORTANT — Cloud application:
-- Do NOT run `supabase db reset --linked` on Cloud after the initial migration
-- push. db reset wipes the public schema, including any auth-trigger-created
-- users.users rows. For Cloud, apply this seed once via the REST API (PATCH
-- existing users; POST topics) and then never `db reset --linked` again.

-- =============================================================================
-- Users (demo)
-- =============================================================================
-- The placeholder UUIDs below are valid v4 UUIDs but obviously fake. When a
-- real person signs up via Supabase Auth, the handle_new_auth_user trigger
-- creates a `users` row with their real auth.users id. To link these demo rows
-- to real signups, update by email or run a one-shot UPDATE … WHERE email = ...

INSERT INTO public.users (id, email, display_name, role, status)
VALUES
  (
    '11111111-1111-4111-8111-111111111111'::uuid,
    'admin@example.com',
    'Demo Admin',
    'admin',
    'active'
  ),
  (
    '22222222-2222-4222-8222-222222222222'::uuid,
    'pm@example.com',
    'Demo PM',
    'pm',
    'active'
  ),
  (
    '33333333-3333-4333-8333-333333333333'::uuid,
    'sme@example.com',
    'Demo SME',
    'sme',
    'active'
  )
ON CONFLICT (email) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role;
-- Note: id is intentionally NOT in the UPDATE list, preserving any existing
-- auth.users-linked id from the trigger.

-- =============================================================================
-- Topics (demo)
-- =============================================================================
-- Six vendor-agnostic starter topics. Replace with your pilot domain's topics
-- as you build the taxonomy. The 'pm@example.com' user owns all of them in this
-- seed; reassign per-topic via the UI or a follow-up migration.

INSERT INTO public.topics (slug, name, description, owner_user_id, vendor, status)
VALUES
  (
    'api-foundation',
    'API Foundation',
    'Cross-cutting API basics: authentication, versioning, required headers, error semantics, environments (sandbox vs production), rate limiting.',
    '22222222-2222-4222-8222-222222222222'::uuid,
    NULL,
    'active'
  ),
  (
    'resource-management',
    'Resource Management',
    'Core CRUD lifecycle for the primary resource type: create, read, update, archive, and the validation rules that govern each transition.',
    '22222222-2222-4222-8222-222222222222'::uuid,
    NULL,
    'active'
  ),
  (
    'user-and-access',
    'User & Access Management',
    'User identity, roles, permissions, and access boundaries: role definitions, provisioning, SSO and SAML, audit logging of access events.',
    '22222222-2222-4222-8222-222222222222'::uuid,
    NULL,
    'active'
  ),
  (
    'integrations-and-webhooks',
    'Integrations & Webhooks',
    'Inbound and outbound integration surfaces: webhooks, event subscriptions, third-party connectors, retry semantics, signature verification.',
    '22222222-2222-4222-8222-222222222222'::uuid,
    NULL,
    'active'
  ),
  (
    'reporting-and-analytics',
    'Reporting & Analytics',
    'Reporting and analytics endpoints: report definitions, supported filters and dimensions, export formats, scheduling, data freshness.',
    '22222222-2222-4222-8222-222222222222'::uuid,
    NULL,
    'active'
  ),
  (
    'compliance-and-privacy',
    'Compliance & Privacy',
    'Data-handling rules: PII surface, consent capture, retention, deletion, regulatory constraints applicable to the pilot domain.',
    '22222222-2222-4222-8222-222222222222'::uuid,
    NULL,
    'active'
  )
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  owner_user_id = EXCLUDED.owner_user_id,
  vendor = EXCLUDED.vendor,
  status = EXCLUDED.status;
