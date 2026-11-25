# BACKLOG

> Guardarraíles de producto (ver `AGENTS.md`): no reintroducir «Mapas para descubrir», descripciones/fuente visibles en las tarjetas de la galería, bloques de «Caso de uso» en News, enlaces relacionados en el pie de los artículos ni el índice de mapas de la galería.


- [ ] **Cancelar y cerrar deben dejar estado limpio**. Comprobar que `Cancelar`
  en el selector restaura plantilla, encuadre y opciones previas; que cerrar el
  modal revoca blob URLs, aborta generaciones en curso y no deja `state.picker`,
  `state.region` ni listeners colgados. Criterio: abrir/cerrar 10 veces no
  acumula memoria ni deja el mapa del editor en blanco.

- [ ] **Mapas grandes (1.000–10.000 features)**. Medir con `antenas-moviles-espana`
  y mapas de puntos densos: al abrir se construyen 5 previews SVG completos y el
  selector reconstruye el mapa entero, lo que puede congelar la UI. Proponer
  previews bajo demanda, miniatura simplificada, límite de puntos/etiquetas,
  rasterizado progresivo o Web Worker. Criterio: abrir el modal <1 s y descargar
  sin bloquear la interfaz en un portátil y en móvil.

- [ ] **Fallbacks de generación**. Si fallan `canvas.toDataURL`, `URL.createObjectURL`,
  la carga del SVG o el canvas por memoria (Safari/iOS), mostrar un error claro
  y ofrecer alternativa: PNG, imprimir o reintentar con menos resolución.
  Criterio: el botón nunca queda bloqueado y el estado se anuncia.

- [ ] **Robustez de datos de entrada**: mapas con 0/1 feature, capas ocultas,
  colores inválidos, coordenadas fuera de rango, features agrupadas y mapas
  importados sin `_manaLabelStyle`. Criterio: nunca se genera un PDF en blanco
  sin explicación; se avisa y se ofrece un fallback.

- [ ] **Tests Playwright de la feature**. Cubrir abrir modal, cambiar plantilla,
  alternar Leyenda/Etiquetas/Tabla, aplicar Región, usar Vista actual, descargar
  y comprobar nombre y tamaño >0. Incluir 0/1 feature, puntos con emoji,
  polígonos, mapa oculto y cancelación. Criterio: regresión en
  `tests/predeploy/` sin depender de Firestore real.

- [ ] **Tooltip cuidado en las acciones de cada capa**. Sustituir los `title`
  nativos de los botones de la fila de acciones de cada capa (ocultar/mostrar,
  estilo, etiquetas, filtro, tabla de atributos, zoom y eliminar) por un tooltip
  propio con el mismo lenguaje visual que los de las tarjetas de mapa base
  «Mapa», «Satélite» y «Globo 3D» (`#basemap-stack .bm-tip`: superficie del
  tema, borde fino, sombra suave, entrada con fade/scale y ligero retardo,
  salida inmediata). Reutilizar el patrón existente o extraer un helper común
  para no duplicar lógica; colocar el tooltip arriba o abajo según el espacio
  disponible y evitar que se recorte en el panel estrecho. Criterio: aparece con
  hover y con `focus-visible`, desaparece al salir o con Escape, no tapa otros
  controles ni el propio botón, funciona en ES/EN y en tema claro/oscuro, no
  queda pegado tras un tap en táctil, respeta `prefers-reduced-motion` y
  conserva los `aria-label` sin duplicar anuncios en lector de pantalla.

- [ ] **Cambiar el color de relleno de las capas de polígono**. Hoy
  `ctxSetColor`/`lctxSetColor` solo aplican `color` (el borde) a las capas que
  no son marcadores, así que el relleno de un polígono no se puede cambiar
  desde la UI: `fillColor` y `_manaColor` quedan con el valor importado y el
  selector de color solo modifica `_manaBorderColor`. Añadir un control de
  relleno separado del borde (y, si encaja, opacidad de relleno) tanto en el
  menú contextual de una capa como en el de grupo, actualizando `fillColor`,
  `_manaColor` y `_manaBorderColor` con `setStyle`, sincronizando
  `_manaGroupMeta[gid].color` con el color principal, el punto del panel, la
  leyenda y el globo 3D (`refreshGlobeLayers`), y exportando los valores en
  `getEnrichedGeoJSON`. Criterio: se puede elegir relleno y borde por separado,
  ambos persisten al guardar/reabrir y se ven igual en 2D y 3D; las líneas
  siguen usando un único color de trazo y los puntos su color de marcador; hay
  regresión Playwright de estilo de polígono.

