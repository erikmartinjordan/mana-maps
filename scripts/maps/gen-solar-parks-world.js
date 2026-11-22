#!/usr/bin/env node
// ── gen-solar-parks-world.js ─
// Genera data/maps/solar-parks-world.geojson a partir del dataset curado
// ~/autopilot/strategy/data/solar-parks-world/plants.json
// (Wikipedia «List of photovoltaic power stations», actualizada 2026, que
// compila cifras de operadores y gobiernos; coordenadas de la propia tabla y
// de la ficha Wikipedia de cada planta).
// Una feature Point por parque real, markerType emoji_sun, icono escalado por
// potencia (MW) y rampa monocromática ámbar ordenada por potencia (AGENTS.md §3).
//
// Uso: node scripts/maps/gen-solar-parks-world.js

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SLUG = 'solar-parks-world';
const SRC_JSON = path.join(
  os.homedir(),
  'autopilot/strategy/data/solar-parks-world/plants.json'
);
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);

const GROUP_NAME = 'Mayores parques solares del mundo';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_sun';
const DATA_SOURCE =
  'Wikipedia «List of photovoltaic power stations» (actualizada en 2026), que compila capacidades publicadas por operadores y gobiernos; coordenadas de la tabla y de la ficha Wikipedia de cada planta.';
const DATA_DATE = '2026-11-22';

function fmtEs(n, dec = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Number(n).toFixed(dec);
  const [i, d] = s.split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d ? `${ii},${d}` : ii;
}

// Rampa monocromática ámbar (claro→oscuro) ordenada por potencia instalada.
const RAMP = ['#fbe3a1', '#f6cb72', '#eda94a', '#dd8629', '#bf6414', '#8f430b'];

function colorForRank(idx, total) {
  // idx 0 = mayor potencia → tono más oscuro de la rampa.
  const t = total <= 1 ? 1 : (total - 1 - idx) / (total - 1);
  const i = Math.max(0, Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1))));
  return RAMP[i];
}

function emojiSizeForMw(mw) {
  // 1.350 MW → 22 px ; 21.000 MW → 66 px (rango soportado 22-66)
  const t = Math.max(0, Math.min(1, (mw - 1350) / (21000 - 1350)));
  return Math.round(22 + t * 44);
}

function buildFeatures(rows) {
  const sorted = rows.slice().sort((a, b) => b.mw - a.mw);
  return sorted.map((r, idx) => {
    const mwTxt = `${fmtEs(r.mw)} MW`;

    const props = {
      _manaName: r.nombre,
      name: r.nombre,
      _manaColor: colorForRank(idx, sorted.length),
      _manaFillOpacity: 0.9,
      _manaWeight: 1.2,
      _manaBorderColor: '#ffffff',
      _manaGeometryType: 'point',
      _manaGroupName: GROUP_NAME,
      _manaGroupId: GROUP_ID,
      markerType: MARKER_TYPE,
      _manaMarkerType: MARKER_TYPE,
      _manaEmojiSize: emojiSizeForMw(r.mw),
      _manaLabelStyle: {
        enabled: true,
        field: '_manaName',
        fontFamily: 'DM Mono, monospace',
        fontSize: 10,
        fontWeight: '600',
        color: '#2b1704',
        haloWidth: 3,
        haloColor: '#fff8e6',
        opacity: 0.92,
        placement: 'auto',
      },
      // Datos concretos de popup (AGENTS.md §5) — claves en español
      'Potencia (MW)': r.mw,
      País: r.pais,
      Región: r.region,
      Año: r.ano,
      Dato: `${mwTxt} · ${r.pais}`,
      Description: r.descripcion,
    };
    if (r.gwh != null) props['Producción anual (GWh)'] = r.gwh;
    if (r.km2 != null) props['Superficie (km²)'] = r.km2;

    return {
      type: 'Feature',
      properties: props,
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    };
  });
}

function main() {
  const rows = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  const features = buildFeatures(rows);
  const geo = { type: 'FeatureCollection', features };

  // ── Validaciones AGENTS.md ──
  const hexOk = features.every((f) => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = features.every(
    (f) => f.properties._manaLabelStyle &&
      f.properties._manaLabelStyle.enabled === true &&
      f.properties._manaLabelStyle.field === '_manaName' &&
      f.properties._manaLabelStyle.haloWidth >= 2
  );
  const markerOk = features.every(
    (f) => f.properties.markerType === MARKER_TYPE && f.properties._manaMarkerType === MARKER_TYPE
  );
  const scaleOk = features.every(
    (f) => Number.isFinite(f.properties._manaEmojiSize) &&
      f.properties._manaEmojiSize >= 22 && f.properties._manaEmojiSize <= 66
  );
  const coordsOk = features.every((f) => {
    const [x, y] = f.geometry.coordinates;
    return Number.isFinite(x) && Number.isFinite(y) && x >= -180 && x <= 180 && y >= -90 && y <= 90;
  });
  const names = new Set(features.map((f) => f.properties._manaName));
  const uniqueOk = names.size === features.length;
  const popupOk = features.every((f) =>
    ['Potencia (MW)', 'País', 'Dato', 'Description'].every(
      (k) => f.properties[k] != null && f.properties[k] !== ''
    )
  );
  const mwOk = features.every(
    (f) => Number.isFinite(f.properties['Potencia (MW)']) && f.properties['Potencia (MW)'] > 0
  );
  const AREA_RE = /(?:^|\s)(?:desiertos?|pa[ií]ses?|regi[oó]ns?|islas?|oc[eé]anos?|mar de|mares?|lagos?|bosques?|glaciares?|pen[ií]nsulas?|archipi[eé]lagos?|deltas?|arrecifes?|fiordos?)\b/i;
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));
  // Rampa ordenable: mayor potencia → posición más oscura de la rampa.
  // features viene ordenado por potencia descendente, así que la posición en
  // RAMP debe ser no creciente (permite empates dentro del mismo escalón).
  const rampOrdered = (() => {
    const pos = features.map((f) => RAMP.indexOf(f.properties._manaColor));
    return pos.every((v, i) => v >= 0 && (i === 0 || v <= pos[i - 1]));
  })();
  const groupOk = features.every(
    (f) => f.properties._manaGroupName === GROUP_NAME && f.properties._manaGroupId === GROUP_ID
  );

  console.log(`features: ${features.length} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala: ${scaleOk}`);
  console.log(
    `coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | MW: ${mwOk} | ` +
    `sin palabras de área: ${areaNameOk} | rampa ordenada: ${rampOrdered} | grupo: ${groupOk}`
  );
  const mws = features.map((f) => f.properties['Potencia (MW)']);
  console.log(`potencia: min ${fmtEs(Math.min(...mws))} MW · max ${fmtEs(Math.max(...mws))} MW`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || !coordsOk || !uniqueOk || !popupOk ||
      !mwOk || !areaNameOk || !rampOrdered || !groupOk) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nTop 10:');
  for (const f of features.slice(0, 10)) {
    console.log(`  ${fmtEs(f.properties['Potencia (MW)'])} MW  ${f.properties.País}  ${f.properties._manaName}`);
  }
}

main();
