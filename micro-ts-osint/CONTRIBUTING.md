# Guia interna de contribucion - OSINT-Deco Microservice

Esta guia define como el equipo interno debe trabajar en `micro-ts-osint`, el backend principal NestJS de OSINT-Deco. El objetivo es mantener el micro seguro, versionado, probado, auditable y listo para local/Railway.

## Principios

- Entender el flujo antes de modificar codigo.
- Mantener cada modulo con responsabilidad clara.
- No mezclar conectores, jobs, storage, auth y UI legacy en archivos gigantes.
- No imprimir secretos en logs.
- No hardcodear URLs, claves, passwords, Mongo, Redis ni tokens.
- Todo cambio de contrato HTTP debe actualizar dashboard, README y CHANGELOG.
- Todo cambio que afecte Railway debe reflejarse en la guia externa de variables.

## Stack

- NestJS 11
- TypeScript
- Yarn 4
- MongoDB con Mongoose
- Redis para cache, rate limits y jobs
- Railway Volume / local uploads para storage visual
- Cloudinary disponible como fallback apagable por env
- JWT, roles y API key interna entre micros

## Estructura principal

```text
src/
  auth/
  common/
  osint/
    dto/
    schemas/
    services/
  main.ts

scripts/
docs/
test/
```

## Modulos y responsabilidades

- `auth`: login, usuarios internos, roles, reset password y seeds controlados.
- `osint/services`: orquestacion, motores, evidencias, scoring, Datasec, jobs, storage, social scraper bridge.
- `common/guards`: JWT, roles y proteccion interna.
- `schemas`: modelos Mongo y contratos persistentes.
- `main.ts`: bootstrap, seguridad HTTP, Swagger controlado y auditoria de arranque.

Regla: si un servicio crece demasiado, dividir por responsabilidad antes de agregar mas ramas al mismo archivo.

## Comunicacion entre servicios

Flujo esperado:

```text
dashboard-osint
  -> /api/osint
  -> micro-ts-osint
  -> osint-social-scraper
  -> Mongo / Redis / uploads
```

Reglas:

- El dashboard no llama directo al scraper.
- El scraper debe ser llamado desde `SocialScraperClientService`.
- `MICROSERVICES_API_KEY` y `SOCIAL_SCRAPER_API_KEY` deben coincidir.
- Endpoints administrativos deben exigir rol adecuado.
- Acciones destructivas deben ser explicitas y auditables.

## Variables de entorno

Archivo local:

```text
.env.local
```

Categorias obligatorias:

- Runtime: `NODE_ENV`, `SERVICE_PUBLIC_BASE_URL`, `CORS_ORIGIN`
- Auth: `JWT_SECRET`, `OSINT_INITIAL_OWNER_*`, `AUTH_*`
- Seguridad interna: `MICROSERVICES_API_KEY`
- DB/cache: `MONGODB_URI`, `REDIS_URL`
- Jobs: `OSINT_JOB_*`, `FACE_JOB_*`
- Storage: `CLOUDINARY_ENABLED`, `UPLOAD_DIR`, `UPLOAD_PUBLIC_BASE_URL`
- Social scraper: `SOCIAL_SCRAPER_BASE_URL`, `SOCIAL_SCRAPER_API_KEY`
- Proveedores: Groq, Gemini, Serper, Tavily, RapidAPI, YouTube, etc.

Reglas:

- No commitear `.env.local`.
- No crear env nueva sin documentarla.
- Railway no debe llevar `PORT` manual.
- En production, `ENABLE_SWAGGER=false` salvo autorizacion puntual.
- En production, `DARKWEB_ENABLED=false` si no existe Tor/proxy dedicado.

## Auth y roles

Roles vigentes:

```text
admin
analyst
viewer
```

Reglas:

- No reabrir registro publico sin aprobacion expresa.
- Usuarios se crean desde Owner/Admin.
- Seeds demo solo local/staging y con confirmacion explicita.
- Reset password debe usar token temporal con expiracion.
- No devolver passwords, hashes ni tokens sensibles en respuestas.

## Evidencias y Datasec

Reglas:

- Toda evidencia debe tener `searchId`.
- Usar deduplicacion SHA256 donde aplique.
- Mantener `validationStatus` para positivo/falso positivo/pendiente.
- Borrado de caso o evidencia debe pasar por servicios existentes, no por borrado manual disperso.
- Promocion a Datasec debe preservar origen, tags, fuente y trazabilidad.
- Visual assets deben guardar URL publica y ruta relativa cuando aplique.

## Jobs Redis

