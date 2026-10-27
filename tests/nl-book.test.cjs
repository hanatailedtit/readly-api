const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test, afterEach } = require('node:test');
const ts = require('typescript');

if (!require.extensions['.ts']) {
  require.extensions['.ts'] = (module, filename) => {
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    });
    module._compile(outputText, filename);
  };
}

process.env.JWT_SECRET_KEY = 'test-secret';
process.env.SUPABASE_POSTGRES_URL = 'postgres://localhost/readly_test';

const bookRouter = require('../api/book.ts').default;

async function request(router, path, options = {}) {
  const method = (options.method || 'GET').toLowerCase();
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; },
  };
  const layer = router.stack.find(({ route }) => route?.path === path && route.methods[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  await layer.route.stack[0].handle({ headers: {}, body: {}, query: {}, ...options }, response);
  return response;
}

const originalFetch = globalThis.fetch;
const originalKey = process.env.NL_ISBN_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.NL_ISBN_API_KEY;
  else process.env.NL_ISBN_API_KEY = originalKey;
});

test('/book/list returns 500 when NL_ISBN_API_KEY is missing', async () => {
  delete process.env.NL_ISBN_API_KEY;
  const res = await request(bookRouter, '/list', { method: 'GET' });
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /NL_ISBN_API_KEY/);
});

test('/book/list maps docs to items on success', async () => {
  process.env.NL_ISBN_API_KEY = 'mock-key';
  let requestedUrl = '';

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        PAGE_NO: '1',
        TOTAL_COUNT: '100',
        docs: [
          {
            TITLE: '테스트 도서',
            AUTHOR: '홍길동',
            PUBLISHER: '출판사',
            PUBLISH_PREDATE: '20240101',
            TITLE_URL: 'https://example.com/cover.jpg',
            EA_ISBN: '9788900000001',
            SERIES_TITLE: '시리즈',
            PRE_PRICE: '15000',
            PAGE: '250',
            FORM: '종이책',
            DEPOSIT_YN: 'Y',
          },
        ],
      }),
    };
  };

  const res = await request(bookRouter, '/list', {
    method: 'GET',
    query: { page_no: '2', page_size: '10' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.page_no, 1);
  assert.equal(res.body.page_size, 10);
  assert.equal(res.body.total_count, 100);
  assert.equal(res.body.items.length, 1);
  assert.deepEqual(res.body.items[0], {
    title: '테스트 도서',
    author: '홍길동',
    publisher: '출판사',
    pubdate: '20240101',
    image: 'https://example.com/cover.jpg',
    isbn: '9788900000001',
    seriesTitle: '시리즈',
    price: '15000',
    page: '250',
    form: '종이책',
    depositYn: 'Y',
  });
  assert.ok(requestedUrl.includes('cert_key=mock-key'));
  assert.ok(requestedUrl.includes('page_no=2'));
  assert.ok(requestedUrl.includes('page_size=10'));
});

test('/book/all and /book/list (POST) also route to National Library handler', async () => {
  process.env.NL_ISBN_API_KEY = 'mock-key';

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      PAGE_NO: '1',
      TOTAL_COUNT: '50',
      docs: [],
    }),
  });

  const getRes = await request(bookRouter, '/all', { method: 'GET' });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.total_count, 50);

  const postRes = await request(bookRouter, '/list', {
    method: 'POST',
    body: { page_no: 1, page_size: 5 },
  });
  assert.equal(postRes.statusCode, 200);
  assert.equal(postRes.body.total_count, 50);
});

test('/book/list handles National Library error response', async () => {
  process.env.NL_ISBN_API_KEY = 'invalid-key';

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      RESULT: 'ERROR',
      ERR_CODE: '011',
      ERR_MESSAGE: '유효하지 않은 인증키 값입니다.',
    }),
  });

  const res = await request(bookRouter, '/list', { method: 'GET' });
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'Invalid National Library response.');
});

test('invalid pagination and filters return 400 without sending requests', async () => {
  process.env.NL_ISBN_API_KEY = 'mock-key';
  globalThis.fetch = async () => { assert.fail('Unexpected provider call'); };
  for (const query of [{ page_no: 0 }, { page_no: 'Infinity' }, { page_size: -1 },
    { page_size: 101 }, { page_size: [] }, { title: {} }, { author: ['a', 'b'] },
    { start_publish_date: '20260231' }, { end_publish_date: 'invalid' },
    { start_publish_date: '20260102', end_publish_date: '20260101' },
    { start_publish_date: ' 20260102 ', end_publish_date: '20260101' }, { deposit_yn: 'invalid' }]) {
    assert.equal((await request(bookRouter, '/list', { query })).statusCode, 400);
  }
});

test('malformed responses and HTTP failures return safe 502 responses', async () => {
  process.env.NL_ISBN_API_KEY = 'mock-key';
  for (const reply of [
    async () => new Response('secret-provider-detail', { status: 500 }),
    async () => Response.json({ unexpected: true }),
    async () => Response.json({ TOTAL_COUNT: 'NaN', docs: [] }),
    async () => Response.json({ TOTAL_COUNT: null, docs: [] }),
    async () => Response.json({ PAGE_NO: -1, TOTAL_COUNT: '0', docs: [] }),
    async () => { throw new DOMException('Timeout', 'TimeoutError'); },
  ]) {
    globalThis.fetch = reply;
    const res = await request(bookRouter, '/list');
    assert.equal(res.statusCode, 502);
    assert.ok(!JSON.stringify(res.body).includes('secret'));
  }
});

test('valid filters are bound to the fixed endpoint and requests have a timeout', async () => {
  process.env.NL_ISBN_API_KEY = 'mock-key';
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://www.nl.go.kr');
    assert.equal(parsed.searchParams.get('title'), 'Book & title');
    assert.equal(parsed.searchParams.get('deposit_yn'), 'Y');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ PAGE_NO: '1', TOTAL_COUNT: '0', docs: [] });
  };
  const res = await request(bookRouter, '/list', { query: { title: 'Book & title', deposit_yn: 'Y', start_publish_date: '20240229' } });
  assert.equal(res.statusCode, 200);
});
