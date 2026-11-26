'use strict';
// ── scripts/lib/map-landing-facts.js ─
// Construye el bloque «Datos clave» de las landings estáticas
// (/gallery/<slug>/): los valores más altos y más bajos del indicador que
// alimenta la leyenda (legendKey/legendTitle/legendFormat).
//
// Objetivo (directiva 2026-11, prioridad 1 y 2): las landings de los mapas con
// cero visitas solo tenían una frase de descripción, así que no competían por
// búsquedas del tipo «qué país tiene el PIB per cápita más alto». El bloque
// añade contenido único y verificable, derivado del propio GeoJSON, sin
// inventar datos.
//
// La lógica es pura (sin Firestore ni DOM) para poder testearla.

const { isLegendNumericLike, parseLegendNumber } = require('../tools/audit-gallery-quality');

const MIN_FACT_ENTRIES = 4;
const DEFAULT_FACTS_LIMIT = 3;
const CATEGORICAL_FORMATS = new Set(['category', 'text']);
const NO_DATA_RE = /^sin datos$/i;

function trimmed(value) {
  return String(value == null ? '' : value).trim();
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function factName(props) {
  const candidates = ['_manaName', 'País', 'Nombre', 'name', 'Lugar', 'Ciudad'];
  for (const key of candidates) {
    const value = trimmed(props && props[key]);
    if (value) return value;
  }
  return '';
}

// Clave legible que acompaña a la numérica: «Consumo de alcohol (num)» →
// «Consumo de alcohol». Muchos mapas guardan ahí el valor ya formateado con
// unidad («17,1 litros»), que es mejor que reformatear el número a mano.
function humanKeyOf(legendKey) {
  const key = trimmed(legendKey);
  const stripped = key.replace(/\s*\((?:num|número)\)\s*$/i, '');
  return stripped !== key ? stripped : '';
}

function humanValue(props, legendKey) {
  const humanKey = humanKeyOf(legendKey);
  if (!humanKey) return '';
  const value = trimmed(props && props[humanKey]);
  if (!value || NO_DATA_RE.test(value)) return '';
  return /\d/.test(value) ? value : '';
}

function formatFactNumber(value) {
  if (!isFinite(value)) return '';
  // useGrouping:'always' evita que es-ES deje sin separador de miles los
  // números de 4 dígitos (4089,6 → «4.089,6»), como pide la regla de medir.
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: 'always' }).format(value);
}

// La frase empieza con el título del indicador en minúscula («consumo de
// alcohol»), pero las siglas deben conservarse tal cual: «PIB per cápita» no
// puede convertirse en «pIB per cápita». Solo se baja la primera letra cuando
// la primera palabra no es una sigla (PIB, CO2, PM2.5, IDH, AVE…).
function lowercaseIndicatorStart(title) {
  const value = trimmed(title);
  if (!value) return '';
  const firstWord = value.split(/\s+/)[0] || '';
  const letters = firstWord.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  const isAcronym = letters.length >= 2 && letters === letters.toUpperCase();
  if (isAcronym) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

// Unidad a partir del paréntesis final del título: «Altura (m)» → « m».
// Se descartan años («Pasajeros (2025)») y rangos («Visitantes (2024–2025)»).
function unitFromLegendTitle(legendTitle, legendFormat) {
  const title = trimmed(legendTitle);
  const match = title.match(/\(([^)]+)\)\s*$/);
  const unit = match ? trimmed(match[1]) : '';
  if (unit && /[A-Za-z%°µ]/.test(unit) && !/^\d{4}$/.test(unit)) return ' ' + unit;
  if (legendFormat === 'percent') return ' %';
  if (legendFormat === 'meters') return ' m';
  return '';
}

function displayValue(entry, opts) {
  const human = humanValue(entry.props, opts.legendKey);
  if (human) return human;
  return formatFactNumber(entry.value) + unitFromLegendTitle(opts.legendTitle, opts.legendFormat);
}

// Unidad para la media y la mediana: la misma del indicador, pero limpia. Los
// títulos meten años y recuentos en el paréntesis («Pasos medios diarios (46
// países, 2017)», «(media 1991–2020)», «(hasta París 2024)») y pegarlos a una
// cifra produce frases sin sentido, así que se descartan los trozos con
// dígitos; los que son unidad de verdad («TEUs, 2024» → «TEUs») se conservan.
function statsUnit(opts) {
  const raw = unitFromLegendTitle(opts && opts.legendTitle, opts && opts.legendFormat).trim();
  if (!raw) return '';
  const parts = raw.split(',').map((part) => part.trim())
    .filter((part) => part && !/\d/.test(part));
  return parts.length ? ' ' + parts.join(', ') : '';
}

