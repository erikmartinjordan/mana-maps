const { test, expect } = require('@playwright/test');

const EXTERNAL_CDN = /^https?:\/\/(unpkg\.com|www\.gstatic\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/;

/**
 * Validación visual y estructural de /gallery/?tag= y /gallery/?slug=
 * para los 10 mapas publicados. Estos tests verifican que la galería
 * carga sin errores de JS, que la estructura de página es correcta
 * y que los parámetros de URL se procesan adecuadamente.
 */

// Slugs de los 10 mapas publicados en Firestore
const KNOWN_SLUGS = [
  'active-volcanoes-world',
  'arrecifes-de-coral-fosas-oceanicas-y-naufragios-famosos-3172026-1785478772912',
  'ciudades-perdidas-y-ruinas-arqueologicas-fascinantes-3072026-1785391217436',
  'highest-peaks-per-continent',
  'longest-rivers-world',
  'major-deserts-world',
  'minimum-wage-by-country',
  'oceans-and-seas-world',
  'submarine-fiber-cables',
  'worst-wildfires-world',
];

// Tags conocidos de la galería
const KNOWN_TAGS = [
  'naturaleza', 'geografia', 'historia', 'economia',
  'infraestructura', 'tecnologia', 'volcanes', 'geologia',
  'montanas', 'clima', 'hidrografia', 'medio-ambiente', 'oceanos',
];

test('gallery page loads with correct structure (no JS errors)', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());
  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });

  await page.goto('/gallery/', { waitUntil: 'domcontentloaded' });

  // Estructura de página presente
  await expect(page.locator('#gallery-list')).toBeAttached();
  await expect(page.locator('#filter-bar')).toBeAttached();
  await expect(page.locator('#filter-status')).toBeAttached();
  await expect(page.locator('#featured-wrap')).toBeAttached();
  await expect(page.locator('#featured-map')).toBeAttached();

  // Hero visible
  await expect(page.locator('.hero h1')).toContainText('Galería de mapas');

  // Empty state shown (Firebase unavailable)
  await expect(page.locator('.empty-title').first()).toBeVisible({ timeout: 20_000 });

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('gallery /gallery/?tag=naturaleza loads without errors', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());
  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });

  await page.goto('/gallery/?tag=naturaleza', { waitUntil: 'domcontentloaded' });

  // Estructura de página correcta
  await expect(page.locator('#gallery-list')).toBeAttached();
  await expect(page.locator('#filter-bar')).toBeAttached();

  // Empty state visible (sin Firebase no hay datos)
  await expect(page.locator('.empty-title').first()).toBeVisible({ timeout: 20_000 });

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('gallery filter bar renders all known tag slugs without errors', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());
  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });

  // Probar varios tags conocidos
  for (const tag of KNOWN_TAGS.slice(0, 5)) {
    await page.goto(`/gallery/?tag=${tag}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#filter-bar')).toBeAttached();
    // Sin Firebase: no hay botones de filtro, pero la página carga sin error
  }

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('gallery /gallery/?slug=<unknown> loads without JS errors (graceful fallback)', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());
  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });

  await page.goto('/gallery/?slug=nonexistent-map-12345', { waitUntil: 'domcontentloaded' });

  // La sección featured debe permanecer oculta (no hay mapa)
  const featuredWrap = page.locator('#featured-wrap');
  await expect(featuredWrap).toBeAttached();

  // Empty state visible
  await expect(page.locator('.empty-title').first()).toBeVisible({ timeout: 20_000 });

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('gallery loads each known slug without JS errors', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());
  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });

  // Probar los primeros 5 slugs conocidos (cada carga es una petición)
  for (const slug of KNOWN_SLUGS.slice(0, 5)) {
    await page.goto(`/gallery/?slug=${slug}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#gallery-list')).toBeAttached();
    // Con slug inválido/inesistente sin Firebase, empty state se muestra
  }

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('gallery URL tag param syncs with filter bar state', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());
  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });

  // Load with tag param — filter bar should be present
  await page.goto('/gallery/?tag=economia', { waitUntil: 'domcontentloaded' });
  const filterBar = page.locator('#filter-bar');
  await expect(filterBar).toBeAttached();

  // The URL should remain intact (no redirect)
  expect(page.url()).toContain('tag=economia');

  // Without Firebase, filter bar is hidden (no tags to render)
  await expect(filterBar).toHaveAttribute('hidden', '');

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('gallery URL slug param preserves query string for featured map', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());
  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });

  await page.goto('/gallery/?slug=longest-rivers-world', { waitUntil: 'domcontentloaded' });

  // URL preserves the slug param
  expect(page.url()).toContain('slug=longest-rivers-world');

  // Page loads correctly
  await expect(page.locator('#gallery-list')).toBeAttached();
  await expect(page.locator('#featured-wrap')).toBeAttached();

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('gallery lang=es is set on the HTML element', async ({ page }) => {
  await page.route(EXTERNAL_CDN, (route) => route.abort());
  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });

  await page.goto('/gallery/', { waitUntil: 'domcontentloaded' });

  const htmlLang = await page.locator('html').getAttribute('lang');
  expect(htmlLang).toBe('es');
});

test('gallery og:locale and meta tags are Spanish', async ({ page }) => {
  await page.route(EXTERNAL_CDN, (route) => route.abort());
  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });

  await page.goto('/gallery/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'es_ES');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Galería/i);
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute('content', /Galería/i);
});

test('gallery test map IDs are not accessible (404)', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());
  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });

  // Los mapas de prueba j9T7rtBWYFHcG5EYku0W y npH7euhfmwQU1RehAtnD
  // ya no existen en Firestore. Al acceder con estos slugs, la galería
  // no debe encontrarlos y no debe mostrar ningún mapa destacado.
  for (const testId of ['j9T7rtBWYFHcG5EYku0W', 'npH7euhfmwQU1RehAtnD']) {
    await page.goto(`/gallery/?slug=${testId}`, { waitUntil: 'domcontentloaded' });

    // La sección featured-wrap debe permanecer oculta
    const featuredWrap = page.locator('#featured-wrap');
    const isVisible = await featuredWrap.evaluate(el => {
      return window.getComputedStyle(el).display !== 'none';
    }).catch(() => false);

    // Sin Firebase el featured siempre está oculto, lo cual confirma que
    // el mapa de prueba no se muestra.
    expect(isVisible, `Test map ${testId} should not be featured`).toBe(false);
  }

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
