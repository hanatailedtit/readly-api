const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
};
process.env.CLIENT_URL = 'https://readly.createdoodle.dev';
const app = require('../api/index.ts');
const cors = app._router.stack.find(layer => layer.name === 'corsMiddleware').handle;

function preflight(origin) {
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    end() {},
  };
  cors({ method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST',
    'access-control-request-headers': 'authorization,content-type' } }, response, error => { if (error) throw error; });
  return response;
}

test('configured clients and local development receive credentialed CORS headers', () => {
  for (const origin of [process.env.CLIENT_URL, 'https://readly-steel.vercel.app', 'http://localhost:3000']) {
    const response = preflight(origin);
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers['access-control-allow-origin'], origin);
    assert.equal(response.headers['access-control-allow-credentials'], 'true');
    assert.match(response.headers['access-control-allow-headers'], /Authorization/);
  }
});

test('untrusted origins including other createdoodle subdomains are not allowed', () => {
  for (const origin of ['https://evil.example', 'https://untrusted.createdoodle.dev', 'null', 'https://readly.createdoodle.dev.evil.example']) {
    assert.equal(preflight(origin).headers['access-control-allow-origin'], undefined);
  }
});
