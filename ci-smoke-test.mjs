const rawBase = process.argv[2];

if (!rawBase) {
  console.error('Usage: node scripts/ci-smoke-test.mjs http://127.0.0.1:3000');
  process.exit(2);
}

const base = rawBase.replace(/\/+$/, '');
const checks = [
  { path: '/api/health', type: 'json' },
  { path: '/', type: 'html' },
  { path: '/cart', type: 'html' },
  { path: '/favicon.ico', type: 'asset' },
  { path: '/images/logo.png', type: 'asset' },
  { path: '/images/home/crafter-beach.jpg', type: 'asset' },
];

let failed = false;

for (const check of checks) {
  const url = `${base}${check.path}`;

  try {
    const response = await fetch(url, { redirect: 'follow' });
    const contentType = response.headers.get('content-type') || '';
    const body = await response.arrayBuffer();

    if (!response.ok) {
      failed = true;
      console.error(`FAIL ${check.path}: HTTP ${response.status}`);
      continue;
    }

    if (body.byteLength === 0) {
      failed = true;
      console.error(`FAIL ${check.path}: empty response`);
      continue;
    }

    if (check.type === 'json' && !contentType.includes('application/json')) {
      failed = true;
      console.error(`FAIL ${check.path}: expected JSON, got ${contentType}`);
      continue;
    }

    console.log(`PASS ${check.path}: ${response.status} ${contentType} ${body.byteLength} bytes`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${check.path}:`, error);
  }
}

process.exit(failed ? 1 : 0);
