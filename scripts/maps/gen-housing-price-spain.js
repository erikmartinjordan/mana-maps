#!/usr/bin/env node
// ── gen-housing-price-spain.js ─
// Genera data/maps/housing-price-spain.geojson:
//   coropleta provincial «El precio de la vivienda por provincia» (España).
//
// Datos: data/sources/housing-price-spain/provincias.json
//   (Ministerio de Vivienda y Agenda Urbana — Estadística de Valor Tasado de
//    la Vivienda, ETDP; Boletín estadístico Tabla 1, 2026 T2).
// Geometría: data/sources/housing-price-spain/nuts3-es-2021.geojson
//   (Eurostat GISCO NUTS-3 2021, escala 1:3M, EPSG:4326). Las 7 NUTS-3 de
//   Canarias se agrupan en sus 2 provincias y las 3 de Baleares en una.
//   Recorte + simplificación Douglas–Peucker (preserve topology por
//   construcción: solo se eliminan vértices intermedios) y descarte de islas
//   menores de 0,0005°² (~5 km²).
//
// Rampa §3 AGENTS.md: secuencial monocromática terracota (tono 20°), 9 pasos,
//   ordenada por el dato de claro→oscuro. Borde blanco fino.
//
// Uso: node scripts/maps/gen-housing-price-spain.js
'use strict';
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC_DATA = path.join(ROOT, 'data', 'sources', 'housing-price-spain', 'provincias.json');
const SRC_GEOM = path.join(ROOT, 'data', 'sources', 'housing-price-spain', 'nuts3-es-2021.geojson');
const OUT = path.join(ROOT, 'data', 'maps', 'housing-price-spain.geojson');

const GROUP_NAME = 'Precio de la vivienda';
const GROUP_ID = 'vivienda';
const NUM_KEY = 'Precio (€/m²)';
const HUE = 20;            // terracota (ladrillo/vivienda); rampa mono §3
const RAMP_STEPS = 9;
const SIMPLIFY_TOLERANCE = 0.008; // grados (~0,9 km); 1:3M ya viene simplificado
const MIN_PART_AREA = 0.0005;     // grados² (~5 km²): descarta islotes

const PERIOD_LABEL = '2026, segundo trimestre';

// ── Helpers de color (mismos parámetros que buildMonoRamp del auditor) ──
function hslToHex(h, s, l) {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const hx = n => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}
function buildMonoRamp(hue, steps) {
  const ramp = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    ramp.push(hslToHex(hue, 48 + t * 28, 92 - t * 72)); // l 92%→20%, s 48%→76%
  }
  return ramp;
}

// Douglas–Peucker (tolerancia en grados) + redondeo a 3 decimales (~100 m).
function simplifyLine(points, tol) {
  if (points.length <= 2) return points.map(p => [round3(p[0]), round3(p[1])]);
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxDist = -1, idx = -1;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((points[i][0] - ax) * dx + (points[i][1] - ay) * dy) / len2));
      const px = ax + t * dx, py = ay + t * dy;
      const d = (points[i][0] - px) ** 2 + (points[i][1] - py) ** 2;
      if (d > maxDist) { maxDist = d; idx = i; }
    }
    if (maxDist > tol * tol && idx > 0) { keep[idx] = true; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]).map(p => [round3(p[0]), round3(p[1])]);
}
const round3 = n => Math.round(n * 1000) / 1000;

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return Math.abs(a / 2);
}

// Une los polígonos de las NUTS-3 de una provincia en un MultiPolygon
// simplificado. Conserva los huecos (anillos 2..n) de cada polígono.
function mergeProvinceGeometry(polys) {
  const parts = [];
  for (const poly of polys) {
    const simplified = poly.map((ring, i) => simplifyLine(ring, i === 0 ? SIMPLIFY_TOLERANCE : SIMPLIFY_TOLERANCE / 2));
    const outer = simplified[0];
    if (!outer || outer.length < 4) continue;
    if (ringArea(outer) < MIN_PART_AREA) continue;
    // Anillos cerrados: garantiza el cierre tras simplificar.
    const closed = simplified.map(r => {
      if (!r.length) return r;
      const first = r[0], last = r[r.length - 1];
      return (first[0] === last[0] && first[1] === last[1]) ? r : r.concat([[first[0], first[1]]]);
    });
    if (closed[0].length < 4) continue;
    parts.push(closed);
  }
  return parts.length === 1
    ? { type: 'Polygon', coordinates: parts[0] }
    : { type: 'MultiPolygon', coordinates: parts };
}

