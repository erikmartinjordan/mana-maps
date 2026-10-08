#!/usr/bin/env node
// ── gen-daily-steps-world.js ─
// Genera data/daily-steps-world.geojson: coropleta mundial del número medio de
// pasos diarios por país.
//
// Fuente autoritativa (AGENTS.md §1 y §6):
//   Althoff, T. et al. (2017) «Large-scale physical activity data reveal
//   worldwide activity inequality», Nature 547, 336–339.
//   DOI: https://doi.org/10.1038/nature23018
//   Valores de la Supplementary Table 1 (media de pasos/día por país,
//   46 países con ≥1.000 participantes; datos de sensores de smartphone,
//   app Argus/Azumio; publicado en 2017).
//
// Geometrías (AGENTS.md §2): se reutilizan las geometrías oficiales ya
// recortadas y simplificadas de data/gdp-per-capita-world.geojson (Natural
// Earth, recorte con shapely + simplify preserve_topology) y se añade Hong
// Kong desde Natural Earth 10m (ne_10m_admin_0_countries, ISO HKG), que la
// base 110m no incluye y es el país con más pasos del estudio.
//
// Cobertura real: 46 países del estudio; 45 se renderizan (Hong Kong con
// geometría NE 10m propia). El resto del mundo queda en gris «Sin datos».
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const BASE_GEO = path.join(ROOT, 'data', 'gdp-per-capita-world.geojson');
const OUT_GEO = path.join(ROOT, 'data', 'daily-steps-world.geojson');
const NE10M_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
const NE10M_CACHE = path.join(require('os').tmpdir(), 'ne10m-admin0-countries.geojson');

const DATA_YEAR = '2017';
const SOURCE_SHORT = 'Althoff et al. (2017), Nature — pasos diarios medidos con smartphone (app Argus)';

// Supplementary Table 1 (Nature 547:336–339,2017): país → media de pasos/día.
const STEPS = [
  ['Hong Kong SAR China', 6880], ['China', 6189], ['Ukraine', 6107], ['Japan', 6010],
  ['Russia', 5969], ['Spain', 5936], ['Sweden', 5863], ['South Korea', 5755],
  ['Singapore', 5674], ['Switzerland', 5512], ['Czech Republic', 5508], ['United Kingdom', 5444],
  ['Denmark', 5263], ['Hungary', 5258], ['Norway', 5246], ['Germany', 5205],
  ['Finland', 5204], ['Chile', 5204], ['France', 5141], ['Netherlands', 5110],
  ['Italy', 5296], ['Ireland', 5293], ['Poland', 5249], ['Turkey', 5057],
  ['Israel', 5033], ['Taiwan', 5000], ['Belgium', 4978], ['Australia', 4941],
  ['Canada', 4819], ['Thailand', 4764], ['Romania', 4759], ['Portugal', 4744],
  ['United States', 4774], ['Mexico', 4692], ['United Arab Emirates', 4516],
  ['New Zealand', 4582], ['Greece', 4350], ['Egypt', 4315], ['India', 4297],
  ['Brazil', 4289], ['South Africa', 4105], ['Qatar', 4158], ['Philippines', 4008],
  ['Malaysia', 3963], ['Saudi Arabia', 3807], ['Indonesia', 3513]
];

// Ajuste de nombres del estudio → nombres EN de la base de geometrías.
const EN_FIX = {
  'United States': 'United States of America',
  'Czech Republic': 'Czechia',
  'Hong Kong SAR China': 'Hong Kong'
};

