# Guia interna de contribucion - OSINT-Deco Dashboard

Esta guia define como el equipo interno debe trabajar en `dashboard-osint` para mantener el proyecto ordenado, componetizado, versionado y listo para desarrollo, QA y despliegue.

## Principios

- Mantener la experiencia comercial por encima del detalle tecnico crudo.
- No mostrar JSON tecnico al cliente final salvo que sea una vista claramente operativa o de auditoria.
- No romper flujos existentes: Busqueda OSINT, Rostros, Mejora visual, Social Intel, Evidencias, Red y auditoria, Configuracion.
- No hardcodear secretos, URLs privadas ni API keys en componentes.
- Todo cambio visible debe funcionar en local y estar preparado para Railway/Vercel.
- Cada pantalla debe estar componetizada: formularios, cards, modales, tablas, estados vacios y paneles deben poder mantenerse sin crear un archivo inmanejable.

## Stack

- Next.js 14
- TypeScript
- TailwindCSS
- shadcn/ui base local
- lucide-react para iconos
- Proxy interno `/api/osint` para hablar con `micro-ts-osint`
- Auth con cookie HTTP-only

## Estructura de trabajo

```text
app/
  api/
    auth/
    osint/
  login/
  forgot-password/
  reset-password/

components/
  dashboard/
    dashboard-app.tsx
    forms.tsx
    search-panels.tsx
    sidebar.tsx
    topbar.tsx
    settings/
    datasec/
  ui/

lib/
  osint-api.ts
  utils.ts
```

## Reglas de componentes

- Usar componentes existentes antes de crear uno nuevo.
- Formularios nuevos deben vivir en `components/dashboard/forms.tsx` o en una carpeta propia si crecen.
- Componentes especificos de Configuracion/Datasec deben vivir en `components/dashboard/settings` o `components/dashboard/datasec`.
- Botones deben usar `components/ui/button.tsx` salvo casos muy controlados.
- Iconos: usar `lucide-react`.
- Modales de acciones sensibles deben ser modales propios del dashboard, no `window.confirm`.
- Cards repetidas deben tener altura, padding y comportamiento responsive estable.
- No poner cards dentro de cards si se puede resolver con secciones internas.

## Proxy y comunicacion con micros

El frontend no debe llamar directo a los micros desde el navegador.

Flujo correcto:

```text
Componente React
  -> lib/osint-api.ts
  -> /api/osint
  -> micro-ts-osint
  -> osint-social-scraper si aplica
```

Reglas:

- Agregar nuevos metodos del micro en `lib/osint-api.ts`.
- Mantener el `path` relativo, por ejemplo `/osint/search/:id`.
- No exponer `MICROSERVICES_API_KEY` al cliente.
- Los endpoints destructivos deben tener confirmacion visual antes de ejecutarse.

## Variables de entorno

Archivo local:

```text
.env.local
```

Variables principales:

```env
OSINT_API_BASE=http://localhost:7105/api/v1
OSINT_AUTH_USERNAME=admin
OSINT_AUTH_PASSWORD=...
OSINT_INTERNAL_API_KEY=...
MICROSERVICES_API_KEY=...
DASHBOARD_PUBLIC_URL=http://localhost:3003
```

Reglas:

- No commitear `.env.local`.
- Para Railway usar las guias externas de variables preparadas en la raiz del workspace.
- No crear variables nuevas sin documentarlas en README y changelog si afectan despliegue.

## Flujo de desarrollo

1. Leer el flujo actual antes de tocar codigo.
2. Identificar si el cambio es UI, API client, proxy, auth, datos o seguridad.
3. Hacer cambios pequenos y verificables.
4. Mantener copy comercial y claro.
5. Probar build local.
6. Actualizar README/CHANGELOG si el cambio afecta comportamiento, version, variables o flujo de QA.

Comandos:

```powershell
pnpm install
pnpm run dev
pnpm run build
```

Nota interna:

El owner levanta los servicios manualmente en terminal visible. No arrancar servicios ocultos.

## Versionado

Usar versionado semantico:

- Patch `0.4.1`: correcciones pequenas, copy, UI menor, bugs sin cambio de flujo.
- Minor `0.5.0`: nueva vista, nuevo flujo, nuevo modulo, endpoints conectados.
- Major `1.0.0`: release estable con contrato funcional cerrado.

Cuando se cambia version:

1. Actualizar `package.json`.
2. Actualizar `README.md`.
3. Agregar entrada arriba en `CHANGELOG.md`.
4. Ejecutar `pnpm run build`.

## Changelog

Todo cambio relevante debe documentarse en `CHANGELOG.md`.

Formato:

```md
## x.y.z - YYYY-MM-DD

### Added

* Nuevo comportamiento.

### Changed

* Cambio visible o tecnico relevante.

### Fixed

* Bug corregido.

### Tested

* `pnpm run build` OK.
```

## QA antes de pasar a desarrollo

Checklist minimo:

- Login funciona.
- Refresh no deja la app en estado roto.
- Dashboard conecta al micro.
- Busqueda OSINT crea caso.
- Rostros permite subir imagen y detectar rostros.
- Evidencias carga caso reciente.
- Evidencias puede validar positivo/falso positivo.
- Acciones destructivas abren modal, no dialogo nativo.
- Configuracion/Datasec carga sin romper layout.
- Sidebar funciona expandido y contraido.
- Mobile no rompe texto ni botones.
- `pnpm run build` OK.

## Seguridad

- No exponer secretos en componentes.
- No loguear passwords, JWT, API keys, Redis URL o Mongo URI.
- Las acciones destructivas deben pasar por `/api/osint`.
- Roles y permisos deben respetarse desde el micro.
- Registro publico no debe volver sin aprobacion explicita.
- Los endpoints administrativos deben seguir protegidos.

## Criterio para pasar a developer

Un cambio puede pasar a developer cuando:

- El flujo esta probado en local.
- El build pasa.
- El cambio esta documentado si afecta uso, despliegue o QA.
- No introduce secretos.
- La UX es comercial y entendible para usuario no tecnico.
- No rompe el contrato con `micro-ts-osint` ni `osint-social-scraper`.

## Criterio para pasar a QA

Un cambio puede pasar a QA cuando:

- El owner puede levantar dashboard y micros en terminal visible.
- Hay pasos claros para reproducir.
- Hay datos de prueba o un caso existente.
- Los errores esperados se muestran en UI.
- Los casos borde estan identificados.

## Estilo de UI

- Mantener paleta oscura operacional.
- Evitar textos tecnicos tipo payload, provider raw, JSON crudo en pantallas comerciales.
- Usar status badges, cards y modales consistentes.
- Los botones destructivos deben explicar la accion antes de ejecutar.
- No dejar inputs o botones con textos cortados.
- Toda lista que pueda crecer debe tener paginacion, filtros o scroll controlado.

## Ownership

Proyecto: OSINT-Deco Dashboard  
Licencia: MIT  
Owner: OSINT-Deco  
Developed by: deco31416.com
