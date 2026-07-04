/**
 * @tronbrowser/agent-runtime
 * Agent runtime contracts (PRD §Agent Runtime): planner, executor, validator,
 * memory, tool registry, workflow runner. Interfaces only at M0.
 */

export const PACKAGE_NAME = '@tronbrowser/agent-runtime' as const;

// AI analyze — form-fill + safety + bounded execution (PRD M3.5).
export * from './analyze/index.js';

export interface Goal {
  id: string;
  description: string;
  context?: Record<string, unknown>;
}

export interface PlanStep {
  id: string;
  /** Name of a tool registered in the ToolRegistry. */
  tool: string;
  input: unknown;
}

export interface Plan {
  goalId: string;
  steps: PlanStep[];
}

/** Turns a goal into an ordered plan. */
export interface Planner {
  plan(goal: Goal): Promise<Plan>;
}

export interface StepResult {
  stepId: string;
  output: unknown;
  error?: string;
}

/** Runs plan steps, invoking tools. */
export interface Executor {
  execute(plan: Plan): Promise<StepResult[]>;
}

export interface Validation {
  valid: boolean;
  reasons: string[];
}

/** Checks that step output satisfies the goal before continuing. */
export interface Validator {
  validate(goal: Goal, results: StepResult[]): Promise<Validation>;
}

/** Persistent + working memory for an agent. */
export interface Memory {
  remember(key: string, value: unknown): Promise<void>;
  recall(key: string): Promise<unknown>;
  search(query: string, limit?: number): Promise<unknown[]>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON-schema for the tool input. */
  schema: Record<string, unknown>;
  invoke(input: unknown): Promise<unknown>;
}

/** Tools available to planner/executor. */
export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
}

/** Top-level agent wiring the loop together. */
export interface Agent {
  readonly planner: Planner;
  readonly executor: Executor;
  readonly validator: Validator;
  readonly memory: Memory;
  readonly tools: ToolRegistry;
  run(goal: Goal): Promise<StepResult[]>;
}
