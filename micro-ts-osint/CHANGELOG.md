# Changelog

Todos los cambios notables en este proyecto serán documentados en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/).

---

## [2.8.0] - 2026-06-30

### Added
- Guia interna de contribucion para arquitectura NestJS, modulos, jobs Redis, Datasec, evidencias, storage, seguridad, versionado, changelog y QA.

### Changed
- Version del micro subida a `2.8.0`.
- Licencia MIT actualizada a nombre de OSINT-Deco.
- README actualizado para enlazar la guia interna y reflejar la nueva version.

### Tested
- `yarn test` OK: 41 tests.
- `yarn build` OK.

---

## [2.7.0] - 2026-06-18

### Added
- Rate limiting Redis para `login`, `forgot-password` y `reset-password`.
- Confirmacion explicita `AUTH_DEMO_USERS_CONFIRM=I_UNDERSTAND_LOCAL_ONLY` para seed demo local/staging.
- Flag `AUTH_EXPOSE_RESET_URL_DEV` para exponer `resetUrl` solo en desarrollo controlado.
- Owner inicial marcado con `mustChangePassword=false` para evitar flujo forzado innecesario en seed inicial.

### Changed
- Registro publico eliminado del contrato HTTP: los usuarios se crean desde Owner/Admin.
- Documentacion de auth actualizada para reflejar plataforma cerrada y usuarios internos.
- Limpieza de imports y configuracion obsoleta asociada a registro publico.

### Tested
- `yarn test` OK: 41 tests.
- `yarn build` OK.

---

## [2.6.0] - 2026-06-18

### Added
- Autenticacion Mongo-backed con usuarios reales, roles `admin/analyst/viewer`, owner inicial por env y hashes `scrypt`.
- Seed local/staging opcional de usuarios demo por rol con correos `yopmail.com`, controlado por `AUTH_SEED_DEMO_USERS`.
- Endpoints de acceso: login, registro publico controlado, perfil actual, gestion admin de usuarios, forgot/reset password y cambio de password.
- Integracion con `osint-social-scraper` mediante cliente interno configurable por `SOCIAL_SCRAPER_BASE_URL`, `SOCIAL_SCRAPER_API_KEY` y timeout.
- Endpoints puente para listar assets sociales, consultar estado del scraper y promover assets sociales positivos a Datasec.
- Datasec interno para personas, activos visuales, evidencias promovidas y trazabilidad de origen OSINT/social.
- Jobs Redis para investigaciones faciales largas, con progreso, cancelacion, TTL de imagenes temporales y controles desde dashboard.
- Cola OSINT general endurecida con retries, delayed jobs, recovery de jobs trabados y estadisticas para operacion.
- Storage local/Railway Volume alternativo a Cloudinary mediante `CLOUDINARY_ENABLED=false`, `UPLOAD_DIR` y `UPLOAD_PUBLIC_BASE_URL`.
- Swagger protegido por flag: activo solo con `ENABLE_SWAGGER=true` fuera de `production`.
- Test UI legacy bloqueada por `ENABLE_TEST_UI=true` y deshabilitada automaticamente en `production`.
- Logs profesionales de arranque con marca `Developed by deco31416.com`, auditoria de Mongo, Redis, storage, Swagger y secretos sin imprimir valores sensibles.

### Changed
- `author` actualizado a `deco31416.com`.
- Descripcion del paquete actualizada al stack real OSINT-Deco.
- Login por env queda reemplazado por usuario sembrado en Mongo cuando `auth_users` esta vacio.
- Esquemas de `OsintSearch` y `DatasecAsset` corregidos para evitar warnings/errores de indices y enums.
- Validacion de URLs e imagenes endurecida para bloquear SSRF, rangos privados, metadatos cloud, IPv6 local y data URIs no permitidos.
- Credenciales dev hardcodeadas removidas de Test UI/Auth Swagger; el login usa variables de entorno.

### Tested
- `yarn test` OK: 41 tests.
- `yarn build` OK.
- Cobertura agregada para Datasec, Cloudinary/local storage, security validation, social scraper client, face investigation jobs, OSINT job queue y controller bridge.

---

## [2.5.1] - 2026-06-15

### Changed
- Logs de arranque profesionalizados con marca `Developed by deco31416.com`, estados operativos por severidad y validacion de variables criticas sin imprimir secretos.
- Swagger queda disponible solo con `ENABLE_SWAGGER=true` y fuera de `production`.
- Versiones de health, Swagger, endpoint v2 y `package.json` quedan sincronizadas.

---

## [2.5.0] - 2026-03-07

### Fixed
- ⏱️ `src/main.ts`: timeout HTTP reducido de 300 s → 55 s y `headersTimeout` de 310 s → 70 s para respetar el límite del proxy de Railway (~60 s) y evitar errores 502

---

## [2.4.0] - 2026-03-06

### Changed
- 🔐 Credenciales hardcodeadas reemplazadas por variables de entorno
- 📝 `.gitignore` corregido: `.yarn/*` con excepciones Berry correctas, `yarn.lock` ya no ignorado globalmente
- 📦 Yarn Berry: `yarn.lock` trackeado en el repo del servicio

---

## [2.3.0] - 2026-02-19

### 🧠 Face Search Pipeline v2 — Gemini 2.5 Flash + Serper Images

Reescritura completa del pipeline de búsqueda facial: Gemini 2.5 Flash como motor de análisis, Serper Images API como motor de búsqueda confiable, y eliminación de dependencias costosas.

---

### ✨ Added

