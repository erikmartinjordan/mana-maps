const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WORDMARK_CLASSES = ['brand-word', 'logo-wordmark'];
const SUB_CLASSES = ['brand-sub', 'logo-sub'];
const ICON_CONTAINERS = ['brand-logo', 'mana-logo-icon'];
const CANONICAL = {
  'font-size': '18px',
  'font-weight': '800',
  'letter-spacing': '-0.02em'
};

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'og-cards', 'test-results'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(full);
  }
}

function normalize(svg) {
  return svg.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
}

function headerLogoInner(html) {
  for (const cls of ICON_CONTAINERS) {
    const anchor = html.indexOf(`class="${cls}"`);
    if (anchor === -1) continue;
    const vb = html.indexOf('viewBox="0 0 200 200"', anchor);
    if (vb === -1) continue;
    const start = html.indexOf('<path', vb);
    const end = html.indexOf('</svg>', vb);
    if (start === -1 || end === -1) continue;
    return normalize(html.slice(start, end));
  }
  return null;
}

function localStyleText(file) {
  const html = fs.readFileSync(file, 'utf8');
  let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const links = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)];
  for (const link of links) {
    const href = (link[0].match(/href=["']([^"']+)["']/) || [])[1];
    if (!href || /^https?:|^\/\//.test(href)) continue;
    const target = href.startsWith('/')
      ? path.join(ROOT, href.slice(1).split('?')[0])
      : path.resolve(path.dirname(file), href.split('?')[0]);
    if (fs.existsSync(target)) css += '\n' + fs.readFileSync(target, 'utf8');
  }
  return css;
}

function ruleFor(css, cls) {
  const match = css.match(new RegExp('\\.' + cls + '\\s*\\{([^}]*)\\}'));
  if (!match) return null;
  const decls = {};
  for (const part of match[1].split(';')) {
    const i = part.indexOf(':');
    if (i === -1) continue;
    decls[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return decls;
}

function norm(value) {
  return String(value).replace(/\s+/g, '').replace(/^-\./, '-0.');
}

test('every header logo renders the exact same Maña Maps mark and wordmark', async () => {
  const files = [];
  walk(ROOT, files);

  const canonical = headerLogoInner(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  expect(canonical, 'canonical logo not found in index.html').toBeTruthy();

  const problems = [];
  let checked = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const html = fs.readFileSync(file, 'utf8');
    const inner = headerLogoInner(html);
    if (!inner) continue;
    checked++;

    if (inner !== canonical) problems.push(`${rel}: icon mark differs from index.html`);

    const wordmark = WORDMARK_CLASSES.find((cls) => html.includes(`class="${cls}"`));
    if (!wordmark) { problems.push(`${rel}: header logo has no wordmark class`); continue; }
    const fontLink = (html.match(/fonts\.googleapis\.com\/css2\?[^"']*DM\+Sans[^"']*/) || [])[0];
    if (fontLink && !/800/.test(fontLink)) problems.push(`${rel}: la fuente DM Sans del logo no carga el peso 800`);
    const sub = SUB_CLASSES.find((cls) => html.includes(`class="${cls}"`));
    const css = localStyleText(file);

    const wordDecls = ruleFor(css, wordmark);
    if (!wordDecls) problems.push(`${rel}: missing .${wordmark} rule`);
    else for (const [prop, expected] of Object.entries(CANONICAL)) {
      const got = wordDecls[prop];
      if (!got || norm(got) !== norm(expected)) {
        problems.push(`${rel}: .${wordmark} ${prop} = ${got || '(none)'} (esperado ${expected})`);
      }
    }

    if (sub) {
      const subDecls = ruleFor(css, sub);
      if (!subDecls || norm(subDecls['font-size']) !== '11px') {
        problems.push(`${rel}: .${sub} font-size = ${subDecls && subDecls['font-size'] || '(none)'} (esperado 11px)`);
      }
    }

    const icon = ICON_CONTAINERS.map((cls) => ruleFor(css, cls)).find(Boolean);
    if (icon && norm(icon.width) !== '36px') {
      problems.push(`${rel}: icono ${icon.width} (esperado 36px)`);
    }
  }

  if (/M&#771;|class="brand-wordmark"/.test(files.map((f) => fs.readFileSync(f, 'utf8')).join('\n'))) {
    problems.push('queda markup legado del logo (span M̃ o .brand-wordmark)');
  }

  expect(checked).toBeGreaterThan(40);
  expect(problems, `Inconsistencias de logo:\n${problems.join('\n')}`).toEqual([]);
});
