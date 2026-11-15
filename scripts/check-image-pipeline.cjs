const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('../micro-ts-osint/node_modules/dotenv');
const sharp = require('../micro-ts-osint/node_modules/sharp');
const root = path.resolve(__dirname, '..');
const env = name => dotenv.parse(fs.readFileSync(path.join(root, name, '.env.local')));
async function main() {
  const report = [];
  const image = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#808080' } }).png().toBuffer();
  const imageBase64 = image.toString('base64');
  for (const [name, folder, port, endpoint, keyName] of [
    ['face', 'face-biometric-service', 7120, '/v1/faces/extract', 'FACE_BIOMETRIC_API_KEY'],
    ['visual', 'visual-context-service', 7130, '/v1/visual/analyze', 'VISUAL_CONTEXT_API_KEY'],
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': env(folder)[keyName] }, body: JSON.stringify({ imageBase64 }), signal: AbortSignal.timeout(60000) });
    const data = await response.json();
    report.push({ service: name, status: response.status, facesDetected: data.facesDetected, yoloAvailable: data.yoloAvailable, detections: data.detections?.length });
    const unauthorized = await fetch(`http://127.0.0.1:${port}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64 }), signal: AbortSignal.timeout(10000) });
    report.push({ service: `${name}-anonymous`, status: unauthorized.status });
  }
  const headers = { 'Content-Type': 'application/json', 'X-API-Key': env('osint-social-scraper').SOCIAL_SCRAPER_API_KEY };
  const fixtureId = crypto.randomBytes(12).toString('hex');
  let saved = false;
  try {
    const response = await fetch('http://127.0.0.1:7110/api/v1/assets/images/base64', { method: 'POST', headers, body: JSON.stringify({ base64: imageBase64, scope: 'security-smoke', owner: 'local-check', osintSearchId: fixtureId }), signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    saved = response.ok;
    report.push({ service: 'scraper-image-save', status: response.status, mimeType: data.mimeType });
    if (saved && data.publicUrl) {
      const signed = await fetch(data.publicUrl, { signal: AbortSignal.timeout(10000) });
      const unsignedUrl = new URL(data.publicUrl); unsignedUrl.search = '';
      const unsigned = await fetch(unsignedUrl, { signal: AbortSignal.timeout(10000) });
      report.push({ service: 'signed-image', status: signed.status, contentType: signed.headers.get('content-type') });
      report.push({ service: 'unsigned-image', status: unsigned.status });
    }
    const html = await fetch('http://127.0.0.1:7110/api/v1/assets/images/base64', { method: 'POST', headers, body: JSON.stringify({ base64: Buffer.from('<html><script>alert(1)</script></html>').toString('base64'), filename: 'payload.html' }), signal: AbortSignal.timeout(10000) });
    report.push({ service: 'html-upload', status: html.status });
  } finally {
    if (saved) {
      const response = await fetch(`http://127.0.0.1:7110/api/v1/assets/by-search/${fixtureId}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      report.push({ service: 'fixture-cleanup', status: response.status, assetsDeleted: data.assetsDeleted, filesDeleted: data.filesDeleted });
    }
  }
  // Exercise the actual PDF renderer with a synthetic report, without reading a case.
  const { PdfReportGeneratorService } = require('../micro-ts-osint/dist/osint/services/pdf-report-generator.service');
  const renderer = new PdfReportGeneratorService({ generateReport: async () => '# Prueba local\n\nReporte sintético sin datos personales.\n\n<script>fetch("http://127.0.0.1/private")</script>' });
  const pdf = await renderer.generatePdf('local-security-smoke');
  report.push({ service: 'pdf-renderer', validPdf: Buffer.from(pdf).subarray(0, 5).toString() === '%PDF-', bytes: pdf.length });
  fs.writeFileSync(path.join(root, '.audit/image-pipeline-checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  const expected = { 'face-anonymous': 401, 'visual-anonymous': 401, 'unsigned-image': 403, 'html-upload': 400 };
  if (report.some(row => row.status && (expected[row.service] ? row.status !== expected[row.service] : row.status >= 400)) || !report.find(row => row.validPdf)) process.exitCode = 1;
}
main().catch(error => { console.error('Image pipeline verification failed:', error.name, error.cause?.code || 'Check local service configuration'); process.exitCode = 1; });
