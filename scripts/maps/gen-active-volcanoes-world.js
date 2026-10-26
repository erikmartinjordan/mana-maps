#!/usr/bin/env node
// ── gen-active-volcanoes-world.js ─
// Genera data/maps/active-volcanoes-world.geojson a partir del extracto curado
// data/sources/active-volcanoes-world/volcanoes.json (Smithsonian Institution,
// Global Volcanism Program — Volcanoes of the World: volcanes con erupciones
// del Holoceno o históricas).
// Una feature Point por volcán, markerType emoji_mountain, icono escalado por
// la altitud (_manaEmojiSize, escala logarítmica) y rampa monocromática roja
// ordenada por esa altitud (AGENTS.md §3).
//
// Uso: node scripts/maps/gen-active-volcanoes-world.js

'use strict';

const fs = require('fs');
const path = require('path');

const SLUG = 'active-volcanoes-world';
const SRC_JSON = path.join(__dirname, '..', '..', 'data', 'sources', SLUG, 'volcanoes.json');
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);

const GROUP_NAME = 'Volcanes activos';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_mountain';
const LEGEND_KEY = 'Altitud';
const DATA_SOURCE =
  'Smithsonian Institution — Global Volcanism Program, Volcanoes of the World: ' +
  'volcanes con erupciones del Holoceno o históricas. https://volcano.si.edu';
const DATA_DATE = '2026';

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

// Rampa monocromática roja (claro→oscuro) ordenada por la altitud.
function monoRedRamp(steps = 8) {
  const HUE = 356;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 88 - t * 58; // 88% → 30% luminosidad
    const s = 60 + t * 32; // 60% → 92% saturación
    out.push(hslToHex(HUE, s, l));
  }
  return out;
}

// El icono crece con la altitud (log): 244 m → 22 px; 5.976 m → 66 px.
function emojiSizeForElevation(m, min, max) {
  const lo = Math.log(min), hi = Math.log(max);
  const t = hi === lo ? 1 : (Math.log(m) - lo) / (hi - lo);
  return Math.round(22 + Math.max(0, Math.min(1, t)) * 44);
}

function buildFeatures(data) {
  const rows = data.volcanoes
    .slice()
    .sort((a, b) => b.altitudM - a.altitudM || a.nombre.localeCompare(b.nombre));
  const elevations = rows.map((r) => r.altitudM);
  const ramp = monoRedRamp(8);
  const minM = elevations[elevations.length - 1];
  const maxM = elevations[0];

  function colorForElevation(m) {
    const below = elevations.filter((v) => v <= m).length;
    const t = elevations.length <= 1 ? 1 : (below - 1) / (elevations.length - 1);
    const idx = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
    return ramp[idx];
  }

  return rows.map((r) => {
    const altTxt = `${fmtEs(r.altitudM)} m`;
    // Sin duplicar la unidad: antes se generaba «1,247 m m de altitud».
    const description =
      `${r.nombre} (${r.pais}), ${r.tipo} de ${altTxt} de altitud. ` +
      `Última erupción registrada en ${r.ultimaErupcion}.`;

    return {
      type: 'Feature',
      properties: {
        _manaName: r.nombre,
        name: r.nombre,
        _manaColor: colorForElevation(r.altitudM),
        _manaFillOpacity: 0.9,
        _manaWeight: 1.2,
        _manaBorderColor: '#ffffff',
        _manaGeometryType: 'point',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        markerType: MARKER_TYPE,
        _manaMarkerType: MARKER_TYPE,
        _manaEmojiSize: emojiSizeForElevation(r.altitudM, minM, maxM),
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
        País: r.pais,
        Altitud: r.altitudM,
        'Última erupción': r.ultimaErupcion,
        Tipo: r.tipo,
        Dato: `${altTxt} de altitud · ${r.tipo}`,
        Description: description,
      },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    };
  });
}

// Nombre que denota entidad-área (idéntico al de audit-gallery-quality.js §9).
const AREA_RE = /(?:^|\s)(?:desiertos?|pa[ií]ses?|regi[oó]ns?|islas?|oc[eé]anos?|mar de|mares?|lagos?|bosques?|glaciares?|pen[ií]nsulas?|archipi[eé]lagos?|deltas?|arrecifes?|fiordos?)\b/i;

function main() {
  if (!fs.existsSync(SRC_JSON)) {
    console.error('ERROR: no existe el extracto', SRC_JSON);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  const features = buildFeatures(data);
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
    ['País', 'Altitud', 'Última erupción', 'Tipo', 'Dato', 'Description'].every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const elevationOk = features.every((f) => Number.isFinite(f.properties.Altitud) && f.properties.Altitud > 0);
  const descriptionOk = features.every((f) => !/\bm m\b/.test(f.properties.Description) && /\bde altitud\./.test(f.properties.Description));
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));
  // Ordenadas de mayor a menor altitud → color oscuro primero: R no decreciente.
  const rampOrdered = (() => {
    const rs = features.map((f) => parseInt(f.properties._manaColor.slice(1, 3), 16));
    let nonDec = 0;
    for (let i = 1; i < rs.length; i++) if (rs[i] >= rs[i - 1]) nonDec++;
    return nonDec >= rs.length - 2;
  })();

  console.log(`features: ${features.length} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala: ${scaleOk}`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | altitud: ${elevationOk} | sin «m m»: ${descriptionOk} | sin palabras de área: ${areaNameOk} | rampa ordenada: ${rampOrdered}`);
  const hs = features.map((f) => f.properties.Altitud);
  console.log(`altitud: min ${fmtEs(Math.min(...hs))} m · max ${fmtEs(Math.max(...hs))} m`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || !coordsOk || !uniqueOk || !popupOk || !elevationOk || !descriptionOk || !areaNameOk || !rampOrdered) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nTop 10 por altitud:');
  for (const f of features.slice(0, 10)) {
    console.log(`  ${fmtEs(f.properties.Altitud)} m  ${f.properties.País}  ${f.properties._manaName}`);
  }
}

main();
