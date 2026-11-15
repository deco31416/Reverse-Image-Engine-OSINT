const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('../micro-ts-osint/node_modules/dotenv');
const root = path.resolve(__dirname, '..');
const readEnv = (name) => dotenv.parse(fs.readFileSync(path.join(root, name, '.env.local')));

async function main() {
  const report = [];
  const endpoints = [
    ['core', 'http://127.0.0.1:7105/health'], ['scraper', 'http://127.0.0.1:7110/api/v1/health'],
    ['face', 'http://127.0.0.1:7120/health'], ['visual', 'http://127.0.0.1:7130/health'],
    ['dashboard', 'http://127.0.0.1:3003/login'],
  ];
  for (const [service, url] of endpoints) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      let data = {};
      if (response.headers.get('content-type')?.includes('json')) data = await response.json();
      const branded = service === 'dashboard' ? (await response.text()).includes('Reverse Image Engine') : ['face','visual'].includes(service) ? String(data.service).startsWith('osint-deco-') : undefined;
      report.push({ service, status: response.status, health: data.status, modelsLoaded: data.modelsLoaded, yoloAvailable: data.yoloAvailable, decoBrand: branded });
    } catch (error) { report.push({ service, error: error.cause?.code || error.name }); }
  }
  const dashboardEnv = readEnv('dashboard-osint');
  const base = dashboardEnv.OSINT_API_BASE.replace(/\/$/, '');
  const credentials = { username: dashboardEnv.OSINT_AUTH_USERNAME, password: dashboardEnv.OSINT_AUTH_PASSWORD };
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials), signal: AbortSignal.timeout(15000),
  });
  const auth = await login.json();
  report.push({ service: 'core-login', status: login.status, authenticated: Boolean(auth.accessToken), role: auth.user?.role });
  if (auth.accessToken) {
    const headers = { Authorization: `Bearer ${auth.accessToken}` };
    for (const endpoint of ['/auth/me', '/osint/searches?limit=2', '/osint/clusters', '/osint/stats', '/osint/face-jobs/stats']) {
      const response = await fetch(`${base}${endpoint}`, { headers, signal: AbortSignal.timeout(15000) });
      report.push({ service: 'core-route', endpoint, status: response.status });
    }
    const rejected = await fetch(`${base}/osint/visual/detect-faces`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: 'http://[::ffff:127.0.0.1]/private-image' }), signal: AbortSignal.timeout(10000),
    });
    report.push({ service: 'ssrf-live', status: rejected.status, blocked: rejected.status === 400 });
    const protectedHealth = await fetch(`${base}/osint/diagnostics`, { signal: AbortSignal.timeout(10000) });
    report.push({ service: 'diagnostics-anonymous', status: protectedHealth.status });
  }
  const dashboardLogin = await fetch('http://127.0.0.1:3003/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials), signal: AbortSignal.timeout(15000),
  });
  const cookie = dashboardLogin.headers.get('set-cookie')?.split(';')[0];
  report.push({ service: 'dashboard-login', status: dashboardLogin.status, cookieSet: Boolean(cookie) });
  if (cookie) {
    for (const endpoint of ['/api/auth/session', '/api/osint?path=%2Fosint%2Fsearches%3Flimit%3D2']) {
      const response = await fetch(`http://127.0.0.1:3003${endpoint}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15000) });
      report.push({ service: 'dashboard-route', endpoint, status: response.status });
    }
  }
  fs.writeFileSync(path.join(root, '.audit', 'runtime-checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.some((entry) => entry.error || entry.decoBrand === false || (entry.status >= 400 && !['ssrf-live', 'diagnostics-anonymous'].includes(entry.service)))) process.exitCode = 1;
}
main().catch((error) => { console.error(error.name, error.cause?.code || 'Runtime check failed'); process.exitCode = 1; });
