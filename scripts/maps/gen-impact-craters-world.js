#!/usr/bin/env node
// ── gen-impact-craters-world.js ─
// Genera data/maps/impact-craters-world.geojson a partir del extracto curado
// data/sources/impact-craters-world/craters.json (Earth Impact Database,
// Planetary and Space Science Centre, University of New Brunswick; compilación
// publicada en Wikipedia «List of impact structures on Earth»).
// Una feature Point por estructura de impacto real, markerType emoji_collision,
// icono escalado por el diámetro (_manaEmojiSize, escala logarítmica) y rampa
// monocromática ocre ordenada por ese diámetro (AGENTS.md §3).
//
// Uso: node scripts/maps/gen-impact-craters-world.js

'use strict';

const fs = require('fs');
const path = require('path');

const SLUG = 'impact-craters-world';
const SRC_JSON = path.join(__dirname, '..', '..', 'data', 'sources', SLUG, 'craters.json');
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);

const GROUP_NAME = 'Cráteres de impacto confirmados';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_collision';
const LEGEND_KEY = 'Diámetro (km)';
const DATA_SOURCE =
  'Earth Impact Database (Planetary and Space Science Centre, University of New Brunswick) — ' +
  'compilación de estructuras de impacto confirmadas publicada en Wikipedia, «List of impact structures on Earth».';
const DATA_DATE = '2026-10-29';

function fmtEs(n, dec = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Number(n).toFixed(dec);
  const [i, d] = s.split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d ? `${ii},${d}` : ii;
}

function hslToHex(h, s, l) {
  const S = s / 100, L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  const hx = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

// Rampa monocromática ocre (claro→oscuro) ordenada por el diámetro.
function monoOchreRamp(steps = 6) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    out.push(hslToHex(30, 42 + t * 38, 84 - t * 58)); // 84% → 26% luminosidad
  }
  return out;
}

function emojiSizeForDiameter(km) {
  // Escala logarítmica: 30 km → 22 px ; 160 km → 66 px (rango 22-66)
  const t = Math.max(0, Math.min(1, (Math.log(km) - Math.log(30)) / (Math.log(160) - Math.log(30))));
  return Math.round(22 + t * 44);
}

function buildFeatures(rows) {
  const sorted = rows.slice().sort((a, b) => b.diametroKm - a.diametroKm);
  const diameters = sorted.map((r) => r.diametroKm);
  const ramp = monoOchreRamp(6);

  function colorForDiameter(d) {
    const below = diameters.filter((v) => v <= d).length;
    const t = diameters.length <= 1 ? 1 : (below - 1) / (diameters.length - 1);
    const idx = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
    return ramp[idx];
  }

  const out = [];
  const seen = new Set();
  for (const r of sorted) {
    let name = r.nombre;
    let unique = name, dup = 2;
    while (seen.has(unique)) { unique = `${name} (${dup})`; dup++; }
    seen.add(unique);

    const description =
      `${r.nombre} es una estructura de impacto de ${r.diametroTexto} en ${r.region}, ` +
      `${r.pais}, formada hace ${r.edadTexto}. ${r.nota}`;

    out.push({
      type: 'Feature',
      properties: {
        _manaName: unique,
        name: unique,
        _manaColor: colorForDiameter(r.diametroKm),
        _manaFillOpacity: 0.92,
        _manaWeight: 1.2,
        _manaBorderColor: '#ffffff',
        _manaGeometryType: 'point',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        markerType: MARKER_TYPE,
        _manaMarkerType: MARKER_TYPE,
        _manaEmojiSize: emojiSizeForDiameter(r.diametroKm),
        _manaLabelStyle: {
          enabled: true,
          field: '_manaName',
          fontFamily: 'monospace',
          fontSize: 10,
          fontWeight: '600',
          color: '#1c1917',
          haloWidth: 3,
          haloColor: '#ffffff',
          opacity: 0.92,
          placement: 'auto',
        },
        // Datos concretos de popup (AGENTS.md §5) — claves en español
        'Diámetro (km)': r.diametroKm,
        'Edad (Ma)': r.edadMa,
        Edad: r.edadTexto,
        País: r.pais,
        Región: r.region,
        'Superficie (km²)': r.superficieKm2,
        Dato: `${r.diametroTexto} · hace ${r.edadTexto}`,
        Description: description,
      },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    });
  }
  return out;
}

function main() {
  const doc = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  const features = buildFeatures(doc.craters);
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
    ['Diámetro (km)', 'Edad (Ma)', 'Edad', 'País', 'Región', 'Dato', 'Description']
      .every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const diametersOk = features.every((f) => Number.isFinite(f.properties['Diámetro (km)']) && f.properties['Diámetro (km)'] >= 30);
  const typeOk = features.every((f) => f.geometry.type === 'Point');
  // Ramp ordenable: a mayor diámetro, color más oscuro → canal R menor.
  // features va ordenado de mayor a menor diámetro, así que R no debe decrecer.
  const rampOrdered = (() => {
    const rs = features.map((f) => parseInt(f.properties._manaColor.slice(1, 3), 16));
    let nonDec = 0;
    for (let i = 1; i < rs.length; i++) if (rs[i] >= rs[i - 1]) nonDec++;
    return nonDec >= rs.length - 2;
  })();

  console.log(`features: ${features.length} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala log: ${scaleOk} | punto: ${typeOk}`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | diámetros: ${diametersOk} | rampa ordenada: ${rampOrdered}`);
  const ds = features.map((f) => f.properties['Diámetro (km)']);
  console.log(`diámetro: min ${fmtEs(Math.min(...ds))} km · max ${fmtEs(Math.max(...ds))} km`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || !coordsOk || !uniqueOk || !popupOk || !diametersOk || !typeOk || !rampOrdered) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nTop 10:');
  for (const f of features.slice(0, 10)) {
    console.log(`  ${fmtEs(f.properties['Diámetro (km)'])} km  ${f.properties.País}  ${f.properties._manaName}`);
  }
}

main();
