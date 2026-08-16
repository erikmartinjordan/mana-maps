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
function buildMapSVG(geo, worldLandPath) {
  // bbox (lons en grados, lats convertidas a mercY)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ringCoords = [];
  for (const f of geo.features) {
    const g = f.geometry;
    if (!g) continue;
    const coordsToScan = g.type === 'LineString' ? [g.coordinates]
      : g.type === 'MultiLineString' ? g.coordinates
      : g.type === 'Polygon' ? [g.coordinates]
      : g.type === 'MultiPolygon' ? g.coordinates
      : g.type === 'Point' ? [[g.coordinates]]
      : g.type === 'MultiPoint' ? [g.coordinates]
      : [];
    for (const coordSet of coordsToScan) {
      const list = g.type === 'Polygon' ? (coordSet[0] || []) : coordSet;
      for (const [x, y] of list) {
        if (typeof x !== 'number' || typeof y !== 'number') continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        const my = mercY(y);
        if (my < minY) minY = my;
        if (my > maxY) maxY = my;
      }
    }
  }
  if (minX === Infinity) { minX = -180; maxX = 180; minY = mercY(-60); maxY = mercY(85); }
  // padding
  const dx = (maxX - minX) * 0.02, dy = (maxY - minY) * 0.06;
  minX -= dx; maxX += dx; minY -= dy; maxY += dy;
  const spanX = maxX - minX, spanY = maxY - minY;

  // Lienzo 1200x630. Mundo panoramico en Mercator; escalas independientes
  // por eje para llenar el lienzo (distorsion aceptable).
  const W = 1200, H = 630;
  const mapAreaTop = 130, mapAreaBottom = 610;
  const availH = mapAreaBottom - mapAreaTop;
  const availW = W - 72;
  const scaleX = availW / spanX;
  const scaleY = availH / spanY;
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

  // Fondo: silueta de tierra (gris muy tenue) via world-land path canónico.
  let land = '';
  if (worldLandPath) {
    // Coords canonicas: (lon*10000, mercY*10000). Mapear al lienzo:
    //   px = offX + (lon/10000 - minX) * scaleX  =>  A*cx + B
    const A = scaleX / 10000;
    const C = -scaleY / 10000;
    const B = offX - (minX * 10000) * A;
    const D = offY + (maxY * 10000) * C;
    land = '<path d="' + worldLandPath + '" fill="#1c2833" stroke="#2c3e50" stroke-width="0.6" transform="matrix(' +
      A.toFixed(10) + ' 0 0 ' + C.toFixed(10) + ' ' + B.toFixed(10) + ' ' + D.toFixed(10) + ')"/>';
  }

  // Graticule sutil (cada 30° lon / 15° lat)
  let grat = '';
  for (let lon = Math.ceil(minX / 30) * 30; lon <= maxX; lon += 30) {
    const gx = tx(lon);
    if (gx > -2 && gx < W + 2) grat += 'M' + gx.toFixed(1) + ' ' + ty(Math.max(minY, mercY(-80))).toFixed(1) + ' L' + gx.toFixed(1) + ' ' + ty(Math.min(maxY, mercY(80))).toFixed(1);
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const gy = ty(mercY(lat));
    if (gy > -2 && gy < H + 2) grat += 'M' + tx(Math.max(minX, -170)).toFixed(1) + ' ' + gy.toFixed(1) + ' L' + tx(Math.min(maxX, 170)).toFixed(1) + ' ' + gy.toFixed(1);
  }
  const gratSvg = grat ? '<path d="' + grat + '" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>' : '';

  let paths = '';
  let bounds = 0;
  for (const f of geo.features) {
    const color = (f.properties && (f.properties._manaColor || f.properties.color)) || '#4ade80';
    const weight = Number((f.properties && f.properties._manaWeight) || 2.5);
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString') {
      const coords = g.coordinates.map(([x, y]) => tx(x).toFixed(1) + ',' + ty(mercY(y)).toFixed(1));
      if (coords.length < 2) continue;
      // casing blanco + linea de color (igual que el renderer de la app)
      paths += '<path d="M' + coords.join('L') + '" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="' + (weight + 3.5) + '" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M' + coords.join('L') + '" fill="none" stroke="' + color + '" stroke-width="' + weight + '" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.95"/>';
      bounds++;
      continue;
    }
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      if (!poly || !poly.length) continue;
      const ring = simplifyRing(poly[0], 0.05);
      if (ring.length < 3) continue;
      paths += '<path d="' + ringPath(ring) + '" fill="' + color + '" fill-opacity="0.92" stroke="rgba(255,255,255,0.25)" stroke-width="0.8" stroke-linejoin="round"/>';
      bounds++;
    }
  }
  return {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<defs><linearGradient id="ocean" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1b2a"/><stop offset="1" stop-color="#1b263b"/></linearGradient></defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#ocean)"/>' + land + gratSvg + paths + '</svg>',
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

  // Cargar el path de tierra canónico (lon*10000, mercY*10000)
  let worldLandPath = null;
  try {
    const wl = fs.readFileSync(path.join(ROOT, 'js/world-land.js'), 'utf8');
    const m = wl.match(/WORLD_LAND_PATH\s*=\s*["']([^"']+)["']/);
    if (m) worldLandPath = m[1];
  } catch (e) {
    console.warn('sin world-land.js:', e.message);
  }
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
