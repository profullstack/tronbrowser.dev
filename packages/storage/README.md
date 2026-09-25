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

The API runs on Postgres (via `@profullstack/libsql-pg`, which keeps the
`@libsql/client` surface the code was written against). Schema lives in
[`migrations-pg/`](migrations-pg/) as ordered `NNNN_name.sql` files, generated
from the SQLite originals in [`migrations/`](migrations/) with
`npx libsql-pg convert-schema` and reviewed. `scripts/db-migrate.mjs` applies
whichever directory matches the URL it is given and records each file in a
`schema_migrations` table (idempotent).

```bash
DATABASE_URL=postgres://... pnpm db:migrate    # apply pending Postgres migrations
pnpm db:status                                 # show applied vs pending
```

The SQLite files stay until the Turso cutover is proven; a `libsql://` or
`file:` URL still applies them. Moving the rows:

```bash
npx libsql-pg copy --from "$TRONBROWSER_DB_URL" --token "$TRONBROWSER_DB_AUTH_TOKEN" \
  --to "$DATABASE_URL" --verify
```
