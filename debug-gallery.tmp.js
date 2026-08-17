const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: require('playwright-core').chromium.executablePath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();

  const failed = [];
  const responses = {};
  const pending = {};
  page.on('request', r => { pending[r.url()] = Date.now(); });
  page.on('requestfailed', r => failed.push({ url: r.url(), err: r.failure() && r.failure().errorText }));
  page.on('response', r => { delete pending[r.url()]; responses[r.url()] = r.status(); });
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  try {
    await page.goto('http://127.0.0.1:4173/gallery/', { waitUntil: 'load', timeout: 60000 });
    console.log('LOAD OK');
  } catch (e) {
    console.log('GOTO ERROR:', e.message.split('\n')[0]);
  }

  await page.waitForTimeout(8000);

  console.log('\n=== STILL PENDING REQUESTS (no response) ===');
  for (const [url, t] of Object.entries(pending)) console.log('PENDING:', url.slice(0, 110));
  console.log('\n=== FAILED REQUESTS ===');
  failed.forEach(f => console.log('FAILED:', f.url.slice(0, 110), '|', f.err));
  console.log('\n=== RESPONSES (non-2xx) ===');
  for (const [url, st] of Object.entries(responses)) if (st >= 400) console.log(st, url.slice(0, 110));

  await browser.close();
})();