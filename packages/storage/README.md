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

See [`.env.example`](../../.env.example) and the [PRD](../../docs/tronbrowser-prd.md).
