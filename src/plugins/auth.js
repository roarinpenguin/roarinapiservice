'use strict';

const fp = require('fastify-plugin');
const crypto = require('crypto');
const configManager = require('../config/configManager');

// Hash password with salt
function hashPassword(password, salt = null) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt, combined: `${salt}:${hash}` };
}

// Verify password (constant-time comparison to avoid timing side channels)
function verifyPassword(password, combined) {
  if (typeof combined !== 'string') return false;
  const [salt, storedHash] = combined.split(':');
  if (!salt || !storedHash) return false;
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

// --- Stateless, signed session tokens ---------------------------------------
// Sessions are HMAC-signed tokens (secret = config.sessionSecret) rather than
// an in-memory Map. Any instance behind the load balancer can validate a
// session with no shared session state, so the service scales horizontally.
// The secret lives in config.json, shared across instances via EFS.
//
// Token format:  base64url(JSON {iat, exp}) + "." + base64url(HMAC-SHA256)
// Global revocation (logout-all / password change) is done by bumping
// config.sessionsInvalidBefore; tokens issued before that instant are rejected.

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function signPayload(payloadB64, secret) {
  return base64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

function createSessionToken(secret) {
  const now = Date.now();
  const payloadB64 = base64url(JSON.stringify({ iat: now, exp: now + SESSION_TTL }));
  return `${payloadB64}.${signPayload(payloadB64, secret)}`;
}

function verifySessionToken(token, secret, invalidBefore) {
  if (!token || typeof token !== 'string' || !secret) return false;
  const idx = token.lastIndexOf('.');
  if (idx < 1) return false;
  const payloadB64 = token.slice(0, idx);
  const providedSig = token.slice(idx + 1);
  const expectedSig = signPayload(payloadB64, secret);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  let payload;
  try {
    payload = JSON.parse(fromBase64url(payloadB64).toString('utf8'));
  } catch (e) {
    return false;
  }
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return false;
  if (invalidBefore && (typeof payload.iat !== 'number' || payload.iat < invalidBefore)) return false;
  return true;
}

async function authPlugin(fastify, options) {
  // Decorate fastify with auth utilities
  fastify.decorate('hashPassword', hashPassword);
  fastify.decorate('verifyPassword', verifyPassword);
  
  // Check if setup is complete
  fastify.decorate('isSetupComplete', () => {
    const config = configManager.load();
    return !!config.adminPasswordHash;
  });
  
  // Verify the one-time setup token (constant-time). Guards /setup against
  // first-boot account takeover (H1).
  fastify.decorate('verifySetupToken', (provided) => {
    const expected = configManager.getExpectedSetupToken();
    if (!expected || typeof provided !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  });

  // Setup password
  fastify.decorate('setupPassword', (password) => {
    const { combined } = hashPassword(password);
    const config = configManager.load();
    config.adminPasswordHash = combined;
    configManager.save(config);
    return true;
  });
  
  // Login
  fastify.decorate('login', (password) => {
    const config = configManager.load();
    if (!config.adminPasswordHash) return null;

    if (!verifyPassword(password, config.adminPasswordHash)) {
      return null;
    }

    return createSessionToken(config.sessionSecret);
  });

  // Validate session
  fastify.decorate('validateSession', (token) => {
    if (!token) return false;
    const config = configManager.load();
    return verifySessionToken(token, config.sessionSecret, config.sessionsInvalidBefore || 0);
  });

  // Logout — stateless tokens cannot be revoked individually server-side; the
  // route clears the cookie. Use changePassword for global revocation.
  fastify.decorate('logout', () => {});

  // Change password
  fastify.decorate('changePassword', (currentPassword, newPassword) => {
    const config = configManager.load();
    if (!config.adminPasswordHash) return false;

    if (!verifyPassword(currentPassword, config.adminPasswordHash)) {
      return false;
    }

    const { combined } = hashPassword(newPassword);
    config.adminPasswordHash = combined;
    // Invalidate every token issued before now (replaces sessions.clear()).
    config.sessionsInvalidBefore = Date.now();
    configManager.save(config);

    return true;
  });
  
  // Auth decorator for routes
  fastify.decorate('requireAuth', async (request, reply) => {
    const token = request.cookies?.sessionToken;
    
    if (!fastify.validateSession(token)) {
      reply.code(401).send({ error: 'Unauthorized', needsAuth: true });
      return;
    }
  });
  
  // Check setup decorator
  fastify.decorate('requireSetup', async (request, reply) => {
    if (!fastify.isSetupComplete()) {
      reply.code(403).send({ error: 'Setup required', needsSetup: true });
      return;
    }
  });
}

module.exports = fp(authPlugin, {
  name: 'auth-plugin'
});
// Exposed for unit testing of the stateless session engine.
module.exports.createSessionToken = createSessionToken;
module.exports.verifySessionToken = verifySessionToken;
module.exports.verifyPassword = verifyPassword;
module.exports.hashPassword = hashPassword;
