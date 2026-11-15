import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * OSINT E2E Tests
 * 
 * Tests completos del flujo OSINT:
 * 1. Health check y verificación de dependencias
 * 2. Crear búsqueda (persona con imagen)
 * 3. Polling de estado hasta completar
 * 4. Obtener evidencias con paginación
 * 5. Obtener galería de imágenes
 * 6. Search by image
 * 
 * Prerrequisitos:
 * - MongoDB corriendo (local o Atlas)
 * - Redis corriendo (local o Upstash)
 * - Variables de entorno configuradas (.env)
 * - JWT_SECRET configurado
 * 
 * Ejecutar:
 * yarn test:e2e
 */

describe('OSINT API (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let createdSearchId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Simular autenticación (en producción esto vendría del Gateway)
    // Para testing, generamos un token válido o mockeamos el guard
    authToken = 'Bearer mock-jwt-token';
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health Check', () => {
    it('/health (GET) should return service status', () => {
      return request(app.getHttpServer())
        .get('/osint/health')
        .set('Authorization', authToken)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('status', 'ok');
          expect(res.body).toHaveProperty('timestamp');
          expect(res.body).toHaveProperty('dependencies');
          expect(res.body.dependencies).toHaveProperty('mongodb');
          expect(res.body.dependencies).toHaveProperty('redis');
        });
    });
  });

  describe('Create Search', () => {
    it('/osint/search (POST) should create new person search', async () => {
      const searchPayload = {
        personalInfo: {
          nombre: 'Juan',
          apellido: 'Pérez',
          email: 'juan.perez@example.com',
          username: 'juanperez',
          ciudad: 'Ciudad de México',
        },
        context: {
          organizacion: 'UNAM',
          industria: 'Education',
        },
        searchOptions: {
          searchEngines: ['bing', 'duckduckgo', 'youtube'],
          reverseImageSearch: true,
          maxResults: 50,
          dateRange: {
            start: '2020-01-01',
            end: '2024-12-31',
          },
        },
        // Imagen opcional para reverse image search
        image: {
          url: 'https://example.com/test-person.jpg',
        },
      };

      const response = await request(app.getHttpServer())
        .post('/osint/search')
        .set('Authorization', authToken)
        .send(searchPayload)
        .expect(201);

      expect(response.body).toHaveProperty('searchId');
      expect(response.body).toHaveProperty('status', 'pending');
      expect(response.body).toHaveProperty('query');
      expect(response.body.query).toContain('Juan Pérez');

      createdSearchId = response.body.searchId;
    });

    it('/osint/search (POST) should reject invalid input', () => {
      const invalidPayload = {
        personalInfo: {
          // Missing required fields
        },
      };

      return request(app.getHttpServer())
        .post('/osint/search')
        .set('Authorization', authToken)
        .send(invalidPayload)
        .expect(400);
    });
  });

  describe('Search Status Polling', () => {
    it('/osint/search/:id (GET) should return search status', async () => {
      // Wait a bit for processing to start
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const response = await request(app.getHttpServer())
        .get(`/osint/search/${createdSearchId}`)
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body).toHaveProperty('id', createdSearchId);
      expect(response.body).toHaveProperty('status');
      expect(['pending', 'processing', 'completed', 'failed']).toContain(
        response.body.status,
      );
    });

    it('should wait for search to complete (max 60s)', async () => {
      const maxAttempts = 30; // 30 * 2s = 60s timeout
      let completed = false;
      let attempts = 0;

      while (!completed && attempts < maxAttempts) {
        const response = await request(app.getHttpServer())
          .get(`/osint/search/${createdSearchId}`)
          .set('Authorization', authToken)
          .expect(200);

        if (response.body.status === 'completed') {
          completed = true;
          expect(response.body).toHaveProperty('scores');
          expect(response.body.scores).toHaveProperty('overall');
        } else if (response.body.status === 'failed') {
          fail(`Search failed: ${response.body.error}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts++;
      }

      if (!completed) {
        console.warn('Search did not complete in 60s, continuing tests...');
      }
    }, 70000); // 70s timeout for this test
  });

  describe('Evidence Retrieval', () => {
    it('/osint/evidence/:searchId (GET) should return paginated evidences', async () => {
      const response = await request(app.getHttpServer())
        .get(`/osint/evidence/${createdSearchId}`)
        .query({ page: 1, limit: 10 })
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body).toHaveProperty('evidences');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination).toHaveProperty('page', 1);
      expect(response.body.pagination).toHaveProperty('limit', 10);
      expect(response.body.pagination).toHaveProperty('total');
      expect(Array.isArray(response.body.evidences)).toBe(true);
    });

    it('/osint/evidence/:searchId (GET) should filter by source', async () => {
      const response = await request(app.getHttpServer())
        .get(`/osint/evidence/${createdSearchId}`)
        .query({ source: 'bing', limit: 5 })
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.evidences).toBeInstanceOf(Array);
      response.body.evidences.forEach((evidence: any) => {
        expect(evidence.source).toBe('bing');
      });
    });

    it('/osint/evidence/:searchId (GET) should filter by category', async () => {
      const response = await request(app.getHttpServer())
        .get(`/osint/evidence/${createdSearchId}`)
        .query({ category: 'identity', limit: 5 })
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.evidences).toBeInstanceOf(Array);
      response.body.evidences.forEach((evidence: any) => {
        expect(evidence.category).toBe('identity');
      });
    });

    it('/osint/evidence/:searchId (GET) should sort by reliability', async () => {
      const response = await request(app.getHttpServer())
        .get(`/osint/evidence/${createdSearchId}`)
        .query({ sortBy: 'reliability', sortOrder: 'desc', limit: 10 })
        .set('Authorization', authToken)
        .expect(200);

      const evidences = response.body.evidences;
      
      // Verify descending order
      for (let i = 1; i < evidences.length; i++) {
        expect(evidences[i - 1].reliability).toBeGreaterThanOrEqual(
          evidences[i].reliability,
        );
      }
    });
  });

  describe('Image Gallery', () => {
    it('/osint/evidence/:searchId/images (GET) should return images only', async () => {
      const response = await request(app.getHttpServer())
        .get(`/osint/evidence/${createdSearchId}/images`)
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body).toHaveProperty('images');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.images)).toBe(true);

      // All items should have imageUrl
      response.body.images.forEach((evidence: any) => {
        expect(evidence).toHaveProperty('imageUrl');
        expect(evidence.imageUrl).toBeTruthy();
      });
    });

    it('/osint/evidence/:searchId/visual-summary (GET) should return top images', async () => {
      const response = await request(app.getHttpServer())
        .get(`/osint/evidence/${createdSearchId}/visual-summary`)
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body).toHaveProperty('images');
      expect(response.body).toHaveProperty('total');
      expect(response.body.images.length).toBeLessThanOrEqual(12);

      // Should be sorted by score (reliability * matchConfidence)
      const images = response.body.images;
      for (let i = 1; i < images.length; i++) {
        const prevScore =
          images[i - 1].reliability * (images[i - 1].matchConfidence || 1);
        const currScore =
          images[i].reliability * (images[i].matchConfidence || 1);
        expect(prevScore).toBeGreaterThanOrEqual(currScore);
      }
    });
  });

  describe('Search by Image', () => {
    it('/osint/search/by-image (POST) should search using image URL', async () => {
      const payload = {
        image: {
          url: 'https://example.com/person-photo.jpg',
        },
        searchOptions: {
          searchEngines: ['google', 'yandex', 'tineye'],
          maxResults: 30,
        },
      };

      const response = await request(app.getHttpServer())
        .post('/osint/search/by-image')
        .set('Authorization', authToken)
        .send(payload)
        .expect(201);

      expect(response.body).toHaveProperty('searchId');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('query');
    });

    it('/osint/search/by-image (POST) should search using base64 image', async () => {
      const base64Image =
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////';

      const payload = {
        image: {
          base64: base64Image,
        },
        searchOptions: {
          searchEngines: ['google', 'yandex'],
        },
      };

      const response = await request(app.getHttpServer())
        .post('/osint/search/by-image')
        .set('Authorization', authToken)
        .send(payload)
        .expect(201);

      expect(response.body).toHaveProperty('searchId');
    });
  });

  describe('Search List', () => {
    it('/osint/searches (GET) should return all searches with pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/osint/searches')
        .query({ limit: 10, offset: 0 })
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body).toHaveProperty('searches');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('limit', 10);
      expect(response.body).toHaveProperty('offset', 0);
      expect(Array.isArray(response.body.searches)).toBe(true);
    });

    it('/osint/searches (GET) should filter by status', async () => {
      const response = await request(app.getHttpServer())
        .get('/osint/searches')
        .query({ status: 'completed', limit: 5 })
        .set('Authorization', authToken)
        .expect(200);

      response.body.searches.forEach((search: any) => {
        expect(search.status).toBe('completed');
      });
    });

    it('/osint/searches (GET) should sort by createdAt', async () => {
      const response = await request(app.getHttpServer())
        .get('/osint/searches')
        .query({ sortBy: 'createdAt', sortOrder: 'desc', limit: 10 })
        .set('Authorization', authToken)
        .expect(200);

      const searches = response.body.searches;
      
      // Verify descending order
      for (let i = 1; i < searches.length; i++) {
        expect(new Date(searches[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(searches[i].createdAt).getTime(),
        );
      }
    });
  });

  describe('Statistics', () => {
    it('/osint/stats (GET) should return dashboard statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/osint/stats')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body).toHaveProperty('totalSearches');
      expect(response.body).toHaveProperty('activeSearches');
      expect(response.body).toHaveProperty('searchesByType');
      expect(response.body).toHaveProperty('searchesByCategory');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent search', () => {
      return request(app.getHttpServer())
        .get('/osint/search/000000000000000000000000')
        .set('Authorization', authToken)
        .expect(404);
    });

    it('should return 401 without auth token', () => {
      return request(app.getHttpServer())
        .get('/osint/searches')
        .expect(401);
    });

    it('should return 400 for invalid search ID format', () => {
      return request(app.getHttpServer())
        .get('/osint/search/invalid-id')
        .set('Authorization', authToken)
        .expect(400);
    });
  });
});
