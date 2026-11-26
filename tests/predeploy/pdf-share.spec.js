const { test, expect } = require('@playwright/test');

// Regresión de «Compartir en móvil» (BACKLOG): con Web Share API para
// archivos, el estudio comparte el PDF real (application/pdf, nombre y tamaño
// correctos); si el sistema lo rechaza cae en la descarga, y si el usuario
// cancela no se descarga nada. Sin soporte, el botón no aparece y la descarga
// sigue funcionando igual.

const EXTERNAL = /^https?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)/;

const GEO = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        _manaName: 'Europa',
        _manaColor: '#7fb3d5',
        Superficie: 42,
        Dato: 'Zona de prueba',
        _manaGroupName: 'Regiones',
        _manaGroupId: 'regiones',
        _manaLabelStyle: { enabled: true, field: '_manaName', haloWidth: 2 },
      },
      geometry: { type: 'Polygon', coordinates: [[[-10, 36], [30, 36], [30, 58], [-10, 58], [-10, 36]]] },
    },
    {
      type: 'Feature',
      properties: { _manaName: 'África', _manaColor: '#f0a868', Superficie: 31, Dato: 'Zona de prueba', _manaGroupName: 'Regiones', _manaGroupId: 'regiones' },
      geometry: { type: 'Polygon', coordinates: [[[-15, -30], [40, -30], [40, 30], [-15, 30], [-15, -30]]] },
    },
    {
      type: 'Feature',
      properties: { _manaName: 'Asia', _manaColor: '#c98474', Superficie: 27, Dato: 'Zona de prueba', _manaGroupName: 'Regiones', _manaGroupId: 'regiones' },
      geometry: { type: 'Polygon', coordinates: [[[45, -5], [140, -5], [140, 55], [45, 55], [45, -5]]] },
    },
  ],
};

// mode: 'ok' | 'reject' | 'abort' | 'none' (sin Web Share API)
async function bootPdfModal(page, mode) {
  await page.addInitScript((shareMode) => {
    window.__shared = [];
    function hide(name) {
      try { Object.defineProperty(Navigator.prototype, name, { value: undefined, configurable: true }); } catch (e) {
        try { Object.defineProperty(navigator, name, { value: undefined, configurable: true }); } catch (e2) {}
      }
    }
    if (shareMode === 'none') { hide('share'); hide('canShare'); return; }
    function define(name, value) {
      try { Object.defineProperty(Navigator.prototype, name, { value: value, configurable: true }); } catch (e) {
        Object.defineProperty(navigator, name, { value: value, configurable: true });
      }
    }
    define('canShare', (data) => !!(data && data.files && data.files.length));
    define('share', (data) => {
      const file = data && data.files && data.files[0];
      window.__shared.push({
        name: file && file.name,
        type: file && file.type,
        size: file && file.size,
        title: data && data.title,
      });
      if (shareMode === 'abort') {
        const err = new Error('cancelled');
        err.name = 'AbortError';
        return Promise.reject(err);
      }
      if (shareMode === 'reject') return Promise.reject(new Error('share unavailable'));
      return Promise.resolve();
    });
  }, mode);

  await page.route(EXTERNAL, (route) => route.abort());
  await page.goto('/404.html', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ url: '/css/pdf-export.css' });
  await page.evaluate((geo) => {
    window.__events = [];
    window.trackEvent = (name, params) => window.__events.push({ name, params });
    window.LANG = 'es';
    window.getProjectName = () => 'Mapa de prueba';
    window.getEnrichedGeoJSON = () => JSON.parse(JSON.stringify(geo));
  }, GEO);
  await page.addScriptTag({ url: '/js/pdf-export.js' });
  await page.evaluate(() => window.openPdfExport());
  await expect(page.locator('#pdfx-modal')).toBeVisible();
  await expect(page.locator('#pdfx-preview img')).toHaveCount(1, { timeout: 15_000 });
}

function events(page, name) {
  return page.evaluate((n) => window.__events.filter((e) => e.name === n), name);
}

test('shares the generated PDF through the Web Share API', async ({ page }) => {
  await bootPdfModal(page, 'ok');

  const share = page.locator('#pdfx-share');
  await expect(share).toBeVisible();
  await expect(share).toHaveText('Compartir PDF');

  await share.click();

  await expect(page.locator('#pdfx-status')).toHaveText('PDF compartido ✓');
  const shared = await page.evaluate(() => window.__shared);
  expect(shared).toHaveLength(1);
  expect(shared[0].type).toBe('application/pdf');
  expect(shared[0].name).toMatch(/-mana-maps\.pdf$/);
  expect(shared[0].size).toBeGreaterThan(1000);
  expect(shared[0].title).toBe('Mapa de prueba');

  await expect.poll(async () => (await events(page, 'export')).length).toBe(1);
  const [evt] = await events(page, 'export');
  expect(evt.params.format).toBe('pdf');
  expect(evt.params.via).toBe('share');
});

test('falls back to downloading when the share sheet rejects', async ({ page }) => {
  await bootPdfModal(page, 'reject');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#pdfx-share').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-mana-maps\.pdf$/);

  await expect(page.locator('#pdfx-status')).toHaveText('No se pudo compartir; PDF descargado ✓');
  await expect.poll(async () => (await events(page, 'export')).length).toBe(1);
  expect((await events(page, 'export'))[0].params.via).toBe('download');
  const [err] = await events(page, 'pdf_error');
  expect(err.params.stage).toBe('share');
});

test('cancelling the share sheet downloads nothing and leaves the modal open', async ({ page }) => {
  await bootPdfModal(page, 'abort');

  let downloads = 0;
  page.on('download', () => { downloads++; });

  await page.locator('#pdfx-share').click();
  await expect(page.locator('#pdfx-status')).toHaveText('Compartir cancelado.');
  expect(downloads).toBe(0);
  expect((await events(page, 'export')).length).toBe(0);
  await expect(page.locator('#pdfx-modal')).toBeVisible();
  await expect(page.locator('#pdfx-share')).toBeEnabled();
});

test('without Web Share API the button is hidden and the download still works', async ({ page }) => {
  await bootPdfModal(page, 'none');

  await expect(page.locator('#pdfx-share')).toBeHidden();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#pdfx-download').click();
  await downloadPromise;
  await expect(page.locator('#pdfx-status')).toHaveText('PDF descargado ✓');
  await expect.poll(async () => (await events(page, 'export')).length).toBe(1);
  expect((await events(page, 'export'))[0].params.via).toBe('download');
});
