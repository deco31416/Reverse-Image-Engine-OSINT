# Adaptadores sociales

Este micro separa cada red en su propia carpeta para evitar mezclar reglas, proveedores y scraping en un solo archivo.

## Estructura actual

```text
src/social/
├── adapters/
│   ├── facebook/
│   ├── github/
│   ├── instagram/
│   ├── bluesky/
│   ├── discord/
│   ├── mastodon/
│   ├── medium/
│   ├── pinterest/
│   ├── reddit/
│   ├── telegram/
│   ├── threads/
│   ├── tiktok/
│   ├── x/
│   └── youtube/
├── dto/
├── normalizer/
├── types/
├── social.controller.ts
├── social.module.ts
└── social.service.ts
```

## Regla de arquitectura

Cada adaptador debe implementar `SocialAdapter`:

```ts
platform: SocialPlatform;
enabled(): boolean;
searchByUsername(username: string, limit?: number): Promise<SocialProfile[]>;
searchByName(query: string, limit?: number): Promise<SocialProfile[]>;
```

## Responsabilidad por archivo

* `social.controller.ts`: expone endpoints HTTP.
* `social.service.ts`: selecciona adaptadores y agrega resultados.
* `normalizer/social-normalizer.service.ts`: convierte cada respuesta al formato comercial común.
* `adapters/<red>/<red>.adapter.ts`: lógica específica de esa red.

## Estado por red

* `github`: usa API pública de GitHub.
* `instagram`: genera URL candidata, listo para proveedor/scraper dedicado.
* `facebook`: genera URL candidata, listo para proveedor/scraper dedicado.
* `tiktok`: genera URL candidata con formato `@username`.
* `x`: genera URL candidata.
* `reddit`: genera URL candidata.
* `pinterest`: genera URL candidata.
* `medium`: genera URL candidata.
* `youtube`: genera URL candidata con formato `@username`.
* `telegram`: genera URL candidata.
* `discord`: genera URL candidata por user id/handle si aplica.
* `threads`: genera URL candidata con formato `@username`.
* `mastodon`: genera URL candidata en instancia default `mastodon.social`.
* `bluesky`: genera URL candidata.

## Cómo agregar una red nueva

1. Crear carpeta: `src/social/adapters/youtube/`.
2. Crear adapter: `youtube.adapter.ts`.
3. Agregar el literal en `src/social/types/social-platform.type.ts`.
4. Registrar provider en `src/social/social.module.ts`.
5. Inyectarlo en `src/social/social.service.ts`.
6. Devolver siempre `SocialProfile[]` normalizado.

## Seguridad

* No guardar secretos dentro del código.
* Usar variables de entorno por proveedor.
* Respetar APIs públicas y términos de servicio.
* No agregar bypass de login, captcha o controles anti-abuso.
* Si un proveedor falla, devolver `[]` o error controlado por plataforma, nunca romper toda la búsqueda.
