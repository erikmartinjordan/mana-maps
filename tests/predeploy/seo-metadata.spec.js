const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildRelatedIndex, buildDiscoveryIndex } = require('../../scripts/lib/related-maps');
const {
  auditSeoMetadata,
  parseCollectionLd,
  parseSitemapGallerySlugs,
  auditLandingCoverage,
  auditInternalLinkCoverage,
  extractLandingLinks,
  auditNewsLandingLinks,
  extractPrimaryMapSlug,
  extractViewerMapSlugs,
  extractFooterLinks,
  parseLandingMetadata,
  auditLandingMetadata,
  auditMetadataHygiene,
  auditLegendCoherence,
  legendNumericCandidates,
  isLegendNumericLike,
  normalizeDataDate,
  isValidIsoDataDate,
  isValidDescription,
  shortenDescription,
  DESCRIPTION_MIN_LEN,
  DESCRIPTION_MAX_LEN,
  isAreaEntityName,
} = require('../../scripts/tools/audit-gallery-quality');

// Regresión del check 10 de scripts/tools/audit-gallery-quality.js: el JSON-LD
// CollectionPage de /gallery/ y sitemap.xml son ficheros estáticos que deben
// seguir sincronizados con los mapas publicados en Firestore.
const repoRoot = path.resolve(__dirname, '..', '..');
const siteRoot = path.join(repoRoot, 'site');
const galleryHtml = fs.readFileSync(path.join(siteRoot, 'gallery', 'index.html'), 'utf8');
const sitemapXml = fs.readFileSync(path.join(siteRoot, 'sitemap.xml'), 'utf8');

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
  expect(result.orphanLandings).toEqual([]);
  expect(result.orphanOgCards).toEqual([]);
});

