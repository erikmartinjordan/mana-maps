#!/usr/bin/env node
// ── gen-tallest-skyscrapers-world.js ─
// Genera data/tallest-skyscrapers-world.geojson a partir del extracto curado
// ~/autopilot/strategy/data/tallest-skyscrapers-world/tallest-50.json
// (Wikipedia, «List of tallest buildings», basada en el Council on Tall
// Buildings and Urban Habitat — CTBUH Skyscraper Center, «The 100 Tallest
// Completed Buildings in the World»; coordenadas verificadas en Wikipedia y
// Wikidata; consulta octubre de 2026).
// Una feature Point por edificio real, markerType emoji_building, icono
// escalado por altura (_manaEmojiSize, escala logarítmica) y rampa
// monocromática índigo ordenada por la altura (AGENTS.md §3).
//
// Uso: node scripts/gen-tallest-skyscrapers-world.js

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SLUG = 'tallest-skyscrapers-world';
const SRC_JSON = path.join(
  os.homedir(),
  'autopilot/strategy/data/tallest-skyscrapers-world/tallest-50.json'
);
const OUT_PATH = path.join(__dirname, '..', 'data', `${SLUG}.geojson`);

const GROUP_NAME = 'Rascacielos por altura arquitectónica';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_building';
const DATA_SOURCE =
  'Wikipedia, «List of tallest buildings», basada en el Council on Tall Buildings ' +
  'and Urban Habitat (CTBUH) — Skyscraper Center, «The 100 Tallest Completed ' +
  'Buildings in the World»; coordenadas verificadas en Wikipedia y Wikidata.';
const DATA_DATE = '2026-10';

function fmtEs(n, dec = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Number(n).toFixed(dec);
  const [i, d] = s.split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d ? `${ii},${d}` : ii;
}

function hslToHex(h, s, l) {
  const S = s / 100, L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1));
  const hx = (v) => Math.round(255 * v).toString(16).padStart(2, '0');
  return `#${hx(f(0))}${hx(f(8))}${hx(f(4))}`;
}

// Rampa monocromática índigo (claro→oscuro) ordenada por la altura.
function monoIndigoRamp(steps = 8) {
  const HUE = 235;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 88 - t * 58; // 88% → 30% luminosidad
    const s = 38 + t * 38; // 38% → 76% saturación
    out.push(hslToHex(HUE, s, l));
  }
  return out;
}

// El icono crece con la altura (log): 390 m → 22 px; 828 m → 66 px.
function emojiSizeForHeight(h, min, max) {
  const lo = Math.log(min), hi = Math.log(max);
  const t = hi === lo ? 1 : (Math.log(h) - lo) / (hi - lo);
  return Math.round(22 + Math.max(0, Math.min(1, t)) * 44);
}

const NOTES = {
  'Burj Khalifa': 'Es el edificio más alto del mundo desde 2009 y saca casi 150 m al segundo.',
  'Merdeka Maybank Tower': 'Es el segundo edificio más alto del mundo y el más alto del Sudeste Asiático.',
  'Shanghai Tower': 'Es el edificio más alto de China y de Asia Oriental.',
  'Mecca Royal Clock Tower': 'Tiene el reloj más alto del mundo y el museo más alto del planeta.',
  'One World Trade Center': 'Es el edificio más alto de América y del hemisferio occidental.',
  'Lakhta Center': 'Es el edificio más alto de Europa y el rascacielos más septentrional del mundo.',
  'Taipei 101': 'Fue el edificio más alto del mundo entre 2004 y 2009.',
  'Petronas Tower 1': 'Junto con su gemela, fue el edificio más alto del mundo entre 1998 y 2004.',
  'Petronas Tower 2': 'Junto con su gemela, fue el edificio más alto del mundo entre 1998 y 2004.',
  'Willis Tower': 'Fue el edificio más alto del mundo entre 1974 y 1998, cuando se llamaba Sears Tower.',
  'Iconic Tower': 'Es el edificio más alto de África.',
  'Central Park Tower': 'Es el edificio residencial más alto del mundo.',
  '111 West 57th Street': 'Es uno de los rascacielos más esbeltos del mundo, con una proporción de 1:24.',
  'Autograph Tower': 'Es el edificio más alto del hemisferio sur.',
};

