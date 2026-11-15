import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import type { Connection } from 'mongoose';
import type { Redis } from 'ioredis';
import * as express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import helmet from 'helmet';
import { uploadAccessMiddleware } from './common/upload-access';
import { UploadLinksInterceptor } from './common/upload-links.interceptor';
import { CaseAccessService } from './osint/services/case-access.service';

const SERVICE_NAME = 'OSINT-DECO';

function logOk(logger: Logger, message: string) {
  logger.log(`🟢 [${SERVICE_NAME}] ${message}`);
}

function logInfo(logger: Logger, message: string) {
  logger.log(`🔵 [${SERVICE_NAME}] ${message}`);
}

function logWarn(logger: Logger, message: string) {
  logger.warn(`🟠 [${SERVICE_NAME}] ${message}`);
}

function logError(logger: Logger, message: string) {
  logger.error(`🔴 [${SERVICE_NAME}] ${message}`);
}

function logPlain(logger: Logger, message: string) {
  logger.log(`⚪ [${SERVICE_NAME}] ${message}`);
}

function resolveServiceUrl(config: ConfigService, port: number) {
  const explicitUrl =
    config.get<string>('SERVICE_PUBLIC_BASE_URL') ||
    config.get<string>('PUBLIC_BASE_URL') ||
    config.get<string>('APP_PUBLIC_URL');
  if (explicitUrl) return explicitUrl.replace(/\/+$/, '');

  const railwayDomain =
    config.get<string>('RAILWAY_PUBLIC_DOMAIN') ||
    process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayDomain) return `https://${railwayDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

  return `http://localhost:${port}`;
}

function logBanner(logger: Logger, serviceTitle: string, version: string, port: number, url: string) {
  logPlain(logger, '============================================================');
  logPlain(logger, `${serviceTitle}`);
  logPlain(logger, `Version: ${version}`);
  logPlain(logger, `Port: ${port}`);
  logPlain(logger, `URL: ${url}`);
  logOk(logger, 'Developed by deco31416.com');
  logPlain(logger, '============================================================');
}

function logStartupSuccess(logger: Logger, serviceTitle: string, url: string) {
  logPlain(logger, '============================================================');
  logOk(logger, `${serviceTitle} inicializado con exito`);
  logOk(logger, 'El microservicio esta listo para recibir solicitudes');
  logPlain(logger, `Base URL: ${url}`);
  logPlain(logger, `Health: ${url}/health`);
  logPlain(logger, `API base: ${url}/api/v1`);
  logOk(logger, 'Developed by deco31416.com');
  logPlain(logger, '============================================================');
}

