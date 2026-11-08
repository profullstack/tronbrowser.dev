-- Broken targets the /mcp/tron relay will not fetch again for 30 days. Legacy
-- SQLite edition of migrations-pg/0010_crawl_flags.sql.

create table if not exists "crawl_flags" (
  "target" text primary key,
  "scope" text not null,
  "reason" text not null,
  "last_error" text not null default '',
  "failed_at" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "next_check_at" text not null,
  "fail_count" integer not null default 1
);
create index if not exists "crawl_flags_next_check_at" on "crawl_flags" ("next_check_at");
