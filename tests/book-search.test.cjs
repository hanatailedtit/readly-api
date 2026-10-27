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
  const method = (options.method || 'POST').toLowerCase();
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
const originalKey = process.env.KAKAO_REST_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.KAKAO_REST_API_KEY;
  else process.env.KAKAO_REST_API_KEY = originalKey;
});

test('/book/search returns 500 when KAKAO_REST_API_KEY is missing', async () => {
  delete process.env.KAKAO_REST_API_KEY;
  const res = await request(bookRouter, '/search', { method: 'POST', body: { query: 'test' } });
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /KAKAO_REST_API_KEY/);
});

test('/book/search calls Kakao and maps documents to items format', async () => {
  process.env.KAKAO_REST_API_KEY = 'mock-kakao-key';
  let requestedUrl = '';
  let requestedAuth = '';

  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestedAuth = options?.headers?.Authorization;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        meta: {
          total_count: 42,
          pageable_count: 42,
          is_end: true,
        },
        documents: [
          {
            title: '테스트 자바스크립트',
            contents: '책 설명 내용',
            url: 'https://search.daum.net/book/1',
            isbn: '1234567890 9781234567897',
            datetime: '2024-05-10T00:00:00.000+09:00',
            authors: ['홍길동', '김철수'],
            publisher: '좋은출판사',
            translators: [],
            price: 20000,
            sale_price: 18000,
            thumbnail: 'https://example.com/thumb.jpg',
            status: '정상판매',
          },
        ],
      }),
    };
  };

  const res = await request(bookRouter, '/search', {
    method: 'POST',
    body: { query: '자바스크립트', display: 10, start: 1, sort: 'sim' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(requestedAuth, 'KakaoAK mock-kakao-key');
  assert.ok(requestedUrl.includes('dapi.kakao.com/v3/search/book'));
  assert.ok(requestedUrl.includes('sort=accuracy'));
  assert.equal(res.body.total, 42);
  assert.equal(res.body.items.length, 1);
  assert.deepEqual(res.body.items[0], {
    title: '테스트 자바스크립트',
    link: 'https://search.daum.net/book/1',
    image: 'https://example.com/thumb.jpg',
    author: '홍길동, 김철수',
    discount: '18000',
    publisher: '좋은출판사',
    pubdate: '20240510',
    isbn: '9781234567897',
    description: '책 설명 내용',
    price: '20000',
  });
});

test('/book/search handles GET requests and pagination translation', async () => {
  process.env.KAKAO_REST_API_KEY = 'mock-kakao-key';
  let requestedUrl = '';

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        meta: { total_count: 100, pageable_count: 50, is_end: false },
        documents: [],
      }),
    };
  };

  const res = await request(bookRouter, '/search', {
    method: 'GET',
    query: { query: '스프링', start: '21', display: '10', sort: 'date' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.start, 21);
  assert.ok(requestedUrl.includes('page=1'));
  assert.ok(requestedUrl.includes('size=50'));
  assert.ok(requestedUrl.includes('sort=latest'));
});

const document = index => ({
  title: `Book ${index}`, isbn: String(9780000000000 + index),
  datetime: '2026-01-01T00:00:00+09:00', authors: [], sale_price: 0, price: 1000,
});

test('100-book and arbitrary-offset requests return the exact requested rows', async () => {
  process.env.KAKAO_REST_API_KEY = 'mock-key';
  const pages = [];
  globalThis.fetch = async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    const page = Number(new URL(url).searchParams.get('page'));
    pages.push(page);
    return Response.json({ meta: { total_count: 500, pageable_count: page * 50, is_end: false },
      documents: Array.from({ length: 50 }, (_, i) => document((page - 1) * 50 + i)) });
  };
  const res = await request(bookRouter, '/search', { body: { query: 'Book', start: 45, display: 100 } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(pages, [1, 2, 3]);
  assert.equal(res.body.display, 100);
  assert.equal(res.body.start, 45);
  assert.deepEqual(res.body.items.map(book => book.title), Array.from({ length: 100 }, (_, i) => `Book ${44 + i}`));
  assert.equal(res.body.items[0].discount, '0');
});

test('repeated final provider pages neither duplicate books nor end a partial page early', async () => {
  process.env.KAKAO_REST_API_KEY = 'mock-key';
  globalThis.fetch = async () => Response.json({ meta: { total_count: 100, pageable_count: 35, is_end: true },
    documents: Array.from({ length: 35 }, (_, i) => document(i)) });
  const full = await request(bookRouter, '/search', { body: { query: 'Book', display: 100 } });
  assert.equal(full.body.display, 35);
  assert.equal(full.body.meta.is_end, true);
  const partial = await request(bookRouter, '/search', { body: { query: 'Book', display: 10 } });
  assert.equal(partial.body.meta.is_end, false);
  const beyond = await request(bookRouter, '/search', { body: { query: 'Book', start: 51 } });
  assert.deepEqual(beyond.body.items, []);
});

test('explicit page and size retain page-based semantics and target filters', async () => {
  process.env.KAKAO_REST_API_KEY = 'mock-key';
  globalThis.fetch = async url => {
    assert.equal(new URL(url).searchParams.get('target'), 'isbn');
    return Response.json({ meta: { total_count: 100, pageable_count: 50, is_end: false },
      documents: Array.from({ length: 50 }, (_, i) => document(i)) });
  };
  const res = await request(bookRouter, '/search', { method: 'GET', query: { query: 'Book', page: '3', size: '10', target: 'isbn' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.start, 21);
  assert.equal(res.body.items[0].title, 'Book 20');
  assert.equal(res.body.items.length, 10);
});

test('invalid search parameters never reach the provider', async () => {
  process.env.KAKAO_REST_API_KEY = 'mock-key';
  globalThis.fetch = async () => { assert.fail('Unexpected provider call'); };
  for (const body of [{ query: '' }, { query: [] }, { query: 'Book', display: 0 },
    { query: 'Book', display: 101 }, { query: 'Book', start: -1 }, { query: 'Book', start: 1.5 },
    { query: 'Book', page: 'Infinity' }, { query: 'Book', display: [] },
    { query: 'Book', target: 'invalid' }, { query: 'Book', sort: 'invalid' }]) {
    assert.equal((await request(bookRouter, '/search', { body })).statusCode, 400);
  }
});

test('provider failures, invalid responses and timeouts produce safe 502 responses', async () => {
  process.env.KAKAO_REST_API_KEY = 'mock-key';
  for (const reply of [
    async () => new Response('secret-provider-detail', { status: 401 }),
    async () => new Response('invalid json'),
    async () => Response.json({ documents: [] }),
    async () => { throw new Error('https://provider.example/?token=secret'); },
    async () => { throw new DOMException('Timed out', 'TimeoutError'); },
  ]) {
    globalThis.fetch = reply;
    const res = await request(bookRouter, '/search', { body: { query: 'Book' } });
    assert.equal(res.statusCode, 502);
    assert.ok(!JSON.stringify(res.body).includes('secret'));
  }
});
