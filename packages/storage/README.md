# @tronbrowser/storage

Storage abstraction over SQLite/libSQL plus object storage (Cloudflare R2).

TronBrowser is **self-hostable**: by default it uses the managed cloud database
(Turso), but a user can point at their **own** SQLite database and own their data.

## Choosing a database

| Option | Config | Tier | Managed backups |
| --- | --- | --- | --- |
| Managed cloud (Turso) | `TRONBROWSER_DB_URL=libsql://….turso.io` + `TRONBROWSER_DB_AUTH_TOKEN` | `cloud` | ✅ yes |
| Your own libSQL server | `TRONBROWSER_DB_URL=libsql://your-host` + `TRONBROWSER_DB_AUTH_TOKEN` | `self-hosted` | ⛔ you manage |
| Local libSQL replica | `TRONBROWSER_DB_URL=file:local.db` | `self-hosted` | ⛔ you manage |
| Plain local SQLite file | `TRONBROWSER_DB_PATH=/path/db.sqlite` | `self-hosted` | ⛔ you manage |

```ts
import { resolveStorageConfig, supportsManagedBackups } from '@tronbrowser/storage';

const cfg = resolveStorageConfig(process.env);
if (!supportsManagedBackups(cfg)) {
  console.warn('Self-hosted DB: you are responsible for backups.');
}
```

`TRONBROWSER_DB_PATH` takes precedence over `TRONBROWSER_DB_URL`, so pointing at a
local file always wins. The cloud tier (`*.turso.io`) is the only one with managed
backups/replication; everything else is self-hosted and user-managed.

## Migrations

Schema lives in [`migrations/`](migrations/) as ordered `NNNN_name.sql` files,
applied by a forward-only runner that tracks applied files in a
`schema_migrations` table (idempotent).

```bash
doppler run -- pnpm db:migrate    # apply pending migrations to the configured DB
pnpm db:status                    # show applied vs pending (no changes)
```

The runner ([`scripts/db-migrate.mjs`](../../scripts/db-migrate.mjs)) reads the
same `TRONBROWSER_DB_URL`/`_AUTH_TOKEN`/`_PATH` env, so it targets Turso, your
own libSQL server, or a local SQLite file. Current migrations:
`0001_ai_provider_keys`, `0002_accounts_settings` (anonymous CoinPay + email/
password accounts, sessions, synced settings).

See [`.env.example`](../../.env.example) and the [PRD](../../docs/tronbrowser-prd.md).
