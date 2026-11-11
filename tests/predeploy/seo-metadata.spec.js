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
  auditNewsLandingLinks,
  extractPrimaryMapSlug,
  extractViewerMapSlugs,
  extractFooterLinks,
  hasUseCaseBlock,
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
const {
  buildFactsSection,
  lowercaseIndicatorStart,
} = require('../../scripts/lib/map-landing-facts');
const {
  buildNewsMapIndex,
  newsLinksBlock,
  extractArticleTitle,
  extractEmbeddedMapSlug,
  extractPublishedTime,
  readNewsArticles,
} = require('../../scripts/lib/news-map-links');
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
  expect(collection.queryUrls).toBe(0);
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

// Regresión: el catálogo estructurado debe apuntar a la landing canónica
// /gallery/<slug>/ (donde vive el canonical, la OG y la medición de visitas),
// no a la URL del visor /gallery/?slug=.
test('CollectionPage must link map landings instead of viewer query URLs', () => {
  const published = parseCollectionLd(galleryHtml).slugs;
  const firstSlug = published[0];
  const withViewerUrl = galleryHtml.replace(
    `"url": "https://maña.com/gallery/${firstSlug}/"`,
    `"url": "https://maña.com/gallery/?slug=${firstSlug}"`
  );
  expect(withViewerUrl).not.toBe(galleryHtml);

  const result = auditSeoMetadata(published, { galleryHtml: withViewerUrl, sitemapXml });
  expect(result.issues.join('\n')).toContain('usan la URL del visor (?slug=) en vez de la landing canónica');
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

test('zero-view maps receive links from at least two traffic landings', () => {
  // Prioridad de distribución de noviembre: un mapa sin visitas no debe
  // depender de un único enlace que puede quedar enterrado en una landing.
  const published = parseCollectionLd(galleryHtml).slugs;
  // Corte de visitas 09-11: literacy-rate-world ya registra 1 visita y deja de
  // ser objetivo de descubrimiento; los dos mapas que siguen a cero se
  // mantienen enlazados desde dos landings con tráfico.
  const zeroView = [
    'alcohol-consumption-world',
    'tallest-skyscrapers-world',
  ];
  const viewsBySlug = Object.fromEntries(published.map((slug) => [slug, 1]));
  // Landings con tráfico según el último corte de Firestore: el generador
  // solo puede usar estas como hosts de descubrimiento (≥10 visitas).
  for (const slug of [
    'tourism-arrivals-world',
    'gini-index-world',
    'bibliotecas-barcelona',
    'worst-wildfires-world',
    'submarine-fiber-cables',
    'linea-ave-madrid-sevilla-urda',
    'biggest-earthquakes-world',
    'minimum-wage-by-country',
    'active-volcanoes-world',
    'indice-desarrollo-humano-por-pais',
    'inflation-world',
    'tallest-waterfalls-world',
  ]) {
    if (slug in viewsBySlug) viewsBySlug[slug] = 50;
  }
  for (const slug of zeroView) viewsBySlug[slug] = 0;

  const result = auditInternalLinkCoverage(published, {
    viewsBySlug,
    minHostViews: 10,
    minTrafficHosts: 2,
  });
  expect(result.issues).toEqual([]);
  expect(result.undiscovered).toEqual([]);
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

  // Con dos hosts exigidos, `cero-visible` (un solo enlace con tráfico) deja
  // de contar como descubierto: dos hosts evitan depender de un enlace único.
  const twoHosts = auditInternalLinkCoverage(slugList, {
    galleryDir,
    viewsBySlug,
    minHostViews: 10,
    minTrafficHosts: 2,
  });
  expect(twoHosts.undiscovered).toEqual(['cero-invisible', 'cero-visible']);
  expect(twoHosts.issues.join('\n')).toContain(
    '2 mapas con cero visitas sin enlaces desde al menos 2 landings con ≥10 visitas ni desde la portada ni desde fuentes de descubrimiento'
  );
  expect(twoHosts.minTrafficHosts).toBe(2);

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

test('home, gallery and News indexes do not render the Maps to discover block', () => {
  // El bloque «Mapas para descubrir» se retiró por decisión editorial. Se
  // mantiene una regresión para que no vuelva a colarse en las páginas de
  // entrada del sitio.
  const pages = [
    ['home', path.join(siteRoot, 'index.html')],
    ['gallery', path.join(siteRoot, 'gallery', 'index.html')],
    ['news', path.join(siteRoot, 'news', 'index.html')],
    ['en/news', path.join(siteRoot, 'en', 'news', 'index.html')],
  ];

  for (const [label, file] of pages) {
    const html = fs.readFileSync(file, 'utf8');
    expect(html, `${label} vuelve a incluir la sección de descubrimiento`)
      .not.toMatch(/Mapas para descubrir|Maps to discover|id=["']mapas-para-descubrir["']/i);
  }
});

test('News article footers keep only the CTA without related links or extra sections', () => {
  // El pie «Convierte tus datos en un mapa» debe contener solo el CTA. Varias
  // ejecuciones del blogger añadieron listas de mapas relacionados dentro o
  // junto al bloque; se bloquea para que no vuelva a ocurrir.
  const roots = [path.join(siteRoot, 'news'), path.join(siteRoot, 'en', 'news')];
  const articles = [];
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root, entry.name, 'index.html');
      if (fs.existsSync(file)) articles.push(file);
    }
  }

  expect(articles.length).toBeGreaterThan(0);
  for (const file of articles) {
    const html = fs.readFileSync(file, 'utf8');
    const rel = path.relative(siteRoot, file);
    expect(html, `${rel} incluye la lista footer-links`).not.toMatch(/footer-links/);

    const footer = html.match(/<section class="post-footer"[\s\S]*?<\/section>/i);
    expect(footer, `${rel} no tiene pie de artículo`).not.toBeNull();
    const footerInner = footer[0]
      .replace(/^<section\b[^>]*>/i, '')
      .replace(/<\/section>\s*$/i, '');
    expect(footerInner, `${rel} añade una lista o sección extra al pie`).not.toMatch(/<(ul|ol|nav|section|aside)\b/i);
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

test('News articles do not render the removed use-case block', () => {
  // El bloque «Caso de uso» se retiró de las piezas de News por decisión de
  // producto (ver AGENTS.md). Si alguien lo reintroduce, este test lo bloquea.
  const roots = [
    path.join(__dirname, '..', '..', 'site', 'news'),
    path.join(__dirname, '..', '..', 'site', 'en', 'news'),
  ];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name === 'index.html' ? [full] : [];
  });
  const articles = roots.flatMap(walk);
  expect(articles.length).toBeGreaterThan(0);
  const offenders = articles.filter((file) => {
    const html = fs.readFileSync(file, 'utf8');
    return /data-use-case|use-case-kicker|class="use-case"/.test(html);
  });
  expect(offenders, `Bloque «Caso de uso» reintroducido en: ${offenders.join(', ')}`).toEqual([]);
});

test('the News landing audit flags a reintroduced use-case block', () => {
  // Regresión sintética: cualquier artículo que vuelva a incluir el aside
  // retirado debe denunciarse aunque el resto de enlaces sea correcto.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-usecase-'));
  const newsDir = path.join(tmp, 'news');
  const articleDir = path.join(newsDir, 'con-bloque');
  fs.mkdirSync(articleDir, { recursive: true });
  fs.writeFileSync(
    path.join(articleDir, 'index.html'),
    '<h1>Titular</h1>' +
    '<iframe src="/map/?embed=1&gallery=publicado"></iframe>' +
    '<a href="/gallery/publicado/">Ficha</a>' +
    '<aside class="use-case" data-use-case><p>Texto de ejemplo suficientemente largo para el bloque retirado.</p><a href="/map/">Crea</a></aside>',
    'utf8'
  );

  expect(hasUseCaseBlock('<aside data-use-case>x</aside>')).toBe(true);
  expect(hasUseCaseBlock('<p>sin bloque</p>')).toBe(false);
  const result = auditNewsLandingLinks(['publicado'], { newsDir });
  expect(result.issues).toContain('con-bloque: incluye el bloque «Caso de uso» retirado por decisión de producto');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('every map landing links back to the News articles that embed it', () => {
  // El circuito internal linking es bidireccional: News → landing (check 16) y
  // landing → «En las noticias». Cada artículo embebido debe aparecer en la
  // landing de su mapa con la ruta pública que le corresponde (ES o EN).
  const published = parseCollectionLd(galleryHtml).slugs;
  const result = auditNewsLandingLinks(published);

  expect(result.issues).toEqual([]);
  expect(result.reverseLinks).toBe(result.articles.length);
  const bySlug = new Map();
  for (const article of result.articles) {
    const list = bySlug.get(article.slug) || [];
    list.push(article);
    bySlug.set(article.slug, list);
  }
  expect(bySlug.size).toBeGreaterThan(10);
  for (const [slug, articles] of bySlug) {
    const landing = fs.readFileSync(path.join(siteRoot, 'gallery', slug, 'index.html'), 'utf8');
    expect(landing, `${slug} sin bloque de noticias`).toContain('<h2>En las noticias</h2>');
    for (const article of articles) {
      const href = (article.lang === 'en' ? '/en/news/' : '/news/') + article.name + '/';
      expect(landing, `${slug} → ${href}`).toContain(`href="${href}"`);
    }
  }
});

test('news map index parses titles, dates, languages and renders the landing block', () => {
  const html = [
    '<meta property="article:published_time" content="2026-11-08T08:00:00+01:00">',
    '<h1>Los <em>precios</em> &amp; el empleo</h1>',
    '<iframe src="/map/?embed=1&amp;gallery=gini-index-world&amp;v=1"></iframe>',
  ].join('');
  const oldHtml = [
    '<meta property="article:published_time" content="2026-10-01T08:00:00+01:00">',
    '<h1>Titular antiguo</h1>',
    '<iframe src="/map/?embed=1&amp;gallery=gini-index-world"></iframe>',
  ].join('');

  expect(extractEmbeddedMapSlug(html)).toBe('gini-index-world');
  expect(extractEmbeddedMapSlug('<p>sin iframe</p>')).toBeNull();
  expect(extractArticleTitle(html)).toBe('Los precios & el empleo');
  expect(extractPublishedTime(html)).toBe('2026-11-08T07:00:00.000Z');

  const index = buildNewsMapIndex([
    { article: 'viejo', name: 'viejo', lang: 'es', href: '/news/viejo/', title: 'Viejo', date: '2026-10-01T07:00:00.000Z', slug: 'gini-index-world' },
    { article: 'nuevo', name: 'nuevo', lang: 'es', href: '/news/nuevo/', title: 'Nuevo & <raro>', date: '2026-11-08T07:00:00.000Z', slug: 'gini-index-world' },
    { article: 'sin-mapa', name: 'sin-mapa', lang: 'es', href: '/news/sin-mapa/', title: 'Sin mapa', date: '', slug: null },
  ]);
  expect([...index.keys()]).toEqual(['gini-index-world']);
  expect(index.get('gini-index-world').map((a) => a.name)).toEqual(['nuevo', 'viejo']);

  const block = newsLinksBlock(index.get('gini-index-world'), { title: 'En las noticias' });
  expect(block).toContain('<h2>En las noticias</h2>');
  expect(block).toContain('href="/news/nuevo/"');
  expect(block).toContain('Nuevo &amp; &lt;raro&gt;');
  expect(block).not.toContain('hreflang=');
  expect(newsLinksBlock([], { title: 'En las noticias' })).toBe('');

  const en = newsLinksBlock([{ article: 'en-test', name: 'en-test', lang: 'en', href: '/en/news/en-test/', title: 'English', date: '' }]);
  expect(en).toContain('href="/en/news/en-test/" lang="en"');
  expect(en).toContain('class="news-lang"');

  // Los artículos reales del repo alimentan el índice sin duplicar slugs.
  const real = readNewsArticles(siteRoot);
  expect(real.length).toBeGreaterThan(0);
  expect(real.some((a) => a.lang === 'en')).toBe(true);
  expect(real.every((a) => a.href.startsWith('/news/') || a.href.startsWith('/en/news/'))).toBe(true);
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

test('News landing link check reports landings without the reverse News link', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mana-news-reverse-'));
  const newsDir = path.join(tmp, 'news');
  const landingDir = path.join(tmp, 'gallery');
  fs.mkdirSync(path.join(newsDir, 'noticia-es'), { recursive: true });
  fs.writeFileSync(
    path.join(newsDir, 'noticia-es', 'index.html'),
    '<h1>Noticia</h1><iframe src="/map/?gallery=publicado&amp;embed=1"></iframe><a href="/gallery/publicado/">ficha</a>'
  );
  fs.mkdirSync(path.join(landingDir, 'publicado'), { recursive: true });
  fs.writeFileSync(path.join(landingDir, 'publicado', 'index.html'), '<section class="related"><h2>Más mapas</h2></section>');

  const missing = auditNewsLandingLinks(['publicado'], { newsDir, landingDir });
  expect(missing.issues).toContain(
    'noticia-es: la landing /gallery/publicado/ no enlaza de vuelta el artículo /news/noticia-es/'
  );
  expect(missing.reverseLinks).toBe(1);

  fs.writeFileSync(
    path.join(landingDir, 'publicado', 'index.html'),
    '<section class="related related--news"><h2>En las noticias</h2><ul><li><a href="/news/noticia-es/">Noticia</a></li></ul></section>'
  );
  const ok = auditNewsLandingLinks(['publicado'], { newsDir, landingDir });
  expect(ok.issues).toEqual([]);
  expect(ok.reverseLinks).toBe(1);

  // Las landings ausentes se omiten aquí: las reporta el check 11.
  fs.rmSync(path.join(landingDir, 'publicado'), { recursive: true, force: true });
  const noLanding = auditNewsLandingLinks(['publicado'], { newsDir, landingDir });
  expect(noLanding.issues).toEqual([]);
  expect(noLanding.reverseLinks).toBe(0);

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

  // `perTarget` reparte cada mapa sin visitas entre varias landings con
  // tráfico: un único enlace puede quedar enterrado.
  const spread = buildDiscoveryIndex(maps, { minViews: 10, perHost: 2, perTarget: 2 });
  const hostsByTarget = new Map();
  for (const [host, targets] of spread) {
    for (const target of targets) {
      hostsByTarget.set(target.slug, [...(hostsByTarget.get(target.slug) || []), host]);
    }
  }
  expect(hostsByTarget.get('cero-eco')).toHaveLength(2);
  expect(hostsByTarget.get('cero-salud')).toHaveLength(2);
  for (const [host, targets] of spread) {
    expect(targets.length, `${host} supera perHost`).toBeLessThanOrEqual(2);
    for (const target of targets) expect(target.slug).not.toBe(host);
  }
});

// Regresión del check 12: cada landing estática es una página SEO propia y
// debe tener <title> propio, meta description no vacía, canonical con su slug,
// JSON-LD Dataset, BreadcrumbList y hreflang es/x-default.
function breadcrumbLd(canonical, { positions = [1, 2, 3], lastUrl = canonical } = {}) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: positions[0], name: 'Inicio', item: 'https://maña.com/' },
      { '@type': 'ListItem', position: positions[1], name: 'Galería', item: 'https://maña.com/gallery/' },
      { '@type': 'ListItem', position: positions[2], name: 'Mapa', item: lastUrl },
    ],
  });
}

function landingDoc({
  title, description, canonical, dataset,
  breadcrumb = undefined, hreflang = true, hreflangHref, breadcrumbUrl,
}) {
  const lastUrl = breadcrumbUrl || canonical;
  const breadcrumbScript = breadcrumb === false
    ? ''
    : `<script type="application/ld+json">${breadcrumb != null ? breadcrumb : breadcrumbLd(lastUrl)}</script>`;
  const hreflangLinks = hreflang && lastUrl
    ? `\n<link rel="alternate" hreflang="es" href="${hreflangHref || lastUrl}">` +
      `\n<link rel="alternate" hreflang="x-default" href="${hreflangHref || lastUrl}">`
    : '';
  return [
    '<!DOCTYPE html><html lang="es"><head>',
    title === undefined ? '' : `<title>${title}</title>`,
    description === undefined ? '' : `<meta name="description" content="${description}">`,
    canonical === undefined ? '' : `<link rel="canonical" href="${canonical}">`,
    hreflangLinks,
    dataset === undefined ? '' : `<script type="application/ld+json">${dataset}</script>`,
    breadcrumbScript,
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
  expect(result.missingBreadcrumb).toEqual([]);
  expect(result.invalidBreadcrumb).toEqual([]);
  expect(result.missingHreflang).toEqual([]);
  expect(result.wrongHreflang).toEqual([]);
  for (const slug of published) {
    const meta = result.details[slug];
    expect(meta.title, slug).toBeTruthy();
    expect(meta.dataset, slug).toBe(true);
    expect(meta.breadcrumb, slug).toHaveLength(3);
    expect(meta.breadcrumb[0].item, slug).toBe('https://maña.com/');
    expect(meta.breadcrumb[1].item, slug).toBe('https://maña.com/gallery/');
    expect(meta.breadcrumb[2].item, slug).toBe(`https://maña.com/gallery/${slug}/`);
    expect(meta.hreflangs.map(h => h.hreflang).sort(), slug).toEqual(['es', 'x-default']);
    for (const alt of meta.hreflangs) expect(alt.href, slug).toBe(`https://maña.com/gallery/${slug}/`);
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
    breadcrumbUrl: 'https://maña.com/gallery/sin-canonical/',
    hreflangHref: 'https://maña.com/gallery/sin-canonical/',
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
  write('sin-breadcrumb', landingDoc({
    title: 'Sin breadcrumb — Maña Maps',
    description: 'Descripción',
    canonical: 'https://maña.com/gallery/sin-breadcrumb/',
    dataset: validDataset,
    breadcrumb: false,
  }));
  write('breadcrumb-invalido', landingDoc({
    title: 'Breadcrumb inválido — Maña Maps',
    description: 'Descripción',
    canonical: 'https://maña.com/gallery/breadcrumb-invalido/',
    dataset: validDataset,
    breadcrumb: breadcrumbLd('https://maña.com/gallery/breadcrumb-invalido/', { positions: [1, 3, 4] }),
  }));
  write('sin-hreflang', landingDoc({
    title: 'Sin hreflang — Maña Maps',
    description: 'Descripción',
    canonical: 'https://maña.com/gallery/sin-hreflang/',
    dataset: validDataset,
    hreflang: false,
  }));
  write('hreflang-ajeno', landingDoc({
    title: 'Hreflang ajeno — Maña Maps',
    description: 'Descripción',
    canonical: 'https://maña.com/gallery/hreflang-ajeno/',
    dataset: validDataset,
    hreflangHref: 'https://maña.com/gallery/otro-mapa/',
  }));

  const slugs = [
    'ok-map', 'sin-title', 'titulo-generico', 'titulo-repetido-a',
    'titulo-repetido-b', 'sin-description', 'sin-canonical',
    'canonical-ajeno', 'sin-dataset', 'dataset-invalido', 'sin-landing',
    'sin-breadcrumb', 'breadcrumb-invalido', 'sin-hreflang', 'hreflang-ajeno',
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
  expect(result.missingBreadcrumb).toEqual(['sin-breadcrumb']);
  expect(result.invalidBreadcrumb).toEqual([
    { slug: 'breadcrumb-invalido', error: 'posición 2 incorrecta' },
  ]);
  expect(result.missingHreflang).toEqual([
    { slug: 'sin-hreflang', missing: ['es', 'x-default'] },
  ]);
  expect(result.wrongHreflang).toEqual([
    { slug: 'hreflang-ajeno', hreflang: 'es', href: 'https://maña.com/gallery/otro-mapa/' },
    { slug: 'hreflang-ajeno', hreflang: 'x-default', href: 'https://maña.com/gallery/otro-mapa/' },
  ]);

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
  expect(issues).toContain('1 landings sin JSON-LD BreadcrumbList (sin-breadcrumb)');
  expect(issues).toContain('BreadcrumbList inválido en breadcrumb-invalido (posición 2 incorrecta)');
  expect(issues).toContain('1 landings sin hreflang es/x-default (sin-hreflang: es/x-default)');
  expect(issues).toContain('hreflang es incorrecto en hreflang-ajeno');
  expect(issues).toContain('hreflang x-default incorrecto en hreflang-ajeno');

  // El parser tolera el orden de atributos y decodifica entidades.
  const parsed = parseLandingMetadata(
    '<title>Mapa &amp; datos — Maña Maps</title>' +
    '<meta content="A &quot;b&quot; c" name="description">' +
    '<link href="https://maña.com/gallery/orden/?" rel="canonical">' +
    '<link href="https://maña.com/gallery/orden/" hreflang="ES" rel="alternate">' +
    '<script type="application/ld+json">' + breadcrumbLd('https://maña.com/gallery/orden/') + '</script>'
  );
  expect(parsed.title).toBe('Mapa & datos — Maña Maps');
  expect(parsed.description).toBe('A "b" c');
  expect(parsed.canonical).toBe('https://maña.com/gallery/orden/?');
  expect(parsed.hreflangs).toEqual([{ hreflang: 'es', href: 'https://maña.com/gallery/orden/' }]);
  expect(parsed.breadcrumb).toHaveLength(3);

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

// Regresión del bloque «Datos clave»: la frase empieza en minúscula, pero las
// siglas del título deben conservarse («PIB per cápita», no «pIB per cápita»).
test('landing key facts keep acronyms when lowercasing the indicator', () => {
  expect(lowercaseIndicatorStart('PIB per cápita')).toBe('PIB per cápita');
  expect(lowercaseIndicatorStart('CO2 por persona')).toBe('CO2 por persona');
  expect(lowercaseIndicatorStart('PM2.5 media anual')).toBe('PM2.5 media anual');
  expect(lowercaseIndicatorStart('Consumo de alcohol')).toBe('consumo de alcohol');
  expect(lowercaseIndicatorStart('Altitud')).toBe('altitud');
  expect(lowercaseIndicatorStart('   ')).toBe('');

  const geo = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { _manaName: 'Singapur', 'PIB (num)': 139593 }, geometry: { type: 'Point', coordinates: [103.8, 1.35] } },
      { type: 'Feature', properties: { _manaName: 'España', 'PIB (num)': 32000 }, geometry: { type: 'Point', coordinates: [-3.7, 40.4] } },
      { type: 'Feature', properties: { _manaName: 'Brasil', 'PIB (num)': 9000 }, geometry: { type: 'Point', coordinates: [-47.9, -15.8] } },
      { type: 'Feature', properties: { _manaName: 'Burundi', 'PIB (num)': 1067 }, geometry: { type: 'Point', coordinates: [29.9, -3.4] } },
    ],
  };
  const section = buildFactsSection(geo, {
    legendKey: 'PIB (num)',
    legendTitle: 'PIB per cápita (USD corrientes)',
    legendFormat: 'number',
  });
  expect(section.html).toContain('registra el valor más alto de PIB per cápita');
  expect(section.html).not.toContain('pIB');

  // La landing publicada se regenera con el generador; si alguien vuelve a
  // bajar la primera letra sin mirar las siglas, este test lo detecta.
  const gdpLanding = fs.readFileSync(
    path.join(siteRoot, 'gallery', 'gdp-per-capita-world', 'index.html'), 'utf8');
  expect(gdpLanding).toContain('valor más alto de PIB per cápita');
  expect(gdpLanding).not.toContain('pIB per cápita');
});

// Regresión de la medición en landings estáticas: /gallery/<slug>/ es la URL
// canónica indexada y debe incrementar maps.views una vez por sesión, con el
// mismo opt-out que el visor. La petición se intercepta para no escribir en
// Firestore real.
function viewCommitBodies(bodies) {
  return bodies.filter((body) => body.includes('"fieldPath":"views"'));
}

test('static landing increments views once per session with source static_landing', async ({ page }) => {
  const bodies = [];
  // En CI no existe site/js/firebase-config.local.js (se genera con secretos en
  // el deploy). Inyectamos una config de prueba para ejercitar el envío REST.
  await page.route('**/js/firebase-config.local.js', (route) => route.fulfill({
    status: 404, contentType: 'text/javascript', body: '',
  }));
  await page.addInitScript(() => {
    window.MANA_FIREBASE_CONFIGS = {
      pre: { apiKey: 'test-key', projectId: 'mana-maps-test', authDomain: 'test.firebaseapp.com', appId: 'test-app' },
    };
  });
  await page.route('**/firestore.googleapis.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') bodies.push(request.postData() || '');
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"writeResults":[]}' });
  });
  await page.route('**/ipwho.is/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"success":false}',
  }));

  await page.goto('/gallery/gdp-per-capita-world/');
  await expect.poll(() => viewCommitBodies(bodies).length).toBe(1);

  const [commit] = viewCommitBodies(bodies);
  expect(commit).toContain('/documents/maps/gdp-per-capita-world');
  expect(commit).toContain('"increment":{"integerValue":"1"}');
  expect(bodies.some((body) => body.includes('"mapview"') && body.includes('static_landing'))).toBe(true);

  // La misma sesión (recarga) no vuelve a contar la visita.
  await page.reload();
  await page.waitForTimeout(600);
  expect(viewCommitBodies(bodies).length).toBe(1);
});

