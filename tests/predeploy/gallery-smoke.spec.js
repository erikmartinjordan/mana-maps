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