function medianOf(sortedValues) {
  const length = sortedValues.length;
  if (!length) return NaN;
  const middle = Math.floor(length / 2);
  if (length % 2) return sortedValues[middle];
  return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

// Media y mediana del indicador. La mediana acompaña a la media porque en
// distribuciones muy asimétricas (PIB, población) la media sola engaña; ambas
// se calculan sobre los mismos valores que ya usan «Datos clave».
function buildLevelStats(entries, opts) {
  const values = entries
    .map((entry) => entry.value)
    .filter((value) => isFinite(value))
    .sort((a, b) => a - b);
  if (values.length < MIN_FACT_ENTRIES) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const unit = statsUnit(opts);
  return {
    count: values.length,
    mean,
    median: medianOf(values),
    unit,
    meanDisplay: formatFactNumber(mean) + unit,
    medianDisplay: formatFactNumber(medianOf(values)) + unit,
  };
}

// Entradas {name, value, display} del indicador de leyenda, sin duplicados de
// nombre y con valores numéricos válidos. Devuelve [] si el mapa no tiene una
// variable numérica con al menos MIN_FACT_ENTRIES entidades.
function collectFactEntries(geo, opts) {
  const legendKey = trimmed(opts && opts.legendKey);
  const legendFormat = trimmed(opts && opts.legendFormat).toLowerCase();
  if (!legendKey) return [];
  if (CATEGORICAL_FORMATS.has(legendFormat)) return [];
  const features = geo && Array.isArray(geo.features) ? geo.features : [];

  const byName = new Map();
  for (const feature of features) {
    const props = feature && feature.properties;
    if (!props) continue;
    const raw = props[legendKey];
    if (!isLegendNumericLike(raw)) continue;
    const value = parseLegendNumber(raw);
    if (!isFinite(value)) continue;
    const name = factName(props);
    if (!name || byName.has(name)) continue;
    byName.set(name, { name, value, props });
  }

  const entries = [...byName.values()].sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    return a.name.localeCompare(b.name, 'es');
  });
  if (entries.length < MIN_FACT_ENTRIES) return [];

  const limit = Math.min(DEFAULT_FACTS_LIMIT, Math.floor(entries.length / 2));
  const bottomNames = new Set(entries.slice(0, limit).map((entry) => entry.name));
  const topNames = new Set(entries.slice(-limit).map((entry) => entry.name));
  return entries.map((entry) => ({
    name: entry.name,
    value: entry.value,
    display: displayValue(entry, { legendKey, legendTitle: opts.legendTitle, legendFormat }),
    top: topNames.has(entry.name),
    bottom: bottomNames.has(entry.name),
  }));
}

// Bloque HTML listo para insertar en la landing. Devuelve null cuando el mapa
// no tiene una variable numérica suficiente (categóricas, sin legendKey…).
function buildFactsSection(geo, opts) {
  const entries = collectFactEntries(geo, opts);
  if (!entries.length) return null;

  // `entries` va en orden ascendente; las listas se muestran de mayor a menor
  // en «Valores más altos» y de menor a mayor en «Valores más bajos».
  const top = entries.filter((entry) => entry.top).reverse();
  const bottom = entries.filter((entry) => entry.bottom);
  const max = top[0];
  const min = bottom[0];
  const title = trimmed(opts && opts.legendTitle);
  // En la frase sobra el paréntesis de la unidad: el valor ya la incluye.
  const shortTitle = title.replace(/\s*\([^)]*\)\s*$/, '').trim() || title;
  const label = shortTitle ? lowercaseIndicatorStart(shortTitle) : 'este indicador';

  const list = (items) => '<ol>' + items.map((entry) =>
    '<li><span class="facts-name">' + escapeHtml(entry.name) + '</span>' +
    '<span class="facts-value">' + escapeHtml(entry.display) + '</span></li>'
  ).join('') + '</ol>';

  const html = '<section class="facts" aria-labelledby="datos-clave">\n' +
    '      <h2 id="datos-clave">Datos clave</h2>\n' +
    '      <p class="facts-lede">Según los datos del mapa, <strong>' + escapeHtml(max.name) +
    '</strong> registra el valor más alto de ' + escapeHtml(label) + ' (' + escapeHtml(max.display) +
    ') y <strong>' + escapeHtml(min.name) + '</strong> el más bajo (' + escapeHtml(min.display) + ').</p>\n' +
    '      <div class="facts-grid">\n' +
    '        <div class="facts-col"><h3>Valores más altos</h3>' + list(top) + '</div>\n' +
    '        <div class="facts-col"><h3>Valores más bajos</h3>' + list(bottom) + '</div>\n' +
    '      </div>\n' +
    '    </section>';

  const stats = buildLevelStats(entries, opts);
  return { html, entries, top, bottom, max, min, label, legendTitle: title, stats };
}

