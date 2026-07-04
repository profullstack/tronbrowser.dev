/**
 * Safety policy for analyze (PRD §11.3, §20). Classifies field/submit risk and
 * decides what is allowed under the active policy + flags. Errs on the safe side:
 * anything payment/credential/PII-sensitive is high-risk and blocked by default.
 */
import type { Policy, Risk } from './types.js';

function lower(s: string): string {
  return (s || '').toLowerCase();
}

/** Fields that must never be auto-filled or must block a submit. */
const HIGH_RISK_FIELD = [
  /pass\s?word/, /passwd/, /\bpin\b/, /\botp\b/, /mfa/, /2fa/, /one[-\s]?time/,
  /card\s?number/, /credit\s?card/, /\bcvv\b/, /\bcvc\b/, /\bccv\b/, /security\s?code/,
  /\bssn\b/, /social\s?security/, /\biban\b/, /routing/, /account\s?number/, /sort\s?code/,
  /api[-\s]?key/, /secret/, /passphrase/, /seed\s?phrase/,
];

/** Submit/actions that are irreversible or move money — block even with --allow-submit. */
const HIGH_RISK_SUBMIT = [
  /\bpay\b/, /payment/, /purchase/, /checkout/, /\bbuy\b/, /place\s?order/, /donate/,
  /transfer/, /withdraw/, /\bwire\b/, /delete\s?account/, /close\s?account/, /deactivate/,
  /cancel\s?subscription/, /change\s?password/, /reset\s?password/, /disable\s?2fa/,
];

/** Anti-abuse challenges that must stop the loop. */
const CHALLENGE = [/captcha/, /recaptcha/, /hcaptcha/, /are\s?you\s?human/, /verify\s?you.?re\s?human/];

export function fieldRisk(text: string): Risk {
  const t = lower(text);
  return HIGH_RISK_FIELD.some((r) => r.test(t)) ? 'high' : 'low';
}

export function submitRisk(text: string): Risk {
  const t = lower(text);
  if (HIGH_RISK_SUBMIT.some((r) => r.test(t))) return 'high';
  return 'medium'; // any final submit is at least medium
}

export function looksLikeChallenge(text: string): boolean {
  return CHALLENGE.some((r) => r.test(lower(text)));
}

/** May a low-/high-risk field be filled given the policy? (high never auto-fills). */
export function canFill(risk: Risk): boolean {
  return risk === 'low';
}

export interface SubmitDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  blockedReason?: string;
}

/**
 * Decide whether a form submit may proceed.
 * - high-risk submit: always blocked (even with --allow-submit).
 * - otherwise: needs --allow-submit; under `ask` policy it prompts.
 */
export function decideSubmit(risk: Risk, opts: { allowSubmit: boolean; noSubmit: boolean; policy: Policy }): SubmitDecision {
  if (opts.noSubmit) return { allowed: false, requiresConfirmation: false, blockedReason: '--no-submit set' };
  if (risk === 'high') {
    return { allowed: false, requiresConfirmation: true, blockedReason: 'High-risk submit (payment/credential/irreversible) requires explicit confirmation' };
  }
  if (!opts.allowSubmit) {
    return { allowed: false, requiresConfirmation: true, blockedReason: 'Final submit requires --allow-submit' };
  }
  return { allowed: true, requiresConfirmation: opts.policy === 'ask' };
}
