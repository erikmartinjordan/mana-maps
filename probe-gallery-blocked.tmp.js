const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const failed = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => failed.push(r.url().slice(0, 90)));
  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });
  try {
    await page.goto('http://127.0.0.1:4173/gallery/', { waitUntil: 'load', timeout: 30000 });
    console.log('LOAD OK');
  } catch (e) {
    console.log('GOTO ERROR:', e.message.split('\n')[0]);
  }
  await page.waitForTimeout(2000);
  const likeBtn = page.locator('.card-like-btn').first();
  try { await likeBtn.waitFor({ timeout: 20000 }); console.log('LIKE BTN OK'); } catch(e) { console.log('LIKE BTN FAIL'); }
  console.log('errors:', JSON.stringify(errors));
  console.log('failed reqs:', JSON.stringify(failed.slice(0,5)));
  await browser.close();
})();
