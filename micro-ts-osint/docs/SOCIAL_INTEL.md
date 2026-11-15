# Social Intel - Instagram, Meta/Facebook y Facebook Search

Esta guia documenta como el microservicio OSINT ejecuta busquedas sociales para el dashboard. La funcionalidad vive en el modulo OSINT del micro `micro-ts-osint` y se expone bajo `/api/v1/osint`.

## Resumen

Social Intel usa tres caminos:

| Flujo | Endpoint interno | Fuente usada | Requiere API key |
| --- | --- | --- | --- |
| Instagram perfil/posts | `POST /api/v1/osint/instagram/search` | HTTP directo al endpoint web publico de Instagram | No para perfil basico |
| Instagram stats | `POST /api/v1/osint/instagram/search` | RapidAPI Instagram Statistics | Si, `RAPIDAPI_KEY` |
| Meta/Facebook perfil | `POST /api/v1/osint/meta/search` | RapidAPI Facebook Scraper | Si, `RAPIDAPI_KEY` |
| Facebook Search | `POST /api/v1/osint/meta/search-fb` | RapidAPI Facebook Scraper search endpoints | Si, `RAPIDAPI_KEY` |

No usa la API oficial completa de Meta Developer para estos flujos. Es un enfoque OSINT con datos publicos, endpoints web y proveedores externos tipo scraper/API.

## Flujo desde el dashboard

```txt
Dashboard Next.js
  -> /api/osint proxy del dashboard
    -> Micro NestJS /api/v1/osint/*
      -> Instagram web endpoint o RapidAPI
      -> Normalizacion del micro
    <- Dashboard muestra perfil, fotos, posts, links, filtros y paginacion
```

El dashboard no llama directamente a Instagram, Facebook ni RapidAPI. Siempre pasa por el micro.

## Autenticacion

Los endpoints Social Intel estan protegidos por JWT mediante `JwtAuthGuard`.

El dashboard obtiene token usando:

```txt
POST /api/v1/auth/login
```

Variables relevantes:

```env
JWT_SECRET=...
OSINT_VALID_USERS=admin
OSINT_AUTH_PASSWORD=...
```

En el dashboard:

```env
OSINT_API_BASE=http://localhost:7105/api/v1
OSINT_AUTH_USERNAME=admin
OSINT_AUTH_PASSWORD=...
```

## Variables de entorno

Minimo para operar Social Intel:

```env
RAPIDAPI_KEY=...
```

Instagram perfil basico puede funcionar sin `RAPIDAPI_KEY`, porque usa el endpoint web directo de Instagram. Sin embargo, estadisticas de comunidad y Facebook/Meta si dependen de RapidAPI.

Variables historicas en `.env.example`:

```env
FACEBOOK_ACCESS_TOKEN=...
INSTAGRAM_ACCESS_TOKEN=...
```

Actualmente estos flujos Social Intel no dependen del Graph API oficial para la busqueda principal documentada aqui.

## Instagram

### Endpoint

```http
POST /api/v1/osint/instagram/search
Content-Type: application/json
Authorization: Bearer <jwt>
```

Body:

```json
{
  "username": "operador-demo",
  "fetchProfile": true,
  "fetchStats": true,
  "fetchPosts": true,
  "detectCollaborators": true
}
```

### Como busca

El servicio `InstagramIntelligenceService` hace dos consultas en paralelo cuando aplica:

1. Direct API web de Instagram:

```txt
https://www.instagram.com/api/v1/users/web_profile_info/?username=<username>
```

Usa headers tipo navegador, incluyendo:

```txt
X-IG-App-ID: 936619743392459
User-Agent: navegador desktop
Referer: https://www.instagram.com/
```

2. RapidAPI Instagram Statistics:

```txt
https://instagram-statistics-api.p.rapidapi.com/community
```

Esta segunda consulta solo corre si `fetchStats` no es `false` y existe `RAPIDAPI_KEY`.

### Que devuelve

Respuesta base:

