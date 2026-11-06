// ── landing-view.js ─
// Cuenta una visita por sesión en la landing estática /gallery/<slug>/, que es
// la URL canónica indexada. Hasta ahora solo el visor (/gallery/?slug=)
// incrementaba maps.views, así que un mapa podía recibir tráfico de búsqueda en
// su landing y seguir apareciendo con cero visitas en el informe.
//
// Usa la misma clave de sesión que gallery-page.js para no contar dos veces la
// misma visita (landing + visor) y respeta el opt-out interno de tracking.js
// (localStorage «mana-notrack»).
(function () {
  if (window.__manaLandingView) return;
  window.__manaLandingView = true;

  var body = document.body;
  var slug = body && body.getAttribute('data-map-slug');
  if (!slug) return;

  try {
    if (localStorage.getItem('mana-notrack') === '1') return;
  } catch (e) {}

  var KEY = 'mana-slug-viewed:' + slug;
  try {
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, '1');
  } catch (e) {}

  function resolveConfig() {
    if (window.ManaFirebase && typeof window.ManaFirebase.getConfig === 'function') {
      try {
        var c = window.ManaFirebase.getConfig();
        if (c && c.projectId) return c;
      } catch (e) {}
    }
    var cfgs = window.MANA_FIREBASE_CONFIGS;
    if (!cfgs) return null;
    var host = (typeof location !== 'undefined' && location.hostname) || '';
    var env = window.MANA_FIREBASE_ENV || (/pre|localhost|127\.0\.0\.1/.test(host) ? 'pre' : 'pro');
    return cfgs[env] || cfgs.pro || cfgs.pre || null;
  }

  if (typeof window.trackEvent === 'function') {
    window.trackEvent('mapview', { slug: slug, source: 'static_landing' });
  }

  var cfg = resolveConfig();
  if (!cfg || !cfg.projectId || !cfg.apiKey || typeof fetch !== 'function') return;

  var project = encodeURIComponent(cfg.projectId);
  var url = 'https://firestore.googleapis.com/v1/projects/' + project +
    '/databases/(default)/documents:commit?key=' + encodeURIComponent(cfg.apiKey);
  var doc = 'projects/' + cfg.projectId + '/databases/(default)/documents/maps/' +
    encodeURIComponent(slug);
  var payload = {
    writes: [{
      transform: {
        document: doc,
        fieldTransforms: [{
          fieldPath: 'views',
          increment: { integerValue: '1' }
        }]
      }
    }]
  };

  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function () {});
  } catch (e) {}
})();