- [ ] **Renombrar una capa con doble clic**. Permitir editar el nombre de la
  capa haciendo doble clic sobre el título del grupo en el panel de capas, con
  edición inline (input sobre el nombre, Enter/blur confirma, Escape cancela,
  selección completa del texto al abrir). Evitar que el doble clic active o
  colapse la capa, que interfiera con el drag & drop o con el clic simple para
  marcar la capa activa; actualizar `_manaGroupMeta[gid].name` y el
  `_manaGroupName` de todas las features del grupo para que el nuevo nombre se
  exporte y aparezca en leyendas/popups. Criterio: nombre vacío no se aplica,
  longitud razonable, `pushUndo` y `saveState`, accesible por teclado, funciona
  en ES/EN y en tema claro/oscuro, y no rompe el orden ni la selección activa.

- [ ] **Elegir el tipo de geometría al crear una capa vacía**. Al pulsar
  «Nueva capa», preguntar si la capa será de **puntos**, **líneas** o
  **polígonos** (con opción explícita de cancelar) antes de crearla, usando el
  `geometryType` que ya acepta `createNewLayer(name, geometryType)`. Aplicar el
  tipo a la capa activa para que las herramientas de dibujo incompatibles no
  añadan geometrías mezcladas al mismo grupo (o creen/avisen de una capa
  compatible), y reflejarlo en el icono y el resumen del panel. Criterio: la
  elección se conserva al dibujar, se ve el icono correcto, no se puede dibujar
  un polígono dentro de una capa de puntos sin aviso, funciona en ES/EN y
  mantiene el flujo actual para capas creadas al vuelo desde una herramienta
  concreta.

- [ ] **Changelog con las tareas de la última semana y botón «Ver más»**.
  En `/changelog/`, mostrar por defecto solo las entradas de los últimos 7 días
  y añadir un botón «Ver más» que vaya revelando el resto sin recargar la
  página (y su opuesto «Ver menos» si aplica). El HTML completo debe seguir en
  el documento para SEO y para usuarios sin JavaScript; ocultar el resto con
  JS/clase, no eliminarlo del DOM, y mantener el agrupado por días, las horas,
  los enlaces a commits y el i18n ES/EN. Criterio: la primera vista muestra solo
  la última semana, «Ver más» revela el resto de forma accesible
  (`aria-expanded`, foco controlado, `prefers-reduced-motion`), el estado es
  coherente al cambiar de idioma, funciona con el generador
  `.github/scripts/generate_changelog.py` sin tocar su salida y hay una
  regresión Playwright que comprueba el corte semanal y la expansión.

- [ ] **Unificar el selector de idioma entre todas las páginas públicas**. Hoy
  conviven dos implementaciones: la portada tiene su propio `LANG`/`applyLang`
  inline en `site/index.html`, mientras que `/gallery/`, `/pricing/`, `/news/` y
  las landings usan `site/js/i18n.js`; el botón también cambia de markup
  (`#lang-btn` con texto directo en la home, `.tb-lang-label` en el resto). Al
  cambiar de idioma y navegar aparecen etiquetas, `aria-label`, títulos o
  textos sin traducir/desactualizados. Migrar la portada a `i18n.js` (o extraer
  un módulo común) con una única clave de persistencia (`mana-lang`), un único
  `applyTranslations`, un único patrón de botón/aria y el evento
  `mana:langchange`; comprobar `html[lang]`, `<title>`, meta sociales, footer,
  cabecera y selector tras navegar `/` → `/gallery/` → `/pricing/` → `/news/` →
  landing y volver. Criterio: el idioma elegido se mantiene y la UI es idéntica
  en todas las páginas, sin parpadeos ni cadenas en el idioma anterior. Añadir
  regresión Playwright de navegación entre páginas en ES/EN.

- [ ] **Mismo menú superior en `/gallery/` que en la portada**. La galería usa
  hoy un `.topbar` propio con «Menú / Inicio / Mis mapas / Crear mapa» y estilos
  distintos, mientras la portada usa `.masthead` con «News / Changelog /
  Precios / Menú / Abrir app». Extraer el menú de la portada a un componente
  compartido (`site-navbar`/`masthead`) y reutilizarlo en `/gallery/` y en el
  resto de páginas públicas, decidiendo dónde encajan «Mis mapas» y «Crear
  mapa» (por ejemplo, en el panel «Menú») y conservando las acciones de sesión
  si las hay. Criterio: misma jerarquía visual, orden de enlaces, hover/focus,
  comportamiento del menú móvil, `aria-label` y estilos a 320 px y escritorio;
  una sola fuente de verdad para el CSS/HTML de la cabecera.

