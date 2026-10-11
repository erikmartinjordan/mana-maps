#!/usr/bin/env node
// ── gen-most-populated-cities-world.js ─
// Genera data/most-populated-cities-world.geojson a partir del extracto UN
// ~/autopilot/strategy/data/most-populated-cities-world/cities-2025.json
// (World Urbanization Prospects: The 2025 Revision, Population Division de la
// ONU — Archivo F18 «The 100 Largest Cities Ranked by Population Size»,
// estimación a 2025; centroides poblacionales PWCent con lat/lng).
// Una feature Point por ciudad real, markerType emoji_building, icono escalado
// por población (_manaEmojiSize, escala logarítmica) y rampa monocromática
// violeta ordenada por la población (AGENTS.md §3).
//
// Uso: node scripts/gen-most-populated-cities-world.js

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SLUG = 'most-populated-cities-world';
const SRC_JSON = path.join(
  os.homedir(),
  'autopilot/strategy/data/most-populated-cities-world/cities-2025.json'
);
const OUT_PATH = path.join(__dirname, '..', 'data', `${SLUG}.geojson`);

const GROUP_NAME = 'Ciudades por población';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_building';
const DATA_SOURCE =
  'Naciones Unidas, División de Población (DESA): World Urbanization Prospects: The 2025 Revision, Online Edition — ' +
  'Archivo F18 «The 100 Largest Cities Ranked by Population Size» (estimación a 2025, consistente con WPP 2024).';
const DATA_DATE = '2025';

// ── Nombres de ciudad en español (clave = City_Name del archivo UN) ────────
const CITY_ES = {
  'Jakarta': 'Yakarta',
  'Dhaka': 'Daca',
  'Tōkyō (Tokyo)': 'Tokio',
  'New Delhi': 'Nueva Delhi',
  'Shanghai': 'Shanghái',
  'Guangzhou': 'Guangzhou',
  'Al-Qahirah (Cairo)': 'El Cairo',
  'Manila': 'Manila',
  'Kolkata': 'Calcuta',
  'Seoul': 'Seúl',
  'Karachi': 'Karachi',
  'Mumbai': 'Mumbai',
  'São Paulo': 'São Paulo',
  'Krung Thep Maha Nakhon (Bangkok)': 'Bangkok',
  'Ciudad de México (Mexico City)': 'Ciudad de México',
  'Beijing': 'Pekín',
  'Lahore': 'Lahore',
  'Istanbul': 'Estambul',
  'Moskva (Moscow)': 'Moscú',
  'Ho Chi Minh City': 'Ciudad Ho Chi Minh',
  'Buenos Aires': 'Buenos Aires',
  'New York City': 'Nueva York',
  'Shenzhen': 'Shenzhen',
  'Bengaluru': 'Bengaluru',
  'Osaka': 'Osaka',
  'Lagos': 'Lagos',
  'Los Angeles': 'Los Ángeles',
  'Luanda': 'Luanda',
  'Chennai': 'Chennai',
  'Kinshasa': 'Kinsasa',
  'Bogotá': 'Bogotá',
  'Lima': 'Lima',
  'London': 'Londres',
  'Hajipur': 'Hajipur',
  'Rio de Janeiro': 'Río de Janeiro',
  'Paris': 'París',
  'Hyderabad': 'Hyderabad',
  'Tehrān (Tehran)': 'Teherán',
  'Taipei': 'Taipéi',
  'Bandung': 'Bandung',
  'Kuala Lumpur': 'Kuala Lumpur',
  'Dar es Salaam': 'Dar es Salaam',
  'Suzhou': 'Suzhou',
  'Ahmedabad': 'Ahmedabad',
  'Hangzhou': 'Hangzhou',
  'Wuhan': 'Wuhan',
  'Tianjin': 'Tianjin',
  'Alexandria': 'Alejandría',
  'Nagoya': 'Nagoya',
  'Johannesburg': 'Johannesburgo',
  'Chongqing': 'Chongqing',
  'Ar-Riyāḑ (Riyadh)': 'Riad',
  'Surat': 'Surat',
  'Surabaya': 'Surabaya',
  'Pune': 'Pune',
  'Al-Kharṭūm (Khartoum)': 'Jartum',
  'Nanjing': 'Nankín',
  'Santiago': 'Santiago',
  'Ādīs Ᾱbeba (Addis Ababa)': 'Adís Abeba',
  'Abidjan': 'Abiyán',
  'Chaozhou': 'Chaozhou',
  'Ammān (Amman)': 'Amán',
  'Baghdād (Baghdad)': 'Bagdad',
  'Chengdu': 'Chengdu',
  'Nairobi': 'Nairobi',
  'Kozhikode': 'Kozhikode',
  'Shenyang': 'Shenyang',
  'Kābul (Kabul)': 'Kabul',
  'Onitsha': 'Onitsha',
  'Yangon': 'Rangún',
  'Accra': 'Acra',
  'Madrid': 'Madrid',
  'Faisalabad': 'Faisalabad',
  'Toronto': 'Toronto',
  'Mashhad': 'Mashhad',
  'Dubai': 'Dubái',
  "Xi'an": "Xi'an",
  'Sri Jayawardenepura Kotte - Colombo': 'Colombo',
  'Yaoundé': 'Yaundé',
  'Kochi': 'Kochi',
  'Hà Nội (Hanoi)': 'Hanói',
  'Lucknow': 'Lucknow',
  'Chattogram': 'Chattogram',
  'Singapore': 'Singapur',
  'Kampala': 'Kampala',
  'Zhengzhou': 'Zhengzhou',
  'Hefei': 'Hefei',
  'Islāmābād': 'Islamabad',
  'Kano': 'Kano',
  'Tamar (Hong Kong)': 'Hong Kong',
  'Saint Petersburg': 'San Petersburgo',
  'Santo Domingo': 'Santo Domingo',
  'Cape Town': 'Ciudad del Cabo',
  'Casablanca': 'Casablanca',
  'Muqdisho (Mogadishu)': 'Mogadiscio',
  'Harbin': 'Harbin',
  'Kanpur': 'Kanpur',
  'Kumasi': 'Kumasi',
  'Dimashq (Damascus)': 'Damasco',
  'Jeddah': 'Yeda',
};

