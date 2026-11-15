# 🎨 Test UI - Interfaz Visual de Pruebas

## 🚀 Acceso

Una vez que el microservicio esté corriendo, puedes acceder a la interfaz de pruebas en:

```
http://localhost:7105/test-ui
```

O en producción:
```
https://your-railway-domain.railway.app/test-ui
```

## ✨ Características

### 1. **Dashboard de Estado**
- ✅ Verificación de MongoDB (conectado/desconectado)
- ✅ Verificación de Redis (conectado/desconectado)
- ✅ Estado del microservicio en tiempo real
- ✅ Puerto de ejecución

### 2. **Crear Búsqueda Persona**
Formulario completo para crear búsquedas OSINT:
- Nombre y apellido
- Email (opcional)
- Username (opcional)
- Ciudad (opcional)
- Organización (opcional)
- Inicia búsqueda en múltiples motores (Bing, DuckDuckGo, YouTube)

### 3. **Búsqueda por Imagen**
- Buscar usando URL de imagen
- Selección de motores: Google, Yandex, TinEye
- Reverse image search automático

### 4. **Lista de Búsquedas**
- Ver todas tus búsquedas con paginación
- Filtrar por estado: pending, processing, completed, failed
- Ver estadísticas generales
- Acceso rápido a evidencias

### 5. **Ver Evidencias**
- Filtrar por fuente (Bing, DuckDuckGo, YouTube, Google Vision)
- Paginación de resultados
- Ver galería de imágenes encontradas
- Detalles de cada evidencia (confiabilidad, categoría, contenido)

### 6. **Galería de Imágenes**
- Vista en grid de todas las imágenes
- Click para ver imagen completa
- Información de confiabilidad y fuente
- Visual summary con top imágenes

### 7. **Monitoreo en Tiempo Real**
- Polling automático de estado de búsqueda
- Actualización cada 2 segundos
- Notificaciones cuando completa
- Acceso directo a resultados

## 🎯 Casos de Uso

### Caso 1: Búsqueda Rápida de Persona
1. Abre `http://localhost:7105/test-ui`
2. Completa el formulario "Crear Búsqueda Persona"
3. Click en "🚀 Iniciar Búsqueda"
4. Click en "🔄 Monitorear Progreso"
5. Espera a que complete (status: completed)
6. Click en "Ver Evidencias" o "Ver Galería"

### Caso 2: Búsqueda por Imagen
1. Pega URL de imagen en el formulario
2. Selecciona motores (Google, Yandex, TinEye)
3. Click en "🔍 Buscar por Imagen"
4. Monitorea progreso
5. Ve resultados

### Caso 3: Revisar Búsquedas Anteriores
1. Click en "📥 Cargar Búsquedas"
2. Filtra por estado si quieres
3. Click en "Ver Evidencias" de cualquier búsqueda
4. Explora resultados con paginación

### Caso 4: Verificar Estado del Sistema
1. Click en "🔄 Verificar Estado" en el header
2. Revisa indicadores de MongoDB y Redis
3. Ve a "📚 Swagger API Docs" para más detalles
4. Usa "❤️ Health Check" para endpoint JSON

## 🎨 Interfaz

