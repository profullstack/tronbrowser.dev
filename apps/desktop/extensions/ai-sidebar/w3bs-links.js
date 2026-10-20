// w3bs:// links. Chromium has no handler for the scheme, so a click on one
// would ask to open xdg-open (or do nothing). Send it to the w3bs.org resolver
// page in the same tab instead; middle and modifier clicks open a new tab, the
// way an ordinary link would. Keep W3BS_GATEWAY in step with w3bs.js.
(() => {
  const W3BS_GATEWAY = 'https://w3bs.org/browse?q=';

  const w3bsLink = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const node of path) {
      if (node instanceof HTMLAnchorElement || node instanceof SVGAElement) {
        const href = node instanceof SVGAElement ? node.href.baseVal : node.getAttribute('href');
        return href && /^\s*w3bs:/i.test(href) ? href.trim() : null;
      }
    }
    return null;
  };

  const open = (event) => {
    if (event.defaultPrevented || (event.type === 'auxclick' && event.button !== 1)) return;
    const uri = w3bsLink(event);
    if (!uri) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const url = W3BS_GATEWAY + encodeURIComponent(uri);
    if (event.type === 'auxclick' || event.ctrlKey || event.metaKey || event.shiftKey) {
      window.open(url, '_blank', 'noopener');
    } else {
      location.assign(url);
    }
  };

  document.addEventListener('click', open, true);
  document.addEventListener('auxclick', open, true);
})();
