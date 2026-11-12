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
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value);
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

  return { html, entries, top, bottom, max, min, label, legendTitle: title };
}

// Preguntas frecuentes derivadas de «Datos clave» (directiva 2026-11,
// prioridad 2: capturar búsqueda). La landing ya publica el máximo y el mínimo
// del indicador; convertirlos en preguntas explícitas («¿qué país registra el
// valor más alto de…?») da contenido long-tail verificable y un FAQPage que
// Bing —la fuente de búsqueda con señal real (38/56)— puede usar en respuestas
// enriquecidas. No inventa datos: reutiliza max/min y la fuente ya citada.
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

module.exports = {
  MIN_FACT_ENTRIES,
  DEFAULT_FACTS_LIMIT,
  collectFactEntries,
  buildFactsSection,
  buildFaqSection,
  lowercaseIndicatorStart,
  unitFromLegendTitle,
  formatFactNumber,
  escapeHtml,
};
