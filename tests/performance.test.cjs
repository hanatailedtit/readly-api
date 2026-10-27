const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test, beforeEach } = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  module._compile(outputText, filename);
};

process.env.JWT_SECRET_KEY = 'performance-test-secret';
process.env.SUPABASE_POSTGRES_URL = 'postgres://localhost/readly_test';
globalThis.__readlyPgPoolUrl = process.env.SUPABASE_POSTGRES_URL;
let calls;
let result;
globalThis.__readlyPgPool = {
  async query(text, values) {
    calls.push({ text, values });
    return result;
  },
};

const bookRouter = require('../api/book.ts').default;
const commentRouter = require('../api/comment.ts').default;
const authRouter = require('../api/auth.ts').default;
const { generateJwtToken } = require('../utils/auth.ts');
const { getSummaryPagination } = require('../utils/book.ts');

beforeEach(() => {
  calls = [];
  result = { rows: [], rowCount: 1 };
});

async function request(router, path, options = {}) {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; },
  };
  const layer = router.stack.find(({ route }) => route?.path === path);
  await layer.route.stack[0].handle({ headers: {}, body: {}, query: {}, ...options }, response);
  return response;
}

const headers = { authorization: `Bearer ${generateJwtToken({ id: 'test-user' })}` };

test('pagination accepts integers, caps page size and rejects malformed values', () => {
  assert.deepEqual(getSummaryPagination('16', '32'), { limitNum: 16, offsetNum: 32 });
  assert.deepEqual(getSummaryPagination(1000, 0), { limitNum: 100, offsetNum: 0 });
  for (const value of ['Infinity', 'NaN', '1.5', -1, [], {}, null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(getSummaryPagination(value, 0), null);
    assert.equal(getSummaryPagination(16, value), null);
  }
  assert.equal(getSummaryPagination(0, 0), null);
});

for (const path of ['/summary/list', '/summary/search']) {
  test(`${path} bounds SQL work and preserves pagination responses`, async () => {
    result.rows = [{ id: 1, total_count: 250, contents: 'summary' }];
    const response = await request(bookRouter, path, { query: { limit: '1000', offset: '100' } });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].values.slice(-2), [100, 100]);
    assert.deepEqual(response.body, {
      total: 250, list: [{ id: 1, contents: 'summary' }], nextOffset: 2,
    });
  });

  test(`${path} rejects invalid pagination before querying the DB`, async () => {
    for (const query of [{ limit: 'Infinity' }, { offset: '0.5' }, { limit: ['10'] }]) {
      const response = await request(bookRouter, path, { query });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(calls.length, 0);
  });

  test(`${path} keeps totals when the requested page is empty`, async () => {
    result.rows = [{ id: null, total_count: 3 }];
    const response = await request(bookRouter, path, { query: { offset: '16' } });
    assert.deepEqual(calls[0].values.slice(-2), [16, 16]);
    assert.deepEqual(response.body, { total: 3, list: [], nextOffset: null });
  });
}

test('filtered like ranking limits aggregation to matching summaries and binds filters', async () => {
  const userId = "user' OR TRUE --";
  await request(bookRouter, '/summary/list', {
    query: { order: 'like', category_id: '2', user_id: userId },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [2, userId, 16, 0]);
  assert.match(calls[0].text, /FROM summary_like_count\s+WHERE summary_id IN \(SELECT s.id FROM summaries s WHERE s.category_id = \$1::INTEGER AND s.user_id = \$2::TEXT\)/);
  assert.ok(!calls[0].text.includes(userId));
});

test('unfiltered like ranking keeps the direct aggregate', async () => {
  await request(bookRouter, '/summary/list', { query: { order: 'like' } });
  assert.match(calls[0].text, /FROM summary_like_count\s+GROUP BY summary_id/);
});

for (const [router, path, body, success] of [
  [bookRouter, '/summary/create', { content: 'summary', bookInfo: { title: 'Book' } }, 'success created'],
  [commentRouter, '/create', { comment: 'comment', summary_id: 1 }, 'Success create comment.'],
]) {
  test(`${path} writes with a single query and checks the user still exists`, async () => {
    const response = await request(router, path, { headers, body });
    assert.equal(response.body, success);
    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /INSERT INTO[\s\S]+SELECT[\s\S]+FROM users\s+WHERE id = \$\d+/);
    assert.equal(calls[0].values.at(-1), 'test-user');

    calls = [];
    result.rowCount = 0;
    const missingUser = await request(router, path, { headers, body });
    assert.equal(missingUser.statusCode, 401);
    assert.equal(missingUser.body, 'There is no user information.');
    assert.equal(calls.length, 1);
  });

  test(`${path} rejects unauthenticated writes without querying the DB`, async () => {
    const response = await request(router, path, { body });
    assert.equal(response.statusCode, 401);
    assert.equal(calls.length, 0);
  });
}

