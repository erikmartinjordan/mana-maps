#!/usr/bin/env node
// ── gen-highest-peaks-per-continent.js ─
// Genera data/maps/highest-peaks-per-continent.geojson a partir del extracto
// curado data/sources/highest-peaks-per-continent/peaks.json (Siete Cumbres:
// SRTM NASA/JPL y levantamientos topográficos oficiales; medición China-Nepal
// 2020 del Everest).
// Una feature Point por cumbre real, markerType emoji_mountain, icono escalado
// por la altitud (_manaEmojiSize, escala logarítmica 22-66 px) y rampa
// monocromática azul ordenada por esa altitud (AGENTS.md §3).
// Props de popup en español: Continente, País, Elevación, Altitud (numérica),
// Cordillera, Primera ascensión y Dato (AGENTS.md §5).
//
// Uso: node scripts/maps/gen-highest-peaks-per-continent.js

'use strict';

const fs = require('fs');
const path = require('path');

const SLUG = 'highest-peaks-per-continent';
const SRC_JSON = path.join(__dirname, '..', '..', 'data', 'sources', SLUG, 'peaks.json');
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);

const GROUP_NAME = 'Las Siete Cumbres';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_mountain';
const LEGEND_KEY = 'Altitud';

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

// Rampa monocromática azul (claro→oscuro) ordenada por la altitud.
function monoBlueRamp(steps = 7) {
  const HUE = 220;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 88 - t * 58; // 88% → 30% luminosidad
    const s = 55 + t * 32; // 55% → 87% saturación
    out.push(hslToHex(HUE, s, l));
  }
  return out;
}

// El icono crece con la altitud (log): 4.884 m → 22 px; 8.849 m → 66 px.
function emojiSizeForAltitude(m, min, max) {
  const lo = Math.log(min), hi = Math.log(max);
  const t = hi === lo ? 1 : (Math.log(m) - lo) / (hi - lo);
  return Math.round(22 + Math.max(0, Math.min(1, t)) * 44);
}

function buildFeatures(data) {
  const rows = data.peaks.slice().sort((a, b) => b.altitudM - a.altitudM || a.nombre.localeCompare(b.nombre));
  const altitudes = rows.map((r) => r.altitudM);
  const minM = altitudes[altitudes.length - 1];
  const maxM = altitudes[0];
  const ramp = monoBlueRamp(rows.length);

  return rows.map((r, idx) => {
    // fila 0 = cima más alta → color más oscuro (final de la rampa)
    const color = ramp[ramp.length - 1 - idx];
    const altTxt = `${fmtEs(r.altitudM)} m`;
    const primera = `${r.primeraAscension} (${r.protagonistas})`;

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
        _manaEmojiSize: emojiSizeForAltitude(r.altitudM, minM, maxM),
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
        Continente: r.continente,
        País: r.pais,
        Elevación: altTxt,
        Altitud: r.altitudM,
        Cordillera: r.cordillera,
        'Primera ascensión': primera,
        Dato: `${altTxt} · ${r.cordillera}`,
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
    ['Continente', 'País', 'Elevación', 'Altitud', 'Cordillera', 'Primera ascensión', 'Dato', 'Description'].every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const altitudeOk = features.every((f) => Number.isFinite(f.properties.Altitud) && f.properties.Altitud > 0);
  const esPropsOk = features.every((f) => !('Continent' in f.properties) && !('Country' in f.properties) && !('Elevation' in f.properties) && !('Range' in f.properties) && !('First_Ascent' in f.properties));
  const groupOk = features.every((f) => f.properties._manaGroupName === GROUP_NAME && Number(f.properties._manaGroupId) === GROUP_ID);
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));
  const sizes = new Set(features.map((f) => f.properties._manaEmojiSize));
  // Ordenadas de mayor a menor altitud → color más oscuro primero: R no decreciente.
  const rampOrdered = (() => {
    const rs = features.map((f) => parseInt(f.properties._manaColor.slice(1, 3), 16));
    let nonDec = 0;
    for (let i = 1; i < rs.length; i++) if (rs[i] >= rs[i - 1]) nonDec++;
    return nonDec >= rs.length - 2;
  })();

  console.log(`features: ${features.length} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala: ${scaleOk} (${sizes.size} tamaños)`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | altitud numérica: ${altitudeOk} | props ES: ${esPropsOk} | grupo: ${groupOk}`);
  console.log(`sin palabras de área: ${areaNameOk} | rampa ordenada: ${rampOrdered}`);
  const hs = features.map((f) => f.properties.Altitud);
  console.log(`altitud: min ${fmtEs(Math.min(...hs))} m · max ${fmtEs(Math.max(...hs))} m`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || sizes.size < 3 || !coordsOk || !uniqueOk || !popupOk || !altitudeOk || !esPropsOk || !groupOk || !areaNameOk || !rampOrdered) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo, null, 2));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nCumbres por altitud:');
  for (const f of features) {
    console.log(`  ${fmtEs(f.properties.Altitud)} m  ${f.properties.Continente}  ${f.properties._manaName} (emoji ${f.properties._manaEmojiSize}px, ${f.properties._manaColor})`);
  }
}

main();