- [ ] **Auditar el estudio PDF contra el design system de la app**. El modal usa
  hoy una superficie de papel cálido con tokens propios (`--pdfx-*`) que no
  coinciden con el editor (grafito, `--blue`, `--surface`, `--border`,
  `--radius`). Comparar lado a lado con los modales existentes (auth, compartir,
  selector de marcadores, tutorial), decidir si «papel/estudio de impresión» es
  una superficie intencional y documentada o debe heredar el tema del editor, y
  alinear tipografía, escala, radios, sombras, iconografía, estados hover/focus
  y espaciado. Criterio: revisión visual lado a lado sin colores hardcodeados
  fuera de tokens y con dark/light coherentes.

- [ ] **Reutilizar componentes y patrones existentes**. Extraer del modal los
  botones, segmented control, checkboxes, tarjetas y cabecera a piezas
  compartidas (o a CSS con los mismos nombres/tokens que la app) para que no
  derive con el tiempo; revisar que el foco, el `disabled`, el estado `loading`
  y los tamaños móviles sigan los mismos patrones que el resto del editor.
  Criterio: el HTML/CSS del modal no reinventa controles que ya existen.

- [ ] **Definir y documentar la identidad del estudio PDF**. Si se mantiene la
  estética editorial de papel, documentar en `docs/` sus reglas (paleta,
  tipografía, uso del logo oficial, márgenes, jerarquía, tono de los textos) y
  cómo convive con el tema oscuro; si se descarta, migrar todo a tokens del
  editor. Criterio: una persona nueva puede replicar el diseño sin adivinar.

- [ ] **Coherencia de copy, iconos y microinteracciones**. Revisar nombres
  («Encuadre», «Región», «Vista actual», «Plantillas»), iconos y transiciones
  para que hablen el mismo idioma que la app; añadir `aria-live` y estados
  vacíos/error con el mismo tono. Criterio: el modal se siente parte del
  producto y no una pantalla incrustada.

- [ ] **Generar el PDF con geometría y texto vectoriales**. Hoy cada página se
  rasteriza a JPEG y al hacer zoom se ven los píxeles. Migrar a un pipeline que
  escriba primitivas PDF (paths para polígonos/líneas, rectángulos para tarjetas
  y leyendas, texto con fuentes embebidas) o usar `svg2pdf`/jsPDF con soporte de
  `clipPath`, gradientes y fuentes. Los emoji/marcadores deben convertirse a SVG
  del catálogo `js/markers.js` o a imágenes de alta resolución, no depender de
  la fuente del sistema. Criterio: al 800 % el mapa, las etiquetas, las guías y
  la tabla se ven nítidos; el texto es seleccionable/buscable y el PDF pesa
  menos que el raster equivalente.

- [ ] **Fuentes y tildes**. Embeber DM Sans/DM Mono (o usar una fuente estándar
  con soporte Latin-1) y verificar acentos, ñ, «·», «—» y comillas en todas las
  plantillas; evitar que el PDF dependa de fuentes instaladas en el sistema.
  Criterio: mismo texto en macOS, Windows, Linux e iOS sin caracteres corruptos.

- [ ] **Optimización de geometría para vectores**. Un mapa de 205 polígonos o
  10.000 puntos puede generar un PDF enorme. Simplificar por escala de página
  (Douglas-Peucker con tolerancia ligada al tamaño impreso), eliminar anillos
  diminutos, deduplicar paths y limitar puntos/labels por página sin perder
  topología. Criterio: PDF <10 MB por página en los mapas más densos y tiempo de
  generación aceptable.

- [ ] **Raster de respaldo de alta calidad**. Si algún efecto no se puede
  vectorizar (sombras, texturas, emoji), usar PNG/300 DPI en lugar de JPEG para
  las zonas rasterizadas y mantener el resto vectorial; ofrecer un selector
  «Vectorial / Alta calidad (300 DPI) / Borrador». Criterio: no hay texto
  borroso ni artefactos JPEG en impresión.

- [ ] **Metadatos y preparación para imprenta**. Añadir título, autor, asunto,
  palabras clave y fecha al PDF; valorar marcas de corte, sangrado, tamaño exacto
  de página y perfil de color. Criterio: el PDF se imprime al 100 % sin recortes
  y los metadatos son correctos.

