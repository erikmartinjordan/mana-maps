const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const changelogFile = path.join(repoRoot, 'site', 'changelog', 'index.html');

// Reproduce en Node la fecha local que usa el script para decidir el corte,
// para construir etiquetas de prueba («26 de noviembre de 2026»).
const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function dayLabel(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getDate()} de ${MONTHS_ES[date.getMonth()]} de ${date.getFullYear()}`;
}

function fixtureHtml(labels) {
  const groups = labels.map((label) => (
    `<div class="day-group"><div class="day-label">${label}</div>`
    + '<div class="entry"><div class="entry-title">entrada</div></div></div>'
  )).join('');
  return `<!DOCTYPE html><html lang="es"><body>
    <div class="timeline" id="timeline">${groups}</div>
    <div class="timeline-more">
      <button type="button" class="timeline-more__btn" id="timeline-more" hidden aria-expanded="false" aria-controls="timeline">Ver más</button>
    </div>
  </body></html>`;
}

async function bootFixture(page, labels) {
  await page.goto('/changelog/', { waitUntil: 'domcontentloaded' });
  await page.setContent(fixtureHtml(labels));
  await page.addScriptTag({ url: '/js/changelog-timeline.js' });
}

async function hiddenFlags(page) {
  return page.$$eval('#timeline .day-group', (groups) => groups.map((group) => group.hidden));
}

test('changelog shows only the last 7 days by default and expands without reloading', async ({ page }) => {
  await page.goto('/changelog/', { waitUntil: 'domcontentloaded' });

  const groups = page.locator('#timeline .day-group');
  const total = await groups.count();
  expect(total).toBeGreaterThan(1);

  const button = page.locator('#timeline-more');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toContainText('Ver más');
  await expect(page.locator('#timeline')).toHaveAttribute('data-expanded', 'false');

  // Todos los días visibles caen dentro de la ventana semanal (o es el fallback
  // de una página sin entradas recientes, que solo deja el día más nuevo).
  const visibility = await page.evaluate(() => {
    const api = window.ManaChangelogTimeline;
    const cutoff = api.weeklyCutoff(api.startOfTodayUtc());
    const items = Array.from(document.querySelectorAll('#timeline .day-group')).map((group) => ({
      hidden: group.hidden,
      date: api.parseDayLabel(group.querySelector('.day-label').textContent),
    }));
    return { cutoff, items };
  });
  const visible = visibility.items.filter((item) => !item.hidden);
  expect(visible.length).toBeGreaterThan(0);
  for (const item of visible) {
    expect(item.date).toBeGreaterThanOrEqual(visibility.cutoff);
  }
  const hidden = visibility.items.filter((item) => item.hidden);
  for (const item of hidden) {
    expect(item.date).toBeLessThan(visibility.cutoff);
  }

  await button.click();
  await expect(page.locator('#timeline .day-group:not([hidden])')).toHaveCount(total);
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(button).toContainText('Ver menos');

  await button.click();
  await expect(page.locator('#timeline .day-group[hidden]')).toHaveCount(hidden.length);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toContainText('Ver más');
});

test('weekly cutoff keeps days 0-6 and hides older ones', async ({ page }) => {
  await bootFixture(page, [dayLabel(0), dayLabel(3), dayLabel(6), dayLabel(7), dayLabel(40)]);

  await expect(page.locator('#timeline-more')).toBeVisible();
  expect(await hiddenFlags(page)).toEqual([false, false, false, true, true]);

  await page.locator('#timeline-more').click();
  expect(await hiddenFlags(page)).toEqual([false, false, false, false, false]);
});

test('a page without recent entries keeps the newest day visible', async ({ page }) => {
  await bootFixture(page, [dayLabel(20), dayLabel(45), dayLabel(200)]);

  expect(await hiddenFlags(page)).toEqual([false, true, true]);
});

test('changelog expansion is keyboard accessible and honours reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootFixture(page, [dayLabel(1), dayLabel(30)]);

  const button = page.locator('#timeline-more');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#timeline .day-group.is-entering')).toHaveCount(0);
  expect(await hiddenFlags(page)).toEqual([false, false]);
});

test('changelog labels follow the page language, not the stored one', async ({ page }) => {
  // La página es solo española: una preferencia EN guardada en otra página no
  // debe dejar el botón en inglés sobre un historial en español.
  await page.addInitScript(() => localStorage.setItem('mana-lang', 'en'));
  await page.goto('/changelog/', { waitUntil: 'domcontentloaded' });

  const button = page.locator('#timeline-more');
  await expect(button).toContainText('Ver más');
  await expect(button).toHaveAttribute('aria-label', 'Ver las entradas anteriores a los últimos 7 días');

  await button.click();
  await expect(button).toContainText('Ver menos');
});

test('changelog keeps the full history in the static HTML for SEO and no-JS users', () => {
  const html = fs.readFileSync(changelogFile, 'utf8');
  const dayGroups = (html.match(/class="day-group"/g) || []).length;
  expect(dayGroups).toBeGreaterThan(1);
  expect(html).not.toMatch(/class="day-group"[^>]*hidden/);
  expect(html).toContain('<div class="timeline" id="timeline">');
  expect(html).toMatch(/<button[^>]*id="timeline-more"[^>]*hidden/);
  expect(html).toContain('<script src="/js/changelog-timeline.js"></script>');
});
