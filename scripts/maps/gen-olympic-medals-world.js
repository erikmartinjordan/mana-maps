#!/usr/bin/env node
// ── gen-olympic-medals-world.js ─
// Genera data/maps/olympic-medals-world.geojson:
//   coropleta mundial «Los países con más medallas olímpicas de la historia».
//
// Datos: tabla histórica de medallas de los Juegos Olímpicos de Verano hasta
//   París 2024, publicada por el Comité Olímpico Internacional (Olympics.com)
//   y recopilada en la tabla «All-time Olympic Games medal table» de Wikipedia
//   (consultada en la ejecución). Solo se usan los equipos olímpicos vigentes:
//   los equipos históricos (URSS, RDA, RFA, Checoslovaquia, Yugoslavia, Equipo
//   Unificado, ROC, AIN…) figuran por separado en la fuente y NO se atribuyen
//   a los países sucesores. Los países sin medallas quedan a 0.
// Geometría: Natural Earth 110m + 50m (polígonos oficiales, mismo patrón que
//   gini-index-world; microestados desde 50m).
//
// Rampa §3 AGENTS.md: secuencial monocromática (tono 43°, oro olímpico), 9
//   pasos, ordenada por el dato de claro→oscuro sobre escala logarítmica
//   (1 → 2.774 medallas abarca más de tres órdenes de magnitud). Borde blanco
//   fino. Países sin medallas: gris neutro.
//
// Uso: node scripts/maps/gen-olympic-medals-world.js
'use strict';
const https = require('https'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(ROOT, 'autopilot', 'strategy', 'data', 'olympic-medals-world');
const OUT = path.join(ROOT, 'data', 'maps', 'olympic-medals-world.geojson');

const WIKI_URL = 'https://en.wikipedia.org/wiki/All-time_Olympic_Games_medal_table';
const DATA_SOURCE = 'Comité Olímpico Internacional (COI / Olympics.com) — tabla histórica de medallas de los Juegos Olímpicos de Verano hasta París 2024, recopilada en Wikipedia (All-time Olympic Games medal table, consultada 2026-10). Los equipos históricos (URSS, RDA, RFA, Checoslovaquia, Yugoslavia, Equipo Unificado, ROC, AIN…) se contabilizan por separado y no se atribuyen a los países sucesores. Geometrías: Natural Earth 110m/50m.';

const GROUP_NAME = 'Medallas olímpicas';
const GROUP_ID = 'olympic-medals';
const NUM_KEY = 'Medallas (num)';
const HUE = 43;          // oro olímpico; rampa mono §3
const RAMP_STEPS = 9;
const NO_DATA = '#d9d9d9';

// Equipos históricos: no corresponden a un polígono actual. Se excluyen del
// mapa (y se reportan como huérfanos para que la decisión sea visible).
const HISTORICAL_CODES = new Set([
  'ANZ', 'BOH', 'BWI', 'TCH', 'EUA', 'GDR', 'FRG', 'AHO',
  'EOR', 'RU1', 'URS', 'EUN', 'OAR', 'ROC', 'SCG', 'YUG',
  'AIN', 'IOA', 'IOP', 'ZZX',
]);

// Código COI → ADMIN exacto de Natural Earth (110m o 50m).
const IOC_TO_ADMIN = {
  AFG: 'Afghanistan', ALB: 'Albania', ALG: 'Algeria', ARG: 'Argentina',
  ARM: 'Armenia', AUS: 'Australia', AUT: 'Austria', AZE: 'Azerbaijan',
  BAH: 'The Bahamas', BRN: 'Bahrain', BAR: 'Barbados', BLR: 'Belarus',
  BEL: 'Belgium', BOT: 'Botswana', BRA: 'Brazil', BUL: 'Bulgaria',
  BUR: 'Burkina Faso', BDI: 'Burundi', CMR: 'Cameroon', CAN: 'Canada',
  CPV: 'Cabo Verde', CHI: 'Chile', CHN: 'China', TPE: 'Taiwan',
  COL: 'Colombia', CRC: 'Costa Rica', CRO: 'Croatia', CUB: 'Cuba',
  CYP: 'Cyprus', CZE: 'Czechia', DEN: 'Denmark', DJI: 'Djibouti',
  DMA: 'Dominica', DOM: 'Dominican Republic', ECU: 'Ecuador', EGY: 'Egypt',
  ERI: 'Eritrea', EST: 'Estonia', ETH: 'Ethiopia', FIJ: 'Fiji',
  FIN: 'Finland', FRA: 'France', GAB: 'Gabon', GEO: 'Georgia',
  GER: 'Germany', GHA: 'Ghana', GBR: 'United Kingdom', GRE: 'Greece',
  GRN: 'Grenada', GUA: 'Guatemala', GUY: 'Guyana', HAI: 'Haiti',
  HUN: 'Hungary', ISL: 'Iceland', IND: 'India', INA: 'Indonesia',
  IRI: 'Iran', IRQ: 'Iraq', IRL: 'Ireland', ISR: 'Israel',
  ITA: 'Italy', CIV: 'Ivory Coast', JAM: 'Jamaica', JPN: 'Japan',
  JOR: 'Jordan', KAZ: 'Kazakhstan', KEN: 'Kenya', PRK: 'North Korea',
  KOR: 'South Korea', KOS: 'Kosovo', KUW: 'Kuwait', KGZ: 'Kyrgyzstan',
  LAT: 'Latvia', LBN: 'Lebanon', LIE: 'Liechtenstein', LTU: 'Lithuania',
  LUX: 'Luxembourg', MAS: 'Malaysia', MRI: 'Mauritius', MEX: 'Mexico',
  MDA: 'Moldova', MGL: 'Mongolia', MNE: 'Montenegro', MAR: 'Morocco',
  MOZ: 'Mozambique', NAM: 'Namibia', NED: 'Netherlands', NZL: 'New Zealand',
  NIG: 'Niger', NGR: 'Nigeria', MKD: 'North Macedonia', NOR: 'Norway',
  PAK: 'Pakistan', PAN: 'Panama', PAR: 'Paraguay', PER: 'Peru',
  PHI: 'Philippines', POL: 'Poland', POR: 'Portugal', PUR: 'Puerto Rico',
  QAT: 'Qatar', ROU: 'Romania', RUS: 'Russia', LCA: 'Saint Lucia',
  SAM: 'Samoa', SMR: 'San Marino', KSA: 'Saudi Arabia', SEN: 'Senegal',
  SRB: 'Republic of Serbia', SGP: 'Singapore', SVK: 'Slovakia',
  SLO: 'Slovenia', RSA: 'South Africa', ESP: 'Spain', SRI: 'Sri Lanka',
  SUD: 'Sudan', SUR: 'Suriname', SWE: 'Sweden', SUI: 'Switzerland',
  SYR: 'Syria', TJK: 'Tajikistan', TAN: 'United Republic of Tanzania',
  THA: 'Thailand', TOG: 'Togo', TGA: 'Tonga', TTO: 'Trinidad and Tobago',
  TUN: 'Tunisia', TUR: 'Turkey', TKM: 'Turkmenistan', UGA: 'Uganda',
  UKR: 'Ukraine', UAE: 'United Arab Emirates', USA: 'United States of America',
  URU: 'Uruguay', UZB: 'Uzbekistan', VEN: 'Venezuela', VIE: 'Vietnam',
  ZAM: 'Zambia', ZIM: 'Zimbabwe',
};

// Fallback de nombres en español para features sin NAME_ES útil.
const ADMIN_TO_ES = {
  'United States of America': 'Estados Unidos',
  'United Republic of Tanzania': 'Tanzania',
  'Republic of Serbia': 'Serbia',
  'Czechia': 'República Checa',
  'Ivory Coast': 'Costa de Marfil',
  'Cabo Verde': 'Cabo Verde',
  'The Bahamas': 'Bahamas',
  'North Macedonia': 'Macedonia del Norte',
  'South Korea': 'Corea del Sur',
  'North Korea': 'Corea del Norte',
  'Russia': 'Rusia',
  'Iran': 'Irán',
  'Syria': 'Siria',
  'Laos': 'Laos',
  'Vietnam': 'Vietnam',
  'Moldova': 'Moldavia',
  'Brunei': 'Brunéi',
  'East Timor': 'Timor Oriental',
  'Palestine': 'Palestina',
  'Micronesia': 'Micronesia',
  'Federated States of Micronesia': 'Micronesia',
  'São Tomé and Principe': 'Santo Tomé y Príncipe',
  'Saint Kitts and Nevis': 'San Cristóbal y Nieves',
  'Saint Vincent and the Grenadines': 'San Vicente y las Granadinas',
  'Trinidad and Tobago': 'Trinidad y Tobago',
  'Central African Republic': 'República Centroafricana',
  'Equatorial Guinea': 'Guinea Ecuatorial',
  'Papua New Guinea': 'Papúa Nueva Guinea',
  'Bosnia and Herzegovina': 'Bosnia y Herzegovina',
  'Dominican Republic': 'República Dominicana',
  'United Arab Emirates': 'Emiratos Árabes Unidos',
  'United Kingdom': 'Reino Unido',
  'South Africa': 'Sudáfrica',
  'South Sudan': 'Sudán del Sur',
  'W. Sahara': 'Sáhara Occidental',
  'Gambia': 'Gambia',
  'Northern Cyprus': 'República Turca del Norte de Chipre',
  'Somaliland': 'Somalilandia',
  'Falkland Islands': 'Islas Malvinas',
  'Fr. S. Antarctic Lands': 'Tierras Australes y Antárticas Francesas',
  'Solomon Islands': 'Islas Salomón',
  'Marshall Islands': 'Islas Marshall',
  'Saint Lucia': 'Santa Lucía',
  'Seychelles': 'Seychelles',
  'Mauritius': 'Mauricio',
  'Maldives': 'Maldivas',
  'Comoros': 'Comoras',
  'Bahrain': 'Baréin',
  'Singapore': 'Singapur',
  'Vatican': 'Ciudad del Vaticano',
};

const CONTINENT_ES = {
  Africa: 'África', Asia: 'Asia', Europe: 'Europa',
  'North America': 'América del Norte', 'South America': 'América del Sur',
  Oceania: 'Oceanía', Antarctica: 'Antártida', 'Seven seas (open ocean)': 'Océano',
};

// ── Helpers de color (mismos parámetros que buildMonoRamp del auditor) ──
function hslToHex(h, s, l) {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const hx = n => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}
function buildMonoRamp(hue, steps) {
  const ramp = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    ramp.push(hslToHex(hue, 48 + t * 28, 92 - t * 72)); // l 92%→20%, s 48%→76%
  }
  return ramp;
}

