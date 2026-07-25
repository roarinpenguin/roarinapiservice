'use strict';

// Regression suite for the security hardening. Uses only the built-in
// node:test runner (no external dependencies). Run with: npm test
//
// Covers: C1 (safe condition evaluator), M1 (constant-time compares),
// M2 (stateless sessions), H1 (setup token), H3/M3 (path traversal),
// M5 (no shipped credential), H2 (rate limiter), A05/M4 (security headers).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Keep any incidental file writes out of the repo's ./data during require.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'roarin-test-root-'));

const { evaluateCondition, constantTimeEquals } = require('../src/routes/dynamic.js');
const auth = require('../src/plugins/auth.js');
const { createRateLimiter } = require('../src/plugins/rateLimit.js');
const { SECURITY_HEADERS, CONTENT_SECURITY_POLICY } = require('../src/plugins/securityHeaders.js');

// configManager is file-backed; give each test that touches it a clean DATA_DIR.
function freshConfigManager() {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'roarin-test-'));
  delete process.env.SETUP_TOKEN;
  delete require.cache[require.resolve('../src/config/configManager.js')];
  return require('../src/config/configManager.js');
}

const req = (query = {}, headers = {}, body = {}, method = 'GET') => ({ query, headers, body, method });

// ---------- C1: safe condition evaluator ----------

test('C1: legit conditions evaluate correctly', () => {
  assert.equal(evaluateCondition('query.role == "admin"', {}, req({ role: 'admin' })), true);
  assert.equal(evaluateCondition('query.role == "admin"', {}, req({ role: 'user' })), false);
  assert.equal(evaluateCondition('query.level > 5', {}, req({ level: '9' })), true);
  assert.equal(evaluateCondition('query.level > 5', {}, req({ level: '2' })), false);
  assert.equal(evaluateCondition('query.a == "x" && query.b == "y"', {}, req({ a: 'x', b: 'y' })), true);
  assert.equal(evaluateCondition('query.a == "x" || query.b == "y"', {}, req({ b: 'y' })), true);
  assert.equal(evaluateCondition('headers.x-flag == "on"', {}, req({}, { 'x-flag': 'on' })), true);
  assert.equal(evaluateCondition('!(query.n == "1")', {}, req({ n: '2' })), true);
});

test('C1: injection payloads are inert (no code execution)', () => {
  const payloads = [
    '".constructor.constructor("return 1")()||"',
    '"||global.process.exit(1)||"',
    'x");require("child_process").execSync("id");("',
    '1==1);process.exit(1);('
  ];
  for (const p of payloads) {
    assert.equal(evaluateCondition('query.foo == "safe"', {}, req({ foo: p })), false);
  }
});

// ---------- M1: constant-time compare ----------

test('M1: constantTimeEquals', () => {
  assert.equal(constantTimeEquals('secret', 'secret'), true);
  assert.equal(constantTimeEquals('secret', 'sekret'), false);
  assert.equal(constantTimeEquals('short', 'longer'), false);
  assert.equal(constantTimeEquals('x', null), false);
  assert.equal(constantTimeEquals(undefined, 'x'), false);
});

// ---------- M2: stateless sessions + password ----------

test('M2: stateless session tokens verify, reject tampering, and revoke', () => {
  const secret = 'test-secret';
  const tok = auth.createSessionToken(secret);
  assert.equal(auth.verifySessionToken(tok, secret, 0), true);
  assert.equal(auth.verifySessionToken(tok, 'other-secret', 0), false);
  assert.equal(auth.verifySessionToken(tok.slice(0, -2) + 'zz', secret, 0), false);
  assert.equal(auth.verifySessionToken('garbage', secret, 0), false);
  // global revoke: invalidBefore in the future rejects an already-issued token
  assert.equal(auth.verifySessionToken(tok, secret, Date.now() + 10000), false);
});

test('M1/M2: timing-safe password verify', () => {
  const { combined } = auth.hashPassword('correct horse battery');
  assert.equal(auth.verifyPassword('correct horse battery', combined), true);
  assert.equal(auth.verifyPassword('wrong', combined), false);
  assert.equal(auth.verifyPassword('x', 'malformed-hash'), false);
});

