#!/usr/bin/env node
// ── generate-map-landings.js ─
// Genera, para cada mapa publicado en Firestore:
//   1) una tarjeta OG 1200x630  → og-cards/<slug>.png
//   2) una landing estática SEO → gallery/<slug>/index.html
//
// Las landings estáticas existen porque los crawlers de X/Facebook no ejecutan
// JS: necesitan meta/OG en el HTML servido. La URL canónica pasa a ser
// /gallery/<slug>/ y desde ahí se enlaza al visor interactivo ?slug=.
//
// Uso:
//   node scripts/generate-map-landings.js [--dry-run] [--no-images]
//
// Configuración (en orden): MANA_FIREBASE_PRO_CONFIG_JSON, o
// js/firebase-config.local.js. Solo necesita la API key pública (lectura).

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { buildMapSVG, renderSvgPage, loadWorldLandPath } = require('../tools/map-card');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const SITE_BASE = 'https://maña.com';
const OUT_CARDS = path.join(ROOT, 'og-cards');
const OUT_PAGES = path.join(ROOT, 'gallery');
const DRY_RUN = process.argv.includes('--dry-run');
const NO_IMAGES = process.argv.includes('--no-images');

// ── Config ──────────────────────────────────────────────────────
function loadConfig() {
  if (process.env.MANA_FIREBASE_PRO_CONFIG_JSON) {
    try { return JSON.parse(process.env.MANA_FIREBASE_PRO_CONFIG_JSON); } catch (e) {}
  }
  try {
    const src = fs.readFileSync(path.join(ROOT, 'js/firebase-config.local.js'), 'utf8');
    const sandbox = {};
    Function('window', src)(sandbox);
    if (sandbox.MANA_FIREBASE_CONFIGS && sandbox.MANA_FIREBASE_CONFIGS.pro) {
      return sandbox.MANA_FIREBASE_CONFIGS.pro;
    }
  } catch (e) {}
  return null;
}

// ── Firestore REST ──────────────────────────────────────────────
function restGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ': ' + data.slice(0, 200)));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
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

function relatedLinks(all, current) {
  const others = all
    .filter((m) => (m.slug || m.id) !== (current.slug || current.id))
    .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
    .slice(0, 4);
  if (!others.length) return '';
  return '<section class="related"><h2>Más mapas</h2><ul>' +
    others.map((m) => '<li><a href="/gallery/' + encodeURIComponent(m.slug || m.id) + '/">' +
      esc(m.title || m.name || 'Mapa') + '</a></li>').join('') +
    '</ul></section>';
}

