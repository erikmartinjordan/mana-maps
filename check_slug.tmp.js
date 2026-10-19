const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const failed = [];
  page.on('response', r => { if (r.status() >= 400) failed.push('HTTP ' + r.status() + ' ' + r.url().slice(0,140)); });
  page.on('pageerror', e => failed.push('PAGEERROR ' + e.message));
  await page.goto('http://127.0.0.1:4178/gallery/?slug=busiest-ports-world&firebaseEnv=pro', { waitUntil: 'domcontentloaded' });
  try { await page.waitForSelector('#slug-map canvas', { timeout: 45000 }); console.log('canvas appeared'); } catch (e) { console.log('no canvas'); }
  await page.waitForTimeout(5000);
  const info = await page.evaluate(() => ({
    wrapHidden: document.getElementById('slug-map-wrap').hidden,
    title: (document.getElementById('slug-map-title')||{}).textContent,
    legend: (document.querySelector('#slug-map .featured-legend')||{}).innerText,
    canvas: document.querySelectorAll('#slug-map canvas').length,
    meta: (document.getElementById('slug-map-meta')||{}).innerText.slice(0,200),
    bodyHasPorts: document.body.innerText.includes('puertos'),
  }));
  console.log(JSON.stringify(info, null, 1));
  console.log('FAILED', failed.slice(0, 10));
  await page.screenshot({ path: '/tmp/ports-slug.png', fullPage: false });
  await browser.close();
  process.exit(0);
})();
