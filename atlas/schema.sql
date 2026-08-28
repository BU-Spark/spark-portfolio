-- Canonical schema for the BU Spark! Project Gallery DB.
-- GENERATED from the live database by db/generate-schema-sql.ts — do not hand-edit.
-- Regenerate after any migration. This is the source-of-truth DDL + the Database++ seed contract.

CREATE TABLE IF NOT EXISTS contributors (
  id bigserial,
  project_id text NOT NULL,
  term text,
  first_name text,
  last_name text,
  github_username text,
  email text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE contributors ADD CONSTRAINT contributors_pkey PRIMARY KEY (id);
ALTER TABLE contributors ADD CONSTRAINT contributors_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX idx_contributors_project ON public.contributors USING btree (project_id);

CREATE TABLE IF NOT EXISTS digest_snapshots (
  id bigserial,
  org text NOT NULL,
  counts jsonb NOT NULL,
  sent_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE digest_snapshots ADD CONSTRAINT digest_snapshots_pkey PRIMARY KEY (id);

CREATE TABLE IF NOT EXISTS import_inbox (
  id bigserial,
  name_key text NOT NULL,
  raw_name text NOT NULL,
  partner text,
  course text,
  term text,
  blurb text,
  pd_url text,
  tech_note text,
  tech text[] NOT NULL DEFAULT '{}'::text[],
  repo_url text,
  roles jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'::text,
  first_seen timestamp with time zone NOT NULL DEFAULT now(),
  last_seen timestamp with time zone NOT NULL DEFAULT now(),
  seen_count integer NOT NULL DEFAULT 1,
  org text NOT NULL DEFAULT 'spark'::text
);
ALTER TABLE import_inbox ADD CONSTRAINT import_inbox_pkey PRIMARY KEY (id);
ALTER TABLE import_inbox ADD CONSTRAINT import_inbox_org_chk CHECK ((org = ANY (ARRAY['spark'::text, 'cds'::text])));
CREATE UNIQUE INDEX idx_import_inbox_org_name_key ON public.import_inbox USING btree (org, name_key);

CREATE TABLE IF NOT EXISTS people (
  id bigserial,
  name_key text NOT NULL,
  name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  email text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  role_history jsonb NOT NULL DEFAULT '[]'::jsonb
);
ALTER TABLE people ADD CONSTRAINT people_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX idx_people_name_key ON public.people USING btree (name_key);

CREATE TABLE IF NOT EXISTS person_roles (
  id bigserial,
  person_id bigint NOT NULL,
  project_id text NOT NULL,
  term text NOT NULL DEFAULT ''::text,
  role text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE person_roles ADD CONSTRAINT person_roles_pkey PRIMARY KEY (id);
ALTER TABLE person_roles ADD CONSTRAINT person_roles_person_id_fkey FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE;
ALTER TABLE person_roles ADD CONSTRAINT person_roles_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX idx_person_roles_person ON public.person_roles USING btree (person_id);
CREATE INDEX idx_person_roles_project ON public.person_roles USING btree (project_id);
CREATE UNIQUE INDEX idx_person_roles_uniq ON public.person_roles USING btree (person_id, project_id, term, role);

CREATE TABLE IF NOT EXISTS project_aliases (
  name_key text NOT NULL,
  project_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE project_aliases ADD CONSTRAINT project_aliases_pkey PRIMARY KEY (name_key);
ALTER TABLE project_aliases ADD CONSTRAINT project_aliases_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS project_redirects (
  from_id text NOT NULL,
  to_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE project_redirects ADD CONSTRAINT project_redirects_pkey PRIMARY KEY (from_id);
ALTER TABLE project_redirects ADD CONSTRAINT project_redirects_to_fk FOREIGN KEY (to_id) REFERENCES projects(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS projects (
  id text NOT NULL,
  title text NOT NULL,
  blurb text NOT NULL,
  client_type text NOT NULL,
  partner text NOT NULL,
  tech text[] NOT NULL DEFAULT '{}'::text[],
  images text[] NOT NULL DEFAULT '{}'::text[],
  featured boolean NOT NULL DEFAULT false,
  custom boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  repo_url text,
  runs jsonb NOT NULL DEFAULT '[]'::jsonb,
  published boolean NOT NULL DEFAULT true,
  contact text,
  prod_url text,
  blurb_term text,
  pd_url text,
  tech_note text,
  blurb_locked boolean NOT NULL DEFAULT false,
  spark_program_lead text,
  pm text,
  tpm text,
  senior_advisor text,
  tech_advisor text,
  eir text,
  drive_url text,
  class_instructors text[] NOT NULL DEFAULT '{}'::text[],
  contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  eir_is_instructor boolean NOT NULL DEFAULT false,
  topics text[] NOT NULL DEFAULT '{}'::text[],
  client_url text,
  datasets jsonb NOT NULL DEFAULT '[]'::jsonb,
  code_private boolean NOT NULL DEFAULT false,
  client_desc text,
  surfaces text[] NOT NULL DEFAULT '{spark}'::text[],
  owner_org text NOT NULL DEFAULT 'spark'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  visibility text NOT NULL DEFAULT 'hidden'::text
);
ALTER TABLE projects ADD CONSTRAINT projects_pkey PRIMARY KEY (id);
ALTER TABLE projects ADD CONSTRAINT projects_owner_org_chk CHECK ((owner_org = ANY (ARRAY['spark'::text, 'cds'::text])));
ALTER TABLE projects ADD CONSTRAINT projects_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'in_review'::text, 'complete'::text])));
ALTER TABLE projects ADD CONSTRAINT projects_visibility_chk CHECK ((visibility = ANY (ARRAY['hidden'::text, 'internal'::text, 'public'::text])));
CREATE INDEX idx_projects_listing ON public.projects USING btree (published, featured, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key text NOT NULL,
  data jsonb NOT NULL
);
ALTER TABLE settings ADD CONSTRAINT settings_pkey PRIMARY KEY (key);

CREATE TABLE IF NOT EXISTS upload_requests (
  token text NOT NULL,
  project_id text NOT NULL,
  recipient text,
  status text NOT NULL DEFAULT 'open'::text,
  images text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '14 days'::interval),
  submitted_at timestamp with time zone,
  reviewed_at timestamp with time zone,
  reviewed_by text,
  review_note text
);
ALTER TABLE upload_requests ADD CONSTRAINT upload_requests_pkey PRIMARY KEY (token);
ALTER TABLE upload_requests ADD CONSTRAINT upload_requests_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX idx_upload_requests_expires ON public.upload_requests USING btree (expires_at);
CREATE INDEX idx_upload_requests_project ON public.upload_requests USING btree (project_id);
CREATE INDEX idx_upload_requests_status ON public.upload_requests USING btree (status);

CREATE TABLE IF NOT EXISTS users (
  id serial,
  email text NOT NULL,
  name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  org text NOT NULL DEFAULT 'spark'::text,
  is_super boolean NOT NULL DEFAULT false
);
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE users ADD CONSTRAINT users_org_chk CHECK ((org = ANY (ARRAY['spark'::text, 'cds'::text])));
CREATE UNIQUE INDEX users_email_lower_key ON public.users USING btree (lower(email));

