'use strict';
// ── scripts/lib/related-maps.js ─
// Selección determinista de «mapas relacionados» para las landings estáticas
// (/gallery/<slug>/). Prioriza afinidad temática por tags (IDF) y garantiza
// que ningún mapa publicado quede sin enlaces internos entrantes: si un mapa
// no aparece en ninguna otra landing, se añade a la lista del mapa más afín.
//
// La lógica es pura (sin Firestore ni HTML) para poder testearla.

const DEFAULT_LIMIT = 4;
const DEFAULT_MAX_LINKS = 5;

function slugOf(map) {
  return map && (map.slug || map.id) ? String(map.slug || map.id) : '';
}

function normTag(tag) {
  return String(tag == null ? '' : tag).trim().toLowerCase();
}

function tagsOf(map) {
  return (map && Array.isArray(map.tags) ? map.tags : []).map(normTag).filter(Boolean);
}

function createdMs(map) {
  const raw = map && (map.createdAtMs || map.createdAt);
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function buildTagStats(maps) {
  const freq = {};
  for (const map of maps) {
    for (const tag of tagsOf(map)) freq[tag] = (freq[tag] || 0) + 1;
  }
  return { freq, total: maps.length || 1 };
}

// Una tag compartida y poco frecuente aporta más afinidad que una genérica.
function relatedScore(current, other, stats) {
  const currentTags = new Set(tagsOf(current));
  let score = 0;
  for (const tag of tagsOf(other)) {
    if (!currentTags.has(tag)) continue;
    score += Math.log(1 + stats.total / (stats.freq[tag] || 1));
  }
  return score;
}

function sortBySlug(a, b) {
  return slugOf(a).localeCompare(slugOf(b));
}

function pickThematic(current, others, stats, limit) {
  const currentSlug = slugOf(current);
  const scored = others
    .filter((m) => slugOf(m) && slugOf(m) !== currentSlug)
    .map((m) => ({ map: m, score: relatedScore(current, m, stats), created: createdMs(m) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.created !== a.created) return b.created - a.created;
      return sortBySlug(a.map, b.map);
    });

  const picked = scored.slice(0, limit).map((x) => x.map);
  const seen = new Set(picked.map(slugOf));

  // Fallback: completar con los mapas más recientes aún no elegidos.
  if (picked.length < limit) {
    const byRecency = others
      .filter((m) => slugOf(m) && slugOf(m) !== currentSlug && !seen.has(slugOf(m)))
      .sort((a, b) => {
        if (createdMs(b) !== createdMs(a)) return createdMs(b) - createdMs(a);
        return sortBySlug(a, b);
      });
    for (const map of byRecency) {
      if (picked.length >= limit) break;
      picked.push(map);
      seen.add(slugOf(map));
    }
  }
  return picked;
}

// Devuelve un Map slug -> [mapas relacionados]. `maxLinks` permite añadir un
// enlace extra durante la pasada de cobertura sin inflar demasiado el bloque.
function buildRelatedIndex(maps, opts) {
  const limit = (opts && opts.limit) || DEFAULT_LIMIT;
  const maxLinks = Math.max(limit, (opts && opts.maxLinks) || DEFAULT_MAX_LINKS);
  const list = (Array.isArray(maps) ? maps : [])
    .filter((m) => slugOf(m))
    .slice()
    .sort(sortBySlug);
  const stats = buildTagStats(list);
  const index = new Map();

  for (const current of list) {
    const currentSlug = slugOf(current);
    const others = list.filter((m) => slugOf(m) !== currentSlug);
    index.set(currentSlug, pickThematic(current, others, stats, limit));
  }

  const inbound = new Map(list.map((m) => [slugOf(m), 0]));
  for (const related of index.values()) {
    for (const map of related) {
      const slug = slugOf(map);
      inbound.set(slug, (inbound.get(slug) || 0) + 1);
    }
  }

  // Pasada de cobertura: ningún mapa publicado debe quedar sin enlaces
  // entrantes. Se añade al bloque del mapa temáticamente más afín.
  const uncovered = list
    .filter((m) => (inbound.get(slugOf(m)) || 0) === 0)
    .sort(sortBySlug);

  for (const target of uncovered) {
    const targetSlug = slugOf(target);
    const hosts = list
      .filter((m) => slugOf(m) !== targetSlug)
      .map((m) => ({ map: m, score: relatedScore(target, m, stats), created: createdMs(m) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.created !== a.created) return b.created - a.created;
        return sortBySlug(a.map, b.map);
      });

    let placed = false;
    for (const host of hosts) {
      const related = index.get(slugOf(host.map));
      if (!related) continue;
      if (related.some((m) => slugOf(m) === targetSlug)) {
        placed = true;
        break;
      }
      if (related.length < maxLinks) {
        related.push(target);
        inbound.set(targetSlug, (inbound.get(targetSlug) || 0) + 1);
        placed = true;
        break;
      }
    }
    // Salvaguarda: si todos los bloques están llenos, se añade igualmente al
    // primero (un enlace extra es preferible a un mapa huérfano).
    if (!placed && hosts.length) {
      const related = index.get(slugOf(hosts[0].map));
      if (related) {
        related.push(target);
        inbound.set(targetSlug, (inbound.get(targetSlug) || 0) + 1);
      }
    }
  }

  return index;
}

function relatedLinks(related, current) {
  const currentSlug = slugOf(current);
  const items = (Array.isArray(related) ? related : [])
    .filter((m) => slugOf(m) && slugOf(m) !== currentSlug);
  if (!items.length) return '';
  return '<section class="related"><h2>Más mapas</h2><ul>' +
    items.map((m) => '<li><a href="/gallery/' + encodeURIComponent(slugOf(m)) + '/">' +
      escapeHtml(m.title || m.name || 'Mapa') + '</a></li>').join('') +
    '</ul></section>';
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
  DEFAULT_LIMIT,
  DEFAULT_MAX_LINKS,
  buildRelatedIndex,
  relatedLinks,
  relatedScore,
  buildTagStats,
  slugOf,
};