#### Gemini 2.5 Flash — Face Analysis Fallback
- **Auto-fallback**: cuando Vision AI devuelve 403 (billing), Gemini analiza la imagen
- **Análisis completo**: rostros detectados, descripción, labels, emociones, rango de edad, rasgos distintivos
- **Retry con backoff**: reintentos de 15s/30s cuando Gemini devuelve 429 (rate limit)
- **Cuota protegida**: `generateEnhanced: false` en face search para no desperdiciar tokens

#### Serper Images API — Motor de Búsqueda Confiable
- **Google Images via API**: búsqueda por labels de Gemini/Vision (sin scraping)
- **Query inteligente**: construye query con descripción + "face" o labels + "face photo"
- **20 resultados por búsqueda**: thumbnails, links, dominios
- **100% confiable**: usa `SERPER_API_KEY` existente, sin CAPTCHAs ni bloqueos

#### Logging Mejorado en Reverse Image Search
- **Status HTTP + body length**: cada scraper logea respuesta completa
- **Motores siempre registrados**: aun con 0 resultados, aparecen en `searchEnginesUsed`
- **Timeouts + headers mejorados**: 15s timeout, Accept, Accept-Language, maxRedirects

### 🔧 Fixed

#### Gemini Model 404
- **`gemini-1.5-pro`** → **`gemini-2.5-flash`** (modelo estable, no preview/experimental)
- Actualizado en `GeminiImageEnhancementService` y `FaceSearchService`

#### Evidence Validation Errors
- **`category: 'professional'`** → `'social'` (LinkedIn, GitHub, StackOverflow)
- **`category: 'general'`** → `'other'`
- Corregido en 3 servicios: `tavily-search`, `serper-search`, `yandex-image-search`
- Valores ahora coinciden con el enum de `evidence.schema.ts`

#### Face Search Pipeline
- **`generateEnhanced: false`** en `searchByFace` controller — no desperdicia Gemini quota
- Scrapers (Yandex/Google/TinEye) ahora tienen headers completos y timeouts de 15s
- `searchEnginesUsed` se popula correctamente incluso cuando scrapers fallan

### 🏗️ Architecture

```
Face Search v2.3 Pipeline:
  Imagen → Cloudinary (URL pública)
    ↓
  Vision AI → 403? → Gemini 2.5 Flash (fallback automático)
    ↓                   ↓
  labels, descripción, emociones, age range
    ↓
  Sharp → crop rostro → Cloudinary
    ↓
  Búsqueda en paralelo:
    ├── Serper Images API (labels → Google Images) ✅ confiable
    ├── Bing Visual Search (cuando hay key)
    ├── Yandex reverse image (scraping)
    ├── Google reverse image (scraping)
    └── TinEye (scraping)
    ↓
  Deduplicar → Extraer redes sociales → Guardar evidencias
```

---

## [2.2.0] - 2026-02-19

### 🔬 Modo OSINT PRO — Test UI Extension

Extensión modular del Engineering Dashboard con 6 nuevas features de visualización avanzada, integradas como capa aditiva sin modificar código existente.

---

### ✨ Added

#### Test UI — Modo PRO (6 Features)

**1. Score Panel Multi-Dimensional:**
- Barras visuales animadas para Identity / Legal / Financial / Overall
- Colores dinámicos: verde (≥70), amarillo (≥40), rojo (<40), azul (Overall)
- Metadatos de confianza (HIGH/MEDIUM/LOW) y descripción contextual
- Breakdown detallado: total evidencias, alta confiabilidad
- Endpoint: `GET /api/v1/osint/scores/:searchId`

**2. Clusters Alfabéticos:**
- Cards expandibles A-Z con click para ver búsquedas agrupadas
- Status badges por búsqueda + fecha en formato es-MX
- Endpoint: `GET /api/v1/osint/clusters`

**3. Timeline de Investigación:**
- Vista cronológica vertical con línea y dots de color por tipo
- Verde (ok), amarillo (warn), rojo (error/fail)
- Soporta múltiples formatos de respuesta (events/timeline/array)
- Endpoint: `GET /api/v1/osint/timeline/:searchId?format=json`

**4. Resumen Ejecutivo:**
- Markdown completo del reporte renderizado como texto monospace
- Incluye timeline si está disponible
- Endpoint: `GET /api/v1/osint/report/:searchId/markdown?includeTimeline=true`

**5. Score Filter Slider:**
- Slider 0-100% que filtra evidencias en memoria por reliability
- Re-renderiza sin re-fetch al backend
- Variable `_lastEvidences` almacena evidencias para filtro

**6. Pro Toggle Button:**
- Botón con glow dorado cuando activo
- Activa/desactiva todo el panel Pro
- Auto-carga datos si hay searchId disponible

#### Integraciones Automáticas

- `getEvidences()` almacena evidencias en `_lastEvidences` y auto-carga Pro data si activo
- Polling `completed` auto-dispara `loadAllProData()` si Pro está activo
- Todos los endpoints usan `safeJson()`, `esc()`, `createElement` y fail silently con `showAlert('info')`
- Cero `innerHTML` inseguro — todo via DOM API

#### CSS Pro Mode (25+ clases nuevas)

