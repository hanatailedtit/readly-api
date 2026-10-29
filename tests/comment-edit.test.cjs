const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test, beforeEach } = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
};

process.env.JWT_SECRET_KEY = 'comment-edit-test-secret';
process.env.SUPABASE_POSTGRES_URL = 'postgres://localhost/readly_test';
const router = require('../api/comment.ts').default;
const { generateJwtToken } = require('../utils/auth.ts');
let comments;
let statements;
let databaseError;

beforeEach(() => {
  comments = [
    { id: 1, comment: 'Original comment', user_id: 'reader', summary_id: 10, comment_id: null, created_at: '2026-10-29' },
    { id: 2, comment: 'Original reply', user_id: 'reader', summary_id: 10, comment_id: 1, created_at: '2026-10-29' },
    { id: 3, comment: 'Another reader', user_id: 'other', summary_id: 10, comment_id: null, created_at: '2026-10-29' },
  ];
  statements = [];
  databaseError = false;
  globalThis.__readlyPgPoolUrl = process.env.SUPABASE_POSTGRES_URL;
  globalThis.__readlyPgPool = {
    async query(text, values) {
      statements.push({ text, values });
      if (databaseError) throw new Error('private-database-detail');
      assert.match(text, /UPDATE summary_comment\s+SET comment = \$1\s+WHERE id = \$2 AND user_id = \$3;/);
      const comment = comments.find(item => item.id === values[1] && item.user_id === values[2]);
      if (comment) comment.comment = values[0];
      return { rowCount: comment ? 1 : 0 };
    },
  };
});

async function request(options = {}) {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; },
  };
  const route = router.stack.find(({ route }) => route?.path === '/edit' && route.methods.put).route;
  await route.stack[0].handle({
    headers: { authorization: `Bearer ${generateJwtToken({ id: 'reader' })}` },
    body: { id: 1, comment: 'Updated comment' },
    ...options,
  }, response);
  return response;
}

test('authors can edit comments and replies without changing identity, hierarchy or creation date', async () => {
  const original = structuredClone(comments);
  for (const id of [1, 2]) {
    const response = await request({ body: { id, comment: '  수정한 내용\n둘째 줄  ', user_id: 'other', comment_id: null } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'Success edited.');
    assert.deepEqual(comments[id - 1], { ...original[id - 1], comment: '수정한 내용\n둘째 줄' });
  }
  assert.deepEqual(comments[2], original[2]);
});

test('missing, invalid and expired authentication cannot reach the database', async () => {
  const jwt = require('jsonwebtoken');
  const expired = jwt.sign({ id: 'reader' }, process.env.JWT_SECRET_KEY, { expiresIn: -1 });
  for (const headers of [{}, { authorization: 'Bearer invalid' }, { authorization: `Bearer ${expired}` }]) {
    assert.equal((await request({ headers })).statusCode, 401);
  }
  assert.equal(statements.length, 0);
});

test('invalid IDs and blank or non-string content cannot reach the database', async () => {
  for (const id of [undefined, null, '1', [], {}, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await request({ body: { id, comment: 'Edit' } })).statusCode, 400);
  }
  for (const comment of [undefined, null, '', ' \n\t ', [], {}, 123]) {
    assert.equal((await request({ body: { id: 1, comment } })).statusCode, 400);
  }
  assert.equal(statements.length, 0);
});

test('another author and missing IDs cannot modify existing comments', async () => {
  const original = structuredClone(comments);
  for (const id of [3, 999]) {
    assert.equal((await request({ body: { id, comment: 'Unauthorized', user_id: 'other', is_my: true } })).statusCode, 404);
  }
  assert.deepEqual(comments, original);
});

test('SQL-like content is passed as a value and database errors return a safe failure', async () => {
  const content = "'; DELETE FROM summary_comment; --";
  assert.equal((await request({ body: { id: 1, comment: content } })).statusCode, 200);
  assert.equal(statements[0].values[0], content);
  assert.ok(!statements[0].text.includes(content));
  const original = structuredClone(comments);
  databaseError = true;
  const response = await request();
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: 'Failed to edit comment.' });
  assert.deepEqual(comments, original);
});