// ---------- H1: setup token ----------

test('H1: generated setup token lifecycle', () => {
  const cm = freshConfigManager();
  const t = cm.ensureSetupToken();
  assert.match(t, /^[0-9a-f]{48}$/);
  assert.equal(cm.getExpectedSetupToken(), t);
  assert.equal(cm.ensureSetupToken(), t); // idempotent
  // once setup completes, the token is cleared
  const cfg = cm.load();
  cfg.adminPasswordHash = 'salt:hash';
  cm.save(cfg);
  cm.clearSetupToken();
  assert.equal(cm.getExpectedSetupToken(), null);
});

test('H1: env-provided setup token is authoritative and not persisted', () => {
  const cm = freshConfigManager();
  process.env.SETUP_TOKEN = 'env-token';
  assert.equal(cm.getExpectedSetupToken(), 'env-token');
  assert.equal(cm.load().setupToken, undefined);
  delete process.env.SETUP_TOKEN;
});

// ---------- H3 / M3: path traversal ----------

test('H3: config import rejects path traversal, allows legit assets', () => {
  const cm = freshConfigManager();
  const escaped = path.resolve(cm.ASSETS_DIR, '../../evil.js');
  assert.throws(() => cm.importConfig({ assets: { '../../evil.js': Buffer.from('x').toString('base64') } }));
  assert.equal(fs.existsSync(escaped), false);
  cm.importConfig({ assets: { 'legit.png': Buffer.from('hi').toString('base64') } });
  assert.equal(fs.existsSync(path.join(cm.ASSETS_DIR, 'legit.png')), true);
});

test('M3: resolveAssetPath contains paths within ASSETS_DIR', () => {
  const cm = freshConfigManager();
  assert.equal(cm.resolveAssetPath('../../etc/passwd'), null);
  assert.equal(cm.resolveAssetPath('/etc/passwd'), null);
  assert.equal(cm.resolveAssetPath(''), null);
  assert.ok(cm.resolveAssetPath('abc.png').endsWith(path.join('assets', 'abc.png')));
});

// ---------- M5: no shipped credential ----------

test('M5: per-deployment token seeded and revealed via /ping', () => {
  const cm = freshConfigManager();
  const eps = cm.loadEndpoints();
  const ping = eps.find(e => e.path === '/ping');
  const carlist = eps.find(e => e.path === '/carlist');
  const echo = eps.find(e => e.path === '/echo');
  const tok = ping.responses[0].data.token;
  assert.match(tok, /^[0-9a-f]{48}$/);
  assert.equal(carlist.token, tok);
  assert.equal(echo.token, tok);
  assert.notEqual(tok, 'let-th3PenguinR0ar!');
});

// ---------- H2: rate limiter ----------

test('H2: fixed-window rate limiter blocks after max and resets', () => {
  const rl = createRateLimiter({ name: 'login', max: 3, windowMs: 1000 });
  const t0 = 1_000_000;
  assert.equal(rl.hit('login:1.1.1.1', t0).allowed, true);
  assert.equal(rl.hit('login:1.1.1.1', t0 + 1).allowed, true);
  assert.equal(rl.hit('login:1.1.1.1', t0 + 2).allowed, true);
  assert.equal(rl.hit('login:1.1.1.1', t0 + 3).allowed, false); // 4th over limit
  assert.equal(rl.hit('login:2.2.2.2', t0 + 3).allowed, true);  // separate IP bucket
  assert.equal(rl.hit('login:1.1.1.1', t0 + 1001).allowed, true); // window reset
});

// ---------- A05 / M4: security headers ----------

test('A05: security-headers fallback covers the essentials', () => {
  for (const h of ['Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Strict-Transport-Security']) {
    assert.ok(SECURITY_HEADERS[h], 'missing header: ' + h);
  }
  assert.match(CONTENT_SECURITY_POLICY, /unpkg\.com/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
});
