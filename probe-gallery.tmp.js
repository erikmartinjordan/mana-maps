const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('CONSOLE: ' + m.text()); });
  page.on('requestfailed', r => console.log('REQFAIL:', r.url().slice(0, 100), '|', r.failure() && r.failure().errorText));

  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });

  try {
    await page.goto('http://127.0.0.1:4173/gallery/', { waitUntil: 'load', timeout: 30000 });
    console.log('LOAD OK');
  } catch (e) {
    console.log('GOTO ERROR:', e.message.split('\n')[0]);
  }
  await page.waitForTimeout(5000);
  const cards = await page.locator('.card').count();
  const likeBtns = await page.locator('.card-like-btn').count();
  console.log('cards:', cards, 'likeBtns:', likeBtns);
  console.log('PAGEERRORS:', JSON.stringify(errors, null, 2));
  console.log('CONSOLE ERRORS:', JSON.stringify(consoleErrors, null, 2));
  await browser.close();
})();
