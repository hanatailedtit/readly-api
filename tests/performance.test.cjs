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
    assert.equal(response.body.message, rowCount ? 'regist user' : 'login success');
    assert.equal(typeof response.body.accessToken, 'string');
  }
});