### Colores y Diseño
- **Gradiente principal**: Púrpura (#667eea) a Morado (#764ba2)
- **Cards blancas** con sombras suaves
- **Grid responsive** que se adapta al tamaño de pantalla
- **Badges de estado** con colores:
  - 🟢 Verde: Connected, Completed
  - 🔴 Rojo: Disconnected, Failed
  - 🟡 Amarillo: Pending
  - 🔵 Azul: Processing

### Componentes Visuales
- **Status Bar**: Indicadores de conexión en tiempo real
- **Form Cards**: Formularios organizados por función
- **Results Panel**: Área expandible para resultados
- **Image Grid**: Galería responsive de imágenes
- **Loading Spinner**: Animación durante requests
- **Alerts**: Notificaciones de éxito/error

## 🔧 Integración con Backend

### Endpoints Utilizados
```javascript
// Base URL
const API_BASE = 'http://localhost:7105/osint';

// Endpoints
GET  /health                     // Health check
POST /search                     // Crear búsqueda persona
POST /search/by-image            // Búsqueda por imagen
GET  /search/:id                 // Estado de búsqueda
GET  /searches                   // Lista de búsquedas
GET  /stats                      // Estadísticas
GET  /evidence/:searchId         // Evidencias paginadas
GET  /evidence/:searchId/images  // Galería de imágenes
```

### Sin Autenticación JWT
La ruta `/test-ui` está marcada como `@Public()`, lo que significa que:
- ✅ No requiere JWT token
- ✅ Accesible directamente desde el navegador
- ✅ Ideal para pruebas rápidas en desarrollo
- ⚠️ **Recomendación**: En producción, considera proteger esta ruta

## 🚀 Uso en Desarrollo

```bash
# 1. Iniciar microservicio
yarn start:dev

# 2. Abrir en navegador
http://localhost:7105/test-ui

# 3. También puedes ver Swagger
http://localhost:7105/api
```

## 🌐 Uso en Producción (Railway)

```bash
# 1. Deploy a Railway
railway up

# 2. Configurar variables de entorno en Railway Dashboard

# 3. Acceder a:
https://your-app.railway.app/test-ui

# Opcional: Proteger con autenticación
# Remover @Public() del TestUiController
```

## 📱 Responsive Design

La interfaz se adapta a diferentes tamaños:
- **Desktop**: Grid de 3 columnas
- **Tablet**: Grid de 2 columnas
- **Mobile**: Grid de 1 columna
- **Imágenes**: Grid flexible que se ajusta automáticamente

## 🎯 Ventajas sobre Swagger

| Feature | Test UI | Swagger |
|---------|---------|---------|
| **Visual** | ✅ Muy visual con cards y galería | ⚠️ Solo JSON |
| **Monitoreo** | ✅ Polling automático de estado | ❌ Manual |
| **Imágenes** | ✅ Galería integrada | ❌ Solo URLs |
| **Filtros** | ✅ Formularios con selects | ⚠️ Query params manuales |
| **Estado** | ✅ Dashboard con indicadores | ❌ Endpoint separado |
| **UX** | ✅ Flujo guiado | ⚠️ Requiere conocer API |

## 🛡️ Seguridad

### Desarrollo
- Test UI es público por defecto
- Ideal para pruebas locales
- Sin restricciones

### Producción
Si quieres proteger el Test UI en producción:

1. **Remover @Public() decorator**:
```typescript
// src/osint/test-ui.controller.ts
@Get()
// @Public() <- Comentar o remover esta línea
@UseGuards(JwtAuthGuard) <- Agregar esto
getTestUi(@Res() res: Response) {
  // ...
}
```

2. **O agregar IP allowlist en Railway**:
```bash
# Solo permitir tu IP
railway variables set ALLOWED_IPS="1.2.3.4,5.6.7.8"
```

3. **O usar HTTP Basic Auth**:
```typescript
// Agregar middleware de basic auth
app.use('/test-ui', basicAuth({
  users: { 'admin': 'password' }
}));
```

## 📝 Personalización

### Cambiar Colores
Edita el `<style>` en `test-ui.controller.ts`:
```css
/* Gradiente principal */
background: linear-gradient(135deg, #TU_COLOR_1 0%, #TU_COLOR_2 100%);

/* Cards */
.card h3 { color: #TU_COLOR_PRIMARIO; }

/* Botones */
.btn-primary { background: linear-gradient(135deg, #TU_COLOR_1 0%, #TU_COLOR_2 100%); }
```

### Agregar Funcionalidades
El controller es un archivo único de ~500 líneas. Puedes:
1. Agregar nuevos formularios en el grid
2. Crear nuevas funciones JavaScript
3. Agregar más endpoints del backend
4. Personalizar el diseño CSS

### Multi-idioma
Actualmente en español. Para agregar inglés:
```javascript
const LANG = {
  es: { title: 'Búsqueda', button: 'Buscar' },
  en: { title: 'Search', button: 'Search' }
};
```

## 🎉 Resultado

Tienes ahora:
1. ✅ **Swagger** (`/api`) - Documentación técnica completa
2. ✅ **Test UI** (`/test-ui`) - Interfaz visual para pruebas
3. ✅ **Health Check** (`/osint/health`) - Verificación de estado
4. ✅ **Backend completo** - Todos los endpoints funcionando

**Disfruta probando tu microservicio OSINT de forma visual! 🚀**
