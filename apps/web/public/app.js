// Copy-to-clipboard for the install command (CSP-safe: no inline handlers).
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const text = document.getElementById(btn.getAttribute('data-copy'))?.textContent;
  if (text && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      const prev = btn.textContent;
      btn.textContent = 'copied';
      setTimeout(() => (btn.textContent = prev), 1200);
    });
  }
});

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// Reflect signed-in state in the top bar (account menu) vs "Sign in".
async function initAuth() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  let me;
  try { me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json()); }
  catch { return; }
  if (!me || !me.signedIn) return;

  const label = me.email || (me.id ? me.id.slice(0, 8) : 'Account');
  topbar.innerHTML =
    `<div class="account">
       <button class="acct-btn" id="acctBtn" aria-haspopup="true" aria-expanded="false">${esc(label)} ▾</button>
       <div class="acct-menu" id="acctMenu" hidden>
         <a href="/settings">Settings</a>
         <a href="#" id="signout">Sign out</a>
       </div>
     </div>`;
  const btn = document.getElementById('acctBtn');
  const menu = document.getElementById('acctMenu');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hasAttribute('hidden');
    menu.toggleAttribute('hidden', !open);
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', () => menu.setAttribute('hidden', ''));
  document.getElementById('signout').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    location.href = '/';
  });

  // Clean ?signedin=1 from the URL.
  if (location.search.includes('signedin')) history.replaceState({}, '', location.pathname);
}
initAuth();