test('landing coverage check reports missing landings, OG cards, absent slugs and orphans', () => {
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

  // 'huerfana': ya no está publicada pero conserva landing y OG card.
  fs.mkdirSync(path.join(galleryDir, 'huerfana'));
  fs.writeFileSync(path.join(galleryDir, 'huerfana', 'index.html'), '/gallery/huerfana/');
  fs.writeFileSync(path.join(ogDir, 'huerfana.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  // Los ficheros que no son PNG (p. ej. _render.log) no cuentan como OG card.
  fs.writeFileSync(path.join(ogDir, '_render.log'), 'log');

  const slugs = ['ok-map', 'sin-landing', 'sin-slug', 'sin-og', 'og-vacia', 'landing-vacia'];
  const result = auditLandingCoverage(slugs, { galleryDir, ogCardsDir: ogDir });

  expect(result.missingLandings).toEqual(['sin-landing']);
  expect(result.landingsWithoutSlug).toEqual(['landing-vacia', 'sin-slug']);
  expect(result.missingOgCards).toEqual(['og-vacia', 'sin-og']);
  expect(result.orphanLandings).toEqual(['huerfana']);
  expect(result.orphanOgCards).toEqual(['huerfana']);
  const issues = result.issues.join('\n');
  expect(issues).toContain('faltan 1 landings gallery/<slug>/index.html (sin-landing)');
  expect(issues).toContain('2 landings no contienen su slug (landing-vacia, sin-slug)');
  expect(issues).toContain('faltan 2 OG cards og-cards/<slug>.png (og-vacia, sin-og)');
  expect(issues).toContain('sobran 1 landings de mapas no publicados (huerfana)');
  expect(issues).toContain('sobran 1 OG cards de mapas no publicados (huerfana)');

  fs.rmSync(tmp, { recursive: true, force: true });
});

// Regresión del check 15: las landings estáticas deben enlazarse entre sí para
// que ningún mapa publicado quede sin enlaces internos entrantes (prioridad de
// distribución de noviembre: mapas con cero visitas).
test('every published map receives internal links from another static landing', () => {
  const published = parseCollectionLd(galleryHtml).slugs;
  const result = auditInternalLinkCoverage(published);
  expect(result.issues).toEqual([]);
  expect(result.orphans).toEqual([]);
  for (const slug of published) {
    expect(result.details[slug].length, `${slug} sin enlaces entrantes`).toBeGreaterThan(0);
  }
});

test('internal link coverage ignores self links and reports orphan landings', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-internal-links-'));
  const galleryDir = path.join(tmp, 'gallery');
  const writeLanding = (slug, links) => {
    fs.mkdirSync(path.join(galleryDir, slug), { recursive: true });
    const anchors = links.map(l => `<li><a href="/gallery/${l}/">${l}</a></li>`).join('');
    fs.writeFileSync(path.join(galleryDir, slug, 'index.html'), `<section class="related"><ul>${anchors}</ul></section>`);
  };

  writeLanding('a', ['b']);
  writeLanding('b', ['a', 'b', 'c']);
  writeLanding('c', ['c']);
  writeLanding('sin-fichero', []);

  const result = auditInternalLinkCoverage(['a', 'b', 'c', 'sin-fichero'], { galleryDir });
  expect(result.details.a).toEqual(['b']);
  expect(result.details.b).toEqual(['a']);
  expect(result.details.c).toEqual(['b']);
  expect(result.details['sin-fichero']).toEqual([]);
  expect(result.orphans).toEqual(['sin-fichero']);
  expect(result.issues.join('\n')).toContain('1 mapas sin enlaces entrantes desde otras landings (sin-fichero)');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('internal link coverage requires a traffic host for zero-view maps', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-zero-view-links-'));
  const galleryDir = path.join(tmp, 'gallery');
  const writeLanding = (slug, links) => {
    fs.mkdirSync(path.join(galleryDir, slug), { recursive: true });
    const anchors = links.map(l => `<li><a href="/gallery/${l}/">${l}</a></li>`).join('');
    fs.writeFileSync(path.join(galleryDir, slug, 'index.html'), `<section class="related"><ul>${anchors}</ul></section>`);
  };

  writeLanding('popular', ['cero-visible', 'minoritario']);
  writeLanding('minoritario', ['cero-invisible', 'popular']);
  writeLanding('cero-visible', []);
  writeLanding('cero-invisible', []);

  const slugList = ['popular', 'minoritario', 'cero-visible', 'cero-invisible'];
  const viewsBySlug = { popular: 40, minoritario: 2, 'cero-visible': 0, 'cero-invisible': 0 };
  const result = auditInternalLinkCoverage(slugList, { galleryDir, viewsBySlug, minHostViews: 10 });

  // Ambos mapas con cero visitas tienen un enlace entrante, pero solo uno
  // procede de una landing con tráfico suficiente.
  expect(result.orphans).toEqual([]);
  expect(result.zeroView).toEqual(['cero-invisible', 'cero-visible']);
  expect(result.undiscovered).toEqual(['cero-invisible']);
  expect(result.issues.join('\n')).toContain(
    '1 mapas con cero visitas sin enlace desde landings con ≥10 visitas ni desde la portada ni desde fuentes de descubrimiento (cero-invisible)'
  );

  // Sin datos de visitas el check mantiene el comportamiento anterior.
  const legacy = auditInternalLinkCoverage(slugList, { galleryDir });
  expect(legacy.issues).toEqual([]);
  expect(legacy.undiscovered).toEqual([]);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('internal link coverage accepts trusted discovery sources for zero-view maps', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-discovery-sources-'));
  const galleryDir = path.join(tmp, 'gallery');
  const writeLanding = (slug, links) => {
    fs.mkdirSync(path.join(galleryDir, slug), { recursive: true });
    const anchors = links.map(l => `<li><a href="/gallery/${l}/">${l}</a></li>`).join('');
    fs.writeFileSync(path.join(galleryDir, slug, 'index.html'), `<section class="related"><ul>${anchors}</ul></section>`);
  };

  writeLanding('popular', ['visible']);
  writeLanding('visible', ['popular']);
  writeLanding('oculto', []);

  const slugList = ['popular', 'visible', 'oculto'];
  const viewsBySlug = { popular: 40, visible: 1, oculto: 0 };
  const discoverySources = [{
    label: 'news-index',
    html: '<a href="/gallery/oculto/">oculto</a><a href="/gallery/no-publicado/">x</a>',
  }];

  const result = auditInternalLinkCoverage(slugList, { galleryDir, viewsBySlug, discoverySources });
  expect(result.orphans).toEqual([]);
  expect(result.undiscovered).toEqual([]);
  expect(result.details.oculto).toContain('news-index');
  expect(result.discoveredFrom.oculto).toEqual(['news-index']);
  expect(result.details['no-publicado']).toBeUndefined();

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('News index distributes the six zero-view maps with static landing links', () => {
  // El índice de News (ES y EN) es el bloque de descubrimiento que rompe el
  // círculo de los mapas con cero visitas sin depender del tráfico de otras
  // landings.
  const published = parseCollectionLd(galleryHtml).slugs;
  const zeroView = [
    'alcohol-consumption-world',
    'co2-total-emissions-world',
    'gdp-per-capita-world',
    'literacy-rate-world',
    'tallest-skyscrapers-world',
    'tallest-statues-world',
  ];
  const indexes = [
    ['news-index', path.join(siteRoot, 'news', 'index.html')],
    ['en/news-index', path.join(siteRoot, 'en', 'news', 'index.html')],
  ];

  for (const [label, file] of indexes) {
    const html = fs.readFileSync(file, 'utf8');
    const links = extractLandingLinks(html);
    for (const slug of zeroView) {
      expect(published, `${slug} no está publicado`).toContain(slug);
      expect(links.has(slug), `${label} sin enlace a /gallery/${slug}/`).toBe(true);
    }
  }
});

test('home page is accepted as a discovery source for zero-view maps', () => {
  // El check 15 debe contar la portada, igual que los índices de News, para
  // que un mapa sin visitas no dependa del tráfico de otras landings.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-home-discovery-'));
  const galleryDir = path.join(tmp, 'gallery');
  const writeLanding = (slug, anchors = []) => {
    fs.mkdirSync(path.join(galleryDir, slug), { recursive: true });
    fs.writeFileSync(
      path.join(galleryDir, slug, 'index.html'),
      `<section class="related"><ul>${anchors.map(a => `<a href="/gallery/${a}/">${a}</a>`).join('')}</ul></section>`
    );
  };
  writeLanding('popular', ['oculto']);
  writeLanding('oculto', ['popular']);

  const result = auditInternalLinkCoverage(['popular', 'oculto'], {
    galleryDir,
    viewsBySlug: { popular: 40, oculto: 0 },
    discoverySources: [{ label: 'home', html: '<a href="/gallery/oculto/">oculto</a>' }],
  });
  expect(result.issues).toEqual([]);
  expect(result.undiscovered).toEqual([]);
  expect(result.discoveredFrom.oculto).toEqual(['home']);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('home page distributes the six zero-view maps with static landing links', () => {
  // La portada es la página con más autoridad interna: su bloque «Mapas para
  // descubrir» debe enlazar las landings de los mapas que siguen sin visitas y
  // contar como fuente de descubrimiento en el check 15.
  const published = parseCollectionLd(galleryHtml).slugs;
  const zeroView = [
    'alcohol-consumption-world',
    'co2-total-emissions-world',
    'gdp-per-capita-world',
    'literacy-rate-world',
    'tallest-skyscrapers-world',
    'tallest-statues-world',
  ];
  const html = fs.readFileSync(path.join(siteRoot, 'index.html'), 'utf8');
  const links = extractLandingLinks(html);

  for (const slug of zeroView) {
    expect(published, `${slug} no está publicado`).toContain(slug);
    expect(links.has(slug), `la portada no enlaza /gallery/${slug}/`).toBe(true);
  }

  const viewsBySlug = Object.fromEntries(published.map((slug) => [slug, 1]));
  for (const slug of zeroView) viewsBySlug[slug] = 0;
  const result = auditInternalLinkCoverage(published, {
    viewsBySlug,
    discoverySources: [{ label: 'home', html }],
  });

  expect(result.issues).toEqual([]);
  expect(result.zeroView).toEqual([...zeroView].sort());
  for (const slug of zeroView) {
    expect(result.discoveredFrom[slug], `${slug} no se descubre desde home`).toContain('home');
  }
});

test('every News article links to the static landing of its embedded map', () => {
  // Regresión del check 16: el visor /map/?gallery= no es la landing
  // indexable; cada artículo de News (ES y EN) debe enlazar a /gallery/<slug>/.
  const published = parseCollectionLd(galleryHtml).slugs;
  const result = auditNewsLandingLinks(published);

  expect(result.issues).toEqual([]);
  expect(result.articles.length).toBeGreaterThan(0);
  expect(result.articles.some((article) => article.article.startsWith('en/'))).toBe(true);
  for (const article of result.articles) {
    expect(article.linked, `${article.article} → ${article.slug}`).toBe(true);
  }
});

test('News footer links point to static landings, not the viewer', () => {
  // Los footer-links son enlaces rastreables dentro del artículo: deben
  // repartir autoridad a la landing indexable, no al visor /map/.
  const published = parseCollectionLd(galleryHtml).slugs;
  const result = auditNewsLandingLinks(published);

  const withFooter = Object.entries(result.details)
    .filter(([, detail]) => detail && detail.footerLinks && detail.footerLinks.length);
  expect(withFooter.length).toBeGreaterThan(0);
  for (const [article, detail] of withFooter) {
    for (const href of detail.footerLinks) {
      expect(href, `${article}: ${href}`).toMatch(/^\/gallery\/[a-z0-9-]+\/$/);
    }
  }
  for (const href of result.footerLinks) {
    expect(href, `footer-links global: ${href}`).toMatch(/^\/gallery\/[a-z0-9-]+\/$/);
  }
});

test('News footers distribute the six zero-view maps from the October report', () => {
  // La directiva de noviembre prioriza distribución: los mapas sin visitas del
  // informe de octubre deben recibir al menos un enlace desde un footer de News.
  const published = parseCollectionLd(galleryHtml).slugs;
  const result = auditNewsLandingLinks(published);
  const footerSlugs = new Set(
    result.footerLinks
      .map((href) => (href.match(/^\/gallery\/([a-z0-9-]+)\/$/) || [])[1])
      .filter(Boolean)
  );

  const zeroView = [
    'alcohol-consumption-world',
    'co2-total-emissions-world',
    'gdp-per-capita-world',
    'literacy-rate-world',
    'tallest-skyscrapers-world',
    'tallest-statues-world',
  ];
  for (const slug of zeroView) {
    expect(footerSlugs.has(slug), `${slug} sin enlace desde footer-links de News`).toBe(true);
  }
});

test('News landing link check reports missing links and unpublished maps', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-news-landings-'));
  const writeArticle = (name, html) => {
    fs.mkdirSync(path.join(tmp, name), { recursive: true });
    fs.writeFileSync(path.join(tmp, name, 'index.html'), html);
  };

  writeArticle('ok', '<iframe src="/map/?gallery=publicado&amp;embed=1"></iframe><a href="/gallery/publicado/">ficha</a>');
  writeArticle('sin-enlace', '<iframe src="/map/?gallery=publicado&amp;embed=1"></iframe>');
  writeArticle('no-publicado', '<iframe src="/map/?gallery=otro&embed=1"></iframe><a href="/gallery/otro/">ficha</a>');
  writeArticle('sin-mapa', '<p>Estado mensual sin mapa embebido</p>');
  writeArticle('footer-viewer', '<iframe src="/map/?gallery=publicado&amp;embed=1"></iframe><a href="/gallery/publicado/">ficha</a><ul class="footer-links"><li><a href="/map/?gallery=publicado">visor</a></li></ul>');
  writeArticle('footer-no-publicado', '<iframe src="/map/?gallery=publicado&amp;embed=1"></iframe><a href="/gallery/publicado/">ficha</a><ul class="footer-links"><li><a href="/gallery/otro/">otro</a></li></ul>');
  writeArticle('visor-sin-landing', '<iframe src="/map/?gallery=publicado&amp;embed=1"></iframe><a href="/gallery/publicado/">ficha</a><a href="/map/?gallery=secundario">otro visor</a>');

  expect(extractPrimaryMapSlug('<iframe src="/map/?gallery=publicado&amp;embed=1"></iframe>')).toBe('publicado');
  expect(extractPrimaryMapSlug('<p>Sin iframe</p>')).toBeNull();
  expect(extractViewerMapSlugs('<iframe src="/map/?gallery=publicado&amp;embed=1"></iframe><a href="https://maña.com/map/?gallery=secundario">x</a>'))
    .toEqual(['publicado', 'secundario']);
  expect(extractFooterLinks('<ul class="footer-links"><li><a href="/gallery/publicado/">x</a></li></ul>'))
    .toEqual(['/gallery/publicado/']);

  const result = auditNewsLandingLinks(['publicado', 'secundario'], { newsDir: tmp });
  expect(result.issues).toContain('sin-enlace: no enlaza a la landing del mapa /gallery/publicado/');
  expect(result.issues).toContain('no-publicado: el mapa embebido «otro» no está publicado en Firestore');
  expect(result.issues).toContain('footer-viewer: footer-links apunta al visor (/map/?gallery=publicado); usa /gallery/publicado/');
  expect(result.issues).toContain('footer-no-publicado: footer-links enlaza a la landing no publicada /gallery/otro/');
  expect(result.issues).toContain('visor-sin-landing: enlaza al visor de «secundario» sin enlazar su landing /gallery/secundario/');
  expect(result.details['sin-mapa']).toBeNull();
  expect(result.articles.map((a) => a.article)).toEqual(['footer-no-publicado', 'footer-viewer', 'no-publicado', 'ok', 'sin-enlace', 'visor-sin-landing']);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('News landing link check audits English articles and rejects non-landing footers', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-news-en-'));
  const enNews = path.join(tmp, 'en', 'news');
  const article = path.join(enNews, 'english-article');
  fs.mkdirSync(article, { recursive: true });
  fs.writeFileSync(
    path.join(article, 'index.html'),
    '<iframe src="/map/?gallery=publicado&amp;embed=1"></iframe>' +
    '<a href="/gallery/publicado/">ficha</a>' +
    '<ul class="footer-links">' +
    '<li><a href="/gallery/otro/">otro</a></li>' +
    '<li><a href="/news/otra/">news</a></li>' +
    '</ul>'
  );

  const result = auditNewsLandingLinks(['publicado'], { newsDir: enNews });
  expect(result.details['en/english-article'].slug).toBe('publicado');
  expect(result.issues).toContain(
    'en/english-article: footer-links enlaza a la landing no publicada /gallery/otro/'
  );
  expect(result.issues).toContain(
    'en/english-article: footer-links no apunta a una landing /gallery/<slug>/ (/news/otra/)'
  );

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('buildRelatedIndex prioritizes shared tags and guarantees full coverage', () => {
  const maps = [
    { slug: 'economia-a', title: 'Economía A', tags: ['Economía'], createdAtMs: 1 },
    { slug: 'economia-b', title: 'Economía B', tags: ['Economía'], createdAtMs: 2 },
    { slug: 'salud-a', title: 'Salud A', tags: ['Salud'], createdAtMs: 3 },
    { slug: 'salud-b', title: 'Salud B', tags: ['Salud'], createdAtMs: 4 },
    { slug: 'raro', title: 'Raro', tags: ['Tema único'], createdAtMs: 5 },
  ];
  const index = buildRelatedIndex(maps, { limit: 1, maxLinks: 2 });
  expect(index.get('economia-a')[0].slug).toBe('economia-b');
  expect(index.get('salud-a')[0].slug).toBe('salud-b');

  const inbound = new Map(maps.map(m => [m.slug, 0]));
  for (const [source, related] of index) {
    for (const map of related) {
      expect(map.slug).not.toBe(source);
      inbound.set(map.slug, inbound.get(map.slug) + 1);
    }
  }
  for (const map of maps) {
    expect(inbound.get(map.slug), `${map.slug} sin enlaces entrantes`).toBeGreaterThan(0);
  }
});

test('buildDiscoveryIndex links zero-view maps from the most visited landings', () => {
  const maps = [
    { slug: 'popular-eco', title: 'Economía', tags: ['Economía'], views: 50, createdAtMs: 1 },
    { slug: 'popular-salud', title: 'Salud', tags: ['Salud'], views: 20, createdAtMs: 2 },
    { slug: 'popular-cultura', title: 'Cultura', tags: ['Cultura'], views: 12, createdAtMs: 3 },
    { slug: 'poco-visto', title: 'Poco visto', tags: ['Economía'], views: 5, createdAtMs: 4 },
    { slug: 'cero-eco', title: 'Cero economía', tags: ['Economía'], views: 0, createdAtMs: 5 },
    { slug: 'cero-salud', title: 'Cero salud', tags: ['Salud'], views: 0, createdAtMs: 6 },
  ];
  const index = buildDiscoveryIndex(maps, { minViews: 10, perHost: 1 });

  // Cada mapa con cero visitas se enlaza desde el mapa más afín y con tráfico.
  expect(index.get('popular-eco').map((m) => m.slug)).toEqual(['cero-eco']);
  expect(index.get('popular-salud').map((m) => m.slug)).toEqual(['cero-salud']);
  expect(index.has('popular-cultura')).toBe(false);

  // Ningún host supera el límite y ningún mapa se enlaza a sí mismo.
  for (const [host, targets] of index) {
    expect(targets.length).toBeLessThanOrEqual(1);
    for (const target of targets) expect(target.slug).not.toBe(host);
  }

  // Sin hosts con tráfico no se inventan enlaces.
  expect(buildDiscoveryIndex(maps, { minViews: 100 }).size).toBe(0);
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

// Regresión del check 13: higiene de metadatos. Cada mapa publicado debe tener
// una description de 60–200 caracteres, única, y un dataDate ISO 8601.
const VALID_DESCRIPTION = 'Mapa de prueba con una descripción suficientemente larga para superar el mínimo exigido.';
const OTHER_DESCRIPTION = 'Otro mapa de prueba con un texto distinto y también válido para la auditoría de higiene.';

test('metadata hygiene accepts valid descriptions and ISO dates', () => {
  const result = auditMetadataHygiene([
    { id: 'mapa-a', title: 'Mapa A', description: VALID_DESCRIPTION, dataDate: '2024' },
    { id: 'mapa-b', title: 'Mapa B', description: OTHER_DESCRIPTION, dataDate: '2024-02-29' },
  ]);
  expect(result.issues).toEqual([]);
  expect(result.fixes).toEqual({});
  expect(result.manual).toEqual([]);
  expect(isValidIsoDataDate('2024-02-29')).toBe(true);
  expect(isValidIsoDataDate('2023-02-29')).toBe(false);
  expect(isValidIsoDataDate('2024-02')).toBe(false);
});

test('metadata hygiene fixes long, short, missing and duplicated descriptions', () => {
  const long = 'Frase inicial del mapa de prueba. ' + 'Dato '.repeat(80).trim();
  const result = auditMetadataHygiene([
    { id: 'larga', title: 'Mapa largo', description: long, dataDate: '2024' },
    { id: 'corta', title: 'Mapa corto', description: 'Muy corta.', dataDate: '2024' },
    { id: 'sin-desc', title: 'Mapa sin descripción', description: '', dataDate: '2024' },
    { id: 'dup-a', title: 'Mapa duplicado A', description: VALID_DESCRIPTION, dataDate: '2024' },
    { id: 'dup-b', title: 'Mapa duplicado B', description: VALID_DESCRIPTION, dataDate: '2024' },
  ]);

  const issues = result.issues.join('\n');
  expect(issues).toContain('larga: description demasiado larga');
  expect(issues).toContain('corta: description demasiado corta');
  expect(issues).toContain('sin-desc: description ausente');
  expect(issues).toContain('dup-b: description duplicada');

  for (const slug of ['larga', 'corta', 'sin-desc', 'dup-a', 'dup-b']) {
    const desc = result.details[slug].description;
    expect(isValidDescription(desc), `${slug}: ${desc}`).toBe(true);
  }
  for (const slug of ['larga', 'corta', 'sin-desc', 'dup-b']) {
    expect(result.fixes[slug].description).toBe(result.details[slug].description);
  }
  expect(result.fixes['dup-a']).toBeUndefined();
  const all = Object.values(result.details).map(d => d.description.toLowerCase());
  expect(new Set(all).size).toBe(all.length);
  expect(result.manual).toEqual([]);
});

test('metadata hygiene normalizes non-ISO dataDate and reports unknown values', () => {
  expect(normalizeDataDate('2026-09')).toBe('2026-09-01');
  expect(normalizeDataDate('1991-2020')).toBe('2020-12-31');
  expect(normalizeDataDate('2024-2025')).toBe('2025-12-31');
  expect(normalizeDataDate('2025-01-01T10:00:00Z')).toBe('2025-01-01');
  expect(normalizeDataDate('ayer')).toBe(null);

  const result = auditMetadataHygiene([
    { id: 'mes', title: 'Mapa mes', description: VALID_DESCRIPTION, dataDate: '2026-09' },
    { id: 'rango', title: 'Mapa rango', description: OTHER_DESCRIPTION, dataDate: '1991-2020' },
    { id: 'texto', title: 'Mapa texto', description: VALID_DESCRIPTION + ' Extra.', dataDate: 'ayer' },
  ]);

  expect(result.fixes.mes.dataDate).toBe('2026-09-01');
  expect(result.fixes.rango.dataDate).toBe('2020-12-31');
  expect(result.fixes.texto).toBeUndefined();
  expect(result.manual.map(m => m.slug)).toContain('texto');
  expect(result.issues.join('\n')).toContain('texto: dataDate no ISO 8601 sin normalización segura (ayer)');
});

test('description shortening respects the maximum and keeps whole sentences when possible', () => {
  const text = 'Primera frase corta. ' + 'Segunda frase con más contenido. '.repeat(30);
  const short = shortenDescription(text);
  expect(short.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LEN);
  expect(short.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN_LEN);
  expect(short.endsWith('.')).toBe(true);
});

// Regresión del check 9: la detección de «área representada con punto» no debe
// marcar topónimos que solo coinciden con una palabra de área (Lagos, la ciudad
// nigeriana) ni nombres propios de instalaciones (Prairie Island, central
// nuclear de Minnesota), pero sí las áreas reales.
test('area-with-point detection ignores proper nouns that look like areas', () => {
  expect(isAreaEntityName('Prairie Island')).toBe(false);
  expect(isAreaEntityName('Prairie Island (Minnesota)')).toBe(false);
  expect(isAreaEntityName('Lagos')).toBe(false);
  expect(isAreaEntityName('Lagos (Nigeria)')).toBe(false);
  expect(isAreaEntityName('Seabrook')).toBe(false);
  expect(isAreaEntityName('Islas Canarias')).toBe(true);
  expect(isAreaEntityName('Desierto del Sahara')).toBe(true);
  expect(isAreaEntityName('Océano Pacífico')).toBe(true);
});

// Regresión del check 14: coherencia de leyenda. La leyenda del mapa destacado
// necesita un legendKey con ≥3 valores distintos, un legendTitle y un formato
// que no sea categórico cuando el mapa ya tiene una clave numérica con rango
// (casos biggest-earthquakes-world y submarine-fiber-cables).
function legendMap(id, { legendKey, legendTitle, legendFormat, props }) {
  return {
    id,
    legendKey,
    legendTitle,
    legendFormat,
    geojsonText: JSON.stringify({
      type: 'FeatureCollection',
      features: props.map((p, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i, i] },
        properties: p,
      })),
    }),
  };
}

test('legend coherence accepts numeric ramps with title and range', () => {
  const result = auditLegendCoherence([
    legendMap('magnitud-ok', {
      legendKey: 'Magnitud',
      legendTitle: 'Magnitud (escala de Richter)',
      legendFormat: 'number',
      props: [{ Magnitud: '7,0' }, { Magnitud: '7,5' }, { Magnitud: '8,2' }, { Magnitud: '9,5' }],
    }),
    legendMap('categorica-ok', {
      legendKey: 'Tipo',
      legendTitle: 'Tipo de instalación',
      legendFormat: 'category',
      props: [{ Tipo: 'Nuclear' }, { Tipo: 'Hidroeléctrica' }, { Tipo: 'Solar' }],
    }),
  ]);
  expect(result.issues).toEqual([]);
  expect(result.affected).toEqual([]);
  expect(result.details['magnitud-ok'].distinct).toBe(4);
});

test('legend coherence flags categorical legend key when a numeric key has a range', () => {
  // Caso biggest-earthquakes-world / submarine-fiber-cables: la leyenda
  // categórica oculta la rampa de una clave numérica con muchos valores.
  const result = auditLegendCoherence([
    legendMap('categorica-con-rampa', {
      legendKey: 'Tipo',
      legendTitle: 'Tipo de evento',
      legendFormat: 'category',
      props: [
        { Tipo: 'Histórico M≥8', Magnitud: '7,0' },
        { Tipo: 'Histórico M≥8', Magnitud: '8,2' },
        { Tipo: 'Histórico M≥8', Magnitud: '9,5' },
      ],
    }),
  ]);
  expect(result.affected).toEqual(['categorica-con-rampa']);
  const issues = result.issues.join('\n');
  expect(issues).toContain('categorica-con-rampa: legendKey categórico «Tipo»');
  expect(issues).toContain('clave numérica disponible «Magnitud» (3 valores distintos)');
  expect(result.details['categorica-con-rampa'].candidates[0].key).toBe('Magnitud');
});

test('legend coherence flags legend keys with fewer than three values and missing title', () => {
  const result = auditLegendCoherence([
    legendMap('pocos-valores', {
      legendKey: 'Estado',
      legendFormat: 'category',
      props: [{ Estado: 'En servicio' }, { Estado: 'En servicio' }, { Estado: 'En proyecto' }],
    }),
    legendMap('sin-title', {
      legendKey: 'Altitud',
      legendTitle: '   ',
      legendFormat: 'number',
      props: [{ Altitud: '100 m' }, { Altitud: '200 m' }, { Altitud: '300 m' }],
    }),
  ]);
  expect(result.affected).toEqual(['pocos-valores', 'sin-title']);
  const issues = result.issues.join('\n');
  expect(issues).toContain('pocos-valores: legendKey «Estado» solo tiene 2 valor(es) distinto(s)');
  expect(issues).toContain('pocos-valores: legendTitle ausente');
  expect(issues).toContain('sin-title: legendTitle ausente');
  // El mapa sin legendKey no entra en este check (otra tarea lo cubre).
  const noKey = auditLegendCoherence([legendMap('sin-key', { props: [{ Dato: '1' }] })]);
  expect(noKey.issues).toEqual([]);
  expect(noKey.details).toEqual({});
});

test('numeric legend candidates ignore text, dates and style keys', () => {
  expect(isLegendNumericLike('8.849 m')).toBe(true);
  expect(isLegendNumericLike('-6,6 %')).toBe(true);
  expect(isLegendNumericLike('45.000')).toBe(true);
  expect(isLegendNumericLike('Histórico M≥8')).toBe(false);
  expect(isLegendNumericLike('2024-01-01')).toBe(false);
  expect(isLegendNumericLike('El volcán de 5.000 m')).toBe(false);

  const geo = JSON.parse(legendMap('candidatos', {
    legendKey: 'Tipo',
    legendTitle: 'Tipo',
    legendFormat: 'category',
    props: [
      { Tipo: 'A', Altitud: '1.000 m', Fecha: '2020', Descripcion: 'Volcán de 1.000 m', _manaColor: '#ff0000' },
      { Tipo: 'A', Altitud: '2.000 m', Fecha: '2021', Descripcion: 'Volcán de 2.000 m', _manaColor: '#00ff00' },
      { Tipo: 'A', Altitud: '3.000 m', Fecha: '2022', Descripcion: 'Volcán de 3.000 m', _manaColor: '#0000ff' },
    ],
  }).geojsonText);
  const candidates = legendNumericCandidates(geo, 'Tipo');
  expect(candidates.map(c => c.key)).toEqual(['Altitud']);
});