- `.proToolbar`, `.proToggle`, `.proToggle.active` — barra y botón toggle
- `.proPanel`, `.proSection`, `.proSectionHeader`, `.proSectionBody` — layout de paneles
- `.scoreRow`, `.scoreBar`, `.scoreBarFill`, `.scoreLabel` — sistema de barras
- `.scoreBarGreen`, `.scoreBarYellow`, `.scoreBarRed`, `.scoreBarBlue` — colores por rango
- `.scoreMeta`, `.scoreMetaItem` — metadatos de confianza
- `.clusterCard`, `.clusterCardHeader`, `.clusterBody`, `.clusterItem` — clusters expandibles
- `.timeline`, `.timelineItem`, `.timelineDot`, `.timelineContent` — timeline vertical
- `.dotOk`, `.dotWarn`, `.dotErr` — dots de color por tipo de evento
- `.executiveSummary` — contenedor monospace para markdown
- `.proSliderWrap`, `.proSliderVal` — slider de filtro
- Responsive: `@media(max-width:768px)` para toolbar vertical

### 📝 Notes

- **Zero breaking changes** — código existente intacto al 100%
- **Pure additive** — solo inserciones, sin modificaciones ni eliminaciones
- **File growth**: `test-ui.controller.ts` de 1011 → ~1360 líneas
- **Build**: ✅ `yarn build` exit code 0

---

## [2.1.0] - 2026-02-19

### 🛡️ Elite Network Scheduler & Anti-Detection Architecture

Reescritura completa del sistema de red con arquitectura anti-detección de nivel profesional, perfiles de caso operacionales y logging OPSEC-safe.

---

### ✨ Added

#### NetworkSchedulerService v2 — Elite Rewrite (820 líneas)

**Global Governor:**
- `enforceGlobalLimits()` — controla concurrencia global (max 6) + rate limit por minuto (max 70) con cooldown adaptativo
- Cooldown dinámico cuando se alcanza el límite de rate: espera hasta que se libere la ventana

**4 Case Profiles Operacionales:**
- `silent` — 2 conexiones concurrentes, 20 req/min, sin Tier 2, delays ×2.0
- `stealth` — 4 conexiones, 50 req/min, sin Tier 2, delays ×1.5
- `standard` — 6 conexiones, 70 req/min, Tier 2 habilitado, delays ×1.0
- `aggressive` — 8 conexiones, 100 req/min, Tier 2 + deep search, delays ×0.7
- `applyCaseProfile()` / `getCaseProfile()` — cambiar perfil en runtime

**Distribución Exponencial de Delays:**
- `randomExp(mean)` — distribución exponencial en lugar de uniforme para simular comportamiento humano
- Delays dinámicos: penalización automática por failures (+50% al min delay) y alta latencia (+30%)
- `dynamicMin()` / `dynamicMax()` — adaptan delays basándose en historial del dominio

**Anti-Detección:**
- `globalJitter()` — micro-delay aleatorio entre requests cross-domain × delayMultiplier
- `stealthCooldown()` — pausa human-like cada N requests (configurable por perfil: silent cada 3, aggressive cada 30)
- Shadow-ban detection: 12+ failures consecutivos con 0 éxitos → auto-pausa del dominio 2 minutos
- Cooldown escalante: `1.5^openCount × baseTimeout`, tope 5 minutos

**Telemetría:**
- `recordLatency(domain, ms)` — rolling window de 20 muestras por dominio
- `recordLedger()` — auditoría de últimos 500 eventos con queries hasheados (SHA256, sin PII)
- `getStats()` — métricas completas: global governor, colas por dominio, circuit breakers, cache, latencia
- `getLedger()` — log de eventos OPSEC-safe

**Cache In-Memory:**
- `scheduleWithCache(domain, queryKey, operation, ttl)` — deduplicación de queries idénticos con TTL configurable
- Evita requests duplicados al mismo dominio con la misma query

**Configuración de Dominios Refinada:**
- DuckDuckGo: concurrency=1, delay 1500-4000ms (antes: 2, 800-2500ms)
- Yandex: concurrency=1, delay 1200-3500ms
- WebArchive: concurrency=1, delay 800-2500ms
- SearXNG: concurrency=3, delay 600-2000ms
- Bing/Serper/Tavily/YouTube: concurrency=3, delays conservadores

---

#### MultiSearchOrchestratorService — Case Profile Integration (940 líneas)

**Query Budgets por Perfil:**
- `silent`: max 12 queries (4 main + 5 site)
- `stealth`: max 15 queries (5 main + 6 site)
- `standard`: max 20 queries (6 main + 8 site)
- `aggressive`: max 35 queries (8 main + 15 site)

**Motores Tiered:**
- **Tier 1** (siempre activos): SearXNG, Bing, Serper (web+images+news), Tavily, YouTube
- **Tier 2** (solo si `caseProfile.allowTier2`): DuckDuckGo, Reverse Image Search (Google+TinEye, Yandex)

**Hashed Logging (OPSEC):**
- `hashQ()` — hash SHA256 truncado a 8 chars para logging seguro
- Todos los logs de queries usan hash en lugar de texto plano: `DDG:q#a1b2c3d4`
- Cero PII en consola/logs

**Site Prioritization Tiered:**
- Priority 1 (siempre): social (11 sitios) + professional (9 sitios)
- Priority 2 (standard+): gobierno MX (8) + trading (10) + content (8) + international (5)
- Priority 3 (aggressive only): blogs (5) + music (6) + ecommerce (3) + academic (3) + directorios (2) + otros (6)

---

#### Nuevos Endpoints de Diagnóstico

