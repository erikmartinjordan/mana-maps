const { test, expect } = require('@playwright/test');

// Regresión de la analítica anónima del estudio PDF (BACKLOG «Analítica
// anónima»): se mide apertura, plantilla, encuadre, descarga y error con
// parámetros no personales (plantilla, modo, booleanos y tramo de elementos).
// El título/slug del mapa, los textos y las coordenadas nunca deben viajar en
// el evento.

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

const SECRET_TITLE = 'Mapa secreto de Erik';

async function bootPdfModal(page, { geo = GEO } = {}) {
  await page.route(EXTERNAL, (route) => route.abort());
  await page.goto('/404.html', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ url: '/css/pdf-export.css' });
  await page.evaluate(
    ({ geo, secretTitle }) => {
      window.__events = [];
      window.trackEvent = (name, params) => window.__events.push({ name, params });
      window.LANG = 'es';
      window.getProjectName = () => secretTitle;
      // Doble de Leaflet: «Vista actual» necesita bounds reales.
      window.map = {
        getBounds: () => ({
          getWest: () => -12,
          getEast: () => 34,
          getSouth: () => 34,
          getNorth: () => 60,
        }),
      };
      window.getEnrichedGeoJSON = () => JSON.parse(JSON.stringify(geo));
    },
    { geo, secretTitle: SECRET_TITLE }
  );
  await page.addScriptTag({ url: '/js/pdf-export.js' });
  await page.evaluate(() => window.openPdfExport());
  await expect(page.locator('#pdfx-modal')).toBeVisible();
  await expect(page.locator('#pdfx-preview img')).toHaveCount(1, { timeout: 15_000 });
}

function events(page, name) {
  return page.evaluate((n) => window.__events.filter((e) => e.name === n), name);
}

test('opening the studio emits an anonymous pdf_open event', async ({ page }) => {
  await bootPdfModal(page);

  await expect.poll(async () => (await events(page, 'pdf_open')).length).toBe(1);
  const [open] = await events(page, 'pdf_open');
  expect(Object.keys(open.params).sort()).toEqual(['featureCount', 'labels', 'templates']);
  expect(open.params.featureCount).toBe('2-50');
  expect(open.params.templates).toBe(5);
  expect(typeof open.params.labels).toBe('boolean');

  // Sin datos identificables: ni título, ni slug, ni textos del mapa.
  const payload = await page.evaluate(() => JSON.stringify(window.__events));
  expect(payload).not.toContain(SECRET_TITLE);
  expect(payload).not.toContain('secreto');
  expect(payload).not.toContain('slug');
  expect(payload).not.toContain('Zona de prueba');
});

test('template and frame choices are measured', async ({ page }) => {
  await bootPdfModal(page);

  await page.locator('.pdfx-card[data-id="atlas"]').click();
  await expect.poll(async () => (await events(page, 'pdf_template')).length).toBe(1);
  expect((await events(page, 'pdf_template'))[0].params).toEqual({ template: 'atlas' });

  await page.locator('[data-frame="view"]').click();
  await expect(page.locator('#pdfx-frame-hint')).toHaveText('Se usará la zona visible en el editor.');
  await expect.poll(async () => (await events(page, 'pdf_frame')).length).toBe(1);
  expect((await events(page, 'pdf_frame'))[0].params).toEqual({ frame: 'view', requested: 'view' });

  // Región: el encuadre se mide al aplicar el rectángulo, no al abrir.
  await page.locator('[data-frame="region"]').click();
  const box = await page.locator('#pdfx-picker-map').boundingBox();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.72, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('[data-picker-apply]')).toBeEnabled();
  await page.locator('[data-picker-apply]').click();

  await expect.poll(async () => (await events(page, 'pdf_frame')).length).toBe(2);
  expect((await events(page, 'pdf_frame'))[1].params).toEqual({ frame: 'region', requested: 'region' });
});

test('a successful download emits the existing export event with the PDF setup', async ({ page }) => {
  await bootPdfModal(page);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#pdfx-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-mana-maps\.pdf$/);

  await expect.poll(async () => (await events(page, 'export')).length).toBe(1);
  const [evt] = await events(page, 'export');
  expect(evt.params.format).toBe('pdf');
  expect(evt.params.template).toBe('dossier');
  expect(evt.params.frame).toBe('fit');
  expect(evt.params.legend).toBe(true);
  expect(evt.params.labels).toBe(true);
  expect(evt.params.table).toBe(true);
  expect(evt.params.featureCount).toBe('2-50');
  expect(Number.isFinite(evt.params.durationMs)).toBe(true);
  expect(evt.params.durationMs).toBeGreaterThanOrEqual(0);

  await expect(page.locator('#pdfx-status')).toHaveText('PDF descargado ✓');
});

test('a failed download emits pdf_error and leaves the button usable', async ({ page }) => {
  await bootPdfModal(page);

  // Fuerza el fallo de la rasterización: el canvas no puede dar contexto.
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.locator('#pdfx-download').click();

  await expect.poll(async () => (await events(page, 'pdf_error')).length).toBe(1);
  const [err] = await events(page, 'pdf_error');
  expect(err.params.stage).toBe('download');
  expect(err.params.template).toBe('dossier');
  expect(err.params.frame).toBe('fit');
  expect(typeof err.params.reason).toBe('string');
  expect(err.params.reason.length).toBeLessThanOrEqual(40);
  await expect(page.locator('#pdfx-status')).toHaveText('No se pudo generar el PDF. Inténtalo de nuevo.');
  await expect(page.locator('#pdfx-download')).toBeEnabled();
});

test('opening the studio without features is measured as an error', async ({ page }) => {
  await page.route(EXTERNAL, (route) => route.abort());
  await page.goto('/404.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.__events = [];
    window.trackEvent = (name, params) => window.__events.push({ name, params });
    window.LANG = 'es';
    window.getProjectName = () => 'Mapa vacío';
    window.getEnrichedGeoJSON = () => ({ type: 'FeatureCollection', features: [] });
  });
  await page.addScriptTag({ url: '/js/pdf-export.js' });
  await page.evaluate(() => window.openPdfExport());

  await expect(page.locator('#pdfx-modal')).toBeHidden();
  expect((await events(page, 'pdf_open')).length).toBe(0);
  const [err] = await events(page, 'pdf_error');
  expect(err.params).toMatchObject({ stage: 'empty', template: 'none', frame: 'fit', reason: 'no-features' });
});
