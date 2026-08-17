const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const failed = [];
  const pending = [];
  const requests = {};
  page.on('request', r => { requests[r.url()] = r; });
  page.on('requestfailed', r => failed.push({ url: r.url(), err: r.failure() && r.failure().errorText }));
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  // Track which requests are still in flight after 15s
  setTimeout(() => {
    const stillPending = [];
    for (const [url, r] of Object.entries(requests)) {
      // check if response received
      stillPending.push(url);
    }
    console.log('\n=== ALL REQUESTS ===');
    for (const [url] of Object.entries(requests)) console.log('REQ:', url.slice(0, 100));
  }, 15000);

  try {
    await page.goto('http://127.0.0.1:4173/gallery/', { waitUntil: 'load', timeout: 60000 });
    console.log('LOAD OK');
  } catch (e) {
    console.log('GOTO ERROR:', e.message.split('\n')[0]);
  }

  await page.waitForTimeout(5000);
  console.log('\n=== FAILED REQUESTS ===');
  failed.forEach(f => console.log('FAILED:', f.url.slice(0, 100), '|', f.err));

  await browser.close();
})();