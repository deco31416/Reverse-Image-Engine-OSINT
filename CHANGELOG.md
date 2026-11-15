# Changelog

Seguimiento general del workspace OSINT-Deco.

## 2026-06-18 - Release integracion auth y scraper

### Versiones

```text
micro-ts-osint:       2.7.0
dashboard-osint:      0.3.0
osint-social-scraper: 1.2.0
```

### Cambios principales

* Registro publico eliminado: acceso cerrado con usuarios creados por Owner/Admin.
* Dashboard actualizado con login, forgot/reset, modales comerciales, usuarios internos y permisos visibles.
* Micro principal endurecido con rate limiting Redis para auth y seed demo protegido por confirmacion local.
* Scraper social documentado como micro de apoyo para assets, busqueda social e integracion con Datasec.
* Versiones, README y CHANGELOG sincronizados para preparacion de GitHub.

### Validacion

```text
micro-ts-osint yarn test OK - 41 tests
micro-ts-osint yarn build OK
osint-social-scraper yarn build OK
dashboard-osint pnpm run build OK
```

---

## 2026-06-18 - Preparacion GitHub

### Versiones

```text
micro-ts-osint:       2.6.0
dashboard-osint:      0.2.0
osint-social-scraper: 1.1.0
```

### Cambios principales

* Documentacion raiz agregada para explicar arquitectura, puertos, Railway Volume y variables criticas.
* Dashboard documentado con README y CHANGELOG propios.
* Micro principal actualizado a version 2.6.0 con changelog de Datasec, jobs Redis, social scraper bridge, storage local/Railway y seguridad.
* Scraper social actualizado a version 1.1.0 con changelog de Swagger, logs, assets, storage y tests.
* Licencias normalizadas a MIT con copyright de deco31416.com.
* `.gitignore` raiz agregado para evitar subir envs, uploads, builds, logs y auditorias privadas.
* Estado de validacion documentado antes de preparar subida a GitHub.

### Validacion base

```text
micro-ts-osint yarn test OK - 38 tests
micro-ts-osint yarn build OK
osint-social-scraper yarn test OK - 8 tests
osint-social-scraper yarn build OK
dashboard-osint pnpm run build OK
```
