const { test, expect } = require('@playwright/test');

test('home page loads with expected title and main CTA', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Maña Maps — Diseña mapas con claridad/i);
  await expect(page.locator('a[href="/map/"]')).toBeVisible();
});

test('map editor shell loads core UI containers', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/map/');

  await expect(page.locator('#topbar')).toBeVisible();
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#chat-panel')).toBeVisible();

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
