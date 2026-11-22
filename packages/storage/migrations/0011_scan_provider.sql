-- Relabel extension scan rows as produced by the built-in scanner. Legacy
-- SQLite edition of migrations-pg/0011_scan_provider.sql (SQLite cannot change a
-- column default in place; createScan always sets provider explicitly).

update "extension_scans" set "provider" = 'tron-ext-scanner' where "provider" <> 'tron-ext-scanner';
