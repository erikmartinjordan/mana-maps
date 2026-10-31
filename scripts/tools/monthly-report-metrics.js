#!/usr/bin/env node
// ── monthly-report-metrics.js ─────────────────────────────────────────────
// Genera las métricas del informe mensual de Maña Maps desde Firestore.
// Uso:
//   node scripts/tools/monthly-report-metrics.js --month 2026-10
//   node scripts/tools/monthly-report-metrics.js --month 2026-10 --out /tmp/x.json
//   node scripts/tools/monthly-report-metrics.js --month 2026-10 --md-out /tmp/x.md
//
// La salida JSON es la fuente de verdad para el informe editorial. No incluye
// datos personales: solo agregados por país/ciudad y recuentos de eventos.
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT = 'mana-maps-pro-f2177';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const INTERNAL_CITIES = new Set([
  'cornella de llobregat',
  'sant joan despi',
  'esplugues de llobregat',
  "l'hospitalet de llobregat"
]);
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const SOURCE_LABELS = {
  directo: 'Directo',
  buscadores: 'Buscadores',
  redes: 'Redes sociales',
  interno: 'Navegación interna',
  medios_otros: 'Medios / otros',
  sin_dato: 'Sin dato'
};
const COUNTRY_LABELS = {
  Mexico: 'México',
  'United States': 'Estados Unidos',
  Spain: 'España',
  Germany: 'Alemania',
  Argentina: 'Argentina',
  Colombia: 'Colombia',
  Peru: 'Perú',
  Australia: 'Australia',
  Honduras: 'Honduras',
  Ireland: 'Irlanda',
  Chile: 'Chile',
  Sweden: 'Suecia',
  Venezuela: 'Venezuela',
  Brazil: 'Brasil',
  Canada: 'Canadá',
  France: 'Francia',
  Guatemala: 'Guatemala',
  Ecuador: 'Ecuador',
  'Hong Kong': 'Hong Kong',
  "Côte d'Ivoire": 'Costa de Marfil',
  'United Kingdom': 'Reino Unido',
  Malaysia: 'Malasia'
};

function usage() {
  console.log(`Uso: node scripts/tools/monthly-report-metrics.js [--month YYYY-MM] [--out FILE] [--md-out FILE]\n\n  --month    Mes a analizar (por defecto, el mes anterior)\n  --out      Guarda el JSON en FILE\n  --md-out   Guarda un esqueleto Markdown en FILE\n  --help     Muestra esta ayuda`);
}

function parseArgs(argv) {
  const args = { month: null, out: null, mdOut: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    if (a === '--month') { args.month = argv[++i]; continue; }
    if (a === '--out') { args.out = argv[++i]; continue; }
    if (a === '--md-out') { args.mdOut = argv[++i]; continue; }
    throw new Error(`Argumento desconocido: ${a}`);
  }
  return args;
}

function previousMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthInfo(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Mes inválido: ${month}. Usa YYYY-MM.`);
  const [y, m] = month.split('-').map(Number);
  if (m < 1 || m > 12) throw new Error(`Mes inválido: ${month}`);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const prevStart = new Date(Date.UTC(y, m - 2, 1));
  const prevEnd = start;
  const prevMonth = `${prevStart.getUTCFullYear()}-${String(prevStart.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    month,
    label: `${MONTHS_ES[m - 1]} de ${y}`,
    year: y,
    monthNumber: m,
    start,
    end,
    prevStart,
    prevEnd,
    prevMonth,
    days: (end - start) / 86400000
  };
}

function readApiKey() {
  if (process.env.MANA_FIREBASE_API_KEY) return process.env.MANA_FIREBASE_API_KEY;
  const cfg = path.join(process.cwd(), 'js', 'firebase-config.local.js');
  if (!fs.existsSync(cfg)) throw new Error(`No encuentro ${cfg}. Ejecuta desde la raíz del repo o define MANA_FIREBASE_API_KEY.`);
  const text = fs.readFileSync(cfg, 'utf8');
  const m = text.match(/"pro"[\s\S]*?"apiKey"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error('No encuentro la apiKey de producción en js/firebase-config.local.js');
  return m[1];
}

function decodeValue(v) {
  if (v === null || v === undefined) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) {
    const out = {};
    for (const [k, value] of Object.entries(v.mapValue.fields || {})) out[k] = decodeValue(value);
    return out;
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  return null;
}

function decodeDoc(doc) {
  const out = { _id: doc.name.split('/').pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = decodeValue(v);
  return out;
}

async function fetchCollection(apiKey, collection, { orderBy = '', pageSize = 1000 } = {}) {
  const docs = [];
  let pageToken = null;
  while (true) {
    const params = new URLSearchParams({ key: apiKey, pageSize: String(pageSize) });
    if (orderBy) params.set('orderBy', orderBy);
    if (pageToken) params.set('pageToken', pageToken);
    const url = `${BASE}/${collection}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Firestore ${collection}: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const batch = data.documents || [];
    for (const doc of batch) docs.push(decodeDoc(doc));
    pageToken = data.nextPageToken || null;
    if (!pageToken || batch.length === 0) break;
  }
  return docs;
}

function paramsOf(event) {
  return event.params && typeof event.params === 'object' ? event.params : {};
}

function eventDate(event) {
  return new Date(event.timestamp);
}

function isInternal(event) {
  const p = paramsOf(event);
  const loc = p.location && typeof p.location === 'object' ? p.location : {};
  const city = String(loc.city || '').trim().toLowerCase();
  const ref = String(p.referrer || '').toLowerCase();
  return INTERNAL_CITIES.has(city) || ref.includes('127.0.0.1') || ref.includes('localhost');
}

function refCategory(referrer) {
  if (referrer === undefined || referrer === null) return 'sin_dato';
  const r = String(referrer).trim();
  if (!r) return 'directo';
  let host = '';
  try { host = new URL(r).hostname.toLowerCase(); } catch (_) { return 'otros'; }
  if (host.includes('xn--maa-8ma.com') || host.includes('maña.com')) return 'interno';
  if (['google.', 'bing.com', 'duckduckgo', 'yandex', 'ecosia', 'search.brave', 'yahoo.'].some((x) => host.includes(x))) return 'buscadores';
  if (['x.com', 'twitter.com', 't.co', 'linkedin', 'reddit', 'facebook', 'instagram', 'tiktok', 'youtube', 'threads', 'mastodon', 'bsky'].some((x) => host.includes(x))) return 'redes';
  return 'medios_otros';
}

function hostOf(referrer) {
  try { return new URL(String(referrer)).hostname.toLowerCase(); } catch (_) { return ''; }
}

function pct(n, d) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function mondayKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function inRange(event, start, end) {
  const t = eventDate(event);
  return t >= start && t < end;
}

function topCounts(items, limit = 20) {
  const map = new Map();
  for (const item of items) {
    const key = item === undefined || item === null || item === '' ? 'sin_dato' : String(item);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function countEvents(events, name) {
  return events.filter((e) => e.name === name).length;
}

function buildReport(month, events, maps) {
  const info = monthInfo(month);
  const monthEvents = events.filter((e) => inRange(e, info.start, info.end));
  const prevEvents = events.filter((e) => inRange(e, info.prevStart, info.prevEnd));
  const monthSessions = monthEvents.filter((e) => e.name === 'sessionstart');
  const prevSessions = prevEvents.filter((e) => e.name === 'sessionstart');

  const internal = monthSessions.filter(isInternal);
  const external = monthSessions.filter((e) => !isInternal(e));
  const prevExternal = prevSessions.filter((e) => !isInternal(e));
  const prevInternal = prevSessions.filter(isInternal);

  const dailyExternal = [];
  for (let d = new Date(info.start); d < info.end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = dayKey(d);
    dailyExternal.push({ date: key, count: external.filter((e) => dayKey(eventDate(e)) === key).length });
  }

  const weekStarts = new Map();
  for (const e of monthSessions) {
    const wk = mondayKey(eventDate(e));
    if (!weekStarts.has(wk)) weekStarts.set(wk, { week: wk, total: 0, external: 0, internal: 0 });
    const row = weekStarts.get(wk);
    row.total++;
    if (isInternal(e)) row.internal++; else row.external++;
  }
  const weekly = [...weekStarts.values()].sort((a, b) => a.week.localeCompare(b.week));

  const attributable = external.filter((e) => 'referrer' in paramsOf(e));
  const sourceCategories = topCounts(attributable.map((e) => refCategory(paramsOf(e).referrer)), 10);
  const searchHosts = topCounts(attributable
    .filter((e) => refCategory(paramsOf(e).referrer) === 'buscadores')
    .map((e) => hostOf(paramsOf(e).referrer)), 20);
  const socialHosts = topCounts(attributable
    .filter((e) => refCategory(paramsOf(e).referrer) === 'redes')
    .map((e) => hostOf(paramsOf(e).referrer)), 20);

  const geolocated = external.filter((e) => paramsOf(e).location && paramsOf(e).location.country);
  const countries = topCounts(geolocated.map((e) => paramsOf(e).location.country), 20);
  const langEvents = external.filter((e) => paramsOf(e).lang !== undefined);
  const languages = topCounts(langEvents.map((e) => paramsOf(e).lang || 'sin_dato'), 10).filter((x) => x.name !== 'sin_dato');
  const languagesUnknown = langEvents.filter((e) => !paramsOf(e).lang).length;
  const paths = topCounts(external.map((e) => {
    const raw = paramsOf(e).path;
    if (!raw) return 'sin_dato';
    try { return new URL(raw, 'https://maña.com').pathname || 'sin_dato'; } catch (_) { return 'sin_dato'; }
  }), 20);

  const published = maps.filter((m) => m.isPublished === true);
  const featureCounts = published.map((m) => Number(m.featureCount) || 0);
  const views = published.map((m) => Number(m.views) || 0);
  const likes = published.map((m) => Number(m.likes) || 0);
  const createdAtMonth = published.filter((m) => String(m.createdAt || '').startsWith(month)).length;
  const topMaps = [...published]
    .sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0))
    .slice(0, 12)
    .map((m) => ({
      slug: m.slug || m._id,
      title: m.title || m.name || m.slug || m._id,
      views: Number(m.views) || 0,
      likes: Number(m.likes) || 0,
      featureCount: Number(m.featureCount) || 0
    }));

  const eventNames = ['sessionstart', 'chatmessage', 'mapview', 'featuredrawn', 'export', 'share', 'signup', 'profile_created'];
  const productEvents = Object.fromEntries(eventNames.map((name) => [name, {
    month: countEvents(monthEvents, name),
    previous_month: countEvents(prevEvents, name),
    all_time: countEvents(events, name)
  }]));

  const newsMonth = monthSessions.filter((e) => ['news', 'news_index', 'blog', 'blog_index'].includes(paramsOf(e).contentType));
  const newsExternal = external.filter((e) => ['news', 'news_index', 'blog', 'blog_index'].includes(paramsOf(e).contentType));
  const newsSlugs = topCounts(newsMonth
    .filter((e) => paramsOf(e).contentType === 'news')
    .map((e) => paramsOf(e).slug || paramsOf(e).title || 'sin_slug'), 20);

  const coverage = {
    sessions: monthSessions.length,
    path: monthSessions.filter((e) => paramsOf(e).path !== undefined).length,
    referrer: monthSessions.filter((e) => 'referrer' in paramsOf(e)).length,
    location: monthSessions.filter((e) => paramsOf(e).location).length,
    lang: monthSessions.filter((e) => paramsOf(e).lang !== undefined).length
  };

  const prevExternalCount = prevExternal.length;
  const externalDeltaPct = prevExternalCount ? Math.round(((external.length - prevExternalCount) / prevExternalCount) * 1000) / 10 : null;

  return {
    generated_at: new Date().toISOString(),
    timezone: 'UTC',
    period: {
      month: info.month,
      label: info.label,
      start: info.start.toISOString(),
      end: info.end.toISOString(),
      days: info.days,
      previous_month: info.prevMonth
    },
    methodology: {
      session: 'Evento sessionstart (carga de página), no usuario único.',
      internal_filter: 'Excluye ciudades del entorno de desarrollo y referrers localhost/127.0.0.1.',
      attribution: 'Solo se atribuyen fuentes en sesiones externas con campo referrer.',
      location: 'Agregado por país; no se guardan IPs.',
      caveat: 'Cobertura parcial: no hay usuarios únicos ni duración de sesión.'
    },
    sessions: {
      total: monthSessions.length,
      internal: internal.length,
      external: external.length,
      previous_external: prevExternalCount,
      previous_internal: prevInternal.length,
      external_delta_pct: externalDeltaPct,
      external_per_day: info.days ? Math.round((external.length / info.days) * 10) / 10 : 0,
      external_median_daily: median(dailyExternal.map((d) => d.count)),
      daily: dailyExternal,
      weekly: weekly
    },
    sources: {
      external_sessions: external.length,
      with_referrer: attributable.length,
      without_referrer: external.length - attributable.length,
      categories: sourceCategories.map((x) => ({ ...x, label: SOURCE_LABELS[x.name] || x.name, pct: pct(x.count, attributable.length) })),
      search_hosts: searchHosts,
      social_hosts: socialHosts
    },
    markets: {
      external_sessions: external.length,
      geolocated: geolocated.length,
      unknown: external.length - geolocated.length,
      countries: countries.map((x) => ({ ...x, label: COUNTRY_LABELS[x.name] || x.name, pct: pct(x.count, geolocated.length) })),
      languages: languages.map((x) => ({ ...x, pct: pct(x.count, langEvents.length) })),
      languages_unknown: languagesUnknown
    },
    top_pages: paths,
    catalog: {
      docs: maps.length,
      published: published.length,
      feature_count_total: featureCounts.reduce((a, b) => a + b, 0),
      feature_count_median: median(featureCounts),
      feature_count_max: featureCounts.length ? Math.max(...featureCounts) : 0,
      missing_source: published.filter((m) => !m.dataSource).length,
      missing_date: published.filter((m) => !m.dataDate).length,
      missing_legend_key: published.filter((m) => !m.legendKey).length,
      created_this_month: createdAtMonth,
      views_total: views.reduce((a, b) => a + b, 0),
      likes_total: likes.reduce((a, b) => a + b, 0),
      zero_views: views.filter((v) => v === 0).length,
      top_maps: topMaps
    },
    product_events: productEvents,
    news: {
      sessions_total: newsMonth.length,
      sessions_external: newsExternal.length,
      index_sessions_external: newsExternal.filter((e) => paramsOf(e).contentType === 'news_index').length,
      article_sessions_external: newsExternal.filter((e) => paramsOf(e).contentType === 'news').length,
      articles: newsSlugs
    },
    coverage
  };
}

function markdownSkeleton(report) {
  const s = report.sessions;
  const c = report.catalog;
  const lines = [];
  lines.push('---');
  lines.push(`month: ${report.period.month}`);
  lines.push(`generated: ${report.generated_at.slice(0, 10)}`);
  lines.push('status: draft');
  lines.push('---');
  lines.push('');
  lines.push(`# Informe mensual — ${report.period.label}`);
  lines.push('');
  lines.push(`Generado: ${report.generated_at}`);
  lines.push(`Periodo: ${report.period.start.slice(0, 10)} → ${report.period.end.slice(0, 10)} (UTC)`);
  lines.push('');
  lines.push('## Métricas clave');
  lines.push('');
  lines.push('| Métrica | Valor |');
  lines.push('|---|---:|');
  lines.push(`| Sesiones externas | ${s.external} |`);
  lines.push(`| Sesiones internas/QA | ${s.internal} |`);
  lines.push(`| Mediana diaria externa | ${s.external_median_daily} |`);
  lines.push(`| Variación vs mes anterior | ${s.external_delta_pct === null ? 'n/d' : `${s.external_delta_pct}%`} |`);
  lines.push(`| Mapas publicados | ${c.published} |`);
  lines.push(`| Geometrías | ${c.feature_count_total} |`);
  lines.push(`| Visitas acumuladas a mapas | ${c.views_total} |`);
  lines.push(`| Me gusta | ${c.likes_total} |`);
  lines.push('');
  lines.push('## Fuentes');
  lines.push('');
  lines.push('| Fuente | Sesiones | % atribuible |');
  lines.push('|---|---:|---:|');
  for (const row of report.sources.categories) lines.push(`| ${row.label || row.name} | ${row.count} | ${row.pct}% |`);
  lines.push('');
  lines.push('## Mercados');
  lines.push('');
  lines.push('| País | Sesiones | % geolocalizado |');
  lines.push('|---|---:|---:|');
  for (const row of report.markets.countries.slice(0, 8)) lines.push(`| ${row.label || row.name} | ${row.count} | ${row.pct}% |`);
  lines.push('');
  lines.push('## Lectura');
  lines.push('');
  lines.push('<!-- 3-5 bullets con la interpretación. No repitas la tabla. -->');
  lines.push('');
  lines.push('## Prioridades para el próximo mes');
  lines.push('');
  lines.push('1. <!-- Prioridad 1, con métrica de éxito. -->');
  lines.push('2. <!-- Prioridad 2, con métrica de éxito. -->');
  lines.push('3. <!-- Prioridad 3, con métrica de éxito. -->');
  lines.push('');
  lines.push('## Instrucciones por rol');
  lines.push('');
  lines.push('- ideator: <!-- qué debe proponer o evitar. -->');
  lines.push('- mapmaker: <!-- qué mapas hacer o si hay que pausar producción. -->');
  lines.push('- blogger: <!-- qué ángulos cubrir y qué no. -->');
  lines.push('- reviewer: <!-- qué debe vigilar. -->');
  lines.push('');
  lines.push('## Fuente de datos');
  lines.push('');
  lines.push('`scripts/tools/monthly-report-metrics.js` sobre Firestore (`events` y `maps`).');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const month = args.month || previousMonth();
  const info = monthInfo(month);
  const apiKey = readApiKey();
  const [events, maps] = await Promise.all([
    fetchCollection(apiKey, 'events', { orderBy: 'timestamp desc' }),
    fetchCollection(apiKey, 'maps', { pageSize: 300 })
  ]);
  const report = buildReport(month, events, maps);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, json);
    console.error(`JSON: ${args.out}`);
  } else {
    process.stdout.write(json);
  }
  if (args.mdOut) {
    fs.mkdirSync(path.dirname(path.resolve(args.mdOut)), { recursive: true });
    fs.writeFileSync(args.mdOut, markdownSkeleton(report));
    console.error(`Markdown: ${args.mdOut}`);
  }
  console.error(`Informe ${info.month}: ${report.sessions.external} sesiones externas, ${report.sessions.internal} internas.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nError: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { buildReport, monthInfo, previousMonth, isInternal, refCategory };
