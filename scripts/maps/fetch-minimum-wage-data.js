#!/usr/bin/env node
// ── fetch-minimum-wage-data.js ─
// Descarga y compacta las fuentes autoritativas del mapa
// `minimum-wage-by-country` (AGENTS.md §1: dato autoritativo y citado):
//
//   1) OIT/ILOSTAT — «Monthly minimum wage (local currency)», indicador
//      EAR_INEE_NOC_NB_A (sustituto del antiguo EAR_4MMN_CUR_NB_A, retirado).
//      Se guarda una fila por país y año con el tipo de salario mínimo y la
//      moneda, que el generador usa para pintar y explicar cada feature.
//   2) OIT/ILOSTAT — «Monthly minimum wage by currency» (EAR_INEE_CUR_NB_A),
//      solo la serie en dólares: sirve de contraste y de respaldo cuando el
//      Banco Mundial no publica tipo de cambio para el país.
//   3) Banco Mundial — WDI PA.NUS.FCRF (tipo de cambio oficial LCU/USD, media
//      del periodo) 2018-2024.
//
// Los tres quedan versionados en data/sources/minimum-wage-by-country/ para
// que `publish-minimum-wage.js` sea determinista y no dependa de la red.
//
// Uso: node scripts/maps/fetch-minimum-wage-data.js

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', '..', 'data', 'sources', 'minimum-wage-by-country');
// Cabecera ASCII: un User-Agent con caracteres no ASCII rompe la petición.
const UA = 'mana-maps/1.0 (+https://xn--maa-8ma.com; datos OIT/Banco Mundial)';
const ILO_LOCAL = 'https://rplumber.ilo.org/data/indicator/?id=EAR_INEE_NOC_NB_A&type=both&format=.csv&lang=en';
const ILO_USD = 'https://rplumber.ilo.org/data/indicator/?id=EAR_INEE_CUR_NB_A&type=both&format=.csv&lang=en';
const WB_FCRF = 'https://api.worldbank.org/v2/country/all/indicator/PA.NUS.FCRF?date=2018:2024&format=json&per_page=2000';
const USD_CLASSIF = 'Currency: U.S. dollars';

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        resolve(download(res.headers.location, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} en ${url}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
  });
}

// Parser CSV mínimo con soporte de comillas, comas y saltos de línea dentro de
// campos (las notas de ILOSTAT los usan).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows
    .filter((cells) => cells.length === header.length)
    .map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index]])));
}

function pickNoteValue(note, label) {
  const match = String(note || '').match(new RegExp(`${label}:\\s*([^|]+)`));
  return match ? match[1].trim() : '';
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('Descargando ILOSTAT (salario mínimo en moneda local)…');
  return download(ILO_LOCAL).then((csv) => {
    const rows = parseCsv(csv);
    const lines = ['ref_area,ref_area_label,time,obs_value,type,currency,time_unit'];
    const seen = new Set();
    for (const row of rows) {
      const iso = (row.ref_area || '').trim();
      const year = Number(row.time);
      const value = Number(row.obs_value);
      if (!iso || !Number.isFinite(year) || !Number.isFinite(value)) continue;
      const type = pickNoteValue(row['note_indicator.label'], 'Type of minimum wage');
      const currency = pickNoteValue(row['note_indicator.label'], 'Currency');
      const currencyCode = (currency.match(/\(([A-Z]{3})\)/) || [])[1] || '';
      const timeUnit = pickNoteValue(row['note_indicator.label'], 'Time unit');
      const key = `${iso}|${year}|${type}|${currencyCode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const name = String(row['ref_area.label'] || iso).replace(/,/g, ' ');
      const typeSafe = type.replace(/,/g, ';');
      lines.push(`${iso},${name},${year},${value},${typeSafe},${currencyCode},${timeUnit}`);
    }
    fs.writeFileSync(path.join(OUT_DIR, 'ilostat-minimum-wage.csv'), lines.join('\n') + '\n');
    console.log(`  ILOSTAT local: ${lines.length - 1} filas`);

    console.log('Descargando ILOSTAT (salario mínimo en dólares)…');
    return download(ILO_USD);
  }).then((csv) => {
    const rows = parseCsv(csv);
    const byIso = {};
    const monthly = {};
    for (const row of rows) {
      const classif = (row['classif1.label'] || '').trim();
      if (classif !== USD_CLASSIF && classif !== 'Currency: Local currency') continue;
      const iso = (row.ref_area || '').trim();
      const year = Number(row.time);
      const value = Number(row.obs_value);
      if (!iso || !Number.isFinite(year) || !Number.isFinite(value)) continue;
      if (classif === USD_CLASSIF) {
        byIso[iso] = byIso[iso] || {};
        byIso[iso][year] = value;
      } else {
        monthly[iso] = monthly[iso] || {};
        monthly[iso][year] = monthly[iso][year] || {};
        monthly[iso][year].local = value;
      }
    }
    for (const iso of Object.keys(byIso)) {
      for (const year of Object.keys(byIso[iso])) {
        if (!monthly[iso] || !monthly[iso][year]) continue;
        monthly[iso][year].usd = byIso[iso][year];
      }
    }
    fs.writeFileSync(path.join(OUT_DIR, 'ilostat-minimum-wage-usd.json'), JSON.stringify(byIso));
    fs.writeFileSync(path.join(OUT_DIR, 'ilostat-minimum-wage-monthly.json'), JSON.stringify(monthly));
    console.log(`  ILOSTAT USD: ${Object.keys(byIso).length} países (serie mensual armonizada: ${Object.keys(monthly).length})`);

    console.log('Descargando Banco Mundial PA.NUS.FCRF…');
    return download(WB_FCRF);
  }).then((body) => {
    const payload = JSON.parse(body);
    const rates = {};
    for (const row of payload[1] || []) {
      if (row.value == null) continue;
      const iso = row.countryiso3code;
      if (!iso) continue;
      rates[iso] = rates[iso] || {};
      rates[iso][Number(row.date)] = Number(row.value);
    }
    fs.writeFileSync(path.join(OUT_DIR, 'worldbank-fcrf-2018-2024.json'), JSON.stringify(rates));
    console.log(`  Banco Mundial: ${Object.keys(rates).length} países`);
    console.log(`Fuentes en ${path.relative(process.cwd(), OUT_DIR)}/`);
  });
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(1);
});