// Formato español con separador de miles aunque el número tenga 4 dígitos
// (es-ES no agrupa por defecto hasta 5 dígitos): 4089,6 → «4.089,6».
const fmtNum = (n, dec = 1) => {
  const [ent, frac] = n.toFixed(dec).split('.');
  const grouped = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec > 0 ? `${grouped},${frac}` : grouped;
};
const fmtSigned = n => `${n >= 0 ? '+' : ''}${fmtNum(n)} %`;

function labelStyle() {
  return {
    enabled: true, fontSize: 12, fontFamily: 'DM Sans, sans-serif',
    fontWeight: '600', color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF',
    placement: 'point', field: '_manaName',
  };
}

function main() {
  if (!fs.existsSync(SRC_DATA)) { console.error('ERROR: falta', SRC_DATA); process.exit(1); }
  if (!fs.existsSync(SRC_GEOM)) { console.error('ERROR: falta', SRC_GEOM); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(SRC_DATA, 'utf8'));
  const geo = JSON.parse(fs.readFileSync(SRC_GEOM, 'utf8'));
  const records = data.provinces;
  if (records.length !== 52) { console.error(`ERROR: se esperaban 52 provincias, hay ${records.length}`); process.exit(1); }

  const byNuts = new Map();
  for (const f of geo.features) {
    const id = f.properties && f.properties.NUTS_ID;
    if (id) byNuts.set(id, f);
  }

  const values = records.map(r => r.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  const ramp = buildMonoRamp(HUE, RAMP_STEPS);

  const features = [];
  const used = new Set();
  for (const rec of records) {
    const missing = rec.nuts.filter(n => !byNuts.has(n));
    if (missing.length) { console.error(`ERROR: NUTS ausentes para ${rec.name}: ${missing.join(', ')}`); process.exit(1); }
    const polys = [];
    for (const n of rec.nuts) {
      const g = byNuts.get(n).geometry;
      if (g.type === 'Polygon') polys.push(g.coordinates);
      else if (g.type === 'MultiPolygon') polys.push(...g.coordinates);
      used.add(n);
    }
    const geometry = mergeProvinceGeometry(polys);
    const t = hi === lo ? 1 : (rec.value - lo) / (hi - lo);
    const step = Math.max(0, Math.min(RAMP_STEPS - 1, Math.round(t * (RAMP_STEPS - 1))));
    const value = Math.round(rec.value * 10) / 10;
    const variation = rec.variation == null ? null : Math.round(rec.variation * 10) / 10;
    const props = {
      _manaName: rec.name,
      name: rec.name,
      _manaGroupName: GROUP_NAME,
      _manaGroupId: GROUP_ID,
      _manaLabelStyle: labelStyle(),
      _manaColor: ramp[step],
      _manaFillOpacity: 0.85,
      _manaWeight: 0.6,
      _manaBorderColor: '#FFFFFF',
      'Provincia': rec.name,
      'Comunidad autónoma': rec.ccaa,
      'Código': rec.code,
      [NUM_KEY]: value,
      'Variación anual (%)': variation,
      'Periodo': PERIOD_LABEL,
      'Dato': `${fmtNum(value)} €/m² · ${variation == null ? 'sin variación publicada' : fmtSigned(variation) + ' anual'}`,
      'Description': `${rec.name} — ${fmtNum(value)} €/m² de valor tasado medio de vivienda libre (${PERIOD_LABEL})${variation == null ? '' : `, ${fmtSigned(variation)} anual`}. Fuente: Ministerio de Vivienda y Agenda Urbana (ETDP).`,
    };
    features.push({ type: 'Feature', properties: props, geometry });
  }

  const orphans = geo.features.filter(f => !used.has(f.properties.NUTS_ID));
  if (orphans.length) console.warn('WARN: NUTS sin provincia asignada:', orphans.map(f => f.properties.NUTS_ID).join(', '));

  const out = { type: 'FeatureCollection', features };
  const text = JSON.stringify(out);

  // ── Validaciones (AGENTS.md §6) ──
  const hexOk = features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = features.every(f => f.properties._manaLabelStyle.haloWidth >= 2 && f.properties._manaLabelStyle.enabled === true);
  let coordsOk = true;
  const walk = c => {
    if (typeof c[0] === 'number') {
      if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) coordsOk = false;
    } else c.forEach(walk);
  };
  features.forEach(f => walk(f.geometry.coordinates));
  const names = new Set(features.map(f => f.properties._manaName));
  const withData = features.filter(f => Number.isFinite(Number(f.properties[NUM_KEY]))).length;

  function hexToLum(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const pairs = features.map(f => ({ v: Number(f.properties[NUM_KEY]), l: hexToLum(f.properties._manaColor) }));
  const rank = a => {
    const s = a.map((x, i) => ({ x, i })).sort((p, q) => p.x - q.x);
    const r = new Array(a.length);
    let i = 0;
    while (i < s.length) {
      let j = i;
      while (j + 1 < s.length && s[j + 1].x === s[i].x) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[s[k].i] = avg;
      i = j + 1;
    }
    return r;
  };
  const rv = rank(pairs.map(p => p.v)), rl = rank(pairs.map(p => p.l));
  const n = rv.length, mean = a => a.reduce((x, y) => x + y, 0) / n;
  const mv = mean(rv), ml = mean(rl);
  let num = 0, dv = 0, dl = 0;
  for (let i = 0; i < n; i++) {
    num += (rv[i] - mv) * (rl[i] - ml);
    dv += (rv[i] - mv) ** 2; dl += (rl[i] - ml) ** 2;
  }
  const rho = (dv && dl) ? num / Math.sqrt(dv * dl) : 0;
  const hueOf = hex => {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return h * 360;
  };
  const hs = features.map(f => hueOf(f.properties._manaColor)).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < hs.length - 1; i++) maxGap = Math.max(maxGap, hs[i + 1] - hs[i]);
  maxGap = Math.max(maxGap, (hs[0] + 360) - hs[hs.length - 1]);
  const hueSpan = 360 - maxGap;

  console.log(`features: ${features.length} | con datos: ${withData} | KB: ${(text.length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | coords: ${coordsOk} | uniqueNames: ${names.size === features.length}`);
  console.log(`§3 rho(valor,luminancia)=${rho.toFixed(3)} (≤ -0.65 OK) | span tono=${hueSpan.toFixed(1)}° (≤ 60 OK)`);
  console.log(`top 5: ${features
    .slice()
    .sort((a, b) => b.properties[NUM_KEY] - a.properties[NUM_KEY])
    .slice(0, 5)
    .map(f => `${f.properties._manaName} ${fmtNum(f.properties[NUM_KEY])}`)
    .join(' | ')}`);
  console.log(`bottom 3: ${features
    .slice()
    .sort((a, b) => a.properties[NUM_KEY] - b.properties[NUM_KEY])
    .slice(0, 3)
    .map(f => `${f.properties._manaName} ${fmtNum(f.properties[NUM_KEY])}`)
    .join(' | ')}`);

  const ok = hexOk && haloOk && coordsOk && names.size === features.length &&
    withData === features.length && rho <= -0.65 && hueSpan <= 60 && text.length <= 1048576;
  if (!ok) { console.error('VALIDATION FAILED'); process.exit(1); }

  fs.writeFileSync(OUT, text, 'utf8');
  console.log('OK →', OUT);
}

main();