- [ ] **Pruebas de fidelidad**. Tests automatizados que comparen dimensiones de
  página, número de páginas, presencia de texto y que el mapa no esté vacío;
  prueba manual al 400–800 % en visor de PDF y en impresión. Criterio: no vuelve
  a colarse una página rasterizada o borrosa sin detectarse.

- [ ] **Selector de región más preciso**: zoom/pan con rueda y doble clic,
  controles +/−, reinicio y asas para redimensionar el rectángulo existente
  (hoy solo se puede dibujar uno nuevo). Criterio: seleccionar una isla o una
  provincia pequeña sin tener que ampliar el mapa del editor.

- [ ] **Guía de aspecto y área segura según la plantilla**. Mostrar en el
  selector el marco de la página (A4 vertical/horizontal, póster) y avisar si
  el recorte dejará márgenes o se recortará al aplicar la plantilla. Criterio:
  el encuadre seleccionado coincide visualmente con el PDF final.

- [ ] **Encuadre por capa/grupo**: añadir un desplegable «Ajustar a…» con los
  bounds de cada `_manaGroupName` visible, además de Todo / Vista actual /
  Región. Criterio: exportar solo los volcanes o solo un grupo sin dibujar el
  rectángulo a mano.

- [ ] **Actualizar la vista sin cerrar el modal**: botón «Capturar vista actual»
  que lea `map.getBounds()` en ese momento, o permitir minimizar el modal para
  ajustar el mapa y volver. Criterio: Vista actual no depende de haber hecho
  zoom antes de abrir el diálogo.

- [ ] **Región persistente y visible**: conservar la región al cambiar de
  plantilla u opciones y mostrar un chip con el encuadre activo y un botón para
  limpiarlo. Criterio: cambiar de Dossier a Atlas no pierde el zoom elegido.

- [ ] **Criterio de datos en el borde de la región**. Definir si un polígono que
  cruza el recorte cuenta entero o solo la parte visible para leyenda, tabla y
  KPIs; hoy se incluye si intersecta. Documentarlo en el modal y aplicar el
  mismo criterio a etiquetas. Criterio: los totales del PDF son explicables.

- [ ] **Antimeridiano y mapas oceánicos/polares**. Probar regiones que cruzan
  ±180, vistas con wrap y mapas de puntos en el Pacífico; evitar rectángulos
  que abarcan el mundo entero al seleccionar cerca del borde. Criterio: el
  encuadre y el filtrado de datos son correctos en esos casos.

- [ ] **Densidad de etiquetas controlable**: Ninguna / Automática / Todas, o un
  slider, con prioridad por valor o superficie. Hoy el límite es fijo (60–80)
  y se descartan etiquetas sin explicar por qué. Criterio: el usuario entiende
  y controla cuántas etiquetas aparecen.

- [ ] **Anti-solapamiento real**: evitar también el solapamiento con
  marcadores/emoji, no solo entre textos; medir el ancho real con
  `measureText`/canvas y, si hace falta, usar guías o leader lines. Criterio:
  ninguna etiqueta tapa un icono o queda ilegible en clusters.

- [ ] **Etiquetas solo dentro de la región**: filtrar las features por el
  encuadre antes de rotular, evitar textos cortados en el borde y repetir el
  nombre en multipolígonos con criterio. Criterio: el PDF no muestra etiquetas
  de elementos que no se ven.

- [ ] **Respetar `_manaLabelStyle`**: tamaño, color, halo, familia y `enabled`
  por grupo; si el usuario desactiva etiquetas en el editor, el PDF no debe
  reactivarlas por defecto sin avisar. Criterio: el PDF coincide con la vista
  del editor.

- [ ] **Topónimos en español**: usar `_manaName`/`País` en mapas `lang:es` y
  abreviar nombres largos con criterio («Rep. Dem. del Congo»). Criterio: no
  vuelven a aparecer «United States of America» ni etiquetas en inglés.

- [ ] **Marcadores vectoriales en el PDF**: sustituir el emoji del sistema por
  el SVG del catálogo `js/markers.js` para que el resultado sea idéntico en
  macOS, Windows, Linux e iOS y no dependa de la fuente de emoji. Criterio:
  mismo icono y tamaño relativo que en el editor.

- [ ] **Callouts manuales (líneas de guía)**. Añadir una capa de anotaciones
  independiente de las etiquetas: elegir una feature desde una lista o haciendo
  clic en el preview, escribir el texto del callout, situar la etiqueta y el
  ancla, elegir lado (izquierda/derecha/arriba/abajo) y estilo de línea (recta,
  codo, punteada), halo, color y tamaño. Debe poder editarse, ocultarse y
  borrarse. Criterio: se pueden añadir 2–5 callouts a un mapa sin tocar el
  GeoJSON ni el editor y aparecen en el PDF en la misma posición.

