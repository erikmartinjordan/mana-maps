#!/usr/bin/env node
// ── gen-busiest-ports-world.js ─
// Genera data/busiest-ports-world.geojson a partir del extracto curado
// ~/autopilot/strategy/data/busiest-ports-world/ports-es.json
// (Lloyd's List, «One Hundred Container Ports 2025», y World Shipping Council
// «Top 50 Ports», recopilado en Wikipedia «List of busiest container ports»;
// tráfico de contenedores 2024 en TEUs; coordenadas de cada puerto verificadas
// en Wikipedia y Wikidata).
// Una feature Point por puerto real, markerType emoji_ship, icono escalado por
// tráfico anual (_manaEmojiSize, escala logarítmica) y rampa monocromática
// azul marino ordenada por el tráfico (AGENTS.md §3).
//
// Uso: node scripts/gen-busiest-ports-world.js

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SLUG = 'busiest-ports-world';
const SRC_JSON = path.join(
  os.homedir(),
  'autopilot/strategy/data/busiest-ports-world/ports-es.json'
);
const OUT_PATH = path.join(__dirname, '..', 'data', `${SLUG}.geojson`);

const GROUP_NAME = 'Puertos de contenedores por tráfico';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_ship';
const DATA_SOURCE =
  'Lloyd\u2019s List, «One Hundred Container Ports 2025», y World Shipping ' +
  'Council (Top 50 Ports), recopilado en Wikipedia «List of busiest container ' +
  'ports»; tráfico de contenedores 2024 en TEUs. Coordenadas de cada puerto ' +
  'verificadas en Wikipedia y Wikidata.';
const DATA_DATE = '2024';
const LEGEND_KEY = 'Tráfico (TEUs, 2024)';

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

// Rampa monocromática azul marino (claro→oscuro) ordenada por el tráfico.
function monoNavyRamp(steps = 7) {
  const HUE = 208;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 87 - t * 57; // 87% → 30% luminosidad
    const s = 48 + t * 42; // 48% → 90% saturación
    out.push(hslToHex(HUE, s, l));
  }
  return out;
}

// El icono crece con el tráfico (log): 4,014 kTEU → 22 px; 51.506 kTEU → 66 px.
function emojiSizeForTeus(v, min, max) {
  const lo = Math.log(min), hi = Math.log(max);
  const t = hi === lo ? 1 : (Math.log(v) - lo) / (hi - lo);
  return Math.round(22 + Math.max(0, Math.min(1, t)) * 44);
}

const NOTES = {
  'Shanghái': 'Es el puerto de contenedores más transitado del mundo y el primero en superar los 50 millones de TEUs en un año.',
  'Singapur': 'Es el segundo puerto del mundo y el mayor centro de transbordo (hub) de contenedores del planeta.',
  'Ningbo-Zhoushan': 'Es el tercer puerto del mundo y el de mayor tráfico de carga total (contenedores y graneles).',
  'Shenzhen': 'Es el cuarto puerto del mundo y uno de los mayores de China, junto al delta del río de las Perlas.',
  'Róterdam': 'Es el mayor puerto de Europa y el principal acceso marítimo del continente.',
  'Los Ángeles': 'Junto con Long Beach forma el mayor complejo portuario de contenedores de América.',
  'Long Beach': 'Comparte con Los Ángeles la bahía de San Pedro, el mayor complejo portuario de América.',
  'Nueva York / Nueva Jersey': 'Es el mayor puerto de la costa este de Estados Unidos.',
  'El Pireo': 'Es el mayor puerto de Grecia y uno de los principales del Mediterráneo oriental.',
  'Amberes': 'Es el segundo mayor puerto de Europa, en el estuario del Escalda.',
  'Tánger Med': 'Es el mayor puerto de África y la principal puerta de entrada del Mediterráneo occidental.',
  'Hamburgo': 'Es el mayor puerto de Alemania y el tercero de Europa.',
  'Colón': 'Es el mayor puerto de contenedores de América Latina, a la entrada del canal de Panamá.',
  'Balboa': 'Es uno de los puertos que dan servicio al canal de Panamá, en el lado del Pacífico.',
  'Santos': 'Es el mayor puerto de Brasil y de Latinoamérica.',
  'Algeciras': 'Es el mayor puerto de España y un punto clave del estrecho de Gibraltar.',
  'Valencia': 'Es uno de los principales puertos de contenedores del Mediterráneo.',
};

