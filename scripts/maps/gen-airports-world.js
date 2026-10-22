#!/usr/bin/env node
// ── gen-airports-world.js ─
// Genera data/maps/airports-world.geojson a partir del dataset curado
// ~/autopilot/strategy/data/airports-world/airports-es.json
// (Airports Council International, «World's Busiest Airports» — ranking anual
// 2025 recopilado en Wikipedia «List of busiest airports by passenger
// traffic»; coordenadas de cada aeropuerto verificadas en Wikidata/Wikipedia).
// Una feature Point por aeropuerto real, markerType emoji_plane, icono
// escalado por pasajeros anuales (_manaEmojiSize, escala logarítmica) y rampa
// monocromática azul cielo ordenada por el tráfico (AGENTS.md §3).
//
// Uso: node scripts/maps/gen-airports-world.js

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SLUG = 'airports-world';
const SRC_JSON = path.join(
  os.homedir(),
  'autopilot/strategy/data/airports-world/airports-es.json'
);
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);

const GROUP_NAME = 'Aeropuertos por pasajeros anuales';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_plane';
const DATA_SOURCE =
  'Airports Council International (ACI World), «World’s Busiest Airports» — ' +
  'ranking anual de tráfico de pasajeros (2025), recopilado en Wikipedia ' +
  '«List of busiest airports by passenger traffic»; coordenadas de cada ' +
  'aeropuerto verificadas en Wikidata/Wikipedia.';
const DATA_DATE = '2025';

function fmtEs(n, dec = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Number(n).toFixed(dec);
  const [i, d] = s.split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d ? `${ii},${d}` : ii;
}

// Rampa monocromática azul cielo (claro→oscuro) ordenada por los pasajeros.
function monoSkyRamp(steps = 6) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 86 - t * 58; // 86% → 28% luminosidad
    const s = 55 + t * 30; // 55% → 85% saturación
    const c = (1 - Math.abs(2 * (l / 100) - 1)) * (s / 100);
    const hp = 200 / 60; // matiz ~200° (azul cielo)
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const m = l / 100 - c / 2;
    const r = Math.round((0 + m) * 255);
    const g = Math.round((x + m) * 255);
    const b = Math.round((c + m) * 255);
    const hx = (v) => v.toString(16).padStart(2, '0');
    out.push(`#${hx(r)}${hx(g)}${hx(b)}`);
  }
  return out;
}

// Escala del icono por pasajeros anuales (logarítmica): ~47,2 M → 22 px;
// 106,3 M → 66 px (rango soportado 22-66).
function emojiSizeForPax(pax, min, max) {
  const lo = Math.log(min), hi = Math.log(max);
  const t = hi === lo ? 1 : (Math.log(pax) - lo) / (hi - lo);
  return Math.round(22 + Math.max(0, Math.min(1, t)) * 44);
}

function buildFeatures(rows) {
  const sorted = rows.slice().sort((a, b) => b.value - a.value);
  const paxs = sorted.map((r) => r.value);
  const ramp = monoSkyRamp(6);
  const minPax = paxs[paxs.length - 1];
  const maxPax = paxs[0];

  function colorForPax(p) {
    const below = paxs.filter((v) => v <= p).length;
    const t = paxs.length <= 1 ? 1 : (below - 1) / (paxs.length - 1);
    const idx = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
    return ramp[idx];
  }

  const out = [];
  const seen = new Set();
  for (const r of sorted) {
    const name = r.entidad;
    let unique = name, dup = 2;
    while (seen.has(unique)) { unique = `${name} (${dup})`; dup++; }
    seen.add(unique);

    const paxTxt = `${fmtEs(r.value)} pasajeros`;
    const description =
      `Aeropuerto de ${r.ciudad} (${r.pais}) con ${paxTxt} en 2025, ` +
      `puesto ${r.rank}º del mundo por tráfico de pasajeros. ` +
      'Datos de Airports Council International (ACI World).';

    out.push({
      type: 'Feature',
      properties: {
        _manaName: unique,
        name: unique,
        _manaColor: colorForPax(r.value),
        _manaFillOpacity: 0.9,
        _manaWeight: 1.2,
        _manaBorderColor: '#ffffff',
        _manaGeometryType: 'point',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        markerType: MARKER_TYPE,
        _manaMarkerType: MARKER_TYPE,
        _manaEmojiSize: emojiSizeForPax(r.value, minPax, maxPax),
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
        'Pasajeros (2025)': r.value,
        Puesto: r.rank,
        Ciudad: r.ciudad,
        País: r.pais,
        'Código IATA': r.iata,
        Dato: `${paxTxt} · ${r.ciudad} (${r.pais})`,
        Description: description,
      },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    });
  }
  return out;
}

function main() {
  if (!fs.existsSync(SRC_JSON)) {
    console.error('ERROR: no existe el dataset', SRC_JSON);
    process.exit(1);
  }
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
    ['Pasajeros (2025)', 'País', 'Ciudad', 'Dato', 'Description'].every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const paxOk = features.every((f) => Number.isFinite(f.properties['Pasajeros (2025)']) && f.properties['Pasajeros (2025)'] > 0);
  // Nombre que denota entidad-área (idéntico al de audit-gallery-quality.js §9).
  const AREA_RE = /(?:^|\s)(?:desiertos?|pa[ií]ses?|regi[oó]ns?|islas?|oc[eé]anos?|mar de|mares?|lagos?|bosques?|glaciares?|pen[ií]nsulas?|archipi[eé]lagos?|deltas?|arrecifes?|fiordos?)\b/i;
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));
  // Ramp ordenable: mayor tráfico → color más oscuro → canal R menor.
  // features viene ordenado por pasajeros descendente, así que R debe ser
  // no decreciente (permite empates dentro del mismo escalón de la rampa).
  const rampOrdered = (() => {
    const rs = features.map((f) => parseInt(f.properties._manaColor.slice(1, 3), 16));
    let nonDec = 0;
    for (let i = 1; i < rs.length; i++) if (rs[i] >= rs[i - 1]) nonDec++;
    return nonDec >= rs.length - 2;
  })();

  console.log(`features: ${features.length} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala: ${scaleOk}`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | pasajeros: ${paxOk} | sin palabras de área: ${areaNameOk} | rampa ordenada: ${rampOrdered}`);
  const ps = features.map((f) => f.properties['Pasajeros (2025)']);
  console.log(`pasajeros: min ${fmtEs(Math.min(...ps))} · max ${fmtEs(Math.max(...ps))}`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || !coordsOk || !uniqueOk || !popupOk || !paxOk || !areaNameOk || !rampOrdered) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nTop 10:');
  for (const f of features.slice(0, 10)) {
    console.log(`  ${fmtEs(f.properties['Pasajeros (2025)'])} pasajeros  ${f.properties.Ciudad} (${f.properties.País}) — ${f.properties._manaName}`);
  }
}

main();
