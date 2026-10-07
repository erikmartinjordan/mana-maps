#!/usr/bin/env node
// render-map-images.js - Genera imagenes OG (1200x630) de los mapas de la
// galeria (data/gallery-*.js) con un renderer de choropleth propio de alta
// calidad (sin el limite de features del renderer de la web). Corre en CI.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { buildMapSVG, renderSvgPage, loadWorldLandPath } = require('./map-card');

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'og-cards');
fs.mkdirSync(OUT_DIR, { recursive: true });

function loadMaps() {
  const maps = [];
  const files = fs.readdirSync(DATA).filter((f) => /^gallery-.*\.js$/.test(f));
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

(async () => {
  const maps = loadMaps();
  console.log('Mapas encontrados:', maps.length);
  const logLines = ['Mapas: ' + maps.length];

  const worldLandPath = loadWorldLandPath(ROOT);
  console.log('world-land path:', worldLandPath ? worldLandPath.length + ' chars' : 'NO');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  let ok = 0, fail = 0;
  for (const { file, map } of maps) {
    const slug = map.slug || map.id || file.replace(/^gallery-|\.js$/g, '');
    try {
      const geo = JSON.parse(map.geojsonText || map.mapDataText || '{"type":"FeatureCollection","features":[]}');
      const { svg, count } = buildMapSVG(geo, worldLandPath);
      if (!svg) throw new Error('sin geometrias');
      const html = renderSvgPage(map, svg);
      await page.setContent(html, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__renderReady === true, null, { timeout: 15000 });
      await page.waitForTimeout(300);
      const out = path.join(OUT_DIR, slug + '.png');
      await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
      console.log('OK', out, 'poligonos:', count);
      logLines.push('OK ' + slug + ' ' + count + ' poligonos ' + fs.statSync(out).size + ' bytes');
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