function buildFeatures(rows) {
  const sorted = rows.slice().sort((a, b) => b.height_m - a.height_m);
  const heights = sorted.map((r) => r.height_m);
  const ramp = monoIndigoRamp(8);
  const minH = heights[heights.length - 1];
  const maxH = heights[0];

  function colorForHeight(h) {
    const below = heights.filter((v) => v <= h).length;
    const t = heights.length <= 1 ? 1 : (below - 1) / (heights.length - 1);
    const idx = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
    return ramp[idx];
  }

  const out = [];
  const seen = new Set();
  for (const r of sorted) {
    let unique = r.name, dup = 2;
    while (seen.has(unique)) { unique = `${r.name} (${dup})`; dup++; }
    seen.add(unique);

    const note = NOTES[r.name_original] || '';
    const heightTxt = `${fmtEs(r.height_m, r.height_m % 1 ? 1 : 0)} m`;
    const description = [
      `${unique} mide ${heightTxt} y tiene ${fmtEs(r.floors)} plantas. ` +
        `Está en ${r.city} (${r.country}) y se completó en ${r.year}; ` +
        `ocupa el puesto ${r.rank}º entre los edificios más altos del mundo.`,
      note,
    ].filter(Boolean).join(' ');

    out.push({
      type: 'Feature',
      properties: {
        _manaName: unique,
        name: unique,
        _manaColor: colorForHeight(r.height_m),
        _manaFillOpacity: 0.9,
        _manaWeight: 1.2,
        _manaBorderColor: '#ffffff',
        _manaGeometryType: 'point',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        markerType: MARKER_TYPE,
        _manaMarkerType: MARKER_TYPE,
        _manaEmojiSize: emojiSizeForHeight(r.height_m, minH, maxH),
        _manaLabelStyle: {
          enabled: true,
          field: '_manaName',
          fontFamily: 'monospace',
          fontSize: 10,
          fontWeight: '600',
          color: '#0f172a',
          haloWidth: 3,
          haloColor: '#ffffff',
          opacity: 0.9,
          placement: 'auto',
        },
        // Datos concretos de popup (AGENTS.md §5) — claves en español
        'Altura (m)': r.height_m,
        Plantas: r.floors,
        Puesto: r.rank,
        Ciudad: r.city,
        País: r.country,
        Año: r.year,
        Dato: `${heightTxt} · ${fmtEs(r.floors)} plantas · ${r.city} (${r.country})`,
        Description: description,
      },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    });
  }
  return out;
}

// Nombre que denota entidad-área (idéntico al de audit-gallery-quality.js §9).
const AREA_RE = /(?:^|\s)(?:desiertos?|pa[ií]ses?|regi[oó]ns?|islas?|oc[eé]anos?|mar de|mares?|lagos?|bosques?|glaciares?|pen[ií]nsulas?|archipi[eé]lagos?|deltas?|arrecifes?|cordilleras?|sierras?|mesetas?)\b/i;

function main() {
  if (!fs.existsSync(SRC_JSON)) {
    console.error('ERROR: no existe el extracto', SRC_JSON);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  const features = buildFeatures(data.buildings);
  const geo = { type: 'FeatureCollection', features };

  // ── Validaciones AGENTS.md ──
  const hexOk = features.every((f) => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = features.every((f) => f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth >= 2);
  const markerOk = features.every((f) => f.properties.markerType === MARKER_TYPE && f.properties._manaMarkerType === MARKER_TYPE);
  const scaleOk = features.every((f) => Number.isFinite(f.properties._manaEmojiSize) && f.properties._manaEmojiSize >= 22 && f.properties._manaEmojiSize <= 66);
  const coordsOk = features.every((f) => {
    const [x, y] = f.geometry.coordinates;
    return x >= -180 && x <= 180 && y >= -90 && y <= 90;
  });
  const names = new Set(features.map((f) => f.properties._manaName));
  const uniqueOk = names.size === features.length;
  const popupOk = features.every((f) =>
    ['Altura (m)', 'Plantas', 'País', 'Ciudad', 'Año', 'Dato', 'Description'].every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const heightsOk = features.every((f) => Number.isFinite(f.properties['Altura (m)']) && f.properties['Altura (m)'] >= 390);
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));
  // Ordenadas de mayor a menor altura → color oscuro primero: R no decreciente.
  const rampOrdered = (() => {
    const rs = features.map((f) => parseInt(f.properties._manaColor.slice(1, 3), 16));
    let nonDec = 0;
    for (let i = 1; i < rs.length; i++) if (rs[i] >= rs[i - 1]) nonDec++;
    return nonDec >= rs.length - 2;
  })();

  console.log(`features: ${features.length} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala: ${scaleOk}`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | alturas: ${heightsOk} | sin palabras de área: ${areaNameOk} | rampa ordenada: ${rampOrdered}`);
  const hs = features.map((f) => f.properties['Altura (m)']);
  console.log(`altura: min ${fmtEs(Math.min(...hs))} m · max ${fmtEs(Math.max(...hs))} m`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || !coordsOk || !uniqueOk || !popupOk || !heightsOk || !areaNameOk || !rampOrdered) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nTop 10:');
  for (const f of features.slice(0, 10)) {
    console.log(`  ${fmtEs(f.properties['Altura (m)'])} m  ${f.properties.Ciudad} (${f.properties.País}) — ${f.properties._manaName}`);
  }
}

main();
