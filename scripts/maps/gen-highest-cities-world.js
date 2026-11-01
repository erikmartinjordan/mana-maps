#!/usr/bin/env node
// ── gen-highest-cities-world.js ─
// Genera data/maps/highest-cities-world.geojson a partir del extracto curado
// data/sources/highest-cities-world/cities.json.
//
// Tema: los núcleos urbanos permanentes más altos del planeta. Incluye las 20
// ciudades de más de 100.000 habitantes situadas por encima de 2.700 m y
// La Rinconada (Perú), el asentamiento permanente más alto del mundo.
//
// Una feature Point por ciudad real, markerType emoji_mountain, icono escalado
// por la altitud (_manaEmojiSize, 22-66 px) y rampa monocromática terracota
// ordenada por esa altitud (AGENTS.md §3).
//
// Además de la altitud y la población, cada popup muestra dos datos derivados
// con fórmulas estándar: la presión atmosférica respecto al nivel del mar
// (atmósfera estándar) y el punto de ebullición del agua a esa altitud
// (Clausius-Clapeyron).
//
// Uso: node scripts/maps/gen-highest-cities-world.js

'use strict';

const fs = require('fs');
const path = require('path');

const SLUG = 'highest-cities-world';
const SRC_JSON = path.join(__dirname, '..', '..', 'data', 'sources', SLUG, 'cities.json');
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);

const GROUP_NAME = 'Ciudades de altura';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_mountain';
const LEGEND_KEY = 'Altitud';
const RAMP_STEPS = 8;
const RAMP = monoTerracottaRamp(RAMP_STEPS);

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

// Rampa monocromática terracota (claro→oscuro) ordenada por la altitud.
function monoTerracottaRamp(steps = RAMP_STEPS) {
  const HUE = 18;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 87 - t * 54; // 87% → 33% luminosidad
    const s = 58 + t * 32; // 58% → 90% saturación
    out.push(hslToHex(HUE, s, l));
  }
  return out;
}

// El icono crece con la altitud: 2.754 m → 22 px; 5.100 m → 66 px.
function emojiSizeForAltitude(m, min, max) {
  const t = max === min ? 1 : (m - min) / (max - min);
  return Math.round(22 + Math.max(0, Math.min(1, t)) * 44);
}

// Presión atmosférica (atmósfera estándar internacional) respecto al nivel del mar.
function pressureRatio(altitudM) {
  return Math.pow(1 - 2.25577e-5 * altitudM, 5.25588);
}

// Punto de ebullición del agua a esa presión (Clausius-Clapeyron).
// ΔHvap = 40.650 J/mol; T0 = 373,15 K a 101.325 Pa.
function boilingPointC(altitudM) {
  const pRatio = pressureRatio(altitudM);
  const R = 8.314462618;
  const dH = 40650;
  const invT = 1 / 373.15 - (R / dH) * Math.log(pRatio);
  return 1 / invT - 273.15;
}

function colorStepForRank(rank, total, steps) {
  if (total <= 1) return steps - 1;
  return Math.round((1 - rank / (total - 1)) * (steps - 1));
}

