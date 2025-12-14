'use strict';

const Fastify = require('fastify');
const path = require('path');
const fs = require('fs');

const configManager = require('./config/configManager');
const authPlugin = require('./plugins/auth');
const adminRoutes = require('./routes/admin');
const dynamicRoutes = require('./routes/dynamic');

async function buildServer() {
  const config = configManager.load();
  
  const fastify = Fastify({
    logger: {
      level: config.logLevel || 'info'
    },
    bodyLimit: 50 * 1024 * 1024 // 50MB for binary uploads
  });

  // Register multipart for file uploads
  await fastify.register(require('@fastify/multipart'), {
    limits: {
      fileSize: 50 * 1024 * 1024
    }
  });

  // Register static file serving for admin UI
  await fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, 'public'),
    prefix: '/admin'
  });
  
  // Handle /admin without trailing slash
  fastify.get('/admin', async (request, reply) => {
    return reply.sendFile('index.html');
  });

  // Register cookie support for session
  await fastify.register(require('@fastify/cookie'));

  // Register formbody for form submissions
  await fastify.register(require('@fastify/formbody'));

  // Register auth plugin
  await fastify.register(authPlugin);

  // Register admin routes
  await fastify.register(adminRoutes, { prefix: '/api/admin' });

  // Register dynamic API routes
  await fastify.register(dynamicRoutes);

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Root redirect to admin
  fastify.get('/', async (request, reply) => {
    return reply.redirect('/admin');
  });

  return fastify;
}

async function start() {
  const config = configManager.load();
  
  // Determine port: env var > config file > default
  const port = process.env.PORT || config.port || 4242;
  process.env.PORT = port; // Ensure it's set for other modules
  
  // Check if setup is needed
  if (!config.adminPasswordHash) {
    console.log('\n🐧 RoarinAPI Service - First Launch Setup Required');
    console.log(`Access the admin panel at http://localhost:${port}/admin`);
    console.log('You will be prompted to set an admin password.\n');
  }

  const server = await buildServer();
  
  try {
    const host = process.env.HOST || '0.0.0.0';
    await server.listen({ port: parseInt(port), host });
    console.log(`🐧 RoarinAPI Service running on http://${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

module.exports = { buildServer, start };

// Start if run directly
if (require.main === module) {
  start();
}
