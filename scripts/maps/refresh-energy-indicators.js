#!/usr/bin/env node
// ── refresh-energy-indicators.js ─
// Refresca los dos indicadores energéticos que seguían con datos caducados
// (auditoría GIS 17-11):
//
//   · renewable-energy-world     → % de electricidad renovable
//     El Banco Mundial dejó de actualizar EG.ELC.RNEW.ZS en 2021: la API
//     devuelve `null` para 2022–2025 en todos los países consultados
//     (ESP, BRA, CHN, 20-11-2026). Se usa la serie equivalente y vigente de
//     Ember (2026) vía Our World in Data, misma métrica («% de electricidad
//     generada con renovables»), último año completo 2024.
//
//   · electricity-access-world   → EG.ELC.ACCS.ZS
//     «Access to electricity (% of population)», SDG 7.1.1 / ESMAP. La serie
//     ya llega a 2024 y se descarga del WDI (último dato por país).
//
// El script cruza cada serie con las features existentes por código ISO3 de
// Natural Earth y actualiza en `data/maps/<slug>.geojson`:
//   valor numérico, etiqueta formateada, `Año de datos`, `Description`, `Dato`,
//   `Fuente` y `_manaColor` según la rampa fija del mapa.
//
// La geometría y el resto de propiedades se conservan: este script NO
// reconstruye los polígonos.
//
// Rampas (AGENTS.md §3, secuencial monocromática ordenada por el dato):
//   · renewable:   8 pasos ColorBrewer Greens, tramos 0/10/25/40/55/70/85/95/100 %.
//   · electricity: 7 pasos Blues, tramos 0/10/25/50/75/90/95/100 %.
//
// Uso:
//   node scripts/maps/refresh-energy-indicators.js [--dry-run]
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SOURCES = path.join(ROOT, 'data', 'sources');
const DRY_RUN = process.argv.includes('--dry-run');

const WB_COUNTRIES_URL = 'https://api.worldbank.org/v2/country?format=json&per_page=400';
const NE_110 = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const NE_50 = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';

