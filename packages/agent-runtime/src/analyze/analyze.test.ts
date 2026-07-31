import { describe, expect, it, vi } from 'vitest';
import { analyze, type AnalyzeBrowser } from './analyze.js';
import type { RawField, RawFormsResult } from './form-script.js';

function field(ref: string, label: string, name: string, type: string, required = false): RawField {
  return { ref, label, name, type, role: type === 'textarea' ? 'textarea' : 'input', required };
}

const contactForm: RawFormsResult = {
  challenge: false,
  forms: [
    {
      name: 'contact',
      submitRef: '@e6',
      submitLabel: 'Send',
      fields: [
        field('@e2', 'Name', 'name', 'text', true),
        field('@e3', 'Email', 'email', 'email', true),
        field('@e4', 'Company', 'company', 'text'),
        field('@e5', 'Message', 'message', 'textarea', true),
      ],
    },
  ],
};

const lead = { lead: { name: 'Jane Doe', email: 'jane@example.com', company: 'Acme', message: 'Hello' } };

function fakeBrowser(raw: RawFormsResult, hooks: Partial<AnalyzeBrowser> = {}): AnalyzeBrowser {
  return {
    snapshot: async () => ({ url: 'https://x/contact', title: 'Contact', timestamp: 't', elements: [] }),
    readForms: async () => raw,
    fill: hooks.fill ?? (async () => {}),
    click: hooks.click ?? (async () => {}),
  };
}

describe('analyze — dry run', () => {
  it('maps fields to data with confidence and gates the submit', async () => {
    const r = await analyze(fakeBrowser(contactForm), { goal: 'Fill contact form', data: lead });
    expect(r.status).toBe('planned');
    expect(r.ok).toBe(true);
    const emails = r.detectedForms![0].fields.find((f) => f.label === 'Email')!;
    expect(emails.valueFrom).toBe('lead.email');
    expect(emails.confidence).toBeGreaterThan(0.9);
    // 4 fills + 1 gated submit
    expect(r.plan!.filter((a) => a.action === 'fill')).toHaveLength(4);
    const submit = r.plan!.find((a) => a.action === 'submit')!;
    expect(submit.blockedReason).toMatch(/--allow-submit/);
    expect(r.nextAction!.target).toBe('@e2');
    expect(r.missingData).toHaveLength(0);
  });

  it('blocks on missing required data', async () => {
    const r = await analyze(fakeBrowser(contactForm), {
      data: { lead: { name: 'Jane', email: 'jane@example.com', company: 'Acme' } }, // no message
    });
    expect(r.status).toBe('blocked');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('MISSING_REQUIRED_DATA');
    expect(r.missingData!.map((m) => m.label)).toContain('Message');
  });

  it('stops on a CAPTCHA/challenge', async () => {
    const r = await analyze(fakeBrowser({ challenge: true, forms: [] }), { data: lead });
    expect(r.status).toBe('blocked');
    expect(r.reason).toBe('CAPTCHA_OR_CHALLENGE_DETECTED');
  });

  it('never maps data into a high-risk field', async () => {
    const login: RawFormsResult = {
      challenge: false,
      forms: [{ name: 'login', submitRef: '@e3', submitLabel: 'Sign in', fields: [
        field('@e1', 'Email', 'email', 'email', true),
        field('@e2', 'Password', 'password', 'password', true),
      ] }],
    };
    const r = await analyze(fakeBrowser(login), { data: { lead: { email: 'a@b.com', password: 'hunter2' } } });
    const pw = r.detectedForms![0].fields.find((f) => f.label === 'Password')!;
    expect(pw.valueFrom).toBeUndefined();
    expect(r.plan!.some((a) => a.target === '@e2')).toBe(false); // password never in the plan
  });
});

describe('analyze — execute', () => {
  it('fills low-risk fields but stops before submit with --no-submit', async () => {
    const fill = vi.fn(async () => {});
    const click = vi.fn(async () => {});
    const r = await analyze(fakeBrowser(contactForm, { fill, click }), {
      goal: 'Fill contact form', data: lead, execute: true, noSubmit: true,
    });
    expect(fill).toHaveBeenCalledTimes(4);
    expect(click).not.toHaveBeenCalled();
    expect(r.status).toBe('needs_confirmation');
    expect(r.executed).toHaveLength(4);
  });

  it('submits an ordinary low-risk form with --allow-submit', async () => {
    const click = vi.fn(async () => {});
    const r = await analyze(fakeBrowser(contactForm, { click }), {
      data: lead, execute: true, allowSubmit: true,
    });
    expect(click).toHaveBeenCalledWith('@e6');
    expect(r.status).toBe('complete');
  });

  it('refuses a high-risk submit even with --allow-submit', async () => {
    const payment: RawFormsResult = {
      challenge: false,
      forms: [{ name: 'checkout', submitRef: '@e2', submitLabel: 'Pay now', fields: [
        field('@e1', 'Full name', 'name', 'text', true),
      ] }],
    };
    const click = vi.fn(async () => {});
    const r = await analyze(fakeBrowser(payment, { click }), {
      data: { lead: { name: 'Jane Doe' } }, execute: true, allowSubmit: true,
    });
    expect(click).not.toHaveBeenCalled();
    expect(r.status).toBe('needs_confirmation');
    expect(r.plan!.find((a) => a.action === 'submit')!.risk).toBe('high');
  });

  it('reports fill values from data paths (never echoing them in the plan)', async () => {
    const seen: Array<[string, string]> = [];
    await analyze(fakeBrowser(contactForm, { fill: async (r, v) => { seen.push([r, v]); } }), {
      data: lead, execute: true, noSubmit: true,
    });
    expect(seen).toContainEqual(['@e3', 'jane@example.com']);
  });
});

describe('analyze — free-form goal without data', () => {
  it('reports AI_PROVIDER_NOT_CONFIGURED when there is nothing to fill', async () => {
    const r = await analyze(fakeBrowser({ challenge: false, forms: [] }), {
      goal: 'Click through onboarding until the dashboard', execute: true,
    });
    expect(r.status).toBe('blocked');
    expect(r.reason).toBe('AI_PROVIDER_NOT_CONFIGURED');
  });
});
