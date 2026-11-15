# Módulo OSINT de Reverse Image Engine

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](../../LICENSE)
![NestJS](https://img.shields.io/badge/NestJS-module-E0234E?logo=nestjs&logoColor=white)

Este módulo implementa las rutas de investigación del backend: creación y consulta de búsquedas, orquestación de fuentes, resultados y evidencias. La API se publica bajo `/api/v1` y requiere la autenticación configurada por el servicio principal.

## Flujo de datos

```mermaid
sequenceDiagram
  participant Client as Dashboard
  participant API as API OSINT
  participant Sources as Motores y fuentes públicas
  participant Scraper as Scraper social
  participant Store as MongoDB y Redis
  Client->>API: Consulta autenticada
  API->>Sources: Ejecuta fuentes habilitadas
  opt Scraper social configurado
    API->>Scraper: Busca perfiles o resuelve URL
    Scraper-->>API: Resultados con URL de origen
  end
  API->>Store: Guarda investigación y evidencias
  API-->>Client: Estado, resultados y trazabilidad
```

## Capacidades

- Consultas por nombre, usuario, datos asociados e imagen, según las opciones de la solicitud.
- Orquestación de motores nativos, crawlers y proveedores externos configurados.
- Descubrimiento de perfiles sociales y comunicación opcional con `osint-social-scraper`.
- Persistencia, scoring, trazabilidad y gestión de evidencias mediante el backend.

Las fuentes y proveedores disponibles dependen de la configuración. Una clave ausente desactiva la integración correspondiente; no se sustituye con una credencial incluida en el código. Revisa [Social Intel](../../docs/SOCIAL_INTEL.md) y [la configuración del backend](../../README.md).

## Claves y datos

Las claves de proveedores son opcionales por integración. Los secretos de JWT y comunicación interna sí deben generarse por instalación. No registres secretos ni datos personales innecesarios en logs. Valida URL y contenido remoto antes de recuperar recursos.

## Atribución y licencia

Desarrollado y publicado por [deco31416.com](https://deco31416.com), bajo licencia MIT del repositorio.