const MAPS = [
  {
    slug: 'renewable-energy-world',
    source: 'owid',
    // Ember (2026) vía Our World in Data: mismo dato que publicaba el Banco
    // Mundial, pero actualizado. La serie del WDI (EG.ELC.RNEW.ZS) termina en
    // 2021 y no se va a recuperar.
    owidUrl: 'https://ourworldindata.org/grapher/share-electricity-renewables.csv?csvType=full&useColumnShortNames=true',
    owidColumn: 'renewable_share_of_electricity__pct',
    owidIndicator: 'share-electricity-renewables',
    owidCitation: 'Ember (2026) and other sources – with major processing by Our World in Data',
    // Año completo: en 2025 solo hay 114 países con dato y el mapa quedaría
    // mezclado; con 2024 hay 228 y una lectura homogénea.
    capYear: 2024,
    numKey: 'Energía renovable (num)',
    displayKey: 'Energía renovable',
    sourceLabel: 'Ember (2026) — Share of electricity generation from renewables, vía Our World in Data',
    description: (name, value, year, continent) =>
      `${name} — ${value}% de la electricidad es renovable (${year}) — ${continent}`,
    ramp: ['#f7fcf5', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#006d2c', '#00441b'],
    // Tramos fijos con los que se publicó el mapa (ColorBrewer Greens de 8
    // pasos): 0–10, 10–25, 25–40, 40–55, 55–70, 70–85, 85–95 y 95–100 %.
    thresholds: [0, 10, 25, 40, 55, 70, 85, 95, 100],
    // Se descartan series que terminan antes de 2015: el único caso es el
    // Sáhara Occidental (Ember cierra en 2009 con 0 %) y mostrarlo como dato
    // vigente de un mapa de 2024 sería engañoso.
    minYear: 2015,
  },
  {
    slug: 'electricity-access-world',
    source: 'worldbank',
    indicator: 'EG.ELC.ACCS.ZS',
    indicatorName: 'Access to electricity (% of population)',
    sourceOrg: 'SDG 7.1.1 Electrification Dataset (ESMAP), vía World Bank WDI',
    numKey: 'Acceso a electricidad (num)',
    displayKey: 'Acceso a electricidad',
    sourceLabel: 'World Bank — Access to electricity (% of population) (EG.ELC.ACCS.ZS)',
    description: (name, value, year, continent) =>
      `${name} — ${value}% de la población con electricidad (${year}) — ${continent}`,
    ramp: ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c', '#08306b', '#041533'],
    thresholds: [0, 10, 25, 50, 75, 90, 95, 100],
    // Kosovo solo tiene un dato de 1999 (100 %) en el WDI: demasiado antiguo
    // para un mapa con datos de 2024, se mantiene «Sin datos».
    minYear: 2000,
  },
];

const NO_DATA = '#d9d9d9';
const NO_DATA_OPACITY = 0.45;
const DATA_OPACITY = 0.82;

// Natural Earth usa KOS para Kosovo; el Banco Mundial, XKX.
const ISO_ALIASES = { KOS: 'XKX' };

// Nombres del Banco Mundial → nombres de Natural Earth (fallback por nombre).
const NAME_TO_NE = {
  'Egypt, Arab Rep.': 'Egypt',
  'Congo, Rep.': 'Republic of the Congo',
  'Congo, Dem. Rep.': 'Democratic Republic of the Congo',
  'Gambia, The': 'Gambia',
  'Iran, Islamic Rep.': 'Iran',
  'Korea, Rep.': 'South Korea',
  "Korea, Dem. People's Rep.": 'North Korea',
  'Lao PDR': 'Laos',
  'Russian Federation': 'Russia',
  'Slovak Republic': 'Slovakia',
  'Syrian Arab Republic': 'Syria',
  'Turkiye': 'Turkey',
  'Venezuela, RB': 'Venezuela',
  'Viet Nam': 'Vietnam',
  'Yemen, Rep.': 'Yemen',
  'Bahamas, The': 'The Bahamas',
  'Brunei Darussalam': 'Brunei',
  'Cabo Verde': 'Cape Verde',
  "Cote d'Ivoire": 'Ivory Coast',
  "Côte d'Ivoire": 'Ivory Coast',
  Czechia: 'Czech Republic',
  Eswatini: 'eSwatini',
  'Micronesia, Fed. Sts.': 'Federated States of Micronesia',
  'St. Kitts and Nevis': 'Saint Kitts and Nevis',
  'St. Lucia': 'Saint Lucia',
  'St. Vincent and the Grenadines': 'Saint Vincent and the Grenadines',
  'Kyrgyz Republic': 'Kyrgyzstan',
  'North Macedonia': 'Macedonia',
  'Timor-Leste': 'East Timor',
  'Sao Tome and Principe': 'São Tomé and Príncipe',
  'West Bank and Gaza': 'West Bank',
};

function fetchText(url, base) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'mana-maps-publish/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Our World in Data redirige con rutas relativas («/grapher/…»).
        const next = new URL(res.headers.location, url).toString();
        return fetchText(next).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function norm(s) {
  return String(s).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// «10,4» — un decimal con coma decimal (es-ES).
const fmtPct = v => (Math.round(Number(v) * 10) / 10).toFixed(1).replace('.', ',');

function colorFor(value, map) {
  if (value == null || !Number.isFinite(Number(value))) return NO_DATA;
  const v = Number(value);
  let index = 0;
  // Los tramos son (anterior, umbral]: un valor exactamente en el umbral
  // conserva el color del tramo inferior, como en la publicación original.
  for (let i = 1; i < map.thresholds.length - 1; i++) {
    if (v > map.thresholds[i]) index = i;
  }
  return map.ramp[Math.min(index, map.ramp.length - 1)];
}

function latestByIso3(rows, economies) {
  const out = {};
  for (const row of rows || []) {
    const iso = row && row.countryiso3code;
    if (!iso || !economies.has(iso) || row.value == null) continue;
    const year = parseInt(row.date, 10);
    const value = Number(row.value);
    if (!isFinite(year) || !isFinite(value)) continue;
    if (!out[iso] || year > out[iso].year) {
      out[iso] = { iso3: iso, year, value, name: economies.get(iso) };
    }
  }
  return out;
}

// ── CSV de Our World in Data ──
// Parser mínimo con soporte de comillas (los nombres de entidad llevan comas:
// «Bolivia (Plurinational State of)», «Korea, Rep.»).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Último dato por país ISO3 con año <= capYear. Los agregados de OWID usan
// códigos tipo `OWID_WRL`, pero algunas entidades reales también cuelgan de
// ese prefijo (`OWID_KOS` = Kosovo), así que se aceptan ambos formatos.
function latestOwidByIso3(csvText, map) {
  const rows = parseCsv(csvText);
  if (!rows.length) return {};
  const header = rows[0].map(h => h.trim());
  const iEntity = header.indexOf('entity');
  const iCode = header.indexOf('code');
  const iYear = header.indexOf('year');
  const iValue = header.indexOf(map.owidColumn);
  if (iEntity < 0 || iCode < 0 || iYear < 0 || iValue < 0) {
    throw new Error(`CSV OWID sin las columnas esperadas (${map.owidColumn})`);
  }
  const capYear = map.capYear || Infinity;
  const out = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const iso = (row[iCode] || '').trim();
    // Solo países: ISO3 (`ESP`) o entidad OWID con ISO3 (`OWID_KOS`). Los
    // agregados regionales usan otros sufijos (`OWID_WRL`, `OWID_EU27`…).
    if (!/^(?:OWID_)?[A-Z]{3}$/.test(iso)) continue;
    const year = parseInt(row[iYear], 10);
    const value = Number(row[iValue]);
    if (!isFinite(year) || !isFinite(value) || year > capYear || year < map.minYear) continue;
    if (!out[iso] || year > out[iso].year) {
      out[iso] = { iso3: iso, year, value, name: (row[iEntity] || '').trim() };
    }
  }
  return out;
}

function buildAdminIso(ne110, ne50) {
  const adminIso = {};
  for (const f of [...ne110.features, ...ne50.features]) {
    const p = f.properties || {};
    const codes = [p.ISO_A3, p.ISO_A3_EH, p.ADM0_A3]
      .filter(c => c && c !== '-99')
      .map(c => ISO_ALIASES[c] || c);
    if (codes.length && !adminIso[p.ADMIN]) adminIso[p.ADMIN] = codes;
  }
  return adminIso;
}

function findRecord(feature, byIso3, adminIso, byNormName) {
  const p = feature.properties || {};
  const codes = adminIso[p.name] || [];
  for (const code of codes) {
    if (byIso3[code]) return byIso3[code];
    // Our World in Data usa `OWID_KOS` para Kosovo (y `OWID_…` en general para
    // entidades sin ISO3 oficial), así que se prueban ambos prefijos.
    if (byIso3[`OWID_${code}`]) return byIso3[`OWID_${code}`];
  }
  // Fallback: nombre normalizado (Kosovo, etc.).
  const candidates = [p.name, p['País (EN)']].filter(Boolean).map(norm);
  for (const n of candidates) {
    if (byNormName[n]) return byNormName[n];
  }
  return null;
}

function buildNormNameIndex(byIso3) {
  const index = {};
  for (const rec of Object.values(byIso3)) {
    const names = [rec.name, NAME_TO_NE[rec.name] || rec.name];
    for (const n of names) index[norm(n)] = rec;
  }
  return index;
}

function writeSourceSnapshot(map, rows, meta) {
  const dir = path.join(SOURCES, map.slug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const owid = map.source === 'owid';
  const file = path.join(dir, owid ? `${map.owidIndicator}.json` : `wb-${map.indicator.toLowerCase()}.json`);
  const header = {
    _source: owid ? `${map.owidIndicator} — ${map.owidCitation}` : `${map.indicatorName} — ${map.sourceOrg}`,
    _indicator: owid ? map.owidIndicator : map.indicator,
    _url: owid ? map.owidUrl : `https://api.worldbank.org/v2/country/all/indicator/${map.indicator}?format=json&per_page=20000`,
    _date: new Date().toISOString().slice(0, 10),
  };
  if (owid) header._capYear = map.capYear || null;
  else header._lastUpdated = meta.lastupdated;
  fs.writeFileSync(file, JSON.stringify({ ...header, countries: rows }, null, 2));
  return file;
}

async function main() {
  let economies = new Map();
  const needsWb = MAPS.some(m => m.source === 'worldbank');
  if (needsWb) {
    console.log('Fetching World Bank country list (para excluir agregados)...');
    const countriesJson = JSON.parse(await fetchText(WB_COUNTRIES_URL));
    for (const c of countriesJson[1] || []) {
      if (c && c.id && c.region && c.region.id && c.region.id !== 'NA') economies.set(c.id, c.name);
    }
  }

  console.log('Fetching Natural Earth 110m + 50m (mapa ADMIN → ISO3)...');
  const ne110 = JSON.parse(await fetchText(NE_110));
  const ne50 = JSON.parse(await fetchText(NE_50));
  const adminIso = buildAdminIso(ne110, ne50);

  for (const map of MAPS) {
    console.log(`\n=== ${map.slug} (${map.source === 'owid' ? map.owidIndicator : map.indicator}) ===`);
    let byIso3, meta = {};
    if (map.source === 'owid') {
      const csv = await fetchText(map.owidUrl);
      byIso3 = latestOwidByIso3(csv, map);
      meta = { lastupdated: new Date().toISOString().slice(0, 10) };
      const years = [...new Set(Object.values(byIso3).map(r => r.year))].sort();
      console.log(`OWID ${map.owidIndicator} | países con dato ${Object.keys(byIso3).length} | años ${years.join(', ')}`);
    } else {
      const url = `https://api.worldbank.org/v2/country/all/indicator/${map.indicator}?format=json&per_page=20000`;
      const json = JSON.parse(await fetchText(url));
      byIso3 = latestByIso3(json[1], economies);
      meta = json[0] || {};
      console.log(`WB lastupdated ${meta.lastupdated} | economías con dato ${Object.keys(byIso3).length}`);
    }
    const byNormName = buildNormNameIndex(byIso3);

    const geoPath = path.join(ROOT, 'data', 'maps', `${map.slug}.geojson`);
    const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));

    let changed = 0, valueChanges = 0, yearChanges = 0, unmatched = 0, tooOld = 0;
    let maxYear = 0;
    const rawRows = [];
    const changedList = [];
    const unmatchedList = [];
    const clearedList = [];

    for (const feature of geo.features) {
      const p = feature.properties;
      let rec = findRecord(feature, byIso3, adminIso, byNormName);
      if (rec && rec.year < map.minYear) {
        tooOld++;
        rec = null;
      }
      if (!rec) {
        unmatched++;
        unmatchedList.push(p._manaName);
        if (p[map.numKey] != null) clearedList.push(p._manaName);
        // Sin dato de la fuente: el mapa se deriva por completo de la serie, así
        // que se marca «Sin datos» aunque hubiera un valor de otra fuente (al
        // cambiar de fuente no se arrastran cifras antiguas sin año vigente).
        p[map.numKey] = null;
        p[map.displayKey] = 'Sin datos';
        p['Año de datos'] = 'Sin datos';
        p.Dato = 'Sin datos';
        p['Fuente'] = map.sourceLabel;
        p.Description = `${p._manaName} — sin dato de ${map.source === 'owid' ? 'Ember' : 'World Bank'} — ${p['Continente'] || p.Superficie || '—'}`;
        p._manaColor = NO_DATA;
        p._manaFillOpacity = NO_DATA_OPACITY;
        continue;
      }

      maxYear = Math.max(maxYear, rec.year);
      const value = Math.round(rec.value * 10) / 10;
      const formatted = fmtPct(value);
      const year = String(rec.year);
      const continent = p['Continente'] || p.Superficie || '—';

      if (p[map.numKey] !== value) valueChanges++;
      if (p['Año de datos'] !== year) yearChanges++;
      const description = map.description(p._manaName, formatted, year, continent);
      if (p[map.numKey] !== value || p['Año de datos'] !== year || p.Description !== description) {
        changed++;
        changedList.push(`${p._manaName} ${p[map.numKey]}→${value} (${year})`);
      }

      p[map.numKey] = value;
      p[map.displayKey] = `${formatted}%`;
      p['Año de datos'] = year;
      p['Fuente'] = map.sourceLabel;
      p.Description = description;
      p.Dato = `${formatted}%`;
      p._manaColor = colorFor(value, map);
      p._manaFillOpacity = DATA_OPACITY;

      rawRows.push({ iso3: rec.iso3, entidad: rec.name, valor: value, anio: rec.year });
    }

    const snapshot = path.join(SOURCES, map.slug, map.source === 'owid' ? `${map.owidIndicator}.json` : `wb-${map.indicator.toLowerCase()}.json`);
    if (DRY_RUN) {
      console.log(`DRY RUN: snapshot pendiente → ${path.relative(ROOT, snapshot)}`);
    } else {
      const written = writeSourceSnapshot(map, rawRows.sort((a, b) => a.entidad.localeCompare(b.entidad)), meta);
      console.log(`Snapshot → ${path.relative(ROOT, written)}`);
    }

    // ── Validaciones AGENTS.md §2/§3/§6 ──
    const hexOk = geo.features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
    const haloOk = geo.features.every(f => f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth >= 2 && f.properties._manaLabelStyle.enabled === true);
    const borderOk = geo.features.every(f => f.properties._manaBorderColor === '#FFFFFF');
    const names = new Set(geo.features.map(f => f.properties._manaName));
    let coordsOk = true;
    const walk = c => {
      if (typeof c[0] === 'number') {
        if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) coordsOk = false;
      } else c.forEach(walk);
    };
    geo.features.forEach(f => walk(f.geometry.coordinates));
    const withData = geo.features.filter(f => f.properties[map.numKey] != null).length;
    const years = [...new Set(geo.features.map(f => f.properties['Año de datos']))].sort();
    const values = geo.features.filter(f => f.properties[map.numKey] != null).map(f => f.properties[map.numKey]);
    const lo = Math.min(...values), hi = Math.max(...values);
    const geojsonText = JSON.stringify(geo);

    console.log(`features ${geo.features.length} | con dato ${withData} | sin cruce ${unmatched} | dato demasiado antiguo ${tooOld}`);
    console.log(`cambios ${changed} (valor ${valueChanges}, año ${yearChanges}) | rango ${fmtPct(lo)}–${fmtPct(hi)} | años ${years.join(', ')}`);
    const byYear = {};
    for (const y of years) byYear[y] = geo.features.filter(f => f.properties['Año de datos'] === y).length;
    console.log(`  reparto por año: ${Object.entries(byYear).map(([y, n]) => `${y}:${n}`).join(' ')}`);
    if (unmatchedList.length) console.log(`  sin dato (${unmatchedList.length}): ${unmatchedList.join(', ')}`);
    if (clearedList.length) console.log(`  pierden dato previo (${clearedList.length}): ${clearedList.join(', ')}`);
    if (changedList.length) console.log(`  ${changedList.slice(0, 12).join(' | ')}${changedList.length > 12 ? ` … (+${changedList.length - 12})` : ''}`);
    console.log(`hex ${hexOk} | halo ${haloOk} | coords ${coordsOk} | nombres únicos ${names.size === geo.features.length} | borde blanco ${borderOk} | KB ${(geojsonText.length / 1024).toFixed(1)}`);

    const ok = hexOk && haloOk && coordsOk && borderOk && names.size === geo.features.length &&
      withData >= 190 && maxYear > 0 && geojsonText.length <= 1048576;
    if (!ok) { console.error('VALIDATION FAILED'); process.exit(1); }

    if (DRY_RUN) {
      console.log('DRY RUN: no se escribe el GeoJSON');
    } else {
      fs.writeFileSync(geoPath, geojsonText, 'utf8');
      console.log(`OK → ${path.relative(ROOT, geoPath)} (último año de la fuente ${maxYear})`);
    }
  }
}

if (require.main === module) main().catch(e => { console.error('Fatal', e); process.exit(1); });

module.exports = { parseCsv, latestOwidByIso3, latestByIso3, colorFor, MAPS };