test('static landing respects the mana-notrack opt-out', async ({ browser }) => {
  const context = await browser.newContext();
  const bodies = [];
  await context.route('**/js/firebase-config.local.js', (route) => route.fulfill({
    status: 404, contentType: 'text/javascript', body: '',
  }));
  await context.addInitScript(() => {
    window.MANA_FIREBASE_CONFIGS = {
      pre: { apiKey: 'test-key', projectId: 'mana-maps-test', authDomain: 'test.firebaseapp.com', appId: 'test-app' },
    };
  });
  await context.route('**/firestore.googleapis.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') bodies.push(request.postData() || '');
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"writeResults":[]}' });
  });
  await context.route('**/ipwho.is/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"success":false}',
  }));
  await context.addInitScript(() => {
    try { localStorage.setItem('mana-notrack', '1'); } catch (e) {}
  });

  const page = await context.newPage();
  await page.goto('/gallery/gdp-per-capita-world/');
  await page.waitForTimeout(800);
  expect(viewCommitBodies(bodies)).toEqual([]);
  expect(bodies.some((body) => body.includes('"mapview"'))).toBe(false);
  await context.close();
});

// El «Índice de mapas» de la galería se retiró por decisión de producto:
// duplicaba el grid de tarjetas y el agente automático volvía a generarlo. Se
// bloquea cualquier rastro del bloque o de su generador para que no reaparezca.
test('gallery does not render the map index block', () => {
  expect(galleryHtml).not.toMatch(/map-index|Índice de mapas/i);

  const generator = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'tools', 'generate-map-landings.js'),
    'utf8'
  );
  expect(generator).not.toMatch(/map-index|Índice de mapas/i);
  expect(
    fs.existsSync(path.join(repoRoot, 'scripts', 'lib', 'map-index.js')),
    'el generador del índice de mapas no debe existir'
  ).toBe(false);
});

