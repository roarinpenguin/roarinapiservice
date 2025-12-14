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

// Verify password
function verifyPassword(password, combined) {
  const [salt, storedHash] = combined.split(':');
  const { hash } = hashPassword(password, salt);
  return hash === storedHash;
}

// Generate session token
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Session store (in-memory, persists across requests but not restarts)
const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function authPlugin(fastify, options) {
  // Decorate fastify with auth utilities
  fastify.decorate('hashPassword', hashPassword);
  fastify.decorate('verifyPassword', verifyPassword);
  
  // Check if setup is complete
  fastify.decorate('isSetupComplete', () => {
    const config = configManager.load();
    return !!config.adminPasswordHash;
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
    
    const token = generateSessionToken();
    sessions.set(token, {
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL
    });
    
    return token;
  });
  
  // Validate session
  fastify.decorate('validateSession', (token) => {
    if (!token) return false;
    
    const session = sessions.get(token);
    if (!session) return false;
    
    if (Date.now() > session.expiresAt) {
      sessions.delete(token);
      return false;
    }
    
    return true;
  });
  
  // Logout
  fastify.decorate('logout', (token) => {
    sessions.delete(token);
  });
  
  // Change password
  fastify.decorate('changePassword', (currentPassword, newPassword) => {
    const config = configManager.load();
    if (!config.adminPasswordHash) return false;
    
    if (!verifyPassword(currentPassword, config.adminPasswordHash)) {
      return false;
    }
    
    const { combined } = hashPassword(newPassword);
    config.adminPasswordHash = combined;
    configManager.save(config);
    
    // Invalidate all sessions
    sessions.clear();
    
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
