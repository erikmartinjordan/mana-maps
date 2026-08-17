const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // Simulate CI: abort all external CDN requests
  await page.route(/^https?:\/\/(unpkg\.com|www\.gstatic\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/, (route) => route.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });
  try {
    await page.goto('http://127.0.0.1:4173/gallery/', { waitUntil: 'load', timeout: 30000 });
    console.log('LOAD OK');
  } catch (e) {
    console.log('GOTO ERROR:', e.message.split('\n')[0]);
  }
  await page.waitForTimeout(3000);
  const likeBtns = await page.locator('.card-like-btn').count();
  console.log('likeBtns:', likeBtns);
  console.log('PAGEERRORS:', JSON.stringify(errors));
  await browser.close();
})();
