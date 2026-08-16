#!/usr/bin/env node
// render-map-images.js - Genera imagenes OG (1200x630) de los mapas de la
// galeria (data/gallery-*.js) usando Chromium headless. Corre en CI (Linux).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'og-cards');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Cargar todos los mapas de data/gallery-*.js
function loadMaps() {
  const maps = [];
  const files = fs.readdirSync(DATA).filter((f) => /^gallery-.*\.js$/.test(f));
  console.log('archivos en data/:', fs.readdirSync(DATA).join(', '));
  console.log('candidatos gallery-*.js:', files.join(', ') || '(ninguno)');
  for (const file of files) {
    const code = fs.readFileSync(path.join(DATA, file), 'utf8');
    const g = code.match(/window\.\w+\s*=\s*(\{[\s\S]*?\});?\s*$/);
    if (!g) continue;
    try {
      const map = Function('"use strict"; return (' + g[1] + ');')();
      maps.push({ file, map });
    } catch (e) {
      console.error('skip', file, e.message);
    }
  }
  return maps;
}

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderPage(map, worldLand, previewJs) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  html, body { margin:0; padding:0; background:#0b0f14; }
  #map { width:1200px; height:630px; position:relative; overflow:hidden; }
  #map svg { position:absolute; inset:0; width:100%; height:100%; }
  #title { position:absolute; top:0; left:0; right:0; z-index:5; padding:40px 48px 0;
    font-family:'DM Sans',-apple-system,sans-serif; }
  #title h1 { margin:0; color:#fff; font-size:44px; font-weight:900; letter-spacing:-1px;
    text-shadow:0 2px 18px rgba(0,0,0,.6); }
  #title p { margin:6px 0 0; color:rgba(255,255,255,.85); font-size:18px; font-weight:600;
    text-shadow:0 2px 12px rgba(0,0,0,.6); }
  #brand { position:absolute; bottom:20px; right:26px; z-index:5; color:rgba(255,255,255,.92);
    font-size:15px; font-weight:700; font-family:'DM Mono',monospace; text-shadow:0 1px 8px rgba(0,0,0,.6); }
  #brand b { color:#6fb7ff; }
</style></head>
<body>
  <div id="map">
    <div id="title"><h1>${esc(map.name || map.title || 'Map')}</h1>
      <p>Made with maña.com</p></div>
    <div id="brand">mapa by <b>maña.com</b></div>
  </div>
  <script>${worldLand}</script>
  <script>${previewJs}</script>
  <script>
    window.MANA_CURRENT_MAP = ${JSON.stringify(map)};
  </script>
  <script>
    (function(){
      var m = window.MANA_CURRENT_MAP;
      var geo = JSON.parse(m.geojsonText || m.mapDataText || '{"type":"FeatureCollection","features":[]}');
      var built = window.ManaMapPreview.build(geo);
      var svg = window.ManaMapPreview.renderSVG(built);
      document.getElementById('map').insertAdjacentHTML('afterbegin', svg);
      window.__renderReady = true;
    })();
  </script>
</body></html>`;
}

(async () => {
  const worldLand = fs.readFileSync(path.join(ROOT, 'js/world-land.js'), 'utf8');
  const previewJs = fs.readFileSync(path.join(ROOT, 'js/map-preview.js'), 'utf8');
  const maps = loadMaps();
  console.log('Mapas encontrados:', maps.length);
  const logLines = ['Mapas: ' + maps.length];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  let ok = 0, fail = 0;
  for (const { file, map } of maps) {
    const slug = map.slug || map.id || file.replace(/^gallery-|\.js$/g, '');
    const html = renderPage(map, worldLand, previewJs);
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__renderReady === true, null, { timeout: 15000 });
      await page.waitForTimeout(300);
      const out = path.join(OUT_DIR, slug + '.png');
      await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
      console.log('OK', out);
      logLines.push('OK ' + slug + ' ' + fs.statSync(out).size + ' bytes');
      ok++;
    } catch (e) {
      console.error('FAIL', slug, e.message);
      logLines.push('FAIL ' + slug + ' ' + e.message);
      fail++;
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT_DIR, '_render.log'), logLines.join('\n'));
  console.log('FIN ok=' + ok + ' fail=' + fail);
  if (fail > 0) process.exit(1);
})();
