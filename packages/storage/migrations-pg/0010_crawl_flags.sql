-- TronBrowser Postgres schema: 0010_crawl_flags
-- Broken targets the /mcp/tron relay will not fetch again for 30 days (fleet
-- crawler rule, 2026-11-08). target is 'url:<url>' (load timeout, HTTP 5xx) or
-- 'host:<hostname>' (DNS, TLS, refused connection). After next_check_at the
-- first call claims one recheck: success deletes the row, failure re-flags it
-- 30 days out and bumps fail_count. See services/api/src/mcp/flags.ts.

create table if not exists "crawl_flags" (
  "target" text primary key,
  "scope" text not null,
  "reason" text not null,
  "last_error" text not null default '',
  "failed_at" timestamptz not null default now(),
  "next_check_at" timestamptz not null,
  "fail_count" integer not null default 1
);
create index if not exists "crawl_flags_next_check_at" on "crawl_flags" ("next_check_at");