```json
{
  "success": true,
  "username": "operador-demo",
  "instagramUrl": "https://www.instagram.com/operador-demo/",
  "found": true,
  "profile": {
    "username": "operador-demo",
    "fullName": "...",
    "biography": "...",
    "profilePicUrl": "https://...",
    "profilePicUrlHd": "https://...",
    "followerCount": 0,
    "followingCount": 0,
    "postCount": 0,
    "externalUrl": "https://..."
  },
  "posts": [
    {
      "shortcode": "...",
      "postUrl": "https://www.instagram.com/.../p/...",
      "displayUrl": "https://...",
      "caption": "...",
      "likeCount": 0,
      "commentCount": 0,
      "timestamp": 1710000000,
      "collaborators": []
    }
  ],
  "communityStats": {
    "followers": 0,
    "following": 0,
    "posts": 0,
    "engagementRate": 0
  },
  "apiStatus": {
    "directApi": "ok",
    "rapidApi": "ok"
  },
  "errors": {},
  "timing": {
    "totalMs": 1200
  }
}
```

### Limitaciones

- Puede fallar por rate limit de Instagram.
- Puede fallar si Instagram cambia el endpoint o requiere cookies/sesion.
- Cuentas privadas devuelven menos informacion.
- Si `RAPIDAPI_KEY` no existe, el perfil puede funcionar pero stats quedan `skipped`.

## Meta/Facebook perfil

### Endpoint

```http
POST /api/v1/osint/meta/search
Content-Type: application/json
Authorization: Bearer <jwt>
```

Body:

```json
{
  "username": "nasa",
  "fetchProfile": true,
  "fetchPosts": true,
  "fetchPhotos": true
}
```

### Como busca

El servicio `MetaIntelligenceService` construye:

```txt
https://www.facebook.com/<username>
```

Luego intenta:

1. Principal:

```txt
facebook-scraper3.p.rapidapi.com/profile/details_url
```

2. Fallback:

```txt
facebook-pages-scraper3.p.rapidapi.com/get-profile-home-page-details
```

Si obtiene `profile_id`, consulta:

```txt
facebook-scraper3.p.rapidapi.com/profile/posts
facebook-scraper3.p.rapidapi.com/profile/photos
```

### Que devuelve

Respuesta base:

```json
{
  "success": true,
  "username": "nasa",
  "facebookUrl": "https://www.facebook.com/nasa",
  "found": true,
  "profile": {
    "id": "...",
    "typeName": "Profile",
    "name": "NASA",
    "verified": true,
    "intro": "...",
    "url": "https://www.facebook.com/nasa",
    "profilePicture": "https://...",
    "coverPhoto": "https://...",
    "introCards": [
      {
        "label": "Info",
        "value": "...",
        "externalUrl": "https://..."
      }
    ],
    "photos": []
  },
  "posts": [
    {
      "postId": "...",
      "text": "...",
      "url": "https://...",
      "createdAt": "2026-06-16T00:00:00.000Z",
      "commentsCount": 0,
      "shareCount": 0,
      "reactionCount": 0,
      "attachments": [
        {
          "type": "photo",
          "uri": "https://..."
        }
      ]
    }
  ],
  "photos": [
    {
      "id": "...",
      "uri": "https://..."
    }
  ],
  "apiStatus": {
    "profile": "ok",
    "posts": "ok",
    "photos": "ok"
  },
  "errors": {},
  "timing": {
    "totalMs": 3000
  }
}
```

### Limitaciones

- Requiere `RAPIDAPI_KEY`.
- Posts/fotos dependen de que el proveedor devuelva `profile_id`.
- Algunos perfiles privados, bloqueados o no indexados pueden devolver perfil parcial o vacio.
- El proveedor RapidAPI puede cambiar formato, cuota o disponibilidad.

## Facebook Search

### Endpoint

```http
POST /api/v1/osint/meta/search-fb
Content-Type: application/json
Authorization: Bearer <jwt>
```

Body:

```json
{
  "query": "operador-demo",
  "searchType": "global"
}
```

Tipos soportados:

```txt
people
pages
posts
global
locations
```

