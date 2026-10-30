#!/usr/bin/env node
// ── gen-tallest-statues-world.js ─
// Genera data/maps/tallest-statues-world.geojson a partir del extracto curado
// data/sources/tallest-statues-world/statues.json (Wikipedia — List of tallest
// statues, con datos de Guinness World Records y fichas oficiales).
// Una feature Point por estatua real, markerType emoji_star, icono escalado por
// la altura de la figura (_manaEmojiSize, escala logarítmica 22-66 px) y rampa
// monocromática ámbar ordenada por esa altura (AGENTS.md §3).
// Props de popup en español: Representa, País, Lugar, Altura (numérica),
// Altura total, Inauguración y Dato (AGENTS.md §5).
//
// Uso: node scripts/maps/gen-tallest-statues-world.js

'use strict';

const fs = require('fs');
const path = require('path');

const SLUG = 'tallest-statues-world';
const SRC_JSON = path.join(__dirname, '..', '..', 'data', 'sources', SLUG, 'statues.json');
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);

const GROUP_NAME = 'Estatuas más altas del mundo';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_star';
const LEGEND_KEY = 'Altura';

function fmtEs(n, dec = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Number(n).toFixed(dec);
  const [i, d] = s.split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d ? `${ii},${d}` : ii;
}

function fmtAltura(n) {
  if (Number.isInteger(n)) return fmtEs(n);
  return fmtEs(n, 2).replace(/0+$/, '').replace(/,$/, '');
}

function hslToHex(h, s, l) {
  const S = s / 100, L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1));
  const hx = (v) => Math.round(255 * v).toString(16).padStart(2, '0');
  return `#${hx(f(0))}${hx(f(8))}${hx(f(4))}`;
}

// Rampa monocromática ámbar/oro (claro→oscuro) ordenada por altura.
function monoAmberRamp(steps = 7) {
  const HUE = 38;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 74 - t * 46; // 74% → 28% luminosidad
    const s = 62 + t * 26; // 62% → 88% saturación
    out.push(hslToHex(HUE, s, l));
  }
  return out;
}

// El icono crece con la altura (log): 76 m → 22 px; 182 m → 66 px.
function emojiSizeForHeight(m, min, max) {
  const lo = Math.log(min), hi = Math.log(max);
  const t = hi === lo ? 1 : (Math.log(m) - lo) / (hi - lo);
  return Math.round(22 + Math.max(0, Math.min(1, t)) * 44);
}

function relativeLuminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function buildFeatures(data) {
  const rows = data.estatuas.slice().sort((a, b) => b.alturaM - a.alturaM || a.nombre.localeCompare(b.nombre));
  const heights = rows.map((r) => r.alturaM);
  const minM = heights[heights.length - 1];
  const maxM = heights[0];
  const ramp = monoAmberRamp(rows.length);

  return rows.map((r, idx) => {
    // fila 0 = estatua más alta → color más oscuro (final de la rampa)
    const color = ramp[ramp.length - 1 - idx];
    const alturaTxt = `${fmtAltura(r.alturaM)} m`;
    const totalTxt = r.alturaTotalM == null ? 'No consta' : `${fmtAltura(r.alturaTotalM)} m`;

    return {
      type: 'Feature',
      properties: {
        _manaName: r.nombre,
        name: r.nombre,
        _manaColor: color,
        _manaWeight: 3,
        _manaOpacity: 1,
        _manaGeometryType: 'point',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        markerType: MARKER_TYPE,
        _manaMarkerType: MARKER_TYPE,
        _manaEmojiSize: emojiSizeForHeight(r.alturaM, minM, maxM),
        _manaLabelStyle: {
          enabled: true,
          field: '_manaName',
          fontFamily: 'DM Mono, monospace',
          fontSize: 11,
          fontWeight: 'bold',
          fontStyle: 'normal',
          color: '#ffffff',
          haloColor: '#000000',
          haloWidth: 3,
          opacity: 1,
          offsetX: 0,
          offsetY: -30,
          placement: 'auto',
        },
        // Datos concretos de popup (AGENTS.md §5) — claves en español
        Representa: r.representa,
        Continente: r.continente,
        País: r.pais,
        Lugar: r.lugar,
        Altura: r.alturaM,
        'Altura de la estatua': alturaTxt,
        'Altura total': totalTxt,
        Inauguración: String(r.anio),
        Dato: `${alturaTxt} · ${r.pais} · ${r.anio}`,
        Description: r.descripcion,
      },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    };
  });
}

