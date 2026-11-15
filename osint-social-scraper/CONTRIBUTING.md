# Guia interna de contribucion - OSINT Social Scraper

Esta guia define como el equipo interno debe trabajar en `osint-social-scraper`, el microservicio de apoyo social de OSINT-Deco.

## Principios

- Mantener cada red social en su propia carpeta/adaptador.
- No mezclar Instagram, Facebook, TikTok, X, YouTube u otros proveedores en un archivo gigante.
- No hardcodear API keys, URLs privadas, Mongo, Redis ni tokens.
- No imprimir secretos en logs.
- Guardar activos visuales de forma ordenada y reutilizable por Datasec.
- El scraper apoya a `micro-ts-osint`; no reemplaza el micro principal.
- Toda respuesta debe ser normalizada para que el dashboard y el micro principal no dependan del formato de cada proveedor.

## Stack

- NestJS 11
- TypeScript
- Yarn 4
- MongoDB para busquedas sociales y assets
- Redis para cache
- Railway Volume / local uploads para imagenes
- Puppeteer/Cheerio para capacidades web controladas
- API key interna `MICROSERVICES_API_KEY`

## Estructura esperada

```text
src/
  assets/
  cache/
  common/
    guards/
  database/
  health/
  social/
    adapters/
      facebook/
      instagram/
      tiktok/
      x/
      youtube/
      telegram/
      threads/
      bluesky/
      github/
      reddit/
      pinterest/
      medium/
    dto/
    normalizer/
    types/
    visual/
  storage/
  main.ts
```

## Reglas de adaptadores

- Cada plataforma vive en `src/social/adapters/<platform>`.
- Cada adaptador debe implementar el contrato `SocialAdapter`.
- La salida debe pasar por `SocialNormalizerService`.
- Si una plataforma falla, no debe tumbar toda la busqueda.
- Los errores por proveedor deben regresar como `errors`, no como crash general.
- Las URLs candidatas deben marcarse con confianza realista.

## Comunicacion entre micros

Flujo correcto:

```text
dashboard-osint
  -> micro-ts-osint
  -> osint-social-scraper
  -> Mongo / Redis / uploads
```

Reglas:

- El navegador no debe llamar directo a este scraper.
- `micro-ts-osint` debe mandar `x-api-key`.
- `MICROSERVICES_API_KEY` en scraper debe coincidir con `SOCIAL_SCRAPER_API_KEY` en micro principal.
- El scraper debe exponer health claro para auditoria.

## Variables de entorno

Archivo local:

```text
.env.local
```

Variables principales:

```env
NODE_ENV=development
ENABLE_SWAGGER=true
SERVICE_PUBLIC_BASE_URL=http://localhost:7110
CORS_ORIGIN=http://localhost:3003,http://localhost:7105
MICROSERVICES_API_KEY=...
REDIS_URL=...
MONGODB_URI=...
UPLOAD_DIR=./uploads
UPLOAD_PUBLIC_BASE_URL=http://localhost:7110
BODY_LIMIT=10mb
RAPIDAPI_KEY=...
RAPIDAPI_KEY_FB_SCRAPER3=...
RAPIDAPI_KEY_INSTAGRAM=...
```

Reglas:

- No commitear `.env.local`.
- Railway no debe llevar `PORT` manual.
- Para production usar la guia externa `RAILWAY-ENV-OSINT-SOCIAL-SCRAPER.md`.
- Si se agrega provider nuevo, documentar variable y adaptador.

## Storage visual

Estrategia:

```text
Local: ./uploads
Railway: /app/uploads
URL publica: /uploads/...
```

Reglas:

- Guardar imagenes con `StorageService`.
- Mantener carpetas ordenadas por scope, platform, fecha y owner.
- DB guarda ruta relativa, URL publica y metadata.
- No guardar binarios en Mongo.
- No depender de Cloudinary en este scraper.

## Mongo y Redis

Mongo:

- `social_searches`
- `social_assets`

Redis:

- cache de busquedas sociales
- TTL controlado por `SOCIAL_CACHE_TTL_SECONDS`
- prefijo controlado por `SOCIAL_CACHE_PREFIX`

Reglas:

- Si Mongo esta caido, el servicio puede responder pero queda degradado.
- Si Redis esta caido, el servicio puede operar sin cache.
- Health debe mostrar estado de ambos.

## Activos sociales

Cada resultado util debe poder convertirse en asset:

```text
candidate
positive
false_positive
archived
```

Reglas:

- Mantener `platform`, `owner`, `type`, `sourceUrl`, `publicUrl`, `searchId`, `osintSearchId` y metadata.
- Los positivos deben poder promoverse a Datasec desde el micro principal.
- No borrar assets positivos sin trazabilidad.

## Busqueda por imagen

La busqueda por imagen compara contra imagenes ya guardadas en el volumen.

Reglas:

- Usar fingerprint/perceptual comparison.
- No prometer busqueda universal por foto si no hay dataset alimentado.
- Guardar candidatos con score y fuente.
- Enriquecer perfiles si `enrichProfiles=true`.

## Swagger y logs

Swagger:

```text
ENABLE_SWAGGER=true solo fuera de production
```

Logs:

- Arranque con nombre del micro.
- Developed by deco31416.com.
- Mongo/Redis/storage/proteccion interna auditados.
- No imprimir secretos.

## Flujo de desarrollo

1. Identificar plataforma o modulo afectado.
2. Modificar adaptador o servicio especifico.
3. Mantener normalizacion comun.
4. Agregar test si toca storage, assets, cache o contratos.
5. Ejecutar tests/build.
6. Actualizar README/CHANGELOG/version si cambia contrato, despliegue o comportamiento.

Comandos:

```powershell
yarn install
yarn test
yarn build
yarn start:dev
```

Nota interna:

El owner levanta servicios manualmente en terminal visible. No iniciar servicios ocultos.

## Versionado

- Patch `1.3.1`: fixes pequenos sin contrato nuevo.
- Minor `1.4.0`: nuevo adaptador, endpoint, provider, job o storage behavior.
- Major `2.0.0`: cambio grande de contrato o arquitectura.

Cuando se cambia version:

1. Actualizar `package.json`.
2. Actualizar `README.md`.
3. Agregar entrada arriba en `CHANGELOG.md`.
4. Ejecutar `yarn test`.
5. Ejecutar `yarn build`.

## Changelog

Formato:

```md
## x.y.z - YYYY-MM-DD

### Added
* Nuevo comportamiento.

### Changed
* Cambio relevante.

### Fixed
* Bug corregido.

### Tested
* `yarn test` OK.
* `yarn build` OK.
```

## QA antes de pasar a desarrollo

- `/api/v1/health` responde `UP`.
- `protected` sale true cuando hay `MICROSERVICES_API_KEY`.
- Mongo y Redis reportan estado correcto.
- `/uploads` sirve imagenes guardadas.
- Busqueda por username devuelve perfiles normalizados.
- Busqueda por nombre no rompe si un proveedor falla.
- Busqueda por imagen compara contra assets guardados.
- Listado de assets funciona.
- Cambio de status de asset funciona.
- `yarn test` OK.
- `yarn build` OK.

## Seguridad

- No exponer este micro directo al navegador como contrato publico.
- Proteger endpoints con `x-api-key`.
- No loguear secrets.
- Validar DTOs.
- Controlar `BODY_LIMIT`.
- No permitir que un provider externo tumbe toda la respuesta.
- Mantener CORS limitado a dashboard y micro principal.

## Ownership

Proyecto: OSINT Social Scraper  
Licencia: MIT  
Owner: OSINT-Deco  
Developed by: deco31416.com
