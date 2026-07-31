/**
 * Analyze orchestration (PRD §11). Dry-run by default: inspect the page, map
 * forms to data, and return a plan. With `execute`, run a bounded, validated
 * fill loop that stops before any gated submit, on missing data, ambiguity, a
 * challenge, or max steps — never guessing.
 */
import type { AgentSnapshot } from '@tronbrowser/browser-core';
import type { RawFormsResult } from './form-script.js';
import { buildForms } from './forms.js';
import { getByPath } from './data.js';
import { planForm } from './planner.js';
import { ANALYZE_ERROR, type AnalyzeResult, type PlannedAction, type Policy } from './types.js';

/** The browser operations analyze needs. The CLI wires these to CDP; tests fake them. */
export interface AnalyzeBrowser {
  /** Snapshot the page (must tag elements with data-tron-ref). */
  snapshot(): Promise<AgentSnapshot>;
  /** Read forms (evaluate analyzeFormsExpression) after a snapshot. */
  readForms(): Promise<RawFormsResult>;
  fill(ref: string, value: string): Promise<void>;
  click(ref: string): Promise<void>;
}

export interface AnalyzeOptions {
  goal?: string;
  data?: unknown;
  execute?: boolean;
  noSubmit?: boolean;
  allowSubmit?: boolean;
  policy?: Policy;
  maxSteps?: number;
}

export async function analyze(browser: AnalyzeBrowser, options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const execute = options.execute === true;
  const opts = {
    policy: options.policy ?? 'safe',
    noSubmit: options.noSubmit === true,
    allowSubmit: options.allowSubmit === true,
    maxSteps: options.maxSteps ?? 8,
  };

  const snap = await browser.snapshot();
  const page = { url: snap.url, title: snap.title };
  const raw = await browser.readForms();

  const base = (): AnalyzeResult => ({
    ok: true,
    mode: execute ? 'execute' : 'dry-run',
    status: 'planned',
    ...(options.goal ? { goal: options.goal } : {}),
    page,
  });

  if (raw.challenge) {
    return {
      ...base(),
      ok: false,
      status: 'blocked',
      reason: ANALYZE_ERROR.CAPTCHA_OR_CHALLENGE_DETECTED,
      message: 'A CAPTCHA or anti-abuse challenge is present; stopping.',
    };
  }

  const forms = buildForms(raw, options.data ?? {});
  const hasFillable = forms.some((f) => f.fields.some((x) => x.valueFrom || x.missing));

  // A free-form goal with nothing to fill needs a reasoning planner (M3.5 wires
  // the deterministic form path; open-ended navigation needs a configured provider).
  if (options.goal && !hasFillable && forms.every((f) => f.fields.length === 0)) {
    return {
      ...base(),
      ok: false,
      status: 'blocked',
      reason: ANALYZE_ERROR.AI_PROVIDER_NOT_CONFIGURED,
      message: 'This goal needs an AI provider for open-ended navigation; none is configured.',
    };
  }

  const fp = planForm(forms, opts);
  const result: AnalyzeResult = {
    ...base(),
    status: fp.status,
    detectedForms: forms,
    plan: fp.plan,
    nextAction: fp.nextAction,
    missingData: fp.missingData,
    ambiguous: fp.ambiguous,
    confidence: fp.confidence,
  };

  if (fp.status === 'blocked') {
    return { ...result, ok: false, reason: ANALYZE_ERROR.MISSING_REQUIRED_DATA, message: 'Required fields have no matching data.' };
  }
  if (fp.status === 'ambiguous') {
    return { ...result, ok: false, reason: ANALYZE_ERROR.AMBIGUOUS_TARGET, message: 'Multiple fields map to the same data; resolve before proceeding.' };
  }

  if (!execute) return result;

  // Bounded execute: fill, then gate the submit.
  const executed: PlannedAction[] = [];
  let steps = 0;
  for (const action of fp.plan) {
    if (steps >= opts.maxSteps) {
      return { ...result, ok: false, status: 'blocked', reason: ANALYZE_ERROR.MAX_STEPS_REACHED, executed };
    }
    if (action.action === 'fill' && action.valueFrom) {
      const value = getByPath(options.data, action.valueFrom);
      try {
        await browser.fill(action.target, value === undefined || value === null ? '' : String(value));
      } catch (err) {
        return { ...result, ok: false, status: 'blocked', message: (err as Error).message, executed };
      }
      executed.push(action);
      steps += 1;
    } else if (action.action === 'submit') {
      if (action.blockedReason) {
        return { ...result, status: 'needs_confirmation', nextAction: action, executed, message: action.blockedReason };
      }
      await browser.click(action.target);
      executed.push(action);
      return { ...result, status: 'complete', executed };
    }
  }

  const status = fp.plan.some((a) => a.action === 'submit') ? 'needs_confirmation' : 'complete';
  return { ...result, status, executed, nextAction: null };
}
