/**
 * Deterministic form planner (PRD §11.5–11.6): builds a safe, ordered plan from
 * the mapped forms and the safety policy. Fills matched low-risk fields, gates
 * the submit, reports missing required data and ambiguous mappings.
 */
import { decideSubmit, submitRisk } from './policy.js';
import type {
  Ambiguity,
  AnalyzeStatus,
  DetectedForm,
  MissingDatum,
  PlannedAction,
  Policy,
} from './types.js';

export interface PlanOptions {
  policy: Policy;
  noSubmit: boolean;
  allowSubmit: boolean;
}

export interface FormPlan {
  plan: PlannedAction[];
  missingData: MissingDatum[];
  ambiguous: Ambiguity[];
  nextAction: PlannedAction | null;
  status: AnalyzeStatus;
  confidence: number;
}

export function planForm(forms: readonly DetectedForm[], options: PlanOptions): FormPlan {
  const plan: PlannedAction[] = [];
  const missingData: MissingDatum[] = [];
  const ambiguous: Ambiguity[] = [];
  const fillConfidences: number[] = [];
  let step = 0;

  for (const form of forms) {
    const usedPaths = new Map<string, string[]>(); // data path -> field labels
    for (const field of form.fields) {
      if (field.valueFrom) {
        plan.push({
          step: ++step,
          action: 'fill',
          target: field.target,
          label: field.label,
          valueFrom: field.valueFrom,
          risk: 'low',
          confidence: field.confidence,
          requiresConfirmation: false,
        });
        fillConfidences.push(field.confidence);
        const labels = usedPaths.get(field.valueFrom) ?? [];
        labels.push(field.label);
        usedPaths.set(field.valueFrom, labels);
      } else if (field.missing) {
        missingData.push({ field: field.label, label: field.label, target: field.target });
      }
    }

    // Two fields drawing from the same data path is ambiguous.
    for (const [path, labels] of usedPaths) {
      if (labels.length > 1) {
        ambiguous.push({ reason: `Multiple fields map to ${path}`, options: labels });
      }
    }

    if (form.submitRef) {
      const risk = submitRisk(`${form.submitLabel ?? ''} ${form.name}`);
      const decision = decideSubmit(risk, options);
      plan.push({
        step: ++step,
        action: 'submit',
        target: form.submitRef,
        label: form.submitLabel ?? 'Submit',
        risk,
        confidence: 0.9,
        requiresConfirmation: decision.requiresConfirmation,
        ...(decision.blockedReason ? { blockedReason: decision.blockedReason } : {}),
      });
    }
  }

  let status: AnalyzeStatus = 'planned';
  if (missingData.length > 0) status = 'blocked';
  else if (ambiguous.length > 0) status = 'ambiguous';

  const nextAction = status === 'planned' ? plan.find((a) => a.action === 'fill') ?? null : null;
  const confidence = fillConfidences.length
    ? Number((fillConfidences.reduce((a, b) => a + b, 0) / fillConfidences.length).toFixed(2))
    : 0;

  return { plan, missingData, ambiguous, nextAction, status, confidence };
}
