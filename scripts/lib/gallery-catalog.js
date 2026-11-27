'use strict';
// ── scripts/lib/gallery-catalog.js ─
// Un documento de /maps se publica de dos formas distintas:
//
//   - Catálogo: isPublished === true y unlisted !== true. Es una tarjeta de la
//     galería y, como tal, necesita landing /gallery/<slug>/, OG card, entrada
//     en sitemap.xml, item en el JSON-LD CollectionPage y enlaces internos.
//   - Enlace compartido: isPublished === true y unlisted === true. Se abre por
//     URL (visor y /gallery/?slug=…) porque el documento es legible, pero no
//     se lista ni entra en la ficha editorial. Es el caso de «Compartir» del
//     editor: persistMapRecord marca siempre isPublished para permitir la
//     lectura pública y usa unlisted para ocultarlo de la galería, y la
//     regresión `tests/predeploy/gallery-smoke.spec.js` («gallery hides
//     unlisted share links but keeps them published by URL») fija ese
//     contrato.
//
// Las herramientas de catálogo (auditoría, landings/OG, sitemap, informe
// mensual, estilos de etiqueta) deben usar esta definición única: contar los
// enlaces compartidos como mapas publicados genera landings y entradas de
// sitemap para páginas que no se listan, y la auditoría los denuncia como
// deriva.

/** ¿Es una ficha del catálogo público (tarjeta de la galería)? */
function isListed(map) {
  return !!map && map.isPublished === true && map.unlisted !== true;
}

/** ¿Es un enlace compartido publicado pero fuera de la galería? */
function isSharedLink(map) {
  return !!map && map.isPublished === true && map.unlisted === true;
}

/** Separa una lista de documentos en catálogo y enlaces no listados. */
function splitCatalog(maps) {
  const all = Array.isArray(maps) ? maps : [];
  return {
    listed: all.filter(isListed),
    shared: all.filter(isSharedLink),
  };
}

module.exports = { isListed, isSharedLink, splitCatalog };
