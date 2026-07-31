/**
 * Minimal Chrome DevTools Protocol client over a WebSocket (PRD M3.2).
 *
 * Uses the Node global `WebSocket` (Node >= 22), so it needs no dependency. This
 * is the programmatic control channel M3.1's session descriptor points at via
 * `webSocketDebuggerUrl`; snapshots and ref actions drive a page target through
 * it. Commands are JSON-RPC ({id, method, params} -> {id, result|error});
 * unmatched messages are protocol events dispatched to `on` handlers.
 */

/** The subset of the CDP transport the snapshot/action layer depends on. */
export interface CdpConnection {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(method: string, handler: (params: unknown) => void): void;
  close(): void;
}

/** A CDP command returned an error result. */
export class CdpError extends Error {
  readonly code: number;
  constructor(method: string, code: number, message: string) {
    super(`CDP ${method} failed (${code}): ${message}`);
    this.name = 'CdpError';
    this.code = code;
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  method: string;
}

export interface CdpConnectOptions {
  timeoutMs?: number;
}

export class CdpClient implements CdpConnection {
  #ws: WebSocket;
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #handlers = new Map<string, Set<(params: unknown) => void>>();
  #closed = false;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.onmessage = (ev: MessageEvent) => this.#onMessage(ev);
    ws.onclose = () => this.#onClose();
  }

  /** Open a CDP connection to a DevTools WebSocket URL. */
  static connect(url: string, options: CdpConnectOptions = {}): Promise<CdpClient> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    return new Promise<CdpClient>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          // already closing
        }
        reject(new Error(`CDP connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new CdpClient(ws));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`CDP connect failed for ${url}`));
      };
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.#closed) return Promise.reject(new Error('CDP connection is closed'));
    const id = this.#nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        method,
      });
      try {
        this.#ws.send(payload);
      } catch (err) {
        this.#pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  on(method: string, handler: (params: unknown) => void): void {
    let set = this.#handlers.get(method);
    if (!set) {
      set = new Set();
      this.#handlers.set(method, set);
    }
    set.add(handler);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#ws.close();
    } catch {
      // ignore
    }
    this.#onClose();
  }

  #onMessage(ev: MessageEvent): void {
    const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
    let msg: {
      id?: number;
      result?: unknown;
      error?: { code?: number; message?: string };
      method?: string;
      params?: unknown;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // ignore malformed frames
    }
    if (typeof msg.id === 'number') {
      const pending = this.#pending.get(msg.id);
      if (!pending) return;
      this.#pending.delete(msg.id);
      if (msg.error) {
        pending.reject(
          new CdpError(pending.method, msg.error.code ?? -1, msg.error.message ?? 'unknown'),
        );
      } else {
        pending.resolve(msg.result);
      }
      return;
    }
    if (typeof msg.method === 'string') {
      const set = this.#handlers.get(msg.method);
      if (set) for (const h of set) h(msg.params);
    }
  }

  #onClose(): void {
    this.#closed = true;
    if (this.#pending.size === 0) return;
    const err = new Error('CDP connection closed');
    for (const p of this.#pending.values()) p.reject(err);
    this.#pending.clear();
  }
}
