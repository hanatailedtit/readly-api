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
  process.env.KAKAO_REST_API_KEY = originalKey;
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
  assert.ok(requestedUrl.includes('page=3'));
  assert.ok(requestedUrl.includes('size=10'));
  assert.ok(requestedUrl.includes('sort=latest'));
});
