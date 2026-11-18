#!/usr/bin/env node
// ── gen-co2-per-capita-world.js ─
// Genera data/maps/co2-per-capita-world.geojson para el mapa
// «Emisiones de CO2 per cápita por país».
//
// Reutiliza las 205 geometrías y las cifras del hermano
// co2-total-emissions-world.geojson (Natural Earth 110m/50m + Global Carbon
// Project / Our World in Data, 2024) para que ambos mapas compartan polígonos,
// etiquetas españolas (AGENTS.md §4) y rango de datos. El valor per cápita ya
// viaja en la clave «CO2 per capita (Mt)» de ese GeoJSON.
//
// Rampa secuencial monocromática roja (claro→oscuro) ordenada por el dato y
// asignada por cuantiles (AGENTS.md §3). Los países sin dato van en gris y
// fuera de la rampa.
//
// Uso: node scripts/maps/gen-co2-per-capita-world.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE_SLUG = 'co2-total-emissions-world';
const SRC_PATH = path.join(ROOT, 'data', 'maps', `${SOURCE_SLUG}.geojson`);
const OUT_PATH = path.join(ROOT, 'data', 'maps', 'co2-per-capita-world.geojson');

const DATA_YEAR = 2024;
const GROUP_NAME = 'CO2 per cápita';
const GROUP_ID = 'co2-per-capita';
const LEGEND_KEY = 'Emisiones CO2 per cápita (num)';
const NO_DATA_COLOR = '#d9d9d9';
// Secuencia monocromática roja (ColorBrewer Reds 8), claro → oscuro.
const RAMP = ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#de2d26', '#a50f15', '#67000d'];
const SOURCE_TEXT = 'Global Carbon Project / Our World in Data (2024)';

function fmtEs(n, dec = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Number(n).toFixed(dec);
  const [i, d] = s.split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d ? `${ii},${d}` : ii;
}

function perCapitaLabel(v) {
  if (v == null || !Number.isFinite(v)) return 'Sin datos';
  return `${fmtEs(v, v >= 10 ? 1 : 2)} t/persona`;
}

// Umbrales por cuantiles sobre los valores con dato (incluye el máximo).
function buildThresholds(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const cuts = [];
  for (let i = 1; i < RAMP.length; i++) {
    const idx = Math.min(sorted.length - 1, Math.round((i / RAMP.length) * (sorted.length - 1)));
    cuts.push(sorted[idx]);
  }
  return cuts;
}

function colorFor(value, thresholds) {
  if (value == null || !Number.isFinite(value)) return NO_DATA_COLOR;
  for (let i = 0; i < thresholds.length; i++) if (value <= thresholds[i]) return RAMP[i];
  return RAMP[RAMP.length - 1];
}

function main() {
  const src = JSON.parse(fs.readFileSync(SRC_PATH, 'utf8'));
  const features = src.features.map((f) => {
    const p = f.properties || {};
    return { geometry: f.geometry, props: p };
  });

  const values = features
    .map((f) => f.props['CO2 per capita (Mt)'])
    .filter((v) => v != null && Number.isFinite(Number(v)))
    .map(Number);
  const thresholds = buildThresholds(values);
  console.log(`Fuente: ${features.length} polígonos, ${values.length} con dato per cápita`);
  console.log(`Umbrales por cuantiles: ${thresholds.map((v) => fmtEs(v, 2)).join(' | ')}`);

  const geo = { type: 'FeatureCollection', features: [] };
  const seen = new Set();

  for (const { geometry, props } of features) {
    const name = props['País'] || props.NAME_ES || props.name;
    if (!name) { console.warn('Feature sin nombre, se omite'); continue; }
    let unique = name;
    let dup = 1;
    while (seen.has(unique)) { dup++; unique = `${name} (${dup})`; }
    seen.add(unique);

    const value = props['CO2 per capita (Mt)'] != null && Number.isFinite(Number(props['CO2 per capita (Mt)']))
      ? Math.round(Number(props['CO2 per capita (Mt)']) * 1000) / 1000
      : null;
    const label = perCapitaLabel(value);
    const continente = props['Continente'] || '—';
    const poblacion = props['Población'] || 'Sin datos';

    const feature = {
      type: 'Feature',
      properties: {
        _manaName: unique,
        name: unique,
        _manaColor: colorFor(value, thresholds),
        _manaFillOpacity: value == null ? 0.45 : 0.85,
        _manaWeight: 0.7,
        _manaBorderColor: '#FFFFFF',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        _manaLabelStyle: {
          enabled: true,
          fontSize: 11,
          fontFamily: 'DM Sans, sans-serif',
          fontWeight: '600',
          color: '#1e293b',
          haloWidth: 3,
          haloColor: '#FFFFFF',
          placement: 'point',
          field: '_manaName',
        },
        'País': unique,
        'Emisiones CO2 per cápita': label,
        'Emisiones CO2 per cápita (num)': value,
        'Año': DATA_YEAR,
        'Población': poblacion,
        'Continente': continente,
        'Dato': label,
        'Fuente': SOURCE_TEXT,
        'Description': value == null
          ? `${unique}: sin datos de emisiones de CO2 per cápita en ${DATA_YEAR}.`
          : `${unique}: ${label} de CO2 en ${DATA_YEAR}.`,
      },
      geometry,
    };
    geo.features.push(feature);
  }

  geo.features.sort((a, b) => (b.properties['Emisiones CO2 per cápita (num)'] || -1) - (a.properties['Emisiones CO2 per cápita (num)'] || -1));

  // Validaciones AGENTS.md (§2 coords, §3 rampa ordenada, §4 props, §8 tamaño).
  const hexOk = geo.features.every((f) => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const labelOk = geo.features.every((f) => f.properties._manaLabelStyle.haloWidth >= 2 && f.properties._manaLabelStyle.field === '_manaName');
  const coordsOk = geo.features.every((f) => {
    let ok = true;
    const walk = (c) => {
      if (typeof c[0] === 'number') {
        if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false;
      } else c.forEach(walk);
    };
    walk(f.geometry.coordinates);
    return ok;
  });
  const uniqueNames = new Set(geo.features.map((f) => f.properties._manaName));
  const text = JSON.stringify(geo);
  const sizeOk = Buffer.byteLength(text, 'utf8') <= 1048576;

  const ok = hexOk && labelOk && coordsOk && uniqueNames.size === geo.features.length && sizeOk;
  console.log(`features ${geo.features.length} | hex ${hexOk} | labels ${labelOk} | coords ${coordsOk} | nombres únicos ${uniqueNames.size === geo.features.length} | ${(text.length / 1024).toFixed(1)} KB`);
  if (!ok) { console.error('VALIDACIÓN FALLIDA'); process.exit(1); }

  fs.writeFileSync(OUT_PATH, text);
  console.log(`Escrito ${path.relative(ROOT, OUT_PATH)} (legendKey: ${LEGEND_KEY})`);
}

main();
