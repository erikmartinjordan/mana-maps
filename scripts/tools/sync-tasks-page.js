#!/usr/bin/env node
'use strict';

/**
 * Sincroniza el historial de tareas que genera el autopilot (site/tasks.html)
 * con la página pública (site/tasks/index.html), que es la que sirve /tasks/.
 *
 * El updater del iMac sigue escribiendo site/tasks.html; este script copia sus
 * datos (stats y tarjetas) al índice oscuro sin tocar el diseño.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(root, 'site', 'tasks.html');
const targetPath = path.join(root, 'site', 'tasks', 'index.html');
const check = process.argv.includes('--check');

function fail(message) {
  console.error(`sync-tasks-page: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(sourcePath)) fail(`no existe ${path.relative(root, sourcePath)}`);
if (!fs.existsSync(targetPath)) fail(`no existe ${path.relative(root, targetPath)}`);

const source = fs.readFileSync(sourcePath, 'utf8');
let target = fs.readFileSync(targetPath, 'utf8');

const stats = [...source.matchAll(/<div class="stat-value">([\s\S]*?)<\/div>/g)].map((m) => m[1].trim());
if (stats.length !== 3) fail(`esperaba 3 valores de stats en site/tasks.html, encontré ${stats.length}`);

const listMatch = source.match(/<section class="task-list"[^>]*>([\s\S]*?)<\/section>/);
if (!listMatch) fail('no encontré la lista de tareas en site/tasks.html');

let cards = listMatch[1].trim();
cards = cards.replace(/<\/article><article/g, '</article>\n    <article');
const listBlock = `<section class="task-list" aria-label="Historial de tareas">\n    ${cards}\n  </section>`;

let statIndex = 0;
target = target.replace(/(<div class="stat-value">)([\s\S]*?)(<\/div>)/g, (match, open, value, close) => {
  if (statIndex >= stats.length) return match;
  return `${open}${stats[statIndex++]}${close}`;
});
if (statIndex !== 3) fail(`esperaba 3 valores de stats en site/tasks/index.html, encontré ${statIndex}`);

if (!/<section class="task-list"[^>]*>[\s\S]*?<\/section>/.test(target)) {
  fail('no encontré la lista de tareas en site/tasks/index.html');
}
target = target.replace(/<section class="task-list"[^>]*>[\s\S]*?<\/section>/, listBlock);

if (target === fs.readFileSync(targetPath, 'utf8')) {
  console.log('sync-tasks-page: sin cambios');
  process.exit(0);
}

if (check) {
  console.error('sync-tasks-page: site/tasks/index.html está desincronizado');
  process.exit(1);
}

fs.writeFileSync(targetPath, target);
console.log(`sync-tasks-page: actualizado ${path.relative(root, targetPath)} (${stats.join(' · ')})`);
