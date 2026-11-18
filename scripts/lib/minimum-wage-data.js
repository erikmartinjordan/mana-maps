'use strict';
// ── scripts/lib/minimum-wage-data.js ─
// Tabla de salarios mínimos del mapa `minimum-wage-by-country` construida a
// partir de los snapshots versionados en data/sources/minimum-wage-by-country/
// (ver scripts/maps/fetch-minimum-wage-data.js):
//
//   · ilostat-minimum-wage.csv      OIT/ILOSTAT, EAR_INEE_NOC_NB_A
//                                   (salario mínimo mensual en moneda local)
//   · ilostat-minimum-wage-usd.json OIT/ILOSTAT, EAR_INEE_CUR_NB_A
//                                   (misma serie convertida a USD, respaldo)
//   · worldbank-fcrf-2018-2024.json Banco Mundial, PA.NUS.FCRF
//
// Regla de selección (AGENTS.md §1: nada de cifras a mano):
//   1. Se descarta cualquier observación anterior a 2020: presentar un dato de
//      2011 como «salario mínimo actual» sería tan engañoso como inventarlo.
//   2. Se toma el año más reciente disponible; a igual año, el tipo de salario
//      más representativo (mínimo nacional único > suelo nacional > regional >
//      ocupacional > sectorial).
//   3. El salario anual en USD se calcula con el tipo de cambio oficial del
//      Banco Mundial del mismo año (o del último año publicado si ese falta).
//      Si el Banco Mundial no publica tipo de cambio, se usa la conversión a
//      USD del propio ILOSTAT y se marca el origen.
//   4. Los países sin salario mínimo legal estatutario (se fija por convenio
//      colectivo) se fuerzan a gris aunque ILOSTAT tenga una estimación: es el
//      caso de Islandia, cuyos 300.000 ISK/mes son un mínimo de convenio.

const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.join(__dirname, '..', '..', 'data', 'sources', 'minimum-wage-by-country');
const MIN_YEAR = 2020;
const MAX_YEAR = 2024;
// Horas asumidas por mes para convertir tarifas horarias a mensuales
// (jornada de 40 h/semana). Solo afecta a Mónaco y Hong Kong en la fuente.
const HOURS_PER_MONTH = (40 * 52) / 12;
// País de referencia para el tipo de cambio del euro: Bulgaria y Croacia
// (antes de 2023) declaran su salario en EUR, pero el Banco Mundial publica su
// tipo de cambio en la moneda nacional anterior.
const EURO_REF = 'DEU';

// Países sin salario mínimo legal estatutario (nórdicos, Italia, Austria,
// Suiza) y territorios sin norma nacional. Se pintan en gris y quedan fuera de
// la rampa; el popup y la descripción lo explican. Son códigos ISO-3, igual
// que `ref_area` en ILOSTAT.
const NO_STATUTORY = new Set(['DNK', 'SWE', 'FIN', 'ISL', 'NOR', 'ITA', 'AUT', 'CHE', 'LIE', 'BRN', 'SGP', 'ARE', 'SOM']);
const COLLECTIVE_BARGAINING = new Set(['DNK', 'SWE', 'FIN', 'ISL', 'NOR', 'ITA', 'AUT', 'CHE']);

// Países y territorios que usan la moneda de otro Estado y que el Banco
// Mundial publica bajo el emisor: Cook Islands → dólar neozelandés.
const RATE_ALIASES = { COK: 'NZL' };

const TYPE_PRIORITY = {
  'Singular national minimum wage': 0,
  'National floor': 1,
  'National floor for adults': 1,
  'Rate of the SMIG when SMIG/SMAG system': 2,
  'Regional': 3,
  'Regional (urban areas)': 3,
  'Regional (lowest provincial rate in non-agriculture)': 3,
  'Occupational': 4,
  'Occupational (unskilled workers)': 4,
  'For adults': 4,
  'Sectoral': 5,
  'Sectoral (manufacturing)': 5,
  'Sectoral (private sector)': 5,
  'Sectoral (private and oil sectors)': 5,
  'Average of minimum wages based on establishment size': 6,
};

const TYPE_LABELS_ES = {
  'Singular national minimum wage': 'Mínimo nacional único',
  'National floor': 'Suelo nacional',
  'National floor for adults': 'Suelo nacional para adultos',
  'Rate of the SMIG when SMIG/SMAG system': 'Tarifa del SMIG (sistema SMIG/SMAG)',
  'Regional': 'Mínimo regional',
  'Regional (urban areas)': 'Mínimo regional (zonas urbanas)',
  'Regional (lowest provincial rate in non-agriculture)': 'Mínimo regional (tarifa provincial más baja)',
  'Occupational (unskilled workers)': 'Mínimo ocupacional (trabajadores no cualificados)',
  'For adults': 'Mínimo para adultos',
  'Sectoral (manufacturing)': 'Mínimo sectorial (manufactura)',
  'Sectoral (private sector)': 'Mínimo sectorial (sector privado)',
  'Sectoral (private and oil sectors)': 'Mínimo sectorial (privado y petróleo)',
  'Average of minimum wages based on establishment size': 'Media de mínimos por tamaño de empresa',
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8'));
}

