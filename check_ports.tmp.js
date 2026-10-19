const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4176/gallery/?slug=busiest-ports-world', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(15000);
  const info = await page.evaluate(() => ({
    legend: document.querySelector('#slug-legend, .legend, #legend, .map-legend') ? document.querySelector('#slug-legend, .legend, #legend, .map-legend').innerText.slice(0,300) : null,
    legendHtml: document.querySelector('#slug-legend') ? document.querySelector('#slug-legend').outerHTML.slice(0,600) : null,
    canvases: document.querySelectorAll('canvas').length,
    slugWrap: !!document.querySelector('#slug-map'),
    bodyText: document.body.innerText.slice(0, 400)
  }));
  console.log(JSON.stringify(info, null, 1));
  console.log('ERRORS', errors.slice(0,5));
  await browser.close();
  process.exit(0);
})();
