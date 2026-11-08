'use strict';
// ── scripts/lib/map-index.js ─
// Índice estático de mapas publicado en /gallery/. Las tarjetas de la galería
// se renderizan con JavaScript desde Firestore, así que el HTML servido no
// contiene enlaces a las landings /gallery/<slug>/: los rastreadores dependen
// del JSON-LD y los mapas con menos tráfico no reciben enlaces internos desde
// la página de entrada. Este índice añade un enlace HTML rastreable por mapa.
//
// El bloque vive entre los marcadores `map-index:start` / `map-index:end` de
// site/gallery/index.html y lo regenera scripts/tools/generate-map-landings.js
// junto con las landings, para que nunca quede desincronizado.
//
// La lógica es pura (sin Firestore ni sistema de ficheros) para poder testearla.

const { slugOf } = require('./related-maps');

const START_MARKER = '<!-- map-index:start -->';
const END_MARKER = '<!-- map-index:end -->';
const DEFAULT_HEADING = 'Índice de mapas';

function normTitle(map) {
  const title = map && (map.title || map.name);
  return String(title == null ? '' : title).trim();
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Un enlace por slug, ordenado por título (es) y, en empate, por slug.
function normalizeMaps(maps) {
  const seen = new Set();
  const list = [];
  for (const map of Array.isArray(maps) ? maps : []) {
    const slug = slugOf(map);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    list.push({ slug, title: normTitle(map) || slug });
  }
  return list.sort((a, b) => {
    const byTitle = a.title.localeCompare(b.title, 'es', { sensitivity: 'base' });
    if (byTitle !== 0) return byTitle;
    return a.slug.localeCompare(b.slug);
  });
}

// HTML del bloque completo: un <details> plegado para no duplicar a la vista el
// grid de tarjetas, pero con todos los enlaces presentes en el HTML servido.
function renderMapIndex(maps, opts) {
  const heading = escapeHtml((opts && opts.heading) || DEFAULT_HEADING);
  const list = normalizeMaps(maps);
  const items = list.map(
    (m) => '    <li><a href="/gallery/' + encodeURIComponent(m.slug) + '/">' + escapeHtml(m.title) + '</a></li>'
  );
  const lines = [
    '<details class="map-index" id="map-index">',
    '  <summary class="map-index__summary"><span class="map-index__title">' + heading + '</span> ' +
      '<span class="map-index__count">(' + list.length + ')</span></summary>',
    '  <ul class="map-index__list">'
  ].concat(items, [
    '  </ul>',
    '</details>'
  ]);
  return {
    count: list.length,
    slugs: list.map((m) => m.slug),
    html: lines.join('\n')
  };
}

// Sustituye el contenido entre marcadores respetando la indentación de la línea
// del marcador. Devuelve `found:false` si la página no tiene los marcadores.
function updateMapIndexBlock(html, maps, opts) {
  const src = String(html == null ? '' : html);
  const start = src.indexOf(START_MARKER);
  const end = src.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    return { found: false, changed: false, html: src, count: 0, slugs: [] };
  }

  const before = src.slice(0, start);
  const lineStart = before.lastIndexOf('\n') + 1;
  const linePrefix = before.slice(lineStart);
  const indent = /^[ \t]*$/.test(linePrefix) ? linePrefix : '';

  const rendered = renderMapIndex(maps, opts);
  const block = rendered.html
    .split('\n')
    .map((line) => (line ? indent + line : line))
    .join('\n');

  const next = before + START_MARKER + '\n' + block + '\n' + indent + src.slice(end);
  return {
    found: true,
    changed: next !== src,
    html: next,
    count: rendered.count,
    slugs: rendered.slugs
  };
}

module.exports = {
  START_MARKER,
  END_MARKER,
  DEFAULT_HEADING,
  escapeHtml,
  normalizeMaps,
  renderMapIndex,
  updateMapIndexBlock
};
