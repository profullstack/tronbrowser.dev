-- TronBrowser Postgres schema: 0011_scan_provider
-- Every extension scan is produced by the built-in publish-gate scanner
-- (services/api/src/store/scanner.ts). Relabel existing rows and the default so
-- the provider column names it; the external scanner integration was removed.

alter table "extension_scans" alter column "provider" set default 'tron-ext-scanner';
update "extension_scans" set "provider" = 'tron-ext-scanner' where "provider" <> 'tron-ext-scanner';
