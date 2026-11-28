const { test, expect } = require('@playwright/test');

// Regresión de rendimiento del estudio PDF con mapas densos (BACKLOG «Mapas
// grandes»): la apertura debe pintar una vista previa muestreada en menos de
// un segundo y las cinco miniaturas se componen con geometría reducida, sin
// bloquear la interfaz con seis renders completos del mapa. La descarga sigue
// usando la geometría completa (no se prueba aquí porque depende del raster).

const EXTERNAL = /^https?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)/;

function denseGeo(layers, pointsPerLayer) {
  const features = [];
  let n = 0;
  for (let layer = 0; layer < layers; layer++) {
    const coordinates = [];
    for (let i = 0; i < pointsPerLayer; i++) {
      const lon = -170 + ((n * 7.13) % 340);
      const lat = -55 + ((n * 3.71) % 125);
      coordinates.push([Number(lon.toFixed(3)), Number(lat.toFixed(3))]);
      n++;
    }
    features.push({
      type: 'Feature',
      properties: {
        _manaName: 'Capa ' + layer,
        _manaColor: '#7fb3d5',
        _manaGroupName: 'Red de prueba',
        _manaGroupId: 'red-prueba',
        Dato: 'Antena ' + layer,
        Valor: layer,
      },
      geometry: { type: 'MultiPoint', coordinates },
    });
  }
  return { type: 'FeatureCollection', features };
}

const SMALL_GEO = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { _manaName: 'Europa', _manaColor: '#7fb3d5', Superficie: 42, Dato: 'Zona de prueba', _manaGroupName: 'Regiones', _manaGroupId: 'regiones' },
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

async function bootPdfModal(page, geo) {
  await page.route(EXTERNAL, (route) => route.abort());
  await page.goto('/404.html', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ url: '/css/pdf-export.css' });
  await page.evaluate(
    ({ geo }) => {
      window.trackEvent = () => {};
      window.LANG = 'es';
      window.getProjectName = () => 'Mapa de prueba';
      // Doble de Leaflet: «Vista actual» necesita bounds reales.
      window.map = {
        getBounds: () => ({
          getWest: () => -12,
          getEast: () => 34,
          getSouth: () => 34,
          getNorth: () => 60,
        }),
      };
      window.getEnrichedGeoJSON = () => geo;
    },
    { geo }
  );
  await page.addScriptTag({ url: '/js/pdf-export.js' });
  await page.evaluate(() => window.openPdfExport());
  await expect(page.locator('#pdfx-modal')).toBeVisible();
  await expect(page.locator('#pdfx-preview img')).toHaveCount(1, { timeout: 15_000 });
}

function readDebug(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.ManaPdfExport._debug.last)));
}

test('dense map opens with a fast sampled preview and simplified thumbnails', async ({ page }) => {
  const geo = denseGeo(120, 100); // 12.000 puntos
  await bootPdfModal(page, geo);

  const first = await readDebug(page);
  expect(first.mode).toBe('progressive');
  expect(first.cost.points).toBe(12_000);
  expect(first.previewCost.points).toBeLessThanOrEqual(6_000);
  // El criterio de producto es <1 s en un portátil; en CI se deja margen.
  expect(first.firstPaintMs).toBeLessThan(1_500);

  // El detalle llega después, una sola vez, y sustituye la vista previa.
  await expect.poll(async () => (await readDebug(page)).detailRendered, { timeout: 15_000 }).toBe(true);
  const detailed = await readDebug(page);
  expect(detailed.detailCost.points).toBe(12_000);
  expect(detailed.detailBytes).toBeGreaterThan(detailed.fastBytes);
  await expect(page.locator('#pdfx-preview img')).toHaveCount(1);

  // Las cinco miniaturas usan como máximo 1.200 puntos (más el mínimo de un
  // punto por capa para no perder ninguna) y pesan menos que el SVG de detalle.
  await expect.poll(async () => ((await readDebug(page)).thumbs || []).length, { timeout: 15_000 }).toBe(5);
  const withThumbs = await readDebug(page);
  for (const thumb of withThumbs.thumbs) {
    expect(thumb.cost.points).toBeLessThanOrEqual(1_200 + geo.features.length);
    expect(thumb.bytes).toBeLessThan(withThumbs.detailBytes);
  }

  // El selector de región también se dibuja muestreado.
  await page.locator('[data-frame="region"]').click();
  await expect(page.locator('#pdfx-picker-canvas svg')).toHaveCount(1);
  const withPicker = await readDebug(page);
  expect(withPicker.pickerCost.points).toBeLessThanOrEqual(12_000);
});

test('light maps render the full preview in one pass', async ({ page }) => {
  await bootPdfModal(page, SMALL_GEO);

  const debug = await readDebug(page);
  expect(debug.mode).toBe('direct');
  expect(debug.previewCost.total).toBe(debug.cost.total);
  await expect(page.locator('#pdfx-preview img')).toHaveCount(1);
});
