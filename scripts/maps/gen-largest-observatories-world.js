#!/usr/bin/env node
// ── gen-largest-observatories-world.js ─
// Genera data/maps/largest-observatories-world.geojson a partir del dataset
// curado ~/autopilot/strategy/data/largest-observatories-world/sites.json
// (Wikipedia «List of largest optical reflecting telescopes» + «List of highest
// astronomical observatories»; coordenadas de Wikidata P625 y altitudes P2044).
//
// Una feature Point por recinto astronómico real (nunca por país o región):
// markerType emoji_star, icono escalado por la apertura del mayor telescopio
// del sitio y rampa monocromática índigo ordenada por esa apertura (AGENTS.md §3).
// Los cuatro telescopios del VLT y los cuatro de Mauna Kea comparten recinto, así
// que se agrupan en un único punto para no apilar iconos y etiquetas idénticas.
//
// Uso: node scripts/maps/gen-largest-observatories-world.js

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SLUG = 'largest-observatories-world';
const SRC_JSON = path.join(
  os.homedir(),
  'autopilot/strategy/data/largest-observatories-world/sites.json'
);
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);

const GROUP_NAME = 'Observatorios ópticos por apertura del mayor telescopio';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_star';
const DATA_SOURCE =
  'Wikipedia «List of largest optical reflecting telescopes» (aperturas efectivas, tipo de espejo, país, sitio y primera luz) y «List of highest astronomical observatories» (altitud); coordenadas verificadas en Wikidata (P625) y altitudes en Wikidata (P2044) y en las fichas de cada observatorio.';
const DATA_DATE = '2026-11-16';

function fmtEs(n, dec = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Number(n).toFixed(dec);
  const [i, d] = s.split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d ? `${ii},${d}` : ii;
}

// Rampa monocromática índigo (claro→oscuro) ordenada por apertura.
function monoIndigoRamp(steps = 5) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 88 - t * 62; // 88% → 26% luminosidad
    const s = 45 + t * 40; // 45% → 85% saturación
    const c = (1 - Math.abs(2 * (l / 100) - 1)) * (s / 100);
    const hp = 245 / 60; // matiz ~245° (índigo nocturno)
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const m = l / 100 - c / 2;
    const [r1, g1, b1] = [0, x, c]; // 4 <= hp < 5
    const r = Math.round((r1 + m) * 255);
    const g = Math.round((g1 + m) * 255);
    const b = Math.round((b1 + m) * 255);
    const hx = (v) => v.toString(16).padStart(2, '0');
    out.push(`#${hx(r)}${hx(g)}${hx(b)}`);
  }
  return out;
}

function emojiSizeForAperture(a) {
  // 4,0 m → 26 px ; 11,9 m → 64 px (rango soportado 22-66)
  const t = Math.max(0, Math.min(1, (a - 4) / (11.9 - 4)));
  return Math.round(26 + t * 38);
}

function buildFeatures(sites) {
  const sorted = sites.slice().sort((a, b) => b.apertura_m - a.apertura_m);
  const aperturas = sorted.map((r) => r.apertura_m);
  const ramp = monoIndigoRamp(5);

  function colorForAperture(a) {
    const below = aperturas.filter((v) => v <= a).length;
    const t = aperturas.length <= 1 ? 1 : (below - 1) / (aperturas.length - 1);
    const idx = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
    return ramp[idx];
  }

  const out = [];
  const seen = new Set();
  for (const r of sorted) {
    const name = r.observatorio;
    let unique = name;
    let dup = 2;
    while (seen.has(unique)) { unique = `${name} (${dup})`; dup++; }
    seen.add(unique);

    const apTxt = `${fmtEs(r.apertura_m, r.apertura_m % 1 === 0 ? 0 : 1)} m`;
    const description =
      `${unique}, en ${r.sitio} (${r.region}, ${r.pais}), a ${fmtEs(r.altitud_m)} m de altitud. ` +
      `Telescopios: ${r.telescopios}. Primera luz: ${r.primera_luz}. ${r.nota}`;

    out.push({
      type: 'Feature',
      properties: {
        _manaName: unique,
        name: unique,
        _manaColor: colorForAperture(r.apertura_m),
        _manaFillOpacity: 0.95,
        _manaWeight: 1.2,
        _manaBorderColor: '#ffffff',
        _manaGeometryType: 'point',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        markerType: MARKER_TYPE,
        _manaMarkerType: MARKER_TYPE,
        _manaEmojiSize: emojiSizeForAperture(r.apertura_m),
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
        'Apertura (m)': r.apertura_m,
        'Altitud (m)': r.altitud_m,
        'Mayor telescopio': r.mayor,
        Telescopios: r.telescopios,
        'Primera luz': r.primera_luz,
        País: r.pais,
        Región: r.region,
        Sitio: r.sitio,
        Superficie: apTxt,
        Dato: `${apTxt} de apertura · ${r.pais}`,
        Description: description,
      },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    });
  }
  return out;
}

