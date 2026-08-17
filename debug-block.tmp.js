const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: require('playwright-core').chromium.executablePath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();

  // Block external CDNs exactly like the proposed test fix
  await page.route(/^(https?:\/\/)(unpkg\.com|www\.gstatic\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/, (route) => route.abort());

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.addInitScript(() => { delete window.MANA_FIREBASE_CONFIGS; });

  const t0 = Date.now();
  try {
    await page.goto('http://127.0.0.1:4173/gallery/', { waitUntil: 'load', timeout: 30000 });
    console.log('LOAD OK in', Date.now() - t0, 'ms');
  } catch (e) {
    console.log('GOTO ERROR:', e.message.split('\n')[0], 'in', Date.now() - t0, 'ms');
  }

  const likeBtn = page.locator('.card-like-btn').first();
  try {
    await likeBtn.waitFor({ timeout: 20000 });
    console.log('LIKE BTN VISIBLE');
  } catch (e) {
    console.log('LIKE BTN NOT VISIBLE:', e.message.split('\n')[0]);
  }

  // Count cards rendered
  const cards = await page.locator('.card').count();
  const titles = await page.locator('.card .title').allTextContents();
  console.log('CARDS:', cards, '| titles:', JSON.stringify(titles));

  console.log('PAGEERRORS:', JSON.stringify(pageErrors));
  await browser.close();
})();