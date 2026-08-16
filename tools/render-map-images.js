#!/usr/bin/env node
// render-map-images.js - Genera imagenes OG (1200x630) de los mapas de la
// galeria (data/gallery-*.js) con un renderer de choropleth propio de alta
// calidad (sin el limite de features del renderer de la web). Corre en CI.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'og-cards');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Proyeccion: Web Mercator
const MAX_LAT = 85.051129;
function mercY(lat) {
  const c = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + c / 2));
}

// Escala un anillo de coords (simplificacion por Douglas-Peucker ligera)
function simplifyRing(ring, tol) {
  if (ring.length <= 3) return ring;
  const res = [];
  for (let i = 0; i < ring.length; i++) {
    res.push(ring[i]);
  }
  // saltar puntos muy cercanos para reducir tamano
  const out = [res[0]];
  for (let i = 1; i < res.length; i++) {
    const [x1, y1] = out[out.length - 1];
    const [x2, y2] = res[i];
    if (Math.abs(x2 - x1) + Math.abs(y2 - y1) > tol) out.push(res[i]);
  }
  return out;
}

// Construye el SVG del mapa
function buildMapSVG(geo) {
  // bbox (lons en grados, lats convertidas a mercY)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ringCoords = [];
  for (const f of geo.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const ring = poly[0];
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        const my = mercY(y);
        if (my < minY) minY = my;
        if (my > maxY) maxY = my;
      }
    }
  }
  if (minX === Infinity) return '';
  // padding
  const dx = (maxX - minX) * 0.03, dy = (maxY - minY) * 0.05;
  minX -= dx; maxX += dx; minY -= dy; maxY += dy;
  const spanX = maxX - minX, spanY = maxY - minY;

  // Lienzo 1200x630. El mundo es muy panoramico en Mercator; para que llene
  // el lienzo usamos escalas independientes por eje (distorsion aceptable en
  // choropleths de prensa).
  const W = 1200, H = 630;
  const mapAreaTop = 120, mapAreaBottom = 610;
  const availH = mapAreaBottom - mapAreaTop;
  const availW = W - 80;
  const scaleX = availW / spanX;              // px por grado de lon
  const scaleY = availH / spanY;              // px por unidad mercY
  const mapW = spanX * scaleX;
  const mapH = spanY * scaleY;
  const offX = (W - mapW) / 2;
  const offY = mapAreaTop + (availH - mapH) / 2;

  const tx = (lon) => offX + (lon - minX) * scaleX;
  const ty = (my) => offY + (maxY - my) * scaleY;

  function ringPath(ring) {
    const coords = ring.map(([x, y]) => tx(x).toFixed(1) + ',' + ty(mercY(y)).toFixed(1));
    return 'M' + coords.join('L') + 'Z';
  }

  let paths = '';
  let bounds = 0;
  for (const f of geo.features) {
    const color = (f.properties && (f.properties._manaColor || f.properties.color)) || '#444';
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      if (!poly || !poly.length) continue;
      const ring = simplifyRing(poly[0], 0.05);
      if (ring.length < 3) continue;
      paths += '<path d="' + ringPath(ring) + '" fill="' + color + '" stroke="#0b0f14" stroke-width="0.6" stroke-linejoin="round"/>';
      bounds++;
    }
  }
  return {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + paths + '</svg>',
    count: bounds
  };
}

// Cabecera con estilo del logo
function headerHTML() {
  return `
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style="width:44px;height:44px">
      <path fill="#6fb7ff" d="M42.3,-74.7C55.1,-65.8,66.1,-55.2,74.7,-42.4C83.2,-29.7,89.3,-14.8,89.7,0.2C90,15.2,84.6,30.5,74.3,40.2C64,49.8,48.7,54,35.6,62.1C22.4,70.2,11.2,82.3,-0.8,83.6C-12.7,84.9,-25.4,75.4,-36.1,65.9C-46.9,56.4,-55.6,46.8,-61.3,35.8C-66.9,24.8,-69.5,12.4,-72,-1.4C-74.5,-15.3,-76.9,-30.5,-70.9,-41C-64.9,-51.4,-50.6,-57.1,-37.4,-65.8C-24.2,-74.5,-12.1,-86.1,1.3,-88.4C14.7,-90.7,29.5,-83.6,42.3,-74.7Z" transform="translate(100 100)"/>
    </svg>
    <span style="font-size:18px;font-weight:900;color:#fff;letter-spacing:-.5px">maña.com</span>`;
}

function renderPage(map, mapSVG) {
  const title = map.title || map.name || 'Map';
  const subtitle = map.subtitle || 'Made with maña.com';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:1200px;height:630px;background:#0b0f14;overflow:hidden;font-family:'DM Sans',-apple-system,sans-serif}
  #bg{position:absolute;inset:0}
  #map{position:absolute;inset:0}
  #map svg{width:1200px;height:630px}
  #top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:14px;padding:26px 40px;z-index:5}
  #title{position:absolute;bottom:0;left:0;right:0;padding:0 40px 22px;z-index:5}
  #title h1{margin:0;color:#fff;font-size:40px;font-weight:900;letter-spacing:-1px}
  #title p{margin:4px 0 0;color:rgba(255,255,255,.75);font-size:17px;font-weight:600}
</style>
</head><body>
  <div id="map"></div>
  <div id="top">${headerHTML()}</div>
  <div id="title"><h1>${title.replace(/</g,'&lt;')}</h1><p>${subtitle.replace(/</g,'&lt;')}</p></div>
  <script>window.__MAP_SVG = ${JSON.stringify(mapSVG)};</script>
  <script>
    document.getElementById('map').innerHTML = window.__MAP_SVG;
    window.__renderReady = true;
  </script>
</body></html>`;
}

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

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  let ok = 0, fail = 0;
  for (const { file, map } of maps) {
    const slug = map.slug || map.id || file.replace(/^gallery-|\.js$/g, '');
    try {
      const geo = JSON.parse(map.geojsonText || map.mapDataText || '{"type":"FeatureCollection","features":[]}');
      const { svg, count } = buildMapSVG(geo);
      if (!svg) throw new Error('sin geometrias');
      const html = renderPage(map, svg);
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
