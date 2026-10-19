const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  for (const slug of ['airports-world','busiest-ports-world']) {
    await page.goto('http://127.0.0.1:4180/gallery/?slug='+slug+'&firebaseEnv=pro', { waitUntil: 'domcontentloaded' });
    try { await page.waitForSelector('#slug-map canvas', { timeout: 45000 }); } catch (e) {}
    await page.waitForTimeout(4000);
    const z = await page.evaluate(() => {
      const c = document.querySelector('#slug-map canvas');
      return { slug: location.search, canvas: !!c, w: c && c.width };
    });
    console.log(JSON.stringify(z));
    await page.screenshot({ path: '/tmp/mobile-'+slug+'.png' });
  }
  await browser.close();
  process.exit(0);
})();
