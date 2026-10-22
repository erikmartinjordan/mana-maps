#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_PREFIXES = ['#', 'http://', 'https://', '//', 'mailto:', 'tel:', 'javascript:', 'data:'];
const OPTIONAL_LOCAL_ASSETS = new Set([
  '/js/firebase-config.local.js',
  'js/firebase-config.local.js',
  '../js/firebase-config.local.js'
]);
const ATTR_RE = /\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi;

function walkHtml(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, files);
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(full);
  }
}

function shouldSkip(url) {
  const u = url.trim();
  if (!u || OPTIONAL_LOCAL_ASSETS.has(u)) return true;
  return SKIP_PREFIXES.some((prefix) => u.startsWith(prefix));
}

function checkLocalAssets(root = path.resolve(__dirname, '..', '..')) {
  const files = [];
  walkHtml(root, files);
  const missing = [];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    ATTR_RE.lastIndex = 0;
    let match;
    while ((match = ATTR_RE.exec(text)) !== null) {
      const raw = match[2].split('?', 1)[0].split('#', 1)[0];
      if (shouldSkip(raw)) continue;

      let target = raw.startsWith('/')
        ? path.join(root, raw.replace(/^\/+/, ''))
        : path.resolve(path.dirname(file), raw);

      if (raw.endsWith('/')) target = path.join(target, 'index.html');
      if (!fs.existsSync(target)) missing.push({ file: path.relative(root, file), ref: raw });
    }
  }

  return { checked: files.length, missing };
}

if (require.main === module) {
  const { checked, missing } = checkLocalAssets();
  if (missing.length) {
    console.error('Missing local asset references found:');
    for (const { file, ref } of missing) console.error(`  - ${file}: ${ref}`);
    process.exit(1);
  }
  console.log(`Checked ${checked} HTML files. All local references resolved.`);
}

module.exports = { checkLocalAssets };
