const { test, expect } = require('@playwright/test');

const EXTERNAL_CDN = /^https?:\/\/(unpkg\.com|www\.gstatic\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/;

test('gallery loads without errors and shows empty state when Firebase is unavailable', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());

  await page.addInitScript(() => {
    delete window.MANA_FIREBASE_CONFIGS;
  });

  await page.goto('/gallery/', { waitUntil: 'domcontentloaded' });

  const emptyState = page.locator('.empty-title');
  await expect(emptyState.first()).toBeVisible({ timeout: 20_000 });
  await expect(emptyState.first()).toContainText('Todavía no hay mapas publicados');

  const createBtn = page.locator('.empty .btn-primary');
  await expect(createBtn).toBeVisible();
  await expect(createBtn).toHaveAttribute('href', '/map/');

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('gallery cards keep descriptions and data source hidden (product decision)', async ({ page }) => {
  // Guard de producto: las descripciones (.card-desc) y la fuente (.meta-source)
  // de las tarjetas de la galería deben permanecer ocultas. Este test bloquea
  // cualquier cambio (p. ej. del autopilot) que las re-habilite.
  await page.route(EXTERNAL_CDN, (route) => route.abort());
  await page.addInitScript(() => {
    delete window.MANA_FIREBASE_CONFIGS;
  });

  await page.goto('/gallery/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#gallery-list', { timeout: 20_000 });

  const displays = await page.evaluate(() => {
    const grid = document.getElementById('gallery-list');
    const card = document.createElement('div');
    card.className = 'card';
    const desc = document.createElement('div');
    desc.className = 'card-desc';
    desc.textContent = 'descripcion de prueba';
    const source = document.createElement('div');
    source.className = 'meta-source';
    source.textContent = 'fuente de prueba';
    card.append(desc, source);
    grid.appendChild(card);
    const d = getComputedStyle(desc).display;
    const s = getComputedStyle(source).display;
    card.remove();
    return { desc: d, source: s };
  });

  expect(displays.desc, '.card-desc debe estar oculta (display:none)').toBe('none');
  expect(displays.source, '.meta-source debe estar oculta (display:none)').toBe('none');
});

test('gallery auth modal opens on like/fork click', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());

  await page.addInitScript(() => {
    delete window.MANA_FIREBASE_CONFIGS;
  });

  await page.goto('/gallery/', { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('.empty-title', { timeout: 20_000 });

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