// Rampas secuenciales monocromáticas (ColorBrewer «Purples», claro→oscuro).
// Sin arcoíris: un único tono violeta, borde blanco fino (AGENTS.md §3).
const RAMP = ['#efedf5', '#dadaeb', '#bcbddc', '#9e9ac8', '#6a51a3', '#54278f'];
const NO_DATA_COLOR = '#d9d9d9';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpsGet(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

// Douglas–Peucker (tolerance en grados) + redondeo a2 decimales.
function simplifyLine(points, tol) {
  if (points.length <= 2) return points.map(p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
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
  return points.filter((_, i) => keep[i]).map(p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return Math.abs(a / 2);
}

async function loadHongKongGeometry() {
  let src;
  if (fs.existsSync(NE10M_CACHE)) {
    src = fs.readFileSync(NE10M_CACHE, 'utf8');
  } else {
    console.log('Descargando Natural Earth 10m (una vez, se cachea en /tmp)...');
    src = await httpsGet(NE10M_URL);
    fs.writeFileSync(NE10M_CACHE, src);
  }
  const ne = JSON.parse(src);
  const f = ne.features.find(x => x.properties && x.properties.ISO_A3 === 'HKG');
  if (!f) throw new Error('HKG no encontrado en Natural Earth 10m');
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  // Descartar partes pequeñas (< 2 % de la mayor) para evitar ruido/etiquetas
  // duplicadas, y simplificar cada anillo.
  const parts = polys.map(poly => poly.map(r => simplifyLine(r, 0.012)));
  const areas = parts.map(p => ringArea(p[0]));
  const maxArea = Math.max(...areas);
  const kept = parts.filter((_, i) => areas[i] >= maxArea * 0.02);
  return kept.length === 1
    ? { type: 'Polygon', coordinates: kept[0] }
    : { type: 'MultiPolygon', coordinates: kept };
}

function fmtSteps(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function labelStyle() {
  return {
    enabled: true, fontSize: 11, fontFamily: 'DM Sans, sans-serif', fontWeight: '600',
    color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF', placement: 'point', field: '_manaName'
  };
}

async function main() {
  const base = JSON.parse(fs.readFileSync(BASE_GEO, 'utf8'));
  const hkGeometry = await loadHongKongGeometry();

  const stepsByEn = new Map();
  for (const [en, v] of STEPS) stepsByEn.set(EN_FIX[en] || en, v);

  // Bins por cuantiles sobre los46 valores del estudio (incluye Hong Kong).
  const sortedVals = STEPS.map(s => s[1]).slice().sort((a, b) => a - b);
  const nBins = RAMP.length;
  const binThresholds = [];
  for (let b = 1; b < nBins; b++) {
    binThresholds.push(sortedVals[Math.floor((b / nBins) * sortedVals.length) - 1]);
  }
  function colorFor(v) {
    let i = 0;
    while (i < binThresholds.length && v > binThresholds[i]) i++;
    return RAMP[i];
  }

  const matched = new Set();
  const features = [];

  for (const f of base.features) {
    const p = f.properties;
    const en = p['País (EN)'];
    const hasData = stepsByEn.has(en);
    const props = {
      _manaName: p._manaName,
      name: en,
      _manaColor: hasData ? colorFor(stepsByEn.get(en)) : NO_DATA_COLOR,
      _manaFillOpacity: hasData ? 0.82 : 0.45,
      _manaWeight: 0.7,
      _manaBorderColor: '#FFFFFF',
      _manaGroupName: 'Pasos diarios',
      _manaGroupId: 'daily-steps',
      _manaLabelStyle: labelStyle(),
      'País': p._manaName,
      'País (EN)': en,
      'Continente': p.Continente,
      'Pasos diarios': hasData ? fmtSteps(stepsByEn.get(en)) + ' pasos' : 'Sin datos',
      'Pasos diarios (num)': hasData ? stepsByEn.get(en) : null,
      'Año de datos': hasData ? DATA_YEAR : 'Sin datos',
      'Fuente': SOURCE_SHORT,
      'Description': hasData
        ? `${p._manaName} — ${fmtSteps(stepsByEn.get(en))} pasos de media al día (${DATA_YEAR}) — ${p.Continente}`
        : `${p._manaName} — sin datos de pasos diarios — ${p.Continente}`,
      'Superficie': p.Continente,
      'Dato': hasData ? fmtSteps(stepsByEn.get(en)) : 'Sin datos'
    };
    features.push({ type: 'Feature', properties: props, geometry: f.geometry });
    if (hasData) matched.add(en);
  }

  // Hong Kong (NE 10m): el estudio lo sitúa en primer lugar con 6.880 pasos.
  const hkSteps = stepsByEn.get('Hong Kong');
  features.push({
    type: 'Feature',
    properties: {
      _manaName: 'Hong Kong',
      name: 'Hong Kong',
      _manaColor: colorFor(hkSteps),
      _manaFillOpacity: 0.82,
      _manaWeight: 0.7,
      _manaBorderColor: '#FFFFFF',
      _manaGroupName: 'Pasos diarios',
      _manaGroupId: 'daily-steps',
      _manaLabelStyle: labelStyle(),
      'País': 'Hong Kong',
      'País (EN)': 'Hong Kong',
      'Continente': 'Asia',
      'Pasos diarios': fmtSteps(hkSteps) + ' pasos',
      'Pasos diarios (num)': hkSteps,
      'Año de datos': DATA_YEAR,
      'Fuente': SOURCE_SHORT,
      'Description': `Hong Kong — ${fmtSteps(hkSteps)} pasos de media al día (${DATA_YEAR}) — Asia`,
      'Superficie': 'Asia',
      'Dato': fmtSteps(hkSteps)
    },
    geometry: hkGeometry
  });
  matched.add('Hong Kong');

  const missing = STEPS.map(s => EN_FIX[s[0]] || s[0]).filter(en => !matched.has(en));
  if (missing.length) {
    console.error('ADVERTENCIA: países del estudio sin geometría emparejada:', missing.join(', '));
  }

  const geo = { type: 'FeatureCollection', features };
  const json = JSON.stringify(geo);
  if (json.length > 1048576) throw new Error('GeoJSON >1 MiB');
  fs.writeFileSync(OUT_GEO, json);

  const withData = features.filter(f => f.properties['Pasos diarios (num)'] != null).length;
  console.log(`OK → ${path.relative(ROOT, OUT_GEO)}`);
  console.log(`features: ${features.length} | con datos: ${withData} | sin datos: ${features.length - withData}`);
  console.log(`KB: ${(json.length / 1024).toFixed(1)}`);
  console.log(`ramp bins (umbrales): [${binThresholds.join(', ')}] → ${RAMP.join(' ')}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