function readCsv(file) {
  const text = fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((key, index) => { row[key] = cells[index]; });
    return row;
  });
}

function rateFor(rates, iso, year) {
  const years = Object.keys(rates[iso] || {}).map(Number).filter((value) => value <= year);
  if (!years.length) return null;
  const best = Math.max(...years);
  return { rate: rates[iso][best], year: best };
}

// El tipo de cambio debe corresponder a la moneda en la que ILOSTAT declara el
// salario. Hay dos casos que el tipo de cambio del propio país rompe:
//   · filas en USD (Liberia) — el tipo del país es LRD/USD;
//   · filas en EUR de países que aún no habían adoptado el euro (Bulgaria,
//     Croacia 2022) — su tipo es BGN/USD o HRK/USD.
function rateForCurrency(rates, iso, currency, year) {
  if (currency === 'USD') return { rate: 1, year };
  if (currency === 'EUR') {
    const own = rateFor(rates, RATE_ALIASES[iso] || iso, year);
    if (own && own.rate <= 1.5) return own;
    const euro = rateFor(rates, EURO_REF, year);
    if (euro) return euro;
  }
  return rateFor(rates, RATE_ALIASES[iso] || iso, year);
}

// ILOSTAT publica algunas observaciones por hora (Mónaco, Hong Kong). El
// resto va por mes; su nota «Per year» es inconsistente con la propia serie
// (Ecuador y Uruguay declaran ahí el salario mensual), así que no se divide.
function monthlyValue(observation) {
  if (/hour/i.test(observation.timeUnit || '')) {
    return observation.value * HOURS_PER_MONTH;
  }
  return observation.value;
}

function typeLabel(type) {
  return TYPE_LABELS_ES[type] || 'Mínimo legal';
}

// Devuelve { byIso3, coverage } con una entrada por país:
// { monthlyLocal, currency, year, type, typeLabel, annualUSD, rate, rateYear,
//   rateSource, collectiveBargaining }
function buildWageTable(options) {
  const opts = options || {};
  const minYear = opts.minYear || MIN_YEAR;
  const maxYear = opts.maxYear || MAX_YEAR;
  const rows = readCsv('ilostat-minimum-wage.csv');
  const rates = readJson('worldbank-fcrf-2018-2024.json');
  const iloUsd = readJson('ilostat-minimum-wage-usd.json');

  const byIso = new Map();
  for (const row of rows) {
    const iso = (row.ref_area || '').trim();
    const year = Number(row.time);
    const value = Number(row.obs_value);
    if (!iso || !Number.isFinite(value) || !Number.isFinite(year)) continue;
    if (year < minYear || year > maxYear) continue;
    if (NO_STATUTORY.has(iso)) continue;
    const type = (row.type || '').trim();
    const priority = TYPE_PRIORITY[type] == null ? 8 : TYPE_PRIORITY[type];
    const current = byIso.get(iso);
    const candidate = {
      year,
      value,
      type,
      priority,
      currency: (row.currency || '').trim(),
      timeUnit: (row.time_unit || '').trim(),
    };
    if (!current || year > current.year || (year === current.year && priority < current.priority)) {
      byIso.set(iso, candidate);
    }
  }

  const table = {};
  const years = new Set();
  for (const [iso, obs] of byIso) {
    const monthly = monthlyValue(obs);
    const rateInfo = rateForCurrency(rates, iso, obs.currency, obs.year);
    let annualUSD = null;
    let rate = null;
    let rateYear = null;
    let rateSource = '';
    if (rateInfo) {
      rate = Math.round(rateInfo.rate * 10000) / 10000;
      rateYear = rateInfo.year;
      annualUSD = Math.round((monthly * 12) / rate);
      rateSource = 'Banco Mundial PA.NUS.FCRF';
    } else if (iloUsd[iso] && iloUsd[iso][obs.year] != null) {
      annualUSD = Math.round(iloUsd[iso][obs.year] * 12);
      rateSource = 'OIT/ILOSTAT (conversión propia a USD)';
    }
    if (annualUSD == null || !Number.isFinite(annualUSD)) continue;
    years.add(obs.year);
    table[iso] = {
      monthlyLocal: Math.round(monthly * 100) / 100,
      currency: obs.currency,
      year: obs.year,
      type: obs.type,
      typeLabel: typeLabel(obs.type),
      annualUSD,
      rate,
      rateYear,
      rateSource,
      hourly: /hour/i.test(obs.timeUnit || ''),
      collectiveBargaining: COLLECTIVE_BARGAINING.has(iso),
    };
  }

  return {
    byIso3: table,
    coverage: {
      minYear: Math.min(...years),
      maxYear: Math.max(...years),
      countries: Object.keys(table).length,
      exchangeRateSource: 'Banco Mundial WDI PA.NUS.FCRF',
    },
  };
}

module.exports = {
  MIN_YEAR,
  MAX_YEAR,
  NO_STATUTORY,
  COLLECTIVE_BARGAINING,
  buildWageTable,
  typeLabel,
};
