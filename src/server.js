'use strict';

const Fastify = require('fastify');
const path = require('path');
const fs = require('fs');

const configManager = require('./config/configManager');
const authPlugin = require('./plugins/auth');
const adminRoutes = require('./routes/admin');
const dynamicRoutes = require('./routes/dynamic');
const certificates = require('./utils/certificates');

async function buildServer(httpsOptions = null) {
  const config = configManager.load();
  
  const fastifyOptions = {
    logger: {
      level: config.logLevel || 'info'
    },
    bodyLimit: 50 * 1024 * 1024 // 50MB for binary uploads
  };
  
  // Add HTTPS if configured
  if (httpsOptions) {
    fastifyOptions.https = httpsOptions;
  }
  
  const fastify = Fastify(fastifyOptions);

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
  
  // Determine port: config file > env var > default (config takes priority for admin UI changes)
  const port = config.port || process.env.PORT || 4242;
  process.env.PORT = port; // Ensure it's set for other modules
  
  // Determine protocol mode: env var > config file > default (https)
  const useHttps = process.env.USE_HTTPS !== 'false' && (config.tls?.enabled !== false);
  const useCustomCerts = config.tls?.useCustom || false;
  
  // Get HTTPS options if enabled
  let httpsOptions = null;
  let protocol = 'http';
  
  if (useHttps) {
    const certs = certificates.getCertificates(useCustomCerts);
    if (certs) {
      httpsOptions = certs;
      protocol = 'https';
    } else {
      console.log('⚠️  Could not load certificates, falling back to HTTP');
    }
  }
  
  // Check if setup is needed
  if (!config.adminPasswordHash) {
    console.log('\n🐧 RoarinAPI Service - First Launch Setup Required');
    console.log(`Access the admin panel at ${protocol}://localhost:${port}/admin`);
    console.log('You will be prompted to set an admin password.\n');
  }

  const server = await buildServer(httpsOptions);
  
  try {
    const host = process.env.HOST || '0.0.0.0';
    await server.listen({ port: parseInt(port), host });
    console.log(`🐧 RoarinAPI Service running on ${protocol}://${host}:${port}`);
    if (protocol === 'https') {
      console.log(`🔐 TLS enabled (${useCustomCerts ? 'custom' : 'self-signed'} certificates)`);
    }
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
