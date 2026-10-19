const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  await page.goto('http://127.0.0.1:4181/gallery/?firebaseEnv=pro', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card', { timeout: 45000 });
  await page.waitForTimeout(6000);
  const first = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.card')];
    const idx = cards.findIndex(c => (c.innerText||'').includes('puertos'));
    const c = cards[idx];
    return { idx, count: cards.length, text: c && c.innerText.slice(0,300), html: c && c.querySelector('.card-title') && c.querySelector('.card-title').textContent,
      thumb: !!(c && c.querySelector('canvas, img, svg')) };
  });
  console.log(JSON.stringify(first, null, 1));
  await page.screenshot({ path: '/tmp/gallery-list.png', fullPage: false });
  await browser.close();
  process.exit(0);
})();