function buildLandingHTML(m, all) {
  const slug = m.slug || m.id;
  const title = m.title || m.name || 'Mapa';
  const description = m.description || ('Mapa de ' + title + ' hecho con Maña Maps.');
  const canonical = `${SITE_BASE}/gallery/${encodeURIComponent(slug)}/`;
  const image = `${SITE_BASE}/og-cards/${encodeURIComponent(slug)}.png`;
  const interactive = `/gallery/?slug=${encodeURIComponent(slug)}`;
  const date = metaDate(m);
  const xText = encodeURIComponent(title + ' — vía Maña Maps');
  const xUrl = encodeURIComponent(canonical);

  const sourceLine = [m.dataSource, m.dataDate || m.dataYear].filter(Boolean).join(' · ');

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

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Maña Maps</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;900&display=swap">
<script type="application/ld+json">${JSON.stringify(dataset)}</script>
<style>
  :root{--sky:#0ea5e9;--ink:#111827;--muted:#6b7280;--line:#e5e7eb}
  *{box-sizing:border-box}
  body{margin:0;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--ink);background:#fff;line-height:1.5}
  a{color:var(--sky)}
  .topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 22px;border-bottom:1px solid var(--line);max-width:1080px;margin:0 auto}
  .brand{display:flex;align-items:center;gap:10px;font-weight:900;color:var(--ink);text-decoration:none;letter-spacing:-.5px}
  .brand svg{width:30px;height:30px}
  .nav a{margin-left:16px;text-decoration:none;font-weight:600;font-size:14px;color:var(--muted)}
  .wrap{max-width:880px;margin:0 auto;padding:28px 22px 60px}
  h1{font-size:clamp(26px,4vw,40px);letter-spacing:-1px;margin:6px 0 8px}
  .lede{color:var(--muted);font-size:17px;margin:0 0 20px}
  .shot{border:1px solid var(--line);border-radius:16px;overflow:hidden;display:block}
  .shot img{width:100%;display:block}
  .meta{color:var(--muted);font-size:14px;margin:14px 0 0}
  .cta{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0 8px}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:12px;font-weight:700;text-decoration:none;font-size:15px;border:1px solid transparent;cursor:pointer}
  .btn-primary{background:var(--sky);color:#fff}
  .btn-ghost{background:#fff;color:var(--ink);border-color:var(--line)}
  .source{margin-top:22px;padding:14px 16px;background:#f9fafb;border:1px solid var(--line);border-radius:12px;font-size:14px;color:var(--muted)}
  .related{margin-top:34px}
  .related h2{font-size:18px}
  .related ul{list-style:none;padding:0;display:grid;gap:8px}
  .related a{text-decoration:none;font-weight:600}
  footer{border-top:1px solid var(--line);margin-top:40px;padding:18px 22px;color:var(--muted);font-size:13px;text-align:center}
  footer a{color:var(--muted);margin:0 8px}
  @media (prefers-color-scheme: dark){:root{--ink:#f3f4f6;--muted:#9ca3af;--line:#374151}body{background:#0b0f14}.source{background:#111827}.btn-ghost{background:#111827;color:var(--ink)}}
</style>
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/">
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#0ea5e9" d="M42.3,-74.7C55.1,-65.8,66.1,-55.2,74.7,-42.4C83.2,-29.7,89.3,-14.8,89.7,0.2C90,15.2,84.6,30.5,74.3,40.2C64,49.8,48.7,54,35.6,62.1C22.4,70.2,11.2,82.3,-0.8,83.6C-12.7,84.9,-25.4,75.4,-36.1,65.9C-46.9,56.4,-55.6,46.8,-61.3,35.8C-66.9,24.8,-69.5,12.4,-72,-1.4C-74.5,-15.3,-76.9,-30.5,-70.9,-41C-64.9,-51.4,-50.6,-57.1,-37.4,-65.8C-24.2,-74.5,-12.1,-86.1,1.3,-88.4C14.7,-90.7,29.5,-83.6,42.3,-74.7Z" transform="translate(100 100)"/></svg>
      Maña Maps
    </a>
    <nav class="nav"><a href="/gallery/">Galería</a><a href="/map/">Crear mapa</a></nav>
  </header>
  <main class="wrap">
    <h1>${esc(title)}</h1>
    <p class="lede">${esc(description)}</p>
    <a class="shot" href="${esc(interactive)}"><img src="/og-cards/${encodeURIComponent(slug)}.png" alt="${esc(title)}" width="1200" height="630"></a>
    <p class="meta">${m.featureCount ? esc(m.featureCount) + ' elementos' : ''}${m.featureCount && date ? ' · ' : ''}${date ? esc(date) : ''}</p>
    <div class="cta">
      <a class="btn btn-primary" href="/map/" onclick="if(window.trackEvent)window.trackEvent('cta_click',{target:'create_map',source:'static_map'})">Crea tu mapa gratis</a>
      <a class="btn btn-ghost" href="${esc(interactive)}" onclick="if(window.trackEvent)window.trackEvent('cta_click',{target:'interactive',source:'static_map'})">Abrir mapa interactivo</a>
      <a class="btn btn-ghost" href="https://twitter.com/intent/tweet?text=${xText}&url=${xUrl}" target="_blank" rel="noopener" onclick="if(window.trackEvent)window.trackEvent('share',{network:'x',source:'static_map'})">Compartir en X</a>
    </div>
    ${sourceLine ? '<div class="source"><strong>Fuente de datos:</strong> ' + esc(sourceLine) + '</div>' : ''}
    ${relatedLinks(all, m)}
  </main>
  <footer>
    <a href="/gallery/">Galería</a>
    <a href="/pricing/">Precios</a>
    <a href="/about/">Acerca de</a>
    <span>© Maña Maps</span>
  </footer>
  <script defer src="/js/firebase-config.local.js"></script>
  <script defer src="/js/tracking.js"></script>
</body>
</html>
`;
}

// ── Main ────────────────────────────────────────────────────────
(async () => {
  const cfg = loadConfig();
  if (!cfg || !cfg.apiKey) {
    console.error('Falta configuración de Firebase (MANA_FIREBASE_PRO_CONFIG_JSON o js/firebase-config.local.js).');
    process.exit(1);
  }

  console.log('Leyendo mapas publicados de Firestore…');
  const maps = await fetchPublishedMaps(cfg);
  console.log(`Mapas publicados: ${maps.length}`);

  let browser = null;
  let page = null;
  if (!NO_IMAGES && !DRY_RUN) {
    fs.mkdirSync(OUT_CARDS, { recursive: true });
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  }
  const worldLandPath = loadWorldLandPath(ROOT);

  let pages = 0, cards = 0, skipped = 0;
  const generatedSlugs = new Set();

  for (const m of maps) {
    const slug = m.slug || m.id;
    const geo = m.geojsonText ? safeParse(m.geojsonText) : (m.geojson || null);

    if (page) {
      try {
        const { svg } = buildMapSVG(geo, worldLandPath);
        const html = renderSvgPage({ title: m.title || m.name }, svg);
        await page.setContent(html, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__renderReady === true, null, { timeout: 15000 });
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(OUT_CARDS, slug + '.png'), clip: { x: 0, y: 0, width: 1200, height: 630 } });
        cards++;
      } catch (e) {
        console.warn('  card FAIL', slug, e.message);
      }
    }

    const html = buildLandingHTML(m, maps);
    if (!DRY_RUN) {
      const dir = path.join(OUT_PAGES, slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    }
    generatedSlugs.add(slug);
    pages++;
  }

  if (browser) await browser.close();

  // Elimina landings estáticas de mapas ya no publicados.
  if (!DRY_RUN && fs.existsSync(OUT_PAGES)) {
    for (const entry of fs.readdirSync(OUT_PAGES)) {
      const stat = fs.statSync(path.join(OUT_PAGES, entry));
      if (!stat.isDirectory()) continue;
      if (!generatedSlugs.has(entry)) {
        fs.rmSync(path.join(OUT_PAGES, entry), { recursive: true, force: true });
        skipped++;
      }
    }
  }

  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Landings: ${pages} · OG cards: ${cards} · eliminadas: ${skipped}`);
  if (page) console.log('Hecho.');
})().catch((e) => { console.error(e); process.exit(1); });

function safeParse(str) {
  try { return JSON.parse(str); } catch (e) { return null; }
}
