#!/usr/bin/env node
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const MAP_URL = 'https://maña.com/map';
const PASSWORD = 'Buildings2024!';

async function publishMap(geojsonPath) {
  const geoRaw = fs.readFileSync(geojsonPath, 'utf8');
  let geo;
  try { geo = JSON.parse(geoRaw); } catch(e) { console.error('Invalid GeoJSON'); process.exit(1); }
  const featureCount = (geo.features && geo.features.length) || 0;
  // Extract title from file name or use a default
  let title = path.basename(geojsonPath, '.geojson')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  if (!title || title === 'Map') title = 'Untitled Map';
  // Enforce 40-char max like the app's input
  if (title.length > 40) title = title.substring(0, 37) + '...';

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(MAP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.leaflet-container', { timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.keyboard.press('Escape');

  // Import GeoJSON
  await page.evaluate((g) => {
    const fn = new Function('g', 'const geo = JSON.parse(g); return _importRestoredGeoJSON(geo);');
    return fn(g);
  }, geoRaw);
  await page.waitForTimeout(10000);

  // Set title
  await page.locator('#project-name-input').fill(title);
  await page.evaluate(() => map.setView([15, 10], 2.5, { animate: false }));
  await page.waitForTimeout(2000);

  // Create Firebase auth account
  const email = 'mana-pub-' + Date.now() + '@mailinator.com';
  await page.evaluate(
    (e) => firebase.auth().createUserWithEmailAndPassword(e, PASSWORD),
    email
  );
  await page.waitForTimeout(3000);

  // Generate unique slug and publish
  const slug = 'map-' + Date.now();
  const result = await page.evaluate((s) => {
    return new Promise(async (resolve) => {
      try {
        const geo = getEnrichedGeoJSON();
        const user = firebase.auth().currentUser;
        const origin = window.location.origin;
        const url = origin + '/map/?gallery=' + s + '&mode=view';
        const doc = {
          id: s, slug: s,
          title: document.getElementById('project-name-input').value || 'Untitled Map',
          createdBy: user.uid, ownerUid: user.uid,
          authorHandle: '', lang: 'en', featureCount: geo.features.length,
          visibility: 'public', shareMode: 'view', isPublished: true,
          shareUrl: url, geojsonText: JSON.stringify(geo),
          createdAtMs: Date.now(), updatedAtMs: Date.now(),
        };
        await firebase.firestore().collection('maps').doc(s).set(doc);
        resolve(url);
      } catch(e) { resolve('ERR:' + e.message); }
    });
  }, slug);

  await browser.close();

  if (result.startsWith('ERR:')) {
    console.error(result);
    process.exit(1);
  }
  console.log(result);
  return result;
}

// Run as CLI
if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node publish-map.js <geojson-file>');
    process.exit(1);
  }
  publishMap(file).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { publishMap };