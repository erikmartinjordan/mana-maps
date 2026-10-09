#!/usr/bin/env node
// ── gen-tallest-waterfalls-world.js ─
// Genera data/tallest-waterfalls-world.geojson a partir del dataset curado
// ~/autopilot/strategy/data/tallest-waterfalls-world/waterfalls.json
// (World Waterfall Database vía Wikipedia «List of waterfalls by height»;
// coordenadas verificadas en Wikidata/Wikipedia).
// Una feature Point por cascada real, markerType emoji_water, icono escalado
// por la altura total (_manaEmojiSize) y rampa monocromática azul ordenada
// por la altura (AGENTS.md §3).
//
// Uso: node scripts/gen-tallest-waterfalls-world.js

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SLUG = 'tallest-waterfalls-world';
const SRC_JSON = path.join(
  os.homedir(),
  'autopilot/strategy/data/tallest-waterfalls-world/waterfalls.json'
);
const OUT_PATH = path.join(__dirname, '..', 'data', `${SLUG}.geojson`);

const GROUP_NAME = 'Cascadas naturales por altura total';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_water';
const DATA_SOURCE =
  'World Waterfall Database (worldwaterfalldatabase.com), compilación de alturas publicada en Wikipedia «List of waterfalls by height»; coordenadas de cada cascada verificadas en Wikidata/Wikipedia.';
const DATA_DATE = '2026-10-09';

function fmtEs(n, dec = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Number(n).toFixed(dec);
  const [i, d] = s.split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d ? `${ii},${d}` : ii;
}

// Rampa monocromática azul agua (claro→oscuro) ordenada por la altura.
function monoBlueRamp(steps = 6) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 86 - t * 60; // 86% → 26% luminosidad
    const s = 50 + t * 35; // 50% → 85% saturación
    const c = (1 - Math.abs(2 * (l / 100) - 1)) * (s / 100);
    const x = c * (1 - Math.abs(((210 / 60) % 2) - 1)); // matiz ~210° (azul agua)
    const m = l / 100 - c / 2;
    const r = Math.round((0 + m) * 255);
    const g = Math.round((x + m) * 255);
    const b = Math.round((c + m) * 255);
    const hx = (v) => v.toString(16).padStart(2, '0');
    out.push(`#${hx(r)}${hx(g)}${hx(b)}`);
  }
  return out;
}

function emojiSizeForHeight(h) {
  // 455 m → 22 px ; 979 m → 66 px (rango soportado 22-66)
  const t = Math.max(0, Math.min(1, (h - 455) / (979 - 455)));
  return Math.round(22 + t * 44);
}

function buildFeatures(rows) {
  const sorted = rows.slice().sort((a, b) => b.value - a.value);
  const heights = sorted.map((r) => r.value);
  const ramp = monoBlueRamp(6);

  function colorForHeight(h) {
    const below = heights.filter((v) => v <= h).length;
    const t = heights.length <= 1 ? 1 : (below - 1) / (heights.length - 1);
    const idx = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
    return ramp[idx];
  }

  const out = [];
  const seen = new Set();
  for (const r of sorted) {
    let name = r.entidad;
    let unique = name, dup = 2;
    while (seen.has(unique)) { unique = `${name} (${dup})`; dup++; }
    seen.add(unique);

    const h = r.value;
    const hTxt = `${fmtEs(h)} m`;
    const description =
      `Cascada de ${hTxt} de altura total en ${r.pais} (${r.region}). ` +
      `Caudal: ${r.agua}. ${r.nota}`;

    out.push({
      type: 'Feature',
      properties: {
        _manaName: unique,
        name: unique,
        _manaColor: colorForHeight(h),
        _manaFillOpacity: 0.9,
        _manaWeight: 1.2,
        _manaBorderColor: '#ffffff',
        _manaGeometryType: 'point',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        markerType: MARKER_TYPE,
        _manaMarkerType: MARKER_TYPE,
        _manaEmojiSize: emojiSizeForHeight(h),
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
        'Altura (m)': h,
        País: r.pais,
        Región: r.region,
        Caudal: r.agua,
        Superficie: hTxt,
        Dato: `${hTxt} · ${r.pais}`,
        Description: description,
      },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    });
  }
  return out;
}

function main() {
  const rows = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  const features = buildFeatures(rows);
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
    ['Altura (m)', 'País', 'Dato', 'Description'].every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const heightsOk = features.every((f) => Number.isFinite(f.properties['Altura (m)']) && f.properties['Altura (m)'] >= 455);
  const AREA_RE = /(?:^|\s)(?:desiertos?|pa[ií]ses?|regi[oó]ns?|islas?|oc[eé]anos?|mar de|mares?|lagos?|bosques?|glaciares?|pen[ií]nsulas?|archipi[eé]lagos?|deltas?|arrecifes?|fiordos?)\b/i;
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));
  // Ramp ordenable: mayor altura → color más oscuro → canal R menor.
  // features viene ordenado por altura descendente, así que R debe ser
  // no decreciente (permite empates dentro del mismo escalón de la rampa).
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
    console.log(`  ${fmtEs(f.properties['Altura (m)'])} m  ${f.properties.País}  ${f.properties._manaName}`);
  }
}

main();
