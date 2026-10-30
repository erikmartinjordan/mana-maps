#!/usr/bin/env node
// ── gen-largest-hydro-dams-world.js ─
// Genera data/maps/largest-hydro-dams-world.geojson a partir del extracto
// curado data/sources/largest-hydro-dams-world/dams.json: las 50 centrales
// hidroeléctricas de mayor potencia instalada del mundo según Wikipedia,
// «List of conventional hydroelectric power stations» (consulta de octubre de
// 2026, compilada a partir del ICOLD World Register of Dams y de los datos de
// los operadores).
// Una feature Point por presa real, markerType emoji_water, icono escalado
// por la potencia instalada (_manaEmojiSize, escala logarítmica 22–66 px) y
// rampa monocromática azul ordenada por esa potencia (AGENTS.md §3).
// Props de popup en español: País, Río, Potencia (numérica), Potencia
// instalada, Puesta en servicio, Dato y Description (AGENTS.md §5).
//
// Uso: node scripts/maps/gen-largest-hydro-dams-world.js

'use strict';

const fs = require('fs');
const path = require('path');

const SLUG = 'largest-hydro-dams-world';
const SRC_JSON = path.join(__dirname, '..', '..', 'data', 'sources', SLUG, 'dams.json');
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);

const GROUP_NAME = 'Presas hidroeléctricas por potencia instalada';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_water';
const LEGEND_KEY = 'Potencia (MW)';

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

// Rampa monocromática azul (claro→oscuro) ordenada por la potencia.
function monoBlueRamp(steps = 8) {
  const HUE = 210;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 88 - t * 58; // 88% → 30% luminosidad
    const s = 62 + t * 30; // 62% → 92% saturación
    out.push(hslToHex(HUE, s, l));
  }
  return out;
}

// El icono crece con la potencia instalada (log):
// 2.418 MW (La Grande-3) → 22 px; 22.500 MW (Tres Gargantas) → 66 px.
function emojiSizeForMW(v, min, max) {
  const lo = Math.log(min), hi = Math.log(max);
  const t = hi === lo ? 1 : (Math.log(v) - lo) / (hi - lo);
  return Math.round(22 + Math.max(0, Math.min(1, t)) * 44);
}

// Nombre que denota entidad-área (idéntico al de audit-gallery-quality.js §9).
const AREA_RE = /(?:^|\s)(?:desiertos?|pa[ií]ses?|regi[oó]n(?:es)?|islas?|oc[eé]anos?|mar de|mares?|lagos?|bosques?|glaciares?|pen[ií]nsulas?|archipi[eé]lagos?|deltas?|arrecifes?|fiordos?)\b/i;

function buildFeatures(data) {
  const rows = data.dams.slice().sort((a, b) => b.potenciaMW - a.potenciaMW || a.nombre.localeCompare(b.nombre));
  const powers = rows.map((r) => r.potenciaMW);
  const minMW = powers[powers.length - 1];
  const maxMW = powers[0];
  const ramp = monoBlueRamp(rows.length);

  return rows.map((r, idx) => {
    // fila 0 = presa más potente → color más oscuro (final de la rampa)
    const color = ramp[ramp.length - 1 - idx];
    const mwTxt = `${fmtEs(r.potenciaMW, Number.isInteger(r.potenciaMW) ? 0 : 1)} MW`;
    const description =
      `${r.nombre} es una central hidroeléctrica de ${mwTxt} en el río ${r.rio} (${r.pais}), ` +
      `puesta en servicio en ${r.puestaEnServicio}. ${r.nota}`;

    return {
      type: 'Feature',
      properties: {
        _manaName: r.nombre,
        name: r.nombre,
        _manaColor: color,
        _manaFillOpacity: 0.92,
        _manaWeight: 1.2,
        _manaBorderColor: '#ffffff',
        _manaGeometryType: 'point',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        markerType: MARKER_TYPE,
        _manaMarkerType: MARKER_TYPE,
        _manaEmojiSize: emojiSizeForMW(r.potenciaMW, minMW, maxMW),
        _manaLabelStyle: {
          enabled: true,
          field: '_manaName',
          fontFamily: 'monospace',
          fontSize: 10,
          fontWeight: '600',
          color: '#0f172a',
          haloWidth: 3,
          haloColor: '#ffffff',
          opacity: 0.92,
          placement: 'auto',
        },
        // Datos concretos de popup (AGENTS.md §5) — claves en español
        'Potencia (MW)': r.potenciaMW,
        'Potencia instalada': mwTxt,
        País: r.pais,
        Río: r.rio,
        'Puesta en servicio': r.puestaEnServicio,
        Dato: `${mwTxt} · ${r.pais} · ${r.rio}`,
        Description: description,
      },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    };
  });
}

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
  const pointOk = features.every((f) => f.geometry.type === 'Point');
  const coordsOk = features.every((f) => {
    const [x, y] = f.geometry.coordinates;
    return x >= -180 && x <= 180 && y >= -90 && y <= 90;
  });
  const names = new Set(features.map((f) => f.properties._manaName));
  const uniqueOk = names.size === features.length;
  const popupOk = features.every((f) =>
    ['Potencia (MW)', 'Potencia instalada', 'País', 'Río', 'Puesta en servicio', 'Dato', 'Description'].every(
      (k) => f.properties[k] != null && f.properties[k] !== ''
    )
  );
  const powerOk = features.every((f) => Number.isFinite(f.properties['Potencia (MW)']) && f.properties['Potencia (MW)'] > 0);
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));
  const countOk = features.length === data.dams.length;
  // Ordenadas de mayor a menor potencia → color oscuro primero: R no decreciente.
  const rampOrdered = (() => {
    const rs = features.map((f) => parseInt(f.properties._manaColor.slice(1, 3), 16));
    let nonDec = 0;
    for (let i = 1; i < rs.length; i++) if (rs[i] >= rs[i - 1]) nonDec++;
    return nonDec >= rs.length - 2;
  })();

  console.log(`features: ${features.length} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala: ${scaleOk} | Point: ${pointOk}`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | potencia: ${powerOk} | sin palabras de área: ${areaNameOk} | rampa ordenada: ${rampOrdered} | conteos: ${countOk}`);
  const ws = features.map((f) => f.properties['Potencia (MW)']);
  console.log(`potencia: min ${fmtEs(Math.min(...ws))} MW · max ${fmtEs(Math.max(...ws))} MW`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || !pointOk || !coordsOk || !uniqueOk || !popupOk || !powerOk || !areaNameOk || !rampOrdered || !countOk) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nTop 10:');
  for (const f of features.slice(0, 10)) {
    console.log(`  ${fmtEs(f.properties['Potencia (MW)'])} MW — ${f.properties._manaName} (${f.properties.País})`);
  }
}

main();