test('Google login uses one insert for both new and existing users', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => ({
    ok: true,
    json: async () => url.includes('/token')
      ? { access_token: 'google-token' }
      : { id: 'google-user', email: 'test@example.com', name: 'Tester' },
  }));
  for (const rowCount of [1, 0]) {
    calls = [];
    result.rowCount = rowCount;
    const response = await request(authRouter, '/login/google', { body: { code: 'code' } });
    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /ON CONFLICT \(id\) DO NOTHING/);
    assert.deepEqual(calls[0].values, ['google-user', 'test@example.com', 'Tester']);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.message, rowCount ? 'regist user' : 'login success');
    assert.equal(typeof response.body.accessToken, 'string');
  }
});

test('Google login rejects invalid codes before contacting Google or the DB', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const body of [undefined, {}, { code: '' }, { code: ' ' }, { code: 123 }, { code: ['code'] }]) {
    const response = await request(authRouter, '/login/google', { body });
    assert.equal(response.statusCode, 400);
    assert.ok(response.body.error);
  }
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(calls.length, 0);
});

for (const [stage, ok, data, status] of [
  ['token', false, { error: 'invalid_grant', access_token: 'must-not-be-used' }, 401],
  ['token', true, { error: 'invalid_client' }, 401],
  ['token', true, null, 401],
  ['token', true, { access_token: ' ' }, 401],
  ['token', true, { access_token: 123 }, 401],
  ['userinfo', false, { error: 'invalid_token', id: 'must-not-be-used' }, 502],
  ['userinfo', true, { error: 'invalid_token' }, 502],
  ['userinfo', true, null, 502],
  ['userinfo', true, { id: ' ' }, 502],
  ['userinfo', true, { id: 123 }, 502],
]) {
  test(`Google login rejects ${stage} response ${JSON.stringify(data)} (HTTP ok=${ok})`, async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async (url) => ({
      ok: url.includes('/token') && stage === 'userinfo' ? true : ok,
      json: async () => url.includes('/token') && stage === 'userinfo'
        ? { access_token: 'google-token' } : data,
    }));
    const response = await request(authRouter, '/login/google', { body: { code: 'code' } });
    assert.equal(response.statusCode, status);
    assert.ok(response.body.error);
    assert.equal(response.body.accessToken, undefined);
    assert.equal(calls.length, 0);
    assert.equal(fetch.mock.callCount(), stage === 'token' ? 1 : 2);
  });
}

for (const stage of ['token', 'userinfo']) {
  for (const failure of ['network', 'json', 'timeout']) {
    test(`Google login responds when ${stage} fails during ${failure}`, async (t) => {
      t.mock.method(console, 'error', () => {});
      if (failure === 'timeout') {
        let count = 0;
        t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
          assert.equal(milliseconds, 3000);
          count++;
          return stage === 'token' || count === 2
            ? AbortSignal.abort(new DOMException('upstream timed out', 'TimeoutError'))
            : new AbortController().signal;
        });
      }
      t.mock.method(globalThis, 'fetch', async (url, options) => {
        if (url.includes('/token') && stage === 'userinfo') {
          return { ok: true, json: async () => ({ access_token: 'google-token' }) };
        }
        if (failure === 'timeout') options.signal.throwIfAborted();
        if (failure === 'network') throw new Error('private upstream details');
        return { ok: true, json: async () => { throw new SyntaxError('private upstream details'); } };
      });
      const response = await request(authRouter, '/login/google', { body: { code: 'code' } });
      assert.equal(response.statusCode, 500);
      assert.deepEqual(response.body, { error: 'Google login failed.' });
      assert.equal(calls.length, 0);
    });
  }
}

test('Google login responds to DB failures without returning a JWT or database details', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url) => ({
    ok: true,
    json: async () => url.includes('/token')
      ? { access_token: 'google-token' }
      : { id: 'google-user', email: 'test@example.com', name: 'Tester' },
  }));
  const query = t.mock.method(globalThis.__readlyPgPool, 'query', async () => {
    throw new Error('private database details');
  });
  const response = await request(authRouter, '/login/google', { body: { code: 'code' } });
  assert.equal(query.mock.callCount(), 1);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: 'Google login failed.' });
});
