const { test, expect } = require('@playwright/test');

// The gallery page loads external CDNs (maplibre-gl from unpkg.com, Firebase
// from gstatic.com, Google Fonts) that can block or delay the browser "load"
// event. In CI or on a slow network that event can take longer than the test
// timeout and make this smoke test flaky, so it aborts those third-party
// requests: the test only needs the bundled local maps and the auth modal,
// and stays deterministic without external dependencies.
const EXTERNAL_CDN = /^https?:\/\/(unpkg\.com|www\.gstatic\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/;

test('gallery loads without errors and like/fork show auth modal', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.route(EXTERNAL_CDN, (route) => route.abort());

  // No Firebase config: remoteMaps falls back to the bundled local map.
  await page.addInitScript(() => {
    delete window.MANA_FIREBASE_CONFIGS;
  });

  await page.goto('/gallery/', { waitUntil: 'domcontentloaded' });

  const likeBtn = page.locator('.card-like-btn').first();
  await expect(likeBtn).toBeVisible({ timeout: 20_000 });

  await likeBtn.click();
  await expect(page.locator('#auth-modal.open')).toBeVisible();

  await page.locator('.modal-close-btn.share-close').click();
  await expect(page.locator('#auth-modal.open')).not.toBeVisible();

  const forkBtn = page.locator('.card-fork-btn').first();
  await forkBtn.click();
  await expect(page.locator('#auth-modal.open')).toBeVisible();

  expect(pageErrors, `Unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
