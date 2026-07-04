/**
 * Human-readable rendering of an AnalyzeResult (PRD §11.5).
 */
import type { AnalyzeResult } from './types.js';

export function formatAnalyzeText(r: AnalyzeResult): string {
  const lines: string[] = [];
  if (r.goal) lines.push(`Goal: ${r.goal}`);
  lines.push(`Page: ${r.page.title || '(untitled)'}`);
  lines.push(`URL: ${r.page.url}`);
  lines.push('');

  for (const form of r.detectedForms ?? []) {
    lines.push(`Detected form: ${form.name}${form.submitLabel ? ` (submit: "${form.submitLabel}")` : ''}`);
    for (const f of form.fields) {
      const mapping = f.valueFrom
        ? `<- ${f.valueFrom}   confidence ${f.confidence.toFixed(2)}`
        : f.missing
          ? '<- (missing data)'
          : '';
      lines.push(`  ${f.target} ${f.role} "${f.label}"${f.required ? ' *' : ''}  ${mapping}`.trimEnd());
    }
    lines.push('');
  }

  if (r.plan && r.plan.length) {
    lines.push('Proposed plan:');
    for (const a of r.plan) {
      if (a.action === 'fill') lines.push(`  ${a.step}. Fill ${a.target} from ${a.valueFrom}`);
      else if (a.action === 'submit') {
        lines.push(`  ${a.step}. ${a.blockedReason ? `Stop before ${a.target} "${a.label}" — ${a.blockedReason}` : `Submit ${a.target} "${a.label}"`}`);
      } else lines.push(`  ${a.step}. ${a.action} ${a.target}`);
    }
    lines.push('');
  }

  lines.push(`Missing data: ${r.missingData && r.missingData.length ? r.missingData.map((m) => `${m.label} (${m.target})`).join(', ') : 'none'}`);
  if (r.ambiguous && r.ambiguous.length) lines.push(`Ambiguous: ${r.ambiguous.map((a) => a.reason).join('; ')}`);
  if (r.risk) lines.push(`Risk: ${r.risk}`);
  lines.push(`Status: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
  if (r.message) lines.push(r.message);
  if (r.nextAction) {
    const n = r.nextAction;
    lines.push(`Next action: ${n.action} ${n.target}${n.valueFrom ? ` from ${n.valueFrom}` : ''}`);
  }
  if (r.executed && r.executed.length) lines.push(`Executed: ${r.executed.map((a) => `${a.action} ${a.target}`).join(', ')}`);
  return lines.join('\n');
}
