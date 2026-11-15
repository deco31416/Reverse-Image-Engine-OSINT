// HISTORICAL diagnostic harness for the initial audit, before the security fixes.
// Current validation: the services' Jest/unittest suites, check-local-stack.cjs
// and check-image-pipeline.cjs. This harness assumes the old vulnerable behavior.
// Read-only source checks and harmless storage/network fixtures for the audit.
// This harness removes Nest decorators and stubs infrastructure; it is not an E2E suite.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
class HttpError extends Error {}
class Logger { log() {} warn() {} error() {} debug() {} }
const config = values => ({ get: key => values[key] });

function load(file, name, extras = {}) {
  let source = fs.readFileSync(path.join(root, file), 'utf8');
  source = source.replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/@(?:Injectable|Inject|InjectModel)\([^)]*\)/g, '')
    .replace(/export /g, '');
  const code = stripTypeScriptTypes(source, { mode: 'transform' });
  const context = {
    Buffer, URL, process, Date, setTimeout, clearTimeout, AbortController, fetch,
    Logger, BadRequestException: HttpError, NotFoundException: HttpError,
    UnauthorizedException: HttpError, ConflictException: HttpError,
    HttpException: HttpError, HttpStatus: { TOO_MANY_REQUESTS: 429 },
    path, fs, net: require('node:net'), http, https: require('node:https'),
    lookup: require('node:dns/promises').lookup,
    ...require('node:crypto'), nodeScrypt: require('node:crypto').scrypt,
    promisify: require('node:util').promisify,
    OsintSearch: { name: 'OsintSearch' }, Evidence: { name: 'Evidence' },
    IdentityCandidate: { name: 'IdentityCandidate' },
    ...extras,
  };
  return vm.runInNewContext(code + `\n${name};`, context, { filename: file });
}

function controllerMethod(name) {
  const source = fs.readFileSync(path.join(root, 'micro-ts-osint/src/osint/osint-v2.controller.ts'), 'utf8');
  const start = source.indexOf(`  async ${name}(`);
  if (start < 0) throw new Error(`Method not found: ${name}`);
  const end = source.indexOf('\n  }', start) + 4;
  const method = source.slice(start, end).replace(/@\w+\([^)]*\)/g, '');
  const code = stripTypeScriptTypes(`class Probe { ${method} }; Probe;`, { mode: 'transform' });
  return vm.runInNewContext(code, { Error, NotFoundException: HttpError });
}

