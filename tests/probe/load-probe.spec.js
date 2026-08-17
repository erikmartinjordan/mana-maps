const { test } = require('@playwright/test');

test('probe gallery load', async ({ page }) => {
  const t0 = Date.now();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('/gallery/', { waitUntil: 'load', timeout: 90000 });
  console.log('gallery load ms:', Date.now() - t0);
  await page.waitForSelector('.card-like-btn', { timeout: 20000 });
  console.log('card ready ms:', Date.now() - t0);
  console.log('cards:', await page.locator('.card').count());
  console.log('errors:', JSON.stringify(errors, null, 2));
});

test('probe home load', async ({ page }) => {
  const t0 = Date.now();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('/', { waitUntil: 'load', timeout: 90000 });
  console.log('home load ms:', Date.now() - t0);
  console.log('errors:', JSON.stringify(errors, null, 2));
});
