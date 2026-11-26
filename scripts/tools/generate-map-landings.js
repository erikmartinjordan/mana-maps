#!/usr/bin/env node
// ── generate-map-landings.js ─
// Genera, para cada mapa publicado en Firestore:
//   1) una tarjeta OG 1200x630  → site/og-cards/<slug>.png
//   2) una landing estática SEO → site/gallery/<slug>/index.html
//
// Las landings estáticas existen porque los crawlers de X/Facebook no ejecutan
// JS: necesitan meta/OG en el HTML servido. La URL canónica pasa a ser
// /gallery/<slug>/ y desde ahí se enlaza al visor interactivo ?slug=.
//
// Uso:
//   node scripts/tools/generate-map-landings.js [--dry-run] [--no-images] [--no-pages] [--slug=<slug>]
//
// Configuración (en orden): MANA_FIREBASE_PRO_CONFIG_JSON, o
// site/js/firebase-config.local.js. Solo necesita la API key pública (lectura).

'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');
const { buildMapSVG, renderSvgPage, loadWorldLandPath } = require('../lib/map-card');
const { buildRelatedIndex, buildDiscoveryIndex, relatedLinks, slugOf } = require('../lib/related-maps');
const { buildFactsSection, buildFaqSection, buildFallbackFaqSection } = require('../lib/map-landing-facts');
const { buildNewsMapIndex, newsLinksBlock, readNewsArticles } = require('../lib/news-map-links');
const { withRetries, isQuotaExhausted } = require('../lib/firestore-retry');

const ROOT = path.resolve(__dirname, '..', '..');
const SITE_ROOT = path.join(ROOT, 'site');
const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const SITE_BASE = 'https://maña.com';
const OUT_CARDS = path.join(SITE_ROOT, 'og-cards');
const OUT_PAGES = path.join(SITE_ROOT, 'gallery');
const OUT_VIEWS = path.join(ROOT, 'data', 'sources', 'landing-views.json');
const DRY_RUN = process.argv.includes('--dry-run');
const NO_IMAGES = process.argv.includes('--no-images');
const NO_PAGES = process.argv.includes('--no-pages');
const SLUG_FILTER = (process.argv.find((a) => a.startsWith('--slug=')) || '').split('=')[1] || null;

// En macOS 10.15 (Catalina) Playwright ya no publica chromium-headless-shell:
// se usa el Chrome instalado, igual que hace tests/predeploy/playwright.config.js.
const LEGACY_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_PATH = process.env.PLAYWRIGHT_CHROME_PATH ||
  ((process.platform === 'darwin' && os.release().startsWith('19.') && fs.existsSync(LEGACY_CHROME)) ? LEGACY_CHROME : '');

// ── Logo unificado (mismo SVG vectorial que el resto del sitio) ──
// Blob oscuro + M̃ vectorial (sin dependencia de fuente) + wordmark.
const LOGO_BLOB = 'M42.3,-74.7C55.1,-65.8,66.1,-55.2,74.7,-42.4C83.2,-29.7,89.3,-14.8,89.7,0.2C90,15.2,84.6,30.5,74.3,40.2C64,49.8,48.7,54,35.6,62.1C22.4,70.2,11.2,82.3,-0.8,83.6C-12.7,84.9,-25.4,75.4,-36.1,65.9C-46.9,56.4,-55.6,46.8,-61.3,35.8C-66.9,24.8,-69.5,12.4,-72,-1.4C-74.5,-15.3,-76.9,-30.5,-70.9,-41C-64.9,-51.4,-50.6,-57.1,-37.4,-65.8C-24.2,-74.5,-12.1,-86.1,1.3,-88.4C14.7,-90.7,29.5,-83.6,42.3,-74.7Z';
const LOGO_M = '<g transform="translate(62.7889 133.0811) scale(0.04069010 -0.04069010)"><path fill="#fff" d="M1675 0H1303V987L1032 350H777L506 987V0H154V1489H585L915 754L1244 1489H1675Z"/><path fill="#fff" transform="translate(1530 -40)" d="M-186 2061Q-196 1894 -269.0 1816.5Q-342 1739 -472 1739Q-520 1739 -563.0 1758.5Q-606 1778 -637 1797Q-667 1816 -703.5 1835.5Q-740 1855 -765 1855Q-815 1855 -833.0 1823.5Q-851 1792 -855 1733H-1065Q-1059 1879 -983.0 1966.5Q-907 2054 -780 2054Q-732 2054 -691.0 2037.0Q-650 2020 -612 1998Q-582 1981 -546.0 1962.0Q-510 1943 -487 1943Q-439 1943 -418.5 1975.0Q-398 2007 -396 2061Z"/></g>';
const LOGO_SVG = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#30363B" stroke="rgba(1,1,1,0.5)" stroke-width="1" d="${LOGO_BLOB}" transform="translate(100 100)"/>${LOGO_M}</svg>`;

