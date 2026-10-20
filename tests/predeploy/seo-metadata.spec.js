const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  auditSeoMetadata,
  parseCollectionLd,
  parseSitemapGallerySlugs,
} = require('../../scripts/audit-gallery-quality');

// Regresión del check 10 de scripts/audit-gallery-quality.js: el JSON-LD
// CollectionPage de /gallery/ y sitemap.xml son ficheros estáticos que deben
// seguir sincronizados con los mapas publicados en Firestore.
const repoRoot = path.resolve(__dirname, '..', '..');
const galleryHtml = fs.readFileSync(path.join(repoRoot, 'gallery', 'index.html'), 'utf8');
const sitemapXml = fs.readFileSync(path.join(repoRoot, 'sitemap.xml'), 'utf8');

test('gallery CollectionPage and sitemap stay internally consistent', () => {
  const collection = parseCollectionLd(galleryHtml);
  expect(collection.found, collection.error || '').toBe(true);
  expect(collection.numberOfItems).toBe(collection.itemCount);
  expect(collection.invalidItems).toBe(0);
  expect(collection.duplicates).toEqual([]);
  expect(collection.positionsOk).toBe(true);

  const sitemapSlugs = parseSitemapGallerySlugs(sitemapXml);
  expect(sitemapSlugs.length).toBeGreaterThan(0);

  // Sin acceso a Firestore en los tests, se usa la propia CollectionPage como
  // fuente publicada: ambos ficheros deben coincidir exactamente.
  const result = auditSeoMetadata(collection.slugs, { galleryHtml, sitemapXml });
  expect(result.issues).toEqual([]);
});

test('SEO drift check reports missing and extra published maps', () => {
  const published = parseCollectionLd(galleryHtml).slugs;

  const withNewMap = auditSeoMetadata([...published, 'nuevo-mapa'], { galleryHtml, sitemapXml });
  const addedIssues = withNewMap.issues.join('\n');
  expect(addedIssues).toContain('JSON-LD CollectionPage: faltan 1 publicados (nuevo-mapa)');
  expect(addedIssues).toContain('sitemap.xml: faltan 1 publicados (nuevo-mapa)');

  const withoutOne = auditSeoMetadata(published.slice(1), { galleryHtml, sitemapXml });
  const removedIssues = withoutOne.issues.join('\n');
  expect(removedIssues).toContain(`sobran 1 no publicados o inexistentes (${published[0]})`);
});

test('SEO drift check detects numberOfItems mismatches and accepts ?slug sitemap URLs', () => {
  const published = parseCollectionLd(galleryHtml).slugs;

  const driftHtml = galleryHtml.replace(/"numberOfItems":\s*\d+/, '"numberOfItems": 0');
  const drift = auditSeoMetadata(published, { galleryHtml: driftHtml, sitemapXml });
  expect(drift.issues.join('\n')).toContain('numberOfItems=0');

  const querySitemap = '<urlset>' + published
    .map(slug => `<loc>https://maña.com/gallery/?slug=${slug}</loc>`)
    .join('') + '</urlset>';
  const queryResult = auditSeoMetadata(published, { galleryHtml, sitemapXml: querySitemap });
  expect(queryResult.issues).toEqual([]);
});