### Como busca

El micro llama:

```txt
facebook-scraper3.p.rapidapi.com/search/<searchType>?query=<query>
```

Ejemplos:

```txt
/search/global
/search/people
/search/pages
/search/posts
/search/locations
```

### Que devuelve

```json
{
  "success": true,
  "username": "operador-demo",
  "facebookUrl": "",
  "found": true,
  "search": {
    "type": "global",
    "query": "operador-demo",
    "count": 3,
    "results": [
      {
        "name": "...",
        "url": "https://www.facebook.com/...",
        "image": "https://..."
      }
    ]
  },
  "apiStatus": {
    "search": "ok"
  },
  "errors": {},
  "timing": {
    "totalMs": 1500
  }
}
```

## Health checks

Instagram:

```http
GET /api/v1/osint/instagram/health
```

Respuesta:

```json
{
  "instagram": {
    "available": true,
    "directApiEndpoint": "https://www.instagram.com/api/v1/users/web_profile_info/",
    "rapidApiConfigured": true,
    "rapidApiEndpoint": "https://instagram-statistics-api.p.rapidapi.com"
  }
}
```

Meta:

```http
GET /api/v1/osint/meta/health
```

Respuesta:

```json
{
  "meta": {
    "available": true,
    "apiKeyConfigured": true,
    "primaryEndpoint": "https://facebook-scraper3.p.rapidapi.com",
    "fallbackEndpoint": "https://facebook-pages-scraper3.p.rapidapi.com"
  }
}
```

## Estados que debe mostrar el dashboard

El dashboard no debe mostrar endpoints crudos ni JSON al usuario final. Debe traducir estados tecnicos a mensajes comerciales:

| Estado tecnico | Mensaje recomendado |
| --- | --- |
| `ok` | Listo |
| `skipped` | No solicitado |
| `error` | Sin respuesta |
| `found: false` | Sin coincidencias visibles |
| `rate limit` | Limite temporal del proveedor |
| `private` | Perfil privado o limitado |
| sin `RAPIDAPI_KEY` | Conector pendiente |

## Riesgos operativos

- No es API oficial completa de Meta.
- Los proveedores pueden cambiar el formato de respuesta.
- Instagram puede bloquear por frecuencia o headers.
- RapidAPI puede agotar cuota.
- El resultado debe tratarse como senal OSINT, no como verdad absoluta.
- Debe evitarse prometer cobertura total al cliente.

## Archivos clave

Controlador:

```txt
src/osint/osint-v2.controller.ts
```

Servicios:

```txt
src/osint/services/instagram-intelligence.service.ts
src/osint/services/meta-intelligence.service.ts
```

DTOs:

```txt
src/osint/dto/instagram-search.dto.ts
src/osint/dto/meta-search.dto.ts
```

UI de prueba vieja:

```txt
src/osint/test-ui.controller.ts
```

Dashboard conectado:

```txt
../dashboard-osint/lib/osint-api.ts
../dashboard-osint/components/dashboard/dashboard-app.tsx
../dashboard-osint/components/dashboard/forms.tsx
```

## Checklist de prueba local

1. Levantar el micro en terminal visible.
2. Confirmar health:

```powershell
curl.exe http://localhost:7105/api/v1/osint/instagram/health
curl.exe http://localhost:7105/api/v1/osint/meta/health
```

3. Levantar dashboard en terminal visible.
4. Abrir Social Intel.
5. Ejecutar Instagram con un usuario publico.
6. Ejecutar Meta/Facebook con una pagina publica.
7. Ejecutar Facebook Search con `global`, `people` y `pages`.
8. Validar que el dashboard muestre:

```txt
perfil
fotos
posts
links
filtros
paginacion
estado comercial
```

## Nota para despliegue

En Railway, estos flujos funcionan si existen las variables necesarias y el servicio puede salir a internet. Para Meta/Facebook, `RAPIDAPI_KEY` es obligatoria. Para Instagram Direct API, puede funcionar sin key, pero esta sujeto a bloqueos del proveedor.