function main() {
  const doc = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  const sites = doc.sites;
  const features = buildFeatures(sites);
  const geo = { type: 'FeatureCollection', features };

  // ── Validaciones AGENTS.md ──
  const hexOk = features.every((f) => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = features.every(
    (f) => f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth >= 2 &&
      f.properties._manaLabelStyle.field === '_manaName'
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
    return x >= -180 && x <= 180 && y >= -90 && y <= 90;
  });
  const pointOk = features.every((f) => f.geometry.type === 'Point');
  const names = new Set(features.map((f) => f.properties._manaName));
  const uniqueOk = names.size === features.length;
  const popupOk = features.every((f) =>
    ['Apertura (m)', 'Altitud (m)', 'Telescopios', 'País', 'Dato', 'Description']
      .every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const aperturaOk = features.every(
    (f) => Number.isFinite(f.properties['Apertura (m)']) && f.properties['Apertura (m)'] >= 4 &&
      f.properties['Apertura (m)'] <= 12
  );
  const altitudOk = features.every(
    (f) => Number.isFinite(f.properties['Altitud (m)']) && f.properties['Altitud (m)'] >= 800
  );
  const AREA_RE = /(?:^|\s)(?:pa[ií]ses?|regi[oó]ns?|desiertos?|cordilleras?|continentes?|islas?|valles?)\b/i;
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));
  // La rampa debe ser ordenable por el dato: más apertura → color más oscuro.
  const lum = (hexStr) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hexStr.slice(i, i + 2), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const rampOrdered = (() => {
    const ls = features.map((f) => lum(f.properties._manaColor));
    let nonInc = 0;
    for (let i = 1; i < ls.length; i++) if (ls[i] >= ls[i - 1]) nonInc++;
    return nonInc >= ls.length - 2;
  })();
  const sortedDesc = features.every(
    (f, i) => i === 0 || f.properties['Apertura (m)'] <= features[i - 1].properties['Apertura (m)']
  );

  console.log(`features: ${features.length} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala: ${scaleOk} | Point: ${pointOk}`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | apertura: ${aperturaOk} | altitud: ${altitudOk}`);
  console.log(`sin palabras de área: ${areaNameOk} | rampa ordenada: ${rampOrdered} | orden desc: ${sortedDesc}`);
  const paises = {};
  for (const f of features) paises[f.properties.País] = (paises[f.properties.País] || 0) + 1;
  console.log('países:', JSON.stringify(paises));
  const as = features.map((f) => f.properties['Apertura (m)']);
  console.log(`apertura: ${fmtEs(Math.min(...as), 1)} m · ${fmtEs(Math.max(...as), 1)} m`);

  if (!hexOk || !haloOk || !markerOk || !scaleOk || !pointOk || !coordsOk || !uniqueOk ||
      !popupOk || !aperturaOk || !altitudOk || !areaNameOk || !rampOrdered || !sortedDesc) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nRanking:');
  for (const f of features) {
    console.log(
      `  ${fmtEs(f.properties['Apertura (m)'], 1).padStart(5)} m  ` +
      `${String(f.properties['Altitud (m)']).padStart(5)} m alt  ` +
      `${f.properties.País.padEnd(14)} ${f.properties._manaName}`
    );
  }
}

main();