| Method | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/v1/osint/internal/network-stats` | Métricas en tiempo real: governor, colas, circuit breakers, cache, latencia |
| GET | `/api/v1/osint/internal/network-ledger` | Auditoría de requests (hashed, sin PII). Filtrable por `?domain=` |
| POST | `/api/v1/osint/internal/case-profile` | Cambiar perfil: `{"profile": "stealth"}` |

---

### 🐛 Fixed

- **Bing double API call** — `isAvailable()` ya no hace fetch, solo verifica API key
- **Rate limit fail-closed** — Redis desconectado ahora bloquea en lugar de permitir tráfico libre
- **getStats() OOM** — ya no carga todas las evidencias en memoria, usa `countDocuments()`
- **Orchestrator duck-typing** — reemplazado por `_source` tags explícitos en cada resultado

### 🔧 Changed

- DuckDuckGo degradado a Tier 2 por alto riesgo de bloqueo
- Reverse Image Search degradado a Tier 2 para perfiles conservadores
- Delays de DuckDuckGo aumentados: 1500-4000ms (antes 800-2500ms)
- Concurrencia de DuckDuckGo reducida a 1 (antes 2)
- Todos los delays ahora usan distribución exponencial en lugar de uniforme
- Query budget enforcement previene scraping storms

---

## [2.0.0] - 2025-02-17

### 🎉 Major Release - Complete OSINT System Rewrite

Esta es una **reescritura completa** del sistema OSINT con arquitectura multi-modal, multi-motor de búsqueda, y capacidades avanzadas de IA.

---

## ✨ Added

### Phase 1: Foundation System (Schemas + Base Services)

**Schemas:**
- `Evidence.schema.ts` - Sistema de evidencias con deduplicación SHA256
  - Campos: `searchId`, `source`, `url`, `title`, `description`, `content`, `metadata`, `extractedData`, `reliability`, `category`, `hash`, `scraped`
  - Deduplicación automática por hash SHA256
  - Timestamps automáticos (createdAt, updatedAt)

- `AuditLog.schema.ts` - Sistema de auditoría para compliance
  - Campos: `action`, `resource`, `userId`, `details`, `ip`, `userAgent`, `status`, `duration`
  - Indexado por userId, action, timestamp
  - Tracking completo de operaciones

- `OsintSearch.schema.ts` - Búsquedas OSINT con estado
  - Campos: `query`, `userId`, `status`, `imageUrl`, `enhancedImageUrl`, `scores`, `stats`, `clusterLetter`, `options`, `requestIp`, `userAgent`
  - Estados: pending, processing, completed, failed
  - Scores multi-dimensionales: identity, legal, financial
  - Agrupación alfabética por cluster (A-Z)

**Services:**
- `EvidenceService` - CRUD de evidencias + deduplicación
  - `createEvidence()` - Creación con deduplicación automática
  - `findBySearchId()` - Filtrado por source, category, limit
  - `calculateStats()` - Estadísticas: total, sources, categories, reliability promedio
  - `extractStructuredData()` - Extrae emails, phones, RFCs, CURPs, URLs con regex

- `RateLimitService` - Rate limiting basado en Redis
  - `checkLimit()` - Verifica límites diarios/minutales
  - `incrementUsage()` - Incrementa contadores con TTL
  - `getRemainingRequests()` - Requests restantes
  - `getServiceUsage()` - Uso detallado por servicio
  - Servicios soportados: groq (600/day, 10/min), gemini (1500/day, 15/min), bing (1000/day, 30/min), youtube (10K units/day)

- `RegexExtractorService` - Extracción con regex
  - `extractEmails()` - Emails válidos
  - `extractPhones()` - Teléfonos MX/US/internacional
  - `extractRFCs()` - RFCs mexicanos válidos (13 chars)
  - `extractCURPs()` - CURPs mexicanos válidas (18 chars)
  - `extractUrls()` - URLs completas
  - Patrones optimizados para alta precisión

- `AuditLogService` - Logging de auditoría
  - `createLog()` - Crear log con contexto completo
  - `findByUser()` - Logs por usuario
  - `findByAction()` - Logs por acción
  - `getStatistics()` - Stats de 30 días (total logs, top users, top actions)

- `ScoringService` - Scoring multi-dimensional
  - `calculateScores()` - Calcula identity (45%), legal (35%), financial (20%)
  - `getScoreExplanation()` - Descripción del score
  - `getConfidenceLevel()` - HIGH/MEDIUM/LOW
  - `calculateDetailedBreakdown()` - Desglose detallado con pesos

- `ClusteringService` - Agrupación alfabética
  - `assignCluster()` - Asigna letra A-Z basado en query
  - `getClusterLetter()` - Obtiene letra normalizada
  - `getClustersWithStats()` - Estadísticas por cluster (A-Z con counts)

---

### Phase 2: Multi-Modal Input System

**DTOs:**
- `image-input.dto.ts` - Input de imagen multi-fuente
  - `ImageSource` enum: camera, datasec, osint, upload
  - Soporta: URL, base64, cameraId, datasecImageId, osintSearchId
  - Validación condicional basada en source

- `personal-info.dto.ts` - Información personal conocida
  - Campos: nombre, apellido, username, email, telefono, ciudad, pais, fechaNacimiento, alias, RFC, CURP
  - Todos opcionales para búsquedas parciales
  - Validación con class-validator

- `context.dto.ts` - Contexto adicional de búsqueda
  - Campos: organizacion, cargo, industria, notas, educacion, intereses
  - Uso: Enriquecer query de búsqueda

- `search-options.dto.ts` - Opciones configurables
  - `searchEngines[]`: google, bing, duckduckgo, yandex, tineye
  - Flags: deepSearch, youtubeSearch, webArchiveSearch, useGoogleVision, enableCrawler, cacheResults, enableDeduplication
  - `crawlStrategy`: fast, standard, deep
  - `maxPagesPerUrl`: 1-50 (default: 3)
  - `searchTimeout`: 5000-60000ms (default: 30000ms)

- `expanded-person-search.dto.ts` - DTO principal de request
  - Combina: image + personalInfo + context + options
  - Validación: Requiere al menos image O personalInfo
  - Response DTO: `OsintSearchResponseDto` con searchId, query, clusterLetter, enhancedImageUrl, status, createdAt

**Services:**
- `InputOrchestratorService` - Orquestación de input multi-modal
  - `processInput()` - Valida input, genera query, mejora imagen, crea búsqueda
  - `validateInput()` - Asegura al menos image O personalInfo
  - `generateQuery()` - Genera query optimizado combinando todos los datos
  - `generateImageContext()` - Contexto para Gemini image enhancement
  - Dependencias: OsintSearchModel, ClusteringService, AuditLogService, GeminiImageEnhancementService, CloudinaryService
  - Proceso: validación → query generation → image enhancement → cluster assignment → MongoDB creation → audit log

---

### Phase 3: Multi-Motor Search System

**Services:**
- `BingSearchService` - Integración con Bing Search API v7
  - API: `https://api.bing.microsoft.com/v7.0/search`
  - Rate limiting: 1000/day, 30/min
  - Auto-save evidences a MongoDB
  - Extrae emails, phones, URLs de snippets
  - Env vars: `BING_SEARCH_API_KEY`, `BING_SEARCH_ENDPOINT`
  - Categoría: `search_result`

