const { test } = require('@playwright/test');

test('probe gallery load', async ({ page }) => {
  const t0 = Date.now();
  const errors = [];
  const pending = {};
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('request', (req) => { pending[req.url()] = Date.now() - t0; });
  page.on('requestfinished', (req) => { console.log('DONE', Date.now() - t0, req.url()); delete pending[req.url()]; });
  page.on('requestfailed', (req) => { console.log('FAIL', Date.now() - t0, req.url(), req.failure() && req.failure().errorText); delete pending[req.url()]; });
  await page.goto('/gallery/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('domcontentloaded ms:', Date.now() - t0);
  await page.waitForTimeout(25000);
  console.log('--- pending after 25s:', JSON.stringify(Object.keys(pending)));
  const cards = await page.locator('.card').count();
  const cardBtns = await page.locator('.card-like-btn').count();
  console.log('cards:', cards, 'likebtns:', cardBtns);
  console.log('errors:', JSON.stringify(errors, null, 2));
});
