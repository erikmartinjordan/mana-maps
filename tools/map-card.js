#!/usr/bin/env node
// map-card.js — Renderizador de tarjetas OG (1200x630) y silueta de tierra.
// Módulo compartido por tools/render-map-images.js y scripts/generate-map-landings.js.
'use strict';

const fs = require('fs');
const path = require('path');

// Proyeccion: Web Mercator
const MAX_LAT = 85.051129;
function mercY(lat) {
  const c = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + c / 2));
}

// Escala un anillo de coords (simplificacion por saltos de puntos cercanos)
function simplifyRing(ring, tol) {
  if (ring.length <= 3) return ring;
  const res = ring.slice();
  const out = [res[0]];
  for (let i = 1; i < res.length; i++) {
    const [x1, y1] = out[out.length - 1];
    const [x2, y2] = res[i];
    if (Math.abs(x2 - x1) + Math.abs(y2 - y1) > tol) out.push(res[i]);
  }
  return out;
}

// Construye el SVG del mapa (1200x630) con fondo de tierra y graticule.
function buildMapSVG(geo, worldLandPath) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of (geo && geo.features) || []) {
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
  const dx = (maxX - minX) * 0.02, dy = (maxY - minY) * 0.06;
  minX -= dx; maxX += dx; minY -= dy; maxY += dy;
  const spanX = maxX - minX, spanY = maxY - minY;

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

  let land = '';
  if (worldLandPath) {
    const A = scaleX / 10000;
    const C = -scaleY / 10000;
    const B = offX - (minX * 10000) * A;
    const D = offY + (maxY * 10000) * C;
    land = '<path d="' + worldLandPath + '" fill="#1c2833" stroke="#2c3e50" stroke-width="0.6" transform="matrix(' +
      A.toFixed(10) + ' 0 0 ' + C.toFixed(10) + ' ' + B.toFixed(10) + ' ' + D.toFixed(10) + ')"/>';
  }

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
  for (const f of (geo && geo.features) || []) {
    const color = (f.properties && (f.properties._manaColor || f.properties.color)) || '#4ade80';
    const weight = Number((f.properties && f.properties._manaWeight) || 2.5);
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Point' || g.type === 'MultiPoint') {
      const pts = g.type === 'Point' ? [g.coordinates] : g.coordinates;
      for (const [x, y] of pts) {
        if (typeof x !== 'number' || typeof y !== 'number') continue;
        paths += '<circle cx="' + tx(x).toFixed(1) + '" cy="' + ty(mercY(y)).toFixed(1) + '" r="' + (weight * 1.6 + 2).toFixed(1) + '" fill="' + color + '" stroke="rgba(255,255,255,0.85)" stroke-width="1.4"/>';
        bounds++;
      }
      continue;
    }
    if (g.type === 'LineString') {
      const coords = g.coordinates.map(([x, y]) => tx(x).toFixed(1) + ',' + ty(mercY(y)).toFixed(1));
      if (coords.length < 2) continue;
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

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<defs><linearGradient id="ocean" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1b2a"/><stop offset="1" stop-color="#1b263b"/></linearGradient></defs>' +
    '<rect width="' + W + '" height="' + H + '" fill="url(#ocean)"/>' + land + gratSvg + paths + '</svg>';
  return { svg, count: bounds };
}

function headerHTML() {
  return `
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style="width:44px;height:44px">
      <path fill="#6fb7ff" d="M42.3,-74.7C55.1,-65.8,66.1,-55.2,74.7,-42.4C83.2,-29.7,89.3,-14.8,89.7,0.2C90,15.2,84.6,30.5,74.3,40.2C64,49.8,48.7,54,35.6,62.1C22.4,70.2,11.2,82.3,-0.8,83.6C-12.7,84.9,-25.4,75.4,-36.1,65.9C-46.9,56.4,-55.6,46.8,-61.3,35.8C-66.9,24.8,-69.5,12.4,-72,-1.4C-74.5,-15.3,-76.9,-30.5,-70.9,-41C-64.9,-51.4,-50.6,-57.1,-37.4,-65.8C-24.2,-74.5,-12.1,-86.1,1.3,-88.4C14.7,-90.7,29.5,-83.6,42.3,-74.7Z" transform="translate(100 100)"/>
    </svg>
    <span style="font-size:18px;font-weight:900;color:#fff;letter-spacing:-.5px">maña.com</span>`;
}

// Página 1200x630 lista para screenshot (tarjeta OG).
function renderSvgPage(map, mapSVG) {
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
  <div id="title"><h1>${String(title).replace(/</g, '&lt;')}</h1><p>${String(subtitle).replace(/</g, '&lt;')}</p></div>
  <script>window.__MAP_SVG = ${JSON.stringify(mapSVG)};</script>
  <script>
    document.getElementById('map').innerHTML = window.__MAP_SVG;
    window.__renderReady = true;
  </script>
</body></html>`;
}

// Carga el path canónico de tierra (lon*10000, mercY*10000).
function loadWorldLandPath(root) {
  try {
    const wl = fs.readFileSync(path.join(root || process.cwd(), 'js/world-land.js'), 'utf8');
    const m = wl.match(/WORLD_LAND_PATH\s*=\s*["']([^"']+)["']/);
    if (m) return m[1];
  } catch (e) {}
  return null;
}

module.exports = { mercY, simplifyRing, buildMapSVG, headerHTML, renderSvgPage, loadWorldLandPath };