// ── Compartir desde las landings estáticas ───────────────────────
// Las landings son la URL canónica indexada y el único punto de entrada de
// quien llega desde buscadores o Reddit. Ofrecen compartir nativo (Web Share
// API con copia de enlace como fallback), Reddit (el canal social con señal
// real en el informe de octubre) y X, siempre con la URL canónica para no
// repartir autoridad entre /gallery/<slug>/ y el visor ?slug=.
test('every map landing offers native and Reddit share with the canonical URL', () => {
  const published = parseCollectionLd(galleryHtml).slugs;
  const shareScript = path.join(siteRoot, 'js', 'landing-share.js');
  expect(fs.existsSync(shareScript), 'falta site/js/landing-share.js').toBe(true);

  const missing = [];
  for (const slug of published) {
    const file = path.join(siteRoot, 'gallery', slug, 'index.html');
    let html = '';
    try { html = fs.readFileSync(file, 'utf8'); } catch (e) { missing.push(`${slug}: landing ausente`); continue; }
    const canonical = `https://maña.com/gallery/${slug}/`;
    const problems = [];
    if (!html.includes('src="/js/landing-share.js"')) problems.push('sin landing-share.js');
    if (!html.includes('data-share-native')) problems.push('sin compartir nativo');
    if (!html.includes(`data-share-url="${canonical}"`)) problems.push('data-share-url no canónica');
    if (!html.includes(`data-share-title="`)) problems.push('sin data-share-title');
    if (!html.includes('Compartir en Reddit')) problems.push('sin botón de Reddit');
    if (!html.includes(`reddit.com/submit?url=${encodeURIComponent(canonical)}`)) {
      problems.push('Reddit no usa la URL canónica');
    }
    if (!html.includes('Compartir en X')) problems.push('sin botón de X');
    if (problems.length) missing.push(`${slug}: ${problems.join(', ')}`);
  }
  expect(missing, `landings sin compartir completo:\n${missing.join('\n')}`).toEqual([]);
});

