# Workflow browser nodes (M3.8)

`@tronbrowser/workflow-engine` gains **browser nodes** that drive automation from
a workflow graph, using the **same SDK primitives** as the CLI and MCP.

A single `browser` node dispatches on its `action`:

```ts
import { runWorkflow, browserHandlers, sdkBrowser, type Workflow } from '@tronbrowser/workflow-engine';

const workflow: Workflow = {
  id: 'leads', name: 'Scrape leads', entry: 'open',
  nodes: {
    open: { id: 'open', type: 'browser', next: ['links'], config: { action: 'open', url: 'https://example.com' } },
    links: { id: 'links', type: 'browser', next: [], config: { action: 'extract', mode: 'links' } },
  },
};

const browser = sdkBrowser({ headless: true });
const result = await runWorkflow(workflow, { variables: {} }, browserHandlers(browser));
console.log(exportWorkflowJson(result));   // JSON output
```

## Actions (`config.action`)

| action | config | output |
| --- | --- | --- |
| `open` | `url` | snapshot |
| `snapshot` | — | snapshot |
| `click` | `ref` | fresh snapshot |
| `fill` / `type` | `ref`, `value` | fresh snapshot |
| `extract` | `mode` (text\|links\|forms\|tables\|main\|selector) | JSON |
| `screenshot` | `path` | `{ screenshot: path }` |
| `analyze` | `goal?`, `data?`, `execute?` | AnalyzeResult |
| `runTask` | `goal`, `data?` | AnalyzeResult |

All actions run on **one shared managed session** for the workflow, opened lazily
and closed when the run ends (`onClose`).

## Runner

`runWorkflow(workflow, ctx, options)` walks the graph from `entry`, running one
handler per node and threading each output into `ctx.variables[nodeId]` (so later
nodes can reference earlier results). It stops at the first failing node.

- **JSON export**: `exportWorkflowJson(result)` (PRD §22).
- **Failure + recovery**: a failed node yields
  `{ nodeId, error, recovery: { recoverable, suggestion } }`. A stale ref, for
  example, suggests inserting a `browser.snapshot` node to refresh refs.

## Scope

- Browser nodes reuse `@tronbrowser/sdk` (`Browser`/`Page`).
- The runner is linear-first (follows `next[0]`); richer branching (conditional
  nodes) builds on the same `NodeHandler` contract.
- Nodes: `packages/workflow-engine/src/nodes/browser.ts`; runner: `runner.ts`.
