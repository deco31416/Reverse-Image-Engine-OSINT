# 🔗 OSINT Integration & Testing Guide

**Microservicio OSINT v2.0 - Integración con Backend Gateway y Plan de Testing**

---

## 📋 Tabla de Contenidos

- [Arquitectura de Integración](#-arquitectura-de-integración)
- [Configuración del Gateway](#-configuración-del-gateway)
- [Plan de Testing](#-plan-de-testing)
- [Testing Unitario](#-testing-unitario)
- [Testing E2E](#-testing-e2e)
- [Testing Manual con Swagger](#-testing-manual-con-swagger)
- [Checklist de Integración](#-checklist-de-integración)

---

## 🏗️ Arquitectura de Integración

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                          │
│                      Port: 3005 (PNPM)                              │
│  • UI Components (SocCameraStage, MinutasPanel, etc.)              │
│  • Hooks (useCamera, useCustomObjectDetection, etc.)               │
│  • Services (API calls)                                             │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                │ HTTP Requests
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    BACKEND GATEWAY (NestJS)                         │
│                      Port: 7010 (Yarn)                              │
│  • API Gateway Pattern                                              │
│  • JWT Authentication (JwtAuthGuard)                                │
│  • Role-Based Access Control (RolesGuard)                           │
│  • Routes:                                                          │
│    - /api/osint/* → Legacy v1 endpoints (osint.controller.ts)      │
│    - /api/v1/osint/* → New v2 endpoints (osint-v2.controller.ts)   │
│  • Proxy Module: osint-proxy/                                      │
│    - osint.controller.ts (Legacy)                                   │
│    - osint-v2.controller.ts (God-Level Edition) ✅ NEW             │
│    - osint.service.ts (Legacy)                                      │
│    - osint-v2.service.ts (Multi-modal AI) ✅ NEW                   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                │ HTTP Proxy (axios)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  OSINT MICROSERVICE v2.0 (NestJS)                   │
│                      Port: 7105 (Yarn)                              │
│  • Multi-Modal Input System                                         │
│  • Multi-Motor Search (Bing, DuckDuckGo, YouTube, WebArchive)      │
│  • AI Intelligence (Google Vision, Gemini, Groq)                    │
│  • Evidence System (SHA256 Deduplication)                           │
│  • Multi-Dimensional Scoring (45/35/20)                             │
│  • Report Generators (Markdown, PDF, Timeline)                      │
│  • Redis Rate Limiting                                              │
│  • MongoDB Persistence                                              │
│  • 15 REST API Endpoints (/api/v1/osint/*)                         │
└─────────────────────────────────────────────────────────────────────┘
                    │                          │
                    ▼                          ▼
          ┌──────────────────┐      ┌──────────────────┐
          │   MongoDB Atlas  │      │  Redis (Upstash) │
          │   Database       │      │  Cache & Limits  │
          └──────────────────┘      └──────────────────┘
```

### Flujo de Request Completo

1. **Frontend** → Usuario interactúa con UI (ejemplo: búsqueda OSINT)
2. **Frontend** → Envía request a Backend Gateway:
   ```
   POST http://localhost:7010/api/v1/osint/search
   Headers: { Authorization: "Bearer <JWT_TOKEN>" }
   Body: { personalInfo: {...}, image: {...}, options: {...} }
   ```

3. **Backend Gateway** → Valida JWT y roles (JwtAuthGuard + RolesGuard)
4. **Backend Gateway** → Proxy request a Microservicio OSINT:
   ```
   POST http://localhost:7105/api/v1/osint/search
   Body: { personalInfo: {...}, image: {...}, options: {...} }
   ```

5. **Microservicio OSINT** → Procesa request:
   - Valida input (DTOs)
   - Orquesta multi-modal input
   - Ejecuta búsquedas en paralelo
   - Deduplica evidencias (SHA256)
   - Calcula scores multi-dimensionales
   - Guarda en MongoDB
   - Aplica rate limiting (Redis)
   - Registra audit log

6. **Microservicio OSINT** → Responde con searchId
7. **Backend Gateway** → Proxy response a Frontend
8. **Frontend** → Muestra resultado y polling para updates

---

## ⚙️ Configuración del Gateway

### Backend Gateway (c:\Users\HP\Desktop\ia-cam\backend)

#### 1. Variables de Entorno

Archivo: `.env`

```env
# ========================================
# OSINT MICROSERVICE v2.0
# ========================================
OSINT_SERVICE_URL=http://localhost:7105

# Para producción (Railway):
# OSINT_SERVICE_URL=https://ia-cam-osint-v2.railway.app
```

#### 2. Módulo Configurado

Archivo: `src\app.module.ts`

```typescript
import { OsintProxyModule } from './modules/osint-proxy/osint-proxy.module';

@Module({
  imports: [
    // ... otros módulos
    OsintProxyModule, // ✅ Ya está incluido
  ],
})
export class AppModule {}
```

#### 3. Endpoints Disponibles

**Legacy v1 (Anterior):**
- `GET /api/osint/searches` - Listar búsquedas
- `POST /api/osint/searches` - Crear búsqueda
- `POST /api/osint/person-search` - Búsqueda de persona
- ... (endpoints antiguos)

**New v2 (God-Level Edition):** ✅
- `POST /api/v1/osint/search` - Multi-modal search
- `GET /api/v1/osint/search/:searchId` - Estado de búsqueda
- `GET /api/v1/osint/evidence/:searchId` - Evidencias
- `GET /api/v1/osint/evidence/:searchId/stats` - Estadísticas
- `GET /api/v1/osint/scores/:searchId` - Scores multi-dimensional
- `GET /api/v1/osint/clusters` - Clusters A-Z
- `GET /api/v1/osint/report/:searchId/markdown` - Reporte Markdown
- `GET /api/v1/osint/report/:searchId/pdf` - Reporte PDF
- `GET /api/v1/osint/timeline/:searchId` - Timeline
- `GET /api/v1/osint/rate-limits` - Rate limits
- `GET /api/v1/osint/rate-limits/:service` - Rate limit específico
- `GET /api/v1/osint/audit-logs` - Logs de auditoría
- `GET /api/v1/osint/audit-logs/stats` - Estadísticas de logs
- `POST /api/v1/osint/vision/analyze` - Google Vision AI
- `GET /api/v1/osint/health` - Health check

### Microservicio OSINT (c:\Users\HP\Desktop\ia-cam\micro-ts-osint)

#### Variables de Entorno

Ver [README.md](./README.md) sección Configuración para lista completa.

**Mínimo requerido:**
```env
PORT=7105
MONGODB_URI=<connection_string>
REDIS_HOST=<host>
REDIS_PORT=6379
REDIS_PASSWORD=<password>
GEMINI_API_KEY=<key>
GROQ_API_KEY=<key>
CLOUDINARY_CLOUD_NAME=<name>
CLOUDINARY_API_KEY=<key>
CLOUDINARY_API_SECRET=<secret>
```

---

## 🧪 Plan de Testing

### Testing Pyramid

```
                    ┌───────────┐
                    │   E2E     │  ← 10% (Testing completo Frontend → Backend → OSINT)
                    │  Testing  │
                    └───────────┘
                 ┌─────────────────┐
                 │   Integration   │  ← 20% (Backend Gateway ↔ OSINT Microservice)
                 │    Testing      │
                 └─────────────────┘
            ┌───────────────────────────┐
            │      Unit Testing         │  ← 70% (Servicios individuales)
            │  (Services, Controllers)  │
            └───────────────────────────┘
```

### Testing Scope

**Total Tests:** ~50-60 tests distribuidos en:
- **Unit Tests:** 35-40 tests (70%)
- **Integration Tests:** 10-12 tests (20%)
- **E2E Tests:** 5-8 tests (10%)

---

## 🔬 Testing Unitario

### Microservicio OSINT (micro-ts-osint)

#### Estructura de Tests

```
micro-ts-osint/
├── src/
│   └── osint/
│       └── services/
│           ├── evidence.service.spec.ts
│           ├── rate-limit.service.spec.ts
│           ├── regex-extractor.service.spec.ts
│           ├── scoring.service.spec.ts
│           ├── clustering.service.spec.ts
│           ├── input-orchestrator.service.spec.ts
│           ├── multi-search-orchestrator.service.spec.ts
│           ├── bing-search.service.spec.ts
│           ├── duckduckgo-search.service.spec.ts
│           ├── youtube-search.service.spec.ts
│           ├── web-archive.service.spec.ts
│           ├── google-vision.service.spec.ts
│           ├── markdown-report-generator.service.spec.ts
│           ├── pdf-report-generator.service.spec.ts
│           └── timeline-generator.service.spec.ts
└── test/
    └── app.e2e-spec.ts
```

#### Ejemplo: evidence.service.spec.ts

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EvidenceService } from './evidence.service';
import { Evidence } from '../schemas/evidence.schema';

describe('EvidenceService', () => {
  let service: EvidenceService;
  let mockEvidenceModel: any;

  beforeEach(async () => {
    mockEvidenceModel = {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      countDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceService,
        {
          provide: getModelToken(Evidence.name),
          useValue: mockEvidenceModel,
        },
      ],
    }).compile();

    service = module.get<EvidenceService>(EvidenceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createEvidence', () => {
    it('should create evidence with SHA256 hash', async () => {
      const mockData = {
        searchId: 'search123',
        source: 'bing',
        url: 'https://example.com',
        title: 'Test Result',
        content: 'Test content',
      };

      mockEvidenceModel.findOne.mockResolvedValue(null); // No duplicate
      mockEvidenceModel.create.mockResolvedValue({ ...mockData, _id: 'evidence123' });

      const result = await service.createEvidence(mockData as any);

      expect(result).toBeDefined();
      expect(mockEvidenceModel.findOne).toHaveBeenCalled();
      expect(mockEvidenceModel.create).toHaveBeenCalled();
    });

    it('should skip duplicate evidence (same hash)', async () => {
      const mockData = {
        searchId: 'search123',
        source: 'bing',
        url: 'https://example.com',
        title: 'Test Result',
        content: 'Test content',
      };

      mockEvidenceModel.findOne.mockResolvedValue({ _id: 'existing123' }); // Duplicate

      const result = await service.createEvidence(mockData as any);

      expect(result).toBeDefined();
      expect(result._id).toBe('existing123');
      expect(mockEvidenceModel.create).not.toHaveBeenCalled();
    });
  });

  describe('findBySearchId', () => {
    it('should return evidences with filters', async () => {
      const mockEvidences = [
        { _id: '1', searchId: 'search123', source: 'bing' },
        { _id: '2', searchId: 'search123', source: 'duckduckgo' },
      ];

      mockEvidenceModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            sort: jest.fn().mockResolvedValue(mockEvidences),
          }),
        }),
      });

      const result = await service.findBySearchId('search123', { source: 'bing' });

      expect(result).toBeDefined();
      expect(mockEvidenceModel.find).toHaveBeenCalledWith({
        searchId: 'search123',
        source: 'bing',
      });
    });
  });

  describe('calculateStats', () => {
    it('should calculate correct statistics', async () => {
      const mockEvidences = [
        { source: 'bing', category: 'search_result', reliability: 0.8 },
        { source: 'bing', category: 'search_result', reliability: 0.9 },
        { source: 'duckduckgo', category: 'search_result', reliability: 0.7 },
        { source: 'youtube', category: 'video', reliability: 0.85 },
      ];

      mockEvidenceModel.find.mockResolvedValue(mockEvidences);

      const result = await service.calculateStats('search123');

      expect(result.total).toBe(4);
      expect(result.sources.bing).toBe(2);
      expect(result.sources.duckduckgo).toBe(1);
      expect(result.sources.youtube).toBe(1);
      expect(result.categories.search_result).toBe(3);
      expect(result.categories.video).toBe(1);
      expect(result.avgReliability).toBeCloseTo(0.8125, 2);
    });
  });
});
```

#### Tests por Servicio

**1. evidence.service.spec.ts (8 tests)**
- ✅ should be defined
- ✅ should create evidence with SHA256 hash
- ✅ should skip duplicate evidence (same hash)
- ✅ should find evidences by searchId
- ✅ should find evidences with filters (source, category, limit)
- ✅ should calculate stats correctly
- ✅ should extract structured data (emails, phones, RFCs, CURPs)
- ✅ should update extracted data

**2. rate-limit.service.spec.ts (6 tests)**
- ✅ should be defined
- ✅ should check limit and allow request (under limit)
- ✅ should check limit and reject request (over limit)
- ✅ should increment usage with TTL
- ✅ should get remaining requests
- ✅ should get service usage details

**3. regex-extractor.service.spec.ts (5 tests)**
- ✅ should extract emails correctly
- ✅ should extract phone numbers (international format)
- ✅ should extract Mexican RFCs
- ✅ should extract Mexican CURPs
- ✅ should extract URLs

**4. scoring.service.spec.ts (4 tests)**
- ✅ should calculate identity score (45%)
- ✅ should calculate legal score (35%)
- ✅ should calculate financial score (20%)
- ✅ should calculate overall score with breakdown

**5. clustering.service.spec.ts (3 tests)**
- ✅ should assign cluster letter from nombre
- ✅ should get searches by cluster letter
- ✅ should get all clusters (A-Z) with counts

**6. input-orchestrator.service.spec.ts (5 tests)**
- ✅ should generate query from personalInfo only
- ✅ should generate query from image + personalInfo
- ✅ should enhance image with Gemini AI
- ✅ should extract biometric data from enhanced image
- ✅ should assign cluster letter

**7. multi-search-orchestrator.service.spec.ts (4 tests)**
- ✅ should execute searches in parallel
- ✅ should handle search failures gracefully
- ✅ should execute reverse image search
- ✅ should calculate scores after search complete

#### Comandos de Testing

```bash
# Ejecutar todos los tests unitarios
yarn test

# Ejecutar con coverage
yarn test:cov

# Ejecutar en watch mode
yarn test:watch

# Ejecutar test específico
yarn test evidence.service.spec
```

### Backend Gateway (backend)

#### Tests para osint-v2.service

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { OsintV2Service } from './osint-v2.service';
import { of, throwError } from 'rxjs';

describe('OsintV2Service', () => {
  let service: OsintV2Service;
  let httpService: HttpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OsintV2Service,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
            get: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:7105'),
          },
        },
      ],
    }).compile();

    service = module.get<OsintV2Service>(OsintV2Service);
    httpService = module.get<HttpService>(HttpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSearch', () => {
    it('should proxy request to microservice', async () => {
      const mockResponse = {
        data: { searchId: 'search123', query: 'test' },
      };

      jest.spyOn(httpService, 'post').mockReturnValue(of(mockResponse as any));

      const result = await service.createSearch({ personalInfo: { nombre: 'Test' } });

      expect(result).toEqual(mockResponse.data);
      expect(httpService.post).toHaveBeenCalledWith(
        'http://localhost:7105/api/v1/osint/search',
        { personalInfo: { nombre: 'Test' } },
        expect.any(Object),
      );
    });

    it('should handle errors from microservice', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        throwError(() => ({
          response: { data: { message: 'Error en microservicio' } },
        })),
      );

      await expect(service.createSearch({})).rejects.toThrow();
    });
  });

  describe('getSearchStatus', () => {
    it('should get search status', async () => {
      const mockResponse = {
        data: { searchId: 'search123', status: 'completed' },
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(mockResponse as any));

      const result = await service.getSearchStatus('search123');

      expect(result).toEqual(mockResponse.data);
    });

    it('should throw NotFoundException for 404', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(
        throwError(() => ({ response: { status: 404 } })),
      );

      await expect(service.getSearchStatus('invalid')).rejects.toThrow(
        'Búsqueda OSINT invalid no encontrada',
      );
    });
  });
});
```

---

## 🔗 Testing E2E

### Microservicio OSINT (test/osint-v2.e2e-spec.ts)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('OSINT v2 API (e2e)', () => {
  let app: INestApplication;
  let searchId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/osint/search', () => {
    it('should create multi-modal search', () => {
      return request(app.getHttpServer())
        .post('/api/v1/osint/search')
        .send({
          personalInfo: {
            nombre: 'Juan',
            apellido: 'Pérez',
            email: 'juan.perez@example.com',
          },
          options: {
            searchEngines: ['bing', 'duckduckgo'],
            deepSearch: false,
          },
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('searchId');
          expect(res.body).toHaveProperty('query');
          expect(res.body).toHaveProperty('clusterLetter');
          expect(res.body.clusterLetter).toBe('J');
          searchId = res.body.searchId;
        });
    });
  });

  describe('GET /api/v1/osint/search/:searchId', () => {
    it('should get search status', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/osint/search/${searchId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('searchId');
          expect(res.body).toHaveProperty('evidenceCount');
          expect(res.body).toHaveProperty('scores');
        });
    });

    it('should return 404 for invalid searchId', () => {
      return request(app.getHttpServer())
        .get('/api/v1/osint/search/invalid123')
        .expect(404);
    });
  });

  describe('GET /api/v1/osint/evidence/:searchId', () => {
    it('should get evidences', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/osint/evidence/${searchId}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });

    it('should filter evidences by source', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/osint/evidence/${searchId}?source=bing`)
        .expect(200);
    });
  });

  describe('GET /api/v1/osint/scores/:searchId', () => {
    it('should get multi-dimensional scores', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/osint/scores/${searchId}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('identity');
          expect(res.body).toHaveProperty('legal');
          expect(res.body).toHaveProperty('financial');
          expect(res.body).toHaveProperty('overall');
          expect(res.body).toHaveProperty('confidence');
          expect(res.body).toHaveProperty('breakdown');
        });
    });
  });

  describe('GET /api/v1/osint/health', () => {
    it('should return health status', () => {
      return request(app.getHttpServer())
        .get('/api/v1/osint/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('status');
          expect(res.body.status).toBe('ok');
          expect(res.body).toHaveProperty('services');
        });
    });
  });
});
```

### Backend Gateway (test/osint-integration.e2e-spec.ts)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('Backend Gateway → OSINT Microservice (e2e)', () => {
  let app: INestApplication;
  let jwtToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Obtener JWT token para autenticación
    const authResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'test123',
      });

    jwtToken = authResponse.body.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Gateway Proxy to OSINT v2', () => {
    it('should proxy POST /api/v1/osint/search', () => {
      return request(app.getHttpServer())
        .post('/api/v1/osint/search')
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({
          personalInfo: {
            nombre: 'María',
            apellido: 'García',
          },
          options: {
            searchEngines: ['bing'],
          },
        })
        .expect(201);
    });

    it('should require authentication', () => {
      return request(app.getHttpServer())
        .post('/api/v1/osint/search')
        .send({})
        .expect(401); // Unauthorized
    });

    it('should enforce role-based access', () => {
      // Assuming jwtToken has 'investigator' role
      return request(app.getHttpServer())
        .get('/api/v1/osint/rate-limits')
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403); // Forbidden (requires super_admin or admin)
    });
  });
});
```

---

## 📱 Testing Manual con Swagger

### Microservicio OSINT

**URL:** http://localhost:7105/docs

#### Pasos de Testing Manual:

1. **Abrir Swagger UI**
   ```bash
   # Terminal 1: Iniciar microservicio OSINT
   cd c:\Users\HP\Desktop\ia-cam\micro-ts-osint
   yarn start:dev
   
   # Navegar a http://localhost:7105/docs
   ```

2. **Test 1: Health Check**
   - Endpoint: `GET /api/v1/osint/health`
   - Click "Try it out" → "Execute"
   - Expected: `{ "status": "ok", "services": {...} }`

3. **Test 2: Create Search**
   - Endpoint: `POST /api/v1/osint/search`
   - Body:
   ```json
   {
     "personalInfo": {
       "nombre": "Juan",
       "apellido": "Pérez",
       "email": "juan.perez@example.com"
     },
     "options": {
       "searchEngines": ["bing", "duckduckgo"],
       "deepSearch": false
     }
   }
   ```
   - Expected: `{ "searchId": "...", "query": "...", "clusterLetter": "J" }`
   - **Copiar searchId para siguientes tests**

4. **Test 3: Get Search Status**
   - Endpoint: `GET /api/v1/osint/search/{searchId}`
   - Usar searchId del paso anterior
   - Expected: `{ "searchId": "...", "evidenceCount": ..., "scores": {...} }`

5. **Test 4: Get Evidence**
   - Endpoint: `GET /api/v1/osint/evidence/{searchId}`
   - Expected: Array de evidencias con SHA256 hashes

6. **Test 5: Get Scores**
   - Endpoint: `GET /api/v1/osint/scores/{searchId}`
   - Expected: `{ "identity": ..., "legal": ..., "financial": ..., "overall": ... }`

7. **Test 6: Generate Markdown Report**
   - Endpoint: `GET /api/v1/osint/report/{searchId}/markdown`
   - Expected: Markdown text con reporte completo

8. **Test 7: Generate PDF Report**
   - Endpoint: `GET /api/v1/osint/report/{searchId}/pdf`
   - Expected: PDF file downloaded

9. **Test 8: Get Timeline**
   - Endpoint: `GET /api/v1/osint/timeline/{searchId}?format=json`
   - Expected: Array de eventos cronológicos

10. **Test 9: Get Clusters**
    - Endpoint: `GET /api/v1/osint/clusters`
    - Expected: Array A-Z con counts

11. **Test 10: Get Rate Limits**
    - Endpoint: `GET /api/v1/osint/rate-limits`
    - Expected: `{ "groq": {...}, "gemini": {...}, "bing": {...}, "youtube": {...} }`

### Backend Gateway

**URL:** http://localhost:7010/docs

#### Pasos de Testing Manual:

1. **Abrir Swagger UI**
   ```bash
   # Terminal 2: Iniciar backend gateway
   cd c:\Users\HP\Desktop\ia-cam\backend
   yarn start:dev
   
   # Navegar a http://localhost:7010/docs
   ```

2. **Test 1: Login (Obtener JWT)**
   - Endpoint: `POST /api/auth/login`
   - Body:
   ```json
   {
     "email": "admin@ia-cam.com",
     "password": "admin123"
   }
   ```
   - Expected: `{ "access_token": "..." }`
   - **Copiar token**

3. **Test 2: Authorize Swagger**
   - Click botón "Authorize" (🔓)
   - Pegar: `Bearer <access_token>`
   - Click "Authorize"

4. **Test 3: Proxy Create Search**
   - Endpoint: `POST /api/v1/osint/search`
   - Body (igual que microservicio)
   - Expected: Response from microservicio OSINT

5. **Test 4: Proxy Get Search Status**
   - Endpoint: `GET /api/v1/osint/search/{searchId}`
   - Expected: Response from microservicio OSINT

6. **Test 5: Proxy Get Evidence**
   - Endpoint: `GET /api/v1/osint/evidence/{searchId}`
   - Expected: Response from microservicio OSINT

---

## ✅ Checklist de Integración

### Pre-Deployment

**Microservicio OSINT:**
- [ ] Todas las variables de entorno configuradas (.env.local)
- [ ] MongoDB conectado y accesible
- [ ] Redis conectado y accesible
- [ ] Compilación exitosa (`yarn build`)
- [ ] Tests unitarios pasando (`yarn test`)
- [ ] Tests E2E pasando (`yarn test:e2e`)
- [ ] Swagger accesible en http://localhost:7105/docs con ENABLE_SWAGGER=true y NODE_ENV!=production
- [ ] Health check respondiendo: `GET /api/v1/osint/health`

**Backend Gateway:**
- [ ] Variable OSINT_SERVICE_URL configurada
- [ ] OsintProxyModule incluido en AppModule
- [ ] osint-v2.controller.ts y osint-v2.service.ts creados
- [ ] Compilación exitosa (`yarn build`)
- [ ] Swagger accesible en http://localhost:7010/docs con ENABLE_SWAGGER=true y NODE_ENV!=production
- [ ] JWT authentication funcionando

**Frontend:**
- [ ] Services configurados para llamar a backend gateway
- [ ] Hooks actualizados para usar endpoint v2
- [ ] UI components conectados

### Post-Deployment

**Integration Testing:**
- [ ] Frontend → Backend Gateway: Auth funcionando
- [ ] Backend Gateway → OSINT Microservice: Proxy funcionando
- [ ] OSINT Microservice → MongoDB: Escritura/lectura funcionando
- [ ] OSINT Microservice → Redis: Rate limiting funcionando
- [ ] End-to-end flow completo: Search → Evidence → Report

**Performance Testing:**
- [ ] Búsqueda multi-modal < 5s (normal)
- [ ] Búsqueda deep search < 30s
- [ ] PDF generation < 10s
- [ ] Timeline generation < 2s
- [ ] Rate limiting respetándose

**Security Testing:**
- [ ] JWT validation en backend gateway
- [ ] Role-based access control funcionando
- [ ] API keys no expuestas en frontend
- [ ] CORS configurado correctamente
- [ ] Audit logs registrando operaciones

---

## 📝 Comandos Útiles

### Iniciar Todo (3 terminales)

**Terminal 1: Backend Gateway**
```powershell
cd c:\Users\HP\Desktop\ia-cam\backend
yarn start:dev
# http://localhost:7010
```

**Terminal 2: Microservicio OSINT**
```powershell
cd c:\Users\HP\Desktop\ia-cam\micro-ts-osint
yarn start:dev
# http://localhost:7105
```

**Terminal 3: Frontend**
```powershell
cd c:\Users\HP\Desktop\ia-cam\frontend
pnpm run dev
# http://localhost:3005
```

### Testing

**Microservicio OSINT:**
```bash
# Unit tests
yarn test

# E2E tests
yarn test:e2e

# Coverage
yarn test:cov

# Watch mode
yarn test:watch
```

**Backend Gateway:**
```bash
# Unit tests
yarn test

# E2E tests
yarn test:e2e
```

### Build

```bash
# Microservicio OSINT
cd c:\Users\HP\Desktop\ia-cam\micro-ts-osint
yarn build

# Backend Gateway
cd c:\Users\HP\Desktop\ia-cam\backend
yarn build

# Frontend
cd c:\Users\HP\Desktop\ia-cam\frontend
pnpm run build
```

---

## 🎯 Próximos Pasos

1. ✅ **Gateway Integration** → COMPLETADO
   - osint-v2.controller.ts creado
   - osint-v2.service.ts creado
   - osint-proxy.module.ts actualizado
   - .env.osint.example actualizado

2. ⏳ **Unit Testing** → PENDIENTE
   - Crear archivos .spec.ts para cada servicio
   - Implementar ~40 tests unitarios
   - Coverage objetivo: >80%

3. ⏳ **E2E Testing** → PENDIENTE
   - Crear osint-v2.e2e-spec.ts
   - Implementar ~8 tests E2E
   - Validar flujo completo

4. ⏳ **Manual Testing** → PENDIENTE
   - Testing con Swagger UI (15 endpoints)
   - Validar authentication/authorization
   - Validar reports (Markdown, PDF, Timeline)

5. ⏳ **Frontend Integration** → PENDIENTE
   - Crear services para llamar a backend gateway
   - Crear hooks para OSINT v2
   - UI components para búsquedas y reportes

---

**Creado:** 17 de Febrero de 2026  
**Versión:** 1.0  
**Autor:** IA-Cam Team
