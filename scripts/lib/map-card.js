#!/usr/bin/env node
// map-card.js — Renderizador de tarjetas OG (1200x630) y silueta de tierra.
// Módulo compartido por scripts/generate-map-landings.js y los generadores de tarjetas OG.
// El diseño replica la tarjeta social de la home: fondo #080909, acento dorado,
// DM Sans, logo de marca y mapa en un panel a la derecha.
'use strict';

const fs = require('fs');
const path = require('path');

// Proyeccion: Web Mercator
const MAX_LAT = 85.051129;
function mercX(lon) {
  return lon * Math.PI / 180;
}
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

// Logo vectorial de marca: blob oscuro + M̃ + wordmark (mismo que la web).
const LOGO_BLOB = 'M42.3,-74.7C55.1,-65.8,66.1,-55.2,74.7,-42.4C83.2,-29.7,89.3,-14.8,89.7,0.2C90,15.2,84.6,30.5,74.3,40.2C64,49.8,48.7,54,35.6,62.1C22.4,70.2,11.2,82.3,-0.8,83.6C-12.7,84.9,-25.4,75.4,-36.1,65.9C-46.9,56.4,-55.6,46.8,-61.3,35.8C-66.9,24.8,-69.5,12.4,-72,-1.4C-74.5,-15.3,-76.9,-30.5,-70.9,-41C-64.9,-51.4,-50.6,-57.1,-37.4,-65.8C-24.2,-74.5,-12.1,-86.1,1.3,-88.4C14.7,-90.7,29.5,-83.6,42.3,-74.7Z';
const LOGO_M = '<g transform="translate(62.7889 133.0811) scale(0.04069010 -0.04069010)"><path fill="#fff" d="M1675 0H1303V987L1032 350H777L506 987V0H154V1489H585L915 754L1244 1489H1675Z"/><path fill="#fff" transform="translate(1530 -40)" d="M-186 2061Q-196 1894 -269.0 1816.5Q-342 1739 -472 1739Q-520 1739 -563.0 1758.5Q-606 1778 -637 1797Q-667 1816 -703.5 1835.5Q-740 1855 -765 1855Q-815 1855 -833.0 1823.5Q-851 1792 -855 1733H-1065Q-1059 1879 -983.0 1966.5Q-907 2054 -780 2054Q-732 2054 -691.0 2037.0Q-650 2020 -612 1998Q-582 1981 -546.0 1962.0Q-510 1943 -487 1943Q-439 1943 -418.5 1975.0Q-398 2007 -396 2061Z"/></g>';
const LOGO_SVG = '<svg class="mark" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#30363B" stroke="rgba(255,255,255,0.10)" stroke-width="1" d="' + LOGO_BLOB + '" transform="translate(100 100)"/>' + LOGO_M + '</svg>';

