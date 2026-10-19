const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4179/gallery/?slug=busiest-ports-world&firebaseEnv=pro', { waitUntil: 'domcontentloaded' });
  try { await page.waitForSelector('#slug-map canvas', { timeout: 45000 }); } catch (e) { console.log('no canvas'); }
  await page.waitForTimeout(5000);
  const box = await page.evaluate(() => {
    const w = document.getElementById('slug-map-wrap');
    const l = document.querySelector('#slug-map .featured-legend');
    const r = w && w.getBoundingClientRect();
    const lr = l && l.getBoundingClientRect();
    return { wrap: r && {w: r.width, h: r.height}, legend: lr && {x: lr.x, y: lr.y, w: lr.width, h: lr.height}, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
  });
  console.log(JSON.stringify(box));
  await page.screenshot({ path: '/tmp/ports-mobile.png', fullPage: false });
  await browser.close();
  process.exit(0);
})();
