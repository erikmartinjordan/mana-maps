// ── lang-redirect.js ─ keep localized static pages (blog) aligned with the
// language the user picked anywhere else on the site. It only redirects when
// the page declares an alternate URL for the stored language.
(function() {
  try {
    var stored = localStorage.getItem('mana-lang') || localStorage.getItem('mana-landing-lang');
    if (stored !== 'es' && stored !== 'en') return;
    var current = document.documentElement.lang === 'en' ? 'en' : 'es';
    if (stored === current) return;
    var alternate = document.querySelector('link[rel="alternate"][hreflang="' + stored + '"]');
    if (!alternate) return;
    var href = alternate.getAttribute('href');
    if (!href) return;
    var target = new URL(href, window.location.href);
    if (target.pathname === window.location.pathname && target.search === window.location.search) return;
    window.location.replace(target.pathname + target.search + target.hash);
  } catch (e) {}
})();