- `DuckDuckGoSearchService` - Web scraping sin API key
  - API: `https://html.duckduckgo.com/html/` (POST con form data)
  - Parsing con Cheerio
  - Limpieza de URLs de redirect
  - Auto-save evidences a MongoDB
  - NO requiere API key (gratis)
  - Nota: Legal pero puede ser bloqueado si se abusa
  - Categoría: `search_result`

- `YouTubeSearchService` - YouTube Data API v3
  - API: `https://www.googleapis.com/youtube/v3/search`
  - Rate limiting: 10,000 units/day (1 search = 100 units)
  - Extrae: videoId, title, description, channelTitle, thumbnailUrl
  - Auto-save evidences a MongoDB
  - Env vars: `YOUTUBE_API_KEY`
  - Categoría: `video`

- `WebArchiveService` - Internet Archive Wayback Machine
  - API: `https://web.archive.org/cdx/search/cdx`
  - NO requiere API key (gratis)
  - Búsqueda histórica de snapshots
  - `checkAvailability()` - Verifica si URL existe en archivo
  - `search()` - Busca snapshots por URL
  - Formato timestamp: YYYYMMDDHHMMSS
  - Agrupación por año/mes
  - Uso: Perfiles eliminados, páginas antiguas, biografías modificadas
  - Categoría: `archived_page`

- `MultiSearchOrchestratorService` - Orquestador de búsqueda paralela
  - `executeSearch()` - Ejecuta todas las búsquedas en paralelo
  - Flujo:
    1. Fetch OsintSearch de MongoDB
    2. Búsquedas en paralelo con Promise.allSettled:
       - Bing (si enabled + API key)
       - DuckDuckGo (si enabled)
       - YouTube (si enabled + API key)
       - Reverse image search (si image exists)
    3. Web crawling (si enableCrawler)
    4. Web Archive search (si webArchiveSearch)
    5. Calculate scores con ScoringService
    6. Update search status a 'completed'
    7. Audit log con duración total
  - Manejo robusto de errores (no falla si un motor falla)
  - Dependencias: Todos los search services, EvidenceService, ScoringService, AuditLogService

---

### Phase 4: AI Vision System

**Services:**
- `GoogleVisionService` - Google Vision AI wrapper
  - **Estado actual**: Stub implementation (API calls comentadas hasta instalar @google-cloud/vision)
  - Capacidades cuando se active:
    - **Face Detection**: emotions, edad, género, facial hair, glasses, headwear
    - **Text Detection (OCR)**: texto completo, palabras individuales, idioma
    - **Label Detection**: descripciones con scores
    - **Object Detection**: nombres con confidence
    - **Logo Detection**: brand logos
    - **Landmark Detection**: landmarks geográficos
    - **SafeSearch**: adult, violence, racy, medical, spoof
    - **Image Properties**: colores dominantes
  - Métodos:
    - `analyzeImage()` - Análisis completo con todas las features
    - `analyzeFaces()` - Solo face detection (rápido)
    - `extractText()` - Solo OCR
    - `detectObjects()` - Objects + labels
  - Auto-save evidences a MongoDB
  - Env vars: `GOOGLE_APPLICATION_CREDENTIALS` (path a service-account.json), `GOOGLE_CLOUD_PROJECT_ID`
  - Categoría: `google_vision`
  - **TODO**: Instalar `@google-cloud/vision` y descomentar código

---

### Phase 5: Reports & Timeline System

**Services:**
- `MarkdownReportGeneratorService` - Generador de reportes Markdown
  - `generateReport()` - Genera reporte completo
  - Secciones:
    1. **Header**: searchId, query, status, fechas, evidence count, cluster
    2. **Executive Summary**: counts, sources, categories, top scores
    3. **Scores Analysis**: ASCII progress bars, breakdown multi-dimensional
    4. **Input Data**: image, personalInfo, context, options
    5. **Evidences Table**: # | Source | Category | URL | Reliability | Timestamp
    6. **Extracted Data**: emails, phones, RFCs, CURPs, URLs agrupados
    7. **Timeline**: lista cronológica con fechas
    8. **Sources Breakdown**: tabla con counts y percentages
    9. **Footer**: fecha de generación, copyright
  - Features:
    - ASCII progress bars: `[████████░░] 80%`
    - `saveToFile` option para guardar a disco
    - `includeRawData` para detalles completos de evidencias
  - Output: String Markdown completo