// «2.774» — miles con punto, convención es-ES del resto de la galería.
const fmtInt = v => Math.round(v).toLocaleString('es-ES');

function labelStyle() {
  return {
    enabled: true, fontSize: 11, fontFamily: 'DM Sans, sans-serif',
    fontWeight: '600', color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF',
    placement: 'point', field: '_manaName',
  };
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'mana-maps-publish/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) return fetchText(res.headers.location).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

const stripTags = s => String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();

// Extrae la primera tabla histórica de medallas (la de Juegos de Verano).
function parseAllTimeTable(html) {
  const tableStart = html.indexOf('<table class="wikitable sortable sticky-header-multi"');
  if (tableStart === -1) throw new Error('No se encontró la tabla histórica de medallas');
  const tableEnd = html.indexOf('</table>', tableStart);
  const table = html.slice(tableStart, tableEnd);
  const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];

  const records = [];
  for (const row of rows) {
    const cells = row.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) || [];
    if (cells.length < 6) continue;
    const codeMatch = cells[0].match(/<span id="([A-Z0-9]{2,4})"/);
    if (!codeMatch) continue; // cabecera
    const code = codeMatch[1];
    const nums = cells.slice(2, 6).map(c => {
      const txt = stripTags(c).replace(/[^0-9]/g, '');
      return txt === '' ? null : parseInt(txt, 10);
    });
    if (nums.some(n => !isFinite(n))) continue;
    const [gold, silver, bronze, total] = nums;
    records.push({ code, gold, silver, bronze, total });
  }
  return records;
}

