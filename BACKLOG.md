# BACKLOG

Tareas pendientes para los agentes autopilot.
Formato: "- [x] descripcion".

- [x] Arreglar los tests que fallan tras: Reducir el peso de data/gallery-minwage.js (255 KB) simplificando geometrías y verificar que la galería carga más rápido sin pérdida visual (19-08)
- [x] Anadir meta tags Open Graph y Twitter Cards a la galeria (gallery/index.html) siguiendo los de la portada (14-08)
- [x] Completar la entrada de /pricing/ en sitemap.xml con changefreq y priority coherentes para mejorar su descubribilidad SEO
- [x] Corregir los enlaces hreflang de la portada para que `en` apunte a `/en/` y validar que cada variante tenga su URL canónica
- [x] Añadir un enlace visible a Precios en la navegación superior de la portada para reducir fricción hacia la conversión
- [x] Dar al globo interactivo un nombre accesible y un fallback textual para usuarios de lector de pantalla o sin JavaScript

- [x] Anadir alt descriptivo y unico a las imagenes destacadas de la galeria (gallery/index.html)
- [x] Añadir `display=swap` a la URL de Google Fonts de la portada para evitar texto invisible durante la carga
- [x] Añadir `twitter:image:alt` a la portada con el mismo texto descriptivo de su imagen Open Graph (14-08)
- [x] Añadir en la portada un bloque breve de preguntas frecuentes sobre exportación, IA y privacidad, con un enlace contextual a /pricing/ para resolver objeciones y captar búsquedas long-tail
- [x] Incorporar en la portada una comparación visible y concisa entre el uso gratuito y las opciones de /pricing/, con un CTA específico por beneficio (15-08)
- [x] Añadir un enlace HTML rastreable desde la portada hacia la galería pública, acompañado de copy orientado a descubrir ejemplos de mapas
- [x] Arreglar los dos badges rotos del README.md: el de Pre-deployment Tests (pre-deploy-tests.yml) y el de Update Changelog (update-changelog.yml) no muestran imagen correcta (15-08)
- [x] Revisar que todas las tareas de maña.com/tasks tengan fecha y hora correctas
- [x] Arreglar en movil los botones Ver novedades y Abrir app que quedan en dos lineas (15-08)
- [x] Revisar que la web y los nuevos botones se vean correctamente en movil (no partidos en dos lineas) (15-08)
- [x] Añadir JSON-LD de WebSite y Organization a la portada, comprobando que sea válido y no duplique datos existentes (15-08)
- [x] Añadir en /pricing/ un enlace contextual a un ejemplo de la galería y un CTA de prueba junto a cada plan (15-08)
- [x] Completar sitemap.xml con las páginas públicas importantes que faltan y verificar que cada URL devuelve una página indexable (15-08)
- [x] Revisar el globo terraqueo de la portada en movil: no se ve simetricamente circular (parece deformado) (15-08)
- [x] Sincronizar og:title, og:description y etiquetas Twitter con el idioma seleccionado en la portada (15-08)
- [x] Actualizar el aria-label del selector de idioma al cambiar entre español e inglés y verificar su anuncio en lector de pantalla (15-08)
- [x] Localizar los `aria-label` estáticos de las secciones de la portada al cambiar entre español e inglés y verificar su anuncio en lector de pantalla (15-08)
- [x] Añadir un fallback visible cuando falle la carga del módulo externo del globo 3D, manteniendo una alternativa textual útil (15-08)
- [x] Añadir datos estructurados de BreadcrumbList a /pricing/ y /gallery/ y validarlos sin duplicar el JSON-LD existente (15-08)
- [x] Añadir enlaces hreflang y canónicos coherentes a las páginas públicas localizadas, empezando por /pricing/ y /gallery/ (15-08)
- [x] Añadir un bloque de comparación de planes con CTA persistente al hacer scroll en /pricing/ para mejorar la conversión móvil (15-08)
- [x] Mejorar la fluidez del globo interactivo de la portada en iPhone: al arrastrarlo debe deslizarse suavemente en horizontal y vertical (15-08)
- [x] Comprimir `globe-thumb.png` y `og-card.png` manteniendo su calidad visual, y verificar la reducción de peso sin romper sus referencias (15-08)
- [x] Añadir en `/pricing/` un bloque breve de preguntas frecuentes sobre facturación, cancelación y privacidad con CTA contextual a cada plan (15-08)
- [x] Incorporar un enlace visible desde `/gallery/` hacia `/pricing/` junto a cada ejemplo destacado para conectar descubrimiento con conversión (15-08)
- [x] En móvil, separar el selector de idioma, Pricing y Open app para que no queden demasiado juntos (16-08)
- [x] Ocultar la opción de continuar como invitado en el modal de fork o compartir de la galería (16-08)
- [x] Añadir controles de teclado con flechas al globo 3D enfocable y verificar que la rotación sea perceptible sin ratón (16-08)
- [x] Añadir preconnect a `https://esm.sh` antes de cargar Cobe y verificar que mejora el inicio del globo sin errores de consola (16-08)
- [x] Marcar como decorativo el SVG del logotipo dentro del enlace de marca y verificar que un lector de pantalla anuncia solo el nombre del sitio (16-08)
- [x] Añadir un enlace «Saltar al contenido» visible al recibir foco en la portada y verificar que lleva al contenido principal (16-08)
- [x] Revisar la portada y /pricing/ para añadir `font-display: swap` a cualquier fuente local o externa que aún bloquee el texto, verificando que no haya FOUT excesivo (16-08)
- [x] Añadir una sección de casos de uso enlazable en la portada con tres ejemplos concretos y enlaces hacia ejemplos relevantes de la galería para captar búsquedas long-tail (16-08)
- [x] Mostrar en cada tarjeta del grid de la galería la fuente y el año de los datos de los mapas locales (salario mínimo, cables submarinos, incendios) para mejorar credibilidad y SEO (17-08)
- [x] Añadir un nuevo mapa local a la galería (volcanes activos del mundo) con su archivo de datos en data/ y su tarjeta en gallery/index.html siguiendo el patrón de los mapas existentes (18-08)
- [x] Reducir el peso de data/gallery-minwage.js (255 KB) simplificando geometrías y verificar que la galería carga más rápido sin pérdida visual (18-08)
- [x] Eliminar de la página principal las dos tarjetas de precio: Gratis y maña Pro (19-08)
- [x] Eliminar los botones «Ver precios» de las diferentes tarjetas de la galería (19-08)
- [ ] Simplificación y limpieza del repo: eliminar archivos antiguos/residuales, definir bien la carpeta de agentes y asegurar que todo funciona correctamente tras la limpieza