- `PdfReportGeneratorService` - Generador de reportes PDF
  - `generatePdf()` - Convierte Markdown a PDF diseñado
  - Proceso:
    1. Genera Markdown con MarkdownReportGeneratorService
    2. Convierte Markdown → HTML (parser simplificado, producción usar 'marked' o 'markdown-it')
    3. Aplica CSS profesional:
       - Font: Segoe UI
       - Color scheme: #2c3e50, #3498db, #27ae60
       - Tables responsive con borders
       - Score bars visuales
    4. Puppeteer headless browser genera PDF
  - PDF Options:
    - Format: A4 / Letter
    - Orientation: portrait / landscape
    - Margins: 20mm top/bottom, 15mm left/right
    - printBackground: true
  - Output: Buffer (PDF binary)
  - Dependencias: puppeteer, MarkdownReportGeneratorService

- `TimelineGeneratorService` - Generador de timeline cronológico
  - `generateTimeline()` - Timeline de evidences con filters
  - Filtros:
    - `startDate`, `endDate` - Rango de fechas
    - `sources[]` - Array de sources
    - `categories[]` - Array de categorías
    - `sortOrder`: asc / desc
    - `limit` - Máximo de entries
  - Grouping:
    - by_month: YYYY-MM
    - by_year: YYYY
  - Timeline entries: timestamp, source, category, title, description, url, reliability
  - Export methods:
    - `exportToMarkdown()` - Formato Markdown con bullets
    - `exportToJson()` - Formato JSON estructurado
  - Output: `TimelineResponse` con entries, summary (totalEntries, dateRange, topSources)

---

### Controller: Complete REST API

**OsintControllerV2:**
- **Route Prefix**: `/api/v1/osint`
- **Total Endpoints**: 15
- **Swagger**: All endpoints documented with @ApiOperation, @ApiParam, @ApiQuery, @ApiResponse

**Search Endpoints:**
1. `POST /search` - Create multi-modal search
   - Body: ExpandedPersonSearchDto
   - Response: OsintSearchResponseDto (searchId, query, clusterLetter, etc.)
   - Proceso: Async execution, respuesta inmediata
   - Status code: 201

2. `GET /search/:searchId` - Get search status
   - Params: searchId (MongoDB ObjectId)
   - Response: Full search object con scores y stats
   - Status code: 200

**Evidence Endpoints:**
3. `GET /evidence/:searchId` - List evidences con filtros
   - Params: searchId
   - Query: source?, category?, limit? (default: 100)
   - Response: Array de evidences
   - Status code: 200

4. `GET /evidence/:searchId/stats` - Evidence statistics
   - Params: searchId
   - Response: total, sources (con counts), categories (con counts), avgReliability
   - Status code: 200

**Scoring Endpoints:**
5. `GET /scores/:searchId` - Multi-dimensional scores
   - Params: searchId
   - Response: total, breakdown (identity/legal/financial con scores y pesos), confidenceLevel, description
   - Status code: 200

**Clustering Endpoints:**
6. `GET /clusters` - Alphabetical clusters (A-Z)
   - Response: Array de clusters con letter, count, searches
   - Status code: 200
   - **TODO**: Implementar método en ClusteringService

**Report Endpoints:**
7. `GET /report/:searchId/markdown` - Generate Markdown report
   - Params: searchId
   - Query: includeRawData? (default: false), saveToFile? (default: false)
   - Response: String Markdown
   - Status code: 200

8. `GET /report/:searchId/pdf` - Generate PDF report
   - Params: searchId
   - Query: format? (A4/Letter), orientation? (portrait/landscape)
   - Response: StreamableFile (binary PDF) con headers Content-Type y Content-Disposition
   - Status code: 200

**Timeline Endpoints:**
9. `GET /timeline/:searchId` - Generate timeline
   - Params: searchId
   - Query: format? (json/markdown), startDate?, endDate?, sources?, categories?, sortOrder? (asc/desc), limit?
   - Response: TimelineResponse (si json) o String (si markdown)
   - Status code: 200

**Rate Limiting Endpoints:**
10. `GET /rate-limits` - All services usage stats
    - Response: Object con groq, gemini, bing, youtube (cada uno con dailyLimit, dailyUsed, minuteLimit, minuteUsed, dailyRemaining, minuteRemaining)
    - Status code: 200

11. `GET /rate-limits/:service` - Specific service usage
    - Params: service (groq, gemini, bing, youtube)
    - Response: dailyLimit, dailyUsed, minuteLimit, minuteUsed, dailyRemaining, minuteRemaining
    - Status code: 200

**Audit Log Endpoints:**
12. `GET /audit-logs` - Query logs con filtros
    - Query: action?, userId?, limit? (default: 100)
    - Response: Array de audit logs
    - Status code: 200
    - **TODO**: Implementar getAuditLogs() en AuditLogService

13. `GET /audit-logs/stats` - 30-day statistics
    - Response: totalLogs, topUsers, topActions
    - Status code: 200

**Google Vision Endpoints:**
14. `POST /vision/analyze` - Analyze image
    - Body: { imageUrl, options }
    - Response: VisionAnalysisResult (faces, text, labels, objects, logos, landmarks, safeSearch, imageProperties)
    - Status code: 200

