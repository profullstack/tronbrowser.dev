// Copy-to-clipboard for the install command. External file so the page can ship
// a strict Content-Security-Policy (no inline scripts).
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