const CARD_W = 1200;
const CARD_H = 630;
const MAP_W = 584;
const MAP_H = 400;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Construye el SVG del mapa con fondo transparente para el panel de la tarjeta.
// Mantiene la proporción real (sin deformar) y centra el encuadre.
function buildMapSVG(geo, worldLandPath, opts) {
  const options = opts || {};
  const W = Number(options.width) || MAP_W;
  const H = Number(options.height) || MAP_H;
  const pad = Number.isFinite(options.pad) ? options.pad : 16;

  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
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
        if (x < lonMin) lonMin = x;
        if (x > lonMax) lonMax = x;
        if (y < latMin) latMin = y;
        if (y > latMax) latMax = y;
      }
    }
  }
  if (lonMin === Infinity) { lonMin = -180; lonMax = 180; latMin = -60; latMax = 85; }

  // Mapas mundiales: encuadre global estable (evita bandas finas cuando los
  // puntos se concentran en latitudes medias). Mapas locales: encuadre al dato
  // con un mínimo de contexto geográfico para que se reconozca el territorio.
  const isWorld = (lonMax - lonMin) >= 90 || (latMax - latMin) >= 50;
  if (isWorld) {
    lonMin = -180; lonMax = 180; latMin = -60; latMax = 85;
  } else {
    const lonPad = Math.max(0.05, (lonMax - lonMin) * 0.08);
    const latPad = Math.max(0.04, (latMax - latMin) * 0.10);
    lonMin -= lonPad; lonMax += lonPad; latMin -= latPad; latMax += latPad;
    lonMin = Math.max(-180, lonMin); lonMax = Math.min(180, lonMax);
    latMin = Math.max(-85, latMin); latMax = Math.min(85, latMax);
  }

  const minX = mercX(lonMin), maxX = mercX(lonMax);
  const minY = mercY(latMin), maxY = mercY(latMax);
  const spanX = maxX - minX, spanY = maxY - minY;

  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const mapW = spanX * scale;
  const mapH = spanY * scale;
  const offX = (W - mapW) / 2;
  const offY = (H - mapH) / 2;

  const tx = (mx) => offX + (mx - minX) * scale;
  const ty = (my) => offY + (maxY - my) * scale;

  function ringPath(ring) {
    const coords = ring.map(([x, y]) => tx(mercX(x)).toFixed(1) + ',' + ty(mercY(y)).toFixed(1));
    return 'M' + coords.join('L') + 'Z';
  }

  let land = '';
  if (worldLandPath) {
    const A = scale * (Math.PI / 180) / 10000;
    const C = -scale / 10000;
    const B = offX - minX * scale;
    const D = offY + maxY * scale;
    const landFill = isWorld ? '#161d24' : 'none';
    const landStroke = isWorld ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.16)';
    const landStrokeW = isWorld ? 0.8 : 1.1;
    land = '<path d="' + worldLandPath + '" fill="' + landFill + '" stroke="' + landStroke + '" stroke-width="' + landStrokeW + '" transform="matrix(' +
      A.toFixed(10) + ' 0 0 ' + C.toFixed(10) + ' ' + B.toFixed(10) + ' ' + D.toFixed(10) + ')"/>';
  }

  let grat = '';
  for (let lon = Math.ceil(lonMin / 30) * 30; lon <= lonMax; lon += 30) {
    const gx = tx(mercX(lon));
    if (gx > -2 && gx < W + 2) grat += 'M' + gx.toFixed(1) + ' ' + ty(mercY(Math.max(latMin, -80))).toFixed(1) + ' L' + gx.toFixed(1) + ' ' + ty(mercY(Math.min(latMax, 80))).toFixed(1);
  }
  for (let lat = Math.ceil(latMin / 15) * 15; lat <= latMax; lat += 15) {
    const gy = ty(mercY(lat));
    if (gy > -2 && gy < H + 2) grat += 'M' + tx(mercX(Math.max(lonMin, -170))).toFixed(1) + ' ' + gy.toFixed(1) + ' L' + tx(mercX(Math.min(lonMax, 170))).toFixed(1) + ' ' + gy.toFixed(1);
  }
  const gratSvg = grat ? '<path d="' + grat + '" fill="none" stroke="rgba(255,255,255,0.055)" stroke-width="1"/>' : '';

  let paths = '';
  let bounds = 0;
  for (const f of (geo && geo.features) || []) {
    const color = (f.properties && (f.properties._manaColor || f.properties.color)) || '#e8b86d';
    const weight = Number((f.properties && f.properties._manaWeight) || 2.5);
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Point' || g.type === 'MultiPoint') {
      const pts = g.type === 'Point' ? [g.coordinates] : g.coordinates;
      const emojiSize = Number(f.properties && f.properties._manaEmojiSize);
      const radius = Number.isFinite(emojiSize) && emojiSize > 0
        ? Math.max(3, Math.min(10, emojiSize / 7))
        : (weight * 1.6 + 2);
      for (const [x, y] of pts) {
        if (typeof x !== 'number' || typeof y !== 'number') continue;
        paths += '<circle cx="' + tx(mercX(x)).toFixed(1) + '" cy="' + ty(mercY(y)).toFixed(1) + '" r="' + radius.toFixed(1) + '" fill="' + color + '" stroke="rgba(255,255,255,0.85)" stroke-width="1.4"/>';
        bounds++;
      }
      continue;
    }
    if (g.type === 'LineString') {
      const coords = g.coordinates.map(([x, y]) => tx(mercX(x)).toFixed(1) + ',' + ty(mercY(y)).toFixed(1));
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
      paths += '<path d="' + ringPath(ring) + '" fill="' + color + '" fill-opacity="0.94" stroke="rgba(255,255,255,0.22)" stroke-width="0.7" stroke-linejoin="round"/>';
      bounds++;
    }
  }

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    gratSvg + land + paths + '</svg>';
  return { svg, count: bounds };
}

