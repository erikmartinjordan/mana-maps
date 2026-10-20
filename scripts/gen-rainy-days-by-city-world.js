#!/usr/bin/env node
// ── gen-rainy-days-by-city-world.js ─
// Genera data/rainy-days-by-city-world.geojson a partir del extracto curado
// ~/autopilot/strategy/data/rainy-days-by-city-world/cities-climate.json
// (normales climatológicas 1991–2020 de la Organización Meteorológica Mundial
// y NOAA NCEI, recopiladas de los cuadros climáticos de Wikipedia; días con
// precipitación ≥ 1 mm y precipitación anual acumulada).
// Una feature Point por ciudad real, markerType emoji_rain, icono escalado por
// días de lluvia (_manaEmojiSize, escala logarítmica) y rampa monocromática
// azul ordenada por el dato (AGENTS.md §3).
//
// Uso: node scripts/gen-rainy-days-by-city-world.js

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SLUG = 'rainy-days-by-city-world';
const SRC_JSON = path.join(
  os.homedir(),
  'autopilot/strategy/data/rainy-days-by-city-world/cities-climate.json'
);
const OUT_PATH = path.join(__dirname, '..', 'data', `${SLUG}.geojson`);

const GROUP_NAME = 'Ciudades por días de lluvia';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_rain';
const DATA_SOURCE =
  'Organización Meteorológica Mundial (OMM/WMO), Climate Normals 1991–2020, ' +
  'y NOAA NCEI, recopilados de los cuadros climáticos de Wikipedia ' +
  '(estaciones oficiales de cada ciudad); días con precipitación ≥ 1 mm y ' +
  'precipitación anual acumulada. Coordenadas verificadas en Wikipedia.';
const DATA_DATE = '1991-2020';
const LEGEND_KEY = 'Días de lluvia al año';
const LEGEND_KEY_MM = 'Precipitación anual (mm)';

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

// Rampa monocromática azul lluvia (claro→oscuro) ordenada por los días.
function monoRainRamp(steps = 7) {
  const HUE = 205;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 88 - t * 58; // 88% → 30% luminosidad
    const s = 42 + t * 46; // 42% → 88% saturación
    out.push(hslToHex(HUE, s, l));
  }
  return out;
}

// El icono crece con los días de lluvia (log): 5,4 → 22 px; 188,4 → 66 px.
function emojiSizeForDays(v, min, max) {
  const lo = Math.log(min), hi = Math.log(max);
  const t = hi === lo ? 1 : (Math.log(v) - lo) / (hi - lo);
  return Math.round(22 + Math.max(0, Math.min(1, t)) * 44);
}

const NOTES = {
  'Hamburgo': 'Es la ciudad más lluviosa de esta selección en número de días, pese a no ser la que más milímetros acumula.',
  'Suva': 'Combina muchísimos días de lluvia con casi 3.000 mm anuales, el mayor acumulado de la selección.',
  'Colonia': 'El clima atlántico alemán reparte la lluvia en casi la mitad de los días del año.',
  'Múnich': 'Los frentes alpinos hacen que llueva o nieve más de 180 días al año.',
  'Minsk': 'El clima continental húmedo bielorruso reparte la precipitación en unos 180 días.',
  'Yeda': 'Es la ciudad más seca de la selección: apenas 5 días de lluvia y 60 mm al año.',
  'El Cairo': 'El desierto que rodea la ciudad deja solo unos 11 días de lluvia anuales.',
  'Riad': 'La capital saudí apenas supera los 14 días de lluvia y los 100 mm al año.',
  'Kuwait': 'El golfo Pérsico aporta calor pero muy poca lluvia: unos 19 días al año.',
  'Kuala Lumpur': 'El clima ecuatorial reparte más de 2.800 mm en unos 167 días de lluvia.',
  'Bombay': 'El monzón concentra casi toda la lluvia: más de 2.500 mm en unos 79 días.',
  'Rangún': 'El monzón de Myanmar deja cerca de 2.800 mm anuales.',
  'Medellín': 'Conocida como la «ciudad de la eterna primavera», suma unos 173 días de lluvia.',
  'Quito': 'La altura andina no evita la humedad: llueve más de 160 días al año.',
  'Manaos': 'En plena Amazonia, supera los 150 días de lluvia y los 2.300 mm.',
  'Calcuta': 'El monzón del golfo de Bengala concentra la lluvia en pocos meses.',
  'Daca': 'Es una de las grandes ciudades con más días de lluvia del sur de Asia.',
  'Colombo': 'El monzón del Índico deja más de 2.300 mm anuales.',
  'Bogotá': 'La sabana andina alterna mañanas secas y tardes de aguacero durante buena parte del año.',
  'Londres': 'La fama de lluvioso es relativa: unos 112 días y 615 mm al año, menos que muchas ciudades mediterráneas del norte.',
  'Lisboa': 'El clima mediterráneo concentra la lluvia en invierno: unos 75 días al año.',
};

function buildFeatures(rows) {
  const sorted = rows.slice().sort((a, b) => b.diasLluvia - a.diasLluvia);
  const values = sorted.map((r) => r.diasLluvia);
  const ramp = monoRainRamp(7);
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

    const daysTxt = fmtEs(r.diasLluvia, 1);
    const mmTxt = fmtEs(r.precipitacionMm, 0);
    const note = (NOTES[name] || '').trim();
    const description = [
      `En ${unique} (${r.pais}) llueve una media de ${daysTxt} días al año, con ${mmTxt} mm de precipitación anual (normales 1991–2020, umbral de 1 mm).`,
      note,
    ].filter(Boolean).join(' ');

    out.push({
      type: 'Feature',
      properties: {
        _manaName: unique,
        name: unique,
        _manaColor: colorForValue(r.diasLluvia),
        _manaFillOpacity: 0.9,
        _manaWeight: 1.2,
        _manaBorderColor: '#ffffff',
        _manaGeometryType: 'point',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        markerType: MARKER_TYPE,
        _manaMarkerType: MARKER_TYPE,
        _manaEmojiSize: emojiSizeForDays(r.diasLluvia, minV, maxV),
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
        [LEGEND_KEY]: r.diasLluvia,
        [LEGEND_KEY_MM]: r.precipitacionMm,
        País: r.pais,
        Estación: r.estacion,
        Dato: `${daysTxt} días de lluvia y ${mmTxt} mm al año (1991–2020)`,
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
    [LEGEND_KEY, LEGEND_KEY_MM, 'País', 'Estación', 'Dato', 'Description'].every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const daysOk = features.every((f) => Number.isFinite(f.properties[LEGEND_KEY]) && f.properties[LEGEND_KEY] > 0);
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));
  // Rampa ordenable: más días → color más oscuro. Las features van de mayor a
  // menor valor, así que su luminancia debe ser no decreciente.
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
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | días: ${daysOk} | sin palabras de área: ${areaNameOk} | rampa ordenada: ${rampOrdered}`);
  const vs = features.map((f) => f.properties[LEGEND_KEY]);
  console.log(`días de lluvia: min ${fmtEs(Math.min(...vs), 1)} · max ${fmtEs(Math.max(...vs), 1)}`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || !coordsOk || !uniqueOk || !popupOk || !daysOk || !areaNameOk || !rampOrdered) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nTop 10:');
  for (const f of features.slice(0, 10)) {
    console.log(`  ${fmtEs(f.properties[LEGEND_KEY], 1)} días  ${f.properties.País} — ${f.properties._manaName}`);
  }
}

main();