test('static landing native share tracks source static_map and falls back to copy', async ({ page }) => {
  await page.route('**/js/firebase-config.local.js', (route) => route.fulfill({
    status: 404, contentType: 'text/javascript', body: '',
  }));
  await page.addInitScript(() => {
    window.__shared = null;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data) => { window.__shared = data; },
    });
  });
  await page.route('**/firestore.googleapis.com/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"writeResults":[]}',
  }));
  await page.route('**/ipwho.is/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"success":false}',
  }));

  await page.goto('/gallery/gdp-per-capita-world/');
  await page.evaluate(() => {
    window.__shares = [];
    window.trackEvent = (name, params) => window.__shares.push([name, params]);
  });

  const canonical = 'https://maña.com/gallery/gdp-per-capita-world/';
  await page.click('[data-share-native]');
  await expect.poll(() => page.evaluate(() => window.__shared && window.__shared.url)).toBe(canonical);
  expect(await page.evaluate(() => window.__shares)).toEqual([['share', { network: 'native', source: 'static_map' }]]);
  await expect(page.locator('#share-status')).toHaveText('Mapa compartido');

  // Sin Web Share API (escritorio) el botón copia el enlace canónico.
  await page.addInitScript(() => {
    delete navigator.share;
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => { window.__copied = text; } },
    });
  });
  await page.reload();
  await page.evaluate(() => {
    window.__shares = [];
    window.trackEvent = (name, params) => window.__shares.push([name, params]);
  });
  await page.click('[data-share-native]');
  await expect.poll(() => page.evaluate(() => window.__copied)).toBe(canonical);
  expect(await page.evaluate(() => window.__shares)).toEqual([['share', { network: 'copy_link', source: 'static_map' }]]);
  await expect(page.locator('#share-status')).toHaveText('Enlace copiado');
});

