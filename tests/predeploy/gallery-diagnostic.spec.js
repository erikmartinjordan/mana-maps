const { test, expect } = require('@playwright/test');

const EXTERNAL_CDN = /^https?:\/\/(unpkg\.com|www\.gstatic\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/;

test('gallery diagnostic', async ({ page }) => {
  const pageErrors = [];
  const consoleMessages = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => consoleMessages.push(msg.type() + ': ' + msg.text()));

  await page.route(EXTERNAL_CDN, (route) => route.abort());
  await page.addInitScript(() => {
    delete window.MANA_FIREBASE_CONFIGS;
  });

  await page.goto('/gallery/', { waitUntil: 'domcontentloaded' });

  // Wait a bit for deferred scripts to execute
  await page.waitForTimeout(5000);

  // Check what's on the page
  const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 2000));
  console.log('=== BODY HTML (first 2000 chars) ===');
  console.log(bodyHTML);

  const hasEmptyTitle = await page.locator('.empty-title').count();
  console.log('.empty-title count:', hasEmptyTitle);

  const hasSkel = await page.locator('.skel').count();
  console.log('.skel count:', hasSkel);

  const hasGalleryList = await page.locator('#gallery-list').count();
  console.log('#gallery-list count:', hasGalleryList);

  const galleryListHTML = await page.evaluate(() => {
    const el = document.getElementById('gallery-list');
    return el ? el.innerHTML.substring(0, 1000) : 'NOT FOUND';
  });
  console.log('=== gallery-list innerHTML ===');
  console.log(galleryListHTML);

  console.log('=== PAGE ERRORS ===');
  console.log(pageErrors.join('\n'));

  console.log('=== CONSOLE MESSAGES ===');
  console.log(consoleMessages.join('\n'));

  const hasMaplibre = await page.evaluate(() => typeof window.maplibregl);
  console.log('typeof window.maplibregl:', hasMaplibre);

  const hasFirebase = await page.evaluate(() => typeof window.firebase);
  console.log('typeof window.firebase:', hasFirebase);

  const hasManaFirebase = await page.evaluate(() => typeof window.ManaFirebase);
  console.log('typeof window.ManaFirebase:', hasManaFirebase);

  const hasManaMapPreview = await page.evaluate(() => typeof window.ManaMapPreview);
  console.log('typeof window.ManaMapPreview:', hasManaMapPreview);
});