function brandHTML() {
  return '<div class="brand">' + LOGO_SVG + '<span class="brand-word">Maña<span class="brand-sub">Maps</span></span></div>';
}

// Ajusta el titular para que casi todos los títulos ocupen 2-3 líneas.
function fitTitleSize(title) {
  const n = Array.from(String(title || '')).length;
  if (n <= 22) return 66;
  if (n <= 30) return 60;
  if (n <= 40) return 54;
  if (n <= 52) return 48;
  if (n <= 62) return 44;
  return 40;
}

// Resumen legible de la fuente para una tarjeta social (evita citas completas).
function shortSource(value) {
  let s = String(value || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.split(/\s+[—–]\s+/)[0];
  s = s.split(/\.\s+https?:\/\//i)[0];
  s = s.split(/\s+https?:\/\//i)[0];
  s = s.replace(/\s*\((?:[A-Z0-9]{2,}[._][A-Z0-9._]+)\)\s*/g, ' ');
  s = s.replace(/\s*\((?:consultado|consulta|actualizada|actualizado|descarga)[^)]*\)\s*/gi, ' ');
  s = s.replace(/\s{2,}/g, ' ').replace(/\s+([,;:.])/g, '$1').trim();
  if (s.length > 115) {
    const sentence = s.match(/^(.{50,}?[.!?])(?:\s|$)/);
    if (sentence) s = sentence[1];
  }
  if (s.length > 115) {
    const colon = s.indexOf(': ');
    if (colon > 24) {
      s = s.slice(0, colon);
    } else {
      const cut = s.slice(0, 112);
      const space = cut.lastIndexOf(' ');
      s = (space > 70 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '…';
    }
  }
  return s;
}

function shortDescription(value) {
  let s = String(value || '').replace(/\s+/g, ' ').trim();
  if (s.length > 130) {
    const sentence = s.match(/^(.{60,}?[.!?])(?:\s|$)/);
    if (sentence) s = sentence[1];
  }
  if (s.length > 130) {
    const colon = s.indexOf(': ');
    if (colon > 70) s = s.slice(0, colon).replace(/[\s,;:.]+$/, '') + '.';
  }
  if (s.length > 165) {
    const cut = s.slice(0, 162);
    const space = cut.lastIndexOf(' ');
    s = (space > 100 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '…';
  }
  return s;
}

// Página 1200x630 lista para screenshot (tarjeta OG).
function renderSvgPage(map, mapSVG) {
  const title = map.title || map.name || 'Mapa';
  const description = shortDescription(map.description);
  const source = shortSource(map.source);
  const titleSize = fitTitleSize(title);
  const leadSize = description.length > 150 ? 17 : description.length > 115 ? 18 : 19;

  const count = Number(map.featureCount);
  const chips = [];
  if (Number.isFinite(count) && count > 0) {
    chips.push(count.toLocaleString('es-ES') + (count === 1 ? ' elemento' : ' elementos'));
  }
  chips.push('Interactivo', 'Gratis');
  const chipsHTML = chips.map((c) => '<span class="chip">' + esc(c) + '</span>').join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0;width:${CARD_W}px;height:${CARD_H}px;background:#080909;overflow:hidden;
    font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
  .card{position:relative;width:${CARD_W}px;height:${CARD_H}px;overflow:hidden;background:#080909;color:#f4f4f5}
  .vignette{position:absolute;inset:0;z-index:1;background:
    radial-gradient(1100px 700px at 80% 42%, rgba(232,184,109,.13), transparent 62%),
    radial-gradient(900px 600px at 8% 100%, rgba(255,255,255,.035), transparent 60%),
    linear-gradient(180deg,#0a0b0c 0%,#080909 58%,#060707 100%)}
  .plate-glow{position:absolute;right:-50px;top:60px;width:760px;height:540px;z-index:1;
    background:radial-gradient(circle at 55% 50%, rgba(232,184,109,.17), transparent 68%);filter:blur(16px)}
  .plate{position:absolute;right:36px;top:118px;width:${MAP_W}px;height:${MAP_H}px;z-index:2;overflow:hidden;
    border-radius:24px;border:1px solid rgba(255,255,255,.12);
    background:linear-gradient(180deg,#0c1014 0%,#0a0c0e 100%);
    box-shadow:0 30px 80px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.04)}
  .plate svg{width:${MAP_W}px;height:${MAP_H}px;display:block}
  .brand{position:absolute;left:60px;top:52px;z-index:5;display:flex;align-items:center;gap:12px}
  .brand .mark{width:40px;height:40px;flex:none}
  .brand-word{font-size:23px;font-weight:800;letter-spacing:-.025em;line-height:1}
  .brand-sub{font-size:12px;font-weight:600;color:#9ba1a7;vertical-align:super;margin-left:4px;letter-spacing:0}
  .copy{position:absolute;left:60px;top:170px;width:480px;z-index:5}
  .eyebrow{display:inline-flex;align-items:center;gap:9px;margin-bottom:18px;
    font-size:14px;font-weight:600;color:#b6bcc2;letter-spacing:.01em}
  .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#e8b86d;
    box-shadow:0 0 14px rgba(232,184,109,.75)}
  h1{margin:0;font-size:${titleSize}px;line-height:1.02;letter-spacing:-.038em;font-weight:800;
    color:#f4f4f5;overflow-wrap:break-word}
  .lead{margin:16px 0 0;max-width:480px;font-size:${leadSize}px;line-height:1.4;color:#a8aeb4;letter-spacing:-.005em;
    display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .source{margin:12px 0 0;max-width:480px;font-size:13px;line-height:1.4;color:#7f858b;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .foot{position:absolute;left:60px;right:60px;bottom:44px;z-index:6;display:flex;align-items:center;justify-content:space-between}
  .chips{display:flex;align-items:center;gap:8px}
  .chip{font-size:14px;font-weight:500;color:#c3c8cd;border:1px solid rgba(255,255,255,.13);
    border-radius:999px;padding:6px 12px;background:rgba(255,255,255,.02);white-space:nowrap}
  .url{display:inline-flex;align-items:center;gap:8px;font-size:15px;font-weight:600;color:#d9dde1;
    background:rgba(8,9,9,.74);border:1px solid rgba(255,255,255,.14);padding:8px 14px;border-radius:999px;
    backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
  .frame{position:absolute;inset:0;z-index:9;border:1px solid rgba(255,255,255,.07);pointer-events:none}
</style>
</head><body>
  <div class="card">
    <div class="vignette"></div>
    <div class="plate-glow"></div>
    <div class="plate">${mapSVG}</div>
    ${brandHTML()}
    <div class="copy">
      <span class="eyebrow"><i class="dot"></i>Mapa de la galería</span>
      <h1>${esc(title)}</h1>
      ${description ? '<p class="lead">' + esc(description) + '</p>' : ''}
      ${source ? '<p class="source"><span class="label">Fuente:</span> ' + esc(source) + '</p>' : ''}
    </div>
    <div class="foot">
      <div class="chips">${chipsHTML}</div>
      <span class="url"><i class="dot"></i>maña.com</span>
    </div>
    <div class="frame"></div>
  </div>
  <script>document.fonts.ready.then(function(){ window.__renderReady = true; });</script>
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

module.exports = { mercX, mercY, simplifyRing, buildMapSVG, headerHTML: brandHTML, renderSvgPage, loadWorldLandPath };
