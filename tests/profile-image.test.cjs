const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test, beforeEach } = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
};

process.env.JWT_SECRET_KEY = 'profile-test-secret';
process.env.SUPABASE_POSTGRES_URL = 'postgres://localhost/readly_test';
const blob = require('@vercel/blob');
const realPut = blob.put;
const router = require('../api/user.ts').default;
const { generateJwtToken } = require('../utils/auth.ts');
const oldUrl = 'https://test.public.blob.vercel-storage.com/old.png';
const newUrl = 'https://test.public.blob.vercel-storage.com/new.png';
const image = { name: 'profile.png', mimetype: 'image/png', size: 8, data: Buffer.alloc(8) };
let events;
let rows;
let updateCount;
let databaseError;

beforeEach((t) => {
  events = [];
  rows = [{ profile_image: oldUrl }];
  updateCount = 1;
  databaseError = false;
  globalThis.__readlyPgPoolUrl = process.env.SUPABASE_POSTGRES_URL;
  globalThis.__readlyPgPool = {
    async query(text, values) {
      if (text.includes('SELECT')) {
        events.push('read');
        assert.deepEqual(values, ['profile-user']);
        return { rows };
      }
      events.push('update');
      assert.deepEqual(values, [newUrl, 'profile-user']);
      if (databaseError) throw new Error('Database unavailable');
      return { rowCount: updateCount };
    },
  };
  t.mock.method(blob, 'put', async (path, data, options) => {
    events.push('upload');
    assert.equal(path, 'readly/user/profile-image/profile.png');
    assert.equal(data, image.data);
    assert.equal(options.contentType, 'image/png');
    assert.equal(options.addRandomSuffix, true);
    assert.ok(options.abortSignal instanceof AbortSignal);
    return { url: newUrl };
  });
  t.mock.method(blob, 'del', async (url) => {
    events.push('delete');
    assert.equal(url, oldUrl);
  });
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
});

async function request(options = {}) {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; },
  };
  const route = router.stack.find(({ route }) => route?.path === '/edit/profile-image').route;
  await route.stack[0].handle({
    headers: { authorization: `Bearer ${generateJwtToken({ id: 'profile-user' })}` },
    files: { image }, ...options,
  }, response);
  return response;
}

test('old image is deleted only after the replacement is uploaded and saved', async () => {
  const response = await request();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'Success edited.');
  assert.deepEqual(events, ['read', 'upload', 'update', 'delete']);
});

test('missing or invalid authentication cannot query or change profile images', async () => {
  for (const headers of [{}, { authorization: 'Bearer invalid' }]) {
    assert.equal((await request({ headers })).statusCode, 401);
  }
  assert.deepEqual(events, []);
});

test('missing or invalid files are rejected without deleting the existing image', async () => {
  for (const files of [undefined, {}, { image: [] },
    { image: { ...image, mimetype: 'text/html' } },
    { image: { ...image, size: 0 } },
    { image: { ...image, size: 6 * 1024 * 1024 } },
    { image: { ...image, truncated: true } },
  ]) {
    assert.equal((await request({ files })).statusCode, 400);
  }
  assert.deepEqual(events, []);
});

test('a missing user cannot upload a file', async () => {
  rows = [];
  assert.equal((await request()).statusCode, 401);
  assert.deepEqual(events, ['read']);
});

test('upload failure leaves the current URL and old image untouched', async (t) => {
  t.mock.method(blob, 'put', async () => { events.push('upload'); throw new Error('Blob credentials missing'); });
  const response = await request();
  assert.equal(response.statusCode, 500);
  assert.deepEqual(events, ['read', 'upload']);
  assert.equal(response.body.error, 'Failed to save profile image.');
});

test('a failed DB update does not delete either potentially referenced image', async () => {
  databaseError = true;
  assert.equal((await request()).statusCode, 500);
  assert.deepEqual(events, ['read', 'upload', 'update']);
});

test('zero updated rows do not report a successful save or delete the old image', async () => {
  updateCount = 0;
  assert.equal((await request()).statusCode, 500);
  assert.deepEqual(events, ['read', 'upload', 'update']);
});

test('cleanup failure does not cancel an already saved image', async (t) => {
  t.mock.method(blob, 'del', async () => { events.push('delete'); throw new Error('Permission denied'); });
  assert.equal((await request()).statusCode, 200);
  assert.deepEqual(events, ['read', 'upload', 'update', 'delete']);
});

test('images from another store or provider do not block saving to the new store', async () => {
  for (const profile_image of ['', 'https://other.public.blob.vercel-storage.com/old.png', 'https://example.com/avatar.png', 'invalid-url']) {
    rows = [{ profile_image }];
    events = [];
    assert.equal((await request()).statusCode, 200);
    assert.deepEqual(events, ['read', 'upload', 'update']);
  }
});

test('the installed Blob SDK authenticates using OIDC without a read-write token', async (t) => {
  const names = ['VERCEL_OIDC_TOKEN', 'BLOB_STORE_ID', 'BLOB_READ_WRITE_TOKEN'];
  const previous = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, index) => {
    if (previous[index] === undefined) delete process.env[name];
    else process.env[name] = previous[index];
  }));
  const oidcToken = generateJwtToken({ id: 'oidc-test' });
  process.env.VERCEL_OIDC_TOKEN = oidcToken;
  process.env.BLOB_STORE_ID = 'store_test';
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const undici = require('undici');
  const fetchMock = t.mock.method(undici, 'fetch', async (url, options) => {
    assert.equal(options.headers.authorization, `Bearer ${oidcToken}`);
    assert.equal(options.headers['x-vercel-blob-store-id'], 'test');
    return new Response(JSON.stringify({ url: newUrl, pathname: 'profile.png', contentType: 'image/png' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const result = await realPut('profile.png', image.data, { access: 'public' });
  assert.equal(result.url, newUrl);
  assert.equal(fetchMock.mock.callCount(), 1);
});