**Health Check:**
15. `GET /health` - Health check con service availability
    - Response: status ('ok'), timestamp, services (bingSearch, googleVision, youtube - cada uno con available boolean)
    - Status code: 200

---

### Swagger Documentation

**Enhanced Configuration:**
- Title: "🔍 OSINT Microservice API - God-Level Edition"
- Description: Markdown completo con features, stack, rate limits
- Version: 2.0.0
- Contact: dev@osint-system.com
- License: MIT
- Tags:
  - OSINT v2
  - Evidence
  - Scoring
  - Reports
  - Timeline
  - Rate Limits
  - Audit Logs
  - Vision AI
- Bearer Auth: JWT-auth con descripción
- Servers:
  - http://localhost:7105 (Local Development)
  - https://osint.railway.app (Production - Railway)
- Custom CSS: Oculta topbar, mejora info section
- Swagger Options:
  - persistAuthorization: true
  - docExpansion: 'list'
  - filter: true
  - showRequestDuration: true
  - syntaxHighlight con tema monokai

**DTO Decorators:**
Todos los DTOs tienen decorators completos:
- @ApiProperty() / @ApiPropertyOptional()
- description
- example
- type / enum
- default values

**Endpoint URL:** http://localhost:7105/api/docs

---

### API Versioning

- Global prefix: `/api/v1` (configurado en main.ts)
- All OSINT v2 routes: `/api/v1/osint/*`
- Backward compatibility: OsintController (legacy) mantiene rutas antiguas
- Versioning strategy: URI path versioning (estándar de industria)

---

## 🔧 Changed

### Architecture:
- **Multi-modal input architecture** - Soporta imagen + datos personales + contexto
- **Async search execution** - POST /search retorna inmediatamente, búsqueda ejecuta en background
- **SHA256 deduplication** - Previene evidencias duplicadas
- **Multi-dimensional scoring** - Identity (45%), Legal (35%), Financial (20%)
- **Alphabetic clustering** - Organización A-Z para buscar búsquedas
- **Redis rate limiting** - Previene exceso de costos en APIs de pago

### Evidence System:
- **Extractores automáticos** - emails, phones, RFCs, CURPs, URLs extraídos de todo contenido
- **Reliability scoring** - 0.0-1.0 basado en source y categoría
- **Categorización automática** - search_result, video, crawled_page, archived_page, google_vision
- **Metadata enriquecido** - JSON flexible para metadata específica por source

### Scoring Algorithm:
- **Pesos optimizados**:
  - Identity: 45% (reconocimiento facial, biométricos)
  - Legal: 35% (RFCs, CURPs, documentos oficiales)
  - Financial: 20% (menos crítico para OSINT)
- **Confidence levels**: HIGH (>0.8), MEDIUM (0.5-0.8), LOW (<0.5)
- **Breakdown detallado** - Score por dimensión con explicación

---

## 🐛 Fixed

### Phase 1:
- Fixed deduplication race condition con índice unique en Evidence.hash
- Fixed rate limit TTL con Redis expiration correcto
- Fixed regex extractors para soportar formatos internacionales

### Phase 3:
- Fixed DuckDuckGo redirect URL cleaning con regex mejorado
- Fixed YouTube API unit calculation (1 search = 100 units)
- Fixed Web Archive timestamp parsing (YYYYMMDDHHMMSS → Date object)

### Phase 5:
- Fixed Markdown table formatting con padding correcto
- Fixed PDF generation con printBackground: true para colores
- Fixed timeline grouping con agrupación correcta por mes/año

---

## 🔒 Security

### Rate Limiting:
- Redis-based para prevenir abuse
- Límites por servicio configurables
- Tracking de IP y userAgent en audit logs

### API Keys:
- Environment variables para todas las APIs externas
- Nunca exponer keys en responses
- Graceful degradation si API key falta (servicio se salta)

### Audit Logging:
- Tracking completo de operaciones críticas
- Logs incluyen: userId, IP, userAgent, acción, recurso, duración
- Retention: 90 días (configurable)

### Input Validation:
- class-validator en todos los DTOs
- Sanitización de inputs
- ValidationPipe con whitelist: true (strip unknown props)

---

## 📚 Documentation

### Code Documentation:
- JSDoc comments en todos los services
- Inline comments para lógica compleja
- **README.md completamente reescrito** con v2.0.0 features (540+ líneas)
  - Documentación completa de 15 REST API endpoints
  - Guía de instalación y configuración
  - Ejemplos de uso multi-modal
  - Arquitectura detallada con diagramas
  - Deployment en Railway
  - Testing guide

### API Documentation:
- Swagger UI completa en /api/docs
- **God-Level Description** con features destacadas
- Ejemplos de request/response en cada endpoint
- Tags para organización por feature
- Rate limits documentados
- Security schemas

### Architecture Documentation:
- README.md sección Arquitectura (actualizado)
- Este CHANGELOG.md con detalles completos (722 líneas)
- **docs/ folder eliminado** - Documentación obsoleta removida
  - MASTER-IMPLEMENTATION-PLAN.md (obsoleto - features implementados)
  - python-best-practices-extraction.md (obsoleto - patrones implementados)
  - osint-escalable-operador-demo.md (obsoleto - arquitectura implementada)
  - Total: ~5,000 líneas de propuestas → código funcional implementado

---

## 🚀 Deployment

### Railway Configuration:
- **Platform**: Railway (NO Docker, NO AWS per user requirement)
- **Port**: 7105
- **Package Manager**: Yarn 4.12.0
- **Build Command**: `yarn build`
- **Start Command**: `yarn start:prod`