function roundCoords(c) {
  if (typeof c[0] === 'number') return [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100];
  return c.map(roundCoords);
}

// Spearman con media de rangos para empates (validación §3)
function spearmanRho(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  const rank = arr => {
    const s = arr.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
    const r = new Array(arr.length);
    let i = 0;
    while (i < s.length) {
      let j = i;
      while (j + 1 < s.length && s[j + 1].x === s[i].x) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[s[k].i] = avg;
      i = j + 1;
    }
    return r;
  };
  const rv = rank(xs), rl = rank(ys);
  const mean = a => a.reduce((x, y) => x + y, 0) / n;
  const mv = mean(rv), ml = mean(rl);
  let num = 0, dv = 0, dl = 0;
  for (let i = 0; i < n; i++) {
    num += (rv[i] - mv) * (rl[i] - ml);
    dv += (rv[i] - mv) ** 2; dl += (rl[i] - ml) ** 2;
  }
  return (dv && dl) ? num / Math.sqrt(dv * dl) : 0;
}
function hexToLum(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function hexToHue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return h * 360;
}
function hueSpanDegrees(hues) {
  if (!hues || hues.length < 2) return 0;
  const hs = hues.slice().sort((a, b) => a - b);
  if (hs[hs.length - 1] === hs[0]) return 0;
  let maxGap = 0;
  for (let i = 0; i < hs.length - 1; i++) maxGap = Math.max(maxGap, hs[i + 1] - hs[i]);
  maxGap = Math.max(maxGap, (hs[0] + 360) - hs[hs.length - 1]);
  return 360 - maxGap;
}

