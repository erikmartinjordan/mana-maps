const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { isListed, isSharedLink, splitCatalog } = require('../../scripts/lib/gallery-catalog');
const { buildReport } = require('../../scripts/tools/monthly-report-metrics');

const repoRoot = path.resolve(__dirname, '..', '..');

// Un documento de /maps se publica de dos formas: ficha de catálogo
// (isPublished sin unlisted) o enlace compartido (isPublished + unlisted). El
// enlace compartido se abre por URL pero no es una tarjeta de la galería, así
// que no tiene landing, OG card, sitemap, JSON-LD ni enlaces internos. La
// definición vive en scripts/lib/gallery-catalog.js y la usan todas las
// herramientas de catálogo; si una vuelve a filtrar por `isPublished` a pelo,
// reaparecen las incidencias falsas de la auditoría (27-11).
test('gallery catalog separates listed cards from unlisted share links', () => {
  expect(isListed({ isPublished: true })).toBe(true);
  expect(isListed({ isPublished: true, unlisted: false })).toBe(true);
  expect(isListed({ isPublished: true, unlisted: true })).toBe(false);
  expect(isListed({ isPublished: false })).toBe(false);
  expect(isListed(null)).toBe(false);

  expect(isSharedLink({ isPublished: true, unlisted: true })).toBe(true);
  expect(isSharedLink({ isPublished: true })).toBe(false);
  expect(isSharedLink({ isPublished: false, unlisted: true })).toBe(false);

  const { listed, shared } = splitCatalog([
    { id: 'card', isPublished: true },
    { id: 'share', isPublished: true, unlisted: true },
    { id: 'draft', isPublished: false },
  ]);
  expect(listed.map((m) => m.id)).toEqual(['card']);
  expect(shared.map((m) => m.id)).toEqual(['share']);
});

test('monthly report counts only gallery cards, not unlisted share links', () => {
  const maps = [
    { _id: 'card-a', slug: 'card-a', title: 'A', isPublished: true, views: 0, featureCount: 10 },
    { _id: 'card-b', slug: 'card-b', title: 'B', isPublished: true, views: 5, featureCount: 20 },
    { _id: 'share', slug: 'share', title: 'S', isPublished: true, unlisted: true, views: 0, featureCount: 3 },
    { _id: 'draft', slug: 'draft', title: 'D', isPublished: false, views: 0, featureCount: 1 },
  ];
  const report = buildReport('2026-10', [], maps);

  expect(report.catalog.docs).toBe(4);
  expect(report.catalog.published).toBe(2);
  expect(report.catalog.zero_views).toBe(1);
  expect(report.catalog.views_total).toBe(5);
  expect(report.catalog.top_maps.map((m) => m.slug)).toEqual(['card-b', 'card-a']);
});

test('catalog tools read the gallery catalog through the shared helper', () => {
  const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

  const landings = read('scripts/tools/generate-map-landings.js');
  expect(landings).toMatch(/require\('\.\.\/lib\/gallery-catalog'\)/);
  expect(landings).toMatch(/if \(isListed\(m\) && m\.slug\) maps\.push\(m\)/);
  expect(landings).not.toMatch(/m\.isPublished === true/);

  const sitemap = read('scripts/tools/update-sitemap-gallery.js');
  expect(sitemap).toMatch(/require\('\.\.\/lib\/gallery-catalog'\)/);
  expect(sitemap).toMatch(/if \(isListed\(map\) && !publishedSlugs\.includes\(id\)\)/);

  const labelStyle = read('scripts/tools/audit-label-style.js');
  expect(labelStyle).toMatch(/const published = allMaps\.filter\(isListed\)/);

  const metrics = read('scripts/tools/monthly-report-metrics.js');
  expect(metrics).toMatch(/const published = maps\.filter\(isListed\)/);

  const audit = read('scripts/tools/audit-gallery-quality.js');
  expect(audit).toMatch(/const published = allMaps\.filter\(isListed\)/);
});
