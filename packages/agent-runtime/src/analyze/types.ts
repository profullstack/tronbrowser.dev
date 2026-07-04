/**
 * AI-analyze contracts (PRD M3.5 / §11). The form-mapping + safety path is
 * deterministic; an optional Planner handles open-ended goals.
 */

export type Risk = 'low' | 'medium' | 'high';
export type Policy = 'safe' | 'auto' | 'ask';
export type AnalyzeMode = 'plan' | 'form' | 'next' | 'run';

export type AnalyzeStatus =
  | 'planned'
  | 'acted'
  | 'complete'
  | 'blocked'
  | 'needs_confirmation'
  | 'ambiguous'
  | 'failed';

/** Coded reasons for blocked/failed results (PRD §18). */
export const ANALYZE_ERROR = {
  AI_PROVIDER_NOT_CONFIGURED: 'AI_PROVIDER_NOT_CONFIGURED',
  MISSING_REQUIRED_DATA: 'MISSING_REQUIRED_DATA',
  LOW_CONFIDENCE_ACTION: 'LOW_CONFIDENCE_ACTION',
  ACTION_REQUIRES_CONFIRMATION: 'ACTION_REQUIRES_CONFIRMATION',
  UNSAFE_ACTION_BLOCKED: 'UNSAFE_ACTION_BLOCKED',
  MAX_STEPS_REACHED: 'MAX_STEPS_REACHED',
  GOAL_NOT_VERIFIED: 'GOAL_NOT_VERIFIED',
  CAPTCHA_OR_CHALLENGE_DETECTED: 'CAPTCHA_OR_CHALLENGE_DETECTED',
  AMBIGUOUS_TARGET: 'AMBIGUOUS_TARGET',
} as const;
export type AnalyzeErrorCode = (typeof ANALYZE_ERROR)[keyof typeof ANALYZE_ERROR];

export type ActionKind = 'fill' | 'click' | 'submit' | 'navigate' | 'stop';

export interface PlannedAction {
  step: number;
  action: ActionKind;
  target: string; // @ref
  label: string;
  valueFrom?: string; // data path, e.g. "lead.email" — never a literal value
  risk: Risk;
  confidence: number;
  requiresConfirmation: boolean;
  blockedReason?: string;
}

export interface FormFieldMapping {
  target: string; // @ref
  label: string;
  role: string;
  type: string;
  required: boolean;
  valueFrom?: string; // matched data path
  confidence: number;
  missing: boolean; // required but no data matched
}

export interface DetectedForm {
  ref: string; // synthetic id, e.g. "@form1"
  name: string;
  submitRef?: string;
  submitLabel?: string;
  fields: FormFieldMapping[];
}

export interface MissingDatum {
  field: string;
  label: string;
  target: string;
}

export interface Ambiguity {
  reason: string;
  options: string[];
}

export interface AnalyzeResult {
  ok: boolean;
  mode: 'dry-run' | 'execute';
  status: AnalyzeStatus;
  goal?: string;
  page: { url: string; title: string };
  detectedForms?: DetectedForm[];
  missingData?: MissingDatum[];
  ambiguous?: Ambiguity[];
  plan?: PlannedAction[];
  nextAction?: PlannedAction | null;
  reason?: AnalyzeErrorCode;
  message?: string;
  risk?: Risk;
  confidence?: number;
  executed?: PlannedAction[];
  traceId?: string;
}