// ── Países en español (clave = Location del archivo UN) ────────────────────
const COUNTRY_ES = {
  'Indonesia': 'Indonesia',
  'Bangladesh': 'Bangladés',
  'Japan': 'Japón',
  'India': 'India',
  'China': 'China',
  'Egypt': 'Egipto',
  'Philippines': 'Filipinas',
  'Republic of Korea': 'Corea del Sur',
  'Pakistan': 'Pakistán',
  'Brazil': 'Brasil',
  'Thailand': 'Tailandia',
  'Mexico': 'México',
  'Türkiye': 'Turquía',
  'Russian Federation': 'Rusia',
  'Viet Nam': 'Vietnam',
  'Argentina': 'Argentina',
  'United States of America': 'Estados Unidos',
  'Angola': 'Angola',
  'Democratic Republic of the Congo': 'República Democrática del Congo',
  'Colombia': 'Colombia',
  'Peru': 'Perú',
  'United Kingdom': 'Reino Unido',
  'France': 'Francia',
  'Iran (Islamic Republic of)': 'Irán',
  'China, Taiwan Province of China': 'Taiwán (China)',
  'Malaysia': 'Malasia',
  'United Republic of Tanzania': 'Tanzania',
  'Sudan': 'Sudán',
  'Chile': 'Chile',
  'Ethiopia': 'Etiopía',
  "Côte d'Ivoire": 'Costa de Marfil',
  'Jordan': 'Jordania',
  'Iraq': 'Irak',
  'Kenya': 'Kenia',
  'Afghanistan': 'Afganistán',
  'Myanmar': 'Myanmar',
  'Ghana': 'Ghana',
  'Spain': 'España',
  'Canada': 'Canadá',
  'United Arab Emirates': 'Emiratos Árabes Unidos',
  'Sri Lanka': 'Sri Lanka',
  'Cameroon': 'Camerún',
  'Uganda': 'Uganda',
  'Singapore': 'Singapur',
  'Dominican Republic': 'República Dominicana',
  'South Africa': 'Sudáfrica',
  'Morocco': 'Marruecos',
  'Somalia': 'Somalia',
  'Syrian Arab Republic': 'Siria',
  'Saudi Arabia': 'Arabia Saudí',
  'China, Hong Kong SAR': 'Hong Kong (China)',
};