// Nombre que denota entidad-área (idéntico al de audit-gallery-quality.js §9).
const AREA_RE = /(?:^|\s)(?:desiertos?|pa[ií]ses?|regi[oó]ns?|islas?|oc[eé]anos?|mar de|mares?|lagos?|bosques?|glaciares?|pen[ií]nsulas?|archipi[eé]lagos?|deltas?|arrecifes?|fiordos?|cordilleras?)\b/i;

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
  const haloOk = features.every((f) => f.properties._manaLabelStyle && f.properties._manaLabelStyle.enabled === true && f.properties._manaLabelStyle.field === '_manaName' && f.properties._manaLabelStyle.haloWidth >= 2);
  const markerOk = features.every((f) => f.properties.markerType === MARKER_TYPE && f.properties._manaMarkerType === MARKER_TYPE);
  const scaleOk = features.every((f) => Number.isFinite(f.properties._manaEmojiSize) && f.properties._manaEmojiSize >= 22 && f.properties._manaEmojiSize <= 66);
  const coordsOk = features.every((f) => {
    const [x, y] = f.geometry.coordinates;
    return x >= -180 && x <= 180 && y >= -90 && y <= 90;
  });
  const names = new Set(features.map((f) => f.properties._manaName));
  const uniqueOk = names.size === features.length;
  const popupOk = features.every((f) =>
    ['Representa', 'Continente', 'País', 'Lugar', 'Altura de la estatua', 'Altura total', 'Inauguración', 'Dato', 'Description'].every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const heightOk = features.every((f) => Number.isFinite(f.properties.Altura) && f.properties.Altura > 0);
  const groupOk = features.every((f) => f.properties._manaGroupName === GROUP_NAME && Number(f.properties._manaGroupId) === GROUP_ID);
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));
  const sizes = new Set(features.map((f) => f.properties._manaEmojiSize));
  // Ordenadas de mayor a menor altura → la más alta es la más oscura; la
  // luminancia no decrece al bajar en la lista (claro→oscuro de mayor a menor).
  const lums = features.map((f) => relativeLuminance(f.properties._manaColor));
  let ordered = 0;
  for (let i = 1; i < lums.length; i++) if (lums[i] >= lums[i - 1] - 1e-6) ordered++;
  const rampOrdered = ordered >= lums.length - 1;

  console.log(`features: ${features.length} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala: ${scaleOk} (${sizes.size} tamaños)`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | altura numérica: ${heightOk} | grupo: ${groupOk}`);
  console.log(`sin palabras de área: ${areaNameOk} | rampa ordenada: ${rampOrdered}`);
  const hs = features.map((f) => f.properties.Altura);
  console.log(`altura: min ${fmtAltura(Math.min(...hs))} m · max ${fmtAltura(Math.max(...hs))} m`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || sizes.size < 3 || !coordsOk || !uniqueOk || !popupOk || !heightOk || !groupOk || !areaNameOk || !rampOrdered) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo, null, 2));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nEstatuas por altura:');
  for (const f of features) {
    console.log(`  ${fmtAltura(f.properties.Altura)} m  ${f.properties.País}  ${f.properties._manaName} (emoji ${f.properties._manaEmojiSize}px, ${f.properties._manaColor})`);
  }
}

main();