// ── Tarjetas OG optimizadas ─────────────────────────────────────
// La captura de Playwright es un PNG de 32 bits (~180 KB por tarjeta); con 55
// mapas eso son ~7 MB trackeados y `check-repo-hygiene.js` (límite total de
// 35 MB) falla. Se cuantiza a paleta sin cambiar píxeles visibles: la misma
// tarjeta baja a ~15-50 KB. Si `sharp` no está instalado se escribe la captura
// original para no romper la generación.
let sharpEncoder = null;
let sharpChecked = false;
function getSharp() {
  if (!sharpChecked) {
    sharpChecked = true;
    try { sharpEncoder = require('sharp'); } catch (e) { sharpEncoder = null; }
  }
  return sharpEncoder;
}

async function writeCardImage(file, buffer) {
  const sharp = getSharp();
  if (!sharp) {
    console.warn('  aviso: `sharp` no instalado; la tarjeta OG se guarda sin optimizar');
    fs.writeFileSync(file, buffer);
    return;
  }
  try {
    const optimized = await sharp(buffer)
      .png({ palette: true, quality: 92, compressionLevel: 9, effort: 10, dither: 0.8 })
      .toBuffer();
    fs.writeFileSync(file, optimized.length < buffer.length ? optimized : buffer);
  } catch (e) {
    console.warn('  aviso: no se pudo optimizar la tarjeta OG', path.basename(file), e.message);
    fs.writeFileSync(file, buffer);
  }
}

// ── Config ──────────────────────────────────────────────────────
function loadConfig() {
  if (process.env.MANA_FIREBASE_PRO_CONFIG_JSON) {
    try { return JSON.parse(process.env.MANA_FIREBASE_PRO_CONFIG_JSON); } catch (e) {}
  }
  try {
    const src = fs.readFileSync(path.join(SITE_ROOT, 'js/firebase-config.local.js'), 'utf8');
    const sandbox = {};
    Function('window', src)(sandbox);
    if (sandbox.MANA_FIREBASE_CONFIGS && sandbox.MANA_FIREBASE_CONFIGS.pro) {
      return sandbox.MANA_FIREBASE_CONFIGS.pro;
    }
  } catch (e) {}
  return null;
}

// ── Firestore REST ──────────────────────────────────────────────
function restGetOnce(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Decodifica con StringDecoder: concatenar chunks con `data += chunk`
      // parte los caracteres UTF-8 multibyte en la frontera y los convierte en
      // U+FFFD (p. ej. «coroplético» → «coropl��tico»).
      res.setEncoding('utf8');
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          const error = new Error('HTTP ' + res.statusCode + ': ' + data.slice(0, 200));
          error.status = res.statusCode;
          return reject(error);
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// 429/5xx y cortes de red se reintentan con backoff: el job es programado y no
// hay nada que corregir en el contenido cuando Firestore está saturado.
function restGet(url) {
  return withRetries(() => restGetOnce(url));
}

function fromValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) {
    const out = {};
    const fields = v.mapValue.fields || {};
    for (const k of Object.keys(fields)) out[k] = fromValue(fields[k]);
    return out;
  }
  return null;
}

function docToMap(doc) {
  const id = doc.name.split('/').pop();
  const fields = doc.fields || {};
  const out = { id, slug: id };
  for (const k of Object.keys(fields)) out[k] = fromValue(fields[k]);
  return out;
}

// ── Vista previa cartográfica local ─────────────────────────────
// La cabecera de cada landing carga `preview.json` (mismo origen) y pinta el
// mapa con MapLibre. Así no depende de Firestore en cada visita ni muestra una
// tarjeta OG ajena al diseño del mapa real. El JSON es compacto: arrays en vez
// de objetos y coordenadas a 3 decimales.
const FIRESTORE_VALUE_KEYS = {
  nullValue: 1, stringValue: 1, timestampValue: 1, integerValue: 1,
  doubleValue: 1, booleanValue: 1, arrayValue: 1, mapValue: 1
};
const PREVIEW_TYPE_CODES = {
  Point: 1, MultiPoint: 2, LineString: 3, MultiLineString: 4,
  Polygon: 5, MultiPolygon: 6
};

function decodeFirestoreValue(value) {
  if (Array.isArray(value)) return value.map(decodeFirestoreValue);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && FIRESTORE_VALUE_KEYS[keys[0]]) {
      const type = keys[0];
      const raw = value[type];
      if (type === 'nullValue') return null;
      if (type === 'stringValue' || type === 'timestampValue') return raw;
      if (type === 'integerValue') return parseInt(raw, 10);
      if (type === 'doubleValue') return Number(raw);
      if (type === 'booleanValue') return raw;
      if (type === 'arrayValue') return ((raw && raw.values) || []).map(decodeFirestoreValue);
      if (type === 'mapValue') {
        const fields = (raw && raw.fields) || {};
        const out = {};
        for (const k of Object.keys(fields)) out[k] = decodeFirestoreValue(fields[k]);
        return out;
      }
    }
    const plain = {};
    for (const k of keys) plain[k] = decodeFirestoreValue(value[k]);
    return plain;
  }
  return value;
}

function roundPreviewCoord(coord) {
  if (Array.isArray(coord) && typeof coord[0] === 'number') {
    return [Math.round(coord[0] * 1000) / 1000, Math.round(coord[1] * 1000) / 1000];
  }
  return Array.isArray(coord) ? coord.map(roundPreviewCoord) : coord;
}

