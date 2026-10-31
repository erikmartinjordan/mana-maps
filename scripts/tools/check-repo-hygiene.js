#!/usr/bin/env node
// ── check-repo-hygiene.js ─────────────────────────────────────────────────
// Guardia de estructura y peso del repositorio. Se ejecuta en CI y falla si
// reaparecen temporales, bundles obsoletos, datos fuera de sitio o archivos
// demasiado grandes.
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_BYTES = 35 * 1024 * 1024;
const ALLOWED_LARGE = new Set([]);

function listTracked() {
  const raw = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' });
  return raw.toString('utf8').split('\0').filter(Boolean);
}

const FORBIDDEN = [
  { re: /(^|\/)\.DS_Store$/, msg: '.DS_Store trackeado' },
  { re: /^nlog?$/, msg: 'archivo temporal n/nlog en la raíz' },
  { re: /\.tmp\.js$/, msg: 'temporal *.tmp.js trackeado' },
  { re: /^data\/gallery-.*\.js$/, msg: 'bundle local data/gallery-*.js' },
  { re: /^(test-results|playwright-report|blob-report|node_modules)\//, msg: 'artefacto de test/dependencias trackeado' },
  { re: /^data\/[^/]+\.geojson$/, msg: 'GeoJSON suelto en data/ (debe ir en data/maps/)' },
  { re: /^scripts\/[^/]+\.js$/, msg: 'script de mapa/utilidad en la raíz de scripts/' },
  { re: /^(strategy|styles|brand)\//, msg: 'carpeta antigua en la raíz' },
  { re: /^autopilot\/strategy\//, msg: 'autopilot/strategy/ se movió a autopilot/monthly/' },
  { re: /^autopilot\/blogger\//, msg: 'autopilot/blogger/ se integró en autopilot/agents/blogger.md' },
  { re: /^autopilot\/monthly\/data\//, msg: 'los datos crudos van a data/sources/, no a autopilot/' },
  { re: /^(styles\.css|auth-gallery\.css|og-card\.png|globe-thumb\.png|fabrica\.html)$/, msg: 'archivo movido que sigue en la raíz' }
];

const tracked = listTracked();
const errors = [];
let totalBytes = 0;

for (const rel of tracked) {
  const abs = path.resolve(rel);
  let size = 0;
  try { size = fs.statSync(abs).size; } catch (_) { errors.push(`${rel}: no se encuentra en el árbol de trabajo`); continue; }
  totalBytes += size;

  for (const rule of FORBIDDEN) {
    if (rule.re.test(rel)) errors.push(`${rel}: ${rule.msg}`);
  }
  if (size > MAX_FILE_BYTES && !ALLOWED_LARGE.has(rel)) {
    errors.push(`${rel}: ${(size / 1024 / 1024).toFixed(2)} MB (> ${MAX_FILE_BYTES / 1024 / 1024} MB)`);
  }
}

// data/: solo maps/, sources/ y README.md
for (const rel of tracked) {
  if (!rel.startsWith('data/')) continue;
  const parts = rel.split('/');
  if (parts.length === 2 && parts[1] !== 'README.md') {
    errors.push(`${rel}: en data/ solo se permiten maps/, sources/ y README.md`);
  }
}

// scripts/: solo lib/, maps/, tools/ y README.md
for (const rel of tracked) {
  if (!rel.startsWith('scripts/')) continue;
  const parts = rel.split('/');
  if (parts.length === 2 && parts[1] !== 'README.md') {
    errors.push(`${rel}: en scripts/ solo se permiten lib/, maps/, tools/ y README.md`);
  }
}

// Carpetas mínimas del pipeline
for (const dir of ['data/maps', 'data/sources', 'scripts/maps', 'scripts/tools', 'scripts/lib']) {
  if (!fs.existsSync(dir)) errors.push(`falta la carpeta ${dir}/`);
}
if (!fs.existsSync('scripts/lib/publisher.js')) errors.push('falta scripts/lib/publisher.js');
if (!fs.existsSync('scripts/README.md')) errors.push('falta scripts/README.md');
if (!fs.existsSync('scripts/tools/monthly-report-metrics.js')) errors.push('falta scripts/tools/monthly-report-metrics.js');
if (!fs.existsSync('autopilot/reports/monthly/TEMPLATE.md')) errors.push('falta autopilot/reports/monthly/TEMPLATE.md');
if (!fs.existsSync('autopilot/reports/monthly/README.md')) errors.push('falta autopilot/reports/monthly/README.md');
if (!fs.existsSync('autopilot/monthly/TEMPLATE.md')) errors.push('falta autopilot/monthly/TEMPLATE.md');

// News: cada post de posts.json vive en news/<slug>/ y en/news/<slug>/
let newsPosts = [];
try {
  newsPosts = JSON.parse(fs.readFileSync('news/posts.json', 'utf8'));
} catch (e) {
  errors.push(`news/posts.json: no se puede leer (${e.message})`);
}
for (const post of newsPosts) {
  for (const lang of ['es', 'en']) {
    const translation = post.translations && post.translations[lang];
    if (!translation || !translation.slug) {
      errors.push(`news/posts.json: entrada ${post.date} sin traducción ${lang}`);
      continue;
    }
    const expectedUrl = lang === 'es' ? `/news/${translation.slug}/` : `/en/news/${translation.slug}/`;
    if (translation.url !== expectedUrl) {
      errors.push(`news/posts.json: ${translation.slug} debe usar ${expectedUrl}`);
    }
    const articlePath = lang === 'es'
      ? path.join('news', translation.slug, 'index.html')
      : path.join('en', 'news', translation.slug, 'index.html');
    if (!fs.existsSync(articlePath)) {
      errors.push(`falta ${articlePath}`);
    }
    const legacyPrefix = lang === 'es' ? `${translation.slug}/` : `en/${translation.slug}/`;
    if (tracked.some((rel) => rel.startsWith(legacyPrefix))) {
      errors.push(`${translation.slug}: el artículo no debe vivir en la raíz (${legacyPrefix})`);
    }
  }
}

if (totalBytes > MAX_TOTAL_BYTES) {
  errors.push(`tamaño total trackeado ${(totalBytes / 1024 / 1024).toFixed(2)} MB (> ${MAX_TOTAL_BYTES / 1024 / 1024} MB)`);
}

if (errors.length) {
  console.error(`\nHigiene del repo: ${errors.length} problema(s)\n`);
  errors.slice(0, 50).forEach((e) => console.error(`  - ${e}`));
  if (errors.length > 50) console.error(`  … y ${errors.length - 50} más`);
  console.error('');
  process.exit(1);
}

console.log(`Higiene OK · ${tracked.length} archivos · ${(totalBytes / 1024 / 1024).toFixed(2)} MB trackeados`);
