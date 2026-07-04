/**
 * @tronbrowser/workflow-engine
 * Typed node-based workflow engine. Node-type contracts only at M0.
 */

export const PACKAGE_NAME = '@tronbrowser/workflow-engine' as const;

/** Node kinds the engine can execute (PRD §Workflow Engine). */
export const NODE_TYPES = [
  'prompt',
  'browser',
  'ai',
  'http',
  'conditional',
  'delay',
  'export',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

interface NodeBase<T extends NodeType, C> {
  id: string;
  type: T;
  /** ids of downstream nodes. */
  next: string[];
  config: C;
}

export type PromptNode = NodeBase<'prompt', { template: string }>;

/** Browser node actions map to SDK Page primitives (PRD M3.8 / §21.1). */
export type BrowserAction =
  | 'open'
  | 'snapshot'
  | 'click'
  | 'fill'
  | 'type'
  | 'extract'
  | 'screenshot'
  | 'analyze'
  | 'runTask';

export interface BrowserNodeConfig {
  action: BrowserAction;
  url?: string; // open
  ref?: string; // click/fill/type
  value?: string; // fill/type
  mode?: string; // extract (text|links|forms|tables|main|selector)
  path?: string; // screenshot destination
  goal?: string; // analyze/runTask
  data?: Record<string, unknown>; // analyze/runTask
  execute?: boolean; // analyze
}
export type BrowserNode = NodeBase<'browser', BrowserNodeConfig>;
export type AiNode = NodeBase<'ai', { provider: string; model: string; system?: string }>;
export type HttpNode = NodeBase<'http', { method: string; url: string; body?: unknown }>;
export type ConditionalNode = NodeBase<'conditional', { expression: string; whenTrue: string; whenFalse: string }>;
export type DelayNode = NodeBase<'delay', { ms: number }>;
export type ExportNode = NodeBase<'export', { format: 'json' | 'csv' | 'markdown'; destination: string }>;

export type WorkflowNode =
  | PromptNode
  | BrowserNode
  | AiNode
  | HttpNode
  | ConditionalNode
  | DelayNode
  | ExportNode;

export interface Workflow {
  id: string;
  name: string;
  entry: string;
  nodes: Record<string, WorkflowNode>;
}

export interface ExecutionContext {
  variables: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface NodeResult {
  nodeId: string;
  output: unknown;
  next: string[];
}

/** Executes a single node. One handler per NodeType. */
export interface NodeHandler<N extends WorkflowNode = WorkflowNode> {
  readonly type: N['type'];
  run(node: N, ctx: ExecutionContext): Promise<NodeResult>;
}

/** Drives a workflow graph to completion. */
export interface WorkflowRunner {
  run(workflow: Workflow, ctx: ExecutionContext): Promise<Record<string, NodeResult>>;
}

// Browser workflow nodes + runner (PRD M3.8).
export * from './nodes/browser.js';
export * from './runner.js';