function buildFeatures(rows) {
  const sorted = rows.slice().sort((a, b) => b.teus2024 - a.teus2024);
  const values = sorted.map((r) => r.teus2024);
  const ramp = monoNavyRamp(7);
  const minV = values[values.length - 1];
  const maxV = values[0];

  function colorForValue(v) {
    const below = values.filter((x) => x <= v).length;
    const t = values.length <= 1 ? 1 : (below - 1) / (values.length - 1);
    const idx = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
    return ramp[idx];
  }

  const out = [];
  const seen = new Set();
  for (const r of sorted) {
    const name = r.nombre;
    let unique = name, dup = 2;
    while (seen.has(unique)) { unique = `${name} (${dup})`; dup++; }
    seen.add(unique);

    const teusTxt = `${fmtEs(r.teus2024)} TEUs`;
    const note = (NOTES[name] || '').trim();
    const description = [
      `El puerto de ${unique} (${r.pais}) movió ${teusTxt} en 2024 y ocupa el puesto ${r.rank}º del mundo por tráfico de contenedores.`,
      note,
    ].filter(Boolean).join(' ');

    out.push({
      type: 'Feature',
      properties: {
        _manaName: unique,
        name: unique,
        _manaColor: colorForValue(r.teus2024),
        _manaFillOpacity: 0.9,
        _manaWeight: 1.2,
        _manaBorderColor: '#ffffff',
        _manaGeometryType: 'point',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        markerType: MARKER_TYPE,
        _manaMarkerType: MARKER_TYPE,
        _manaEmojiSize: emojiSizeForTeus(r.teus2024, minV, maxV),
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
        [LEGEND_KEY]: r.teus2024,
        Puesto: r.rank,
        País: r.pais,
        Dato: `${teusTxt} (2024) · puesto ${r.rank}º del mundo`,
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
    [LEGEND_KEY, 'Puesto', 'País', 'Dato', 'Description'].every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const teusOk = features.every((f) => Number.isFinite(f.properties[LEGEND_KEY]) && f.properties[LEGEND_KEY] > 0);
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));
  // Rampa ordenable: mayor tráfico → color más oscuro. Las features van de
  // mayor a menor valor, así que su luminancia debe ser no decreciente.
  const lums = features.map((f) => {
    const r = parseInt(f.properties._manaColor.slice(1, 3), 16) / 255;
    const g = parseInt(f.properties._manaColor.slice(3, 5), 16) / 255;
    const b = parseInt(f.properties._manaColor.slice(5, 7), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  });
  let ordered = 0;
  for (let i = 1; i < lums.length; i++) if (lums[i] >= lums[i - 1] - 1e-6) ordered++;
  const rampOrdered = ordered >= lums.length - 2;

  console.log(`features: ${features.length} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala: ${scaleOk}`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | TEUs: ${teusOk} | sin palabras de área: ${areaNameOk} | rampa ordenada: ${rampOrdered}`);
  const vs = features.map((f) => f.properties[LEGEND_KEY]);
  console.log(`TEUs: min ${fmtEs(Math.min(...vs))} · max ${fmtEs(Math.max(...vs))}`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || !coordsOk || !uniqueOk || !popupOk || !teusOk || !areaNameOk || !rampOrdered) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nTop 10:');
  for (const f of features.slice(0, 10)) {
    console.log(`  ${fmtEs(f.properties[LEGEND_KEY])} TEUs  ${f.properties.País} — ${f.properties._manaName}`);
  }
}

main();
