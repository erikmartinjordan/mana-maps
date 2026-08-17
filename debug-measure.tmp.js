const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: require('playwright-core').chromium.executablePath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  async function measure(path, label) {
    const page = await browser.newPage();
    const t0 = Date.now();
    const log = [];
    page.on('pageerror', err => log.push('PAGEERROR: ' + err.message));
    page.on('requestfailed', r => log.push('FAILED: ' + r.url().slice(0, 80)));
    try {
      await page.goto('http://127.0.0.1:4173' + path, { waitUntil: 'load', timeout: 60000 });
      console.log(`[${label}] LOAD OK in ${Date.now() - t0}ms`);
    } catch (e) {
      console.log(`[${label}] GOTO FAILED in ${Date.now() - t0}ms:`, e.message.split('\n')[0]);
    }
    if (log.length) console.log('  ' + log.join('\n  '));
    await page.close();
  }

  await measure('/gallery/', 'gallery-with-volcanes');

  // Now temporarily rename the volcano file? Instead, measure other pages for baseline.
  await measure('/gallery/?nocache=1', 'gallery-repeat');
  await measure('/', 'home');

  await browser.close();
})();