async function main() {
  const results = [];
  const Security = load('micro-ts-osint/src/osint/services/security-validation.service.ts', 'SecurityValidationService');
  const security = new Security(config({ NODE_ENV: 'production' }));
  for (const url of ['http://127.0.0.1/a', 'http://[::1]/a', 'http://[::ffff:127.0.0.1]/a', 'http://[::ffff:10.0.0.1]/a']) {
    try { results.push({ probe: 'url-validation', url, accepted: await security.validatePublicUrl(url) }); }
    catch (e) { results.push({ probe: 'url-validation', url, rejected: e.message }); }
  }
  const server = http.createServer((req, res) => res.end('AUDIT_LOCAL_ONLY'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://[::ffff:127.0.0.1]:${server.address().port}/audit`;
    const data = await security.fetchPublicUrl(url);
    results.push({ probe: 'mapped-ip-fetch', localFixtureRead: data.toString() === 'AUDIT_LOCAL_ONLY' });
  } catch (e) { results.push({ probe: 'mapped-ip-fetch', error: e.message }); }
  finally { await new Promise(resolve => server.close(resolve)); }

  const fixtureDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'osint-audit-'));
  const uploadRoot = path.join(fixtureDir, 'uploads');
  const Storage = load('osint-social-scraper/src/storage/storage.service.ts', 'StorageService', { fs: require('node:fs/promises') });
  const storage = new Storage(config({ UPLOAD_DIR: uploadRoot }));
  const saved = await storage.saveBase64Image({
    base64: Buffer.from('<p>Harmless audit fixture</p>').toString('base64'),
    scope: '..', platform: 'instagram', owner: 'audit', filename: 'audit.html',
  });
  results.push({ probe: 'storage-path-and-type', escapedUploads: !saved.absolutePath.startsWith(uploadRoot + path.sep),
    htmlExtensionAccepted: saved.filename.endsWith('.html'), declaredMime: saved.mimeType,
    retainedArbitraryBytes: fs.readFileSync(saved.absolutePath, 'utf8') === '<p>Harmless audit fixture</p>' });
  const publicSaved = await storage.saveBase64Image({
    base64: Buffer.from('<p>Harmless audit fixture</p>').toString('base64'),
    scope: 'social', platform: 'instagram', owner: 'audit', filename: 'audit.html',
  });
  results.push({ probe: 'public-html-upload', storedInsideStaticRoot: publicSaved.absolutePath.startsWith(uploadRoot + path.sep),
    publicPath: publicSaved.relativePath, declaredMime: publicSaved.mimeType });
  // Fixture lives under a newly-created OS temporary directory; leave it intact for inspection.

  const PassportStrategy = () => class { constructor(options) { this.options = options; } };
  const Strategy = load('micro-ts-osint/src/common/strategies/jwt.strategy.ts', 'JwtStrategy', {
    PassportStrategy, Strategy: class {}, ExtractJwt: { fromAuthHeaderAsBearerToken: () => null },
  });
  const strategy = new Strategy(config({ JWT_SECRET: 'audit-fixture-secret' }));
  results.push({ probe: 'jwt-revocation', acceptedStaleClaims: await strategy.validate({ sub: 'audit-disabled-user', role: 'admin', iat: 1 }) });

  const Auth = load('micro-ts-osint/src/auth/auth.service.ts', 'AuthService');
  let count = 0;
  const auth = new Auth({}, config({}), {}, {}, { incr: async () => ++count, expire: async () => 1 });
  await auth.assertAuthRateLimit('login', 'audit-fixture', 8, 900);
  auth.redis = { incr: async () => { throw new Error('fixture-redis-offline'); } };
  await auth.assertAuthRateLimit('login', 'audit-fixture', 8, 900);
  results.push({ probe: 'auth-rate-limit', redisErrorAllowsAttempt: true });

  const Input = load('micro-ts-osint/src/osint/services/input-orchestrator.service.ts', 'InputOrchestratorService');
  let pipeline;
  const input = Object.create(Input.prototype);
  input.osintSearchModel = { aggregate: async value => {
    pipeline = value;
    return [{ letter: 'A', count: 1, searches: [{ id: 'foreign-case', query: 'private-other-user-query' }] }];
  } };
  const ClusterController = controllerMethod('getClusters');
  const clusters = new ClusterController();
  clusters.logger = new Logger();
  clusters.inputOrchestrator = input;
  results.push({ probe: 'clusters-isolation', returnedOtherUserFixture: await clusters.getClusters(),
    hasOwnerMatch: pipeline.some(stage => '$match' in stage) });

  const FaceController = controllerMethod('searchByFace');
  const faces = new FaceController();
  let storedOwner;
  Object.assign(faces, {
    logger: new Logger(), resolveVisualInput: async value => value, getDatasecContext: async () => ({}),
    inputOrchestrator: { processInput: async value => { storedOwner = value.userId; return { _id: 'fixture-case' }; } },
    faceSearchService: { executeFaceSearch: async () => ({ totalMatches: 0, searchEnginesUsed: [], matches: [] }) },
    multiSearchOrchestrator: { executeSearch: async () => {} },
  });
  await faces.searchByFace({ imageBase64: 'audit-fixture', userId: 'other-user' });
  results.push({ probe: 'face-search-owner', storedClientSuppliedOwner: storedOwner });

  const PromotionController = controllerMethod('promoteEvidenceToDatasec');
  const promotion = new PromotionController();
  let accessCalled = false;
  promotion.caseAccess = { assertEvidence: async () => { accessCalled = true; throw new Error('foreign-case'); } };
  promotion.datasecCuration = { promoteEvidence: async value => value };
  const promoted = await promotion.promoteEvidenceToDatasec({ evidenceId: 'foreign-evidence' });
  results.push({ probe: 'promotion-isolation', accessCheckCalled: accessCalled, delegatedForeignEvidence: promoted.evidenceId });

  const Roles = load('micro-ts-osint/src/common/guards/roles.guard.ts', 'RolesGuard', { ForbiddenException: HttpError });
  const roles = new Roles({ getAllAndOverride: () => undefined });
  const allowed = roles.canActivate({ getHandler: () => null, getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user: { role: 'viewer' } }) }) });
  results.push({ probe: 'viewer-role-default', allowedWhenRolesMetadataAbsent: allowed });

  const Queue = load('micro-ts-osint/src/osint/services/osint-job-queue.service.ts', 'OsintJobQueueService');
  const queue = new Queue(null, config({ OSINT_JOB_CONCURRENCY: '1' }), { executeSearch: () => new Promise(() => {}) });
  for (let i = 0; i < 4; i++) await queue.enqueueSearch(`fixture-${i}`);
  results.push({ probe: 'queue-fallback-concurrency', ...(await queue.getStats()) });

  let foundUser = { _id: 'fixture-user', username: 'audit', status: 'active' };
  const forgot = new Auth({}, config({ NODE_ENV: 'production', SMTP_HOST: 'fixture-mail', DASHBOARD_PUBLIC_URL: 'https://fixture.example' }),
    { findOne: () => ({ exec: async () => foundUser }) }, { create: async () => ({}) }, null);
  const existing = await forgot.forgotPassword({ identifier: 'audit' });
  foundUser = null;
  const nonexistent = await forgot.forgotPassword({ identifier: 'absent' });
  results.push({ probe: 'forgot-password-response', existingKeys: Object.keys(existing).filter(key => existing[key] !== undefined),
    unknownKeys: Object.keys(nonexistent), reportedDelivery: existing.delivery });

  const Markdown = load('micro-ts-osint/src/osint/services/markdown-report-generator.service.ts', 'MarkdownReportGeneratorService');
  const Pdf = load('micro-ts-osint/src/osint/services/pdf-report-generator.service.ts', 'PdfReportGeneratorService');
  const markdown = Object.create(Markdown.prototype);
  const query = '<script>globalThis.auditFixture=true</script>';
  const reportHeader = markdown.generateHeader({ _id: 'fixture-case', query }, 0);
  const pdf = new Pdf(markdown);
  const html = pdf.markdownToHtml(reportHeader);
  results.push({ probe: 'pdf-html-injection', rawScriptSurvivesQueryToHtml: html.includes(query) });

  fs.mkdirSync(path.join(root, '.audit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.audit', 'probe-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
