const { test, expect } = require('@playwright/test');

const firebaseSmokeConfig = {
  apiKey: 'smoke-test-api-key',
  authDomain: 'smoke-test.firebaseapp.com',
  projectId: 'smoke-test',
  appId: '1:123456789:web:smoketest'
};

test('DIAG map editor shell', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console:error]', msg.text());
  });
  page.on('requestfailed', (req) => console.log('[requestfailed]', req.url(), req.failure() && req.failure().errorText));
  page.on('request', (req) => {
    if (req.url().includes('127.0.0.1')) console.log('[request]', req.url());
  });

  await page.addInitScript((config) => {
    window.MANA_FIREBASE_CONFIGS = { pre: config, pro: config };
    window.MANA_FIREBASE_ENV = 'pre';
  }, firebaseSmokeConfig);

  await page.goto('/map');
  console.log('after goto, url:', page.url());
  await page.waitForTimeout(3000);
  console.log('topbar count:', await page.locator('#topbar').count());
  console.log('map count:', await page.locator('#map').count());
  console.log('chat-panel count:', await page.locator('#chat-panel').count());
  const html = await page.evaluate(() => document.documentElement ? document.documentElement.outerHTML.slice(0, 300) : 'NO DOC');
  console.log('html head:', html.replace(/\n/g, ' '));
  console.log('PAGE ERRORS:', JSON.stringify(pageErrors));

  expect(page.locator('#topbar')).toBeVisible();
  expect(page.locator('#map')).toBeVisible();
  expect(page.locator('#chat-panel')).toBeVisible();
  expect(pageErrors).toEqual([]);
});