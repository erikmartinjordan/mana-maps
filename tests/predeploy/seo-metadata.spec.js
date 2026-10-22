const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  auditSeoMetadata,
  parseCollectionLd,
  parseSitemapGallerySlugs,
  auditLandingCoverage,
  parseLandingMetadata,
  auditLandingMetadata,
} = require('../../scripts/tools/audit-gallery-quality');

// Regresión del check 10 de scripts/tools/audit-gallery-quality.js: el JSON-LD
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

// Regresión del check 11: todo mapa publicado debe tener su landing estática
// (gallery/<slug>/index.html con el slug dentro) y su OG card
// (og-cards/<slug>.png no vacía).
test('landing and OG card coverage is complete for every published map', () => {
  const published = parseCollectionLd(galleryHtml).slugs;
  const result = auditLandingCoverage(published);
  expect(result.issues).toEqual([]);
  expect(result.missingLandings).toEqual([]);
  expect(result.landingsWithoutSlug).toEqual([]);
  expect(result.missingOgCards).toEqual([]);
});

test('landing coverage check reports missing landings, OG cards and absent slugs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-landing-coverage-'));
  const galleryDir = path.join(tmp, 'gallery');
  const ogDir = path.join(tmp, 'og-cards');
  fs.mkdirSync(galleryDir, { recursive: true });
  fs.mkdirSync(ogDir, { recursive: true });

  // 'ok-map': landing correcta + OG card con contenido.
  fs.mkdirSync(path.join(galleryDir, 'ok-map'));
  fs.writeFileSync(path.join(galleryDir, 'ok-map', 'index.html'), '<link rel="canonical" href="https://maña.com/gallery/ok-map/">');
  fs.writeFileSync(path.join(ogDir, 'ok-map.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  // 'sin-landing': no tiene directorio.
  fs.writeFileSync(path.join(ogDir, 'sin-landing.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  // 'sin-slug': landing que no menciona su slug.
  fs.mkdirSync(path.join(galleryDir, 'sin-slug'));
  fs.writeFileSync(path.join(galleryDir, 'sin-slug', 'index.html'), '<title>otra cosa</title>');
  fs.writeFileSync(path.join(ogDir, 'sin-slug.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  // 'sin-og': no tiene OG card.
  fs.mkdirSync(path.join(galleryDir, 'sin-og'));
  fs.writeFileSync(path.join(galleryDir, 'sin-og', 'index.html'), '<link rel="canonical" href="https://maña.com/gallery/sin-og/">');

  // 'og-vacia': OG card de 0 bytes, cuenta como faltante.
  fs.mkdirSync(path.join(galleryDir, 'og-vacia'));
  fs.writeFileSync(path.join(galleryDir, 'og-vacia', 'index.html'), '/gallery/og-vacia/');
  fs.writeFileSync(path.join(ogDir, 'og-vacia.png'), '');

  // 'landing-vacia': landing de 0 bytes, tampoco contiene su slug.
  fs.mkdirSync(path.join(galleryDir, 'landing-vacia'));
  fs.writeFileSync(path.join(galleryDir, 'landing-vacia', 'index.html'), '');
  fs.writeFileSync(path.join(ogDir, 'landing-vacia.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const slugs = ['ok-map', 'sin-landing', 'sin-slug', 'sin-og', 'og-vacia', 'landing-vacia'];
  const result = auditLandingCoverage(slugs, { galleryDir, ogCardsDir: ogDir });

  expect(result.missingLandings).toEqual(['sin-landing']);
  expect(result.landingsWithoutSlug).toEqual(['landing-vacia', 'sin-slug']);
  expect(result.missingOgCards).toEqual(['og-vacia', 'sin-og']);
  const issues = result.issues.join('\n');
  expect(issues).toContain('faltan 1 landings gallery/<slug>/index.html (sin-landing)');
  expect(issues).toContain('2 landings no contienen su slug (landing-vacia, sin-slug)');
  expect(issues).toContain('faltan 2 OG cards og-cards/<slug>.png (og-vacia, sin-og)');

  fs.rmSync(tmp, { recursive: true, force: true });
});

// Regresión del check 12: cada landing estática es una página SEO propia y
// debe tener <title> propio, meta description no vacía, canonical con su slug
// y JSON-LD Dataset.
function landingDoc({ title, description, canonical, dataset }) {
  return [
    '<!DOCTYPE html><html lang="es"><head>',
    title === undefined ? '' : `<title>${title}</title>`,
    description === undefined ? '' : `<meta name="description" content="${description}">`,
    canonical === undefined ? '' : `<link rel="canonical" href="${canonical}">`,
    dataset === undefined ? '' : `<script type="application/ld+json">${dataset}</script>`,
    '</head><body></body></html>',
  ].join('\n');
}

test('landing metadata is complete for every published map', () => {
  const published = parseCollectionLd(galleryHtml).slugs;
  const result = auditLandingMetadata(published);
  expect(result.issues).toEqual([]);
  expect(result.missingLandings).toEqual([]);
  expect(result.missingTitle).toEqual([]);
  expect(result.genericTitle).toEqual([]);
  expect(result.duplicateTitles).toEqual([]);
  expect(result.missingDescription).toEqual([]);
  expect(result.missingCanonical).toEqual([]);
  expect(result.wrongCanonical).toEqual([]);
  expect(result.missingDataset).toEqual([]);
  expect(result.invalidJsonLd).toEqual([]);
  for (const slug of published) {
    expect(result.details[slug].title, slug).toBeTruthy();
    expect(result.details[slug].dataset, slug).toBe(true);
  }
});

test('landing metadata check parses and reports missing, generic or wrong metadata', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-landing-meta-'));
  const galleryDir = path.join(tmp, 'gallery');
  fs.mkdirSync(galleryDir, { recursive: true });

  const write = (slug, html) => {
    fs.mkdirSync(path.join(galleryDir, slug));
    fs.writeFileSync(path.join(galleryDir, slug, 'index.html'), html);
  };
  const validDataset = '{"@context":"https://schema.org","@type":"Dataset","name":"Mapa"}';

  write('ok-map', landingDoc({
    title: 'Un mapa correcto — Maña Maps',
    description: 'Descripción útil del mapa.',
    canonical: 'https://maña.com/gallery/ok-map/',
    dataset: validDataset,
  }));
  write('sin-title', landingDoc({
    description: 'Descripción',
    canonical: 'https://maña.com/gallery/sin-title/',
    dataset: validDataset,
  }));
  write('titulo-generico', landingDoc({
    title: 'Maña Maps — Galería',
    description: 'Descripción',
    canonical: 'https://maña.com/gallery/titulo-generico/',
    dataset: validDataset,
  }));
  write('titulo-repetido-a', landingDoc({
    title: 'Mapa repetido — Maña Maps',
    description: 'Descripción',
    canonical: 'https://maña.com/gallery/titulo-repetido-a/',
    dataset: validDataset,
  }));
  write('titulo-repetido-b', landingDoc({
    title: 'Mapa repetido — Maña Maps',
    description: 'Descripción',
    canonical: 'https://maña.com/gallery/titulo-repetido-b/',
    dataset: validDataset,
  }));
  write('sin-description', landingDoc({
    title: 'Sin description — Maña Maps',
    description: '   ',
    canonical: 'https://maña.com/gallery/sin-description/',
    dataset: validDataset,
  }));
  write('sin-canonical', landingDoc({
    title: 'Sin canonical — Maña Maps',
    description: 'Descripción',
    dataset: validDataset,
  }));
  write('canonical-ajeno', landingDoc({
    title: 'Canonical ajeno — Maña Maps',
    description: 'Descripción',
    canonical: 'https://maña.com/gallery/otro-mapa/',
    dataset: validDataset,
  }));
  write('sin-dataset', landingDoc({
    title: 'Sin Dataset — Maña Maps',
    description: 'Descripción',
    canonical: 'https://maña.com/gallery/sin-dataset/',
    dataset: '{"@context":"https://schema.org","@type":"WebPage","name":"Mapa"}',
  }));
  write('dataset-invalido', landingDoc({
    title: 'Dataset inválido — Maña Maps',
    description: 'Descripción',
    canonical: 'https://maña.com/gallery/dataset-invalido/',
    dataset: '{no es json}',
  }));

  const slugs = [
    'ok-map', 'sin-title', 'titulo-generico', 'titulo-repetido-a',
    'titulo-repetido-b', 'sin-description', 'sin-canonical',
    'canonical-ajeno', 'sin-dataset', 'dataset-invalido', 'sin-landing',
  ];
  const result = auditLandingMetadata(slugs, { galleryDir });

  expect(result.missingLandings).toEqual(['sin-landing']);
  expect(result.missingTitle).toEqual(['sin-title']);
  expect(result.genericTitle).toEqual(['titulo-generico']);
  expect(result.duplicateTitles).toEqual([
    { title: 'Mapa repetido — Maña Maps', slugs: ['titulo-repetido-a', 'titulo-repetido-b'] },
  ]);
  expect(result.missingDescription).toEqual(['sin-description']);
  expect(result.missingCanonical).toEqual(['sin-canonical']);
  expect(result.wrongCanonical).toEqual([
    { slug: 'canonical-ajeno', href: 'https://maña.com/gallery/otro-mapa/', canonicalSlug: 'otro-mapa' },
  ]);
  expect(result.invalidJsonLd).toHaveLength(1);
  expect(result.invalidJsonLd[0].slug).toBe('dataset-invalido');
  expect(result.missingDataset).toEqual(['dataset-invalido', 'sin-dataset']);

  const issues = result.issues.join('\n');
  expect(issues).toContain('faltan 1 landings gallery/<slug>/index.html (sin-landing)');
  expect(issues).toContain('1 landings sin <title> (sin-title)');
  expect(issues).toContain('1 landings con <title> genérico (titulo-generico)');
  expect(issues).toContain('títulos de landing duplicados: "Mapa repetido — Maña Maps"');
  expect(issues).toContain('1 landings sin meta description (sin-description)');
  expect(issues).toContain('1 landings sin canonical (sin-canonical)');
  expect(issues).toContain('canonical incorrecto en canonical-ajeno');
  expect(issues).toContain('JSON-LD inválido en dataset-invalido');
  expect(issues).toContain('2 landings sin JSON-LD Dataset (dataset-invalido, sin-dataset)');

  // El parser tolera el orden de atributos y decodifica entidades.
  const parsed = parseLandingMetadata(
    '<title>Mapa &amp; datos — Maña Maps</title>' +
    '<meta content="A &quot;b&quot; c" name="description">' +
    '<link href="https://maña.com/gallery/orden/?" rel="canonical">'
  );
  expect(parsed.title).toBe('Mapa & datos — Maña Maps');
  expect(parsed.description).toBe('A "b" c');
  expect(parsed.canonical).toBe('https://maña.com/gallery/orden/?');

  fs.rmSync(tmp, { recursive: true, force: true });
});