Reglas:

- Jobs largos deben ser asincronos.
- No bloquear HTTP con procesos pesados.
- Mantener retries, backoff, timeout y estado consultable.
- Si un job guarda imagen temporal, controlar TTL y limpieza.
- No guardar base64 pesado en Redis mas tiempo del necesario.

## Storage visual

Estrategia actual:

```text
Local: ./uploads
Railway: /app/uploads
URL publica: /uploads/...
```

Reglas:

- Usar `StoragePathService` para ordenar carpetas.
- No hardcodear `/app/uploads` fuera de variables/config.
- Cloudinary debe poder quedar apagado con `CLOUDINARY_ENABLED=false`.
- Railway Volume debe estar montado en `/app/uploads`.

## Logs y observabilidad

Reglas:

- Logs de arranque deben indicar estado de Mongo, Redis, storage, Swagger, CORS y proteccion interna.
- No imprimir secretos.
- Usar severidad clara:
  - OK operativo
  - warning degradado
  - error critico
  - info proceso
- Health endpoints deben ser utiles para dashboard y Railway.

## Swagger

Regla production:

```text
ENABLE_SWAGGER=false
NODE_ENV=production
```

Swagger solo se habilita fuera de production y con flag explicito.

## Flujo de desarrollo

1. Revisar modulo afectado.
2. Identificar contratos HTTP o schema Mongo impactados.
3. Implementar cambio pequeno.
4. Agregar o actualizar tests si toca auth, seguridad, jobs, storage, Datasec o evidencias.
5. Ejecutar tests/build.
6. Actualizar README/CHANGELOG/version si cambia flujo, contrato o despliegue.

Comandos:

```powershell
yarn install
yarn test
yarn build
yarn start:dev
```

Nota interna:

El owner levanta los servicios manualmente en terminal visible. No iniciar servicios ocultos.

## Versionado

Usar semver:

- Patch `2.8.1`: fix pequeno sin contrato nuevo.
- Minor `2.9.0`: nuevo endpoint, modulo, job, integracion o flujo.
- Major `3.0.0`: cambio de contrato amplio o release estable mayor.

Cuando se cambia version:

1. Actualizar `package.json`.
2. Actualizar badge y version en `README.md`.
3. Agregar entrada arriba en `CHANGELOG.md`.
4. Ejecutar `yarn test` si aplica.
5. Ejecutar `yarn build`.

## Changelog

Formato esperado:

```md
## [x.y.z] - YYYY-MM-DD

### Added
- Nuevo comportamiento.

### Changed
- Cambio relevante.

### Fixed
- Bug corregido.

### Security
- Ajuste de seguridad.

### Tested
- `yarn test` OK.
- `yarn build` OK.
```

## QA antes de pasar a desarrollo

Checklist minimo:

- El micro arranca con logs finales claros.
- `/api/v1/osint/health` responde.
- Auth login funciona.
- Usuarios internos funcionan por rol.
- Dashboard puede usar `/api/osint`.
- Crear busqueda OSINT encola job.
- Evidencias se guardan y se pueden consultar.
- Borrado de evidencias/casos funciona solo con rol admin.
- Rostros crea job y reporta progreso.
- Social scraper health y bridge responden si esta configurado.
- Datasec lista personas/assets y permite promocion.
- Storage `/uploads` sirve archivos publicos.
- `yarn test` y `yarn build` pasan.

## Seguridad

- Validar entrada con DTOs/pipes.
- Proteger rutas privadas con JWT/roles/API key segun corresponda.
- Bloquear SSRF en URLs e imagenes externas.
- No aceptar data URIs peligrosas.
- No exponer reset URLs en production.
- No usar seeds demo en production.
- No loguear secretos.
- Mantener CORS limitado a dashboard production/local autorizado.

## Criterio para pasar a developer

Un cambio puede pasar a developer cuando:

- Tiene contrato claro.
- No rompe dashboard.
- Tests/build pasan o se documenta bloqueo.
- Variables nuevas estan documentadas.
- Railway sigue teniendo ruta clara.
- Seguridad revisada en endpoints nuevos.

## Criterio para pasar a QA

Un cambio puede pasar a QA cuando:

- Hay pasos de prueba.
- Hay caso o payload de ejemplo.
- Logs permiten saber si el micro arranco completo.
- El dashboard puede consumir el flujo.
- Errores esperados tienen respuesta entendible.

## Ownership

Proyecto: OSINT-Deco Microservice  
Licencia: MIT  
Owner: OSINT-Deco  
Developed by: deco31416.com
