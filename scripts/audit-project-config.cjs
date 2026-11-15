// Records configuration names and checks only; never records credentials or values.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('../micro-ts-osint/node_modules/dotenv');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const projects = ['micro-ts-osint', 'osint-social-scraper', 'dashboard-osint', 'face-biometric-service', 'visual-context-service'];
const read = filename => fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
const environments = Object.fromEntries(projects.map(project => [project, {
  ...dotenv.parse(read(path.join(root, project, '.env'))),
  ...dotenv.parse(read(path.join(root, project, '.env.local'))),
}]));
const report = { generatedAt: new Date().toISOString(), projects: [], connections: [], checks: [], trackedSecretMatches: [], sourceInventory: {} };
const omitted = new Set(['.git','.venv','node_modules','.next','dist','uploads','__pycache__','.yarn']);
function sourceFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const filename = path.join(directory,entry.name);
    if (entry.isDirectory()) { if (!omitted.has(entry.name)) result.push(...sourceFiles(filename)); }
    else if (/\.(?:ts|tsx|js|cjs|py)$/.test(entry.name)) result.push(filename);
  }
  return result;
}
function check(project, variable, valid, detail) { report.checks.push({ project, variable, valid, detail }); }
for (const project of projects) {
  const env = environments[project];
  const template = dotenv.parse(read(path.join(root, project, '.env.example')));
  const files = sourceFiles(path.join(root,project));
  const source = files.map(filename => read(filename)).join('\n');
  const usedVariables = new Set([...source.matchAll(/(?:os\.getenv\(\s*['"]|process\.env\.|\.get(?:<[^>]*>)?\(\s*['"])([A-Z][A-Z0-9_]*)/g)].map(match => match[1]));
  report.sourceInventory[project] = { files: files.length, referencedVariables: [...usedVariables].sort() };
  const inventory = Object.keys(env).sort().map(variable => ({ variable, configured: Boolean(env[variable]), documented: Object.hasOwn(template, variable) }));
  report.projects.push({ project, variables: inventory, withoutLiteralReference: Object.keys(env).filter(variable => !usedVariables.has(variable)) });
  if (fs.existsSync(path.join(root, project, '.git'))) {
    const tracked = execFileSync('git',['ls-files','-z'],{ cwd:path.join(root,project),encoding:'utf8' }).split('\0').filter(Boolean);
    const sensitive = Object.entries(env).filter(([variable,value]) => /(?:KEY|KEYS|SECRET|PASSWORD|TOKEN)$/.test(variable) && value.length >= 16 && !/^(?:change[-_ ]?me|replace[-_ ]?with|your[-_ ]|example)/i.test(value));
    for (const filename of tracked) {
      const absolute = path.join(root,project,filename);
      if (!fs.existsSync(absolute) || fs.statSync(absolute).size > 2_000_000 || !/\.(?:md|ts|tsx|js|cjs|json|yml|yaml|py|example|env)$/.test(filename)) continue;
      const text = read(absolute);
      for (const [variable,secret] of sensitive) {
        const candidates = variable.endsWith('_KEYS') ? secret.split(',').filter(value => value.length >= 16) : [secret];
        if (candidates.some(value => text.includes(value))) report.trackedSecretMatches.push({ project, file: filename, variable });
      }
    }
  }
  for (const [variable, value] of Object.entries(env)) {
    if (/(?:KEY|SECRET|PASSWORD|TOKEN)$/.test(variable) && value) {
      check(project, variable, !/^(?:change[-_ ]?me|replace[-_ ]?with|your[-_ ]|example)/i.test(value), 'No placeholder credentials');
      if (['JWT_SECRET', 'MICROSERVICES_API_KEY', 'FACE_BIOMETRIC_API_KEY', 'VISUAL_CONTEXT_API_KEY', 'SOCIAL_SCRAPER_API_KEY', 'UPLOAD_SIGNING_SECRET'].includes(variable)) check(project, variable, value.length >= 32, 'At least 32 characters for internal signing/access');
    }
    if (/(?:BASE_URL|PUBLIC_URL|API_BASE)$/.test(variable) && value) {
      try { const url = new URL(value); check(project, variable, ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'HTTP(S) URL without embedded credentials'); }
      catch { check(project, variable, false, 'Invalid service URL'); }
    }
  }
}
const core = environments['micro-ts-osint'];
for (const [project, variable] of [['face-biometric-service','FACE_BIOMETRIC_API_KEY'],['visual-context-service','VISUAL_CONTEXT_API_KEY'],['osint-social-scraper','SOCIAL_SCRAPER_API_KEY']]) {
  report.connections.push({ source: 'micro-ts-osint', target: project, variable, configured: Boolean(core[variable] && environments[project][variable]), matches: Boolean(core[variable]) && core[variable] === environments[project][variable] });
}
const ranges = {
  'face-biometric-service': { FACE_MAX_IMAGE_MB: [1,25,10], FACE_DETECTION_SCORE_THRESHOLD: [0,1,.7], FACE_NMS_THRESHOLD:[0,1,.3], FACE_TOP_K:[1,100,20], FACE_COSINE_CANDIDATE_THRESHOLD:[-1,1,.3], FACE_COSINE_PROBABLE_THRESHOLD:[-1,1,.4] },
  'visual-context-service': { VISUAL_CONTEXT_MAX_IMAGE_MB:[1,30,15], VISUAL_CONTEXT_CONFIDENCE:[0,1,.25], VISUAL_CONTEXT_IOU:[0,1,.45], VISUAL_CONTEXT_MAX_DETECTIONS:[1,300,80] },
};
for (const [project, variables] of Object.entries(ranges)) {
  const env = environments[project];
  for (const [variable, [min,max,fallback]] of Object.entries(variables)) {
    const number = Number(env[variable] ?? fallback);
    check(project, variable, Number.isFinite(number) && number >= min && number <= max, 'Finite numeric value within supported range');
  }
  check(project, 'ENVIRONMENT', ['dev','development','local','test','staging','production'].includes(env.ENVIRONMENT || env.NODE_ENV || 'development'), 'Known runtime environment');
  if (project === 'face-biometric-service') {
    check(project, 'FACE_COSINE_THRESHOLDS', Number(env.FACE_COSINE_CANDIDATE_THRESHOLD ?? .3) <= Number(env.FACE_COSINE_PROBABLE_THRESHOLD ?? .4), 'Candidate threshold does not exceed probable threshold');
    for (const [variable, filename] of [['FACE_DETECTOR_MODEL','face_detection_yunet_2023mar.onnx'],['FACE_RECOGNIZER_MODEL','face_recognition_sface_2021dec.onnx']]) check(project, variable, fs.existsSync(path.resolve(root, project, env[variable] || `models/${filename}`)), 'Model file exists');
  } else {
    check(project, 'VISUAL_CONTEXT_ENABLE_YOLO', ['true','false'].includes((env.VISUAL_CONTEXT_ENABLE_YOLO || 'true').toLowerCase()), 'Explicit boolean');
    check(project, 'VISUAL_CONTEXT_MODEL', fs.existsSync(path.resolve(root, project, env.VISUAL_CONTEXT_MODEL || 'yolov8n.pt')), 'Model exists locally');
  }
}
check('micro-ts-osint', 'RECOVERY_EMAIL', Boolean(core.AUTH_EMAIL_FROM && (core.SMTP_HOST || core.RESEND_API_KEY)), 'Recovery delivery requires sender and mail provider');
fs.mkdirSync(path.join(root, '.audit'), { recursive: true });
fs.writeFileSync(path.join(root, '.audit/deco-config-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ projects: report.projects.map(project => ({ project: project.project, variableCount: project.variables.length, undocumented: project.variables.filter(variable => !variable.documented).map(variable => variable.variable), withoutLiteralReference: project.withoutLiteralReference })), sourceInventory: Object.fromEntries(Object.entries(report.sourceInventory).map(([project,inventory]) => [project,{ files:inventory.files,referencedVariables:inventory.referencedVariables.length }])), trackedSecretMatches: report.trackedSecretMatches, connections: report.connections, failures: report.checks.filter(check => !check.valid), checks: report.checks.length }, null, 2));
