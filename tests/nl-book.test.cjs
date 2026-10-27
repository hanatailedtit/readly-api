const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test, beforeEach, afterEach } = require('node:test');
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
  process.env.NL_ISBN_API_KEY = originalKey;
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
            PRICE: '15000',
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
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ERR_CODE, '011');
});
