const { test, expect } = require('@playwright/test');

test('gallery loads without errors and like/fork show auth modal', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // No Firebase config: remoteMaps falls back to the bundled local map.
  await page.addInitScript(() => {
    delete window.MANA_FIREBASE_CONFIGS;
  });

  await page.goto('/gallery/');

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
