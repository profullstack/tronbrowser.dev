// Send transactional email via Resend if RESEND_API_KEY is set; otherwise log
// the link (dev). Keeps signup working before the email provider is wired.
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || 'TronBrowser <noreply@tronbrowser.dev>';
  if (!key) {
    console.log(`[email:dev] to=${to} subject="${subject}"\n${html}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) console.error('email send failed:', res.status, await res.text());
}
