// ── i18n.js ─ Internationalization: translations + language detection ──
// Must be loaded BEFORE all other scripts.

const I18N = {
  es: {
    // ── Tools ──
    tool_point: "Añadir punto",
    tool_line: "Dibujar línea",
    tool_polygon: "Dibujar polígono",
    tool_ruler: "Medir distancia",
    tool_select: "Seleccionar",
    tool_edit: "Editar geometria",
    // ── Topbar ──
    btn_import: "Importar",
    btn_export: "Exportar",
    btn_clear: "Limpiar mapa",
    btn_share: "Compartir",
    share_title: "Compartir mapa",
    share_subtitle: "Comparte un enlace privado o publícalo en la galería.",
    share_copy_url: "Copiar URL",
    share_copy_desc: "Genera un enlace directo con este mapa.",
    share_private: "Guardar en mi espacio",
    share_private_desc: "Guárdalo en privado para publicarlo cuando quieras.",
    share_publish: "Publicar mapa",
    share_publish_desc: "Publica este mapa desde tu espacio privado y comparte su ficha pública.",
    auth_title: "Inicia sesión para publicar",
    auth_subtitle: "Para usar \"Mi espacio\" y publicar, inicia sesión o continúa como invitado.",
    auth_guest: "Continuar como invitado",
    auth_google: "Iniciar con Google",
    search_placeholder: "Buscar lugar...",
    search_no_results: "Sin resultados",
    map_name_placeholder: "Mapa sin título",
    // ── Panels ──
    panel_tools_title: "Herramientas",
    panel_tools_sub: "Dibujo y edición",
    panel_style_title: "Estilo",
    panel_style_sub: "Colores y marcadores",
    panel_basemap_title: "Mapa base",
    panel_basemap_sub: "Tipo de vista",
    panel_layers_title: "Capas",
    panel_layers_sub: "Elementos del mapa",
    panel_ogc_title: "Servicios OGC",
    panel_ogc_sub: "WMS y WFS",
    // ── Style panel ──
    style_color: "Color",
    style_marker_type: "Tipo de marcador",
    // ── Layers ──
    layer_new: "Nueva capa",
    layer_default_name: "Capa",
    layer_empty: "Aún no hay elementos.\nDibuja algo en el mapa o usa el chat.",
    layer_active: "▶ Capa activa — dibuja para añadir elementos",
    layer_drag_hint: "Arrastra para reordenar",
    // ── Basemap ──
    basemap_map: "Mapa",
    basemap_satellite: "Satélite",
    basemap_globe: "Globo 3D",
    // ── Chat ──
    chat_title: "Maña AI",
    chat_subtitle: "Escribe en lenguaje natural",
    chat_placeholder: "Escribe un comando...",
    chat_welcome: '¡Hola! Soy <strong>Maña AI</strong>, tu asistente de mapas. Prueba con:',
    chat_suggestion_point: "📍 añade un punto en Barcelona",
    chat_suggestion_route: "🛣️ ruta de Madrid a Sevilla",
    chat_suggestion_search: "🏛️ busca museos en París",
    chat_suggestion_satellite: "🛰️ satélite",
    chat_suggestion_globe: "🌍 globo 3D",
    chat_suggestion_color: "🎨 color rojo",
    chat_suggestion_export: "📦 exporta como KML",
    ai_badge: "IA",
    chat_configure_hint: '⚙️ <strong>Configura una clave API</strong> (⚙) para IA con lenguaje natural completo.',
    // ── Modals ──
    modal_name_title: "Nombre del elemento",
    modal_name_placeholder: "Sin nombre",
    modal_cancel: "Cancelar",
    modal_save: "Guardar",
    modal_confirm_ok: "Confirmar",
    modal_clear_confirm: "¿Seguro que quieres borrar todo?",
    modal_delete_group: "¿Eliminar toda la capa y sus elementos?",
    // ── Export ──
    export_geojson: "GeoJSON",
    export_csv: "CSV",
    export_kml: "KML / KMZ",
    export_shapefile: "Shapefile (.zip)",
    // ── AI Settings ──
    ai_settings_title: "⚙️ Configurar IA",
    ai_provider: "Proveedor",
    ai_key: "Clave API",
    ai_model: "Modelo",
    ai_endpoint: "Endpoint",
    ai_hint_key: "🔒 La clave se guarda solo en tu navegador (localStorage).",
    ai_hint_groq: '💡 <strong>Groq</strong> ofrece una clave gratuita en <a href="https://console.groq.com" target="_blank">console.groq.com</a>',
    ai_hint_anthropic: '💡 <strong>Anthropic</strong> en <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>',
    ai_configured: "✓ IA configurada con",
    ai_configured_suffix: "Ya puedes escribir en lenguaje natural.",
    ai_custom: "Personalizado",
    // ── Filters ──
    filter_title: "Filtrar por atributos",
    filter_empty: "Sin filtros activos. Pulsa <strong>+</strong> para añadir.",
    filter_no_attrs: "Esta capa no tiene atributos",
    filter_apply: "Aplicar",
    filter_clear: "Limpiar",
    filter_add_rule: "Regla",
    filter_hidden: "elementos ocultos por filtro",
    filter_contains: "contiene",
    filter_starts: "empieza",
    filter_value_placeholder: "Valor...",
    filter_remove_rule: "Eliminar regla",
    // ── Sidebar footer ──
    footer_about: "Acerca de",
    footer_changelog: "Changelog",
    footer_stats: "Estadísticas",
    footer_pro: "Activa la IA Pro →",
    // ── Hints ──
    hint_point: "Haz clic en el mapa para añadir un punto",
    hint_line: "Clic para añadir vértices — doble clic para terminar",
    hint_polygon: "Clic para añadir vértices — cierra haciendo clic en el primer punto",
    hint_ruler: "Clic para fijar puntos — doble clic para terminar y ver resultado",
    hint_edit: 'Arrastra los vértices para editar. Clic en "Editar" de nuevo para terminar.',
    hint_select: 'Clic en un elemento para seleccionarlo (Shift+clic para selección múltiple)',
    hint_draw_generic: "Haz clic en el mapa para dibujar",
    // ── Context menu ──
    ctx_copy_coords: "Copiar coordenadas",
    ctx_add_point: "Añadir punto aquí",
    ctx_center_here: "Centrar mapa aquí",
    ctx_rename: "Renombrar",
    ctx_delete_element: "Borrar este elemento",
    ctx_delete_all: "Borrar todo",
    ctx_style_section: "Estilo del elemento",
    ctx_weight: "Grosor",
    ctx_opacity: "Opacidad",
    ctx_apply_group_style: "Aplicar estilo a toda la capa",
    ctx_attr_table: "Tabla de atributos",
    ctx_categorize: "Categorizar por atributo",
    // ── Layer context menu ──
    lctx_rename: "Renombrar",
    lctx_zoom: "Zoom a la capa",
    lctx_attr_table: "Ver tabla de atributos",
    lctx_delete: "Eliminar",
    lctx_weight: "Grosor",
    lctx_opacity: "Opacidad",
    // ── Toast / alerts ──
    toast_imported: "Archivo importado correctamente",
    toast_exported: "Archivo exportado",
    toast_coords_copied: "📋 Coordenadas copiadas",
    toast_color_applied: "Color aplicado",
    toast_renamed: "Renombrado",
    toast_style_applied: "Estilo aplicado a toda la capa",
    toast_categorized: "Categorizado por",
    toast_categorized_values: "valores",
    // ── Drop overlay ──
    drop_overlay: "Suelta para importar",
    // ── Stats ──
    stat_points: "Puntos",
    stat_lines: "Líneas",
    stat_polygons: "Polígonos",
    stat_autosave: "Auto-guardado",
    stat_element: "elemento",
    stat_elements: "elementos",
    // ── Globe ──
    globe_spin: "↻ Auto-rotación activa",
    globe_zoom_in: "Acercar",
    globe_zoom_out: "Alejar",
    globe_spin_btn: "Auto-rotación",
    // ── Geometry defaults ──
    geom_point: "Punto",
    geom_line: "Línea",
    geom_polygon: "Polígono",
    geom_element: "Elemento",
    geom_imported: "Importado",
    geom_imported_layer: "Capa importada",
    // ── Import / Export errors ──
    import_format_error: "Formato no soportado.",
    import_error: "Error al importar: ",
    import_no_kml: "No se encontró un .kml dentro del KMZ",
    import_shapefile_error: "No se pudo leer el Shapefile. Asegúrate de que el .zip contiene .shp, .dbf y .prj.",
    importing_large_file: "Archivo grande detectado. Importando en modo optimizado…",
    export_no_elements: "No hay elementos para exportar.",
    geojson_invalid: "GeoJSON no válido.",
    // ── AI tool responses ──
    ai_not_found: "No encontré «{place}».",
    ai_place_not_found: "No pude encontrar uno de los lugares.",
    ai_point_added: "Punto añadido en **{label}** ✓",
    ai_line_drawn: "Línea de **{from}** a **{to}** ✓",
    ai_area_drawn: "Área de {radius} km alrededor de **{place}** ✓",
    ai_centered: "Centrado en **{place}** ✓",
    ai_no_results: "Sin resultados para «{query}».",
    ai_results: "Resultados:",
    ai_view_satellite: "Vista satélite ✓",
    ai_view_globe: "Globo 3D ✓ — arrastra para rotar",
    ai_view_map: "Vista de mapa ✓",
    ai_map_cleared: "Mapa limpiado ✓",
    ai_zoom: "Zoom",
    ai_zoom_level: "nivel",
    ai_ruler_activated: "Herramienta de medición activada — clic para medir, doble clic para terminar.",
    ai_tool_activated: "Herramienta de {tool} activada ✓",
    ai_color_changed: "Color cambiado a",
    ai_marker_changed: "Marcador cambiado a",
    ai_map_status: "**Estado del mapa:**",
    ai_center_label: "Centro",
    ai_zoom_label: "Zoom",
    ai_points_label: "Puntos",
    ai_lines_label: "Líneas",
    ai_polygons_label: "Polígonos",
    ai_basemap_label: "Capa base",
    ai_exporting: "Exportando como",
    ai_points_added: "de {total} puntos añadidos ✓",
    ai_route_drawn: "Ruta de **{from}** a **{to}**",
    ai_func_unknown: "Función no reconocida: ",
    ai_done: "Hecho ✓",
    ai_fallback_msg: "Usando modo local:",
    ai_not_understood: "No entendí ese comando. Escribe **ayuda** para ver los comandos disponibles, o configura una clave API para chat con IA.",
    ai_help: '**Comandos disponibles:**\n\n📍 *"añade un punto en Barcelona"*\n📍 *"marca Madrid, Sevilla y Valencia"*\n🔵 *"color rojo"* / *"color #ff6600"*\n📐 *"dibuja línea de A a B"*\n🛣️ *"ruta de Madrid a Barcelona"*\n⭕ *"dibuja un área de 10km en París"*\n🔍 *"busca museos en Roma"*\nℹ️ *"info de Tokio"*\n🗺️ *"satélite"* / *"mapa"* / *"globo 3D"*\n📏 *"mide distancia"*\n🗑️ *"borra todo"*\n💾 *"exporta como GeoJSON"*\n📊 *"estado del mapa"*\n\nCon clave API configurada: escribe cualquier cosa en lenguaje natural.',
    ai_system_prompt: 'Eres Maña AI, el asistente inteligente de Maña Maps — una aplicación web de mapas interactivos.\n\nTu rol es ayudar al usuario a interactuar con el mapa usando lenguaje natural. Puedes:\n- Añadir puntos, líneas, rutas y áreas en el mapa\n- Buscar lugares y obtener información geográfica\n- Cambiar el estilo del mapa (satélite, globo 3D, colores, marcadores)\n- Medir distancias, exportar datos, y más\n\nReglas:\n- Responde SIEMPRE en español\n- Sé conciso y útil\n- Usa las funciones disponibles para ejecutar acciones en el mapa\n- Si el usuario pide algo que no puedes hacer con las funciones, explícalo amablemente\n- Puedes encadenar varias funciones si es necesario (ej: cambiar color + añadir punto)\n- Cuando el usuario mencione colores, usa los nombres: azul, rojo, verde, amarillo, rosa, púrpura, naranja, negro, gris\n- Para rutas entre ciudades usa draw_route (incluye distancia y tiempo)\n- Para líneas rectas simples usa draw_line\n\nIMPORTANTE — Los comandos de estilo nunca deben geocodificarse ni convertirse en elementos del mapa.\nSi el usuario pide cambiar color de dibujo, tipo de marcador, grosor de línea, o activar herramienta,\nresponde SOLO con un JSON como: {\"action\":\"setColor\",\"value\":\"#ef4444\"}\nAcciones válidas: setColor, setMarkerType, setTool, setBasemap, zoomIn, zoomOut, clearAll.\nPalabras clave de estilo:\n  Colores: rojo/red, azul/blue, verde/green, amarillo/yellow, rosa/pink, púrpura/purple, índigo/indigo, naranja/orange, gris/grey, negro/black\n  Marcadores: pin/chincheta, círculo/circle, cuadrado/square, estrella/star\n  Herramientas: punto/point, línea/line, polígono/polygon, regla/ruler\n  Mapas base: satélite/satellite, mapa/map, globo/globe\nNO llames a Nominatim ni crees features para ninguna de las palabras clave anteriores.',
    ai_map_context: 'El mapa actual contiene: ',
    // ── Attr table ──
    attr_properties: "Propiedades",
    attr_no_attrs: "Sin atributos",
    attr_add: "Añadir atributo",
    // ── Ruler ──
    ruler_total: "Distancia total",
    // ── Draw:created labels ──
    draw_line_label: "Línea",
    draw_polygon_label: "Polígono",
    draw_name_line: "Nombre de la línea",
    draw_name_polygon: "Nombre de la forma",
    // ── OGC ──
    ogc_placeholder: "Servicio WMS o WFS",
    ogc_catalog: "Catálogo de servicios",
    // ── Upsell ──
    upsell_title: "Maña Maps Pro",
    upsell_ai_included: "IA incluida",
    upsell_ai_desc: "Sin configurar nada",
    upsell_models: "Todos los modelos de lenguaje",
    upsell_models_desc: "GPT-4o, Claude, Llama y más",
    upsell_support: "Soporte prioritario",
    upsell_support_desc: "Respuesta directa del equipo",
    upsell_cta: "Empezar ahora",
    upsell_have_key: "Ya tengo una clave API",
    upsell_note: "Recibirás tu clave API por email tras el pago · Cancela cuando quieras",
    // ── Misc ──
    dblclick_expand: "Doble clic para expandir",
    leaflet_badge_text: "Mapa inclusivo con Leaflet",
    leaflet_badge_title: "Leaflet (abre en una pestaña nueva)",
    leaflet_badge_sr: "Abre el sitio oficial de Leaflet en una nueva pestaña",
    name_point: "Nombre del punto",
    default_point_name: "Nuevo punto",
    rename_element: "Renombrar elemento",
    // ── Shortcuts ──
    shortcut_title: "Atajos de teclado",
    shortcut_pill: "Atajos",
    shortcut_tools: "HERRAMIENTAS",
    shortcut_map: "MAPA",
    shortcut_general: "GENERAL",
    shortcut_point: "Añadir punto",
    shortcut_line: "Dibujar línea",
    shortcut_polygon: "Dibujar polígono",
    shortcut_ruler: "Medir distancia",
    shortcut_fit: "Ajustar al contenido",
    shortcut_zoom_in: "Acercar",
    shortcut_zoom_out: "Alejar",
    shortcut_undo: "Deshacer",
    shortcut_export: "Exportar",
    shortcut_select_all: "Seleccionar todo",
    shortcut_delete: "Eliminar selección",
    shortcut_escape: "Cancelar / cerrar",
    shortcut_show: "Mostrar atajos",
    // ── Inline feedback ──
    attr_renamed: "Renombrado: {key}",
    attr_deleted: "Atributo eliminado",
    attr_col_added: "Columna \"{field}\" añadida",
    // ── Dark mode ──
    dark_toggle: "Modo oscuro",
    // ── Chat local responses ──
    local_tool_point: "✅ Herramienta de punto activada.",
    local_tool_line: "✅ Herramienta de línea activada.",
    local_tool_polygon: "✅ Herramienta de polígono activada.",
    local_tool_ruler: "✅ Herramienta de medición activada.",
    local_view_sat: "✅ Vista satélite activada.",
    local_view_map: "✅ Mapa base activado.",
    local_view_globe: "✅ Globo 3D activado.",
    local_map_cleared: "✅ Mapa limpiado.",
    local_zoom_in: "✅ Zoom acercado.",
    local_zoom_out: "✅ Zoom alejado.",
    local_fit_bounds: "✅ Vista ajustada a todos los elementos.",
    local_color_changed: "✅ Color cambiado a",
    local_marker_changed: "✅ Marcador cambiado a",
    // ── Context menu / layer ──
    ctx_rename_layer: "Renombrar capa",
    ctx_rename_element: "Renombrar elemento",
    ctx_no_extra_attrs: "Sin atributos adicionales",
    // ── Persistence ──
    persist_restored: "Mapa restaurado de la sesión anterior",
    persist_autosave: "Auto-guardado",
    persist_no_elements: "No hay elementos para compartir.",
    // ── OGC ──
    ogc_connecting: "Conectando WMS…",
    ogc_added: "WMS añadido ✓",
    ogc_added_no_list: "WMS añadido (sin lista de capas)",
    ogc_removed: "Servicio eliminado",
    ogc_elements: "elementos ✓",
    ogc_layers_available: "capas WMS disponibles",
    // ── Filter ──
    filter_is_empty: "está vacío",
    filter_is_not_empty: "no está vacío",
    // ── Undo ──
    undo_nothing: "Nada que deshacer",
    undo_steps: "pasos",
    // ── Shortcuts ──
    shortcut_deleted: "elemento(s) eliminado(s)",
    // ── Generic ──
    generic_element: "Elemento",
    // ── Stats panel ──
    stats_geometry: "Geometría",
    stats_total_length: "Longitud total",
    stats_total_area: "Área total",
    stats_wms_layers: "Capas WMS activas",
    stats_total_elements: "Total",
    // ── Stats panel (more) ──
    stats_title: "Estadísticas",
    stats_summary: "Resumen",
    stats_extent: "Extensión",
    stats_data_groups: "Grupos de datos",
    stats_attributes: "Atributos (top campos)",
    // ── Upsell modal ──
    upsell_title: "Maña Maps Pro",
    upsell_period: "/ mes",
    upsell_ai_title: "IA incluida",
    upsell_ai_desc: "Sin configurar nada",
    upsell_models_title: "Todos los modelos de lenguaje",
    upsell_models_desc: "GPT-4o, Claude, Llama y más",
    upsell_support_title: "Soporte prioritario",
    upsell_support_desc: "Respuesta directa del equipo",
    upsell_cta: "Empezar ahora",
    upsell_have_key: "Ya tengo una clave API",
    upsell_note: "Recibirás tu clave API por email tras el pago · Cancela cuando quieras",
    // ── About page ──
    about_title: "Acerca de Maña Maps",
    about_subtitle: "Una herramienta de cartografía ligera, rápida y sin distracciones.",
    about_what_title: "¿Qué es Maña Maps?",
    about_what_p1: "Maña Maps es un editor de mapas web diseñado para crear, anotar y exportar información geoespacial sin necesidad de instalar nada ni crear una cuenta. Funciona directamente en el navegador, con cero dependencias de servidor propias.",
    about_what_p2: "El objetivo es ofrecer las funciones esenciales de un SIG de escritorio — dibujar puntos, líneas y polígonos, medir distancias, importar y exportar en múltiples formatos — dentro de una interfaz limpia que no requiere curva de aprendizaje.",
    about_features_title: "Funcionalidades",
    about_feat_draw: "Dibujo vectorial",
    about_feat_draw_desc: "Puntos, líneas y polígonos con paleta Apple de 8 colores y 4 tipos de marcador.",
    about_feat_io: "Importar & Exportar",
    about_feat_io_desc: "GeoJSON, KML, KMZ, CSV y Shapefile (.zip) con colores preservados.",
    about_feat_ruler: "Regla de distancias",
    about_feat_ruler_desc: "Mide rutas de varios segmentos clic a clic, con resultado en metros o kilómetros.",
    about_feat_ai: "Maña AI",
    about_feat_ai_desc: "Comandos en lenguaje natural: dibuja puntos, centra el mapa, cambia a satélite y más.",
    about_feat_layers: "Capas base",
    about_feat_layers_desc: "Vista de mapa (CartoDB Light) y satélite (Esri World Imagery) con selector de miniaturas.",
    about_feat_dd: "Drag & Drop",
    about_feat_dd_desc: "Arrastra cualquier archivo GeoJSON, KML, KMZ o Shapefile ZIP directamente sobre el mapa.",
    about_tech_title: "Tecnologías",
    about_more_title: "Más",
    about_open_map: "Abrir Maña Maps",
    about_changelog_desc: "Historial de cambios",
    about_github: "Código fuente en GitHub",
    about_footer: "Maña Maps — Hecho con ❤ en Barcelona",
    // ── Changelog page ──
    changelog_back: "Volver al mapa",
    changelog_subtitle: "Historial de cambios y mejoras de Maña Maps. Todos los commits, organizados por fecha.",
    changelog_footer: "Maña Maps — Hecho con ❤ en Barcelona",
    // ── Nav (shared) ──
    nav_open_map: "Abrir mapa",
    // ── Categorize / Style by ──
    cat_field: "Campo",
    cat_reset: "Reset",
    cat_others: "Otros",
    cat_no_values: "Sin valores para este campo",
    cat_toast: "Estilizado por",
    cat_values: "valores",
    cat_range: "a",
    // ── Marker types ──
    marker_pin: "Pin",
    marker_circle: "Círculo",
    marker_square: "Cuadrado",
    marker_diamond: "Diamante",
    marker_triangle: "Triángulo",
    marker_star: "Estrella",
    marker_hexagon: "Hexágono",
    marker_cross: "Cruz",
    marker_drop: "Gota",
    marker_flag: "Bandera",
    marker_bolt: "Rayo",
    marker_heart: "Corazón",
    // ── Nominatim Accept-Language ──
    nominatim_lang: "es",
  },
  en: {
    // ── Tools ──
    tool_point: "Add point",
    tool_line: "Draw line",
    tool_polygon: "Draw polygon",
    tool_ruler: "Measure distance",
    tool_select: "Select",
    tool_edit: "Edit geometry",
    // ── Topbar ──
    btn_import: "Import",
    btn_export: "Export",
    btn_clear: "Clear map",
    btn_share: "Share",
    share_title: "Share map",
    share_subtitle: "Copy a private URL or publish it in the gallery.",
    share_copy_url: "Copy URL",
    share_copy_desc: "Generate a direct link with this map.",
    share_private: "Save to My Space",
    share_private_desc: "Keep it private first and publish whenever you are ready.",
    share_publish: "Publish map",
    share_publish_desc: "Publish this map from your private space and share a public page.",
    auth_title: "Sign in to publish",
    auth_subtitle: "To use My Space and publish, sign in or continue as guest.",
    auth_guest: "Continue as guest",
    auth_google: "Sign in with Google",
    search_placeholder: "Search place...",
    search_no_results: "No results",
    map_name_placeholder: "Untitled map",
    // ── Panels ──
    panel_tools_title: "Tools",
    panel_tools_sub: "Drawing and editing",
    panel_style_title: "Style",
    panel_style_sub: "Colors and markers",
    panel_basemap_title: "Basemap",
    panel_basemap_sub: "View type",
    panel_layers_title: "Layers",
    panel_layers_sub: "Map elements",
    panel_ogc_title: "OGC Services",
    panel_ogc_sub: "WMS and WFS",
    // ── Style panel ──
    style_color: "Color",
    style_marker_type: "Marker type",
    // ── Layers ──
    layer_new: "New layer",
    layer_default_name: "Layer",
    layer_empty: "No elements yet.\nDraw something on the map or use the chat.",
    layer_active: "▶ Active layer — draw to add elements",
    layer_drag_hint: "Drag to reorder",
    // ── Basemap ──
    basemap_map: "Map",
    basemap_satellite: "Satellite",
    basemap_globe: "3D Globe",
    // ── Chat ──
    chat_title: "Maña AI",
    chat_subtitle: "Type in natural language",
    chat_placeholder: "Type a command...",
    chat_welcome: 'Hello! I\'m <strong>Maña AI</strong>, your map assistant. Try:',
    chat_suggestion_point: "📍 add a point in Paris",
    chat_suggestion_route: "🛣️ route from London to Edinburgh",
    chat_suggestion_search: "🏛️ find museums in Rome",
    chat_suggestion_satellite: "🛰️ satellite",
    chat_suggestion_globe: "🌍 3D globe",
    chat_suggestion_color: "🎨 red color",
    chat_suggestion_export: "📦 export as KML",
    ai_badge: "AI",
    chat_configure_hint: '⚙️ <strong>Set up an API key</strong> (⚙) for full natural language AI.',
    // ── Modals ──
    modal_name_title: "Element name",
    modal_name_placeholder: "Unnamed",
    modal_cancel: "Cancel",
    modal_save: "Save",
    modal_confirm_ok: "Confirm",
    modal_clear_confirm: "Are you sure you want to clear everything?",
    modal_delete_group: "Delete the entire layer and its elements?",
    // ── Export ──
    export_geojson: "GeoJSON",
    export_csv: "CSV",
    export_kml: "KML / KMZ",
    export_shapefile: "Shapefile (.zip)",
    // ── AI Settings ──
    ai_settings_title: "⚙️ AI Settings",
    ai_provider: "Provider",
    ai_key: "API Key",
    ai_model: "Model",
    ai_endpoint: "Endpoint",
    ai_hint_key: "🔒 The key is stored only in your browser (localStorage).",
    ai_hint_groq: '💡 <strong>Groq</strong> offers a free key at <a href="https://console.groq.com" target="_blank">console.groq.com</a>',
    ai_hint_anthropic: '💡 <strong>Anthropic</strong> at <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>',
    ai_configured: "✓ AI configured with",
    ai_configured_suffix: "You can now type in natural language.",
    ai_custom: "Custom",
    // ── Filters ──
    filter_title: "Filter by attributes",
    filter_empty: "No active filters. Press <strong>+</strong> to add one.",
    filter_no_attrs: "This layer has no attributes",
    filter_apply: "Apply",
    filter_clear: "Clear",
    filter_add_rule: "Rule",
    filter_hidden: "elements hidden by filter",
    filter_contains: "contains",
    filter_starts: "starts with",
    filter_value_placeholder: "Value...",
    filter_remove_rule: "Remove rule",
    // ── Sidebar footer ──
    footer_about: "About",
    footer_changelog: "Changelog",
    footer_stats: "Statistics",
    footer_pro: "Activate AI Pro →",
    // ── Hints ──
    hint_point: "Click on the map to add a point",
    hint_line: "Click to add vertices — double-click to finish",
    hint_polygon: "Click to add vertices — close by clicking the first point",
    hint_ruler: "Click to set points — double-click to finish and see result",
    hint_edit: 'Drag vertices to edit. Click "Edit" again to finish.',
    hint_draw_generic: "Click on the map to draw",
    // ── Context menu ──
    ctx_copy_coords: "Copy coordinates",
    ctx_add_point: "Add point here",
    ctx_center_here: "Center map here",
    ctx_rename: "Rename",
    ctx_delete_element: "Delete this element",
    ctx_delete_all: "Delete all",
    ctx_style_section: "Element style",
    ctx_weight: "Weight",
    ctx_opacity: "Opacity",
    ctx_apply_group_style: "Apply style to entire layer",
    ctx_attr_table: "Attribute table",
    ctx_categorize: "Categorize by attribute",
    // ── Layer context menu ──
    lctx_rename: "Rename",
    lctx_zoom: "Zoom to layer",
    lctx_attr_table: "View attribute table",
    lctx_delete: "Delete",
    lctx_weight: "Weight",
    lctx_opacity: "Opacity",
    // ── Toast / alerts ──
    toast_imported: "File imported successfully",
    toast_exported: "File exported",
    toast_coords_copied: "📋 Coordinates copied",
    toast_color_applied: "Color applied",
    toast_renamed: "Renamed",
    toast_style_applied: "Style applied to entire layer",
    toast_categorized: "Categorized by",
    toast_categorized_values: "values",
    // ── Drop overlay ──
    drop_overlay: "Drop to import",
    // ── Stats ──
    stat_points: "Points",
    stat_lines: "Lines",
    stat_polygons: "Polygons",
    stat_autosave: "Auto-saved",
    stat_element: "element",
    stat_elements: "elements",
    // ── Globe ──
    globe_spin: "↻ Auto-rotation active",
    globe_zoom_in: "Zoom in",
    globe_zoom_out: "Zoom out",
    globe_spin_btn: "Auto-rotation",
    // ── Geometry defaults ──
    geom_point: "Point",
    geom_line: "Line",
    geom_polygon: "Polygon",
    geom_element: "Element",
    geom_imported: "Imported",
    geom_imported_layer: "Imported layer",
    // ── Import / Export errors ──
    import_format_error: "Unsupported format.",
    import_error: "Import error: ",
    import_no_kml: "No .kml file found inside the KMZ",
    import_shapefile_error: "Could not read Shapefile. Make sure the .zip contains .shp, .dbf and .prj.",
    importing_large_file: "Large file detected. Importing in optimized mode…",
    export_no_elements: "No elements to export.",
    geojson_invalid: "Invalid GeoJSON.",
    // ── AI tool responses ──
    ai_not_found: 'Couldn\'t find "{place}".',
    ai_place_not_found: "Couldn't find one of the places.",
    ai_point_added: "Point added at **{label}** ✓",
    ai_line_drawn: "Line from **{from}** to **{to}** ✓",
    ai_area_drawn: "Area of {radius} km around **{place}** ✓",
    ai_centered: "Centered on **{place}** ✓",
    ai_no_results: 'No results for "{query}".',
    ai_results: "Results:",
    ai_view_satellite: "Satellite view ✓",
    ai_view_globe: "3D Globe ✓ — drag to rotate",
    ai_view_map: "Map view ✓",
    ai_map_cleared: "Map cleared ✓",
    ai_zoom: "Zoom",
    ai_zoom_level: "level",
    ai_ruler_activated: "Measurement tool activated — click to measure, double-click to finish.",
    ai_tool_activated: "{tool} tool activated ✓",
    ai_color_changed: "Color changed to",
    ai_marker_changed: "Marker changed to",
    ai_map_status: "**Map status:**",
    ai_center_label: "Center",
    ai_zoom_label: "Zoom",
    ai_points_label: "Points",
    ai_lines_label: "Lines",
    ai_polygons_label: "Polygons",
    ai_basemap_label: "Base layer",
    ai_exporting: "Exporting as",
    ai_points_added: "of {total} points added ✓",
    ai_route_drawn: "Route from **{from}** to **{to}**",
    ai_func_unknown: "Unrecognized function: ",
    ai_done: "Done ✓",
    ai_fallback_msg: "Using local mode:",
    ai_not_understood: 'I didn\'t understand that command. Type **help** to see available commands, or set up an API key for AI chat.',
    ai_help: '**Available commands:**\n\n📍 *"add a point in Paris"*\n📍 *"mark London, Berlin and Rome"*\n🔵 *"red color"* / *"color #ff6600"*\n📐 *"draw line from A to B"*\n🛣️ *"route from London to Paris"*\n⭕ *"draw an area of 10km in Tokyo"*\n🔍 *"find museums in Rome"*\nℹ️ *"info about Tokyo"*\n🗺️ *"satellite"* / *"map"* / *"3D globe"*\n📏 *"measure distance"*\n🗑️ *"clear all"*\n💾 *"export as GeoJSON"*\n📊 *"map status"*\n\nWith API key configured: type anything in natural language.',
    ai_system_prompt: 'You are Maña AI, the smart assistant of Maña Maps — an interactive web map application.\n\nYour role is to help users interact with the map using natural language. You can:\n- Add points, lines, routes and areas on the map\n- Search places and get geographic information\n- Change the map style (satellite, 3D globe, colors, markers)\n- Measure distances, export data, and more\n\nRules:\n- ALWAYS respond in English\n- Be concise and helpful\n- Use the available functions to execute actions on the map\n- If the user asks for something you cannot do with the functions, explain it kindly\n- You can chain multiple functions if needed (e.g.: change color + add point)\n- When the user mentions colors, use the names: blue, red, green, yellow, pink, purple, orange, black, gray\n- For routes between cities use draw_route (includes distance and time)\n- For simple straight lines use draw_line\n\nIMPORTANT — Style commands must never be geocoded or turned into map elements.\nIf the user asks to change drawing color, marker type, line weight, or activate a tool,\nrespond ONLY with a JSON object like: {\"action\":\"setColor\",\"value\":\"#ef4444\"}\nValid actions: setColor, setMarkerType, setTool, setBasemap, zoomIn, zoomOut, clearAll.\nStyle keywords to recognize:\n  Colors: rojo/red, azul/blue, verde/green, amarillo/yellow, rosa/pink, púrpura/purple, índigo/indigo, naranja/orange, gris/grey, negro/black\n  Markers: pin/chincheta, círculo/circle, cuadrado/square, estrella/star\n  Tools: punto/point, línea/line, polígono/polygon, regla/ruler\n  Basemaps: satélite/satellite, mapa/map, globo/globe\nDo NOT call Nominatim or create features for any of the above keywords.',
    ai_map_context: 'The current map contains: ',
    // ── Attr table ──
    attr_properties: "Properties",
    attr_no_attrs: "No attributes",
    attr_add: "Add attribute",
    // ── Ruler ──
    ruler_total: "Total distance",
    // ── Draw:created labels ──
    draw_line_label: "Line",
    draw_polygon_label: "Polygon",
    draw_name_line: "Line name",
    draw_name_polygon: "Shape name",
    // ── OGC ──
    ogc_placeholder: "WMS or WFS service",
    ogc_catalog: "Service catalog",
    // ── Upsell ──
    upsell_title: "Maña Maps Pro",
    upsell_ai_included: "AI included",
    upsell_ai_desc: "No setup needed",
    upsell_models: "All language models",
    upsell_models_desc: "GPT-4o, Claude, Llama and more",
    upsell_support: "Priority support",
    upsell_support_desc: "Direct response from the team",
    upsell_cta: "Start now",
    upsell_have_key: "I already have an API key",
    upsell_note: "You'll receive your API key by email after payment · Cancel anytime",
    // ── Misc ──
    dblclick_expand: "Double-click to expand",
    name_point: "Point name",
    default_point_name: "New point",
    rename_element: "Rename element",
    // ── Shortcuts ──
    shortcut_title: "Keyboard shortcuts",
    shortcut_pill: "Shortcuts",
    shortcut_tools: "TOOLS",
    shortcut_map: "MAP",
    shortcut_general: "GENERAL",
    shortcut_point: "Add point",
    shortcut_line: "Draw line",
    shortcut_polygon: "Draw polygon",
    shortcut_ruler: "Measure distance",
    shortcut_fit: "Fit to content",
    shortcut_zoom_in: "Zoom in",
    shortcut_zoom_out: "Zoom out",
    shortcut_undo: "Undo",
    shortcut_export: "Export",
    shortcut_select_all: "Select all",
    shortcut_delete: "Delete selection",
    shortcut_escape: "Cancel / close",
    shortcut_show: "Show shortcuts",
    // ── Inline feedback ──
    attr_renamed: "Renamed: {key}",
    attr_deleted: "Attribute deleted",
    attr_col_added: "Column \"{field}\" added",
    // ── Dark mode ──
    dark_toggle: "Dark mode",
    // ── Chat local responses ──
    local_tool_point: "✅ Point tool activated.",
    local_tool_line: "✅ Line tool activated.",
    local_tool_polygon: "✅ Polygon tool activated.",
    local_tool_ruler: "✅ Measurement tool activated.",
    local_view_sat: "✅ Satellite view activated.",
    local_view_map: "✅ Base map activated.",
    local_view_globe: "✅ 3D Globe activated.",
    local_map_cleared: "✅ Map cleared.",
    local_zoom_in: "✅ Zoomed in.",
    local_zoom_out: "✅ Zoomed out.",
    local_fit_bounds: "✅ View adjusted to all elements.",
    local_color_changed: "✅ Color changed to",
    local_marker_changed: "✅ Marker changed to",
    // ── Context menu / layer ──
    ctx_rename_layer: "Rename layer",
    ctx_rename_element: "Rename element",
    ctx_no_extra_attrs: "No additional attributes",
    // ── Persistence ──
    persist_restored: "Map restored from previous session",
    persist_autosave: "Auto-saved",
    persist_no_elements: "No elements to share.",
    // ── OGC ──
    ogc_connecting: "Connecting WMS…",
    ogc_added: "WMS added ✓",
    ogc_added_no_list: "WMS added (no layer list)",
    ogc_removed: "Service removed",
    ogc_elements: "elements ✓",
    ogc_layers_available: "WMS layers available",
    // ── Filter ──
    filter_is_empty: "is empty",
    filter_is_not_empty: "is not empty",
    // ── Undo ──
    undo_nothing: "Nothing to undo",
    undo_steps: "steps",
    // ── Shortcuts ──
    shortcut_deleted: "element(s) deleted",
    // ── Generic ──
    generic_element: "Element",
    leaflet_badge_text: "Inclusive map with Leaflet",
    leaflet_badge_title: "Leaflet (opens in a new tab)",
    leaflet_badge_sr: "Opens the official Leaflet site in a new tab",
    // ── Stats panel ──
    stats_geometry: "Geometry",
    stats_total_length: "Total length",
    stats_total_area: "Total area",
    stats_wms_layers: "Active WMS layers",
    stats_total_elements: "Total",
    hint_select: 'Click an element to select it (Shift+click for multi-select)',
    // ── Stats panel (more) ──
    stats_title: "Statistics",
    stats_summary: "Summary",
    stats_extent: "Extent",
    stats_data_groups: "Data groups",
    stats_attributes: "Attributes (top fields)",
    // ── Upsell modal ──
    upsell_title: "Maña Maps Pro",
    upsell_period: "/ month",
    upsell_ai_title: "AI included",
    upsell_ai_desc: "No setup needed",
    upsell_models_title: "All language models",
    upsell_models_desc: "GPT-4o, Claude, Llama and more",
    upsell_support_title: "Priority support",
    upsell_support_desc: "Direct response from the team",
    upsell_cta: "Get started",
    upsell_have_key: "I already have an API key",
    upsell_note: "You'll receive your API key by email after payment · Cancel anytime",
    // ── About page ──
    about_title: "About Maña Maps",
    about_subtitle: "A lightweight, fast and distraction-free mapping tool.",
    about_what_title: "What is Maña Maps?",
    about_what_p1: "Maña Maps is a web map editor designed to create, annotate and export geospatial information without installing anything or creating an account. It runs directly in the browser, with zero proprietary server dependencies.",
    about_what_p2: "The goal is to offer the essential features of a desktop GIS — drawing points, lines and polygons, measuring distances, importing and exporting in multiple formats — within a clean interface that requires no learning curve.",
    about_features_title: "Features",
    about_feat_draw: "Vector drawing",
    about_feat_draw_desc: "Points, lines and polygons with an Apple-style palette of 8 colors and 4 marker types.",
    about_feat_io: "Import & Export",
    about_feat_io_desc: "GeoJSON, KML, KMZ, CSV and Shapefile (.zip) with preserved colors.",
    about_feat_ruler: "Distance ruler",
    about_feat_ruler_desc: "Measure multi-segment routes click by click, with results in meters or kilometers.",
    about_feat_ai: "Maña AI",
    about_feat_ai_desc: "Natural language commands: draw points, center the map, switch to satellite and more.",
    about_feat_layers: "Base layers",
    about_feat_layers_desc: "Map view (CartoDB Light) and satellite (Esri World Imagery) with thumbnail selector.",
    about_feat_dd: "Drag & Drop",
    about_feat_dd_desc: "Drag any GeoJSON, KML, KMZ or Shapefile ZIP file directly onto the map.",
    about_tech_title: "Technologies",
    about_more_title: "More",
    about_open_map: "Open Maña Maps",
    about_changelog_desc: "Changelog",
    about_github: "Source code on GitHub",
    about_footer: "Maña Maps — Made with ❤ in Barcelona",
    // ── Changelog page ──
    changelog_back: "Back to map",
    changelog_subtitle: "Changelog and improvements for Maña Maps. All commits, organized by date.",
    changelog_footer: "Maña Maps — Made with ❤ in Barcelona",
    // ── Nav (shared) ──
    nav_open_map: "Open map",
    // ── Categorize / Style by ──
    cat_field: "Field",
    cat_reset: "Reset",
    cat_others: "Others",
    cat_no_values: "No values for this field",
    cat_toast: "Styled by",
    cat_values: "values",
    cat_range: "to",
    // ── Marker types ──
    marker_pin: "Pin",
    marker_circle: "Circle",
    marker_square: "Square",
    marker_diamond: "Diamond",
    marker_triangle: "Triangle",
    marker_star: "Star",
    marker_hexagon: "Hexagon",
    marker_cross: "Cross",
    marker_drop: "Drop",
    marker_flag: "Flag",
    marker_bolt: "Bolt",
    marker_heart: "Heart",
    // ── Nominatim Accept-Language ──
    nominatim_lang: "en",
  }
};