function previewCoordinates(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  if (Array.isArray(geometry.coordinates)) return geometry.coordinates;
  if (typeof geometry.coordinatesText === 'string' && geometry.coordinatesText) {
    try { return JSON.parse(geometry.coordinatesText); } catch (e) { return null; }
  }
  return null;
}

// Douglas–Peucker por anillos/líneas. El épsilon se deriva del bbox (≈1 px de
// la ficha) para conservar la forma visible y recortar el JSON a la mitad.
function simplifySegment(points, epsilon) {
  if (!Array.isArray(points) || points.length <= 2) return points;
  const sqDist = (p, a, b) => {
    let x = p[0], y = p[1];
    let x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1];
    let dx = x2 - x1, dy = y2 - y1;
    if (dx || dy) {
      const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x1 = x2; y1 = y2; }
      else if (t > 0) { x1 += dx * t; y1 += dy * t; }
    }
    dx = x - x1; dy = y - y1;
    return dx * dx + dy * dy;
  };
  const simplify = (pts) => {
    if (pts.length <= 2) return pts;
    let max = 0, index = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = sqDist(pts[i], pts[0], pts[pts.length - 1]);
      if (d > max) { max = d; index = i; }
    }
    if (max > epsilon * epsilon) {
      const left = simplify(pts.slice(0, index + 1));
      const right = simplify(pts.slice(index));
      return left.slice(0, -1).concat(right);
    }
    return [pts[0], pts[pts.length - 1]];
  };
  return simplify(points);
}

function simplifyRing(ring, epsilon) {
  if (!Array.isArray(ring) || ring.length < 4) return ring;
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const points = closed ? ring.slice(0, -1) : ring.slice();
  if (points.length < 3) return ring;
  const simplified = simplifySegment(points.concat([points[0]]), epsilon);
  if (simplified.length < 4) return ring;
  if (simplified[0][0] !== simplified[simplified.length - 1][0] || simplified[0][1] !== simplified[simplified.length - 1][1]) {
    simplified.push(simplified[0]);
  }
  return simplified;
}

function simplifyPreviewCoordinates(coordinates, typeCode, epsilon) {
  if (typeCode === 1 || typeCode === 2) return coordinates;
  if (typeCode === 3) return simplifySegment(coordinates, epsilon);
  if (typeCode === 4) return coordinates.map((line) => simplifySegment(line, epsilon));
  if (typeCode === 5) return coordinates.map((ring) => simplifyRing(ring, epsilon));
  if (typeCode === 6) return coordinates.map((polygon) => polygon.map((ring) => simplifyRing(ring, epsilon)));
  return coordinates;
}

function previewEpsilon(bbox) {
  const span = Math.max(Number(bbox[2]) - Number(bbox[0]), Number(bbox[3]) - Number(bbox[1]));
  return (isFinite(span) && span > 0 ? span : 1) / 800;
}

function compactPreview(rawPreview) {
  const preview = decodeFirestoreValue(decodeFirestoreValue(rawPreview));
  if (!preview || !Array.isArray(preview.bbox)) return null;
  if (preview.kind === 'density-grid' && Array.isArray(preview.cells) && preview.cells.length) {
    return {
      k: 'd',
      b: preview.bbox,
      g: preview.gridSize,
      c: preview.cells.map((cell) => [cell.x, cell.y, cell.n, cell.c]),
    };
  }
  const epsilon = previewEpsilon(preview.bbox);
  const features = [];
  for (const entry of preview.features || []) {
    const geometry = entry && entry.geometry;
    const typeCode = geometry && PREVIEW_TYPE_CODES[geometry.type];
    const coordinates = previewCoordinates(geometry);
    if (!typeCode || !coordinates) continue;
    const feature = [typeCode, roundPreviewCoord(simplifyPreviewCoordinates(coordinates, typeCode, epsilon)), entry.color];
    if (typeof entry.fillOpacity === 'number') feature.push(entry.fillOpacity);
    features.push(feature);
  }
  return features.length ? { k: 'g', b: preview.bbox, f: features } : null;
}