function fmtEs(n, dec = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Number(n).toFixed(dec);
  const [i, d] = s.split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d ? `${ii},${d}` : ii;
}

// HSL → hex (conversión genérica, evita el atajo de sectores usado en otros
// scripts que solo es correcto para ciertos matices).
function hslToHex(h, s, l) {
  const S = s / 100, L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1));
  const hx = (v) => Math.round(255 * v).toString(16).padStart(2, '0');
  return `#${hx(f(0))}${hx(f(8))}${hx(f(4))}`;
}

// Rampa monocromática violeta (claro→oscuro) ordenada por la población.
function monoVioletRamp(steps = 6) {
  const HUE = 262; // violeta
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 86 - t * 56; // 86% → 30% luminosidad
    const s = 48 + t * 32; // 48% → 80% saturación
    out.push(hslToHex(HUE, s, l));
  }
  return out;
}

// Escala del icono por población (logarítmica): 4,28 M → 22 px; 41,9 M → 66 px.
function emojiSizeForPop(pop, min, max) {
  const lo = Math.log(min), hi = Math.log(max);
  const t = hi === lo ? 1 : (Math.log(pop) - lo) / (hi - lo);
  return Math.round(22 + Math.max(0, Math.min(1, t)) * 44);
}

function buildFeatures(rows) {
  const sorted = rows.slice().sort((a, b) => b.popThousands - a.popThousands);
  const pops = sorted.map((r) => r.popThousands);
  const ramp = monoVioletRamp(6);
  const minPop = pops[pops.length - 1];
  const maxPop = pops[0];

  // Porcentaje de ciudades igual o menos pobladas → paso de rampa
  // (claro = menos poblada, oscura = más poblada).
  function colorForPop(p) {
    const below = pops.filter((v) => v <= p).length;
    const t = pops.length <= 1 ? 1 : (below - 1) / (pops.length - 1);
    const idx = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
    return ramp[idx];
  }

  const out = [];
  const seen = new Set();
  for (const r of sorted) {
    const name = CITY_ES[r.city] || r.city;
    let unique = name, dup = 2;
    while (seen.has(unique)) { unique = `${name} (${dup})`; dup++; }
    seen.add(unique);

    const pais = COUNTRY_ES[r.country] || r.country;
    const pop = Math.round(r.popThousands * 1000);
    const popTxt = `${fmtEs(pop)} habitantes`;
    const areaTxt = Number.isFinite(r.landAreaKm2) ? `${fmtEs(r.landAreaKm2)} km²` : '—';
    const capitalTxt = r.capital ? `Es la capital de ${pais}.` : '';
    const description = [
      `Ciudad de ${popTxt} en ${pais}, puesto ${r.rank}º de las 100 mayores del mundo ` +
        '(Naciones Unidas, World Urbanization Prospects 2025).',
      `Superficie urbana: ${areaTxt}.`,
      capitalTxt,
    ].filter(Boolean).join(' ');

    out.push({
      type: 'Feature',
      properties: {
        _manaName: unique,
        name: unique,
        _manaColor: colorForPop(r.popThousands),
        _manaFillOpacity: 0.9,
        _manaWeight: 1.2,
        _manaBorderColor: '#ffffff',
        _manaGeometryType: 'point',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        markerType: MARKER_TYPE,
        _manaMarkerType: MARKER_TYPE,
        _manaEmojiSize: emojiSizeForPop(r.popThousands, minPop, maxPop),
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
        'Población (hab.)': pop,
        Puesto: r.rank,
        País: pais,
        Capital: r.capital ? 'Sí' : 'No',
        'Superficie (km²)': Number.isFinite(r.landAreaKm2) ? r.landAreaKm2 : null,
        Superficie: areaTxt,
        Dato: `${popTxt} · ${pais}`,
        Description: description,
      },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    });
  }
  return out;
}