function isConfigured(config: ConfigService, ...keys: string[]) {
  return keys.some((key) => {
    const value = config.get<string>(key) ?? process.env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

async function auditMongoConnection(app: INestApplication) {
  const connection = app.get<Connection>(getConnectionToken(), { strict: false });
  const readyState = connection?.readyState ?? 0;

  if (readyState !== 1 || !connection?.db) {
    return { connected: false, detail: `readyState=${readyState}` };
  }

  await connection.db.admin().ping();
  return { connected: true, detail: 'readyState=1, ping=ok' };
}

async function auditRedisConnection(app: INestApplication) {
  const redis = app.get<Redis | null>('REDIS_CLIENT', { strict: false });
  if (!redis) return { connected: false, detail: 'client unavailable' };

  const pong = await redis.ping();
  return { connected: pong === 'PONG', detail: `status=${redis.status}, ping=${pong}` };
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    bodyParser: false, // Disable default to set custom limits
  });
  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('NODE_ENV') || process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const port = config.get<number>('PORT') || 7105;
  const serviceUrl = resolveServiceUrl(config, port);
  const uploadDir = config.get<string>('UPLOAD_DIR') || path.join(process.cwd(), 'uploads');
  const swaggerEnabled =
    process.env.ENABLE_SWAGGER === 'true' && !isProduction;
  logBanner(logger, 'OSINT-Deco Main Microservice', '2.8.0', port, serviceUrl);

  fs.mkdirSync(uploadDir, { recursive: true });
  app.useGlobalInterceptors(new UploadLinksInterceptor(app.get(CaseAccessService)));
  logOk(logger, `Static uploads mounted: /uploads -> ${uploadDir}`);

  // ══════════════════════════════════════════════════════════════
  // HELMET — Security headers + CSP for Railway production
  // Railway HTTPS enforces strict CSP by default which blocks:
  //   - Inline <script> tags (test-ui)
  //   - eval() (Swagger UI)
  //   - Inline styles (test-ui CSS)
  //   - Cross-origin fetches
  // This config makes everything work in both localhost and Railway.
  // ══════════════════════════════════════════════════════════════
  app.use(
    helmet({
      contentSecurityPolicy: isProduction ? true : {
        directives: {
          defaultSrc: ["'self'", '*'],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "'unsafe-eval'",
            'https:',
            'http:',
          ],
          styleSrc: ["'self'", "'unsafe-inline'", 'https:', 'http:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
          connectSrc: ["'self'", '*', 'https:', 'http:'],
          fontSrc: ["'self'", 'https:', 'data:'],
          objectSrc: ["'none'"],
          frameSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false, // Allow loading cross-origin resources
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Increase payload limit for base64 images (up to 50MB)
  app.use('/uploads', uploadAccessMiddleware, express.static(uploadDir, { dotfiles: 'deny', index: false }));
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Increase server timeout for long-running pipelines (Face Search can take 30-60s)
  const httpServer = app.getHttpServer();
  httpServer.setTimeout(55_000); // Railway proxy cuts at ~60s — must stay below
  httpServer.keepAliveTimeout = 65_000; // slightly above Railway's 60s proxy timeout
  httpServer.headersTimeout = 70_000; // must be > keepAliveTimeout

  // Enable CORS (configurable for production)
  const corsOriginRaw = config.get<string>('CORS_ORIGIN');
  const corsOrigins = corsOriginRaw
    ? corsOriginRaw
        .split(',')
        .map((o: string) => o.trim())
        .filter(Boolean)
    : [];

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : !isProduction,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Signature',
      'X-Timestamp',
      'X-Correlation-Id',
    ],
    exposedHeaders: ['x-correlation-id'],
    credentials: true,
  });

  // HTTPS redirect middleware (production only)
  const httpsRedirectEnabled =
    config.get<string>('HTTPS_REDIRECT_ENABLED') === 'true';
  if (httpsRedirectEnabled) {
    app.use((req: any, res: any, next: () => void) => {
      if (req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(301, 'https://' + req.headers.host + req.url);
      }
      next();
    });
  }

  // Set unified API prefix for all routes (except test-ui and swagger)
  app.setGlobalPrefix('api/v1', {
    exclude: ['test-ui', 'api', 'health'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
    .setTitle('OSINT Microservice API - God-Level Edition')
    .setDescription(
      `
**Open Source Intelligence - Sistema de Inteligencia Profesional**

Esta API proporciona búsqueda OSINT completa con las siguientes características:

## 🚀 Características

### Multi-Modal Input
- Imagen (camera, datasec, osint, upload)
- Datos personales (nombre, email, teléfono, RFC, CURP)
- Contexto (organización, cargo, industria)
- Opciones configurables de búsqueda

### Multi-Motor Search
- **Bing Search** - Resultados web con API oficial
- **DuckDuckGo** - Búsqueda privada sin tracking
- **YouTube** - Videos relacionados con la persona
- **Web Archive** - Snapshots históricos de Wayback Machine
- **Reverse Image Search** - Google, Yandex, TinEye

### Intelligence Analysis
- **Google Vision AI** - Face detection, OCR, labels, logos
- **Gemini Image Enhancement** - Mejora biométrica de rostros
- **Groq Identification** - Identificación con IA
- **Web Crawler** - Extracción profunda de contenido

### Evidence System
- SHA256 deduplicación automática
- Reliability scoring (0.0-1.0)
- Extracción automática de emails, phones, RFCs, CURPs
- MongoDB persistence con Mongoose
- Categorización por tipo (search_result, video, crawled_page, etc.)

### Scoring & Analytics
- **Multi-dimensional scoring**: Identity (45%), Legal (35%), Financial (20%)
- **Confidence levels**: HIGH, MEDIUM, LOW
- Score breakdown detallado
- Estadísticas por fuente

### Clustering & Organization
- Agrupación alfabética A-Z
- Búsqueda por letra de cluster
- Estadísticas por cluster

### Reports & Timeline
- **Markdown Reports** - Formato texto con tablas
- **PDF Reports** - Diseño profesional con Puppeteer
- **Timeline** - Vista cronológica de hallazgos
- Exportación a JSON/Markdown

### Rate Limiting & Compliance
- Redis-based rate limiting
- Límites predefinidos por API (Groq: 600/day, Gemini: 1500/day, Bing: 1000/day)
- Audit logs completos para compliance
- Tracking de uso de APIs

## 📊 Stack Tecnológico

- **Framework**: NestJS 11 + TypeScript 5.7
- **Database**: MongoDB + Mongoose ODM
- **Cache**: Redis + ioredis
- **AI**: Google Gemini + Groq + Google Vision AI
- **Web Scraping**: Puppeteer + Cheerio
- **Image**: Cloudinary storage
- **Deployment**: Railway (NO Docker, NO AWS)

## 🔑 Autenticación

La mayoría de endpoints requieren Bearer Token JWT.

## 📝 Rate Limits

Todos los endpoints con IA tienen rate limits configurados:
- Groq: 600 requests/day, 10/minute
- Gemini: 1500 requests/day, 15/minute
- Bing: 1000 requests/day, 30/minute
- YouTube: 10,000 units/day (1 search = 100 units)

## 📞 Soporte

**Email**: soporte@osint-system.com  
**Docs**: https://docs.osint-system.com  
**GitHub**: https://github.com/your-org/osint-microservice
    `,
    )
    .setVersion('2.8.0')
    .setContact(
      'deco31416.com',
      'https://osint-deco.local',
      'support@osint-deco.local',
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addTag('OSINT v2', 'Endpoints principales de búsqueda y análisis')
    .addTag('Evidence', 'Gestión de evidencias y deduplicación')
    .addTag('Scoring', 'Sistema de scoring multi-dimensional')
    .addTag('Reports', 'Generación de reportes (Markdown, PDF)')
    .addTag('Timeline', 'Vista cronológica de hallazgos')
    .addTag('Rate Limits', 'Monitoreo de uso de APIs')
    .addTag('Audit Logs', 'Logs de auditoría para compliance')
    .addTag('Vision AI', 'Análisis de imagen con Google Vision')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT authentication token from auth microservice',
      },
      'JWT-auth',
    )
    .addServer('http://localhost:7105', 'Local Development')
    .addServer('https://osint.railway.app', 'Production (Railway)')
    .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'OSINT API Docs',
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info { margin: 50px 0 }
      .swagger-ui .info .title { font-size: 36px; }
    `,
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
      showRequestDuration: true,
      syntaxHighlight: {
        activate: true,
        theme: 'monokai',
      },
    },
  });
  }

  const server = await app.listen(port);
  // Ensure the listening server also has the extended timeout
  server.setTimeout(300_000); // 5 min — Railway proxy may cut at ~30s but Node must stay alive

  logOk(logger, `Environment: ${nodeEnv}`);
  logOk(logger, `Port: ${port}`);
  logOk(logger, `CORS origins loaded: ${corsOrigins.length}`);
  try {
    const mongoAudit = await auditMongoConnection(app);
    if (mongoAudit.connected) logOk(logger, `MongoDB: connected (${mongoAudit.detail})`);
    else logError(logger, `MongoDB: not connected (${mongoAudit.detail})`);
  } catch (error) {
    logError(logger, `MongoDB: audit failed (${error instanceof Error ? error.message : String(error)})`);
  }
  try {
    const redisAudit = await auditRedisConnection(app);
    if (redisAudit.connected) logOk(logger, `Redis: connected (${redisAudit.detail})`);
    else logWarn(logger, `Redis: degraded (${redisAudit.detail})`);
  } catch (error) {
    logWarn(logger, `Redis: audit failed (${error instanceof Error ? error.message : String(error)})`);
  }
  if (isConfigured(config, 'GROQ_API_KEYS', 'GROQ_API_KEY')) {
    logOk(logger, 'Groq: configured');
  } else {
    logWarn(logger, 'Groq: missing — AI enrichment may be degraded');
  }
  if (isConfigured(config, 'GEMINI_API_KEY', 'GOOGLE_API_KEY')) {
    logOk(logger, 'Vision AI: configured');
  } else {
    logWarn(logger, 'Vision AI: missing — image analysis may be degraded');
  }
  if (isConfigured(config, 'TAVILY_API_KEY', 'SERPER_API_KEY', 'BING_SEARCH_API_KEY', 'BRAVE_SEARCH_API_KEY')) {
    logOk(logger, 'Search providers: configured');
  } else {
    logWarn(logger, 'Search providers missing — OSINT search coverage degraded');
  }
  if (isConfigured(config, 'MICROSERVICES_API_KEY', 'INTERNAL_API_SECRET')) {
    logOk(logger, 'Internal API guard: enabled');
  } else {
    logError(logger, 'INTERNAL_API_SECRET missing — protected routes will reject requests');
  }
  if (swaggerEnabled) {
    logWarn(logger, 'Swagger: enabled at /docs');
  } else {
    logOk(logger, 'Swagger: disabled');
  }
  logInfo(logger, `Health: ${serviceUrl}/health`);
  logInfo(logger, 'Startup audit completed');
  logStartupSuccess(logger, 'OSINT-Deco Main Microservice', serviceUrl);
}

bootstrap();