// ── Distribución interna y gancho de datos (prioridad 1 de noviembre) ──
// Los mapas que siguen con cero visitas ya reciben enlaces desde landings con
// tráfico, pero no había forma de saber qué colocación genera la visita ni de
// cuánto pesa el texto al compartir. Estas regresiones cubren las dos cosas.
test('every map landing loads the discovery click tracker', () => {
  const published = parseCollectionLd(galleryHtml).slugs;
  const script = path.join(siteRoot, 'js', 'landing-discovery.js');
  expect(fs.existsSync(script), 'falta site/js/landing-discovery.js').toBe(true);

  const missing = [];
  for (const slug of published) {
    const file = path.join(siteRoot, 'gallery', slug, 'index.html');
    let html = '';
    try { html = fs.readFileSync(file, 'utf8'); } catch (e) { missing.push(`${slug}: landing ausente`); continue; }
    if (!html.includes('src="/js/landing-discovery.js"')) missing.push(`${slug}: sin landing-discovery.js`);
  }
  expect(missing, `landings sin medición de descubrimiento:\n${missing.join('\n')}`).toEqual([]);
});

async function stubLandingNetwork(page) {
  await page.route('**/js/firebase-config.local.js', (route) => route.fulfill({
    status: 404, contentType: 'text/javascript', body: '',
  }));
  await page.route('**/firestore.googleapis.com/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"writeResults":[]}',
  }));
  await page.route('**/ipwho.is/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"success":false}',
  }));
}

