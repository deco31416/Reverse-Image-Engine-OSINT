# Changelog

## 1.3.0 - 2026-06-30

### Added

* Guia interna de contribucion para adaptadores sociales, storage visual, Mongo, Redis, activos sociales, versionado, changelog, QA y seguridad.

### Changed

* Version del scraper subida a `1.3.0`.
* Licencia MIT actualizada a nombre de OSINT-Deco.
* README actualizado para enlazar la guia interna, corregir Railway sin `PORT` y reflejar el estado operativo actual.

### Tested

* `yarn test` OK: 8 tests.
* `yarn build` OK.

---

## 1.2.0 - 2026-06-18

### Added

* Versionado alineado con la release de integracion OSINT-Deco.
* README actualizado para explicar uso local/Railway, assets visuales y rol como micro de apoyo.
* Seguimiento de build validado con `yarn build`.

### Changed

* Documentacion reforzada para dejar claro que el scraper alimenta al micro principal y a Datasec.

### Tested

* `yarn build` OK.

---

## 1.1.0 - 2026-06-18

### Added

* Swagger protegido por `ENABLE_SWAGGER=true` y deshabilitado en `production`.
* Logs de arranque profesionales con `Developed by deco31416.com` y auditoria de Mongo, Redis, storage y proteccion interna.
* Endpoint `GET /api/v1/assets/:id` para que el micro principal pueda promover assets sociales a Datasec.
* Tests unitarios para repositorio de assets sociales y storage local/Railway Volume.
* Dependencia `express` declarada explicitamente para compatibilidad Yarn PnP/Nest adapter.
* Dependencia `jest-util` declarada para ejecucion estable de `ts-jest` bajo Yarn PnP.

### Changed

* Storage documentado como local/Railway Volume por defecto.
* Descripcion del paquete actualizada al rol real de microservicio de apoyo social.

### Tested

* `yarn test` OK: 8 tests.
* `yarn build` OK.

---

## 1.0.0 - 2026-06-17

### Added

* NestJS microservice base for OSINT social scraping.
* Platform adapters separated by folder: Instagram, Facebook, TikTok, X, GitHub, Reddit, Pinterest and Medium.
* Normalized social profile response model.
* Internal API key guard with timing-safe comparison.
* Local/Railway volume storage mounted through `/uploads`.
* Base64 image persistence endpoint for internal evidence/assets.
* Optional Redis cache for social searches.
* Optional Mongo persistence for social search results.
* Health endpoint reporting storage, Redis, Mongo and protection status.
* Railway configuration and local/Railway documentation.
* Local visual image search against stored social images using perceptual fingerprints.
* Social asset registry for scraped images, profile candidates and validation status.
