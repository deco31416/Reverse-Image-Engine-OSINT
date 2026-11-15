import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import * as express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import { RedisCacheService } from './cache/redis-cache.service';
import { SocialSearchRepository } from './database/social-search.repository';
import { uploadAccessMiddleware } from './common/upload-access';

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
    config.get<string>('APP_PUBLIC_URL') ||
    config.get<string>('UPLOAD_PUBLIC_BASE_URL');
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
  logPlain(logger, `Health: ${url}/api/v1/health`);
  logOk(logger, 'Developed by deco31416.com');
  logPlain(logger, '============================================================');
}

function isConfigured(config: ConfigService, ...keys: string[]) {
  return keys.some((key) => {
    const value = config.get<string>(key) ?? process.env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

async function auditMongo(app: any) {
  const repository = app.get(SocialSearchRepository, { strict: false });
  return repository.healthCheck();
}

async function auditRedis(app: any) {
  const cache = app.get(RedisCacheService, { strict: false });
  return cache.healthCheck();
}

async function bootstrap() {
  const logger = new Logger('SocialScraperBootstrap');

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  const port = Number(config.get<string>('PORT') || 7110);
  const serviceUrl = resolveServiceUrl(config, port);
  logBanner(logger, 'OSINT-Deco Social Scraper', '1.3.0', port, serviceUrl);
  const nodeEnv = config.get<string>('NODE_ENV') || process.env.NODE_ENV || 'development';
  const uploadDir = config.get<string>('UPLOAD_DIR') || path.join(process.cwd(), 'uploads');
  const corsOrigin = String(config.get<string>('CORS_ORIGIN') || '*');
  const corsOrigins = corsOrigin === '*'
    ? []
    : corsOrigin
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
  const isProduction = nodeEnv === 'production';
  const swaggerEnabled = config.get<string>('ENABLE_SWAGGER') === 'true' && !isProduction;
  const internalApiKeyConfigured = isConfigured(config, 'SOCIAL_SCRAPER_API_KEY', 'MICROSERVICES_API_KEY');

  if (isProduction && !internalApiKeyConfigured) {
    logError(logger, 'SOCIAL_SCRAPER_API_KEY or MICROSERVICES_API_KEY missing — production startup blocked');
    throw new Error('SOCIAL_SCRAPER_API_KEY or MICROSERVICES_API_KEY is required in production');
  }

  fs.mkdirSync(uploadDir, { recursive: true });
  app.use(express.json({ limit: config.get<string>('BODY_LIMIT') || '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: config.get<string>('BODY_LIMIT') || '10mb' }));
  app.use(helmet());
  app.use('/uploads', uploadAccessMiddleware, express.static(uploadDir, { dotfiles: 'deny', index: false }));
  app.enableCors({
    origin: corsOrigin === '*' ? !isProduction : corsOrigins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api/v1');

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('OSINT Social Scraper API')
      .setDescription(
        'Microservicio de apoyo para búsqueda social OSINT, activos visuales, scraping controlado, cache Redis y persistencia MongoDB. Developed by deco31416.com.',
      )
      .setVersion('1.3.0')
      .setContact('deco31416.com', 'https://deco31416.com', '')
      .setLicense('MIT', 'https://opensource.org/licenses/MIT')
      .addTag('Health', 'Estado operativo del scraper social')
      .addTag('Social', 'Búsquedas por username, nombre, imagen y URL pública')
      .addTag('Assets', 'Activos visuales guardados desde redes sociales')
      .addApiKey(
        {
          type: 'apiKey',
          name: 'x-api-key',
          in: 'header',
          description: 'Internal API key used by micro-ts-osint.',
        },
        'x-api-key',
      )
      .addServer(`http://localhost:${port}`, 'Local Development')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      customSiteTitle: 'OSINT Social Scraper Docs',
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'list',
        filter: true,
        showRequestDuration: true,
      },
    });
  }

  await app.listen(port);
  logOk(logger, `Environment: ${nodeEnv}`);
  logOk(logger, `Port: ${port}`);
  try {
    const mongoAudit = await auditMongo(app);
    if (!mongoAudit.configured) {
      logWarn(logger, 'MongoDB: not configured — memory fallback active');
    } else if (mongoAudit.connected) {
      logOk(logger, `MongoDB: connected (readyState=${mongoAudit.readyState}, ping=ok)`);
    } else {
      logError(logger, `MongoDB: not connected (readyState=${mongoAudit.readyState})`);
    }
  } catch (error) {
    logError(logger, `MongoDB: audit failed (${error instanceof Error ? error.message : String(error)})`);
  }
  try {
    const redisAudit = await auditRedis(app);
    if (!redisAudit.configured) {
      logWarn(logger, 'Redis: not configured — cache degraded');
    } else if (redisAudit.connected) {
      logOk(logger, `Redis: connected (status=${redisAudit.status}, ping=ok)`);
    } else {
      logWarn(logger, `Redis: degraded (status=${redisAudit.status})`);
    }
  } catch (error) {
    logWarn(logger, `Redis: audit failed (${error instanceof Error ? error.message : String(error)})`);
  }
  const publicCrawlerEnabled = config.get<string>('PUBLIC_PROFILE_CRAWLER_ENABLED')?.trim().toLowerCase() !== 'false';
  if (publicCrawlerEnabled) {
    logOk(logger, `Public profile crawler: enabled own-first (timeout=${config.get<string>('PUBLIC_PROFILE_CRAWLER_TIMEOUT_MS') || 12000}ms)`);
  } else {
    logWarn(logger, 'Public profile crawler: disabled — provider/candidate fallback only');
  }
  if (isConfigured(config, 'RAPIDAPI_KEY', 'RAPIDAPI_KEY_FB_SCRAPER3', 'RAPIDAPI_KEY_INSTAGRAM', 'TIKTOK_RAPIDAPI_KEY')) {
    logOk(logger, 'RapidAPI providers: configured as secondary fallback');
  } else {
    logWarn(logger, 'RapidAPI providers missing — scraper will use own public crawler/candidate adapters only');
  }
  if (internalApiKeyConfigured) {
    logOk(logger, 'Internal API guard: enabled');
  } else {
    logWarn(logger, 'SOCIAL_SCRAPER_API_KEY/MICROSERVICES_API_KEY missing — local requests are unprotected');
  }
  logOk(logger, `CORS origins loaded: ${corsOrigin === '*' ? 'dev wildcard' : corsOrigins.length}`);
  logOk(logger, `Uploads mounted: /uploads -> ${uploadDir}`);
  logOk(logger, `Public uploads base: ${config.get<string>('UPLOAD_PUBLIC_BASE_URL') || `http://localhost:${port}`}`);
  if (swaggerEnabled) {
    logWarn(logger, 'Swagger: enabled at /docs');
  } else {
    logOk(logger, 'Swagger: disabled');
  }
  logInfo(logger, `Health: ${serviceUrl}/api/v1/health`);
  logInfo(logger, 'Startup audit completed');
  logStartupSuccess(logger, 'OSINT-Deco Social Scraper', serviceUrl);
}

bootstrap();