async function main() {
  console.log('Fetching all-time Olympic medal table (Wikipedia, datos COI)...');
  const html = await fetchText(WIKI_URL);
  const records = parseAllTimeTable(html);
  console.log(`Equipos en la tabla: ${records.length}`);

  const byAdmin = {};
  let historical = 0, unmapped = 0;
  for (const rec of records) {
    if (HISTORICAL_CODES.has(rec.code)) { historical++; continue; }
    const admin = IOC_TO_ADMIN[rec.code];
    if (!admin) { unmapped++; console.log(`  sin polígono: ${rec.code} (${rec.total} medallas)`); continue; }
    byAdmin[admin] = rec;
  }
  console.log(`Equipos vigentes mapeados: ${Object.keys(byAdmin).length} | históricos excluidos: ${historical} | sin mapa: ${unmapped}`);

  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, 'ioc-alltime-summer-raw.json'), JSON.stringify({
    _source: DATA_SOURCE,
    _url: WIKI_URL,
    _date: new Date().toISOString().slice(0, 10),
    teams: records.map(r => ({ codigo: r.code, oro: r.gold, plata: r.silver, bronce: r.bronze, total: r.total })),
  }, null, 2));
  console.log(`Saved raw intermediate to ${RAW_DIR}/ioc-alltime-summer-raw.json`);

  console.log('Fetching Natural Earth 110m + 50m...');
  const ne110 = JSON.parse(await fetchText('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'));
  const ne50 = JSON.parse(await fetchText('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'));

  const baseFeatures = ne110.features.filter(f => f.properties.ADMIN !== 'Antarctica');
  const adminSet = new Set(baseFeatures.map(f => f.properties.ADMIN));
  const extra = [];
  for (const f of ne50.features) {
    const admin = f.properties.ADMIN;
    if (admin === 'Antarctica') continue;
    if (!adminSet.has(admin) && f.properties.TYPE === 'Sovereign country')
      extra.push({ type: 'Feature', properties: f.properties, geometry: JSON.parse(JSON.stringify(f.geometry)) });
  }
  console.log(`Base 110m: ${baseFeatures.length}, extra microstates 50m: ${extra.length}`);

  const seen = new Set();
  const dedup = [];
  for (const f of [...baseFeatures, ...extra]) {
    const a = f.properties.ADMIN;
    if (seen.has(a)) continue;
    seen.add(a);
    dedup.push(f);
  }

  // Rampa logarítmica sobre el rango real del dato (1 → 2.774).
  const values = Object.values(byAdmin).map(r => r.total).filter(v => v > 0);
  const lo = Math.min(...values), hi = Math.max(...values);
  const ramp = buildMonoRamp(HUE, RAMP_STEPS);
  const logLo = Math.log10(1 + lo), logHi = Math.log10(1 + hi);
  const colorForMedals = v => {
    if (v == null || !isFinite(v) || v <= 0) return NO_DATA;
    const t = logHi === logLo ? 1 : (Math.log10(1 + v) - logLo) / (logHi - logLo);
    const step = Math.max(0, Math.min(RAMP_STEPS - 1, Math.round(t * (RAMP_STEPS - 1))));
    return ramp[step];
  };

  const geo = { type: 'FeatureCollection', features: [] };
  const seenNames = new Set();
  const usedAdmins = new Set();
  let withMedals = 0, zero = 0;

  for (const raw of dedup) {
    const p = raw.properties;
    const admin = p.ADMIN;
    if (admin === 'Antarctica') continue;

    const rec = byAdmin[admin] || null;
    if (rec) { usedAdmins.add(admin); withMedals++; } else { zero++; }

    const medals = rec ? rec.total : 0;
    const gold = rec ? rec.gold : 0;
    const silver = rec ? rec.silver : 0;
    const bronze = rec ? rec.bronze : 0;

    let esName = p.NAME_ES;
    if (!esName || esName === '-99') esName = ADMIN_TO_ES[admin] || p.NAME || admin;
    const continente = CONTINENT_ES[p.CONTINENT] || p.CONTINENT || '—';

    let uniqueEs = esName;
    let dup = 1;
    while (seenNames.has(uniqueEs)) { dup++; uniqueEs = `${esName} (${dup})`; }
    seenNames.add(uniqueEs);

    const medalsStr = fmtInt(medals);
    const plural = (n, one, many) => `${fmtInt(n)} ${n === 1 ? one : many}`;
    const description = rec
      ? `${uniqueEs} — ${medalsStr} medallas olímpicas de verano (${fmtInt(gold)} de oro, ${fmtInt(silver)} de plata, ${fmtInt(bronze)} de bronce) hasta París 2024 — ${continente}`
      : `${uniqueEs} — sin medallas olímpicas de verano hasta París 2024 — ${continente}`;

    geo.features.push({
      type: 'Feature',
      properties: {
        _manaName: uniqueEs, name: admin,
        _manaColor: colorForMedals(medals),
        _manaFillOpacity: medals > 0 ? 0.85 : 0.5,
        _manaWeight: 0.7, _manaBorderColor: '#FFFFFF',
        _manaGroupName: GROUP_NAME, _manaGroupId: GROUP_ID,
        _manaLabelStyle: labelStyle(),
        'País': uniqueEs, 'País (EN)': admin, 'Continente': continente,
        'Medallas': medalsStr,
        'Oros': fmtInt(gold), 'Platas': fmtInt(silver), 'Bronces': fmtInt(bronze),
        [NUM_KEY]: medals,
        'Año de datos': '2024',
        'Fuente': 'COI / Olympics.com — tabla histórica de los Juegos de Verano (vía Wikipedia)',
        'Description': description,
        'Superficie': continente,
        'Dato': medals > 0
          ? `${medalsStr} medallas (${plural(gold, 'oro', 'oros')}, ${plural(silver, 'plata', 'platas')}, ${plural(bronze, 'bronce', 'bronces')})`
          : 'Sin medallas olímpicas de verano',
      },
      geometry: { type: raw.geometry.type, coordinates: roundCoords(raw.geometry.coordinates) },
    });
  }

  geo.features.sort((a, b) => b.properties[NUM_KEY] - a.properties[NUM_KEY]);

  const huerfanos = Object.keys(byAdmin).filter(a => !usedAdmins.has(a));
  if (huerfanos.length) {
    console.log(`Equipos sin polígono (${huerfanos.length}): ${huerfanos.map(a => `${a} ${fmtInt(byAdmin[a].total)}`).join(' | ')}`);
  }

  const geojsonText = JSON.stringify(geo);
  console.log(`Features: ${geo.features.length} | con medallas: ${withMedals} | a 0: ${zero} | KB: ${(geojsonText.length / 1024).toFixed(1)}`);
  console.log(`Rango: ${fmtInt(lo)} — ${fmtInt(hi)} medallas (equipos vigentes)`);

  // ── Validaciones (AGENTS.md §6 + §3) ──
  const hexOk = geo.features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = geo.features.every(f => f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth >= 2 && f.properties._manaLabelStyle.enabled === true);
  let coordsOk = true;
  const walk = c => {
    if (typeof c[0] === 'number') {
      if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) coordsOk = false;
    } else c.forEach(walk);
  };
  geo.features.forEach(f => walk(f.geometry.coordinates));
  const names = new Set(geo.features.map(f => f.properties._manaName));
  const borderOk = geo.features.every(f => f.properties._manaBorderColor === '#FFFFFF');
  const withData = geo.features.filter(f => f.properties[NUM_KEY] != null).length;

  const pairs = geo.features
    .filter(f => f.properties[NUM_KEY] != null && f.properties[NUM_KEY] > 0)
    .map(f => ({ v: Number(f.properties[NUM_KEY]), hex: f.properties._manaColor, l: hexToLum(f.properties._manaColor) }));
  const rho = spearmanRho(pairs.map(p => p.v), pairs.map(p => p.l));
  const span = hueSpanDegrees(pairs.map(p => hexToHue(p.hex)));

  console.log(`hex: ${hexOk} | halo: ${haloOk} | coords: ${coordsOk} | uniqueNames: ${names.size === geo.features.length} | whiteBorder: ${borderOk}`);
  console.log(`§3 rho(valor,luminancia)=${rho.toFixed(3)} (≤ -0.65 OK) | span tono=${span.toFixed(1)}° (≤ 60 OK) | con datos: ${withData}`);

  const ranked = geo.features
    .filter(f => f.properties[NUM_KEY] != null && f.properties[NUM_KEY] > 0)
    .sort((a, b) => b.properties[NUM_KEY] - a.properties[NUM_KEY]);
  console.log(`Top 10: ${ranked.slice(0, 10).map(f => `${f.properties._manaName} ${fmtInt(f.properties[NUM_KEY])}`).join(' | ')}`);

  const ok = hexOk && haloOk && coordsOk && names.size === geo.features.length && borderOk &&
    rho <= -0.65 && span <= 60 && withMedals >= 130 && geojsonText.length <= 1048576;
  if (!ok) { console.error('VALIDATION FAILED'); process.exit(1); }

  if (!fs.existsSync(path.join(ROOT, 'data', 'maps'))) fs.mkdirSync(path.join(ROOT, 'data', 'maps'), { recursive: true });
  fs.writeFileSync(OUT, geojsonText, 'utf8');
  console.log('OK →', OUT);
}

main().catch(e => { console.error('Fatal', e); process.exit(1); });
