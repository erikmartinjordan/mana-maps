'use strict';
// ── scripts/lib/news-map-links.js ─
// Índice inverso News → mapa: cada artículo de News embebe un mapa en su
// <iframe> y ya enlaza su landing, pero las landings no devolvían el enlace.
// Este módulo lee los artículos (ES y EN), agrupa por slug del mapa embebido y
// genera el bloque «En las noticias» de la landing estática.
//
// La lógica de parseo y orden es pura (sin FS) para poder testearla; solo
// `readNewsArticles` toca disco.

const fs = require('fs');
const path = require('path');

const NEWS_DIRS = [
  { dir: ['news'], lang: 'es', prefix: '/news/' },
  { dir: ['en', 'news'], lang: 'en', prefix: '/en/news/' },
];

function decodeHtmlEntities(str) {
  return String(str == null ? '' : str)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Slug del mapa que embebe el artículo (primer <iframe> del visor).
function extractEmbeddedMapSlug(html) {
  const source = String(html == null ? '' : html);
  const iframe = source.match(/<iframe\b[^>]*\bsrc\s*=\s*"([^"]*)"/i);
  if (!iframe) return null;
  const src = decodeHtmlEntities(iframe[1]);
  const match = src.match(/[?&]gallery=([a-z0-9-]+)/i);
  return match ? match[1] : null;
}

// Titular del artículo: el primer <h1>, sin etiquetas internas.
function extractArticleTitle(html) {
  const source = String(html == null ? '' : html);
  const match = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) {
    const title = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (!title) return '';
    return decodeHtmlEntities(title[1]).replace(/\s+/g, ' ').trim();
  }
  return decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPublishedTime(html) {
  const source = String(html == null ? '' : html);
  const meta = source.match(/property\s*=\s*"article:published_time"\s+content\s*=\s*"([^"]*)"/i) ||
    source.match(/content\s*=\s*"([^"]*)"\s+property\s*=\s*"article:published_time"/i);
  if (!meta) return '';
  const parsed = Date.parse(meta[1]);
  return isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function sortArticles(a, b) {
  if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
  if (a.lang !== b.lang) return a.lang === 'es' ? -1 : 1;
  return a.article.localeCompare(b.article);
}

// Agrupa artículos por slug del mapa embebido. Devuelve un Map para que el
// generador consulte la landing en O(1). Los artículos sin mapa se descartan.
function buildNewsMapIndex(articles) {
  const index = new Map();
  for (const article of Array.isArray(articles) ? articles : []) {
    if (!article || !article.slug) continue;
    const list = index.get(article.slug) || [];
    list.push(article);
    index.set(article.slug, list);
  }
  for (const list of index.values()) list.sort(sortArticles);
  return index;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Bloque HTML de la landing. Los artículos en inglés llevan hreflang y una
// marca «EN» para que el lector sepa el idioma antes de hacer clic.
function newsLinksBlock(articles, opts) {
  const items = Array.isArray(articles) ? articles.filter((a) => a && a.href) : [];
  if (!items.length) return '';
  const title = (opts && opts.title) || 'En las noticias';
  const className = (opts && opts.className) || 'related related--news';
  const lis = items.map((a) => {
    // `lang` marca el idioma del destino para lectores de pantalla y para el
    // navegador; no se usa hreflang porque no son variantes de esta landing.
    const langAttr = a.lang === 'en' ? ' lang="en"' : '';
    const badge = a.lang === 'en' ? ' <span class="news-lang" aria-hidden="true">EN</span>' : '';
    return '<li><a href="' + escapeHtml(a.href) + '"' + langAttr + '>' +
      escapeHtml(a.title || a.article || 'Artículo') + '</a>' + badge + '</li>';
  }).join('');
  return '<section class="' + escapeHtml(className) + '" aria-label="' + escapeHtml(title) + '">' +
    '<h2>' + escapeHtml(title) + '</h2><ul>' + lis + '</ul></section>';
}

// Lee los artículos de los directorios de News indicados. `root` es la carpeta
// site/; cada entrada de `dirs` define la ruta relativa, el idioma y el prefijo
// público. Por defecto se leen site/news y site/en/news.
function readNewsArticles(root, dirs) {
  const siteRoot = root || path.join(__dirname, '..', '..', 'site');
  const sources = Array.isArray(dirs) && dirs.length ? dirs : NEWS_DIRS;
  const articles = [];
  for (const source of sources) {
    const dir = Array.isArray(source.dir) ? path.join(siteRoot, ...source.dir) : path.join(siteRoot, source.dir);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, 'index.html');
      let html = '';
      try {
        html = fs.readFileSync(file, 'utf8');
      } catch (e) {
        continue;
      }
      const slug = extractEmbeddedMapSlug(html);
      if (!slug) continue;
      articles.push({
        article: entry.name,
        lang: source.lang,
        href: source.prefix + entry.name + '/',
        title: extractArticleTitle(html),
        date: extractPublishedTime(html),
        slug,
      });
    }
  }
  return articles;
}

module.exports = {
  NEWS_DIRS,
  decodeHtmlEntities,
  extractEmbeddedMapSlug,
  extractArticleTitle,
  extractPublishedTime,
  buildNewsMapIndex,
  newsLinksBlock,
  readNewsArticles,
};
