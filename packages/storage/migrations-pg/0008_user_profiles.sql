-- TronBrowser Postgres schema: 0008_user_profiles
-- The shared Profullstack profile (@profullstack/profile): email, first and last
-- name, company domain, job title and LinkedIn URL, one row per user. Asked for
-- on email signup; owner-only through /api/v1/me/profile. Generated with
-- `profile schema --key user_id --key-type text`. No backfill: users has no name.

create table if not exists "user_profiles" (
  "user_id" text primary key,
  "email" text,
  "first_name" text,
  "last_name" text,
  "company_domain" text,
  "job_title" text,
  "linkedin_url" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);
create index if not exists "user_profiles_email" on "user_profiles" (lower("email"));
create index if not exists "user_profiles_company_domain" on "user_profiles" ("company_domain");
