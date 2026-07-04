/**
 * Minimal workflow runner (PRD M3.8). Walks the graph from `entry`, invoking a
 * handler per node, threading each output into `ctx.variables[nodeId]`. On a
 * node failure it stops and reports recovery details; results export as JSON.
 */
import type { ExecutionContext, NodeHandler, NodeResult, NodeType, Workflow } from './index.js';
import { BrowserNodeError, type Recovery, type WorkflowBrowser } from './nodes/browser.js';
import { createBrowserNodeHandler } from './nodes/browser.js';

export interface NodeFailure {
  nodeId: string;
  error: string;
  recovery: Recovery;
  traceId?: string;
}

export interface WorkflowRunResult {
  ok: boolean;
  results: Record<string, NodeResult>;
  failure?: NodeFailure;
}

export interface RunOptions {
  handlers: Map<NodeType, NodeHandler>;
  maxNodes?: number;
  /** Called once the run ends (e.g. to close the browser session). */
  onClose?: () => Promise<void>;
}

function toRecovery(err: unknown): Recovery {
  if (err instanceof BrowserNodeError) return err.recovery;
  const e = err as { code?: string; recoverable?: boolean };
  if (e?.code === 'STALE_REF') {
    return { recoverable: true, suggestion: 'Insert a browser.snapshot node before this action to refresh refs.' };
  }
  return { recoverable: e?.recoverable === true, suggestion: 'Inspect the error and adjust the node config.' };
}

export async function runWorkflow(
  workflow: Workflow,
  ctx: ExecutionContext,
  options: RunOptions,
): Promise<WorkflowRunResult> {
  const results: Record<string, NodeResult> = {};
  const max = options.maxNodes ?? 100;
  let current: string | undefined = workflow.entry;
  let failure: NodeFailure | undefined;
  let steps = 0;

  try {
    while (current && steps < max) {
      if (ctx.signal?.aborted) break;
      const node = workflow.nodes[current];
      if (!node) break;
      const handler = options.handlers.get(node.type);
      if (!handler) {
        failure = {
          nodeId: node.id,
          error: `no handler for node type "${node.type}"`,
          recovery: { recoverable: false, suggestion: `Register a "${node.type}" handler.` },
        };
        break;
      }
      try {
        const result = await handler.run(node, ctx);
        results[node.id] = result;
        ctx.variables[node.id] = result.output;
        current = result.next[0];
      } catch (err) {
        failure = { nodeId: node.id, error: (err as Error).message, recovery: toRecovery(err) };
        break;
      }
      steps += 1;
    }
  } finally {
    await options.onClose?.();
  }

  return { ok: failure === undefined, results, ...(failure ? { failure } : {}) };
}

/** Convenience: handler map + onClose wired to a shared browser. */
export function browserHandlers(browser: WorkflowBrowser): Pick<RunOptions, 'handlers' | 'onClose'> {
  const handler = createBrowserNodeHandler(browser);
  return {
    handlers: new Map<NodeType, NodeHandler>([['browser', handler as NodeHandler]]),
    onClose: () => browser.close(),
  };
}

/** Export a run result as JSON (PRD §22: workflow outputs export as JSON). */
export function exportWorkflowJson(result: WorkflowRunResult): string {
  return JSON.stringify(result, null, 2);
}
