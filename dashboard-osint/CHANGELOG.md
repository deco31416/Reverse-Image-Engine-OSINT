# Changelog

Todos los cambios notables del dashboard OSINT-Deco se documentan aqui.

## Sin publicar - 2026-10-13

### Changed

* Búsqueda adapta la distribución al ancho real de la tarjeta: campo y botón en una fila cuando hay espacio, foto y opciones en otra; en ventanas estrechas apila los controles. El formulario inicial aprovecha hasta 1040 px.
* Cabecera y controles compactos en ventanas horizontales de poca altura; las opciones avanzadas distribuyen campos según el ancho disponible y la vista ampliada de foto permite desplazamiento vertical.
* Búsqueda de personas comienza con un único campo para nombre, @usuario, correo o teléfono, foto opcional y el botón «Iniciar búsqueda».
* Identidad detallada, contexto, fuentes de imagen y alcance quedan en «Más opciones», conservando sus valores al plegarse y las opciones predeterminadas del API.
* Eliminados el bloque promocional repetido, los contadores vacíos y los paneles de resultados/recientes sin casos. Los resultados priorizan abrir el caso y descargar PDF.
* Validación local antes de crear investigaciones y botón con estado de envío para evitar solicitudes repetidas mientras se procesa.
* Mejora visual adapta sus herramientas a una, dos o tres columnas según el ancho disponible del panel; la comparación usa dos entradas en paralelo cuando hay espacio.
* Menú desplegable en móvil/tablet y barra lateral compacta desde 1280 px, con altura dinámica y navegación sin espacios verticales excesivos.
* Campos y tarjetas pueden reducir su ancho sin desbordar la página; filtros de Evidencias y Datasec mantienen espacio legible para escribir.
* Notificaciones dentro del viewport, cierre con Escape/clic exterior y nombres accesibles para los botones de icono.
* Login y recuperación ajustan tipografía y márgenes en pantallas pequeñas. Tablas amplias usan desplazamiento dentro de su contenedor.

### Verified

* 20 combinaciones de Búsqueda abierta/cerrada, entre 320×568 y 1920×1080, incluidos pares vertical/horizontal y ventana de escritorio de 1280×480: sin desbordamiento horizontal ni campos fuera de la página.
* `pnpm test`: 13 pruebas de interpretación de identidad, validación y compatibilidad con campos opcionales e investigaciones por imagen.
* Búsqueda de personas con opciones plegadas y abiertas: siete tamaños entre 320 y 1920 px sin desbordamiento horizontal; selección, ampliación y retirada de una foto sintética verificadas sin enviar investigaciones.
* Capturas locales `simple-search-desktop.png`, `simple-search-mobile.png` y mediciones `simple-search-verification.json` en `.audit/`, excluida de Git.
* `pnpm run build` correcto, incluidos tipos y páginas.
* Verificación visual y de dimensiones en Chromium local: nueve anchos de Mejora visual entre 320 y 1920 px, 40 combinaciones de ocho secciones, 15 combinaciones de Datasec y 12 de acceso/recuperación, sin desbordamiento horizontal de página.
* Menú móvil, cambio a escritorio, notificaciones y selección de PNG sintético con nombre largo comprobados. No se enviaron investigaciones ni formularios de recuperación.
* Evidencia local excluida de Git en `.audit/responsive-verification.json` y capturas `responsive-mobile.png`, `responsive-tablet.png`, `responsive-desktop.png`.

## 0.4.0 - 2026-06-30

### Added

* Acciones administrativas en Evidencias para limpiar evidencias de un caso, eliminar expediente completo y borrar evidencia individual.
* Modal comercial propio para confirmar acciones sensibles, reemplazando los cuadros nativos del navegador.
* Paginacion local en "Casos recientes" dentro de Evidencias, con 4 casos por pagina y contador total.
* Cliente OSINT con soporte `DELETE` para endpoints administrativos del micro.
* Guia interna de contribucion para equipo, componentes, versionado, changelog, QA y paso a desarrollo.

### Changed

* La consulta de casos recientes ahora solicita hasta 50 investigaciones al micro para evitar que casos antiguos queden ocultos.
* Botones de limpieza alineados al estilo visual `secondary` del dashboard.
* UX de gestion de expediente reforzada para separar actualizar caso, relanzar busqueda y acciones destructivas.
* Licencia MIT actualizada a nombre de OSINT-Deco.

### Tested

* `pnpm run build` OK.

---

## 0.3.0 - 2026-06-18

### Added

* Gestion interna de usuarios desde Configuracion -> Acceso y usuarios.
* Modales comerciales para login exitoso, credenciales invalidas y errores de recuperacion.
* Manejo visible de permisos cuando un rol no puede consultar usuarios.

### Changed

* Registro publico eliminado de UI, API routes y middleware.
* Copy de login simplificado a tres senales comerciales horizontales.
* README actualizado para dejar claro que los usuarios se crean por Owner/Admin.

### Tested

* `pnpm run build` OK.

---

## 0.2.0 - 2026-06-18

### Added

* Pantallas publicas de auth: login, recuperar password y reset password; registro publico eliminado.
* Login hero comercial con señales de acceso por rol, memoria Datasec y evidencia trazable.
* API routes `/api/auth/*` con cookie HTTP-only para sesion del dashboard.
* Middleware que protege `/` y `/api/osint` cuando no hay sesion activa.
* Configuracion -> Acceso y usuarios conectada a sesion real y roadmap visible de email/reset.
* Conexion comercial al micro principal mediante proxy `/api/osint`.
* Vistas operativas: Busqueda OSINT, Rostros, Social Intel, Evidencias, Red y auditoria, Configuracion/Datasec.
* UI comercial para Rostros con upload visual, URL, Datasec, preview, herramientas IA y resultados claros sin JSON tecnico.
* Social Intel con estado comercial de conectores, cards de resultados, galeria, publicaciones, enlaces, filtros y paginacion base.
* Configuracion Datasec con personas, imagenes/senales, importacion, evidencias y perfil/usuario.
* Activos sociales del scraper dentro de Datasec, con accion "Guardar en Datasec".
* Estado de almacenamiento visual para Cloudinary apagado/local volume/Railway volume.
* Notificaciones visibles en lugar de "notificacion global" tecnica.
* Sidebar refinado con iconos lucide, estados colapsados y menos ruido visual.

### Changed

* Version del dashboard subida a `0.2.0`.
* Copy y tarjetas ajustadas para cliente final, reduciendo payloads tecnicos visibles.
* Proxy OSINT prefiere JWT de sesion para trazabilidad y usa API key interna solo como fallback de servicio.

### Tested

* `pnpm run build` OK.
