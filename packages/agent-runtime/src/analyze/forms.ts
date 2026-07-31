/**
 * Turn raw page forms + user data into a mapped form model (PRD §11.5/11.6).
 * High-risk fields are never matched to data (never auto-filled).
 */
import { dataLeaves } from './data.js';
import type { RawForm, RawFormsResult } from './form-script.js';
import { matchField, MATCH_THRESHOLD } from './matching.js';
import { fieldRisk } from './policy.js';
import type { DetectedForm, FormFieldMapping } from './types.js';

export function buildForms(raw: RawFormsResult, data: unknown): DetectedForm[] {
  const leaves = dataLeaves(data);
  return raw.forms.map((f, i) => buildForm(f, i + 1, leaves));
}

function buildForm(f: RawForm, index: number, leaves: ReturnType<typeof dataLeaves>): DetectedForm {
  const fields = f.fields.map((field): FormFieldMapping => {
    const risk = fieldRisk(`${field.label} ${field.name} ${field.type}`);
    const match =
      risk === 'high'
        ? { confidence: 0 as number, path: undefined as string | undefined }
        : matchField({ label: field.label, name: field.name, placeholder: '', type: field.type }, leaves);
    const path = match.path;
    const matched = path !== undefined && match.confidence >= MATCH_THRESHOLD;
    return {
      target: field.ref,
      label: field.label || field.name || '(unlabeled)',
      role: field.role,
      type: field.type,
      required: field.required,
      ...(path !== undefined && matched ? { valueFrom: path } : {}),
      confidence: matched ? match.confidence : 0,
      missing: field.required && !matched && risk !== 'high',
    };
  });
  return {
    ref: `@form${index}`,
    name: f.name,
    ...(f.submitRef ? { submitRef: f.submitRef } : {}),
    ...(f.submitLabel ? { submitLabel: f.submitLabel } : {}),
    fields,
  };
}