// ── Language detection: localStorage > URL path > browser locale ──
// Spanish-speaking locales (es-ES, es-MX, es-AR, es-CL, ca, gl, eu) → ES
// Everything else → EN
let LANG = (function() {
  var stored = localStorage.getItem('mana-lang');
  if (stored && I18N[stored]) return stored;
  if (window.location.pathname.startsWith('/en')) return 'en';
  var nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  var lang2 = nav.slice(0, 2);
  // Spanish-speaking regions: es-*, ca (Catalan), gl (Galician), eu (Basque)
  if (lang2 === 'es' || lang2 === 'ca' || lang2 === 'gl' || lang2 === 'eu') return 'es';
  return 'en';
})();

// ── Translation function ──
function t(key, params) {
  let str = (I18N[LANG] && I18N[LANG][key]) || I18N['es'][key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace('{' + k + '}', v);
    }
  }
  return str;
}

// ── Apply translations to DOM elements with data-i18n / data-i18n-placeholder ──
function applyTranslations(lang) {
  if (lang && I18N[lang]) LANG = lang;
  localStorage.setItem('mana-lang', LANG);

  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    var val = t(key);
    if (val === key) return; // no translation found
    // If the value contains HTML tags, use innerHTML; otherwise textContent
    if (/<[a-z]/.test(val)) el.innerHTML = val;
    else el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
    var key = el.getAttribute('data-i18n-placeholder');
    var val = t(key);
    if (val !== key) el.placeholder = val;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
    var key = el.getAttribute('data-i18n-title');
    var val = t(key);
    if (val !== key) el.title = val;
  });

  // Update lang toggle button label
  var langLabel = document.querySelector('.tb-lang-label');
  if (langLabel) langLabel.textContent = (LANG === 'es' ? 'EN' : 'ES');

  // Update HTML lang attribute
  document.documentElement.lang = LANG === 'en' ? 'en' : 'es';
}

// ── Toggle language (called from lang button) ──
function toggleLang() {
  LANG = (LANG === 'es') ? 'en' : 'es';
  applyTranslations(LANG);
}

// ── Inline attribute feedback helper ──
function attrInlineFeedback(anchorEl, msg, type) {
  // Remove any existing feedback nearby
  var existing = anchorEl.parentElement.querySelector('.attr-inline-feedback');
  if (existing) existing.remove();

  var span = document.createElement('span');
  span.className = 'attr-inline-feedback ' + (type || 'success');
  span.textContent = msg;
  anchorEl.parentElement.appendChild(span);
  setTimeout(function() { if (span.parentElement) span.remove(); }, 2000);
}