test('static landings attribute internal discovery clicks by placement', async ({ page }) => {
  await stubLandingNetwork(page);
  await page.goto('/gallery/gdp-per-capita-world/');
  await page.evaluate(() => {
    window.__events = [];
    window.trackEvent = (name, params) => window.__events.push([name, params]);
    // Sin navegación para poder inspeccionar el evento registrado.
    document.addEventListener('click', (event) => event.preventDefault(), true);
  });

  const relatedSlug = await page.evaluate(() => {
    const anchor = document.querySelector('.related a[href^="/gallery/"]');
    return decodeURIComponent(anchor.getAttribute('href').split('/')[2]);
  });
  await page.click('.related a[href^="/gallery/"]');
  await expect.poll(() => page.evaluate(() => window.__events)).toEqual([
    ['discovery_click', { source: 'gdp-per-capita-world', target: relatedSlug, placement: 'related' }],
  ]);

  // Un enlace externo (compartir en Reddit) no es descubrimiento interno.
  await page.evaluate(() => { window.__events = []; });
  await page.click('.cta a[href*="reddit.com/submit"]');
  const external = await page.evaluate(() => window.__events.filter((event) => event[0] === 'discovery_click'));
  expect(external).toEqual([]);
});

test('static landings mark discovery blocks apart and respect the tracking opt-out', async ({ page }) => {
  await stubLandingNetwork(page);
  await page.goto('/gallery/gini-index-world/');
  const discoverySlug = await page.evaluate(() => {
    const anchor = document.querySelector('.related--discovery a[href^="/gallery/"]');
    return decodeURIComponent(anchor.getAttribute('href').split('/')[2]);
  });

  await page.evaluate(() => {
    window.__events = [];
    window.trackEvent = (name, params) => window.__events.push([name, params]);
    document.addEventListener('click', (event) => event.preventDefault(), true);
  });
  await page.click('.related--discovery a');
  await expect.poll(() => page.evaluate(() => window.__events)).toEqual([
    ['discovery_click', { source: 'gini-index-world', target: discoverySlug, placement: 'discovery' }],
  ]);

  // Con mana-notrack (tráfico interno/QA) no se registra nada.
  await page.addInitScript(() => localStorage.setItem('mana-notrack', '1'));
  await page.goto('/gallery/gini-index-world/');
  await page.evaluate(() => {
    window.__events = [];
    window.trackEvent = (name, params) => window.__events.push([name, params]);
    document.addEventListener('click', (event) => event.preventDefault(), true);
  });
  await page.click('.related--discovery a');
  expect(await page.evaluate(() => window.__events)).toEqual([]);
});

test('static landings share the data hook instead of only the map title', async ({ page }) => {
  await stubLandingNetwork(page);
  await page.goto('/gallery/gini-index-world/');
  const title = (await page.locator('main h1').textContent()).trim();

  const xText = await page.evaluate(() => {
    const anchor = document.querySelector('a[href*="twitter.com/intent/tweet"]');
    return new URL(anchor.href).searchParams.get('text');
  });
  expect(xText.startsWith(title + ': '), `X no lleva el gancho: ${xText}`).toBe(true);
  expect(xText.length).toBeGreaterThan(title.length + 20);

  const reddit = await page.evaluate(() => {
    const anchor = document.querySelector('a[href*="reddit.com/submit"]');
    const url = new URL(anchor.href);
    return { url: url.searchParams.get('url'), title: url.searchParams.get('title') };
  });
  expect(reddit.url).toBe('https://maña.com/gallery/gini-index-world/');
  expect(reddit.title).toBe(xText);

  const nativeText = await page.locator('[data-share-native]').getAttribute('data-share-text');
  expect(nativeText).toBe(xText);
});
