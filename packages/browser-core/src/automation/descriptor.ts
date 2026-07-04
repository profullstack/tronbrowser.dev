/**
 * Read/write helpers for the managed-session descriptor.
 *
 * The descriptor always lives under the stable data dir (never inside an
 * ephemeral profile) so `status`/`close` can find a session regardless of which
 * profile it launched. Serialization omits absent optionals and appends a
 * trailing newline so the file is diff/POSIX-tool friendly for the shell engine.
 */
import type { SessionDescriptor } from './types.js';

/** Env slice used to locate the data dir (mirrors the shell launcher's rules). */
export interface DataDirEnv {
  TRONBROWSER_DATA?: string;
  HOME?: string;
}

/**
 * Resolve the TronBrowser data dir: `$TRONBROWSER_DATA` when set, else
 * `$HOME/.tronbrowser` (the flat convention the launcher and Tor helper use —
 * there is no XDG layout).
 */
export function resolveDataDir(env: DataDirEnv): string {
  if (env.TRONBROWSER_DATA !== undefined && env.TRONBROWSER_DATA.length > 0) {
    return env.TRONBROWSER_DATA;
  }
  return `${env.HOME ?? ''}/.tronbrowser`;
}

/** Absolute path of the session descriptor within a data dir. */
export function descriptorPath(dataDir: string): string {
  return `${dataDir}/automation/session.json`;
}

/** Serialize a descriptor to pretty JSON (absent optionals omitted). */
export function serializeDescriptor(descriptor: SessionDescriptor): string {
  const out: Record<string, unknown> = {
    version: descriptor.version,
    pid: descriptor.pid,
    host: descriptor.host,
    port: descriptor.port,
    profileDir: descriptor.profileDir,
    profileName: descriptor.profileName,
    headless: descriptor.headless,
    ephemeral: descriptor.ephemeral,
    createdAt: descriptor.createdAt,
  };
  if (descriptor.webSocketDebuggerUrl !== undefined) {
    out.webSocketDebuggerUrl = descriptor.webSocketDebuggerUrl;
  }
  if (descriptor.activeTabId !== undefined) {
    out.activeTabId = descriptor.activeTabId;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

function fail(field: string): never {
  throw new Error(`Invalid session descriptor: missing or malformed "${field}"`);
}

/** Parse and validate a descriptor, throwing a descriptive error on bad input. */
export function parseDescriptor(raw: string): SessionDescriptor {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error('Invalid session descriptor: not valid JSON');
  }
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('Invalid session descriptor: expected an object');
  }
  const o = obj as Record<string, unknown>;

  if (o.version !== 1) fail('version');
  if (typeof o.pid !== 'number' || !Number.isInteger(o.pid)) fail('pid');
  if (typeof o.host !== 'string' || o.host.length === 0) fail('host');
  if (typeof o.port !== 'number' || !Number.isInteger(o.port)) fail('port');
  if (typeof o.profileDir !== 'string' || o.profileDir.length === 0) fail('profileDir');
  if (typeof o.profileName !== 'string' || o.profileName.length === 0) fail('profileName');
  if (typeof o.headless !== 'boolean') fail('headless');
  if (typeof o.ephemeral !== 'boolean') fail('ephemeral');
  if (typeof o.createdAt !== 'string' || o.createdAt.length === 0) fail('createdAt');

  const descriptor: SessionDescriptor = {
    version: 1,
    pid: o.pid,
    host: o.host,
    port: o.port,
    profileDir: o.profileDir,
    profileName: o.profileName,
    headless: o.headless,
    ephemeral: o.ephemeral,
    createdAt: o.createdAt,
  };
  if (o.webSocketDebuggerUrl !== undefined) {
    if (typeof o.webSocketDebuggerUrl !== 'string') fail('webSocketDebuggerUrl');
    descriptor.webSocketDebuggerUrl = o.webSocketDebuggerUrl;
  }
  if (o.activeTabId !== undefined) {
    if (typeof o.activeTabId !== 'string') fail('activeTabId');
    descriptor.activeTabId = o.activeTabId;
  }
  return descriptor;
}