// Año de los datos a partir de `dataYear` o de la fecha de la fuente
// («2024-01-01», «2019–2024»). Solo se publica cuando la fuente lo declara.
function yearOfData(input) {
  const explicit = trimmed(input && input.dataYear);
  const fromExplicit = explicit.match(/(?:19|20)\d{2}/);
  if (fromExplicit) return fromExplicit[0];
  const date = trimmed(input && input.dataDate);
  const fromDate = date.match(/(?:19|20)\d{2}/);
  return fromDate ? fromDate[0] : '';
}

function faqMarkup(questions) {
  const html = '<section class="faq" aria-labelledby="preguntas-frecuentes">\n' +
    '      <h2 id="preguntas-frecuentes">Preguntas frecuentes</h2>\n' +
    '      <dl class="faq-list">' + questions.map((item) =>
      '<div class="faq-item"><dt>' + escapeHtml(item.question) + '</dt>' +
      '<dd>' + escapeHtml(item.answer) + '</dd></div>'
    ).join('') + '</dl>\n' +
    '    </section>';

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };

  return { html, ld, questions };
}

// Preguntas frecuentes derivadas de «Datos clave» (directiva 2026-11,
// prioridad 2: capturar búsqueda). La landing ya publica el máximo y el mínimo
// del indicador; convertirlos en preguntas explícitas («¿qué país registra el
// valor más alto de…?») da contenido long-tail verificable y un FAQPage que
// Bing —la fuente de búsqueda con señal real (38/56)— puede usar en respuestas
// enriquecidas. No inventa datos: reutiliza max/min, la media y mediana de los
// mismos valores, el año que declara la fuente y la cita ya publicada.
function buildFaqSection(input) {
  const title = trimmed(input && input.title);
  const label = trimmed(input && input.label);
  const max = input && input.max;
  const min = input && input.min;
  const maxName = trimmed(max && max.name);
  const minName = trimmed(min && min.name);
  if (!title || !label || !maxName || !minName) return null;

  const displayMax = trimmed(max && max.display);
  const displayMin = trimmed(min && min.display);
  const questions = [
    {
      question: `¿Qué lugar registra el valor más alto de ${label}?`,
      answer: `${maxName}${displayMax ? ', con ' + displayMax : ''}.`,
    },
    {
      question: `¿Qué lugar registra el valor más bajo de ${label}?`,
      answer: `${minName}${displayMin ? ', con ' + displayMin : ''}.`,
    },
  ];

  // «¿Cuál es el valor medio de…?» es una búsqueda long-tail propia y la
  // respuesta ya está en los datos: media y mediana de la misma serie.
  const stats = input && input.stats;
  const meanDisplay = trimmed(stats && stats.meanDisplay);
  const medianDisplay = trimmed(stats && stats.medianDisplay);
  if (meanDisplay && medianDisplay) {
    questions.push({
      question: `¿Cuál es el valor medio de ${label}?`,
      answer: `La media es ${meanDisplay} y la mediana, ${medianDisplay}.`,
    });
  }

  const year = yearOfData(input);
  if (year) {
    questions.push({
      question: '¿De qué año son los datos del mapa?',
      answer: `Los datos corresponden a ${year}.`,
    });
  }

  const sourceLine = trimmed(input && input.sourceLine);
  const featureCount = Number(input && input.featureCount);
  if (sourceLine) {
    const parts = [`Los datos proceden de ${sourceLine}.`];
    if (isFinite(featureCount) && featureCount > 0) {
      parts.push(`El mapa incluye ${formatFactNumber(featureCount)} elementos.`);
    }
    questions.push({
      question: '¿De dónde salen los datos del mapa?',
      answer: parts.join(' '),
    });
  }

  return faqMarkup(questions);
}

// FAQs mínimas para los mapas sin variable numérica (línea AVE, océanos,
// antenas): no tienen «Datos clave», pero la landing indexada sí puede
// responder cuántos elementos incluye y de dónde salen. Evita que esas cuatro
// fichas queden sin contenido long-tail ni FAQPage.
function buildFallbackFaqSection(input) {
  const sourceLine = trimmed(input && input.sourceLine);
  const featureCount = Number(input && input.featureCount);
  const questions = [];

  if (isFinite(featureCount) && featureCount > 0) {
    questions.push({
      question: '¿Cuántos elementos incluye el mapa?',
      answer: `El mapa incluye ${formatFactNumber(featureCount)} elementos.`,
    });
  }
  if (sourceLine) {
    questions.push({
      question: '¿De dónde salen los datos del mapa?',
      answer: `Los datos proceden de ${sourceLine}.`,
    });
  }
  if (!questions.length) return null;

  return faqMarkup(questions);
}

module.exports = {
  MIN_FACT_ENTRIES,
  DEFAULT_FACTS_LIMIT,
  collectFactEntries,
  buildFactsSection,
  buildFaqSection,
  buildFallbackFaqSection,
  buildLevelStats,
  yearOfData,
  lowercaseIndicatorStart,
  unitFromLegendTitle,
  formatFactNumber,
  escapeHtml,
};
