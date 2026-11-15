import { Body, Controller, Get, INestApplication, Param, Post, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Types } from 'mongoose';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { JwtStrategy } from '../src/common/strategies/jwt.strategy';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { CaseAccessService } from '../src/osint/services/case-access.service';

// Real JWT and HTTP guards with isolated fixtures; no databases or paid APIs.
@Controller('osint')
@UseGuards(JwtAuthGuard, RolesGuard)
class CaseProbeController {
  constructor(private readonly access: CaseAccessService) {}
  @Get('search/:id')
  async get(@Param('id') id: string, @Req() req: any) {
    await this.access.assertSearch(id, req.user);
    return { searchId: id };
  }
  @Post('search')
  create(@Body() body: any, @Req() req: any) { return { userId: req.user.userId }; }
}

describe('Authenticated case HTTP API', () => {
  let app: INestApplication;
  let token: string;
  let viewerToken: string;
  const ownerId = new Types.ObjectId();
  const viewerId = new Types.ObjectId();
  const otherId = new Types.ObjectId();
  const config = { get: (key: string) => key === 'JWT_SECRET' ? 'isolated-test-secret-never-used-in-production' : undefined };
  const users: any[] = [
    { _id: ownerId, username: 'operator', email: 'operator@example.test', role: 'analyst', status: 'active', sessionVersion: 0 },
    { _id: viewerId, username: 'viewer', email: 'viewer@example.test', role: 'viewer', status: 'active', sessionVersion: 0 },
  ];

  beforeAll(async () => {
    const model = {
      estimatedDocumentCount: () => ({ exec: async () => users.length }),
      findById: (id: any) => ({ exec: async () => users.find((user) => String(user._id) === String(id)) }),
      findOne: (filter: any) => ({ exec: async () => users.find((user) => filter.$or.some((match: any) => match.username === user.username || match.email === user.email)) }),
    };
    const jwt = new JwtService({ secret: config.get('JWT_SECRET'), signOptions: { expiresIn: '10m' } });
    const auth = new AuthService(jwt, config as any, model as any, {} as any, null);
    const passwordHash = await (auth as any).hashPassword('Fixture-password-123');
    for (const user of users) { user.passwordHash = passwordHash; user.save = async () => user; }
    const cases: Record<string, any> = { own: { userId: String(ownerId) }, foreign: { userId: String(otherId) }, viewer: { userId: String(viewerId) } };
    const searches = { findById: (id: string) => ({ select: () => ({ lean: () => ({ exec: async () => cases[id] }) }) }) };
    const access = new CaseAccessService(searches as any, {} as any, {} as any, { log: async () => {} } as any);
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret: config.get('JWT_SECRET') })],
      controllers: [AuthController, CaseProbeController],
      providers: [{ provide: AuthService, useValue: auth }, { provide: CaseAccessService, useValue: access },
        { provide: JwtStrategy, useFactory: () => new JwtStrategy(config as any, auth) }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login')
      .send({ username: 'operator', password: 'Fixture-password-123' }).expect(200);
    token = login.body.accessToken;
    const viewer = await request(app.getHttpServer()).post('/api/v1/auth/login')
      .send({ username: 'viewer', password: 'Fixture-password-123' }).expect(200);
    viewerToken = viewer.body.accessToken;
  });

  afterAll(async () => { await app?.close(); });
  it('requires valid signed JWTs', async () => {
    await request(app.getHttpServer()).get('/api/v1/osint/search/own').expect(401);
    await request(app.getHttpServer()).get('/api/v1/osint/search/own').set('Authorization', 'Bearer fake-token').expect(401);
  });
  it('allows owners and denies foreign cases', async () => {
    await request(app.getHttpServer()).get('/api/v1/osint/search/own').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).get('/api/v1/osint/search/foreign').set('Authorization', `Bearer ${token}`).expect(403);
  });
  it('keeps viewers read-only', async () => {
    await request(app.getHttpServer()).get('/api/v1/osint/search/viewer').set('Authorization', `Bearer ${viewerToken}`).expect(200);
    await request(app.getHttpServer()).post('/api/v1/osint/search').set('Authorization', `Bearer ${viewerToken}`).send({}).expect(403);
  });
  it('validates login bodies with the application policy', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ username: 'operator', password: 'short', admin: true }).expect(400);
  });
  it('revokes sessions on the next HTTP request', async () => {
    users[0].sessionVersion = 1;
    await request(app.getHttpServer()).get('/api/v1/osint/search/own').set('Authorization', `Bearer ${token}`).expect(401);
  });
});
