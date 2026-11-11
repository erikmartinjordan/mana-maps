// ── landing-discovery.js ─
// Atribuye las visitas internas entre landings estáticas de mapas
// (/gallery/<slug>/). Los bloques «Más mapas», «Descubre también», «En las
// noticias» y la vista previa ya enlazan otras landings, pero hasta ahora no
// había forma de saber qué colocación genera la visita: todas acababan como un
// `mapview source=static_landing` sin origen.
//
// Este script delega un único listener y registra `discovery_click` con el
// mapa de origen (data-map-slug del body), el mapa de destino y la colocación.
// Así el informe mensual puede decidir si merece la pena seguir invirtiendo en
// enlaces internos (prioridad 1 de noviembre) o si los mapas con cero visitas
// necesitan otro canal.
//
// Respeta el opt-out interno de tracking.js (localStorage «mana-notrack») y no
// registra enlaces externos, migas de pan, ni enlaces al propio mapa.

(function () {
  'use strict';
  if (window.__manaLandingDiscovery) return;
  window.__manaLandingDiscovery = true;

  var body = document.body;
  var slug = body && body.getAttribute('data-map-slug');
  if (!slug) return;

  function optedOut() {
    try { return localStorage.getItem('mana-notrack') === '1'; } catch (e) { return false; }
  }

  // Solo cuentan los enlaces a una landing de mapa del mismo sitio:
  // /gallery/<slug>/ (canónica) o el visor /gallery/?slug=<slug>.
  function mapSlugFromHref(href) {
    if (!href) return '';
    var url;
    try { url = new URL(href, window.location.href); } catch (e) { return ''; }
    if (url.origin !== window.location.origin) return '';
    var path = url.pathname.replace(/index\.html$/, '');
    var match = path.match(/^\/gallery\/([^/]+)\/$/);
    if (match) {
      try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
    }
    if (path === '/gallery/' || path === '/gallery') {
      return url.searchParams.get('slug') || '';
    }
    return '';
  }

  function placementFor(anchor) {
    if (anchor.closest('.related--discovery')) return 'discovery';
    if (anchor.closest('.related--news')) return 'news';
    if (anchor.closest('.related')) return 'related';
    if (anchor.closest('.shot')) return 'preview';
    if (anchor.closest('.cta')) return 'cta';
    return 'other';
  }

  function trackDiscovery(anchor) {
    var target = mapSlugFromHref(anchor.getAttribute('href'));
    if (!target || target === slug) return;
    if (optedOut()) return;
    var placement = placementFor(anchor);
    if (typeof window.trackEvent === 'function') {
      try { window.trackEvent('discovery_click', { source: slug, target: target, placement: placement }); } catch (e) { /* medición best-effort */ }
    }
  }

  document.addEventListener('click', function (event) {
    var node = event.target;
    var anchor = node && node.closest ? node.closest('a[href]') : null;
    if (!anchor) return;
    trackDiscovery(anchor);
  }, true);
})();