### Environment Variables Required:
```env
# MongoDB
MONGODB_URI=<connection_string>

# Redis
REDIS_HOST=<host>
REDIS_PORT=<port>
REDIS_PASSWORD=<password>

# AI Services (Required)
GROQ_API_KEY=<key>
GEMINI_API_KEY=<key>

# Image Storage (Required)
CLOUDINARY_CLOUD_NAME=<name>
CLOUDINARY_API_KEY=<key>
CLOUDINARY_API_SECRET=<secret>

# Search APIs (Optional - services skip if not present)
BING_SEARCH_API_KEY=<key>
YOUTUBE_API_KEY=<key>

# Google Vision AI (Optional)
GOOGLE_APPLICATION_CREDENTIALS=<path_to_service_account_json>
GOOGLE_CLOUD_PROJECT_ID=<project_id>

# Other
HTTPS_REDIRECT_ENABLED=true # Production only
CORS_ORIGIN=https://osint-frontend.railway.app
```

---

## 📦 Dependencies Added

### Phase 3:
- `cheerio` - HTML parsing para DuckDuckGo scraping
- Instalación: `yarn add cheerio`

### Phase 4:
- `@google-cloud/vision` - Google Vision AI SDK
- Instalación: `yarn add @google-cloud/vision`
- **Estado**: Pendiente instalación, código en stub mode

### Phase 5:
- `puppeteer` - Ya instalado previamente (PDF generation)
- `marked` o `markdown-it` - **Recomendado** para producción (Markdown → HTML parser, actualmente usando parser simplificado)

---

## 🧪 Testing

### Pending Tasks:
- [ ] E2E testing de todos los endpoints
- [ ] Verificar Swagger UI en http://localhost:7105/api/docs
- [ ] Test con MongoDB real (local o Atlas)
- [ ] Test con Redis real (local o Upstash)
- [ ] Test rate limiting con múltiples requests
- [ ] Test deduplication con evidencias duplicadas
- [ ] Test PDF generation con estilos correctos
- [ ] Test timeline grouping por mes/año
- [ ] Test Google Vision AI cuando se instale SDK
- [ ] Load testing para verificar performance

### Test Commands:
```bash
# Unit tests
yarn test

# E2E tests
yarn test:e2e

# Coverage
yarn test:cov

# Watch mode
yarn test:watch
```

---

## 🎯 Breaking Changes

### v2.0.0 introduces breaking changes:

1. **New API prefix**: Todas las rutas ahora usan `/api/v1/osint` (legacy `/api/osint` todavía disponible en OsintController)

2. **New search DTO**: Use `ExpandedPersonSearchDto` en lugar de `PersonSearchDto` (legacy)
   - Cambio: Soporta multi-modal input (image + personalInfo + context)
   - Migration: Convertir requests antiguos a nuevo formato

3. **Search execution**: POST /search ahora es **async** (respuesta inmediata, ejecución en background)
   - Cambio: Antes esperaba a completar búsqueda
   - Migration: Poll GET /search/:searchId para obtener resultados

4. **Evidence deduplication**: Automática por hash SHA256
   - Cambio: Antes permitía duplicados
   - Impact: Menos evidencias pero mayor calidad

5. **Scoring algorithm**: Multi-dimensional con nuevos pesos
   - Cambio: Identity 45%, Legal 35%, Financial 20%
   - Impact: Scores diferentes a versión anterior

---

## 🔮 Future Plans

### Phase 6: Advanced Features (TODO)
- [ ] Real-time WebSocket notifications para progress de búsquedas largas
- [ ] Elasticsearch integration para full-text search
- [ ] Graph database (Neo4j) para relaciones entre personas
- [ ] Facial recognition con AWS Rekognition o Azure Face API
- [ ] Social media APIs (Twitter, Facebook, Instagram, LinkedIn)
- [ ] Dark web monitoring con Tor integration
- [ ] Machine learning models para entity resolution
- [ ] Automated report delivery via email/Slack/Discord

### Performance Optimizations:
- [ ] Bull Queue para async job processing
- [ ] Redis caching para evidences frecuentemente accessed
- [ ] Database indexing optimization
- [ ] CDN para static assets
- [ ] Compression middleware
- [ ] Query result pagination mejorado

### Compliance & Security:
- [ ] GDPR compliance features (right to be forgotten)
- [ ] Data retention policies automatizadas
- [ ] Encryption at rest para evidencias sensibles
- [ ] Two-factor authentication para API access
- [ ] Webhook signing para seguridad
- [ ] IP whitelisting/blacklisting

---

## 📞 Support & Contributing

**Issues**: https://github.com/your-org/osint-microservice/issues  
**Pull Requests**: https://github.com/your-org/osint-microservice/pulls  
**Email**: dev@osint-system.com  
**Documentation**: https://docs.osint-system.com

**Contributing Guidelines**: See CONTRIBUTING.md

---

## 📄 License

MIT License - See LICENSE file for details

---

## 👥 Credits

**Development Team**:
- Lead Developer: [Your Name]
- AI Assistant: GitHub Copilot (Claude Sonnet 4.5)

**Open Source Dependencies**:
- NestJS - MIT License
- Mongoose - MIT License
- Redis - BSD License
- Puppeteer - Apache 2.0
- Cheerio - MIT License
- Google Cloud Vision - Apache 2.0

---

**Full Changelog**: https://github.com/your-org/osint-microservice/compare/v1.0.0...v2.0.0