function buildFeatures(data) {
  const rows = data.ciudades
    .slice()
    .sort((a, b) => b.altitudM - a.altitudM || a.nombre.localeCompare(b.nombre, 'es'));
  const altitudes = rows.map((r) => r.altitudM);
  const minM = Math.min(...altitudes);
  const maxM = Math.max(...altitudes);
  const ramp = RAMP;

  return rows.map((r, rank) => {
    const step = colorStepForRank(rank, rows.length, RAMP_STEPS);
    const color = ramp[step];
    const altTxt = `${fmtEs(r.altitudM)} m`;
    const popTxt = `${fmtEs(r.poblacion)} hab. (${r.anioPoblacion})`;
    const pct = Math.round(pressureRatio(r.altitudM) * 100);
    const boiling = Math.round(boilingPointC(r.altitudM));

    return {
      type: 'Feature',
      properties: {
        _manaName: r.nombre,
        name: r.nombre,
        _manaColor: color,
        _manaFillOpacity: 0.9,
        _manaWeight: 1.2,
        _manaBorderColor: '#ffffff',
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
          color: '#3b1a0c',
          haloColor: '#ffffff',
          haloWidth: 3,
          opacity: 1,
          offsetX: 0,
          offsetY: -30,
          placement: 'auto',
        },
        // Datos concretos de popup (AGENTS.md §5) — claves en español
        País: r.pais,
        Región: r.region,
        Elevación: altTxt,
        Altitud: r.altitudM,
        Población: popTxt,
        'Población (hab.)': r.poblacion,
        Año: r.anioPoblacion,
        'Presión atmosférica': `${pct} % del nivel del mar`,
        'Hierve el agua a': `${boiling} °C`,
        Dato: `${altTxt} · ${popTxt} · agua a ${boiling} °C`,
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
    ['País', 'Región', 'Elevación', 'Altitud', 'Población', 'Población (hab.)', 'Año', 'Presión atmosférica', 'Hierve el agua a', 'Dato', 'Description'].every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const altitudeOk = features.every((f) => Number.isFinite(f.properties.Altitud) && f.properties.Altitud >= 2700);
  const populationOk = features.every((f) => Number.isFinite(f.properties['Población (hab.)']) && f.properties['Población (hab.)'] > 0);
  const boilingOk = features.every((f) => {
    const v = parseInt(String(f.properties['Hierve el agua a']), 10);
    return v >= 80 && v <= 95;
  });
  const pressureOk = features.every((f) => {
    const v = parseInt(String(f.properties['Presión atmosférica']), 10);
    return v >= 50 && v <= 75;
  });
  const descriptionOk = features.every((f) => !/\bm m\b/.test(f.properties.Description));
  const groupOk = features.every((f) => f.properties._manaGroupName === GROUP_NAME && Number(f.properties._manaGroupId) === GROUP_ID);
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));
  const sizes = new Set(features.map((f) => f.properties._manaEmojiSize));
  // Ordenadas de mayor a menor altitud. La rampa debe oscurecer con la altitud.
  const rampOrdered = (() => {
    for (let i = 1; i < features.length; i++) {
      const prev = features[i - 1].properties.Altitud;
      const cur = features[i].properties.Altitud;
      if (prev < cur) return false;
    }
    const steps = features.map((f) => {
      const idx = RAMP.indexOf(f.properties._manaColor);
      return idx;
    });
    for (let i = 1; i < steps.length; i++) if (steps[i] > steps[i - 1]) return false;
    return true;
  })();
  const coverageOk = data.ciudades.every((c) => c.altitudM >= 2700 && c.poblacion > 0);

  console.log(`features: ${features.length} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala: ${scaleOk} (${sizes.size} tamaños)`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | altitud: ${altitudeOk} | población: ${populationOk}`);
  console.log(`ebullición: ${boilingOk} | presión: ${pressureOk} | sin «m m»: ${descriptionOk} | grupo: ${groupOk} | sin palabras de área: ${areaNameOk}`);
  console.log(`rampa ordenada por altitud: ${rampOrdered} | cobertura ≥2.700 m: ${coverageOk}`);
  const hs = features.map((f) => f.properties.Altitud);
  console.log(`altitud: min ${fmtEs(Math.min(...hs))} m · max ${fmtEs(Math.max(...hs))} m`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || sizes.size < 5 || !coordsOk || !uniqueOk || !popupOk || !altitudeOk || !populationOk || !boilingOk || !pressureOk || !descriptionOk || !groupOk || !areaNameOk || !rampOrdered || !coverageOk) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo, null, 2));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nCiudades por altitud:');
  for (const f of features) {
    console.log(`  ${fmtEs(f.properties.Altitud)} m  ${f.properties.País.padEnd(10)} ${f.properties._manaName.padEnd(15)} emoji ${f.properties._manaEmojiSize}px  ${f.properties['Presión atmosférica']}  agua ${f.properties['Hierve el agua a']}`);
  }
}

main();