// Nombre que denota entidad-área (idéntico al de audit-gallery-quality.js §9).
const AREA_RE = new RegExp(
  '(?:^|\\s)(?:' +
    'desiertos?|deserts?|sahara|gobi|kalahari|atacama|taklamakan|sahel|patagonia|namib|' +
    'pa[ií]ses?|countries|regi[oó]ns?|regions?|' +
    'islas?|islands?|oc[eé]anos?|oceans?|' +
    'mar de|mares?|seas?|lagos?|lakes?|' +
    'bosques?|forests?|glaciares?|glaciers?|' +
    'cordilleras?|sierras?|mesetas?|sabanas?|tundras?|taigas?|praderas?|steppes?|' +
    'pen[ií]nsulas?|peninsulas?|archipi[eé]lagos?|archipelagos?|deltas?|arrecifes?|reefs?' +
  ')\\b', 'i');

// Homónimos de área que en realidad son ciudades reales (Lagos, Nigeria).
const AREA_NAME_EXCEPTIONS = new Set(['lagos']);
function isAreaEntityName(name) {
  if (!name || typeof name !== 'string') return false;
  const first = name.trim().split(/[\s(,]/)[0].toLowerCase();
  if (AREA_NAME_EXCEPTIONS.has(first)) return false;
  return AREA_RE.test(name);
}

function main() {
  if (!fs.existsSync(SRC_JSON)) {
    console.error('ERROR: no existe el extracto UN', SRC_JSON);
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
    ['Población (hab.)', 'País', 'Dato', 'Description'].every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const popsOk = features.every((f) => Number.isFinite(f.properties['Población (hab.)']) && f.properties['Población (hab.)'] >= 4000000);
  const areaNameOk = features.every((f) => !isAreaEntityName(f.properties._manaName));
  const translatedOk = features.every((f) => f.properties.País && f.properties.País !== '');
  // features ordenadas de mayor a menor población → color oscura primero,
  // así que el canal R debe ser no decreciente (permite empates de rampa).
  const rampOrdered = (() => {
    const rs = features.map((f) => parseInt(f.properties._manaColor.slice(1, 3), 16));
    let nonDec = 0;
    for (let i = 1; i < rs.length; i++) if (rs[i] >= rs[i - 1]) nonDec++;
    return nonDec >= rs.length - 2;
  })();

  console.log(`features: ${features.length} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala: ${scaleOk}`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | poblaciones: ${popsOk} | países ES: ${translatedOk}`);
  console.log(`sin palabras de área: ${areaNameOk} | rampa ordenada: ${rampOrdered}`);
  const ps = features.map((f) => f.properties['Población (hab.)']);
  console.log(`población: min ${fmtEs(Math.min(...ps))} · max ${fmtEs(Math.max(...ps))}`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || !coordsOk || !uniqueOk || !popupOk || !popsOk || !areaNameOk || !translatedOk || !rampOrdered) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nTop 10:');
  for (const f of features.slice(0, 10)) {
    console.log(`  ${fmtEs(f.properties['Población (hab.)'])} hab  ${f.properties.País}  ${f.properties._manaName}`);
  }
}

main();