- [ ] **Callouts automáticos para los valores destacados**. Reutilizar y
  generalizar la lógica de guías en L de `site/js/share-card.js` para proponer
  callouts de los N valores más altos (o más bajos) de la clave de leyenda, con
  colocación inteligente a izquierda/derecha, límite configurable y opción de
  aceptar, editar o descartar cada uno. Criterio: un mapa coroplético genera
  callouts legibles sin solaparse con etiquetas, leyenda o tabla.

- [ ] **Anti-colisión y jerarquía de anotaciones**. Resolver el solapamiento
  entre callouts, etiquetas, marcadores y bordes de la página; priorizar
  callouts manuales sobre automáticos y ofrecer guías/leader lines cuando la
  etiqueta no quepa cerca del punto. Criterio: ninguna anotación tapa otra ni
  queda fuera del área imprimible.

- [ ] **Callouts vectoriales y accesibles**. Exportar líneas, puntos y texto de
  los callouts como vectores (no imágenes), con texto seleccionable y nombres
  accesibles; permitir moverlos con teclado y anunciar el estado en el modal.
  Criterio: al hacer zoom los callouts siguen nítidos y se pueden revisar sin
  ratón.

- [ ] **Persistencia y plantillas de anotación**. Guardar los callouts junto con
  la configuración de exportación (localmente y, si aplica, en el mapa) para
  reutilizarlos al reabrir el PDF; permitir guardar un «set» de callouts como
  plantilla. Criterio: cerrar y reabrir el modal no pierde las anotaciones.

- [ ] **Más plantillas y formatos**: informe de 2 páginas con portada, A5,
  Carta/Tabloide y «solo mapa». Reutilizar el motor actual y añadir selector de
  tamaño y orientación. Criterio: elegir formato sin romper el encuadre.

- [ ] **Metadatos editables en el modal**: título, subtítulo, descripción,
  fuente, año y autor; toggles para logo, leyenda, tabla, notas, QR y escala.
  Recordar las preferencias del usuario. Criterio: se puede ajustar el PDF sin
  editar el nombre del proyecto ni las propiedades del mapa.

- [ ] **QR y atribución**: QR al mapa interactivo (`/gallery/?slug=…` o URL
  actual) y línea de crédito/fuente; opción de ocultarlo. Criterio: el PDF
  impreso lleva al mapa vivo sin depender de escribir una URL.

- [ ] **Calidad de impresión**: opción 150/300 DPI, metadatos del PDF
  (título/autor/asunto), marcas de corte/sangrado y, si es viable, texto
  vectorial en lugar de página rasterizada. Criterio: texto nítido a tamaño
  real y peso razonable (<10 MB por página).

- [ ] **Modo B/N y alto contraste**: plantilla imprimible en blanco y negro y
  revisión de contraste WCAG de leyendas/tablas. Criterio: legible en
  impresora láser y para baja visión.

- [ ] **Miniaturas y peso estimado**: previews reales perezosas con skeleton,
  sin bloquear, y mostrar número de páginas y peso estimado antes de descargar.
  Criterio: el usuario sabe qué va a obtener y cuánto tarda.

- [ ] **Accesibilidad del modal y del selector**: focus trap, devolver el foco a
  `Exportar`, `aria-live` para el estado, navegación por teclado en el selector
  (flechas para mover/redimensionar) y `prefers-reduced-motion`. Criterio: todo
  el flujo se completa sin ratón.

- [ ] **i18n completa**: fechas, números, tamaños de papel, nombres de
  plantillas y textos de estado en ES/EN; respetar `lang` del mapa para los
  topónimos. Criterio: no se mezclan idiomas en el PDF ni en el modal.

- [ ] **PDF en la vista pública y en compartir**: añadir la descarga PDF a
  `/gallery/?slug=…` junto a PNG y a las opciones de compartir, con las mismas
  plantillas/encuadre. Criterio: el visitante puede descargar sin pasar por el
  editor. Valorar antes si es gratis o Pro (decisión de producto).

- [ ] **Compartir en móvil**: `navigator.share` para el PDF cuando el
  navegador lo soporte, con descarga como fallback. Criterio: en iOS/Android se
  puede enviar el PDF a Archivos/Correo/Mensajes.

- [ ] **Analítica anónima**: eventos de apertura, plantilla, encuadre,
  descarga y error (sin datos personales) para priorizar mejoras. Criterio: se
  puede medir qué plantilla y qué modo de encuadre se usan.