function compactPreviewFromGeo(geo) {
  if (!geo || !Array.isArray(geo.features) || !geo.features.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (coords) => {
    if (!coords) return;
    if (typeof coords[0] === 'number') {
      const x = Number(coords[0]), y = Number(coords[1]);
      if (!isFinite(x) || !isFinite(y)) return;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      return;
    }
    coords.forEach(walk);
  };
  for (const f of geo.features) {
    if (f && f.geometry) walk(f.geometry.coordinates);
  }
  if (minX === Infinity) return null;
  const bbox = [minX, minY, maxX, maxY];
  const epsilon = previewEpsilon(bbox);
  const features = [];
  for (const f of geo.features) {
    const geometry = f && f.geometry;
    const typeCode = geometry && PREVIEW_TYPE_CODES[geometry.type];
    if (!typeCode || !Array.isArray(geometry.coordinates)) continue;
    const color = (f.properties && (f.properties._manaColor || f.properties.color)) || '#0ea5e9';
    features.push([typeCode, roundPreviewCoord(simplifyPreviewCoordinates(geometry.coordinates, typeCode, epsilon)), color]);
  }
  return features.length ? { k: 'g', b: bbox, f: features } : null;
}

function buildPreviewPayload(m, geo) {
  return (m.mapPreview && compactPreview(m.mapPreview)) || compactPreviewFromGeo(geo);
}

async function fetchPublishedMaps(cfg) {
  const maps = [];
  let token = null;
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${encodeURIComponent(DATABASE)}/documents/${COLLECTION}` +
      `?pageSize=300&key=${encodeURIComponent(cfg.apiKey)}` + (token ? `&pageToken=${encodeURIComponent(token)}` : '');
    const data = await restGet(url);
    for (const doc of data.documents || []) {
      const m = docToMap(doc);
      if (m.isPublished === true && m.slug) maps.push(m);
    }
    token = data.nextPageToken || null;
  } while (token);
  return maps;
}

// ── HTML helpers ────────────────────────────────────────────────
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function metaDate(m) {
  const ms = m.updatedAtMs || m.createdAtMs || 0;
  const d = new Date(typeof ms === 'number' ? ms : Date.parse(ms));
  if (!isFinite(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function prettyDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso || '';
  return `${Number(m[3])} ${MONTHS_ES[Number(m[2]) - 1] || ''} ${m[1]}`;
}

// ── Corte de visitas de la generación ────────────────────────────
// «Descubre también» reparte los mapas con pocas visitas según `views` de
// Firestore, que cambia a diario. Se versiona el corte exacto con el que se
// generaron las landings (data/sources/) para que la batería de predeploy
// compruebe el check 15 contra esos mismos datos y no contra un fixture manual
// que envejece: el 16-11 largest-observatories-world estaba a cero y el 18-11
// ya sumaba una visita, así que las landings lo trataron como mapa apenas visto
// (hosts de ≥10) y el fixture a cero lo daba por invisible.
function writeViewsSnapshot(maps) {
  const views = {};
  const sorted = maps.slice().sort((a, b) => String(slugOf(a)).localeCompare(String(slugOf(b))));
  for (const m of sorted) {
    const n = Number(m.views);
    views[slugOf(m)] = isFinite(n) && n > 0 ? n : 0;
  }
  const body = JSON.stringify({ source: 'Firestore maps.views', views }, null, 2) + '\n';
  fs.mkdirSync(path.dirname(OUT_VIEWS), { recursive: true });
  fs.writeFileSync(OUT_VIEWS, body);
  return OUT_VIEWS;
}

function buildLandingHTML(m, relatedIndex, discoveryIndex, geo, newsIndex) {
  const slug = m.slug || m.id;
  const title = m.title || m.name || 'Mapa';
  const description = m.description || ('Mapa de ' + title + ' hecho con Maña Maps.');
  const canonical = `${SITE_BASE}/gallery/${encodeURIComponent(slug)}/`;
  const image = `${SITE_BASE}/og-cards/${encodeURIComponent(slug)}.png`;
  const interactive = `/gallery/?slug=${encodeURIComponent(slug)}`;
  // Embudo mapa→cuenta (prioridad 3): la landing es la URL canónica indexada,
  // así que ofrece el guardado directamente. El visor consume `intent=save`
  // para abrir el gate de auth y reanudar el fork sin pasos intermedios.
  const saveIntent = `${interactive}&intent=save`;
  const date = metaDate(m);
  const xText = encodeURIComponent(title + ' — vía Maña Maps');
  const xUrl = encodeURIComponent(canonical);
  // Reddit es el canal social con señal real (23 de 30 sesiones sociales del
  // informe de octubre), así que la landing ofrece un envío directo además de X.
  const redditUrl = 'https://www.reddit.com/submit?url=' + xUrl + '&title=' + encodeURIComponent(title);

  const sourceLine = [m.dataSource, m.dataDate || m.dataYear].filter(Boolean).join(' · ');
  const related = relatedIndex.get(slug) || [];
  const relatedSlugs = new Set(related.map(slugOf));
  const discovery = ((discoveryIndex && discoveryIndex.get(slug)) || [])
    .filter((item) => !relatedSlugs.has(slugOf(item)));
  // Los mapas sin visitas necesitan algo más que un enlace enterrado al final
  // de la página: el bloque se pinta justo después de «Datos clave» (antes de
  // FAQ, News y «Más mapas») y con un estilo de aviso para que se vea.
  const discoveryBlock = discovery.length
    ? '\n    ' + relatedLinks(discovery, m, { title: 'Descubre también', className: 'related related--discovery' })
    : '';
  const facts = buildFactsSection(geo, {
    legendKey: m.legendKey,
    legendTitle: m.legendTitle,
    legendFormat: m.legendFormat,
  });
  const factsBlock = facts ? '\n    ' + facts.html : '';
  // FAQPage a partir de «Datos clave»: convierte el dato ya publicado en
  // preguntas long-tail («¿qué país registra…?», «¿cuál es el valor medio de…?»,
  // «¿de qué año son los datos?») que Bing puede responder sin inventar cifras.
  // Los mapas sin variable numérica reciben las dos preguntas mínimas
  // (cuántos elementos y fuente) para no quedar sin contenido ni FAQPage.
  const faq = facts
    ? buildFaqSection({
        title,
        label: facts.label,
        max: facts.max,
        min: facts.min,
        stats: facts.stats,
        dataYear: m.dataYear,
        dataDate: m.dataDate,
        sourceLine,
        featureCount: m.featureCount,
      })
    : buildFallbackFaqSection({
        title,
        sourceLine,
        featureCount: m.featureCount,
      });
  const faqBlock = faq ? '\n    ' + faq.html : '';
  // News ya enlaza la landing desde cada artículo; el enlace inverso cierra el
  // circuito interno y da a los crawlers una ruta landing → artículo → landing.
  const news = (newsIndex && newsIndex.get(slug)) || [];
  const newsBlock = newsLinksBlock(news, { title: 'En las noticias' });
  // Kicker editorial: las etiquetas del mapa dan contexto sin repetir el título.
  const tags = Array.isArray(m.tags) ? m.tags.filter(Boolean).slice(0, 3) : [];
  const kicker = tags.length ? tags.map(esc).join(' · ') : 'Mapa de datos';
  const dateLabel = prettyDate(date);

  const dataset = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: title,
    description: description,
    url: canonical,
    spatialCoverage: { '@type': 'Place', name: 'Mundo' },
    creator: { '@type': 'Organization', name: 'Maña Maps', url: 'https://maña.com' }
  };
  if (sourceLine) dataset.source = sourceLine;
  if (date) dataset.dateModified = date;
  if (Array.isArray(m.tags) && m.tags.length) dataset.keywords = m.tags;

  // Migas de pan: la landing es una ficha dentro de la galería y el breadcrumb
  // da a Google una jerarquía explícita (Inicio › Galería › mapa) que puede
  // mostrarse en el resultado de búsqueda y reparte enlaces internos.
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${SITE_BASE}/` },
      { '@type': 'ListItem', position: 2, name: 'Galería', item: `${SITE_BASE}/gallery/` },
      { '@type': 'ListItem', position: 3, name: title, item: canonical }
    ]
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Maña Maps</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" hreflang="es" href="${esc(canonical)}">
<link rel="alternate" hreflang="x-default" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="es_ES">
<meta property="og:site_name" content="Maña Maps">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="robots" content="index, follow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&display=swap">
<link rel="stylesheet" href="/css/site-footer.css">
<style>:root{--overscroll-bg:#fff}@media (prefers-color-scheme: dark){:root{--overscroll-bg:#0b0f14}}</style>
<script type="application/ld+json">${JSON.stringify(dataset)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>${faq ? `\n<script type="application/ld+json">${JSON.stringify(faq.ld)}</script>` : ''}
<style>
  :root{--sky:#0ea5e9;--ink:#111827;--muted:#6b7280;--line:#e5e7eb}
  *{box-sizing:border-box}
  body{margin:0;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--ink);background:#fff;line-height:1.5}
  a{color:var(--sky)}
  .topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 22px;border-bottom:1px solid var(--line);max-width:1080px;margin:0 auto}
  .brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink)}
  .brand-logo{position:relative;width:36px;height:36px;flex-shrink:0}
  .brand-logo svg{width:100%;height:100%;display:block}
  .brand-word{font-size:18px;font-weight:800;color:var(--ink);letter-spacing:-.02em}
  .brand-sub{font-size:11px;color:var(--muted);margin-left:3px;font-weight:600;vertical-align:super}
  .nav a{margin-left:16px;text-decoration:none;font-weight:600;font-size:14px;color:var(--muted)}
  .wrap{max-width:880px;margin:0 auto;padding:28px 22px 60px}
  .breadcrumb ol{list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px;padding:0;font-size:13px;color:var(--muted)}
  .breadcrumb li+li::before{content:"›";margin-right:6px;color:var(--muted)}
  .breadcrumb a{color:var(--muted);text-decoration:none}
  .breadcrumb a:hover{text-decoration:underline}
  .breadcrumb [aria-current="page"]{color:var(--ink);font-weight:600}
  h1{font-size:clamp(26px,4vw,40px);letter-spacing:-1px;margin:6px 0 8px}
  .lede{color:var(--muted);font-size:17px;margin:0 0 20px}
  .shot{border:1px solid var(--line);border-radius:16px;overflow:hidden;display:block}
  .shot img{width:100%;display:block}
  .meta{color:var(--muted);font-size:14px;margin:14px 0 0}
  .cta{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0 8px}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:12px;font-weight:700;text-decoration:none;font-size:15px;border:1px solid transparent;cursor:pointer}
  .btn-primary{background:var(--sky);color:#fff}
  .btn-ghost{background:#fff;color:var(--ink);border-color:var(--line)}
  .share-status{align-self:center;font-size:13px;color:var(--muted)}
  .source{margin-top:22px;padding:14px 16px;background:#f9fafb;border:1px solid var(--line);border-radius:12px;font-size:14px;color:var(--muted)}
  .facts{margin-top:22px;padding:16px 18px;border:1px solid var(--line);border-radius:14px;background:#f9fafb}
  .facts h2{font-size:18px;margin:0 0 8px}
  .facts-lede{margin:0 0 14px;font-size:15px;line-height:1.5}
  .facts-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .facts-col h3{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
  .facts-col ol{list-style:none;margin:0;padding:0;display:grid;gap:4px;font-size:14px}
  .facts-col li{display:flex;justify-content:space-between;gap:10px;border-bottom:1px dashed var(--line);padding-bottom:3px}
  .facts-name{font-weight:600}
  .facts-value{color:var(--muted);white-space:nowrap}
  @media (max-width:560px){.facts-grid{grid-template-columns:1fr}}
  .related{margin-top:34px}
  .related h2{font-size:18px}
  .related ul{list-style:none;padding:0;display:grid;gap:8px}
  .related a{text-decoration:none;font-weight:600}
  .related--news{margin-top:18px}
  .news-lang{font-size:10px;font-weight:800;letter-spacing:.06em;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 4px;margin-left:4px;vertical-align:1px}${discovery.length ? '\n  .related--discovery{margin-top:18px;padding:14px 16px;border:1px solid #bae6fd;border-radius:14px;background:#f0f9ff}\n  .related--discovery h2{font-size:15px;margin:0 0 6px;color:#0c4a6e}\n  @media (prefers-color-scheme: dark){.related--discovery{background:#082f49;border-color:#0c4a6e}.related--discovery h2{color:#bae6fd}}' : ''}
  .faq{margin-top:22px}
  .faq h2{font-size:18px;margin:0 0 10px}
  .faq-list{display:grid;gap:8px;margin:0}
  .faq-item{padding:12px 14px;border:1px solid var(--line);border-radius:12px}
  .faq-item dt{font-weight:700;font-size:14px}
  .faq-item dd{margin:4px 0 0;font-size:14px;color:var(--muted);line-height:1.5}
  @media (prefers-color-scheme: dark){:root{--ink:#f3f4f6;--muted:#9ca3af;--line:#374151}body{background:#0b0f14}.source{background:#111827}.facts{background:#111827}.btn-ghost{background:#111827;color:var(--ink)}}
</style>
<link rel="stylesheet" href="/css/site-navbar.css">
<link rel="stylesheet" href="/css/public-theme.css">
</head>
<body class="public-landing" data-map-slug="${esc(slug)}">
  <header class="site-navbar">
    <div class="site-navbar__inner">
      <a class="brand" href="/" aria-label="Maña Maps">
        <span class="brand-logo">${LOGO_SVG}</span>
        <span><span class="brand-word">Maña</span><span class="brand-sub">Maps</span></span>
      </a>
      <nav class="site-navbar__actions" aria-label="Navegación principal">
        <a class="site-navbar__link site-navbar__link--desktop" href="/news/" data-i18n="footer_news">News</a>
        <a class="site-navbar__link site-navbar__link--desktop" href="/changelog/" data-i18n="footer_changelog">Changelog</a>
        <a class="site-navbar__link site-navbar__link--desktop" href="/pricing/" data-i18n="footer_pricing">Precios</a>
        <details class="site-navbar__more">
          <summary class="site-navbar__link site-navbar__menu" data-i18n="nav_menu">Menú</summary>
          <div class="site-navbar__panel">
            <a href="/news/" data-i18n="footer_news">News</a>
            <a href="/changelog/" data-i18n="footer_changelog">Changelog</a>
            <a href="/pricing/" data-i18n="footer_pricing">Precios</a>
          </div>
        </details>
        <a class="site-navbar__link site-navbar__cta" href="/map/" data-i18n="nav_app">Abrir app</a>
      </nav>
    </div>
  </header>
  <main class="wrap">
    <nav class="breadcrumb" aria-label="Migas de pan"><ol><li><a href="/">Inicio</a></li><li><a href="/gallery/">Galería</a></li><li aria-current="page">${esc(title)}</li></ol></nav>
    <header class="map-hero">
      <p class="map-kicker">${kicker}</p>
      <h1>${esc(title)}</h1>
      <p class="lede">${esc(description)}</p>
      <div class="map-plate">
        <span class="map-plate__media" id="map-plate-media">
          <span class="map-plate__map" id="map-plate-map" aria-hidden="true"></span>
          <span class="map-plate__loading" aria-hidden="true">Cargando mapa…</span>
        </span>
        <a class="map-plate__cta" href="${esc(interactive)}" aria-label="${esc('Abrir mapa interactivo: ' + title)}">Abrir mapa interactivo <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></a>
      </div>
      <div class="map-meta">
        ${m.featureCount ? `<span class="map-meta__item"><strong>${esc(m.featureCount)}</strong> elementos</span>` : ''}
        ${date ? `<span class="map-meta__item"><time datetime="${esc(date)}">${esc(dateLabel)}</time></span>` : ''}
      </div>
    </header>
    <div class="map-actions">
      <a class="btn btn-primary" href="/map/" onclick="if(window.trackEvent)window.trackEvent('cta_click',{target:'create_map',source:'static_map'})">Crea tu mapa gratis</a>
      <a class="btn btn-outline" href="${esc(interactive)}" onclick="if(window.trackEvent)window.trackEvent('cta_click',{target:'interactive',source:'static_map'})">Abrir mapa interactivo</a>
      <a class="btn btn-outline" data-save-map="${esc(slug)}" href="${esc(saveIntent)}" onclick="if(window.trackEvent)window.trackEvent('cta_click',{target:'save_map',source:'static_map'})">Guardar en mi espacio</a>
    </div>
    <div class="share-row">
      <span class="share-row__label">Compartir</span>
      <a class="share-link" href="https://twitter.com/intent/tweet?text=${xText}&url=${xUrl}" target="_blank" rel="noopener" aria-label="Compartir en X" onclick="if(window.trackEvent)window.trackEvent('share',{network:'x',source:'static_map'})">X</a>
      <a class="share-link" href="${esc(redditUrl)}" target="_blank" rel="noopener" aria-label="Compartir en Reddit" onclick="if(window.trackEvent)window.trackEvent('share',{network:'reddit',source:'static_map'})">Reddit</a>
      <button type="button" class="share-link" data-share-native data-share-url="${esc(canonical)}" data-share-title="${esc(title)}" data-share-status="share-status">Compartir</button>
      <span class="share-status" id="share-status" role="status" aria-live="polite"></span>
    </div>
    ${sourceLine ? '<div class="source"><strong>Fuente de datos:</strong> ' + esc(sourceLine) + '</div>' : ''}${factsBlock}${discoveryBlock}${faqBlock}${newsBlock ? '\n    ' + newsBlock : ''}
    ${relatedLinks(related, m)}
  </main>
  <footer class="site-footer" aria-label="Pie de página"><div class="site-footer__inner">
    <div class="site-footer__lead">
      <a class="site-footer__brand" href="/">
        <img src="/favicon.svg" alt="" width="30" height="30">
        <span>Maña Maps</span>
      </a>
      <p class="site-footer__tagline" data-i18n="footer_tagline">Mapas claros, decisiones rápidas.</p>
      <span class="site-footer__made" data-i18n="footer_made">Hecho con ♥ en Barcelona</span>
    </div>
    <nav class="site-footer__groups" aria-label="Enlaces del pie">
      <section class="site-footer__group">
        <h2 data-i18n="footer_product">Producto</h2>
        <div class="site-footer__links">
          <a href="/map/" data-i18n="footer_create">Crear mapa</a>
          <a href="/gallery/" data-i18n="footer_gallery">Galería</a>
          <a href="/pricing/" data-i18n="footer_pricing">Precios</a>
        </div>
      </section>
      <section class="site-footer__group">
        <h2 data-i18n="footer_resources">Recursos</h2>
        <div class="site-footer__links">
          <a href="/news/" data-i18n="footer_news">News</a>
          <a href="/changelog/" data-i18n="footer_changelog">Changelog</a>
          <a href="/open/" data-i18n="footer_stats">Estadísticas</a>
          <a href="/map/?tutorial=1">Tutorial</a>
          <a href="/tasks/" data-i18n="footer_tasks">Tareas</a>
        </div>
      </section>
      <section class="site-footer__group site-footer__group--wide">
        <h2 data-i18n="footer_company">Compañía</h2>
        <div class="site-footer__links">
          <a href="/about/" data-i18n="footer_about">Acerca de</a>
          <a href="https://github.com/erikmartinjordan/mana-maps" target="_blank" rel="noopener" data-i18n="footer_github">GitHub</a>
        </div>
      </section>
    </nav>
    <div class="site-footer__bottom">
      <span class="site-footer__copyright">© 2026 Maña Maps</span>
    </div>
  </div></footer>
  <script defer src="/js/firebase-config.local.js"></script>
  <script defer src="/js/tracking.js?v=1792742000"></script>
  <script defer src="/js/landing-share.js"></script>
  <script defer src="/js/landing-view.js"></script>
  <script defer src="/js/landing-discovery.js"></script>
  <script defer src="/js/basemap-config.js"></script>
  <script defer src="/js/landing-map-preview.js"></script>
  <script defer src="/js/mobile-menu.js"></script>
</body>
</html>
`;
}

// ── Main ────────────────────────────────────────────────────────
(async () => {
  const cfg = loadConfig();
  if (!cfg || !cfg.apiKey) {
    console.error('Falta configuración de Firebase (MANA_FIREBASE_PRO_CONFIG_JSON o site/js/firebase-config.local.js).');
    process.exit(1);
  }

  console.log('Leyendo mapas publicados de Firestore…');
  let allMaps;
  try {
    allMaps = await fetchPublishedMaps(cfg);
  } catch (e) {
    if (isQuotaExhausted(e)) {
      // La cuota de Firestore es externa al repo: las landings y OG cards ya
      // commiteadas siguen siendo válidas, así que se omite esta regeneración
      // (con aviso visible en Actions) en lugar de romper el workflow diario.
      console.warn('::warning::Firestore devolvió 429 RESOURCE_EXHAUSTED (cuota agotada). Se omite la regeneración de landings y OG cards en esta ejecución; se reintentará en la próxima programada.');
      return;
    }
    throw e;
  }
  const relatedIndex = buildRelatedIndex(allMaps);
  if (!DRY_RUN && !NO_PAGES) {
    console.log(`Corte de visitas: ${path.relative(ROOT, writeViewsSnapshot(allMaps))}`);
  }
  // Los mapas con menos visitas (<10) se enlazan desde varias landings con
  // tráfico: un único enlace puede quedar enterrado. El presupuesto es
  // `perHost` × hosts con ≥10 visitas; con 3 enlaces por host alcanza para dar
  // tres hosts a los 15 mapas con 1–2 visitas. Los que siguen a cero exigen
  // además hosts de ≥30 visitas (check 15): buildDiscoveryIndex los coloca
  // primero y solo usa hosts flojos si no existen dos con tráfico real.
  const discoveryIndex = buildDiscoveryIndex(allMaps, { perHost: 3, perTarget: 3 });
  // News → landing ya existe artículo a artículo; la landing devuelve el enlace
  // a los artículos que embeben el mapa para cerrar el circuito interno.
  const newsIndex = buildNewsMapIndex(readNewsArticles(SITE_ROOT));
  const maps = SLUG_FILTER
    ? allMaps.filter((m) => (m.slug || m.id) === SLUG_FILTER)
    : allMaps;
  console.log(`Mapas publicados: ${allMaps.length}${SLUG_FILTER ? ` · filtro: ${SLUG_FILTER}` : ''}`);
  if (SLUG_FILTER && !maps.length) {
    console.error(`No hay un mapa publicado con slug ${SLUG_FILTER}.`);
    process.exit(1);
  }

  let browser = null;
  let page = null;
  if (!NO_IMAGES && !DRY_RUN) {
    fs.mkdirSync(OUT_CARDS, { recursive: true });
    browser = await chromium.launch({ headless: true, ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}) });
    page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  }
  const worldLandPath = loadWorldLandPath(SITE_ROOT);

  let pages = 0, cards = 0, skipped = 0;
  const generatedSlugs = new Set();

  for (const m of maps) {
    const slug = m.slug || m.id;
    const geo = m.geojsonText ? safeParse(m.geojsonText) : (m.geojson || null);

    if (page) {
      try {
        const { svg, count } = buildMapSVG(geo, worldLandPath, { width: 584, height: 400, pad: 16 });
        const source = [m.dataSource, m.dataDate || m.dataYear].filter(Boolean).join(' · ');
        const html = renderSvgPage({
          title: m.title || m.name,
          description: m.description || '',
          source,
          featureCount: m.featureCount || count,
        }, svg);
        await page.setContent(html, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__renderReady === true, null, { timeout: 15000 });
        await page.waitForTimeout(200);
        const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } });
        await writeCardImage(path.join(OUT_CARDS, slug + '.png'), shot);
        cards++;
      } catch (e) {
        console.warn('  card FAIL', slug, e.message);
      }
    }

    if (!NO_PAGES) {
      const html = buildLandingHTML(m, relatedIndex, discoveryIndex, geo, newsIndex);
      if (!DRY_RUN) {
        const dir = path.join(OUT_PAGES, slug);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
        const preview = buildPreviewPayload(m, geo);
        if (preview) {
          fs.writeFileSync(path.join(dir, 'preview.json'), JSON.stringify(preview) + '\n', 'utf8');
        } else {
          try { fs.rmSync(path.join(dir, 'preview.json'), { force: true }); } catch (e) {}
        }
      }
    }
    generatedSlugs.add(slug);
    pages++;
  }

  if (browser) await browser.close();

  // Elimina landings y OG cards estáticas de mapas ya no publicados.
  if (!DRY_RUN && !SLUG_FILTER && !NO_PAGES && fs.existsSync(OUT_PAGES)) {
    for (const entry of fs.readdirSync(OUT_PAGES)) {
      const stat = fs.statSync(path.join(OUT_PAGES, entry));
      if (!stat.isDirectory()) continue;
      if (!generatedSlugs.has(entry)) {
        fs.rmSync(path.join(OUT_PAGES, entry), { recursive: true, force: true });
        skipped++;
      }
    }
  }
  let cardsSkipped = 0;
  if (!DRY_RUN && !SLUG_FILTER && fs.existsSync(OUT_CARDS)) {
    for (const entry of fs.readdirSync(OUT_CARDS)) {
      if (!entry.endsWith('.png')) continue;
      const slug = entry.slice(0, -4);
      if (generatedSlugs.has(slug)) continue;
      fs.rmSync(path.join(OUT_CARDS, entry), { force: true });
      cardsSkipped++;
    }
  }

  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Landings: ${pages} · OG cards: ${cards} · eliminadas: ${skipped} · OG eliminadas: ${cardsSkipped}`);
  if (page) console.log('Hecho.');
})().catch((e) => { console.error(e); process.exit(1); });

function safeParse(str) {
  try { return JSON.parse(str); } catch (e) { return null; }
}
